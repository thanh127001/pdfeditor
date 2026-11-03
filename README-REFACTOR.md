# PDF Editor — static ES Modules refactor

Source: `PDFEditor_Auto_Select_Object_Tool (1).html` (preserved unchanged).

Open `index.html` via a local HTTP server, e.g. `python -m http.server 8000`, then browse `http://localhost:8000/`. ES modules are not reliably supported under `file://`. External Bootstrap/PDF.js/pdf-lib CDN dependencies still require internet access.

## Architecture
- `pdf-editor/index.js`: entry point.
- `pdf-editor/PdfEditor.js`: OOP application root; retains original editor interaction logic to minimize regressions.
- `pdf-editor/core/EventBus.js`: native EventTarget/CustomEvent.
- `pdf-editor/core/EditorState.js`: view, page, tool, selection state container (initial integration).
- `pdf-editor/core/ToolSettingsManager.js`: fixed Image defaults, configurable rememberChanges for other tools.
- `pdf-editor/services/PdfEngine.js`: PDF import/render/export module.

## Migration status
This is an **initial modularization**, not a complete decomposition of every tool, UI view and command into classes. The original closures and handlers remain in `PdfEditor.initialize()`. Lifecycle events include `page:opening`, `page:opened`, `view:changed`, `tool:changed`, `page:editing`. Existing undo/history and editor behavior remain implemented by original code.

No server API/database required.
