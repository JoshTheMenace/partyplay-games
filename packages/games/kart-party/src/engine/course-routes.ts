import { angleDelta, bankAt, clamp, sample, type Track } from './tracks';
import type { RouteSpec } from './courses/spec';

const cache=new WeakMap<RouteSpec,ReturnType<typeof sample>[]>();
function profile(route:RouteSpec,t:number,key:'offset'|'lift'){
  const points=route.points;let i=0;while(i<points.length-2&&t>points[i+1].t)i++;
  const a=points[i],b=points[i+1],span=b.t-a.t,u=clamp((t-a.t)/span,0,1);
  const slope=(index:number)=>index===0||index===points.length-1?0:(points[index+1][key]-points[index-1][key])/(points[index+1].t-points[index-1].t);
  return (2*u**3-3*u*u+1)*a[key]+(u**3-2*u*u+u)*span*slope(i)+(-2*u**3+3*u*u)*b[key]+(u**3-u*u)*span*slope(i+1);
}
function center(track:Track,route:RouteSpec,s:number){
  const t=clamp((s-route.from)/(route.to-route.from),0,1),p=sample(track,clamp(s,route.from,route.to),profile(route,t,'offset'));
  p.y+=profile(route,t,'lift');return p;
}
/** Canonical progress is shared with the main road; distance and heading follow the branch itself. */
export function routeSample(track:Track,route:RouteSpec,s:number,offset=0){
  const p=center(track,route,s),a=center(track,route,s-3/track.length),b=center(track,route,s+3/track.length);
  const blend=clamp(Math.min(s-route.from,route.to-s)*track.length/3,0,1),base=sample(track,s).heading;
  p.heading=base+angleDelta(Math.atan2(b.x-a.x,b.z-a.z),base)*blend;p.x+=Math.cos(p.heading)*offset;p.z-=Math.sin(p.heading)*offset;p.y+=Math.tan(bankAt(track,s))*offset;return p;
}
export function routePoints(track:Track,route:RouteSpec){
  let points=cache.get(route);if(!points){const count=Math.ceil((route.to-route.from)*track.length/2);points=Array.from({length:count+1},(_,i)=>routeSample(track,route,route.from+(route.to-route.from)*i/count));cache.set(route,points);}return points;
}
export function routeNearest(track:Track,route:RouteSpec,x:number,z:number){
  const points=routePoints(track,route);let best=Infinity,result={s:route.from,offset:0,distance:Infinity};
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/Math.max(.0001,dx*dx+dz*dz),0,1),px=a.x+dx*t,pz=a.z+dz*t,d=(x-px)**2+(z-pz)**2;
    if(d<best){best=d;const heading=a.heading+angleDelta(b.heading,a.heading)*t;result={s:a.s+(b.s-a.s)*t,offset:(x-px)*Math.cos(heading)-(z-pz)*Math.sin(heading),distance:Math.sqrt(d)};}
  }
  return result;
}
