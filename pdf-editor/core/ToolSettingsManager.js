export const ToolConfig = Object.freeze({
  Image: { rememberChanges: false, defaults: { width: 100, keepRatio: true, angle: 0, flipH: false, flipV: false } },
  Text: { rememberChanges: true, defaults: { font: 'Arial', size: 18, color: '#212529', background: '#ffffff', backgroundOpacity: 50 } },
  Highlight: { rememberChanges: true, defaults: { height: 3, color: '#fff200', opacity: 45 } },
  Line: { rememberChanges: true, defaults: { stroke: '#0d6efd', strokeWidth: 2, opacity: 100 } },
  Rectangle: { rememberChanges: true, defaults: { stroke: '#0d6efd', strokeWidth: 2, opacity: 100, fill: '#ffffff', fillOpacity: 0, square: false } },
  Ellipse: { rememberChanges: true, defaults: { stroke: '#0d6efd', strokeWidth: 2, opacity: 100, fill: '#ffffff', fillOpacity: 0, circle: false } }
});
export class ToolSettingsManager {
  constructor(config = ToolConfig) {
    this.config = config;
    this.settings = Object.fromEntries(Object.entries(config).map(([name, item]) => [name, structuredClone(item.defaults)]));
  }
  get(name) { return structuredClone(this.settings[name]); }
  update(name, changes) {
    if (!this.config[name]?.rememberChanges) return;
    Object.assign(this.settings[name], changes);
  }
  reset(name) { this.settings[name] = structuredClone(this.config[name].defaults); }
}
