export class SelectionManager {
 constructor(events,state){this.events=events;this.state=state;}
 selectObject(id,type){this.state.selectedObjectId=id;this.events.emit('object:selected',{objectId:id,objectType:type});}
 clear(){this.state.selectedObjectId=null;this.events.emit('object:selected',{objectId:null});}
}