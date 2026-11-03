# PDF Editor static modular refactor

Run `python -m http.server 8000` from repository root, open `http://localhost:8000/`. CDN libraries need Internet. No backend or database.

This is an **incremental OOP refactor**. The original handlers remain in `core/EditorRuntime.js` as a compatibility adapter, so existing behavior is retained. Tool, UI, and command classes have been separated as modules but **are not yet wired to replace the original implementations**. Do not consider this a fully completed OOP migration.

`PdfEditor.js` is the application root; `EventBus`, `EditorState`, `ToolManager`, `PageManager`, and `ToolSettingsManager` provide the architecture for further extraction. Image defaults remain fixed.

Before production: test PDF import, page selection, each drawing tool, undo, drag/drop, and flatten export in a browser.
