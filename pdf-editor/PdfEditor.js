import { EventBus } from './core/EventBus.js';
import { EditorState } from './core/EditorState.js';
import { ToolSettingsManager } from './core/ToolSettingsManager.js';
import { ToolManager } from './core/ToolManager.js';
import { SelectionManager } from './core/SelectionManager.js';
import { DocumentManager } from './core/DocumentManager.js';
import { PageManager } from './core/PageManager.js';
import { CommandManager } from './core/CommandManager.js';
import { PdfEngine } from './services/PdfEngine.js';
import { initializeEditorRuntime } from './core/EditorRuntime.js';
import { TextTool } from './tools/TextTool.js';
import { ImageTool } from './tools/ImageTool.js';
import { HighlightTool } from './tools/HighlightTool.js';
import { LineTool } from './tools/LineTool.js';
import { RectangleTool } from './tools/RectangleTool.js';
import { EllipseTool } from './tools/EllipseTool.js';
export class PdfEditor {
 constructor() {
  this.events=new EventBus();this.state=new EditorState();this.toolSettings=new ToolSettingsManager();
  this.toolManager=new ToolManager(this.events,this.state);
  this.selectionManager=new SelectionManager(this.events,this.state);
  this.documentManager=new DocumentManager(this.events);
  this.pageManager=new PageManager(this.events,this.state);
  this.commandManager=new CommandManager(this.events);
  for(const Tool of [TextTool,ImageTool,HighlightTool,LineTool,RectangleTool,EllipseTool]) this.toolManager.register(new Tool());
 }
 initialize(){ initializeEditorRuntime(this,PdfEngine); }
}
