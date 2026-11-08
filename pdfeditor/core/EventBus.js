export class EventBus {
  constructor() { this.target = new EventTarget(); }
  on(name, handler) {
    this.target.addEventListener(name, handler);
    return () => this.target.removeEventListener(name, handler);
  }
  emit(name, detail = {}) {
    this.target.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
