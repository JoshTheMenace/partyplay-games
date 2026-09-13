import { read, activeArea } from './chunk-world';
import { inWorld, BONE_MEAL, BUCKET, WATER_BUCKET, SHEARS, WOOL, FARMLAND, SHORT_GRASS, H, coords, index, stackLimit, type Animal } from './model';
import { block, hash, ray } from './terrain';
import { emitSound } from './sound-events';
import type { Actor, State } from './server';
type Edit=(s:State,i:number,b:number)=>boolean;
export const waterTarget=(s:State,p:Actor)=>ray(s.grid,p.x,p.y+1.55,p.z,p.yaw,p.pitch,5,false,true);
export function bucketUse(s:State,p:Actor,set:Edit){
  if(![BUCKET,WATER_BUCKET].includes(p.selected))return false;
  if(s.mode!=='creative'&&!(p.inventory[p.selected]>0))throw new Error('Craft and select a bucket first.');
  const empty=p.selected===BUCKET,hit=empty?waterTarget(s,p):ray(s.grid,p.x,p.y+1.55,p.z,p.yaw,p.pitch);
  if(!hit)throw new Error(empty?'Aim at water within reach to fill the bucket.':'Aim at a block beside an empty irrigation hole.');
  const c=empty?hit:hit.previous,i=index(c.x,c.y,c.z),output=empty?WATER_BUCKET:BUCKET;
  if(!inWorld(s.terrainVersion,c.x,c.z)||c.y<1||c.y>=H)throw new Error('Keep water inside the island.');
  if(empty?read(s.grid,i)!==6:read(s.grid,i)!==0)throw new Error(empty?'Aim directly at water.':'Water needs an empty block; it cannot replace plants or buildings.');
  if(!empty&&s.farms.some(f=>f.i===index(c.x,c.y-1,c.z)))throw new Error('Pour beside the crops, not onto them.');
  if(s.mode!=='creative'&&(p.inventory[output]??0)>=stackLimit(s.terrainVersion,output))throw new Error('Make room for the returned bucket first.');
  if(!set(s,i,empty?0:6))throw new Error('World edit limit reached. The bucket was kept.');
  if(s.mode!=='creative'){p.inventory[p.selected]--;p.inventory[output]=(p.inventory[output]??0)+1;}
  emitSound(s,'splash',c);p.message=empty?'Water collected. Select the water bucket to irrigate a farm.':'Water poured. Farmland within four blocks now grows faster.';return true;
}
export function shear(s:State,p:Actor,a:Animal){
  if(a.kind!=='sheep')throw new Error('Use shears on an adult sheep.');
  if(a.adultAt>s.time)throw new Error('Let this lamb grow before shearing it.');
  if(a.sheared)throw new Error('Wool regrows after this sheep grazes on grass.');
  if(s.mode!=='creative'&&!(p.inventory[SHEARS]>0))throw new Error('Craft and select shears first.');
  if((p.inventory[WOOL]??0)+3>stackLimit(s.terrainVersion,WOOL))throw new Error('Make room for three wool before shearing.');
  p.inventory[WOOL]=(p.inventory[WOOL]??0)+3;a.sheared=true;a.grazeAt=s.time+60;emitSound(s,'harvest',a);p.message='Sheared three wool. Leave grass in the pen so its coat can regrow.';
}
export function fertilize(s:State,p:Actor,i:number,set:Edit){
  if(s.mode!=='creative'&&!(p.inventory[BONE_MEAL]>0))throw new Error('Craft bone meal from bones first.');
  const c=coords(i),farm=s.farms.find(f=>f.i===i);
  if(read(s.grid,i)===FARMLAND&&farm){
    if(farm.readyAt<=s.time)throw new Error('This crop is ripe. Harvest it first.');
    if(block(s.grid,c.x,c.y+1,c.z)!==0)throw new Error('Clear the block above the crop before fertilizing.');
    farm.readyAt=Math.max(s.time,farm.readyAt-120);
  }else if(read(s.grid,i)===1&&block(s.grid,c.x,c.y+1,c.z)===0){
    // One guaranteed tuft makes grass renewable without adding a separate vegetation timer.
    if(!set(s,index(c.x,c.y+1,c.z),SHORT_GRASS))throw new Error('World edit limit reached. The bone meal was kept.');
  }else throw new Error('Use bone meal on a growing crop or clear grass block.');
  if(s.mode!=='creative')p.inventory[BONE_MEAL]--;emitSound(s,'plant',c);p.message=farm?'Fertilized the crop.':'Short grass grew. Break grass tufts to find wheat seeds.';
}
export function graze(s:State,a:Animal,set:Edit){
  if(!a.sheared||a.kind!=='sheep'||a.adultAt>s.time||s.time<(a.grazeAt??0))return;
  const x=Math.floor(a.x),y=Math.floor(a.y)-1,z=Math.floor(a.z),i=index(x,y,z);
  if(block(s.grid,x,y,z)===1&&set(s,i,2)){a.sheared=false;delete a.grazeAt;emitSound(s,'eat',a);}
}
// Sparse, deterministic checks restore grass from neighboring grass, preserving player builds.
export function spreadGrass(s:State,dt:number,set:Edit){
  if(Math.floor(s.time/10)===Math.floor((s.time-dt)/10))return;
  for(const [i,b]of s.edits)if(b===2&&hash(i,Math.floor(s.time/10),s.seed)<.15){const c=coords(i);if(!activeArea(s,c)||block(s.grid,c.x,c.y+1,c.z)!==0)continue;if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>block(s.grid,c.x+dx!,c.y,c.z+dz!)===1))set(s,i,1);}
}
