import { APPLE, BENCH, BERRIES, BREAD, CHEST, COBBLE, TOOL, TORCH, paletteFor, selectable, type TerrainVersion } from './model';
import { visible } from './items';
export type Hotbar={slots:number[];active:number};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
export function defaultHotbar(version:TerrainVersion,inv:Record<number,number>):Hotbar{
 const food=[APPLE,BREAD,BERRIES].find(id=>(inv[id]??0)>0)??APPLE;
 return{slots:version<4?paletteFor(version).slice(0,9):[2,4,10,BENCH,COBBLE,TORCH,CHEST,TOOL,food],active:0};
}
export function loadHotbar(key:string,version:TerrainVersion,inv:Record<number,number>,storage?:StorageLike):Hotbar{
 try{const raw=JSON.parse((storage??sessionStorage).getItem(key)??'null') as Hotbar|null;if(raw&&Array.isArray(raw.slots)&&raw.slots.length===9&&raw.slots.every(id=>selectable(id)&&visible(version,id))&&Number.isInteger(raw.active)&&raw.active>=0&&raw.active<9)return{slots:raw.slots.map(Number),active:raw.active};}catch{/* Fall back to the default layout when storage is unavailable or stale. */}
 return defaultHotbar(version,inv);
}
export function storeHotbar(key:string,hotbar:Hotbar,storage?:StorageLike){try{(storage??sessionStorage).setItem(key,JSON.stringify(hotbar));}catch{/* The hotbar still works for this session without persistence. */}}
