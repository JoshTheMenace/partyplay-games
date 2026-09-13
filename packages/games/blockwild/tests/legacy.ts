import { rules as runtime, type State } from '../src/server';
function island(s:State):State & {grid:Uint8Array;base:Uint8Array}{if(!(s.grid instanceof Uint8Array)||!(s.base instanceof Uint8Array))throw new Error('This fixture requires an island generator');return s as State & {grid:Uint8Array;base:Uint8Array};}
export const rules={...runtime,validateSettings:(value:unknown)=>runtime.validateSettings({terrainVersion:6,...(value&&typeof value==='object'?value:{})}),create:(...args:Parameters<typeof runtime.create>)=>island(runtime.create(...args))};
