
'use strict';
export const PdfEngine = (() => {
  const pdfjs = window.pdfjsLib;
  const lib = window.PDFLib;
  if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const sources = new Map(); // sourceId => { bytes, renderDoc }
  let sourceCounter = 0;
  function requireLibraries() { if (!pdfjs || !lib) throw new Error('PDF.js or pdf-lib failed to load. Check your connection.'); }
  async function importPdf(file) {
    requireLibraries();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // PDF.js validates and counts real pages; pdf-lib validates that pages can be copied on export.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    let renderDoc;
    try {
      renderDoc = await task.promise;
      const editDoc = await lib.PDFDocument.load(bytes.slice());
      if (editDoc.getPageCount() !== renderDoc.numPages) throw new Error('Inconsistent page count.');
      const sourceId = `source-${++sourceCounter}`;
      sources.set(sourceId, { bytes, renderDoc });
      return Array.from({ length: renderDoc.numPages }, (_, pageIndex) => ({ sourceId, pageIndex, rotation: 0 }));
    } catch (error) {
      if (renderDoc) await renderDoc.destroy().catch(() => {});
      throw new Error(`${file.name}: ${error.message}`);
    }
  }
  function createBlankPage() { return { sourceId: null, pageIndex: null, rotation: 0 }; }
  async function renderThumbnail(item, canvas, maxWidth = 190) {
    requireLibraries();
    const context = canvas.getContext('2d');
    if (!item.sourceId) {
      canvas.width = item.rotation % 180 === 0 ? 595 : 842; canvas.height = item.rotation % 180 === 0 ? 842 : 595;
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const source = sources.get(item.sourceId);
    if (!source) throw new Error('The source PDF is unavailable.');
    const page = await source.renderDoc.getPage(item.pageIndex + 1);
    const initial = page.getViewport({ scale: 1, rotation: (page.rotate + item.rotation) % 360 });
    const scale = Math.min(1.6, maxWidth / initial.width);
    const viewport = page.getViewport({ scale, rotation: (page.rotate + item.rotation) % 360 });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
  }
  async function exportPdf(items, overlays = []) {
    requireLibraries();
    const output = await lib.PDFDocument.create();
    const loaded = new Map();
    for (const [exportIndex, item] of items.entries()) {
      let exportedPage;
      let baseRotation = 0;
      if (!item.sourceId) {
        const page = output.addPage([595.28, 841.89]);
        if (item.rotation) page.setRotation(lib.degrees(item.rotation));
        exportedPage = page;
      }
      if (item.sourceId) {
        const source = sources.get(item.sourceId);
        if (!source) throw new Error('The source PDF is unavailable.');
        if (!loaded.has(item.sourceId)) loaded.set(item.sourceId, await lib.PDFDocument.load(source.bytes.slice()));
        const sourcePage = loaded.get(item.sourceId).getPage(item.pageIndex);
        const [copied] = await output.copyPages(loaded.get(item.sourceId), [item.pageIndex]);
        baseRotation = sourcePage.getRotation().angle;
        copied.setRotation(lib.degrees(((baseRotation + item.rotation) % 360 + 360) % 360));
        output.addPage(copied);
        exportedPage = copied;
      }
      if (overlays[exportIndex]) {
        const png = await output.embedPng(overlays[exportIndex]);
        const {width: W, height: H} = exportedPage.getSize();
        const rotation = ((baseRotation + (item.rotation || 0)) % 360 + 360) % 360;
        const portrait = rotation % 180 === 0;
        const visualW = portrait ? W : H, visualH = portrait ? H : W;
        const positions = {
          0:   {x:0, y:0},
          90:  {x:W, y:0},
          180: {x:W, y:H},
          270: {x:0, y:H}
        };
        exportedPage.drawImage(png, {...positions[rotation], width:visualW, height:visualH, rotate:lib.degrees(rotation)});
      }
    }
    return await output.save();
  }
  async function reset() {
    const old = [...sources.values()]; sources.clear();
    await Promise.allSettled(old.map(source => source.renderDoc.destroy()));
  }
  async function getPageSize(item) {
    if (!item.sourceId) return item.rotation % 180 === 0 ? {width:595.28,height:841.89} : {width:841.89,height:595.28};
    const source = sources.get(item.sourceId);
    if (!source) throw new Error('The source PDF is unavailable.');
    const page = await source.renderDoc.getPage(item.pageIndex + 1);
    const viewport = page.getViewport({scale:1,rotation:(page.rotate + item.rotation)%360});
    return {width:viewport.width,height:viewport.height};
  }
  return Object.freeze({ importPdf, createBlankPage, renderThumbnail, getPageSize, exportPdf, reset });
})();
