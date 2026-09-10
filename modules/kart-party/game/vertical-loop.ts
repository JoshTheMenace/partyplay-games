// Pure geometry. These frames are shared by road, attached-kart physics and chase cameras.
export type Vector3={x:number;y:number;z:number};
export type LoopFrame={position:Vector3;forward:Vector3;up:Vector3;right:Vector3;distance:number;fraction:number};
export type VerticalLoop={origin:Vector3;forward:Vector3;up:Vector3;right:Vector3;radius:number;advance:number;sideAdvance:number;width:number;length:number;lengths:Float64Array};
const TAU=Math.PI*2;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const add=(a:Vector3,b:Vector3,scale=1):Vector3=>({x:a.x+b.x*scale,y:a.y+b.y*scale,z:a.z+b.z*scale});
const cross=(a:Vector3,b:Vector3):Vector3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const normalize=(v:Vector3):Vector3=>{const length=Math.hypot(v.x,v.y,v.z);if(!Number.isFinite(length)||length<1e-8)throw new Error('Loop frame requires a nonzero finite vector');return {x:v.x/length,y:v.y/length,z:v.z/length};};
function local(loop:Pick<VerticalLoop,'radius'|'advance'|'sideAdvance'>,u:number){return {forward:loop.radius*Math.sin(TAU*u)+loop.advance*u,up:loop.radius*(1-Math.cos(TAU*u)),right:loop.sideAdvance*u*u*u*(10+u*(-15+6*u))};}
export function createVerticalLoop({origin,forward,radius=28,advance=70,sideAdvance=32,width=18,segments=1024}:{origin:Vector3;forward:Vector3;radius?:number;advance?:number;sideAdvance?:number;width?:number;segments?:number}):VerticalLoop{
  if(!Object.values(origin).every(Number.isFinite)||!Number.isFinite(radius)||radius<8||!Number.isFinite(advance)||advance<=width+4||advance>=TAU*radius*.85||!Number.isFinite(sideAdvance)||Math.abs(sideAdvance)<width+8||!Number.isFinite(width)||width<=2.5||!Number.isInteger(segments)||segments<128)throw new Error('Loop needs a finite origin, radius >= 8, separated portals and at least 128 arc samples');
  const tangent=normalize(forward),right=normalize(cross({x:0,y:1,z:0},tangent)),up=normalize(cross(tangent,right));
  const lengths=new Float64Array(segments+1);let previous=local({radius,advance,sideAdvance},0);
  for(let i=1;i<=segments;i++){const p=local({radius,advance,sideAdvance},i/segments);lengths[i]=lengths[i-1]+Math.hypot(p.forward-previous.forward,p.up-previous.up,p.right-previous.right);previous=p;}
  return {origin:{...origin},forward:tangent,up,right,radius,advance,sideAdvance,width,length:lengths[segments],lengths};
}
export function sampleVerticalLoop(loop:VerticalLoop,distance:number,offset=0,lift=0):LoopFrame{
  if(!Number.isFinite(distance)||!Number.isFinite(offset)||!Number.isFinite(lift))throw new Error('Loop sample must be finite');
  const travelled=clamp(distance,0,loop.length);let low=0,high=loop.lengths.length-1;
  while(high-low>1){const middle=(low+high)>>>1;if(loop.lengths[middle]<travelled)low=middle;else high=middle;}
  const u=(low+(travelled-loop.lengths[low])/(loop.lengths[high]-loop.lengths[low]))/(loop.lengths.length-1),point=local(loop,u);
  const along=TAU*loop.radius*Math.cos(TAU*u)+loop.advance,rise=TAU*loop.radius*Math.sin(TAU*u),norm=Math.hypot(along,rise);
  const forward=add({x:0,y:0,z:0},loop.forward,along/norm),planar=add(forward,loop.up,rise/norm),referenceUp=cross(planar,loop.right);
  const tangent=normalize(add(add(add({x:0,y:0,z:0},loop.forward,along),loop.up,rise),loop.right,loop.sideAdvance*30*u*u*(1-u)*(1-u)));
  const right=normalize(cross(referenceUp,tangent)),up=cross(tangent,right);
  const center=add(add(add(loop.origin,loop.forward,point.forward),loop.up,point.up),loop.right,point.right);
  return {position:add(add(center,right,offset),up,lift),forward:tangent,up,right,distance:travelled,fraction:travelled/loop.length};
}
// Magnetic attachment keeps every engine class drivable, even after braking or taking a hit.
// Caller owns throttle/brake acceleration and supplies current forward speed and lateral travel.
export function advanceVerticalLoop(loop:VerticalLoop,state:{distance:number;offset:number},forwardSpeed:number,lateralSpeed:number,dt:number){
  if(![state.distance,state.offset,forwardSpeed,lateralSpeed,dt].every(Number.isFinite)||dt<=0||dt>.05)throw new Error('Loop step must be finite and between 0 and 50ms');
  const wanted=state.distance+Math.max(0,forwardSpeed)*dt,distance=clamp(wanted,0,loop.length),offset=clamp(state.offset+lateralSpeed*dt,-loop.width/2+1.25,loop.width/2-1.25);
  return {distance,offset,frame:sampleVerticalLoop(loop,distance,offset),exited:wanted>=loop.length,remainingDistance:Math.max(0,wanted-loop.length)};
}
export function loopCamera(frame:LoopFrame,speed:number,touch=false){
  return {position:add(add(frame.position,frame.forward,-(9+Math.max(0,speed)*.055)),frame.up,5.3),target:add(add(frame.position,frame.forward,touch?2:8),frame.up,1.6),up:{...frame.up}};
}
