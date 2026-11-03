
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
      const size = await getPageSize(item);
      canvas.width = Math.ceil(size.width); canvas.height = Math.ceil(size.height);
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const source = sources.get(item.sourceId);
    if (!source) throw new Error('The source PDF is unavailable.');
    const page = await source.renderDoc.getPage(item.pageIndex + 1);
    const initial = page.getViewport({ scale: 1, rotation: (page.rotate + item.rotation) % 360 });
    const target = resizedSize(item, {width:initial.width,height:initial.height});
    const scale = Math.min(1.6, maxWidth / target.width);
    const viewport = page.getViewport({ scale, rotation: (page.rotate + item.rotation) % 360 });
    canvas.width = Math.ceil(target.width * scale); canvas.height = Math.ceil(target.height * scale);
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.ceil(viewport.width); renderCanvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: renderCanvas.getContext('2d'), viewport }).promise;
    context.drawImage(renderCanvas, 0, 0, canvas.width, canvas.height);
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
      if (paperSizes[item.pageSize]) {
        const original = exportedPage.getSize();
        const rotation = ((baseRotation + (item.rotation || 0)) % 360 + 360) % 360;
        const visual = rotation % 180 === 0
          ? {width:original.width,height:original.height}
          : {width:original.height,height:original.width};
        const target = resizedSize(item, visual);
        const physical = rotation % 180 === 0
          ? target : {width:target.height,height:target.width};
        exportedPage.scaleContent(physical.width / original.width, physical.height / original.height);
        exportedPage.setSize(physical.width, physical.height);
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
  const paperSizes = Object.freeze({
    A5: [419.53, 595.28], A4: [595.28, 841.89],
    A3: [841.89, 1190.55], A2: [1190.55, 1683.78],
    A1: [1683.78, 2383.94], A0: [2383.94, 3370.39]
  });
  function resizedSize(item, original) {
    const paper = paperSizes[item.pageSize];
    if (!paper) return original;
    const landscape = original.width > original.height;
    return landscape
      ? {width:paper[1], height:paper[0]}
      : {width:paper[0], height:paper[1]};
  }
  async function getPageSize(item) {
    if (!item.sourceId) return resizedSize(item, item.rotation % 180 === 0 ? {width:595.28,height:841.89} : {width:841.89,height:595.28});
    const source = sources.get(item.sourceId);
    if (!source) throw new Error('The source PDF is unavailable.');
    const page = await source.renderDoc.getPage(item.pageIndex + 1);
    const viewport = page.getViewport({scale:1,rotation:(page.rotate + item.rotation)%360});
    return resizedSize(item, {width:viewport.width,height:viewport.height});
  }
  return Object.freeze({ importPdf, createBlankPage, renderThumbnail, getPageSize, exportPdf, reset });
})();
