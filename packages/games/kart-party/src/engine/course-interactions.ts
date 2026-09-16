import { COURSE_DESIGNS } from './course-designs';
import { routeNearest, routeSample } from './course-routes';
import type { GateSpec, ZoneSpec } from './courses/spec';
import { groundHeight, mod, nearest, sample, type Track } from './tracks';
import { recordContact } from './contact-feedback';
import type { Race, Racer } from './types';

export const zoneActive=(zone:ZoneSpec,time:number)=>!zone.period||mod(time+(zone.phase??0),zone.period)<(zone.activeFor??zone.period);
export const gateOpen=(gate:GateSpec,time:number)=>mod(time+gate.phase,gate.period)<gate.openFor;
export const racerRoute=(track:Track,racer:Pick<Racer,'routeId'>)=>COURSE_DESIGNS[track.id].routes.find(route=>route.id===racer.routeId);
export function routeLocation(track:Track,racer:Racer){
  let route=racerRoute(track,racer);
  if(!route&&!racer.airborne&&racer.loopDistance===undefined){
    const main=nearest(track,racer.x,racer.z);
    for(const candidate of COURSE_DESIGNS[track.id].routes){
      if(main.s<candidate.from||main.s>candidate.from+Math.min(.4*(candidate.to-candidate.from),60/track.length))continue;
      const p=routeNearest(track,candidate,racer.x,racer.z);
      if(main.distance>track.width/2-2&&p.distance<main.distance-.15&&p.distance<candidate.width/2&&Math.abs(routeSample(track,candidate,p.s).y-racer.y)<3){route=candidate;racer.routeId=route.id;break;}
    }
  }
  if(!route)return null;
  const location=routeNearest(track,route,racer.x,racer.z);
  if(location.s>=route.to-.6/track.length){delete racer.routeId;return null;}
  return {...location,route};
}
export function routeBotTarget(track:Track,racer:Racer,time:number,lookahead:number){
  if(racer.airborne||racer.loopDistance!==undefined)return null;
  const active=racerRoute(track,racer);
  const preferred=active??COURSE_DESIGNS[track.id].routes.find(route=>racer.driver%2===0&&(mod(route.from-racer.s)*track.length<65||racer.s>=route.from&&racer.s<route.from+Math.min(.4*(route.to-route.from),60/track.length)));
  if(!preferred)return null;
  if(!active&&COURSE_DESIGNS[track.id].zones.some(zone=>zone.routeId===preferred.id&&zone.kind==='water'&&zoneActive(zone,time+2)))return null;
  // Aim down the fork early enough to physically enter it, then follow its own tangent.
  const s=active?racer.s+lookahead/track.length:Math.max(racer.s+lookahead/track.length,preferred.from+24/track.length);
  return {route:preferred,point:routeSample(track,preferred,Math.min(s,preferred.to))};
}
export function applyRouteZones(race:Race,racer:Racer,track:Track,offset:number,dt:number){
  if(racer.airborne||racer.loopDistance!==undefined||racer.finishTime!==null)return;
  for(const zone of COURSE_DESIGNS[track.id].zones){
    if(zone.routeId!==racer.routeId||racer.s<zone.from||racer.s>zone.to||Math.abs(offset-zone.offset)>zone.width/2||!zoneActive(zone,race.time))continue;
    if(zone.kind==='water'&&racer.star<=0){racer.speed*=Math.exp(-zone.strength*dt);racer.oil=Math.max(racer.oil,.2);}
    if(zone.kind==='rough'&&racer.star<=0)racer.speed*=Math.exp(-zone.strength*dt);
    if(zone.kind==='conveyor'){racer.speed=Math.min(65,racer.speed+zone.strength*dt);racer.boost=Math.max(racer.boost,.2);}
    if(zone.kind==='wind')racer.lateral+=zone.strength*dt;
  }
}
export function resolveCourseGates(race:Race,racer:Racer,track:Track,previousS=racer.s){
  if(racer.finishTime!==null)return;
  for(const gate of COURSE_DESIGNS[track.id].gates){
    if(gate.routeId!==racer.routeId||gateOpen(gate,race.time)||Math.abs(racer.s-gate.s)*track.length>12)continue;
    const route=racerRoute(track,racer),p=route?routeSample(track,route,gate.s,gate.offset):sample(track,gate.s,gate.offset);
    if(racer.y>p.y+gate.height||racer.y+2<p.y)continue;
    const dx=racer.x-p.x,dz=racer.z-p.z,along=dx*Math.sin(p.heading)+dz*Math.cos(p.heading),across=dx*Math.cos(p.heading)-dz*Math.sin(p.heading);
    const crossed=(previousS-gate.s)*(racer.s-gate.s)<0&&Math.abs(racer.s-previousS)*track.length<10;
    if(Math.abs(along)>=1.85&&!crossed||Math.abs(across)>gate.width/2+1.75)continue;
    const side=previousS<=gate.s?-1:1,closing=-side*(racer.speed*Math.cos(racer.heading-p.heading)+racer.lateral*Math.sin(p.heading-racer.heading));
    racer.x+=Math.sin(p.heading)*(side*1.85-along);racer.z+=Math.cos(p.heading)*(side*1.85-along);
    if(closing>0){recordContact(race,racer,closing);racer.speed=Math.max(0,racer.speed-closing);racer.lateral*=.4;}
    racer.s=(route?routeNearest(track,route,racer.x,racer.z):nearest(track,racer.x,racer.z)).s;
  }
}
/** Clear a deck-sized corridor in terrain and scenery, including lowered coastal shelves. */
export function branchClearance(track:Track,x:number,z:number,margin=0){
  return COURSE_DESIGNS[track.id].routes.some(route=>routeNearest(track,route,x,z).distance<route.width/2+margin);
}
export function routeGroundHeight(track:Track,x:number,z:number){
  let height=groundHeight(track,x,z);
  for(const route of COURSE_DESIGNS[track.id].routes){const p=routeNearest(track,route,x,z);if(p.distance<route.width/2+6)height=Math.min(height,routeSample(track,route,p.s).y-2);}
  return height;
}
