import { emitSound } from './sound-events';
import { APPLE, CHARCOAL, FUEL, FLESH, stackLimit, BED, BENCH, BERRIES, BREAD, CAMPFIRE, CHEST, COAL, FARMLAND, FURNACE, GRAIN, H, ITEMS, ROAST, SEEDS, W, coords, dayLength, isNight, type TerrainVersion, type Action, type Homestead, type Recipe, type StationView } from './model';
import { block, fits, ray } from './terrain';
import type { Actor, State } from './server';

const distance=(p:Actor,i:number)=>{const c=coords(i);return Math.hypot(p.x-c.x-.5,p.y-c.y,p.z-c.z-.5);};
export function nearby(s:State,p:Actor,kind:number){let best:number|null=null,d=4;for(const [i,b]of s.edits)if(b===kind&&distance(p,i)<d){best=i;d=distance(p,i);}return best;}
export function stationView(s:State,p:Actor):StationView|null {
  const hit=ray(s.grid,p.x,p.y+1.55,p.z,p.yaw,p.pitch),i=hit?.i;
  if(i===undefined)return null;const kind=s.grid[i]!;
  if(![BENCH,FURNACE,CHEST,BED,CAMPFIRE,FARMLAND].includes(kind))return null;
  return{i,kind,contents:kind===CHEST?{...s.chests[i]}:{},readyAt:s.furnaces[i]?.readyAt??s.farms.find(f=>f.i===i)?.readyAt??0};
}
export function startSmelting(s:State,p:Actor,recipe:Recipe){
  const i=nearby(s,p,FURNACE);if(i===null)throw new Error('Place a furnace nearby to smelt this.');
  if(s.furnaces[i])throw new Error('This furnace is busy. Collect its output before starting another batch.');
  if(Object.keys(s.furnaces).length>=32)throw new Error('The world already has 32 active furnaces.');
  if(s.terrainVersion===4&&Object.keys(s.fuelUntil??{}).length>=32&&!s.fuelUntil?.[i])throw new Error('Let an existing furnace finish burning before lighting another.');
  const costs={...recipe.costs},duration=recipe.seconds??10;let fuelUntil=s.fuelUntil?.[i]??0;
  if(s.terrainVersion===4){if(fuelUntil<s.time+duration){const fuel=[FUEL,CHARCOAL,4,10].find(id=>(p.inventory[id]??0)>(costs[id]??0));if(fuel===undefined)throw new Error('Add coal, charcoal, logs or planks for furnace fuel.');costs[fuel]=(costs[fuel]??0)+1;fuelUntil=Math.max(s.time,fuelUntil)+([FUEL,CHARCOAL].includes(fuel)?80:15);}}
  else{const fuel=(p.inventory[COAL]??0)>0?COAL:4;costs[fuel]=(costs[fuel]??0)+1;}
  for(const [key,n]of Object.entries(costs))if((p.inventory[Number(key)]??0)<n)throw new Error(`Need ${n} ${ITEMS[Number(key)]}; each batch also needs coal or timber.`);
  for(const [key,n]of Object.entries(costs))p.inventory[Number(key)]-=n;
  if(s.terrainVersion===4){s.fuelUntil??={};s.fuelUntil[i]=fuelUntil;}
  s.furnaces[i]={item:recipe.item,count:recipe.count,readyAt:s.time+(recipe.seconds??10)};emitSound(s,'smelt',coords(i));p.message=`Smelting ${recipe.name}. Aim at the furnace and Use to collect when ready.`;
}
export function canRemove(s:State,i:number){
  if(Object.values(s.chests[i]??{}).some(n=>n>0))throw new Error('Empty the chest before mining it.');
  if(s.furnaces[i])throw new Error('Collect the furnace output before mining it.');
  if(s.farms.some(f=>f.i===i))throw new Error('Use the crop to harvest it before removing the soil.');
}
export function homesteadAction(s:State,p:Actor,a:Action,setBlock:(s:State,i:number,b:number)=>boolean){
  if(a.type==='eat'){
    if(p.food>=10&&p.health>=10)throw new Error('Already feeling well.');
    const foods=s.terrainVersion===4?[BREAD,APPLE,BERRIES,FLESH]:[BREAD,ROAST,BERRIES],food=foods.includes(p.selected)&&(p.inventory[p.selected]??0)>0?p.selected:foods.find(id=>(p.inventory[id]??0)>0);if(food===undefined)throw new Error('Gather apples from oak leaves, or grow wheat and craft bread.');
    p.inventory[food]--;p.food=Math.min(10,p.food+(food===BREAD?(s.terrainVersion===4?2.5:6):food===ROAST?4:2));emitSound(s,'eat',p);p.message=`Ate ${ITEMS[food]}. A full food meter gradually restores health.`;return;
  }
  const hit=ray(s.grid,p.x,p.y+1.55,p.z,p.yaw,p.pitch);
  if(!hit)throw new Error('Aim at something within reach first.');const i=hit.i,kind=s.grid[i]!;
  if(a.type==='plant'){
    if(![1,2,FARMLAND].includes(kind)||hit.previous.y!==hit.y+1||block(s.grid,hit.x,hit.y+1,hit.z)!==0)throw new Error('Aim at open grass or earth to plant.');
    if(s.farms.some(f=>f.i===i))throw new Error('A crop is already growing here.');if(s.farms.length>=128)throw new Error('Harvest an existing crop before planting more.');
    if(s.mode!=='creative'&&!(p.inventory[SEEDS]>0))throw new Error('Gather wheat seeds first.');
    if(!setBlock(s,i,FARMLAND))throw new Error('Make room in the world edit budget before planting.');
    if(s.mode!=='creative')p.inventory[SEEDS]--;let watered=false;for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)if(block(s.grid,hit.x+dx,hit.y,hit.z+dz)===6)watered=true;
    s.farms.push({i,readyAt:s.time+(watered?90:180)});emitSound(s,'plant',hit);p.message=watered?'Planted beside water. Ready in 90 seconds.':'Planted. Ready in 3 minutes; nearby water helps crops grow faster.';return;
  }
  if(a.type==='deposit'||a.type==='withdraw'){
    if(kind!==CHEST)throw new Error('Aim at a chest to move supplies.');if(!s.chests[i]&&Object.keys(s.chests).length>=32)throw new Error('The world already has 32 stocked chests.');
    const chest=s.chests[i]??{},from=a.type==='deposit'?p.inventory:chest,to=a.type==='deposit'?chest:p.inventory;
    if(a.type==='deposit'&&!chest[a.item]&&Object.keys(chest).length>=16)throw new Error('This chest holds 16 different items.');
    const n=Math.min(from[a.item]??0,64,stackLimit(s.terrainVersion,a.item)-(to[a.item]??0));if(n<=0)throw new Error('No items to move, or the destination stack is full.');
    to[a.item]=(to[a.item]??0)+n;from[a.item]-=n;if(!from[a.item])delete from[a.item];if(Object.keys(chest).length)s.chests[i]=chest;else delete s.chests[i];emitSound(s,'pickup',hit);p.message=`${a.type==='deposit'?'Stored':'Took'} ${n} ${ITEMS[a.item]}.`;return;
  }
  if(a.type!=='use')throw new Error('Unknown world interaction.');
  if(kind===FURNACE){const job=s.furnaces[i];if(!job)throw new Error('Open Craft nearby to choose a smelting recipe.');if(s.time<job.readyAt)throw new Error(`Smelting: ${Math.ceil(job.readyAt-s.time)} seconds left.`);if((p.inventory[job.item]??0)+job.count>stackLimit(s.terrainVersion,job.item))throw new Error('Make inventory space before collecting.');p.inventory[job.item]=(p.inventory[job.item]??0)+job.count;delete s.furnaces[i];emitSound(s,'pickup',hit);p.message=`Collected ${job.count} ${ITEMS[job.item]}.`;return;}
  if(kind===FARMLAND){const farm=s.farms.find(f=>f.i===i);if(!farm)throw new Error('Plant seeds here to grow grain.');if(s.time<farm.readyAt)throw new Error(`Growing: ${Math.ceil(farm.readyAt-s.time)} seconds left.`);if((p.inventory[GRAIN]??0)>stackLimit(s.terrainVersion,GRAIN)-2||(p.inventory[SEEDS]??0)>stackLimit(s.terrainVersion,SEEDS)-2)throw new Error('Make room for 2 grain and 2 seeds.');p.inventory[GRAIN]=(p.inventory[GRAIN]??0)+2;p.inventory[SEEDS]=(p.inventory[SEEDS]??0)+2;s.farms=s.farms.filter(f=>f!==farm);emitSound(s,'harvest',hit);p.message='Harvested 2 grain and 2 seeds. Replant whenever you like.';return;}
  if(kind===BED){if(s.players.some(other=>other.id!==p.id&&other.connected&&other.sleeping&&other.home?.bed===i))throw new Error('Someone is resting in this bed. Use another bed.');const home=bedSpawn(s,i);if(!home)throw new Error('Leave a clear standing space beside the bed.');p.home={...home,bed:i};p.sleeping=isNight(s.time,s.terrainVersion);emitSound(s,'sleep',hit);p.message=p.sleeping?'Resting. Night passes when every connected explorer rests. Move to wake up.':'Home set. You will return here after death.';return;}
  p.message=kind===CHEST?'Open Craft to store or take supplies from this chest.':kind===BENCH?'Open Craft. Advanced recipes are available near this workbench.':kind===CAMPFIRE?'A warm fire. Brambles keep their distance.':'Use works on beds, furnaces, chests and crops.';
}
export function bedSpawn(s:State,i:number){if(s.grid[i]!==BED)return null;const c=coords(i);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=c.x+dx+.5,z=c.z+dz+.5,y=c.y;if(fits(s.grid,x,y,z)&&![0,6].includes(block(s.grid,x,y-1,z)))return{x,y,z};}return null;}
export function sleepTick(s:State){for(const p of s.players)if(p.sleeping&&(!p.home||!bedSpawn(s,p.home.bed)||distance(p,p.home.bed)>5))p.sleeping=false;const awake=s.players.filter(p=>p.connected);if(awake.length&&awake.every(p=>p.sleeping)&&isNight(s.time,s.terrainVersion)){s.time=(Math.floor(s.time/dayLength(s.terrainVersion))+1)*dayLength(s.terrainVersion);s.creatures=[];s.projectiles=[];for(const p of s.players){p.sleeping=false;p.message='Morning. Your world is waiting.';}}}

