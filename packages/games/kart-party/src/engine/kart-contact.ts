import { hit } from './items';
import { resolveLoopContact } from './loop-contact';
import type { Race, Racer } from './types';

/** Equal-mass, mildly elastic contact; resolve velocity only while approaching. */
export function resolveKartContact(race:Race,a:Racer,b:Racer){
  if(resolveLoopContact(race,a,b)||a.finishTime!==null||b.finishTime!==null||Math.abs(a.y-b.y)>=2.5)return;
  const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
  if(d>=2.5)return;
  const nx=d>.0001?dx/d:Math.cos(a.heading)*(a.id<b.id?1:-1),nz=d>.0001?dz/d:-Math.sin(a.heading)*(a.id<b.id?1:-1),push=(2.5-d)/2;
  a.x-=nx*push;a.z-=nz*push;b.x+=nx*push;b.z+=nz*push;
  const velocity=(r:Racer)=>({x:Math.sin(r.heading)*r.speed+Math.cos(r.heading)*r.lateral,z:Math.cos(r.heading)*r.speed-Math.sin(r.heading)*r.lateral});
  const av=velocity(a),bv=velocity(b),closing=(av.x-bv.x)*nx+(av.z-bv.z)*nz;
  if(closing>0){
    const impulse=closing*.6;
    for(const [r,sign] of [[a,-1],[b,1]] as const){r.speed=Math.max(0,r.speed+sign*impulse*(nx*Math.sin(r.heading)+nz*Math.cos(r.heading)));r.lateral+=sign*impulse*(nx*Math.cos(r.heading)-nz*Math.sin(r.heading));}
  }
  if(a.star>0)hit(race,b);if(b.star>0)hit(race,a);
}
