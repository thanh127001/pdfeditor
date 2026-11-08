export class DocumentManager {
 constructor(events){this.events=events;this.pages=[];}
 setPages(pages){this.pages=pages;this.events.emit('document:changed',{pages});}
}