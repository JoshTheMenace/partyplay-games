import { CHUNK, CLAY, COAL, H, IRON_ORE, SHORT_GRASS, WILD_CARROT, WILD_POTATO, WORLD_RADIUS, coords, index } from './model';
import { hash } from './noise';
export type Grid=Uint8Array|ChunkWorld;
const local=(x:number,y:number,z:number)=>((x%CHUNK+CHUNK)%CHUNK)+((z%CHUNK+CHUNK)%CHUNK)*CHUNK+y*CHUNK*CHUNK;
export const chunkKey=(x:number,z:number)=>`${Math.floor(x/CHUNK)},${Math.floor(z/CHUNK)}`;
function noise(x:number,z:number,scale:number,seed:number){x/=scale;z/=scale;const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz),a=hash(ix,iz,seed)*(1-sx)+hash(ix+1,iz,seed)*sx,b=hash(ix,iz+1,seed)*(1-sx)+hash(ix+1,iz+1,seed)*sx;return a*(1-sz)+b*sz;}
export function landscape(seed:number,x:number,z:number){
  const temperature=noise(x,z,180,seed+12),mountain=noise(x,z,128,seed+3),river=Math.abs(noise(x,z,90,seed+71)-.5);
  let height=Math.floor(12+mountain*15+noise(x,z,28,seed+6)*6);
  if(river<.028)height=7+Math.floor(river*90);
  // A small dry starting area; all distant terrain uses the same absolute-coordinate rules.
  if(Math.hypot(x-64,z-66)<12)height=Math.max(15,height);
  return {height,top:height<11||temperature>.69?7:temperature<.3&&height>24?19:1};
}
export function generateChunk(seed:number,cx:number,cz:number){
  const grid=new Uint8Array(CHUNK*CHUNK*H),ox=cx*CHUNK,oz=cz*CHUNK;
  const samples=new Map<number,ReturnType<typeof landscape>>(),sample=(x:number,z:number)=>{const key=x-ox+4+(z-oz+4)*(CHUNK+8);let value=samples.get(key);if(!value){value=landscape(seed,x,z);samples.set(key,value);}return value;};
  for(let x=ox;x<ox+CHUNK;x++)for(let z=oz;z<oz+CHUNK;z++){
    const {height,top}=sample(x,z);let roof=height;
    for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)roof=Math.min(roof,sample(x+dx,z+dz).height);
    for(let y=0;y<=Math.max(height,10);y++){const ore=hash(Math.floor(x/2)+y*29,Math.floor(z/2),seed),cave=y>2&&y<height-4&&Math.abs(Math.sin(x*.16+seed)+Math.cos(z*.14)+Math.sin(y*.43))<.17;
      grid[local(x,y,z)]=y===0?14:y>height?6:cave?0:y===height?(top===7&&height<10&&hash(x,z,seed+4)<.35?CLAY:top):y>height-3?(top===7?7:2):ore>.977&&y<=5&&roof-y>=10?9:ore>.94?IRON_ORE:ore>.89?8:ore>.83?COAL:3;
    }
    if(top===1&&hash(x,z,seed+17)<.28)grid[local(x,height+1,z)]=hash(x,z,seed+32)<.04?WILD_CARROT:hash(x,z,seed+33)<.04?WILD_POTATO:SHORT_GRASS;
  }
  // Include roots outside this chunk so trees crossing a border are independent of load order.
  const put=(x:number,y:number,z:number,b:number)=>{if(x>=ox&&x<ox+CHUNK&&z>=oz&&z<oz+CHUNK&&y<H){const i=local(x,y,z);if(b===4||grid[i]===0||grid[i]===SHORT_GRASS)grid[i]=b;}};
  for(let x=ox-2;x<ox+CHUNK+2;x++)for(let z=oz-2;z<oz+CHUNK+2;z++){const {height,top}=sample(x,z);if(top!==1||hash(x,z,seed)<.976||Math.hypot(x-64,z-66)<4)continue;for(let y=1;y<=4;y++)put(x,height+y,z,4);for(let dy=3;dy<=6;dy++)for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)if((dx||dz||dy>4)&&Math.abs(dx)+Math.abs(dz)<(dy===6?2:4))put(x+dx,height+dy,z+dz,5);}
  return grid;
}
/** A bounded cache of reproducible terrain; edits outlive cache eviction. No whole-world array. */
export class ChunkWorld {
  readonly chunks=new Map<string,Uint8Array>();
  constructor(readonly seed:number,readonly edits=new Map<number,number>(),readonly capacity=128){}
  get(x:number,y:number,z:number){
    if(x<-WORLD_RADIUS||z<-WORLD_RADIUS||x>=WORLD_RADIUS||z>=WORLD_RADIUS||y<0)return 14;if(y>=H)return 0;
    const i=index(x,y,z),override=this.edits.get(i);if(override!==undefined)return override;
    const key=chunkKey(x,z);let data=this.chunks.get(key);
    if(!data){data=generateChunk(this.seed,Math.floor(x/CHUNK),Math.floor(z/CHUNK));this.chunks.set(key,data);if(this.chunks.size>this.capacity)this.chunks.delete(this.chunks.keys().next().value!);}
    return data[local(x,y,z)]!;
  }
  set(i:number,b:number){this.edits.set(i,b);}
  clearCache(){this.chunks.clear();}
}
export function read(grid:Grid,i:number){if(grid instanceof Uint8Array)return grid[i]!;const c=coords(i);return grid.get(c.x,c.y,c.z);}
export function write(grid:Grid,i:number,b:number){if(grid instanceof Uint8Array)grid[i]=b;else grid.set(i,b);}

export const activeArea=(s:{terrainVersion:number;players:{x:number;z:number;connected:boolean}[]},p:{x:number;z:number})=>s.terrainVersion!==7||s.players.some(a=>a.connected&&Math.hypot(a.x-p.x,a.z-p.z)<=64);
