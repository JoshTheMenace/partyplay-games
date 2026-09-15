import { hit } from './items';
import { statsFor } from './race-stats';
import type { Race,Racer } from './types';

const DIAMETER=2.5;
const velocity=(racer:Racer)=>({x:Math.sin(racer.heading)*racer.speed+Math.cos(racer.heading)*racer.lateral,z:Math.cos(racer.heading)*racer.speed-Math.sin(racer.heading)*racer.lateral});
function applyVelocity(racer:Racer,x:number,z:number){
  racer.speed=Math.max(0,x*Math.sin(racer.heading)+z*Math.cos(racer.heading));
  racer.lateral=Math.max(-18,Math.min(18,x*Math.cos(racer.heading)-z*Math.sin(racer.heading)));
}
export function recordContact(race:Race,a:Racer,b:Racer,intensity:number){
  if(intensity<.08||(a.contactCooldown??0)>0||(b.contactCooldown??0)>0)return;
  a.contactCooldown=b.contactCooldown=.24;statsFor(a).collisions++;statsFor(b).collisions++;
  for(const [racer,other] of [[a,b],[b,a]] as const)race.events.push({id:++race.serial,type:'contact',racer:racer.id,source:other.id,time:race.time,intensity});
  while(race.events.length>24)race.events.shift();
}
export function resolveGroundContact(race:Race,a:Racer,b:Racer){
  if(a.finishTime!==null||b.finishTime!==null||Math.abs(a.y-b.y)>=2.5)return false;
  const dx=b.x-a.x,dz=b.z-a.z,distance=Math.hypot(dx,dz);if(distance>=DIAMETER)return false;
  const fallback=(a.driver-b.driver||1)*2.17,nx=distance>.001?dx/distance:Math.sin(fallback),nz=distance>.001?dz/distance:Math.cos(fallback);
  const overlap=DIAMETER-Math.max(distance,.001),aShare=b.speed/(a.speed+b.speed+.01)*.5+.25,bShare=1-aShare;
  a.x-=nx*overlap*aShare;a.z-=nz*overlap*aShare;b.x+=nx*overlap*bShare;b.z+=nz*overlap*bShare;
  if(a.star>0)hit(race,b,'stun',a.id);if(b.star>0)hit(race,a,'stun',b.id);
  const av=velocity(a),bv=velocity(b),closing=(av.x-bv.x)*nx+(av.z-bv.z)*nz;
  if(closing>0){const impulse=closing*.64;applyVelocity(a,av.x-nx*impulse,av.z-nz*impulse);applyVelocity(b,bv.x+nx*impulse,bv.z+nz*impulse);recordContact(race,a,b,Math.min(1,closing/18));}
  return true;
}
