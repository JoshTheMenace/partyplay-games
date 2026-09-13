import { read, activeArea } from './chunk-world';
import { bucketUse, shear, fertilize } from './toolkit';
import { BONE_MEAL, SHEARS, isNight, FARMLAND, GRAIN, H, ITEMS, SEEDS, TORCH, CAMPFIRE, coords, cropItems, isHoe, stackLimit, solid } from './model';
import { block, ray } from './terrain';
import { emitSound } from './sound-events';
import { aimedAnimal, feedAnimal } from './animals';
import type { Actor, State } from './server';
export function hydrated(s:State,x:number,y:number,z:number){for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)for(let dy=0;dy<=1;dy++)if(block(s.grid,x+dx,y+dy,z+dz)===6)return true;return false;}
export function cropLight(s:State,i:number){const c=coords(i);let sky=true;for(let y=c.y+1;y<H;y++)if(solid(block(s.grid,c.x,y,c.z))){sky=false;break;}return sky&&!isNight(s.time,s.terrainVersion)||[...s.edits].some(([n,b])=>[TORCH,CAMPFIRE].includes(b)&&Math.hypot(coords(n).x-c.x,coords(n).y-c.y,coords(n).z-c.z)<7);}
export function farmUse(s:State,p:Actor,set:(s:State,i:number,b:number)=>boolean){
  if(bucketUse(s,p,set))return true;
  const animal=aimedAnimal(s,p);if(animal){if(p.selected===SHEARS)shear(s,p,animal);else feedAnimal(s,p,animal);return true;}
  const hit=ray(s.grid,p.x,p.y+1.55,p.z,p.yaw,p.pitch);if(!hit)return false;
  if(p.selected===BONE_MEAL){fertilize(s,p,hit.i,set);return true;}
  const kind=read(s.grid,hit.i),open=hit.previous.y===hit.y+1&&block(s.grid,hit.x,hit.y+1,hit.z)===0;
  if(isHoe(p.selected)&&[1,2].includes(kind!)){
    if(!open)throw new Error('Clear the grass above the soil and aim at its top to till it.');
    if(s.mode!=='creative'&&!(p.inventory[p.selected]>0))throw new Error('Craft and select a hoe first.');
    if(!set(s,hit.i,FARMLAND))throw new Error('World edit limit reached.');emitSound(s,'plant',hit);p.message='Soil tilled. Select wheat seeds, a carrot or a potato, then Plant.';return true;
  }
  if(kind===FARMLAND&&!s.farms.some(f=>f.i===hit.i)&&cropItems.includes(p.selected)){
    plantCrop(s,p,hit.i);return true;
  }
  return false;
}
export function plantCrop(s:State,p:Actor,i:number){
  const c=coords(i),crop=cropItems.includes(p.selected)?p.selected:SEEDS;
  if(read(s.grid,i)!==FARMLAND||block(s.grid,c.x,c.y+1,c.z)!==0)throw new Error('Use a hoe on clear grass or dirt first. Plant only on open farmland.');
  if(s.farms.some(f=>f.i===i))throw new Error('A crop is already growing here.');
  if(s.farms.length>=128)throw new Error('Harvest an existing crop before planting more.');
  if(s.mode!=='creative'&&!(p.inventory[crop]>0))throw new Error(`Gather ${ITEMS[crop]} first.`);
  if(s.mode!=='creative')p.inventory[crop]--;
  const duration=hydrated(s,c.x,c.y,c.z)?180:360;s.farms.push({i,crop,plantedAt:s.time,readyAt:s.time+360});emitSound(s,'plant',c);p.message=`Planted ${ITEMS[crop]}. ${duration===180?'Watered soil grows faster.':'Water within four blocks speeds growth.'}`;
}
export function harvestCrop(s:State,p:Actor,i:number){
  const farm=s.farms.find(f=>f.i===i);if(!farm)return false;
  const crop=farm.crop??SEEDS,ripe=s.time>=farm.readyAt,items:Record<number,number>=crop===SEEDS?(ripe?{[GRAIN]:1,[SEEDS]:2}:{[SEEDS]:1}):{[crop]:ripe?3:1};
  if(Object.entries(items).some(([id,n])=>(p.inventory[Number(id)]??0)+n>stackLimit(s.terrainVersion,Number(id))))throw new Error('Make inventory space before harvesting.');
  for(const [id,n]of Object.entries(items))p.inventory[Number(id)]=(p.inventory[Number(id)]??0)+n;
  s.farms=s.farms.filter(f=>f!==farm);emitSound(s,'harvest',coords(i));p.message=ripe?'Harvested. Select seeds or a crop to replant.':'Harvested early; only the planting item was recovered.';return true;
}
const environments=new WeakMap<State,{revision:number;second:number;plots:Map<number,{light:boolean;wet:boolean}>}>();
export function cropEnvironment(s:State,i:number){
  let cache=environments.get(s);const second=Math.floor(s.time);
  if(!cache||cache.revision!==s.revision||cache.second!==second){cache={revision:s.revision,second,plots:new Map()};environments.set(s,cache);}
  let plot=cache.plots.get(i);if(!plot){const c=coords(i);plot={light:cropLight(s,i),wet:hydrated(s,c.x,c.y,c.z)};cache.plots.set(i,plot);}return plot;
}
export function tickCrops(s:State,dt:number){
  for(const f of s.farms){if(f.readyAt<=s.time-dt)continue;const c=coords(f.i);
    if(!activeArea(s,c)||block(s.grid,c.x,c.y+1,c.z)!==0||!cropEnvironment(s,f.i).light)f.readyAt+=dt;
    else if(cropEnvironment(s,f.i).wet)f.readyAt-=dt; // Baseline dry growth; water doubles the remaining rate.
  }
}

export function cropStatus(s:State,i:number){
  const farm=s.farms.find(f=>f.i===i);if(!farm)return '';
  const c=coords(i),env=cropEnvironment(s,i),name=ITEMS[farm.crop===undefined||farm.crop===SEEDS?GRAIN:farm.crop];
  return `${name} · ${farm.readyAt<=s.time?'Ripe':block(s.grid,c.x,c.y+1,c.z)!==0?'Clear above crop':!env.light?'Needs light':env.wet?'Growing · Watered':'Growing · Dry soil'}`;
}
