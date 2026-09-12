import { createVerticalLoop, sampleVerticalLoop, type LoopFrame, type Vector3 } from './vertical-loop';
export type MagneticRoad={from:number;to:number;length:number;frames:LoopFrame[];baseFrom:number;baseTo:number;baseLength:number};
export function createMagneticRoad(a:Vector3,b:Vector3,heading:number,endHeading:number){
  const forward={x:Math.sin(heading),y:0,z:Math.cos(heading)};
  const loop=createVerticalLoop({origin:a,forward,width:22,sideAdvance:36});
  const frames=Array.from({length:257},(_,i)=>sampleVerticalLoop(loop,loop.length*i/256));
  const end=frames.at(-1)!,span=Math.hypot(b.x-end.position.x,b.y-end.position.y,b.z-end.position.z);
  const tangent={x:Math.sin(endHeading),y:0,z:Math.cos(endHeading)};
  // A tangent-matched return joins the inverted ribbon back into Aurora's bends.
  let distance=loop.length;
  for(let i=1;i<=192;i++){
    const t=i/192,t2=t*t,t3=t2*t,h=[2*t3-3*t2+1,t3-2*t2+t,-2*t3+3*t2,t3-t2];
    const d=[6*t2-6*t,3*t2-4*t+1,-6*t2+6*t,3*t2-2*t];
    const position={} as Vector3,f={} as Vector3;
    for(const key of ['x','y','z'] as const){position[key]=h[0]*end.position[key]+h[1]*forward[key]*span+h[2]*b[key]+h[3]*tangent[key]*span;f[key]=d[0]*end.position[key]+d[1]*forward[key]*span+d[2]*b[key]+d[3]*tangent[key]*span;}
    const n=Math.hypot(f.x,f.y,f.z);for(const key of ['x','y','z'] as const)f[key]/=n;
    const r=Math.hypot(f.x,f.z),right={x:f.z/r,y:0,z:-f.x/r},up={x:f.y*right.z,y:f.z*right.x-f.x*right.z,z:-f.y*right.x};
    const p=frames.at(-1)!.position;distance+=Math.hypot(position.x-p.x,position.y-p.y,position.z-p.z);
    frames.push({position,forward:f,right,up,distance,fraction:0});
  }
  for(const frame of frames)frame.fraction=frame.distance/distance;
  return {frames,length:distance};
}
export function sampleMagneticRoad(road:MagneticRoad,distance:number,offset=0,lift=0):LoopFrame{
  const d=Math.max(0,Math.min(road.length,distance));let lo=0,hi=road.frames.length-1;
  while(hi-lo>1){const m=(lo+hi)>>>1;if(road.frames[m].distance<d)lo=m;else hi=m;}
  const a=road.frames[lo],b=road.frames[hi],t=(d-a.distance)/(b.distance-a.distance);
  const mix=(key:'position'|'forward'|'right'|'up')=>({x:a[key].x+(b[key].x-a[key].x)*t,y:a[key].y+(b[key].y-a[key].y)*t,z:a[key].z+(b[key].z-a[key].z)*t});
  const forward=mix('forward'),right=mix('right');
  for(const v of [forward,right]){const n=Math.hypot(v.x,v.y,v.z);v.x/=n;v.y/=n;v.z/=n;}
  const up={x:forward.y*right.z-forward.z*right.y,y:forward.z*right.x-forward.x*right.z,z:forward.x*right.y-forward.y*right.x},position=mix('position');
  for(const key of ['x','y','z'] as const)position[key]+=right[key]*offset+up[key]*lift;
  return {position,forward,right,up,distance:d,fraction:d/road.length};
}
