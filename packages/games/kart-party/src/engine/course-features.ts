import { angleDelta, clamp, mod, sample, rampHeight, type Track } from './tracks';
import type { Racer, TrackId } from './types';

export type CourseObstacle={kind:'buoy'|'boulder'|'traffic'|'satellite';s:number;offset:number;radius:number;height:number};
export type CourseLane={s:number;length:number;offset:number;width:number;kind:'water'|'express'|'launch'};
export const COURSE_LANES:Record<TrackId,CourseLane[]>={
  coast:[{s:.055,length:40,offset:-3.8,width:6,kind:'water'},{s:.60,length:46,offset:3.8,width:6,kind:'water'}],
  canyon:[],
  midnight:[{s:.10,length:72,offset:-4.5,width:3.5,kind:'express'},{s:.34,length:65,offset:4.5,width:3.5,kind:'express'}],
  rainbow:[{s:.19,length:24,offset:-5,width:4,kind:'launch'},{s:.77,length:24,offset:5,width:4,kind:'launch'}],
};
export const COURSE_GUIDES:Record<TrackId,string>={
  coast:'Buoy chicanes · tidal slicks: take the dry lane for grip.',
  canyon:'Boulder crossings · rock slalom: watch the striped crossing zones.',
  midnight:'Moving delivery traffic · green express lanes: pass, then boost.',
  rainbow:'Orbiting satellites · cyan launch lanes · magnetic loop.',
};
/** Shared by the authoritative simulation and renderer, using race seconds. */
export function courseObstacles(track:Track,time:number):CourseObstacle[]{
  switch(track.id){
    case 'coast':return [.80,.825,.85].map((s,i)=>({kind:'buoy',s,offset:i%2?-3.5:3.5,radius:1.65,height:2.5}));
    case 'canyon':return [
      ...[.16,.39,.60].map((s,i)=>({kind:'boulder' as const,s,offset:Math.sin(time*.65+i*2.1)*(track.width/2+2.5),radius:2,height:4})),
      ...[.76,.785,.81].map((s,i)=>({kind:'boulder' as const,s,offset:i%2?-4:4,radius:2,height:4})),
    ];
    case 'midnight':return [.055,.15,.26].map((start,i)=>({kind:'traffic',s:mod(start+time*9/track.length),offset:i%2?-3.8:3.8,radius:2.3,height:2.5}));
    case 'rainbow':return [.24,.81,.88].map((s,i)=>({kind:'satellite',s:s+Math.cos(time*.8+i*2)*3/track.length,offset:Math.sin(time*.8+i*2)*(track.width/2+2),radius:2.6,height:3}));
  }
}
export function courseLaneAt(track:Track,racer:Racer,offset:number){
  return COURSE_LANES[track.id].find(lane=>mod(racer.s-lane.s)*track.length<lane.length&&Math.abs(offset-lane.offset)<lane.width/2);
}
/** Continuous effects are timestep-independent and apply only at road contact. */
export function applyCourseLane(track:Track,racer:Racer,offset:number,dt:number){
  if(racer.airborne||racer.loopDistance!==undefined||racer.finishTime!==null)return;
  const lane=courseLaneAt(track,racer,offset);
  if(lane?.kind==='water'&&racer.star<=0){racer.speed*=Math.exp(-.65*dt);racer.oil=Math.max(racer.oil,.25);}
  if(lane?.kind==='express')racer.boost=Math.max(racer.boost,.35);
  if(lane?.kind==='launch'&&racer.rampCooldown<=0&&racer.speed>10){racer.airborne=true;racer.verticalSpeed=8;racer.rampCooldown=2;racer.boost=Math.max(racer.boost,.8);}
}
export function resolveCourseObstacles(track:Track,racer:Racer,obstacles:CourseObstacle[]){
  let impact=0;
  if(racer.finishTime!==null||racer.loopDistance!==undefined)return impact;
  for(const obstacle of obstacles){
    if(Math.abs(angleDelta(racer.s*Math.PI*2,obstacle.s*Math.PI*2))*track.length/(Math.PI*2)>9)continue;
    const p=sample(track,obstacle.s,obstacle.offset);
    const floor=p.y+rampHeight(track,obstacle.s,obstacle.offset);
    if(racer.y>floor+obstacle.height||racer.y+2<floor)continue;
    const dx=racer.x-p.x,dz=racer.z-p.z,d=Math.hypot(dx,dz),radius=obstacle.radius+1.25;
    if(d>=radius)continue;
    // An exact-centre hit pushes toward a deterministic open side, never divides by zero.
    const nx=d>.001?dx/d:Math.cos(p.heading),nz=d>.001?dz/d:-Math.sin(p.heading);
    racer.x+=nx*(radius-d);racer.z+=nz*(radius-d);
    const closing=(Math.sin(racer.heading)*racer.speed+Math.cos(racer.heading)*racer.lateral)*nx+(Math.cos(racer.heading)*racer.speed-Math.sin(racer.heading)*racer.lateral)*nz;
    impact=Math.max(impact,-closing);
    if(closing<0){racer.speed=Math.max(0,racer.speed-closing*nx*Math.sin(racer.heading)-closing*nz*Math.cos(racer.heading));racer.lateral-=closing*(nx*Math.cos(racer.heading)-nz*Math.sin(racer.heading));}
  }
  return impact;
}
/** Steer CPUs through the same openings players see; no collision immunity. */
export function courseBotLane(track:Track,racer:Racer,time:number,lane:number){
  for(const obstacle of courseObstacles(track,time)){
    const ahead=mod(obstacle.s-racer.s)*track.length;
    if(ahead<30&&Math.abs(lane-obstacle.offset)<obstacle.radius+2)lane=clamp(obstacle.offset+(obstacle.offset>0?-1:1)*(obstacle.radius+3),-track.width/2+2,track.width/2-2);
  }
  return lane;
}
