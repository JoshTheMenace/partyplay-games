import { APPLE, CLAY, CLAY_BALL, COBBLE, DIAMOND, DIAMOND_PICK, FUEL, IRON_PICK, RAW_IRON, SAPLING, SEEDS, STONE_SWORD, SWORD, WOOD_SWORD, W, H, EDIT_LIMIT, coords, index, stackLimit, type Player } from './model';
import { block, hash } from './terrain';
import type { Actor, State } from './server';
export const selectedTier=(p:Actor)=>p.inventory[p.selected]>0?({24:1,25:2,[IRON_PICK]:3,[DIAMOND_PICK]:4} as Record<number,number>)[p.selected]??0:0;
export const attackDamage=(p:Actor)=>p.inventory[p.selected]>0?({24:1,25:1.5,[IRON_PICK]:2,[DIAMOND_PICK]:2.5,[WOOD_SWORD]:2,[STONE_SWORD]:2.5,[SWORD]:3} as Record<number,number>)[p.selected]??.5:.5;
export const miningTier=(b:number)=>b===9?3:[8,34].includes(b)?2:[3,15,16,17,29,33,44].includes(b)?1:0;
export function drops(b:number,i:number,seed:number):Record<number,number>{
  if(b===11)return{};
  if(b===CLAY)return{[CLAY_BALL]:4};
  if(b===5||b===20){const r=hash(i,1,seed);return r<.12?{[SAPLING]:1}:b===5&&r<.18?{[APPLE]:1}:{};}
  if(b===1)return hash(i,2,seed)<.18?{2:1,[SEEDS]:1}:{2:1};
  return{[b===3?COBBLE:b===33?FUEL:b===34?RAW_IRON:b===9?DIAMOND:b===32?2:b]:1};
}
export function addDrops(s:State,p:Actor,items:Record<number,number>){for(const [id,n]of Object.entries(items)){const item=Number(id);p.inventory[item]=Math.min(stackLimit(s.terrainVersion,item),(p.inventory[item]??0)+n);}}
export const overlaps=(p:Player,x:number,y:number,z:number)=>p.connected&&Math.abs(p.x-x-.5)<.8&&Math.abs(p.z-z-.5)<.8&&p.y<y+1&&p.y+1.75>y;
// Saplings persist as world blocks. Growth checks a deterministic time bucket, so saves need no separate timer queue.
export function growSaplings(s:State,dt:number){
  if(Math.floor(s.time/30)===Math.floor((s.time-dt)/30))return;
  for(const [i,b]of s.edits)if(b===SAPLING&&hash(i,Math.floor(s.time/30),s.seed)<.35){
    const p=coords(i),cells:[number,number][]=[];
    for(let dy=0;dy<5;dy++)cells.push([index(p.x,p.y+dy,p.z),4]);
    for(let dy=2;dy<5;dy++)for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)if((dx||dz)&&Math.abs(dx)+Math.abs(dz)<(dy===4?3:4))cells.push([index(p.x+dx,p.y+dy,p.z+dz),5]);
    if(p.x<2||p.z<2||p.x>=W-2||p.z>=W-2||p.y+5>=H||![1,2].includes(block(s.grid,p.x,p.y-1,p.z))||s.edits.size+cells.filter(([n])=>!s.edits.has(n)).length>EDIT_LIMIT)continue;
    if(cells.some(([n])=>{const c=coords(n);return n!==i&&s.grid[n]!==0||s.players.some(a=>overlaps(a,c.x,c.y,c.z));}))continue;
    for(const [n,kind]of cells){s.grid[n]=kind;if(s.base[n]===kind)s.edits.delete(n);else s.edits.set(n,kind);}s.revision++;
  }
}
