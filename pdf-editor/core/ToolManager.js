export class ToolManager {
 constructor(events,state){this.events=events;this.state=state;this.tools=new Map();}
 register(tool){this.tools.set(tool.name,tool);return tool;}
 activate(name){if(name!==null&&!this.tools.has(name))throw Error('Unknown tool: '+name);this.state.activeTool=name;this.events.emit('tool:changed',{tool:name});return this.tools.get(name)||null;}
}