// Validate the entire save extension before mutating the live world.
export function readHomestead(raw:unknown,grid:Uint8Array,version:TerrainVersion=3):Homestead {
  if(raw===undefined)return{chests:{},furnaces:{},farms:[]};
  const h=raw as Homestead;if(!h||typeof h!=='object'||Array.isArray(h)||!h.chests||!h.furnaces||!Array.isArray(h.farms)||h.farms.length>128)throw new Error('Invalid homestead.');
  const validIndex=(key:string,kind:number)=>/^(0|[1-9]\d*)$/.test(key)&&Number(key)>=W*W&&Number(key)<W*W*H&&grid[Number(key)]===kind;
  const inventory=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length<=16&&Object.entries(v).every(([k,n])=>/^(0|[1-9]\d*)$/.test(k)&&Number(k)<ITEMS.length&&Number.isInteger(n)&&n>0&&n<=stackLimit(version,Number(k)));
  for(const [record,kind]of [[h.chests,CHEST],[h.furnaces,FURNACE]] as const)if(typeof record!=='object'||Array.isArray(record)||Object.keys(record).length>32||Object.keys(record).some(k=>!validIndex(k,kind)))throw new Error('Invalid station storage.');
  if(Object.values(h.chests).some(v=>!inventory(v))||Object.values(h.furnaces).some(j=>!j||!Number.isInteger(j.item)||j.item<0||j.item>=ITEMS.length||!Number.isInteger(j.count)||j.count<1||j.count>4||!Number.isFinite(j.readyAt)||j.readyAt<0||j.readyAt>1e9+180))throw new Error('Invalid station contents.');
  const seen=new Set<number>();for(const f of h.farms){if(!f||!validIndex(String(f.i),FARMLAND)||seen.has(f.i)||!Number.isFinite(f.readyAt)||f.readyAt<0||f.readyAt>1e9+180)throw new Error('Invalid farm.');seen.add(f.i);}
  const fuelUntil=h.fuelUntil??{};if(!fuelUntil||typeof fuelUntil!=='object'||Array.isArray(fuelUntil)||Object.keys(fuelUntil).length>32||Object.entries(fuelUntil).some(([i,t])=>!validIndex(i,FURNACE)||!Number.isFinite(t)||t<0||t>1e9+80))throw new Error('Invalid furnace fuel.');
  return{fuelUntil:{...fuelUntil},chests:Object.fromEntries(Object.entries(h.chests).map(([k,v])=>[k,{...v}])),furnaces:Object.fromEntries(Object.entries(h.furnaces).map(([k,v])=>[k,{item:v.item,count:v.count,readyAt:v.readyAt}])),farms:h.farms.map(f=>({i:f.i,readyAt:f.readyAt}))};
}
