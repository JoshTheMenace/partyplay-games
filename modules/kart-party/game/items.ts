import { angleDelta, clamp, magneticAt, mod, nearest, roadHeight, surfaceFrame, TRACKS, type Track } from './tracks';
import type { Hazard, HitEffect, Item, Race, Racer } from './types';
import { statsFor } from './race-stats';

export const ITEMS = {
  boost: { name: 'Comet Kick', description: 'A 2.3-second burst of straight-line speed.', color: '#ff9848', icon: 'flame' },
  shell: { name: 'Seeker Beetle', description: 'Launch a beetle that homes toward a nearby rival.', color: '#8af070', icon: 'crosshair' },
  banana: { name: 'Peel Out', description: 'Drop a spinning trap behind your kart.', color: '#ffe45e', icon: 'banana' },
  shield: { name: 'Bubble Guard', description: 'Block one attack within seven seconds.', color: '#71e8ff', icon: 'shield' },
  pulse: { name: 'Thunderclap', description: 'Stun every rival within 32 metres.', color: '#db95ff', icon: 'radio' },
  triple: { name: 'Beetle Brigade', description: 'Fire three seekers that prefer different rivals.', color: '#baff70', icon: 'orbit' },
  oil: { name: 'Jelly Slick', description: 'Leave a patch that makes steering slippery for three seconds.', color: '#b78aff', icon: 'droplets' },
  frost: { name: 'Snowball Express', description: 'Fire a straight snowball that slows a rival for four seconds.', color: '#a4efff', icon: 'snowflake' },
  magnet: { name: 'Coin Comet', description: 'Pull in coins within 18 metres for eight seconds.', color: '#ffb3d1', icon: 'magnet' },
  star: { name: 'Solar Crown', description: 'Gain six seconds of speed, invincibility, and contact attacks.', color: '#fff18a', icon: 'star' },
  rocket: { name: 'Pop Rocket', description: 'Fire a fast straight rocket with a 12-metre impact burst.', color: '#ff766c', icon: 'rocket' },
  decoy: { name: 'Surprise Parcel', description: 'Drop a fake item box that stuns a rival and removes their held item.', color: '#ff83e2', icon: 'gift' },
} as const satisfies Record<Item, { name: string; description: string; color: string; icon: string }>;
export const ITEM_IDS = Object.keys(ITEMS) as Item[];
// Leading racers receive more defensive traps; trailing racers receive more recovery tools.
const WEIGHTS: Record<Item, readonly [number, number]> = {
  boost:[12,18],shell:[12,12],banana:[18,2],shield:[16,7],pulse:[3,12],triple:[2,10],
  oil:[13,3],frost:[8,7],magnet:[6,8],star:[1,12],rocket:[3,9],decoy:[14,2],
};
export function selectItem(race: Race, rank: number): Item {
  race.seed=(Math.imul(race.seed,1664525)+1013904223)>>>0;
  const behind=clamp((rank-1)/Math.max(1,race.racers.length-1),0,1);
  const weights=ITEM_IDS.map(id=>WEIGHTS[id][0]*(1-behind)+WEIGHTS[id][1]*behind);
  let draw=race.seed/4294967296*weights.reduce((sum,w)=>sum+w,0);
  for(let i=0;i<ITEM_IDS.length;i++) {draw-=weights[i];if(draw<0) return ITEM_IDS[i];}
  return ITEM_IDS[ITEM_IDS.length-1];
}
function emit(race: Race, type: Race['events'][number]['type'], racer: Racer, detail: {item?:Item;effect?:HitEffect;source?:string}={}) {
  race.events.push({id:++race.serial,type,racer:racer.id,time:race.time,...detail});
  if(race.events.length>24) race.events.shift();
}
export function hit(race: Race, racer: Racer, effect: Exclude<HitEffect,'shield'>='stun', source?:string) {
  if(racer.finishTime!==null||racer.star>0||racer.stun>0) return;
  if(racer.shield>0) {racer.shield=0;statsFor(racer).shieldsBlocked++;emit(race,'hit',racer,{effect:'shield',source});return;}
  if(effect==='frost') {racer.frost=4;racer.speed*=.6;}
  else if(effect==='oil') racer.oil=3;
  else {racer.stun=1.2;racer.speed*=.35;racer.coins=Math.max(0,racer.coins-2);if(effect==='decoy') racer.item=null;}
  racer.drift=0;racer.driftSide=0;statsFor(racer).hitsTaken++;const attacker=source&&race.racers.find(candidate=>candidate.id===source);if(attacker)statsFor(attacker).hitsDealt++;emit(race,'hit',racer,{effect,source});
}
const routeDistance=(track:Track,a:number,b:number)=>Math.abs(angleDelta(a*Math.PI*2,b*Math.PI*2))/(Math.PI*2)*track.length;
function routeNear(track:Track,a:number,b:number,radius:number){return !(magneticAt(track,a)||magneticAt(track,b))||routeDistance(track,a,b)<radius;}
function hazardPosition(track:Track,hazard:Hazard){
  if(hazard.s!==undefined)return surfaceFrame(track,hazard.s,hazard.offset??0).position;
  const location=nearest(track,hazard.x,hazard.z);return {x:hazard.x,y:roadHeight(track,location.s,location.offset),z:hazard.z};
}
function placeHazard(track:Track,hazard:Hazard){
  const frame=surfaceFrame(track,hazard.s!,hazard.offset??0);hazard.x=frame.position.x;hazard.z=frame.position.z;hazard.heading=Math.atan2(frame.forward.x,frame.forward.z);
}
export function activateItem(race: Race, racer: Racer) {
  const item=racer.item,track=TRACKS[race.track];
  if(!item||racer.finishTime!==null||racer.stun>0||racer.itemCooldown>0) return;
  racer.item=null;statsFor(racer).itemsUsed++;emit(race,'use',racer,{item});
  if(item==='boost') racer.boost=Math.max(racer.boost,2.3);
  else if(item==='shield') racer.shield=7;
  else if(item==='magnet') racer.magnet=8;
  else if(item==='star') {racer.star=6;racer.frost=0;racer.oil=0;racer.stun=0;}
  else if(item==='pulse') {
    for(const other of race.racers) if(other!==racer&&Math.hypot(other.x-racer.x,other.y-racer.y,other.z-racer.z)<32&&routeNear(track,racer.s,other.s,36)) hit(race,other,'stun',racer.id);
  } else {
    const kind=item==='triple'?'shell':item,stationary=kind==='banana'||kind==='oil'||kind==='decoy';
    const targets=race.racers.filter(r=>r!==racer&&r.finishTime===null).sort((a,b)=>Math.hypot(a.x-racer.x,a.z-racer.z)-Math.hypot(b.x-racer.x,b.z-racer.z)||a.id.localeCompare(b.id));
    for(let i=0;i<(item==='triple'?3:1);i++) {
      const heading=racer.heading+(item==='triple'?(i-1)*.25:0),ahead=stationary?-4:4;
      const hazard:Hazard={id:++race.serial,kind,owner:racer.id,x:racer.x+Math.sin(heading)*ahead,z:racer.z+Math.cos(heading)*ahead,heading,life:stationary?25:kind==='rocket'?2:7,...(item==='triple'?{target:targets[i%Math.max(1,targets.length)]?.id}:{})};
      if(magneticAt(track,racer.s)){hazard.s=mod(racer.s+ahead/track.length);hazard.offset=clamp((racer.loopOffset??0)+(item==='triple'?(i-1)*1.8:0),-track.width/2+1,track.width/2-1);placeHazard(track,hazard);}
      race.hazards.push(hazard);
    }
  }
}
export function tickStatuses(racer: Racer, dt: number) {
  for(const key of ['boost','shield','stun','itemCooldown','frost','oil','magnet','star'] as const) racer[key]=Math.max(0,racer[key]-dt);
}
function distanceToSegment(racer:Racer,a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}){
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dy*dy+dz*dz;
  const t=length?clamp(((racer.x-a.x)*dx+(racer.y-a.y)*dy+(racer.z-a.z)*dz)/length,0,1):0;
  return Math.hypot(racer.x-a.x-dx*t,racer.y-a.y-dy*t,racer.z-a.z-dz*t);
}
export function updateHazards(race: Race, dt: number) {
  const track=TRACKS[race.track];
  for(const hazard of race.hazards) {
    if(hazard.life<=0) continue;
    const before=hazardPosition(track,hazard);hazard.life-=dt;
    const speed=hazard.kind==='rocket'?85:hazard.kind==='frost'?48:hazard.kind==='shell'?53:0;let surfaceTravel=speed*dt;
    if(hazard.s===undefined&&speed&&track.magnetic){
      const entry=surfaceFrame(track,track.magnetic.from),dx=entry.position.x-before.x,dy=entry.position.y-before.y,dz=entry.position.z-before.z;
      const ahead=dx*entry.forward.x+dy*entry.forward.y+dz*entry.forward.z,lane=-(dx*entry.right.x+dy*entry.right.y+dz*entry.right.z),height=dx*entry.up.x+dy*entry.up.y+dz*entry.up.z;
      if(ahead>=-1&&ahead<=speed*dt&&Math.abs(lane)<track.width/2&&Math.abs(height)<3&&Math.sin(hazard.heading)*entry.forward.x+Math.cos(hazard.heading)*entry.forward.z>.5){surfaceTravel-=Math.max(0,ahead);hazard.s=track.magnetic.from;hazard.offset=lane;placeHazard(track,hazard);}
    }
    const sourceS=hazard.s??nearest(track,hazard.x,hazard.z).s;
    if(hazard.kind==='shell') {
      const targets=race.racers.filter(r=>!r.airborne&&r.id!==hazard.owner&&r.finishTime===null&&Math.hypot(r.x-before.x,r.y-before.y,r.z-before.z)<65&&routeNear(track,sourceS,r.s,70)&&(hazard.s===undefined||mod(r.s-sourceS)*track.length<65)).sort((a,b)=>Math.hypot(a.x-before.x,a.y-before.y,a.z-before.z)-Math.hypot(b.x-before.x,b.y-before.y,b.z-before.z)||a.id.localeCompare(b.id));
      const target=targets.find(r=>r.id===hazard.target)??targets[0];
      if(target){
        if(hazard.s!==undefined){const lane=target.loopOffset??nearest(track,target.x,target.z).offset;hazard.offset=clamp((hazard.offset??0)+clamp(lane-(hazard.offset??0),-8*dt,8*dt),-track.width/2+1,track.width/2-1);}
        else hazard.heading+=clamp(angleDelta(Math.atan2(target.x-before.x,target.z-before.z),hazard.heading),-dt*2.5,dt*2.5);
      }
    }
    if(hazard.s!==undefined){if(speed)hazard.s=mod(hazard.s+surfaceTravel/track.length);placeHazard(track,hazard);}
    else {hazard.x+=Math.sin(hazard.heading)*speed*dt;hazard.z+=Math.cos(hazard.heading)*speed*dt;}
    const after=hazardPosition(track,hazard),endS=hazard.s??nearest(track,hazard.x,hazard.z).s;
    const targets=race.racers.filter(r=>r.finishTime===null&&r.id!==hazard.owner);
    const radius=hazard.kind==='oil'?5:2.7;
    const collisions=targets.filter(r=>routeNear(track,endS,r.s,radius+speed*dt+2)&&distanceToSegment(r,before,after)<radius);
    if(hazard.kind==='rocket'&&(collisions.length||hazard.life<=0)) {
      for(const racer of targets) if(collisions.includes(racer)||(routeNear(track,endS,racer.s,16)&&Math.hypot(racer.x-after.x,racer.y-after.y,racer.z-after.z)<12)) hit(race,racer,'stun',hazard.owner);
      hazard.life=0;
    } else for(const racer of collisions) {
      if(hazard.kind==='oil') {
        hazard.affected??=[];
        if(!hazard.affected.includes(racer.id)) {hazard.affected.push(racer.id);hit(race,racer,'oil',hazard.owner);}
      } else {hit(race,racer,hazard.kind==='frost'?'frost':hazard.kind==='decoy'?'decoy':'stun',hazard.owner);hazard.life=0;break;}
    }
    if(speed&&hazard.s!==undefined&&!magneticAt(track,hazard.s)){delete hazard.s;delete hazard.offset;}
  }
  race.hazards=race.hazards.filter(h=>h.life>0).slice(-80);
}
