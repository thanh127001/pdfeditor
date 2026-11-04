export function initializeEditorRuntime(thisEditor, PdfEngine) {

  const $ = id => document.getElementById(id);
  const DEFAULT_NAME = 'Untitled Document';
  let pages = [], selected = new Set(), anchor = null, detailsId = null, nextId = 1;
  let columns = 6, history = [], pageHistory = new Map(), busy = false, renderVersion = 0, draggingIds = null, dropIndex = null;
  let dragPointer = null, scrollFrame = null, suppressClickAfterDrag = false;
  const clearModal = bootstrap.Modal.getOrCreateInstance($('clearAllModal'));
  const exportModal = bootstrap.Modal.getOrCreateInstance($('exportScopeModal'));
  let pendingInsert = null;
  let selectedHighlightId = null, highlightCounter = 0, highlightGesture = null;
  let selectedTextId = null, textCounter = 0, textGesture = null;
  let selectedImageId = null, imageCounter = 0, imageGesture = null, pendingImage = null;
  let selectedShapeId = null, shapeCounter = 0, shapeGesture = null;
  const initialShapeDefaults = { stroke: "#0d6efd", strokeWidth: 2, opacity: 100, fill: "#ffffff", fillOpacity: 0, square: false, circle: false };
  const shapeDefaultsByTool = {
    Line: {...initialShapeDefaults},
    Draw: {...initialShapeDefaults},
    Rectangle: {...initialShapeDefaults},
    Ellipse: {...initialShapeDefaults}
  };
  const currentShapeDefaults = () => shapeDefaultsByTool[activeDetailsTool];
  const imageDefaults = thisEditor.toolSettings.get('Image');
  const textDefaults = thisEditor.toolSettings.get('Text');
  const highlightDefaults = thisEditor.toolSettings.get('Highlight');
  let detailsRenderToken = 0;
  let detailsPageWidthPt = 0;
  const indexOf = id => pages.findIndex(p => p.id === id);
  const orderedSelection = () => pages.filter(p => selected.has(p.id));
  const status = message => { $('editorStatus').textContent = message; };
  const isDetails = () => !$('pageDetailsSection').classList.contains('d-none');
  const snapshot = () => ({ pages: pages.map(p => ({...p})), selected: [...selected], anchor, detailsId });
  // Structural history belongs to Page List; page-edit history is keyed by stable page ID.
  function recordUndo(affectedIds = [...selected]) {
    history.push({ ...snapshot(), affectedIds: [...affectedIds] });
    if (history.length > 100) history.shift();
  }
  function recordPageEdit(page) {
    thisEditor.events.emit('page:editing',{pageId:page.id});
    const entries = pageHistory.get(page.id) || [];
    entries.push({ rotation: page.rotation, pageSize: page.pageSize || 'original', demoNotes: page.demoNotes || '', highlights: (page.highlights || []).map(h => ({...h})), texts: (page.texts || []).map(t => ({...t})), images: (page.images || []).map(i => ({...i})), shapes: (page.shapes || []).map(v => ({...v, ...(v.points ? {points:v.points.map(p=>({...p}))} : {})})) });
    if (entries.length > 100) entries.shift();
    pageHistory.set(page.id, entries);
  }
  function setBusy(value) { busy = value; updateButtons(); }
  function updateButtons() {
    const n = pages.length, s = selected.size, one = s === 1 ? indexOf([...selected][0]) : -1;
    $('undoBtn').disabled = busy || !history.length;
    $('undoBtnDetails').disabled = busy || !(pageHistory.get(detailsId)?.length);
    for (const id of ['exportPdf','clearAll']) $(id).disabled = busy || !n;
    $('addPdf').disabled = $('addBlank').disabled = busy;
    $('clearSelection').disabled = busy || !s;
    $('deleteSelected').disabled = $('rotateSelected').disabled = busy || !s;
    $('moveUp').disabled = busy || one <= 0;
    $('moveDown').disabled = busy || one < 0 || one >= n - 1;
    $('clearSelection').innerHTML = `<i class="bi bi-x-circle me-1"></i>Clear Selection (${s})`;
    $('previous').disabled = busy || indexOf(detailsId) <= 0;
    $('next').disabled = busy || indexOf(detailsId) < 0 || indexOf(detailsId) >= n - 1;
  }
  function setView(details) {
    if(details) thisEditor.pageManager.open(detailsId); else thisEditor.pageManager.back();
    $('pageListSection').classList.toggle('d-none', details);
    $('pageDetailsSection').classList.toggle('d-none', !details);
    if (details) renderDetails(); else detailsRenderToken++;
    updateButtons();
  }
  function renderDetails() {
    const i = indexOf(detailsId);
    if (i < 0) { setView(false); return; }
    $('pagePosition').textContent = `Page ${i + 1} / ${pages.length}`;
    void syncPageSizeSelection();
    $('editorText').value = pages[i].demoNotes || '';
    updateButtons();
    void renderDetailsPage();
    renderHighlightOptions();
    if (activeDetailsTool === 'PageSize') updateDetailsToolSelection();
    if (activeDetailsTool === "Text") renderTextOptions();
    if (activeDetailsTool === "Image") renderImageOptions();
    if (["Line","Draw","Rectangle","Ellipse"].includes(activeDetailsTool)) renderShapeOptions();
  }
  async function renderDetailsPage() {
    const token = ++detailsRenderToken;
    const item = pages[indexOf(detailsId)];
    if (!item) return;
    const paper = $('detailsPaper'), canvas = $('detailsCanvas'), container = $('editorPage');
    try {
      const size = await PdfEngine.getPageSize(item);
      if (token !== detailsRenderToken || !isDetails()) return;
      const zoomValue = $('detailsZoom').value;
      const availableWidth = Math.max(120, container.clientWidth - 32);
      // 100% fills the available width; other percentages scale relative to it.
      const fullWidthScale = availableWidth / size.width;
      const scale = fullWidthScale * (Number(zoomValue) / 100);
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      // Render into an offscreen canvas first so asynchronous navigation cannot overwrite the visible page.
      const temporary = document.createElement('canvas');
      await PdfEngine.renderThumbnail(item, temporary, Math.ceil(size.width * scale));
      if (token !== detailsRenderToken || !isDetails()) return;
      detailsPageWidthPt = size.width;
      canvas.width = width; canvas.height = height;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      paper.style.width = `${width}px`; paper.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
      ctx.drawImage(temporary, 0, 0, width, height);
      renderHighlights();
      renderTexts();
      renderImages();
      renderShapes();
      if(activeDetailsTool === "Image")renderImageOptions();
    } catch (error) { if (token === detailsRenderToken) status(`Unable to display page: ${error.message}`); }
  }
  function openDetails(id) {
    selected = new Set([id]); anchor = id; detailsId = id; selectedHighlightId = null; selectedTextId = null; selectedImageId = null; selectedShapeId = null; pendingImage = null;
    activeDetailsTool = null;
    updateDetailsToolSelection();
    // Each entry into Page Details starts at 100% zoom.
    $('detailsZoom').value = '100';
    $('detailsZoomButton').textContent = 'Zoom: 100%';
    document.querySelectorAll('[data-zoom-value]').forEach(item => item.classList.toggle('active', item.dataset.zoomValue === '100'));
    renderList(); setView(true);
  }
  function saveDemoNotes() {
    const item = pages[indexOf(detailsId)];
    if (item) item.demoNotes = $('editorText').value; // UI demo only; never used by PdfEngine.
  }
  function choose(id, multi = false) {
    if (multi) {
      // The selection button toggles multi-selection without keyboard modifiers.
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      anchor = id;
    } else if (selected.size === 1 && selected.has(id)) {
      selected.clear(); anchor = null;
    } else {
      // Clicking a thumbnail selects only that page, regardless of Ctrl/Shift.
      selected = new Set([id]); anchor = id;
    }
    updateSelectionUI();
  }
  // Update only selection styling and selection buttons. Keep thumbnails and scroll intact.
  function updateSelectionUI() {
    const grid = $('pages');
    for (const col of grid.children) {
      const id = Number(col.dataset.pageId);
      const isSelected = selected.has(id);
      const card = col.querySelector('.page-card');
      if (!draggingIds) card?.classList.remove('opacity-50');
      if (card) {
        card.classList.remove('border-primary', 'border-secondary');
        card.classList.add(isSelected ? 'border-primary' : 'border-secondary');
      }
      const selectButton = col.querySelector('.thumb-select');
      if (selectButton) {
        selectButton.classList.toggle('active', isSelected);
        selectButton.setAttribute('aria-pressed', String(isSelected));
        selectButton.setAttribute('aria-label', `${isSelected ? 'Remove page from' : 'Add page to'} multi-selection`);
        selectButton.innerHTML = `<i class="bi bi-${isSelected ? 'check-square-fill' : 'check-square'}"></i>`;
      }
    }
    updateButtons();
  }
  function clearDropMarkers() { $('pages').querySelectorAll('.border-start,.border-end').forEach(e => e.classList.remove('border-start','border-end','border-primary','border-5')); }
  function showDropGap(index) {
    dropIndex = index; clearDropMarkers();
    const cols = [...$('pages').children];
    if (index === cols.length) cols.at(-1)?.classList.add('border-end','border-primary','border-5');
    else cols[index]?.classList.add('border-start','border-primary','border-5');
  }
  function findGap(x,y) {
    const cols = [...$('pages').children]; if (!cols.length) return;
    // Find the nearest page row, then the nearest insertion boundary in that row.
    // This avoids choosing a gap in a different row when the grid has many columns.
    const rows = [];
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect();
      let row = rows.find(entry => Math.abs(entry.top - r.top) < 8);
      if (!row) { row = {top:r.top,bottom:r.bottom,items:[]}; rows.push(row); }
      row.items.push({index:i,rect:r}); row.bottom = Math.max(row.bottom,r.bottom);
    }
    // The space below the final row is an explicit end-of-list drop zone.
    // This also handles a final row with fewer cards than the selected column count.
    const lastRow = rows[rows.length - 1];
    const lastItem = lastRow.items[lastRow.items.length - 1];
    if (y >= lastRow.bottom || (y >= lastRow.top && x >= lastItem.rect.right)) {
      showDropGap(cols.length);
      return;
    }
    const row = rows.reduce((best,current) => {
      const dist = Math.max(current.top-y,0,y-current.bottom);
      const bestDist = Math.max(best.top-y,0,y-best.bottom);
      return dist < bestDist ? current : best;
    });
    let gap = row.items[0].index;
    for (const entry of row.items) {
      if (x >= (entry.rect.left + entry.rect.right)/2) gap = entry.index+1;
      else break;
    }
    showDropGap(gap);
  }
  function stopScroll() {
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    dragPointer = null;
  }
  // Scroll the nearest scrollable container (or the window) while dragging near
  // the visible top/bottom edge. Continue scrolling even if dragover pauses.
  function dragScrollContainer() {
    let node = $('pages').parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    return window;
  }
  function autoScroll() {
    // Keep the animation loop alive throughout the drag. A native HTML5 drag
    // can temporarily stop emitting dragover events while the viewport scrolls.
    if (!draggingIds) { scrollFrame = null; return; }
    if (dragPointer) {
      const target = dragScrollContainer();
      const rect = target === window
        ? {top: 0, bottom: window.innerHeight}
        : target.getBoundingClientRect();
      const title = $('pdfEditorTitle').getBoundingClientRect();
      const toolbar = $('pageListToolbar').getBoundingClientRect();
      const top = target === window
        ? Math.max(0, title.bottom, toolbar.bottom < window.innerHeight ? toolbar.bottom : 0)
        : Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const edge = Math.min(130, Math.max(45, (bottom - top) / 3));
      const y = dragPointer.y;
      let speed = 0;
      if (y < top + edge) speed = -Math.min(28, 6 + 22 * (top + edge - y) / edge);
      else if (y > bottom - edge) speed = Math.min(28, 6 + 22 * (y - (bottom - edge)) / edge);
      if (speed) {
        const before = target === window ? window.scrollY : target.scrollTop;
        if (target === window) window.scrollBy({top:speed,behavior:'instant'});
        else target.scrollTop += speed;
        const after = target === window ? window.scrollY : target.scrollTop;
        if (after !== before) findGap(dragPointer.x, dragPointer.y);
      }
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }
  function updateDragPointer(e) {
    if (!draggingIds) return;
    // Some browsers emit (0,0) for native drag events outside the page.
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && (e.clientX !== 0 || e.clientY !== 0)) {
      dragPointer = {x:e.clientX,y:e.clientY};
      findGap(e.clientX,e.clientY);
    }
  }
  function endDrag() { draggingIds = null; dropIndex = null; stopScroll(); clearDropMarkers(); $('pages').querySelectorAll('.page-card.opacity-50').forEach(card => card.classList.remove('opacity-50')); setTimeout(() => { suppressClickAfterDrag = false; }, 0); }
  // ISO A-series classification with a 1 mm tolerance for rounded PDF dimensions.
  function pageSizeLabel(size) {
    const mm = 25.4 / 72;
    const width = Math.min(size.width, size.height) * mm;
    const height = Math.max(size.width, size.height) * mm;
    const formats = [
      ['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420],
      ['A2', 420, 594], ['A1', 594, 841], ['A0', 841, 1189],
      ['Letter', 215.9, 279.4]
    ];
    return formats.find(([, w, h]) => Math.abs(width - w) <= 1 && Math.abs(height - h) <= 1)?.[0] || '?';
  }
  function renderList() {
    // Preserve the user's current working position across structural grid updates.
    const grid = $('pages');
    const scrollPositions = [];
    for (let node = grid.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
        scrollPositions.push([node, node.scrollTop, node.scrollLeft]);
      }
    }
    const windowScrollX = window.scrollX;
    const windowScrollY = window.scrollY;
    const version = ++renderVersion;
    grid.replaceChildren();
    $('emptyState').classList.toggle('d-none', pages.length > 0);
    grid.className = `row row-cols-2 row-cols-sm-3 row-cols-lg-${columns} g-3`;
    for (const [i, item] of pages.entries()) {
      const col = document.createElement('div'); col.className = 'col'; col.dataset.pageId = item.id;
      const card = document.createElement('div'); card.className = `page-card card h-100 position-relative user-select-none ${selected.has(item.id) ? 'border-primary' : 'border-secondary'}`;
      
      card.draggable = true; // Keep native drag enabled after async PDF import; dragstart checks busy.
      const thumb = document.createElement('div'); thumb.className = 'thumb ratio bg-body-tertiary overflow-hidden rounded-top'; thumb.draggable = false;
      thumb.style.setProperty('--bs-aspect-ratio','141.4%');
      const canvas = document.createElement('canvas'); canvas.className = 'position-absolute top-50 start-50 translate-middle mw-100 mh-100 object-fit-contain bg-white shadow-sm'; canvas.draggable = false; canvas.setAttribute('aria-label', `Preview page ${i + 1}`); thumb.append(canvas);
      const actions = document.createElement('div'); actions.className = 'position-absolute top-0 start-0 w-100 h-100 pe-none d-flex flex-column justify-content-between p-2 gap-2';
      const topActions = document.createElement('div'); topActions.className = 'd-flex flex-wrap align-items-start justify-content-between gap-2';
      const bottomActions = document.createElement('div'); bottomActions.className = 'd-flex flex-wrap align-items-end justify-content-between gap-2';
      const selectButton = document.createElement('button'); selectButton.type = 'button';
      selectButton.className = `thumb-select btn btn-sm btn-primary pe-auto ${selected.has(item.id) ? 'active' : ''}`;
      selectButton.id = `pageSelect_${item.id}`;
      selectButton.innerHTML = `<i class="bi bi-${selected.has(item.id) ? 'check-square-fill' : 'check-square'}"></i>`;
      selectButton.setAttribute('aria-label', `${selected.has(item.id) ? 'Remove page from' : 'Add page to'} multi-selection`);
      selectButton.setAttribute('aria-pressed', String(selected.has(item.id)));
      selectButton.addEventListener('click', e => { e.stopPropagation(); if (!busy) choose(item.id, true); });
      selectButton.addEventListener('dragstart', e => e.preventDefault());
      const details = document.createElement('button'); details.type = 'button'; details.id = `pageDetails_${item.id}`;
      details.className = 'btn btn-sm btn-primary pe-auto'; details.innerHTML = '<i class="bi bi-zoom-in me-1"></i>Details';
      details.addEventListener('click', e => { e.stopPropagation(); openDetails(item.id); });
      const sizeLabel = document.createElement('div');
      sizeLabel.className = 'badge bg-info';
      sizeLabel.textContent = '…';
      sizeLabel.title = 'Page size';
      void PdfEngine.getPageSize(item).then(size => {
        if (version !== renderVersion || !sizeLabel.isConnected) return;
        sizeLabel.textContent = pageSizeLabel(size);
        sizeLabel.title = `Page size: ${size.width.toFixed(2)} × ${size.height.toFixed(2)} pt`;
      }).catch(() => {
        if (version === renderVersion && sizeLabel.isConnected) sizeLabel.textContent = '?';
      });
      const pageLabel = document.createElement('div');
      pageLabel.id = `pageLabel_${item.id}`;
      pageLabel.className = 'badge bg-info';
      pageLabel.textContent = `Page ${i + 1}`;
      topActions.append(sizeLabel, details);
      bottomActions.append(pageLabel, selectButton);
      actions.append(topActions, bottomActions); card.append(thumb, actions);
      col.append(card); grid.append(col);
      // Selection is changed on click, not pointerdown, so an unselected card can
      // be dragged without destroying the drag source by rerendering the grid.
      card.addEventListener('click', e => {
        if (suppressClickAfterDrag) { suppressClickAfterDrag = false; return; }
        if (!busy) choose(item.id);
      });
      card.addEventListener('dragstart', e => {
        if (busy) { e.preventDefault(); return; }
        // Drag an existing selection as a group, or drag an unselected card alone.
        // Do not call renderList() here: replacing the dragged DOM node cancels drag.
        if (!selected.has(item.id)) {
          // Dragging an unselected page selects it exclusively, without rerendering.
          selected = new Set([item.id]);
          anchor = item.id;
          updateSelectionUI();
        }
        // Drag all selected pages if the dragged page belongs to the selection.
        draggingIds = orderedSelection().map(p => p.id);
        suppressClickAfterDrag = true; e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggingIds.join(','));
        dragPointer = {x: e.clientX, y: e.clientY};
        // Delay styling only; keep the native drag source mounted until drop.
        requestAnimationFrame(() => { if (draggingIds && card.isConnected) card.classList.add('opacity-50'); });
        if (scrollFrame === null) scrollFrame = requestAnimationFrame(autoScroll);
      });
      card.addEventListener('drag', updateDragPointer);
      card.addEventListener('dragend', endDrag);
      // Render real PDF page pixels via PDF.js. Guard against stale async render after rerender.
      void PdfEngine.renderThumbnail(item, canvas, Math.max(190, Math.ceil(thumb.getBoundingClientRect().width * (window.devicePixelRatio || 1)))).then(async () => {
        if (version !== renderVersion || !canvas.isConnected) return;
        // Preview the same flattened annotation layer used by Export PDF,
        // without modifying the underlying source PDF or page objects.
        if (!(item.highlights?.length || item.texts?.length || item.images?.length || item.shapes?.length)) return;
        const overlayUrl = await makeExportOverlay(item);
        if (!overlayUrl || version !== renderVersion || !canvas.isConnected) return;
        const overlay = new Image();
        overlay.src = overlayUrl;
        await overlay.decode();
        if (version !== renderVersion || !canvas.isConnected) return;
        canvas.getContext('2d').drawImage(overlay, 0, 0, canvas.width, canvas.height);
      }).catch(error => {
        if (version !== renderVersion || !canvas.isConnected) return;
        thumb.textContent = 'Preview unavailable'; thumb.classList.add('small','text-danger'); console.error(error);
      });
    }
    updateButtons();
    // Restore after the new thumbnails have established their layout.
    for (const [node, top, left] of scrollPositions) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    window.scrollTo(windowScrollX, windowScrollY);
  }
  async function insertItems(newItems, initialName = null, afterId = null) {
    if (!newItems.length) return;
    const wasEmpty = pages.length === 0;
    recordUndo(afterId === null ? [] : [afterId]);
    const selectedIndex = afterId === null ? -1 : indexOf(afterId);
    const at = selectedIndex >= 0 ? selectedIndex + 1 : pages.length;
    const added = newItems.map(p => ({ ...p, id: nextId++, demoNotes: '' }));
    pages.splice(at, 0, ...added);
    selected = new Set(added.map(p => p.id)); anchor = added.at(-1).id;
    if (wasEmpty && initialName) $('exportFileName').value = initialName;
    renderList();
  }
  function beginAdd(kind) {
    if (busy) return;
    // Exactly one selected page: insert after it. Otherwise append to the end.
    const afterId = selected.size === 1 ? [...selected][0] : null;
    if (kind === 'blank') {
      void insertItems([PdfEngine.createBlankPage()], null, afterId);
    } else {
      pendingInsert = {afterId};
      $('fileInput').click();
    }
  }
  $('addBlank').addEventListener('click', () => beginAdd('blank'));
  $('addPdf').addEventListener('click', () => beginAdd('pdf'));
  $('emptyState').addEventListener('click', () => beginAdd('pdf'));
  $('fileInput').addEventListener('change', async event => {
    const files = [...event.target.files]; event.target.value = '';
    const afterId = pendingInsert?.afterId ?? null;
    pendingInsert = null;
    if (!files.length) return;
    setBusy(true); status('Loading PDF pages…');
    try {
      const imported = [];
      for (const file of files) imported.push(...await PdfEngine.importPdf(file));
      await insertItems(imported, files[0].name.replace(/\.pdf$/i,'') || DEFAULT_NAME, afterId);
      status('');
    } catch (error) { console.error(error); status(error.message); alert(error.message); }
    finally { setBusy(false); }
  });
  $('clearSelection').addEventListener('click', () => { selected.clear(); anchor = null; updateSelectionUI(); });
  function deletePagesById(ids) {
    if (busy || !ids.size) return;
    const existing = pages.filter(p => ids.has(p.id));
    if (!existing.length) return;
    recordUndo([...ids]);
    pages = pages.filter(p => !ids.has(p.id));
    for (const id of ids) selected.delete(id);
    if (ids.has(anchor)) anchor = null;
    if (isDetails() && ids.has(detailsId)) {
      detailsId = null;
      setView(false);
    }
    renderList();
    if (isDetails()) renderDetails();
  }
  $('deleteSelected').addEventListener('click', () => deletePagesById(new Set(selected)));
  $('rotateSelected').addEventListener('click', () => {
    if (!selected.size || busy) return;
    pages.forEach(p => { if (selected.has(p.id)) { recordPageEdit(p); p.rotation = (p.rotation + 90) % 360; } });
    renderList();
  });
  function move(delta) {
    if (selected.size !== 1 || busy) return;
    const i = indexOf([...selected][0]), j = i + delta;
    if (i < 0 || j < 0 || j >= pages.length) return;
    recordUndo([pages[i].id]); [pages[i],pages[j]] = [pages[j],pages[i]]; renderList();
  }
  $('moveUp').addEventListener('click', () => move(-1)); $('moveDown').addEventListener('click', () => move(1));
  function undoList() {
    if (!history.length || busy) return;
    const prev = history.pop();
    // Preserve edits of pages that still exist; structural undo changes only membership/order.
    const current = new Map(pages.map(p => [p.id, p]));
    pages = prev.pages.map(p => {
      const live = current.get(p.id);
      return live ? { ...p, rotation: live.rotation, pageSize: live.pageSize, demoNotes: live.demoNotes } : { ...p };
    });
    const affected = (prev.affectedIds || []).filter(id => indexOf(id) >= 0);
    const fallback = (prev.selected || []).filter(id => indexOf(id) >= 0);
    selected = new Set(affected.length ? affected : fallback);
    anchor = [...selected][0] ?? null;
    if (indexOf(detailsId) < 0) detailsId = anchor;
    renderList();
    updateButtons();
  }
  function undoDetails() {
    if (busy) return;
    const page = pages[indexOf(detailsId)];
    const entries = pageHistory.get(detailsId);
    if (!page || !entries?.length) return;
    const previous = entries.pop();
    page.rotation = previous.rotation;
    page.pageSize = previous.pageSize || 'original';
    page.demoNotes = previous.demoNotes;
    page.highlights = (previous.highlights || []).map(h => ({...h}));
    page.images = (previous.images || []).map(i => ({...i}));
    page.texts = (previous.texts || []).map(t => ({...t}));
    page.shapes = (previous.shapes || []).map(v => ({...v, ...(v.points ? {points:v.points.map(p=>({...p}))} : {})}));
    selectedShapeId = null;
    selectedTextId = null; selectedImageId = null; pendingImage = null;
    selectedHighlightId = null;
    $('editorText').value = page.demoNotes || '';
    updateButtons();
    renderDetails();
  }
  $('undoBtn').addEventListener('click', undoList);
  $('undoBtnDetails').addEventListener('click', undoDetails);
  // Native HTML drag events may target a child canvas or leave the grid during
  // auto-scroll. Track and accept them at document level, then resolve the
  // insertion gap against the page grid. Never rebuild thumbnails mid-drag.
  document.addEventListener('dragover', e => {
    if (!draggingIds) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    updateDragPointer(e);
  }, true);
  function commitPageDrop(e) {
    if (!draggingIds) return;
    e.preventDefault();
    e.stopPropagation();
    // Resolve the final position even if the last dragover was missed.
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY) &&
        (e.clientX !== 0 || e.clientY !== 0)) findGap(e.clientX, e.clientY);
    const ids = new Set(draggingIds);
    const moving = pages.filter(p => ids.has(p.id));
    if (!moving.length || dropIndex === null) { endDrag(); return; }
    // Gap is indexed in the original list. Exclude moved pages before it.
    const insertion = pages.slice(0, dropIndex).filter(p => !ids.has(p.id)).length;
    const remaining = pages.filter(p => !ids.has(p.id));
    const reordered = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
    const changed = reordered.some((p, i) => p.id !== pages[i].id);
    if (changed) { recordUndo([...ids]); pages = reordered; }
    endDrag();
    if (changed) renderList();
    else updateSelectionUI();
  }
  document.addEventListener('drop', commitPageDrop, true);
  $('columnsMenu').querySelectorAll('[data-columns]').forEach(button => button.addEventListener('click', () => {
    columns = Number(button.dataset.columns);
    $('columnsButton').innerHTML = `<i class="bi bi-grid-3x3-gap me-1"></i>Columns: ${columns}`;
    $('columnsMenu').querySelectorAll('[data-columns]').forEach(b => b.classList.toggle('active', Number(b.dataset.columns) === columns));
    renderList();
  }));
  for (const id of ['clearAll']) $(id).addEventListener('click', () => { if (pages.length) clearModal.show(); });
  $('confirmClearAll').addEventListener('click', async () => {
    clearModal.hide(); setBusy(true);
    pages = []; selected.clear(); anchor = null; detailsId = null; history = []; pageHistory.clear(); nextId = 1;
    $('exportFileName').value = DEFAULT_NAME; setView(false); renderList();
    try { await PdfEngine.reset(); status('All pages cleared.'); }
    catch (error) { console.error(error); status(error.message); }
    finally { setBusy(false); }
  });
  function fileName() {
    const name = ($('exportFileName').value.trim() || DEFAULT_NAME).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/,'') || DEFAULT_NAME;
    return `${name.replace(/\.pdf$/i,'')}.pdf`;
  }
  // Flatten page annotations into a transparent PNG overlay. The original PDF
  // remains vector-based; only editor-created objects are rasterized.
  async function makeExportOverlay(page) {
    if (!(page.highlights?.length || page.texts?.length || page.images?.length || page.shapes?.length)) return null;
    const size = await PdfEngine.getPageSize(page);
    const W = 1600, H = Math.max(1, Math.round(W * size.height / size.width));
    const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
    const ctx = canvas.getContext('2d');
    const px = v => Number(v || 0)*W/100, py = v => Number(v || 0)*H/100;
    const color = (hex, opacity=100) => {
      const h = String(hex || '#000000').replace('#','');
      const n = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
      const r=parseInt(n.slice(0,2),16)||0,g=parseInt(n.slice(2,4),16)||0,b=parseInt(n.slice(4,6),16)||0;
      return `rgba(${r},${g},${b},${Math.max(0,Math.min(100,Number(opacity)))/100})`;
    };
    const rotated = (x,y,w,h,angle,draw) => {
      ctx.save();ctx.translate(x+w/2,y+h/2);ctx.rotate(Number(angle||0)*Math.PI/180);
      draw(-w/2,-h/2,w,h);ctx.restore();
    };
    for(const h of page.highlights||[]) {
      rotated(px(h.x),py(h.y),px(h.width),py(h.height),h.angle,(x,y,w,hh)=>{
        ctx.fillStyle=color(h.color,h.opacity);ctx.fillRect(x,y,w,hh);
      });
    }
    for(const t of page.texts||[]) {
      rotated(px(t.x),py(t.y),px(t.width),py(t.height),t.angle,(x,y,w,h)=>{
        ctx.fillStyle=color(t.background,t.backgroundOpacity);ctx.fillRect(x,y,w,h);
        const fontPx=Math.max(1,Number(t.size||18)*W/600);
        ctx.fillStyle=t.color||'#212529';ctx.font=`${fontPx}px ${t.font||'Arial'}`;
        ctx.textBaseline='top';
        const lineHeight=fontPx*1.25,padding=4*W/600;
        const lines=[];
        for(const line of String(t.content||'').split('\\n')){
          let segment='';
          for(const word of line.split(/(\\s+)/)){
            if(segment&&ctx.measureText(segment+word).width>w-padding*2){
              lines.push(segment);segment='';
            }
            segment+=word;
          }
          lines.push(segment);
        }
        const available=Math.max(0,h-padding*2);
        const blockHeight=lines.length*lineHeight;
        const spare=Math.max(0,available-blockHeight);
        let yy=y+padding+(t.alignV==='middle'?spare/2:t.alignV==='bottom'?spare:0);
        ctx.textAlign=t.alignH||'left';
        const xx=t.alignH==='center'?x+w/2:t.alignH==='right'?x+w-padding:x+padding;
        for(const line of lines){
          if(yy+lineHeight>y+h)break;
          ctx.fillText(line,xx,yy);yy+=lineHeight;
        }
        ctx.textAlign='left';
      });
    }
    for(const i of page.images||[]) {
      const img=new Image();img.src=i.src;
      await new Promise((resolve,reject)=>{if(img.complete&&img.naturalWidth)return resolve();img.onload=resolve;img.onerror=()=>reject(new Error('Cannot load an inserted image for export.'));});
      rotated(px(i.x),py(i.y),px(i.width),py(i.height),i.angle,(x,y,w,h)=>{
        ctx.save();ctx.translate(x+w/2,y+h/2);ctx.scale(i.flipH?-1:1,i.flipV?-1:1);
        ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();
      });
    }
    for(const s of page.shapes||[]) {
      if(s.type==='Draw'){
        const points=s.points||[];
        if(points.length && Number(s.strokeWidth)>0 && Number(s.opacity)>0){
          ctx.save();
          const cx=px(s.x+s.width/2),cy=py(s.y+s.height/2);
          ctx.translate(cx,cy);ctx.rotate((s.angle||0)*Math.PI/180);ctx.translate(-cx,-cy);
          ctx.beginPath();
          ctx.moveTo(px(points[0].x),py(points[0].y));
          for(const point of points.slice(1))ctx.lineTo(px(point.x),py(point.y));
          if(points.length===1){ctx.lineTo(px(points[0].x)+.01,py(points[0].y)+.01);}
          ctx.strokeStyle=color(s.stroke,s.opacity);
          ctx.lineWidth=Number(s.strokeWidth)*W/size.width;
          ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();ctx.restore();
        }
        continue;
      }
      const x=px(s.x),y=py(s.y),w=px(s.width),h=py(s.height);
      rotated(x,y,w,h,s.angle,(xx,yy,ww,hh)=>{
        ctx.beginPath();
        if(s.type==='Line') {
          ctx.moveTo(s.reverseX?xx+ww:xx,s.reverseY?yy+hh:yy);
          ctx.lineTo(s.reverseX?xx:xx+ww,s.reverseY?yy:yy+hh);
        } else if(s.type==='Ellipse') {
          ctx.ellipse(xx+ww/2,yy+hh/2,Math.max(.01,ww/2),Math.max(.01,hh/2),0,0,2*Math.PI);
        } else ctx.rect(xx,yy,ww,hh);
        if(Number(s.strokeWidth)>0 && Number(s.opacity)>0) {
          ctx.strokeStyle=color(s.stroke,s.opacity);
          const strokeWidth=Number(s.strokeWidth)*W/size.width;
          if(s.type==='Line') {
            ctx.lineWidth=strokeWidth;
            ctx.stroke();
          } else {
            // Stroke is fully outside the fill geometry, including transparent fills.
            // Clip the doubled, centered stroke to the inverse of the shape.
            ctx.save();
            ctx.beginPath();
            const margin=Math.max(W,H)*4;
            ctx.rect(-margin,-margin,margin*2,margin*2);
            if(s.type==='Ellipse') {
              ctx.ellipse(xx+ww/2,yy+hh/2,Math.max(.01,ww/2),Math.max(.01,hh/2),0,0,2*Math.PI);
            } else ctx.rect(xx,yy,ww,hh);
            ctx.clip('evenodd');
            ctx.beginPath();
            if(s.type==='Ellipse') {
              ctx.ellipse(xx+ww/2,yy+hh/2,Math.max(.01,ww/2),Math.max(.01,hh/2),0,0,2*Math.PI);
            } else ctx.rect(xx,yy,ww,hh);
            ctx.lineWidth=strokeWidth*2;
            ctx.stroke();
            ctx.restore();
          }
        }
        if(s.type!=='Line' && Number(s.fillOpacity)>0) {
          ctx.beginPath();
          if(s.type==='Ellipse') {
            ctx.ellipse(xx+ww/2,yy+hh/2,Math.max(.01,ww/2),Math.max(.01,hh/2),0,0,2*Math.PI);
          } else ctx.rect(xx,yy,ww,hh);
          ctx.fillStyle=color(s.fill,s.fillOpacity);
          ctx.fill();
        }
      });
    }
    return canvas.toDataURL('image/png');
  }
  async function exportPages(scope) {
    const chosen = scope === 'selected' ? orderedSelection() : [...pages];
    if (!chosen.length || busy) return;
    setBusy(true); status('Exporting PDF…');
    try {
      const overlays = [];
      for (const page of chosen) overlays.push(await makeExportOverlay(page));
      const bytes = await PdfEngine.exportPdf(chosen, overlays);
      const blob = new Blob([bytes],{type:'application/pdf'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName();
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      status('');
    } catch (error) { console.error(error); status(error.message); alert(`Export failed: ${error.message}`); }
    finally { setBusy(false); }
  }
  function requestExport() {
    if (!pages.length || busy) return;
    if (!selected.size) { void exportPages('all'); return; }
    $('allPageCount').textContent = `Export all ${pages.length} page(s)`;
    $('selectedPageCount').textContent = `Export ${selected.size} selected page(s)`;
    $('exportAll').checked = true; exportModal.show();
  }
  for (const id of ['exportPdf']) $(id).addEventListener('click',requestExport);
  $('confirmExport').addEventListener('click', () => {
    const scope = document.querySelector('input[name="exportScope"]:checked').value;
    exportModal.hide(); void exportPages(scope);
  });
  $('back').addEventListener('click', () => { saveDemoNotes(); setView(false); renderList(); });
  $('previous').addEventListener('click', () => { const i = indexOf(detailsId); if (i <= 0) return; saveDemoNotes(); detailsId = pages[i-1].id; selectedHighlightId = null; selectedTextId = null; selectedImageId = null; selectedShapeId = null; pendingImage = null; selected = new Set([detailsId]); anchor = detailsId; renderDetails(); });
  $('next').addEventListener('click', () => { const i = indexOf(detailsId); if (i < 0 || i >= pages.length - 1) return; saveDemoNotes(); detailsId = pages[i+1].id; selectedHighlightId = null; selectedTextId = null; selectedImageId = null; selectedShapeId = null; pendingImage = null; selected = new Set([detailsId]); anchor = detailsId; renderDetails(); });
  // Tool selection is UI-only. The options row is reserved for future settings;
  // no PDF edits or undo history entries are made by selecting a tool.
  let activeDetailsTool = null;
  const toolOptionLabels = {
    Highlight: 'Highlight options', Text: 'Text options', Image: 'Image options',
    Line: 'Line options', Draw: 'Draw options', Rectangle: 'Rectangle options', Ellipse: 'Ellipse options'
  };
  function updateDetailsToolSelection() {
    // Page Size is a page command, not a registered drawing tool.
    const drawingTool = activeDetailsTool === 'PageSize' ? null : activeDetailsTool;
    if(thisEditor.state.activeTool!==drawingTool) thisEditor.toolManager.activate(drawingTool);
    document.querySelectorAll('[data-demo-tool]').forEach(button => {
      const active = button.dataset.demoTool === activeDetailsTool;
      button.classList.toggle('btn-primary', active);
      button.classList.toggle('btn-outline-primary', !active);
      button.setAttribute('aria-pressed', String(active));
    });
    const holding = !activeDetailsTool;
    $('toolHold').classList.toggle('btn-primary', holding);
    $('toolHold').classList.toggle('btn-outline-primary', !holding);
    $('toolHold').setAttribute('aria-pressed', String(holding));
    $('editorPage').style.cursor = holding ? 'grab' : '';
    $('editorPage').style.touchAction = holding ? 'none' : '';
    const row = $('pageDetailsToolOptions');
    row.classList.toggle('d-none', false);
    const content = $('pageDetailsToolOptionsContent');
    content.replaceChildren();
    if (!activeDetailsTool) {
      const hint=document.createElement('span');hint.className='small text-secondary w-100';
      hint.textContent='Drag the page to pan around the document.';
      content.append(hint);return;
    }
    if (activeDetailsTool === 'PageSize') {
      const label = document.createElement('label');
      label.className = 'form-label small mb-0 text-nowrap';
      label.htmlFor = 'detailsPageSize';
      label.textContent = 'Page Size';
      const select = pageSizeSelect;
      void syncPageSizeSelection();
      content.append(label, select);
      const hint=document.createElement('span');hint.className='small text-secondary w-100';
      hint.textContent='Choose a page size to resize the current page.';
      content.append(hint);
      return;
    }
    if (activeDetailsTool === 'Highlight') { renderHighlightOptions(); return; }
    if (activeDetailsTool === 'Text') { renderTextOptions(); return; }
    if (activeDetailsTool === 'Image') { renderImageOptions(); return; }
    if (['Line','Draw','Rectangle','Ellipse'].includes(activeDetailsTool)) { renderShapeOptions(); return; }
    if (activeDetailsTool) {
      const label = document.createElement('span');
      label.className = 'small text-secondary';
      label.textContent = toolOptionLabels[activeDetailsTool];
      content.append(label);
    }
  }
  // Hold is the default navigation mode whenever no editing tool is selected.
  $('toolHold').addEventListener('click', () => {
    activeDetailsTool = null;
    selectedHighlightId = null; selectedTextId = null; selectedImageId = null; selectedShapeId = null; pendingImage = null;
    updateDetailsToolSelection();
    renderHighlights(); renderTexts(); renderImages(); renderShapes();
  });
  // Drag the viewport (not the PDF content), without altering document history.
  let holdDrag = null;
  const holdViewport = $('editorPage');
  holdViewport.addEventListener('pointerdown', e => {
    if (activeDetailsTool || !isDetails() || e.button !== 0 || !e.isPrimary) return;
    holdDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: window.scrollX, top: window.scrollY };
    holdViewport.setPointerCapture(e.pointerId);
    holdViewport.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation();
  }, true);
  holdViewport.addEventListener('pointermove', e => {
    if (!holdDrag || holdDrag.id !== e.pointerId) return;
    window.scrollTo(holdDrag.left - (e.clientX - holdDrag.x), holdDrag.top - (e.clientY - holdDrag.y));
    e.preventDefault();
  });
  const endHoldDrag = e => {
    if (!holdDrag || holdDrag.id !== e.pointerId) return;
    holdDrag = null;
    holdViewport.style.cursor = activeDetailsTool ? '' : 'grab';
    if (holdViewport.hasPointerCapture(e.pointerId)) holdViewport.releasePointerCapture(e.pointerId);
  };
  holdViewport.addEventListener('pointerup', endHoldDrag);
  holdViewport.addEventListener('pointercancel', endHoldDrag);
  holdViewport.addEventListener('lostpointercapture', endHoldDrag);
  document.querySelectorAll('[data-demo-tool]').forEach(button => button.addEventListener('click', () => {
    const tool = button.dataset.demoTool;
    activeDetailsTool = activeDetailsTool === tool ? null : tool;
    if (activeDetailsTool !== 'Highlight') selectedHighlightId = null;
    if (activeDetailsTool !== 'Text') selectedTextId = null;
    if (activeDetailsTool !== 'Image') { selectedImageId = null; pendingImage = null; }
    if (!['Line','Draw','Rectangle','Ellipse'].includes(activeDetailsTool) || currentShape()?.type !== activeDetailsTool) selectedShapeId = null;
    updateDetailsToolSelection();
    renderHighlights();
    renderTexts();
    renderImages();
    renderShapes();
  }));
  updateDetailsToolSelection();

  function drawBounds(points){
    if(!points?.length)return {x:0,y:0,width:.2,height:.2};
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
    return {x,y,width:Math.max(.2,Math.max(...xs)-x),height:Math.max(.2,Math.max(...ys)-y)};
  }
  function drawHit(item,clientX,clientY){
    const pts=item.points||[],r=$('shapeLayer').getBoundingClientRect();
    const cx=(item.x+item.width/2)*r.width/100,cy=(item.y+item.height/2)*r.height/100;
    const a=(item.angle||0)*Math.PI/180;
    const point=p=>{
      const dx=p.x*r.width/100-cx,dy=p.y*r.height/100-cy;
      return {x:r.left+cx+dx*Math.cos(a)-dy*Math.sin(a),
        y:r.top+cy+dx*Math.sin(a)+dy*Math.cos(a)};
    };
    const tolerance=Math.max(6,(Number(item.strokeWidth)||0)*r.width/Math.max(1,detailsPageWidthPt)/2+4);
    for(let i=0;i<pts.length;i++){
      const p=point(pts[i]),q=point(pts[Math.min(i+1,pts.length-1)]);
      const vx=q.x-p.x,vy=q.y-p.y,t=Math.max(0,Math.min(1,((clientX-p.x)*vx+(clientY-p.y)*vy)/(vx*vx+vy*vy||1)));
      if(Math.hypot(clientX-p.x-t*vx,clientY-p.y-t*vy)<=tolerance)return true;
    }
    return false;
  }
  // Automatically activate the matching tool when an existing annotation is clicked.
  // This runs in capture phase, before a different drawing tool can create an object.
  $('detailsPaper').addEventListener('pointerdown', e => {
    if (busy || e.button !== 0 || !isDetails()) return;
    const page = currentPage();
    if (!page) return;
    const x = e.clientX, y = e.clientY;
    const inside = rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const candidates = [
      ['shapeLayer', '[data-shape-id]', 'shapeId', id => (page.shapes || []).find(o => o.id === id)?.type],
      ['imageLayer', '[data-image-id]', 'imageId', () => 'Image'],
      ['textLayer', '[data-text-id]', 'textId', () => 'Text'],
      ['highlightLayer', '[data-highlight-id]', 'highlightId', () => 'Highlight']
    ];
    let match = null;
    for (const [layerId, selector, key, typeFor] of candidates) {
      const nodes = [...$(layerId).querySelectorAll(selector)].reverse();
      for (const node of nodes) {
        const type = typeFor(node.dataset[key]);
        if(type==='Draw'){
          const draw=(page.shapes||[]).find(v=>v.id===node.dataset[key]);
          const handle=e.target.closest('[data-shape-handle]')?.closest('[data-shape-id]')===node;
          if(!draw||(!handle&&!drawHit(draw,x,y)))continue;
        }else if (!inside(node.getBoundingClientRect())) continue;
        if (!type) continue;
        match = {type, id: node.dataset[key]};
        break;
      }
      if (match) break;
    }
    if (!match || match.type === activeDetailsTool) return;
    // Select the clicked annotation, and refresh all tool-specific controls.
    activeDetailsTool = match.type;
    selectedHighlightId = match.type === 'Highlight' ? match.id : null;
    selectedTextId = match.type === 'Text' ? match.id : null;
    selectedImageId = match.type === 'Image' ? match.id : null;
    selectedShapeId = ['Line','Draw','Rectangle','Ellipse'].includes(match.type) ? match.id : null;
    pendingImage = null;
    updateDetailsToolSelection();
    renderHighlights(); renderTexts(); renderImages(); renderShapes(); updateButtons();
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Highlight coordinates are percentages of the rendered page, so zoom and
  // page reordering do not change annotation geometry or ownership.
  function currentPage() { return pages[indexOf(detailsId)]; }
  function currentHighlight() {
    return (currentPage()?.highlights || []).find(h => h.id === selectedHighlightId);
  }
  function renderHighlightOptions() {
    if (activeDetailsTool !== 'Highlight') return;
    const content = $('pageDetailsToolOptionsContent');
    content.replaceChildren();
    const selectedObject = currentHighlight();
    const settings = selectedObject || highlightDefaults;
    const makeControl = (labelText, type, id, value, min, max, step) => {
      const group = document.createElement('div');
      group.className = 'd-flex align-items-center flex-wrap gap-2';
      const label = document.createElement('label');
      label.className = 'form-label small mb-0';
      label.htmlFor = id; label.textContent = labelText;
      const input = document.createElement('input');
      input.type = type; input.id = id; input.value = value;
      input.className = type === 'color' ? 'form-control form-control-color form-control-sm' : 'form-range';
      if (type === 'range') { input.min = min; input.max = max; input.step = step; input.style.width = '110px'; input.style.maxWidth = '100%'; input.style.flex = '0 1 110px'; input.style.minWidth = '65px'; }
      const output = document.createElement('span');
      output.className = 'small text-body-secondary text-nowrap text-start flex-shrink-0';
      if (type === 'range') { output.style.width = '5ch'; output.style.fontVariantNumeric = 'tabular-nums'; }
      const isHeight=id==='highlightHeight';
      const pageHeight=Math.max(1,$('highlightLayer').getBoundingClientRect().height);
      if(isHeight){input.min='1';input.max='200';input.step='1';input.value=String(Math.round(value*pageHeight/100));}
      output.textContent=type==='range' ? (isHeight ? input.value+'px' : value+'%') : '';
      let saved = false;
      input.addEventListener('input', () => {
        if (selectedObject && !saved) { recordPageEdit(currentPage()); saved = true; }
        const key = id === 'highlightHeight' ? 'height' : id === 'highlightColor' ? 'color' : 'opacity';
        (selectedObject || highlightDefaults)[key] = isHeight
          ? Number(input.value)/pageHeight*100
          : type === 'range' ? Number(input.value) : input.value;
        if (type === 'range') output.textContent = input.value+(isHeight?'px':'%');
        renderHighlights(); updateButtons();
      });
      group.append(label, input, output); content.append(group);
    };
    makeControl('Height', 'range', 'highlightHeight', settings.height, 0.5, 15, 0.5);
    makeControl('Color', 'color', 'highlightColor', settings.color);
    makeControl('Opacity', 'range', 'highlightOpacity', settings.opacity, 5, 100, 5);
    const hint = document.createElement('span');
    hint.className = 'small text-secondary w-100';
    hint.textContent = 'Drag horizontally on the page to highlight text.';
    content.append(hint);
  }
  const OBJECT_HANDLE_SIZE=12;
  function styleObjectCornerHandle(handle,corner,offset=0){
    handle.style.width=OBJECT_HANDLE_SIZE+'px';handle.style.height=OBJECT_HANDLE_SIZE+'px';
    handle.style.left=corner.includes('w')?(-offset)+'px':'calc(100% + '+offset+'px)';
    handle.style.top=corner.includes('n')?(-offset)+'px':'calc(100% + '+offset+'px)';
    handle.style.transform='translate(-50%, -50%)';
    handle.style.zIndex='5';handle.style.touchAction='none';
    handle.style.cursor=(corner==='nw'||corner==='se')?'nwse-resize':'nesw-resize';
  }
  function styleObjectSideHandle(handle,side,offset=0){
    handle.style.width=OBJECT_HANDLE_SIZE+'px';handle.style.height=OBJECT_HANDLE_SIZE+'px';
    handle.style.left=side==='w'?(-offset)+'px':side==='e'?'calc(100% + '+offset+'px)':'50%';
    handle.style.top=side==='n'?(-offset)+'px':side==='s'?'calc(100% + '+offset+'px)':'50%';
    handle.style.transform='translate(-50%, -50%)';
    handle.style.zIndex='5';handle.style.touchAction='none';
    handle.style.cursor=(side==='w'||side==='e')?'ew-resize':'ns-resize';
  }
  // Corner handles resize proportionally from the opposite corner.
  // Side handles are handled separately and change only one dimension.
  function proportionalCornerResize(o,corner,dx,dy,minW,minH){
    const west=corner.includes('w'),north=corner.includes('n');
    const anchorX=west?o.x+o.width:o.x,anchorY=north?o.y+o.height:o.y;
    const changeW=(west?-dx:dx)/o.width;
    const changeH=(north?-dy:dy)/o.height;
    const ratio=Math.max(minW/o.width,minH/o.height,
      Math.min(1+(Math.abs(changeW)>=Math.abs(changeH)?changeW:changeH),
        (west?anchorX:100-anchorX)/o.width,
        (north?anchorY:100-anchorY)/o.height));
    const width=o.width*ratio,height=o.height*ratio;
    return {x:west?anchorX-width:anchorX,y:north?anchorY-height:anchorY,width,height};
  }
  // Resize in the object's rotated local axes, then keep the opposite
  // corner/edge midpoint fixed in page coordinates (including rotation).
  function resizePointerDelta(dx,dy,angle,layer){
    const radians=-(angle||0)*Math.PI/180;
    const x=dx*layer.clientWidth,y=dy*layer.clientHeight;
    return {dx:(x*Math.cos(radians)-y*Math.sin(radians))/layer.clientWidth,
      dy:(x*Math.sin(radians)+y*Math.cos(radians))/layer.clientHeight};
  }
  function preserveRotatedResizeAnchor(original,updated,handle,layer){
    const angle=(original.angle||0)*Math.PI/180;
    if(!angle)return;
    const anchorX=handle.includes('w')?1:handle.includes('e')?0:.5;
    const anchorY=handle.includes('n')?1:handle.includes('s')?0:.5;
    const rotatedPoint=(box)=>{
      const cx=(box.x+box.width/2)*layer.clientWidth;
      const cy=(box.y+box.height/2)*layer.clientHeight;
      const vx=(anchorX-.5)*box.width*layer.clientWidth;
      const vy=(anchorY-.5)*box.height*layer.clientHeight;
      return {x:cx+vx*Math.cos(angle)-vy*Math.sin(angle),
        y:cy+vx*Math.sin(angle)+vy*Math.cos(angle)};
    };
    const before=rotatedPoint(original),after=rotatedPoint(updated);
    updated.x+=(before.x-after.x)/layer.clientWidth;
    updated.y+=(before.y-after.y)/layer.clientHeight;
  }
  function appendObjectDeleteButton(box,label,onDelete,offset=0){
    const b=document.createElement('button');b.type='button';
    b.className='position-absolute d-flex align-items-center justify-content-center bg-white border border-danger rounded-circle text-danger';
    b.style.cssText='width:24px;height:24px;top:50%;left:calc(100% + 18px);transform:translateY(-50%);z-index:20;cursor:pointer;touch-action:none;padding:0;pointer-events:auto';
    b.title='Delete '+label;b.setAttribute('aria-label','Delete '+label);
    b.innerHTML='<i class="bi bi-trash" style="font-size:13px;pointer-events:none"></i>';
    for(const name of ['pointerdown','mousedown','touchstart','dblclick'])b.addEventListener(name,e=>e.stopPropagation());
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();onDelete();});
    box.append(b);
  }
  function renderHighlights() {
    const layer = $('highlightLayer');
    layer.replaceChildren();
    layer.style.pointerEvents = activeDetailsTool === 'Highlight' ? 'auto' : 'none';
    for (const h of currentPage()?.highlights || []) {
      const el = document.createElement('div');
      el.className = 'position-absolute';
      el.dataset.highlightId = h.id;
      el.style.left = `${h.x}%`; el.style.top = `${h.y}%`;
      el.style.width = `${h.width}%`; el.style.height = `${h.height}%`;
      el.style.backgroundColor = h.color;
      el.style.backgroundColor = h.color;
      el.style.opacity = `${h.opacity / 100}`;
      el.style.cursor = 'move';
      el.style.transform = `rotate(${h.angle || 0}deg)`;
      el.style.transformOrigin = 'center center';
      el.style.touchAction = 'none';
      if (h.id === selectedHighlightId) {
        el.style.outline = '1px dashed #0d6efd';
        el.style.outlineOffset = '0px';
        for (const side of ['left','right']) {
          const handle = document.createElement('div');
          handle.dataset.resize = side;
          handle.className = 'position-absolute top-0 h-100 bg-primary';
          handle.style.width = '7px'; handle.style.cursor = 'crosshair';
          handle.style[side] = '-4px';
          handle.style.opacity = '1';
          el.append(handle);
        }
      }
      if(h.id===selectedHighlightId)appendObjectDeleteButton(el,'Highlight',()=>{recordPageEdit(currentPage());currentPage().highlights=currentPage().highlights.filter(v=>v.id!==h.id);selectedHighlightId=null;renderHighlightOptions();renderHighlights();updateButtons();});
      layer.append(el);
    }
  }
  function pointOnPage(e) {
    const r = $('highlightLayer').getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, (e.clientX-r.left)/r.width*100)),
      y: Math.max(0, Math.min(100, (e.clientY-r.top)/r.height*100))
    };
  }
  const highlightLayer = $('highlightLayer');
  highlightLayer.addEventListener('pointerdown', e => {
    if (activeDetailsTool !== 'Highlight' || busy || e.button !== 0) return;
    const page = currentPage(); if (!page) return;
    const pt = pointOnPage(e);
    const object = e.target.closest('[data-highlight-id]');
    let h, mode;
    if (object) {
      selectedHighlightId = object.dataset.highlightId;
      h = currentHighlight();
      mode = e.target.dataset.resize || 'move';
    } else {
      if (selectedHighlightId !== null) {
        // A click on blank page space clears the current selection.
        // The next drag may create a new highlight as usual.
        selectedHighlightId = null;
        renderHighlightOptions();
        renderHighlights();
        return;
      }
      recordPageEdit(page);
      h = { id: `highlight-${++highlightCounter}`, x: pt.x, y: Math.max(0,pt.y-highlightDefaults.height/2),
        width: 0.2, height: highlightDefaults.height, angle: 0, color: highlightDefaults.color, opacity: highlightDefaults.opacity };
      (page.highlights ||= []).push(h);
      selectedHighlightId = h.id;
      mode = 'create';
    }
    highlightGesture = { mode, id: h.id, pageId: page.id, start: pt, original: {...h}, recorded: mode === 'create', moved:false };
    highlightLayer.setPointerCapture(e.pointerId);
    e.preventDefault(); renderHighlightOptions(); renderHighlights();
  });
  highlightLayer.addEventListener('pointermove', e => {
    const g = highlightGesture;
    if (!g || g.pageId !== detailsId) return;
    const h = currentHighlight(); if (!h) return;
    const pt = pointOnPage(e);
    const dx = pt.x-g.start.x, dy = pt.y-g.start.y;
    if (!g.recorded && (Math.abs(dx)>0.1 || Math.abs(dy)>0.1)) {
      recordPageEdit(currentPage()); g.recorded = true;
    }
    if(g.mode==='create'){
      const r=highlightLayer.getBoundingClientRect();
      if(Math.hypot(dx*r.width/100,dy*r.height/100)>3)g.moved=true;
    }
    if (g.mode === 'create') {
      // The pointer-down position is the fixed first endpoint; the cursor
      // controls the second endpoint, including its angle during creation.
      // Work in rendered page pixels to account for non-square PDF pages.
      const bounds = highlightLayer.getBoundingClientRect();
      const px = bounds.width / 100, py = bounds.height / 100;
      const x1 = g.start.x * px, y1 = g.start.y * py;
      const x2 = pt.x * px, y2 = pt.y * py;
      const vx = x2 - x1, vy = y2 - y1;
      const length = Math.max(0.2 * px, Math.hypot(vx, vy));
      h.width = length / px;
      h.angle = Math.atan2(vy, vx) * 180 / Math.PI;
      h.x = (x1 + x2) / (2 * px) - h.width / 2;
      h.y = (y1 + y2) / (2 * py) - h.height / 2;
    } else if (g.mode === 'move') {
      h.x = Math.max(0,Math.min(100-h.width,g.original.x+dx));
      h.y = Math.max(0,Math.min(100-h.height,g.original.y+dy));
    } else if (g.mode === 'left' || g.mode === 'right') {
      // Rotate the highlight while resizing: the opposite endpoint is fixed.
      // Convert percent coordinates to actual page pixels so the angle is
      // geometrically correct even on pages with different aspect ratios.
      const bounds = highlightLayer.getBoundingClientRect();
      const px = bounds.width / 100, py = bounds.height / 100;
      const o = g.original;
      const a = (o.angle || 0) * Math.PI / 180;
      const cx = (o.x + o.width / 2) * px;
      const cy = (o.y + o.height / 2) * py;
      const half = o.width * px / 2;
      const dir = g.mode === 'right' ? 1 : -1;
      const fixedX = cx - dir * half * Math.cos(a);
      const fixedY = cy - dir * half * Math.sin(a);
      const dragX = pt.x * px, dragY = pt.y * py;
      const vx = (dragX - fixedX) * dir;
      const vy = (dragY - fixedY) * dir;
      const length = Math.max(0.2 * px, Math.hypot(vx, vy));
      const angle = Math.atan2(vy, vx);
      const midX = (fixedX + dragX) / 2;
      const midY = (fixedY + dragY) / 2;
      h.width = length / px;
      h.angle = angle * 180 / Math.PI;
      h.x = midX / px - h.width / 2;
      h.y = midY / py - h.height / 2;
    }
    renderHighlights(); updateButtons();
  });
  const CLICK_CREATE_SIZE_PX=100;
  function clickCreateDimensions(layer,x,y){
    const r=layer.getBoundingClientRect();
    return {width:Math.min(100-x,10000/Math.max(1,r.width)),height:Math.min(100-y,10000/Math.max(1,r.height))};
  }
  function endHighlightGesture(e) {
    if (!highlightGesture) return;
    const g=highlightGesture;
    if(e.type==='pointerup'&&g.mode==='create'&&!g.moved&&activeDetailsTool!=='Draw'){
      const h=(currentPage()?.highlights||[]).find(v=>v.id===g.id);
      if(h){
        const d=clickCreateDimensions(highlightLayer,g.start.x,g.start.y);
        // Click-only Highlight uses the configured height, not the 100px shape default.
        // Keep the same vertical centering as pointerdown and fit inside the page.
        const height=Math.max(0.2,Math.min(100,Number(g.original.height)||Number(highlightDefaults.height)||3));
        h.x=g.start.x;
        h.y=Math.max(0,Math.min(100-height,g.start.y-height/2));
        h.width=d.width;h.height=height;h.angle=0;
      }
    }
    highlightGesture = null;
    if (highlightLayer.hasPointerCapture(e.pointerId)) highlightLayer.releasePointerCapture(e.pointerId);
    renderHighlights();renderHighlightOptions();updateButtons();
  }
  highlightLayer.addEventListener('pointerup', endHighlightGesture);
  highlightLayer.addEventListener('pointercancel', endHighlightGesture);

  // Text objects belong to stable page IDs and use page-relative coordinates.
  const textLayer = $('textLayer');
  const currentText = () => (currentPage()?.texts || []).find(t => t.id === selectedTextId);
  function selectText(id) {
    selectedTextId = id;
    if (id) { activeDetailsTool = 'Text'; selectedHighlightId = null; }
    updateDetailsToolSelection(); renderHighlights(); renderTexts();
  }
  function textBackground(t) {
    const hex = (t.background || '#ffffff').replace('#', '');
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const alpha = Math.max(0, Math.min(100, Number(t.backgroundOpacity ?? 50))) / 100;
    return `rgba(${rgb.join(', ')}, ${alpha})`;
  }
  function applyTextAlignment(field,t){
    field.style.textAlign=t.alignH||'left';
    field.style.boxSizing='border-box';
    field.style.paddingTop='4px';
    const fontSize=parseFloat(getComputedStyle(field).fontSize)||18;
    const lineHeight=fontSize*1.25;
    const width=Math.max(1,field.clientWidth-8);
    const measure=document.createElement('canvas').getContext('2d');
    measure.font=fontSize+'px '+(t.font||'Arial');
    let lines=0;
    for(const line of String(t.content||'').split('\n')){
      let segment='',count=1;
      for(const word of line.split(/(\s+)/)){
        if(segment&&measure.measureText(segment+word).width>width){count++;segment='';}
        segment+=word;
      }
      lines+=count;
    }
    const spare=Math.max(0,field.clientHeight-8-lines*lineHeight);
    field.style.paddingTop=(4+(t.alignV==='middle'?spare/2:t.alignV==='bottom'?spare:0))+'px';
  }
  // Update the selected text in place to preserve focus and caret position.
  function refreshTextAppearance() {
    const obj = currentText();
    if (!obj) return;
    const box = [...textLayer.querySelectorAll('[data-text-id]')].find(el => el.dataset.textId === obj.id);
    const field = box?.querySelector('textarea');
    if (!field) return;
    field.style.color = obj.color;
    field.style.backgroundColor = textBackground(obj);
    field.style.fontFamily = obj.font;
    field.style.fontSize = `${obj.size * ($('detailsPaper').clientWidth || 1) / 600}px`;
    applyTextAlignment(field,obj);
  }
  function renderTextOptions() {
    if (activeDetailsTool !== 'Text') return;
    const content = $('pageDetailsToolOptionsContent'); content.replaceChildren();
    const obj = currentText(), settings = obj || textDefaults;
    const control = (labelText, type, key, choices) => {
      const group = document.createElement('div'); group.className = 'd-flex align-items-center gap-2 flex-wrap';
      const label = document.createElement('label'); label.className = 'form-label small mb-0';
      label.textContent = labelText;
      const input = type === 'select' ? document.createElement('select') : document.createElement('input');
      input.id = `textOption_${key}`; label.htmlFor = input.id;
      input.className = type === 'select' ? 'form-select form-select-sm w-auto' : type === 'color' ? 'form-control form-control-color form-control-sm' : 'form-control form-control-sm';
      if (type === 'select') {
        for (const font of choices) { const option = document.createElement('option'); option.value = font; option.textContent = font; input.append(option); }
      } else { input.type = type; if (type === 'range') { input.min='1';input.max='100';input.step='1';input.className='form-range mb-0';input.style.width='110px'; } }
      input.value = settings[key];
      const value=type==='range'?document.createElement('output'):null;
      if(value){value.className='small text-body-secondary text-start flex-shrink-0';value.style.width='5ch';value.style.fontVariantNumeric='tabular-nums';value.textContent=input.value+'px';}
      let saved=false;
      const commit = () => {
        if (obj && !saved) {recordPageEdit(currentPage());saved=true;}
        (obj || textDefaults)[key] = key === 'size' ? Math.max(1,Math.min(100,Number(input.value)||1)) : input.value;
        if(value)value.textContent=input.value+'px';
        refreshTextAppearance(); updateButtons();
      };
      if(type==='range'){input.addEventListener('input',commit);input.addEventListener('change',()=>{saved=false;});}
      else {input.addEventListener('change',commit);if(type==='color')input.addEventListener('input',commit);}
      group.append(label,input);if(value)group.append(value);content.append(group);
    };
    control('Font','select','font',['Arial','Helvetica','Times New Roman','Georgia','Courier New','Verdana','Tahoma']);
    control('Size','range','size');
    control('Font Color','color','color');
    control('Background Color','color','background');
    {
      const group = document.createElement('div');
      group.className = 'd-flex align-items-center gap-2 flex-wrap';
      const label = document.createElement('label');
      label.className = 'form-label small mb-0'; label.htmlFor = 'textOption_backgroundOpacity';
      label.textContent = 'Background Opacity';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.id = 'textOption_backgroundOpacity';
      slider.className = 'form-range mb-0'; slider.min = '0'; slider.max = '100'; slider.step = '5';
      slider.value = settings.backgroundOpacity ?? 50;
      slider.style.width = '110px';
      const value = document.createElement('output');
      value.className = 'small text-body-secondary text-start flex-shrink-0';
      value.style.width = '5ch'; value.style.fontVariantNumeric = 'tabular-nums';
      value.textContent = `${slider.value}%`;
      let saved = false;
      slider.addEventListener('input', () => {
        if (obj && !saved) { recordPageEdit(currentPage()); saved = true; }
        (obj || textDefaults).backgroundOpacity = Number(slider.value);
        value.textContent = `${slider.value}%`;
        refreshTextAppearance(); updateButtons();
      });
      slider.addEventListener('change', () => { saved = false; });
      group.append(label, slider, value); content.append(group);
    }
    {
      const group=document.createElement('div');
      group.className='d-flex align-items-center flex-wrap gap-2';
      const label=document.createElement('span');label.className='small text-secondary';label.textContent='Align';
      const buttons=document.createElement('div');buttons.className='btn-group btn-group-sm';buttons.setAttribute('role','group');buttons.setAttribute('aria-label','Text alignment');
      const choices=[
        ['alignH','left','text-left','Left'],['alignH','center','text-center','Center horizontally'],['alignH','right','text-right','Right'],
        ['alignV','top','align-top','Top'],['alignV','middle','align-middle','Middle vertically'],['alignV','bottom','align-bottom','Bottom']
      ];
      for(const [key,value,icon,title] of choices){
        const button=document.createElement('button');button.type='button';
        button.className='btn '+((settings[key]||(key==='alignH'?'left':'top'))===value?'btn-primary':'btn-outline-primary');
        button.title=title;button.setAttribute('aria-label',title);
        button.innerHTML='<i class="bi bi-'+icon+'"></i>';
        button.addEventListener('click',()=>{
          if(obj)recordPageEdit(currentPage());
          (obj||textDefaults)[key]=value;
          refreshTextAppearance();renderTextOptions();updateButtons();
        });
        buttons.append(button);
      }
      group.append(label,buttons);content.append(group);
    }
    const hint=document.createElement('span'); hint.className='small text-secondary w-100';
    hint.textContent='Click the page to add text. Edit the text, or drag its box to move it.'; content.append(hint);
  }
  function renderTexts() {
    textLayer.replaceChildren();
    textLayer.style.pointerEvents = activeDetailsTool === 'Text' ? 'auto' : 'none';
    const paperWidth = $('detailsPaper').clientWidth || 1;
    for (const t of currentPage()?.texts || []) {
      const box = document.createElement('div');
      box.className='position-absolute'; box.dataset.textId=t.id;
      box.style.left=`${t.x}%`; box.style.top=`${t.y}%`;
      box.style.width=`${t.width}%`; box.style.height=`${t.height}%`;
      box.style.minWidth='35px'; box.style.minHeight='24px';
      box.style.border='1px solid transparent';
      if(t.id===selectedTextId){box.style.outline='1px dashed #0d6efd';box.style.outlineOffset='0px';}
      box.style.boxSizing='border-box';
      box.style.transform=`rotate(${t.angle||0}deg)`;
      box.style.transformOrigin='center center';
      box.style.pointerEvents=activeDetailsTool==='Text'?'auto':'none';
      const bar=document.createElement('div');
      bar.className='position-absolute top-0 start-0 w-100';
      bar.style.height='10px'; bar.style.cursor='move'; bar.style.zIndex='2';
      bar.dataset.textDrag=t.id;
      const textarea=document.createElement('textarea');
      textarea.className='w-100 h-100 border-0 rounded-0';
      textarea.style.padding='4px';
      textarea.value=t.content;
      textarea.setAttribute('aria-label','Edit PDF page text');
      textarea.style.fontFamily=t.font; textarea.style.fontSize=`${t.size * paperWidth/600}px`;
      textarea.style.color=t.color; textarea.style.backgroundColor=textBackground(t);
      // Rotate the container so its selection outline and handles follow the text.
      textarea.style.resize='none'; textarea.style.outline='none';
      textarea.style.lineHeight='1.25';
      applyTextAlignment(textarea,t);
      textarea.style.overflow='auto'; textarea.style.pointerEvents=activeDetailsTool==='Text'?'auto':'none';
      textarea.addEventListener('pointerdown',e=>{
        e.stopPropagation();
        if (selectedTextId!==t.id) { selectText(t.id); }
      });
      let typed=false;
      textarea.addEventListener('input',()=>{
        if (!typed) { recordPageEdit(currentPage()); typed=true; }
        t.content=textarea.value;applyTextAlignment(textarea,t); updateButtons();
      });
      textarea.addEventListener('blur',()=>{typed=false;});
      box.append(textarea,bar);
      if(t.id===selectedTextId){
        for(const corner of ['nw','ne','sw','se','n','e','s','w']){
          const handle=document.createElement('div');
          handle.className='position-absolute bg-primary';
          handle.dataset.textResize=t.id;
          handle.dataset.corner=corner;
          corner.length===1?styleObjectSideHandle(handle,corner):styleObjectCornerHandle(handle,corner);
          box.append(handle);
        }
      }
      if(t.id===selectedTextId){
        const rotateStem=document.createElement('div');rotateStem.className='position-absolute bg-primary';
        rotateStem.style.width='2px';rotateStem.style.height='22px';rotateStem.style.left='calc(50% - 1px)';rotateStem.style.bottom='100%';
        rotateStem.style.pointerEvents='none';box.append(rotateStem);
        const rotateHandle=document.createElement('div');rotateHandle.dataset.textRotate=t.id;
        rotateHandle.className='position-absolute bg-white border border-primary border-2 rounded-circle d-flex align-items-center justify-content-center';
        rotateHandle.style.width='22px';rotateHandle.style.height='22px';rotateHandle.style.left='calc(50% - 11px)';
        rotateHandle.style.bottom='calc(100% + 22px)';rotateHandle.style.cursor='grab';rotateHandle.style.touchAction='none';
        rotateHandle.style.zIndex='6';rotateHandle.title='Drag to rotate text';
        rotateHandle.innerHTML='<i class="bi bi-arrow-clockwise text-primary" style="font-size:12px;pointer-events:none"></i>';
        box.append(rotateHandle);
      }
      if(t.id===selectedTextId)appendObjectDeleteButton(box,'Text',()=>{recordPageEdit(currentPage());currentPage().texts=currentPage().texts.filter(v=>v.id!==t.id);selectedTextId=null;renderTextOptions();renderTexts();updateButtons();});
      textLayer.append(box);
      applyTextAlignment(textarea,t);
    }
  }
  function textPoint(e) {
    const r=textLayer.getBoundingClientRect();
    return {x:Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),
      y:Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))};
  }
  textLayer.addEventListener('pointerdown',e=>{
    if(activeDetailsTool!=='Text'||busy||e.button!==0)return;
    const hit=e.target.closest('[data-text-id]');
    if(!hit){
      if(selectedTextId){selectText(null);return;}
      const page=currentPage(); if(!page)return;
      const p=textPoint(e); recordPageEdit(page);
      const bounds=textLayer.getBoundingClientRect();
      const width=Math.min(100,200/Math.max(1,bounds.width)*100);
      const height=Math.min(100,100/Math.max(1,bounds.height)*100);
      const t={id:`text-${++textCounter}`,x:Math.min(p.x,100-width),y:Math.min(p.y,100-height),
        width,height,content:'Text',...textDefaults};
      (page.texts ||= []).push(t); selectText(t.id); updateButtons();
      const field=textLayer.querySelector(`[data-text-id="${t.id}"] textarea`);
      if(field){field.focus();field.select();}
      return;
    }
    const t=currentText();
    if(selectedTextId!==hit.dataset.textId){selectText(hit.dataset.textId);return;}
    const resize=e.target.closest('[data-text-resize]');
    const drag=e.target.closest('[data-text-drag]');
    const rotate=e.target.closest('[data-text-rotate]');
    if(!resize&&!drag&&!rotate)return;
    const rect=hit.getBoundingClientRect();
    const centerX=rect.left+rect.width/2,centerY=rect.top+rect.height/2;
    const startAngle=Math.atan2(e.clientY-centerY,e.clientX-centerX)*180/Math.PI;
    textGesture={pageId:detailsId,id:t.id,mode:rotate?'rotate':resize?'resize':'move',start:textPoint(e),original:{...t},saved:false,centerX,centerY,startAngle,corner:resize?.dataset.corner||'se'};
    textLayer.setPointerCapture(e.pointerId); e.preventDefault();
  });
  textLayer.addEventListener('pointermove',e=>{
    const g=textGesture;if(!g||g.pageId!==detailsId)return;
    const t=currentText();if(!t)return;
    const p=textPoint(e),dx=p.x-g.start.x,dy=p.y-g.start.y;
    if(g.mode==='rotate'){
      const pointerAngle=Math.atan2(e.clientY-g.centerY,e.clientX-g.centerX)*180/Math.PI;
      let delta=pointerAngle-g.startAngle;
      delta=((delta+180)%360+360)%360-180;
      if(!g.saved&&Math.abs(delta)>0.25){recordPageEdit(currentPage());g.saved=true;}
      if(!g.saved)return;
      t.angle=(g.original.angle||0)+delta;
      renderTexts();updateButtons();return;
    }
    if(!g.saved&&(Math.abs(dx)>0.1||Math.abs(dy)>0.1)){
      recordPageEdit(currentPage());g.saved=true;
    }
    if(g.mode==='move'){
      t.x=Math.max(0,Math.min(100-t.width,g.original.x+dx));
      t.y=Math.max(0,Math.min(100-t.height,g.original.y+dy));
    }else{
      const c=g.corner,o=g.original;
      const local=resizePointerDelta(dx,dy,o.angle,textLayer);
      const localDx=local.dx,localDy=local.dy;
      if(c.length>1){
        Object.assign(t,proportionalCornerResize(o,c,localDx,localDy,5,3));
      }else{
      const right=o.x+o.width,bottom=o.y+o.height;
      if(c.includes('w')){t.x=Math.max(0,Math.min(right-5,o.x+localDx));t.width=right-t.x;}
      else if(c.includes('e')){t.x=o.x;t.width=Math.max(5,Math.min(100-o.x,o.width+localDx));}
      if(c.includes('n')){t.y=Math.max(0,Math.min(bottom-3,o.y+localDy));t.height=bottom-t.y;}
      else if(c.includes('s')){t.y=o.y;t.height=Math.max(3,Math.min(100-o.y,o.height+localDy));}
      }
      preserveRotatedResizeAnchor(o,t,c,textLayer);
    }
    renderTexts();updateButtons();
  });
  const finishText=e=>{
    if(!textGesture)return;textGesture=null;
    if(textLayer.hasPointerCapture(e.pointerId))textLayer.releasePointerCapture(e.pointerId);
  };
  textLayer.addEventListener('pointerup',finishText);
  textLayer.addEventListener('pointercancel',finishText);


  // Shape geometry is page-relative; stroke widths are stored in PDF points.
  // Convert points to screen pixels only while rendering the current zoom.
  const shapeLayer = $('shapeLayer');
  const shapeStrokePixels = item => Math.max(0,Number(item.strokeWidth)||0)*shapeLayer.clientWidth/Math.max(1,detailsPageWidthPt);
  const shapeTools = ['Line', 'Draw', 'Rectangle', 'Ellipse'];
  const currentShape = () => (currentPage()?.shapes || []).find(v => v.id === selectedShapeId && v.type === activeDetailsTool);
  function selectShape(id) {
    selectedShapeId = id;
    const item = currentShape();
    if (item) {
      activeDetailsTool = item.type;
      selectedHighlightId = null; selectedTextId = null; selectedImageId = null;
    }
    updateDetailsToolSelection(); renderHighlights(); renderTexts(); renderImages(); renderShapes();
  }
  function shapePoint(e) {
    const r = shapeLayer.getBoundingClientRect();
    return { x: Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),
      y: Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100)) };
  }
  function renderShapeOptions() {
    if (!shapeTools.includes(activeDetailsTool)) return;
    const content = $('pageDetailsToolOptionsContent'); content.replaceChildren();
    const obj = currentShape(), options = obj || currentShapeDefaults();
    function option(label, type, key, min, max, step) {
      const group = document.createElement('div'); group.className='d-flex align-items-center gap-2';
      const name = document.createElement('label'); name.className='form-label small mb-0 text-nowrap';
      const input = document.createElement('input'); input.id='shapeOption_'+key;
      name.htmlFor=input.id; name.textContent=label;
      input.type=type; input.value=options[key];
      input.className=type==='color'?'form-control form-control-color form-control-sm': 'form-range';
      if(type==='range') {input.min=min;input.max=max;input.step=step;input.style.width='110px';}
      const output=document.createElement('output'); output.className='small text-secondary text-start font-monospace';
      output.style.width='5ch'; output.textContent=type==='range'?String(options[key])+(key==='strokeWidth'?'pt':'%'):'';
      let saved=false;
      input.addEventListener('input',()=>{
        if(obj&&!saved){recordPageEdit(currentPage());saved=true;}
        (obj||currentShapeDefaults())[key]=type==='range'?Number(input.value):input.value;
        if(type==='range')output.textContent=input.value+(key==='strokeWidth'?'pt':'%');
        renderShapes();updateButtons();
      });
      group.append(name,input,output);content.append(group);
    }
    option('Line Width','range','strokeWidth',0,20,1);
    option('Line Color','color','stroke');
    option(['Line','Draw'].includes(activeDetailsTool)?'Opacity':'Line Opacity','range','opacity',0,100,5);
    if(!['Line','Draw'].includes(activeDetailsTool)) {
      option('Fill Color','color','fill');
      option('Fill Opacity','range','fillOpacity',0,100,5);
    }
    if(activeDetailsTool==='Rectangle' || activeDetailsTool==='Ellipse') {
      const isCircle=activeDetailsTool==='Ellipse';
      const key=isCircle?'circle':'square';
      const group=document.createElement('div');group.className='d-flex align-items-center gap-2';
      const input=document.createElement('input');input.type='checkbox';input.className='form-check-input mt-0';input.id='shapeOption_'+key;
      input.checked=!!options[key];
      const label=document.createElement('label');label.className='form-check-label small text-nowrap';label.htmlFor=input.id;label.textContent=isCircle?'Circle':'Square';
      input.addEventListener('change',()=>{
        if(obj){
          recordPageEdit(currentPage());obj[key]=input.checked;
          if(obj[key]){
            const r=shapeLayer.getBoundingClientRect();
            obj.height=Math.max(.2,Math.min(100-obj.y,obj.width*r.width/Math.max(1,r.height)));
          }
          renderShapes();updateButtons();
        }else currentShapeDefaults()[key]=input.checked;
      });
      group.append(input,label);content.append(group);
    }
    const hint=document.createElement('div');hint.className='w-100 small text-secondary';
    hint.textContent=activeDetailsTool==='Line'
      ?'Drag to draw a line. Drag an endpoint to resize, or drag the line to move.'
      :activeDetailsTool==='Draw'
      ?'Drag on the page to draw freely. Drag a stroke to move it.'
      :'Drag to draw a '+activeDetailsTool.toLowerCase()+'. Drag the object to move it, or drag its handles to resize.';
    content.append(hint);
  }
  function renderShapes() {
    shapeLayer.replaceChildren();
    shapeLayer.style.pointerEvents=shapeTools.includes(activeDetailsTool)?'auto':'none';
    const NS='http://www.w3.org/2000/svg';
    for(const item of currentPage()?.shapes||[]) {
      if(item.type==='Draw'){
        const box=document.createElement('div');box.className='position-absolute';
        box.dataset.shapeId=item.id;
        box.style.cssText='left:'+item.x+'%;top:'+item.y+'%;width:'+Math.max(.2,item.width)+'%;height:'+Math.max(.2,item.height)+'%;overflow:visible;touch-action:none;cursor:move;transform:rotate('+(item.angle||0)+'deg)';
        box.style.pointerEvents=activeDetailsTool==='Draw'?'auto':'none';
        const svg=document.createElementNS(NS,'svg');
        svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');
        svg.style.cssText='width:100%;height:100%;overflow:visible;pointer-events:none';
        const stroke=document.createElementNS(NS,'polyline');
        stroke.setAttribute('points',(item.points||[]).map(p=>((p.x-item.x)/Math.max(.2,item.width)*100)+','+((p.y-item.y)/Math.max(.2,item.height)*100)).join(' '));
        stroke.setAttribute('fill','none');stroke.setAttribute('stroke',item.stroke);
        stroke.setAttribute('stroke-opacity',item.opacity/100);
        stroke.setAttribute('stroke-width',shapeStrokePixels(item));
        stroke.setAttribute('stroke-linecap','round');stroke.setAttribute('stroke-linejoin','round');
        stroke.setAttribute('vector-effect','non-scaling-stroke');
        stroke.style.pointerEvents=activeDetailsTool==='Draw'?'stroke':'none';
        svg.append(stroke);box.append(svg);
        if(item.id===selectedShapeId&&activeDetailsTool==='Draw'){
          box.style.outline='1px dashed #0d6efd';
          for(const corner of ['nw','ne','sw','se','n','e','s','w']){
            const handle=document.createElement('div');
            handle.dataset.shapeHandle=corner;handle.className='position-absolute bg-primary';
            corner.length===1?styleObjectSideHandle(handle,corner):styleObjectCornerHandle(handle,corner);
            box.append(handle);
          }
          const stem=document.createElement('div');stem.className='position-absolute bg-primary';
          stem.style.cssText='width:2px;height:22px;left:calc(50% - 1px);bottom:100%;pointer-events:none';box.append(stem);
          const rotate=document.createElement('div');rotate.dataset.shapeHandle='rotate';
          rotate.className='position-absolute bg-white border border-primary border-2 rounded-circle d-flex align-items-center justify-content-center';
          rotate.style.cssText='width:22px;height:22px;left:calc(50% - 11px);bottom:calc(100% + 22px);cursor:grab;touch-action:none;z-index:6';
          rotate.title='Drag to rotate draw';rotate.innerHTML='<i class="bi bi-arrow-clockwise text-primary" style="font-size:12px;pointer-events:none"></i>';
          box.append(rotate);
          appendObjectDeleteButton(box,'Draw',()=>{
            recordPageEdit(currentPage());
            currentPage().shapes=currentPage().shapes.filter(v=>v.id!==item.id);
            selectedShapeId=null;renderShapeOptions();renderShapes();updateButtons();
          });
        }
        shapeLayer.append(box);continue;
      }
      const box=document.createElement('div');
      box.className='position-absolute';box.dataset.shapeId=item.id;
      // Other shape types remain visible but cannot be selected or edited by this tool.
      box.style.pointerEvents = item.type === activeDetailsTool ? 'auto' : 'none';
      box.style.left=item.x+'%';box.style.top=item.y+'%';
      box.style.width=item.type==='Line'&&item.width===0?'1px':Math.max(.2,item.width)+'%';box.style.height=item.type==='Line'&&item.height===0?'1px':Math.max(.2,item.height)+'%';
      box.style.cursor='move';box.style.touchAction='none';
      if(item.type==='Rectangle'||item.type==='Ellipse')box.style.transform=`rotate(${item.angle||0}deg)`;
      const svg=document.createElementNS(NS,'svg');
      svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');
      svg.style.width='100%';svg.style.height='100%';svg.style.display='block';svg.style.overflow='visible';box.style.overflow='visible';
      let figure;
      if(item.type==='Line') {
        figure=document.createElementNS(NS,'line');
        figure.setAttribute('x1',item.width===0?'50':item.reverseX?'100':'0');
        figure.setAttribute('y1',item.height===0?'50':item.reverseY?'100':'0');
        figure.setAttribute('x2',item.width===0?'50':item.reverseX?'0':'100');
        figure.setAttribute('y2',item.height===0?'50':item.reverseY?'0':'100');
      } else if(item.type==='Rectangle') {
        figure=document.createElementNS(NS,'rect');
        figure.setAttribute('x','0');figure.setAttribute('y','0');
        figure.setAttribute('width','100');figure.setAttribute('height','100');
      } else {
        figure=document.createElementNS(NS,'ellipse');
        figure.setAttribute('cx','50');figure.setAttribute('cy','50');
        figure.setAttribute('rx','50');figure.setAttribute('ry','50');
      }
      figure.setAttribute('stroke',item.stroke);
      figure.setAttribute('stroke-opacity',item.opacity/100);
      figure.setAttribute('fill',item.type==='Line'?'none':item.fill);
      figure.setAttribute('fill-opacity',item.type==='Line'?0:item.fillOpacity/100);
      figure.setAttribute('vector-effect','non-scaling-stroke');
      figure.setAttribute('stroke-width',shapeStrokePixels(item)*(item.type==='Line'?1:2));
      if(item.type!=='Line') {
        // Paint the entire stroke behind the fill: only the outward half remains.
        figure.setAttribute('paint-order','stroke fill');
        // Mask the inward half even when the fill is transparent.
        const mask=document.createElementNS(NS,'mask');
        const maskId='shape-outer-'+item.id.replace(/[^a-zA-Z0-9_-]/g,'_');
        mask.id=maskId;mask.setAttribute('maskUnits','userSpaceOnUse');
        mask.setAttribute('x','-100');mask.setAttribute('y','-100');
        mask.setAttribute('width','300');mask.setAttribute('height','300');
        const white=document.createElementNS(NS,'rect');
        white.setAttribute('x','-100');white.setAttribute('y','-100');
        white.setAttribute('width','300');white.setAttribute('height','300');white.setAttribute('fill','white');
        const cut=figure.cloneNode(false);
        cut.removeAttribute('stroke');cut.setAttribute('fill','black');cut.removeAttribute('fill-opacity');
        mask.append(white,cut);
        const defs=document.createElementNS(NS,'defs');defs.append(mask);svg.append(defs);
        const outside=figure.cloneNode(false);
        outside.setAttribute('fill','none');outside.setAttribute('mask','url(#'+maskId+')');
        const fill=figure.cloneNode(false);fill.setAttribute('stroke','none');
        svg.append(outside,fill);
      } else svg.append(figure);
      box.append(svg);
      if(item.id===selectedShapeId && item.type===activeDetailsTool) {
        if(item.type!=='Line')box.style.outline='1px dashed #0d6efd';
        if(item.type==='Rectangle'||item.type==='Ellipse') box.style.outlineOffset=shapeStrokePixels(item)+'px';
        for(const corner of (item.type==='Line' ? ['line-start','line-end'] : ['nw','ne','sw','se','n','e','s','w'])) {
          const handle=document.createElement('div');handle.dataset.shapeHandle=corner;
          handle.className=item.type==='Line'?'position-absolute bg-primary border border-white rounded-circle':'position-absolute bg-primary';
          handle.style.width='12px';handle.style.height='12px';
          if(item.type==='Line') {
            const atStart=corner==='line-start';
            handle.style.top=item.height===0?'calc(50% - 6px)':atStart?(item.reverseY?'calc(100% - 6px)':'-6px'):(item.reverseY?'-6px':'calc(100% - 6px)');
            handle.style.left=item.width===0?'calc(50% - 6px)':atStart?(item.reverseX?'calc(100% - 6px)':'-6px'):(item.reverseX?'-6px':'calc(100% - 6px)');
            handle.style.cursor='crosshair';
          } else {
            corner.length===1?styleObjectSideHandle(handle,corner,shapeStrokePixels(item)):styleObjectCornerHandle(handle,corner,shapeStrokePixels(item));
          }
          box.append(handle);
        }
      }
      if((item.type==='Rectangle'||item.type==='Ellipse') && item.id===selectedShapeId && item.type===activeDetailsTool){
        const stem=document.createElement('div');stem.className='position-absolute bg-primary';
        stem.style.cssText='width:2px;height:22px;left:calc(50% - 1px);bottom:100%;pointer-events:none';box.append(stem);
        const rotate=document.createElement('div');rotate.dataset.shapeHandle='rotate';
        rotate.className='position-absolute bg-white border border-primary border-2 rounded-circle d-flex align-items-center justify-content-center';
        rotate.style.cssText='width:22px;height:22px;left:calc(50% - 11px);bottom:calc(100% + 22px);cursor:grab;touch-action:none;z-index:6';
        rotate.title='Drag to rotate '+item.type.toLowerCase();rotate.innerHTML='<i class="bi bi-arrow-clockwise text-primary" style="font-size:12px;pointer-events:none"></i>';
        box.append(rotate);
      }
      if(item.id===selectedShapeId&&item.type===activeDetailsTool){
        const deleteShape=()=>{recordPageEdit(currentPage());currentPage().shapes=currentPage().shapes.filter(v=>v.id!==item.id);selectedShapeId=null;renderShapeOptions();renderShapes();updateButtons();};
        if(item.type==='Line'){
          // Keep Delete anchored to the line-end handle, even when the line
          // crosses horizontal or vertical axes. Never choose an endpoint
          // based on which one is currently farther right.
          const width=shapeLayer.clientWidth*item.width/100;
          const height=shapeLayer.clientHeight*item.height/100;
          const dx=item.reverseX?-width:width;
          const dy=item.reverseY?-height:height;
          const angle=Math.atan2(dy,dx)*180/Math.PI;
          const anchor=document.createElement('div');
          anchor.className='position-absolute';
          anchor.style.cssText='left:'+(item.width===0?'50%':item.reverseX?'0':'100%')+
            ';top:'+(item.height===0?'50%':item.reverseY?'0':'100%')+
            ';width:0;height:0;transform:rotate('+angle+'deg)';
          appendObjectDeleteButton(anchor,'Line',deleteShape);
          const button=anchor.querySelector('button');
          button.style.left='18px';
          button.style.top='-12px';
          button.style.transform='none';
          box.append(anchor);
        }else appendObjectDeleteButton(box,item.type,deleteShape,shapeStrokePixels(item));
      }
      shapeLayer.append(box);
    }
  }
  shapeLayer.addEventListener('pointerdown',e=>{
    if(!shapeTools.includes(activeDetailsTool)||busy||e.button!==0)return;
    const page=currentPage();if(!page)return;
    const p=shapePoint(e),candidate=e.target.closest('[data-shape-id]');
    const hit=candidate && (page.shapes||[]).some(v=>v.id===candidate.dataset.shapeId && v.type===activeDetailsTool) ? candidate : null;
    let item,mode;
    if(hit){
      selectedShapeId=hit.dataset.shapeId;item=currentShape();
      mode=e.target.closest('[data-shape-handle]')?.dataset.shapeHandle||'move';
      if(item.type==='Draw'&&mode==='move'&&!drawHit(item,e.clientX,e.clientY)){
        selectedShapeId=null;renderShapeOptions();renderShapes();return;
      }
    } else if(selectedShapeId){
      selectedShapeId=null;renderShapeOptions();renderShapes();return;
    } else {
      recordPageEdit(page);
      item={id:'shape-'+(++shapeCounter),type:activeDetailsTool,x:p.x,y:p.y,width:.2,height:.2,
        reverseX:false,reverseY:false,...currentShapeDefaults()};
      if(activeDetailsTool==='Draw'){item.points=[{x:p.x,y:p.y}];item.angle=0;}
      (page.shapes ||= []).push(item);selectedShapeId=item.id;mode='create';
    }
    const bounds=hit?.getBoundingClientRect();
    const centerX=bounds?bounds.left+bounds.width/2:0,centerY=bounds?bounds.top+bounds.height/2:0;
    shapeGesture={id:item.id,pageId:page.id,mode,start:p,original:{...item,...(item.points?{points:item.points.map(v=>({...v}))}:{})},saved:mode==='create',
      centerX,centerY,startAngle:Math.atan2(e.clientY-centerY,e.clientX-centerX)*180/Math.PI,moved:false};
    shapeLayer.setPointerCapture(e.pointerId);e.preventDefault();
    renderShapeOptions();renderShapes();updateButtons();
  });
  shapeLayer.addEventListener('pointermove',e=>{
    const g=shapeGesture;if(!g||g.pageId!==detailsId)return;
    const item=currentShape();if(!item)return;
    const p=shapePoint(e),dx=p.x-g.start.x,dy=p.y-g.start.y;
    if(!g.saved&&(Math.abs(dx)>.1||Math.abs(dy)>.1)){
      recordPageEdit(currentPage());g.saved=true;
    }
    if(g.mode==='rotate' && (item.type==='Rectangle'||item.type==='Ellipse'||item.type==='Draw')){
      const a=Math.atan2(e.clientY-g.centerY,e.clientX-g.centerX)*180/Math.PI;
      let delta=a-g.startAngle;delta=((delta+180)%360+360)%360-180;
      item.angle=(g.original.angle||0)+delta;
      renderShapes();updateButtons();return;
    }
    if(g.mode==='create'&&item.type==='Draw'){
      const points=item.points;
      const last=points[points.length-1];
      if(Math.hypot((p.x-last.x)*shapeLayer.clientWidth/100,(p.y-last.y)*shapeLayer.clientHeight/100)>=1){
        points.push({x:p.x,y:p.y});Object.assign(item,drawBounds(points));g.moved=true;
      }
    }else if(g.mode==='create'){
      const r=shapeLayer.getBoundingClientRect();
      if(Math.hypot(dx*r.width/100,dy*r.height/100)>3)g.moved=true;
      item.x=Math.min(g.start.x,p.x);item.y=Math.min(g.start.y,p.y);
      item.width=item.type==='Line'?Math.abs(p.x-g.start.x):Math.max(.2,Math.abs(p.x-g.start.x));item.height=item.type==='Line'?Math.abs(p.y-g.start.y):Math.max(.2,Math.abs(p.y-g.start.y));
      if((item.type==='Rectangle'&&item.square)||(item.type==='Ellipse'&&item.circle)){
        const r=shapeLayer.getBoundingClientRect(),factor=r.width/Math.max(1,r.height);
        item.height=Math.max(.2,Math.min(100-item.y,item.width*factor));
      }
      item.reverseX=p.x<g.start.x;item.reverseY=p.y<g.start.y;
    }else if(g.mode==='move'&&item.type==='Draw'){
      const points=g.original.points||[];
      const minX=Math.min(...points.map(v=>v.x)),maxX=Math.max(...points.map(v=>v.x));
      const minY=Math.min(...points.map(v=>v.y)),maxY=Math.max(...points.map(v=>v.y));
      const shiftX=Math.max(-minX,Math.min(100-maxX,dx));
      const shiftY=Math.max(-minY,Math.min(100-maxY,dy));
      item.points=points.map(v=>({x:v.x+shiftX,y:v.y+shiftY}));
      Object.assign(item,drawBounds(item.points));
    }else if(g.mode==='move'){
      item.x=Math.max(0,Math.min(100-item.width,g.original.x+dx));
      item.y=Math.max(0,Math.min(100-item.height,g.original.y+dy));
    }else if(item.type==='Line'){
      // Each circular endpoint handle pivots the line around the opposite endpoint.
      const o=g.original;
      const startX=o.x+(o.reverseX?o.width:0),startY=o.y+(o.reverseY?o.height:0);
      const finishX=o.x+(o.reverseX?0:o.width),finishY=o.y+(o.reverseY?0:o.height);
      const clamp=v=>Math.max(0,Math.min(100,v));
      const sx=g.mode==='line-start'?clamp(startX+dx):startX;
      const sy=g.mode==='line-start'?clamp(startY+dy):startY;
      const ex=g.mode==='line-end'?clamp(finishX+dx):finishX;
      const ey=g.mode==='line-end'?clamp(finishY+dy):finishY;
      item.x=Math.min(sx,ex);item.y=Math.min(sy,ey);
      item.width=Math.abs(ex-sx);item.height=Math.abs(ey-sy);
      item.reverseX=ex<sx;item.reverseY=ey<sy;
    }else if(item.type==='Draw'){
      const o=g.original,local=resizePointerDelta(dx,dy,o.angle,shapeLayer);
      let next;
      if(g.mode.length>1)next=proportionalCornerResize(o,g.mode,local.dx,local.dy,.2,.2);
      else{
        const left=g.mode==='w'?o.x+local.dx:o.x,top=g.mode==='n'?o.y+local.dy:o.y;
        const right=g.mode==='e'?o.x+o.width+local.dx:o.x+o.width;
        const bottom=g.mode==='s'?o.y+o.height+local.dy:o.y+o.height;
        next={x:Math.min(left,right),y:Math.min(top,bottom),width:Math.max(.2,Math.abs(right-left)),height:Math.max(.2,Math.abs(bottom-top))};
      }
      preserveRotatedResizeAnchor(o,next,g.mode,shapeLayer);
      Object.assign(item,next);
      item.points=(o.points||[]).map(p=>({
        x:next.x+(p.x-o.x)/Math.max(.2,o.width)*next.width,
        y:next.y+(p.y-o.y)/Math.max(.2,o.height)*next.height
      }));
    }else if(g.mode.length>1){
      const local=resizePointerDelta(dx,dy,g.original.angle,shapeLayer);
      Object.assign(item,proportionalCornerResize(g.original,g.mode,local.dx,local.dy,.2,.2));
      preserveRotatedResizeAnchor(g.original,item,g.mode,shapeLayer);
    }else{
      const o=g.original,local=resizePointerDelta(dx,dy,o.angle,shapeLayer);
      const dx=local.dx,dy=local.dy;
      const left=g.mode.includes('w')?o.x+dx:o.x;
      const top=g.mode.includes('n')?o.y+dy:o.y;
      const right=g.mode.includes('e')?o.x+o.width+dx:o.x+o.width;
      const bottom=g.mode.includes('s')?o.y+o.height+dy:o.y+o.height;
      item.x=Math.max(0,Math.min(99.8,Math.min(left,right)));
      item.y=Math.max(0,Math.min(99.8,Math.min(top,bottom)));
      item.width=Math.max(.2,Math.min(100-item.x,Math.abs(right-left)));
      item.height=Math.max(.2,Math.min(100-item.y,Math.abs(bottom-top)));
      preserveRotatedResizeAnchor(o,item,g.mode,shapeLayer);

    }
    renderShapes();updateButtons();
  });
  function finishShape(e){
    if(!shapeGesture)return;
    const g=shapeGesture;
    if(e.type==='pointerup'&&g.mode==='create'&&!g.moved&&activeDetailsTool!=='Draw'){
      const item=(currentPage()?.shapes||[]).find(v=>v.id===g.id);
      if(item){const d=clickCreateDimensions(shapeLayer,g.start.x,g.start.y);
        item.x=g.start.x;item.y=g.start.y;item.width=d.width;item.height=item.type==='Line'?0:d.height;
        item.reverseX=false;item.reverseY=false;}
    }
    shapeGesture=null;
    if(shapeLayer.hasPointerCapture(e.pointerId))shapeLayer.releasePointerCapture(e.pointerId);
    renderShapeOptions();renderShapes();
  }
  shapeLayer.addEventListener('pointerup',finishShape);
  shapeLayer.addEventListener('pointercancel',finishShape);

  // Images are attached to immutable page IDs. Their geometry stays page-relative for zoom stability, while the UI uses displayed CSS pixels.
  // The image data URL remains in the page model, so undo can restore deletions.
  const imageLayer = $('imageLayer');
  const imageInput = document.createElement('input');
  imageInput.type = 'file'; imageInput.accept = 'image/*'; imageInput.className = 'd-none';
  document.body.append(imageInput);
  function currentImage() { return (currentPage()?.images || []).find(i => i.id === selectedImageId); }
  function selectImage(id) {
    selectedImageId = id;
    if (id) { activeDetailsTool = 'Image'; selectedHighlightId = null; selectedTextId = null; }
    updateDetailsToolSelection(); renderHighlights(); renderTexts(); renderImages();
  }
  function imagePagePixels() {
    const paper = $('detailsPaper');
    return { width: Math.max(1, paper.clientWidth), height: Math.max(1, paper.clientHeight) };
  }
  function imageToPixels(obj) {
    const page = imagePagePixels();
    return { width: obj.width * page.width / 100, height: obj.height * page.height / 100 };
  }
  function renderImageOptions() {
    if (activeDetailsTool !== 'Image') return;
    const content = $('pageDetailsToolOptionsContent'); content.replaceChildren();
    const obj = currentImage();
    const settings = obj || imageDefaults;
    const upload = document.createElement('button'); upload.type='button';
    upload.className='btn btn-sm btn-outline-primary';
    upload.innerHTML='<i class="bi bi-image me-1"></i>Choose Image';
    upload.addEventListener('click',()=>imageInput.click()); content.append(upload);
    {
      const transformGroup=document.createElement('div');
      transformGroup.className='d-flex align-items-center gap-2 flex-wrap';
      const flipH=document.createElement('button');flipH.type='button';
      flipH.className='btn btn-sm btn-outline-primary';
      flipH.innerHTML='<i class="bi bi-symmetry-vertical me-1"></i>Flip H';flipH.disabled=!obj;
      flipH.addEventListener('click',()=>{
        if(!obj)return;
        if(obj) recordPageEdit(currentPage());settings.flipH=!settings.flipH;
        renderImages();updateButtons();
      });
      const flipV=document.createElement('button');flipV.type='button';
      flipV.className='btn btn-sm btn-outline-primary';
      flipV.innerHTML='<i class="bi bi-symmetry-horizontal me-1"></i>Flip V';flipV.disabled=!obj;
      flipV.addEventListener('click',()=>{
        if(!obj)return;
        if(obj) recordPageEdit(currentPage());settings.flipV=!settings.flipV;
        renderImages();updateButtons();
      });
      transformGroup.append(flipH,flipV);
      content.append(transformGroup);
    }
    const hint=document.createElement('span');hint.className='small text-secondary w-100';
    hint.textContent='Choose an image, then click the page to place it. Drag the image to move it, or use its handles to resize or rotate.';
    content.append(hint);
  }
  imageInput.addEventListener('change', async ()=>{
    const file=imageInput.files?.[0];imageInput.value='';if(!file)return;
    if(!file.type.startsWith('image/'))return;
    try {
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      const size=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({w:img.naturalWidth,h:img.naturalHeight});img.onerror=reject;img.src=data;});
      pendingImage={src:data,aspect:size.w/size.h};selectedImageId=null;
      renderImageOptions();renderImages();
    } catch(error) { status(`Unable to load image: ${error.message}`); }
  });
  function imagePageRatio() { const r=$('detailsPaper').getBoundingClientRect();return r.width/Math.max(1,r.height); }
  function renderImages() {
    imageLayer.replaceChildren();imageLayer.style.pointerEvents=activeDetailsTool==='Image'?'auto':'none';
    for(const obj of currentPage()?.images||[]) {
      const box=document.createElement('div');box.dataset.imageId=obj.id;
      box.className='position-absolute';box.style.left=`${obj.x}%`;box.style.top=`${obj.y}%`;
      box.style.width=`${obj.width}%`;box.style.height=`${obj.height}%`;
      box.style.cursor='move';box.style.touchAction='none';
      box.style.transform=`rotate(${obj.angle||0}deg)`;
      box.style.transformOrigin='center center';
      box.style.pointerEvents=activeDetailsTool==='Image'?'auto':'none';
      if(obj.id===selectedImageId){box.style.outline='1px dashed #0d6efd';box.style.outlineOffset='0px';}
      const img=document.createElement('img');img.src=obj.src;img.draggable=false;img.alt='Inserted image';
      img.className='w-100 h-100';img.style.objectFit='fill';img.style.pointerEvents='none';
      img.style.transform=`scale(${obj.flipH?-1:1},${obj.flipV?-1:1})`;
      img.style.transformOrigin='center center';box.append(img);
      if(obj.id===selectedImageId){
        for(const corner of ['nw','ne','sw','se','n','e','s','w']){
          const handle=document.createElement('div');handle.dataset.imageResize='true';
          handle.dataset.corner=corner;
          handle.className='position-absolute bg-primary';
          handle.style.width='12px';handle.style.height='12px';
          if(corner.length===1)styleObjectSideHandle(handle,corner);
          else styleObjectCornerHandle(handle,corner);
          box.append(handle);
        }
        const rotateStem=document.createElement('div');rotateStem.className='position-absolute bg-primary';
        rotateStem.style.width='2px';rotateStem.style.height='22px';rotateStem.style.left='calc(50% - 1px)';rotateStem.style.bottom='100%';
        rotateStem.style.pointerEvents='none';box.append(rotateStem);
        const rotateHandle=document.createElement('div');rotateHandle.dataset.imageRotate='true';
        rotateHandle.className='position-absolute bg-white border border-primary border-2 rounded-circle d-flex align-items-center justify-content-center';
        rotateHandle.style.width='22px';rotateHandle.style.height='22px';rotateHandle.style.left='calc(50% - 11px)';
        rotateHandle.style.bottom='calc(100% + 22px)';rotateHandle.style.cursor='grab';rotateHandle.style.touchAction='none';
        rotateHandle.title='Drag to rotate image';rotateHandle.innerHTML='<i class="bi bi-arrow-clockwise text-primary" style="font-size:12px"></i>';
        box.append(rotateHandle);
      }
      if(obj.id===selectedImageId)appendObjectDeleteButton(box,'Image',()=>{recordPageEdit(currentPage());currentPage().images=currentPage().images.filter(v=>v.id!==obj.id);selectedImageId=null;renderImageOptions();renderImages();updateButtons();});
      imageLayer.append(box);
    }
  }
  function imagePoint(e){const r=imageLayer.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),y:Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))};}
  imageLayer.addEventListener('pointerdown',e=>{
    if(activeDetailsTool!=='Image'||busy||e.button!==0)return;
    const hit=e.target.closest('[data-image-id]');
    if(!hit){
      if(selectedImageId){selectImage(null);return;}
      if(!pendingImage)return;
      const page=currentPage();if(!page)return;
      const point=imagePoint(e), pageSize=imagePagePixels();
      const width=Math.min(100,imageDefaults.width/pageSize.width*100);
      const aspectPage=pendingImage.aspect/imagePageRatio();
      const height=width/aspectPage;
      const fit=Math.min(1,100/Math.max(width,0.001),100/Math.max(height,0.001));
      const fittedWidth=width*fit, fittedHeight=height*fit;
      const obj={id:`image-${++imageCounter}`,src:pendingImage.src,x:Math.max(0,Math.min(100-fittedWidth,point.x-fittedWidth/2)),y:Math.max(0,Math.min(100-fittedHeight,point.y-fittedHeight/2)),width:fittedWidth,height:fittedHeight,aspectPage,keepRatio:imageDefaults.keepRatio,angle:imageDefaults.angle,flipH:imageDefaults.flipH,flipV:imageDefaults.flipV};
      recordPageEdit(page);(page.images ||= []).push(obj);pendingImage=null;selectImage(obj.id);updateButtons();return;
    }
    if(selectedImageId!==hit.dataset.imageId){selectImage(hit.dataset.imageId);return;}
    const obj=currentImage();if(!obj)return;
    const mode=e.target.closest('[data-image-rotate]')?'rotate':e.target.closest('[data-image-resize]')?'resize':'move';
    const rect=hit.getBoundingClientRect();
    const centerX=rect.left+rect.width/2,centerY=rect.top+rect.height/2;
    const pointerAngle=Math.atan2(e.clientY-centerY,e.clientX-centerX)*180/Math.PI;
    imageGesture={pageId:detailsId,id:obj.id,mode,start:imagePoint(e),original:{...obj},saved:false,
      centerX,centerY,startAngle:pointerAngle,corner:e.target.closest('[data-image-resize]')?.dataset.corner||'se'};
    imageLayer.setPointerCapture(e.pointerId);e.preventDefault();
  });
  imageLayer.addEventListener('pointermove',e=>{
    const g=imageGesture;if(!g||g.pageId!==detailsId)return;
    const obj=currentImage();if(!obj)return;
    const pt=imagePoint(e),dx=pt.x-g.start.x,dy=pt.y-g.start.y;
    if(g.mode==='rotate'){
      const pointerAngle=Math.atan2(e.clientY-g.centerY,e.clientX-g.centerX)*180/Math.PI;
      let delta=pointerAngle-g.startAngle;
      delta=((delta+180)%360+360)%360-180;
      if(!g.saved&&Math.abs(delta)>.25){recordPageEdit(currentPage());g.saved=true;}
      if(!g.saved)return;
      obj.angle=g.original.angle+delta;
      renderImages();updateButtons();return;
    }
    if(!g.saved&&(Math.abs(dx)>.1||Math.abs(dy)>.1)){recordPageEdit(currentPage());g.saved=true;}
    if(g.mode==='move'){
      obj.x=Math.max(0,Math.min(100-obj.width,g.original.x+dx));
      obj.y=Math.max(0,Math.min(100-obj.height,g.original.y+dy));
    }else{
      const o=g.original,c=g.corner;
      const local=resizePointerDelta(dx,dy,o.angle,imageLayer);
      const localDx=local.dx,localDy=local.dy;
      const anchorX=c.includes('w')?o.x+o.width:o.x;
      const anchorY=c.includes('n')?o.y+o.height:o.y;
      if(c.length>1){
        Object.assign(obj,proportionalCornerResize(o,c,localDx,localDy,1,1));
      }else{
        const w=c==='n'||c==='s'?o.width:Math.max(1,Math.min(c==='w'?anchorX:100-anchorX,o.width+(c==='w'?-localDx:localDx)));
        const h=c==='w'||c==='e'?o.height:Math.max(1,Math.min(c==='n'?anchorY:100-anchorY,o.height+(c==='n'?-localDy:localDy)));
        obj.x=c==='w'?anchorX-w:anchorX;
        obj.y=c==='n'?anchorY-h:anchorY;
        obj.width=w;obj.height=h;
      }
      preserveRotatedResizeAnchor(o,obj,c,imageLayer);
    }
    renderImages();updateButtons();
  });
  function finishImage(e){if(!imageGesture)return;imageGesture=null;if(imageLayer.hasPointerCapture(e.pointerId))imageLayer.releasePointerCapture(e.pointerId);renderImageOptions();}
  imageLayer.addEventListener('pointerup',finishImage);imageLayer.addEventListener('pointercancel',finishImage);


  document.querySelectorAll('[data-zoom-value]').forEach(button => button.addEventListener('click', () => {
    const zoom = $('detailsZoom');
    zoom.value = button.dataset.zoomValue;
    $('detailsZoomButton').textContent = `Zoom: ${button.textContent.trim()}`;
    document.querySelectorAll('[data-zoom-value]').forEach(item => item.classList.toggle('active', item === button));
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  // Keep the select in the options row; switching tools must not discard it.
  let pageSizeSelectionToken = 0;
  async function syncPageSizeSelection() {
    const token = ++pageSizeSelectionToken;
    const page = currentPage();
    if (!page || !isDetails()) {
      pageSizeSelect.value = '';
      return;
    }
    if (page.pageSize && page.pageSize !== 'original') {
      pageSizeSelect.value = page.pageSize;
      return;
    }
    pageSizeSelect.value = '';
    try {
      const size = await PdfEngine.getPageSize(page);
      if (token !== pageSizeSelectionToken || currentPage() !== page || !isDetails()) return;
      const detected = pageSizeLabel(size);
      pageSizeSelect.value = detected === '?' ? '' : detected;
    } catch {
      if (token === pageSizeSelectionToken && currentPage() === page) pageSizeSelect.value = '';
    }
  }
  const pageSizeSelect = document.createElement('select');
  pageSizeSelect.id = 'detailsPageSize';
  pageSizeSelect.className = 'form-select form-select-sm w-auto';
  pageSizeSelect.setAttribute('aria-label', 'Page Size');
  for (const [value, label] of [['',''],['A5','A5'],['A4','A4'],['A3','A3'],['A2','A2'],['A1','A1'],['A0','A0'],['Letter','Letter']]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = label;
    pageSizeSelect.append(option);
  }
  $('pageDetailsToolOptionsContent').append(pageSizeSelect);
  pageSizeSelect.addEventListener('change', () => {
    const page = currentPage();
    if (!page || busy) { void syncPageSizeSelection(); return; }
    const size = pageSizeSelect.value;
    if (!size) { void syncPageSizeSelection(); return; }
    // Invalidate any pending format detection before applying a new selection.
    ++pageSizeSelectionToken;
    if (size === (page.pageSize || 'original')) return;
    recordPageEdit(page);
    page.pageSize = size;
    updateButtons();
    void renderDetailsPage();
    void syncPageSizeSelection();
  });
  $('detailsZoom').addEventListener('change', () => { if (isDetails()) void renderDetailsPage(); });
  window.addEventListener('resize', () => { if (isDetails()) void renderDetailsPage(); });

  renderList();

}
