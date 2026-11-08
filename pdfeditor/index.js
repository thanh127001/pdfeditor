import { initializeLocalization, localization } from './LocalizationManager.js';
import { PdfEditor } from './PdfEditor.js';
const editor = new PdfEditor();
editor.initialize();
window.pdfEditor = editor;

window.pdfEditorI18n = localization;
initializeLocalization();
