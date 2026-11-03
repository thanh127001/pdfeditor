export class EditorState {
  constructor() {
    this.view = 'list';
    this.pageId = null;
    this.activeTool = null;
    this.selectedObjectId = null;
  }
  update(changes) { Object.assign(this, changes); }
}
