import { CAMPFIRE, coords, solid, type Player, type View } from './model';
import { block } from './terrain';
import { SoundCursor, type SoundEvent } from './sound-events';

export type Point={x:number;y:number;z:number};
export type Cue={name:string;at?:Point;gain?:number;rate?:number;range?:number};
export type Loop=Cue&{id:string};
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function spatial(listener:Point&{yaw:number},source:Point,range=22){
 const d=distance(listener,source),dx=source.x-listener.x,dz=source.z-listener.z;
 return {gain:Math.max(0,1-d/range)**2,pan:(dx*Math.cos(listener.yaw)-dz*Math.sin(listener.yaw))/Math.max(1,Math.hypot(dx,dz))};
}
export function material(b:number){
 if([4,10,28,30,35,43].includes(b))return 'wood';
 if([1,5,20,45,64,65,66].includes(b))return 'grass';
 if([2,7,19,32,47].includes(b))return 'snow';
 if([21,22,31,46].includes(b))return 'cloth';
 return b===11?'glass':b===23||b===12?'metal':'stone';
}
const impact=(b:number)=>{const m=material(b);return `impact-${['grass','snow','cloth'].includes(m)?'soft':m}`;};
export function eventCue(e:SoundEvent,playerId?:string):Cue{
 const base=e.playerId===playerId&&playerId?{gain:.6}:{at:e,gain:.6};
 switch(e.kind){
  case 'break':return {...base,name:impact(e.block??3),rate:.9};
  case 'place':return {...base,name:impact(e.block??3),gain:.38,rate:1.2};
  case 'hit':case 'hurt':case 'death':return {...base,name:e.mob&&e.mob!=='creeper'?e.mob:'impact-hit',gain:.7,rate:e.kind==='death'?.7:1};
  case 'bow':return {...base,name:'bow'};
  case 'arrow':return {...base,name:'impact-wood',rate:1.4};
  case 'explode':return {...base,name:'explode',gain:1,range:32};
  case 'eat':return {...base,name:'step-grass',rate:1.5,gain:.45};
  case 'plant':case 'harvest':return {...base,name:'step-grass',rate:1.1};
  case 'smelt':return {...base,name:'impact-stone',gain:.3};
  default:return {...base,name:e.kind};
 }
}
type Walker=Point&{stride:number;wet:boolean;ground:boolean;peak:number;mineAt:number};
// Derive continuous sounds from movement, never from a held movement button.
export class WorldSoundTracker{
 private cursor=new SoundCursor();
 private time=-1;
 private walkers=new Map<string,Walker>();
 private voices=new Map<number,number>();
 private fires:Point[]=[];
 private revision=-1;
 update(v:View,grid:Uint8Array,listener:Player,reset=false):{cues:Cue[];loops:Loop[];underwater:boolean}{
  reset=reset||this.time<0||v.time<this.time||v.time-this.time>2;
  if(reset){this.walkers.clear();this.voices.clear();this.revision=-1;}
  const cues=this.cursor.take(v.sounds??[],v.time,reset).map(e=>eventCue(e,listener.id)),loops:Loop[]=[];
  const changed=v.time!==this.time;this.time=v.time;
  const underwater=block(grid,listener.x,listener.y+1.4,listener.z)===6;
  for(const p of v.players){
   if(!p.connected){this.walkers.delete(p.id);continue;}
   const floor=block(grid,p.x,p.y-.08,p.z),ground=solid(floor)&&Math.abs(p.y-Math.round(p.y))<.12,wet=block(grid,p.x,p.y+.4,p.z)===6;
   const old=this.walkers.get(p.id),d=old?distance(p,old):0;
   let stride=old?.stride??0,peak=Math.max(old?.peak??p.y,p.y),mineAt=old?.mineAt??v.time;
   if(changed&&old&&d<4&&!p.flying){
    if(!ground&&old.ground&&p.y>old.y&&!wet)cues.push({name:'swish',at:p,gain:.1,rate:.85});
    if(wet!==old.wet)cues.push({name:'splash',at:p,gain:.55});
    if(ground&&!old.ground&&peak-p.y>.6&&!wet)cues.push({name:`step-${['glass','metal'].includes(material(floor))?'stone':material(floor)}`,at:p,gain:.6,rate:.8});
    if(wet||ground&&old.ground){
     stride+=Math.hypot(p.x-old.x,p.z-old.z);
     if(stride>(wet?1.6:1.35)){
      cues.push({name:wet?'splash':`step-${['glass','metal'].includes(material(floor))?'stone':material(floor)}`,at:p,gain:p.sneaking?.06:wet?.22:.3,rate:wet?.85:1});stride=0;
     }
    }
    if(p.progress>0&&p.target!==null&&v.time-mineAt>.26){cues.push({name:impact(grid[p.target]??3),at:coords(p.target),gain:.2,rate:1.15});mineAt=v.time;}
   }else if(d>=4){stride=0;peak=p.y;}
   if(ground||wet||p.flying)peak=p.y;
   this.walkers.set(p.id,{x:p.x,y:p.y,z:p.z,stride,wet,ground,peak,mineAt});
  }
  for(const id of this.walkers.keys())if(!v.players.some(p=>p.id===id))this.walkers.delete(id);
  const vocalists=[...v.creatures,...(v.animals??[]).map(a=>({...a,id:-a.id,fuse:0}))];
  for(const c of vocalists){
   const near=distance(listener,c)<18;
   if(c.kind==='creeper'){
    if((c.fuse??0)>0&&near)loops.push({id:`fuse-${c.id}`,name:'fuse',at:c,gain:.4,rate:1+(c.fuse??0)*.25,range:18});
   }else{
    const due=this.voices.get(c.id)??v.time+2+(Math.abs(c.id)%7)*.6;
    if(near&&v.time>=due&&!reset){cues.push({name:c.kind??'zombie',at:c,gain:.38,range:18});this.voices.set(c.id,v.time+5+(Math.abs(c.id)%5));}
    else this.voices.set(c.id,due);
   }
  }
  for(const id of this.voices.keys())if(!vocalists.some(c=>c.id===id))this.voices.delete(id);
  if(v.revision!==this.revision){this.fires=v.edits.filter(([,b])=>b===CAMPFIRE).map(([i])=>coords(i));this.revision=v.revision;}
  const fire=[...this.fires,...(v.burningFurnaces??[]).map(coords)].filter(p=>distance(listener,p)<12).sort((a,b)=>distance(listener,a)-distance(listener,b))[0];
  if(fire)loops.push({id:'fire',name:'fire',at:fire,gain:.2,range:12});
  if(underwater)loops.push({id:'water',name:'water',gain:.12});
  return {cues:reset?[]:cues.filter(c=>!c.at||spatial(listener,c.at,c.range).gain>.002),loops:reset?[]:loops.slice(0,5),underwater};
 }
}
