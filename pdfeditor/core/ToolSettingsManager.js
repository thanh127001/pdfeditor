import { ToolConfig } from '../config/ToolConfig.js';
export class ToolSettingsManager {
 constructor(config=ToolConfig){this.config=config;this.settings=Object.fromEntries(Object.entries(config).map(([name,item])=>[name,structuredClone(item.defaults)]));}
 get(name){return structuredClone(this.settings[name]);}
 update(name,changes){if(this.config[name]?.rememberChanges)Object.assign(this.settings[name],changes);}
 reset(name){this.settings[name]=structuredClone(this.config[name].defaults);}
}