export class EditorObject {
 constructor(type,properties={}){this.id=properties.id??crypto.randomUUID();this.type=type;Object.assign(this,properties);}
}