export class CommandManager {
 constructor(events,limit=100){this.events=events;this.limit=limit;this.history=new Map();}
 execute(scope,command){command.execute();const h=this.history.get(scope)||[];h.push(command);if(h.length>this.limit)h.shift();this.history.set(scope,h);this.events.emit('history:changed',{scope,canUndo:true});}
 undo(scope){const h=this.history.get(scope)||[];const command=h.pop();if(command){command.undo();this.events.emit('history:changed',{scope,canUndo:h.length>0});}}
}