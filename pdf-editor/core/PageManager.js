export class PageManager {
 constructor(events,state){this.events=events;this.state=state;}
 open(pageId){this.state.update({view:'details',pageId,activeTool:null,selectedObjectId:null});this.events.emit('view:changed',{view:'details',pageId});}
 back(){this.state.update({view:'list',pageId:null,activeTool:null,selectedObjectId:null});this.events.emit('view:changed',{view:'list'});}
}