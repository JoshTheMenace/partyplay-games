import { createMagneticRoad, sampleMagneticRoad, type MagneticRoad } from './magnetic-road';
import type { LoopFrame } from './vertical-loop';
import type { TrackId } from './types';

export type Sector={from:number;to:number;name:string;theme:string;color:string;grip:number;speed:number;gravity:number;bridge?:boolean};
export type Ramp={s:number;length:number;width:number;height:number;launch:number};
export type Tunnel={from:number;to:number;color:string};
type Point = { x: number; y: number; z: number; s: number; heading: number };
export type Track = { magnetic?:MagneticRoad; id: TrackId; name: string; subtitle: string; color: string; sky: string; ground: string; width: number; shoulder?:number; length: number; points: Point[]; gates: number; boosts: number[]; boxes: number[]; coins: {s:number;offset:number}[];sectors:Sector[];ramps:Ramp[];tunnels:Tunnel[] };
const DEFINITIONS = {
  coast: { name: 'Seabreeze Circuit', subtitle: 'Sunshine. Sea spray. Full throttle.', color: '#47dce9', sky: '#91dce9', ground: '#67ba70', width: 18, nodes: [[0,3,-110],[85,4,-110],[135,8,-55],[115,26,20],[145,35,90],[70,30,130],[-10,15,100],[-80,12,140],[-135,5,70],[-95,4,5],[-140,6,-65],[-70,3,-115]] },
  canyon: { name: 'Copper Canyon', subtitle: 'Big bends. Bigger boosts.', color: '#ffb05b', sky: '#f8c49b', ground: '#ba6f49', width: 18, nodes: [[0,8,-145],[95,18,-150],[150,40,-105],[135,62,-45],[45,75,-35],[25,67,10],[135,45,45],[155,30,110],[80,18,155],[-10,35,115],[-90,55,155],[-150,82,90],[-135,95,10],[-65,72,-5],[-55,42,-65],[-140,20,-85],[-105,8,-145]] },
  midnight: { name: 'Starlight Speedway', subtitle: 'Chase the city after dark.', color: '#c290ff', sky: '#10182e', ground: '#202b4a', width: 17, nodes: [[0,6,-155],[125,9,-155],[165,22,-100],[160,48,-20],[100,62,25],[155,65,85],[155,46,150],[30,18,155],[-100,8,155],[-150,10,105],[-150,22,0],[-80,38,-15],[-80,48,65],[-15,46,65],[-15,30,-45],[-75,18,-80],[-150,12,-85],[-145,6,-145],[-65,6,-155]] },
  rainbow: { name: 'Rainbow Road', subtitle: 'Prismatic climbs. Cosmic velocity.', color: '#ff8edb', sky: '#050619', ground: '#191d50', width: 22, nodes: [[-80,125,-180],[30,138,-180],[140,175,-160],[190,215,-95],[160,250,-20],[200,265,60],[180,235,150],[90,195,190],[10,165,160],[-15,145,85],[35,130,35],[5,150,-25],[-60,190,-15],[-95,220,65],[-150,230,120],[-205,210,65],[-180,175,-30],[-210,140,-115],[-170,120,-180]] },
} satisfies Record<TrackId, { name: string; subtitle: string; color: string; sky: string; ground: string; width: number; nodes: number[][] }>;

const sector=(from:number,to:number,name:string,theme:string,color:string,grip=1,speed=1,gravity=24,bridge=false):Sector=>({from,to,name,theme,color,grip,speed,gravity,bridge});
const FEATURES:Record<TrackId,{sectors:Sector[];ramps:Ramp[];tunnels:Tunnel[]}>= {
  coast:{sectors:[sector(0,.23,'Sunfish Harbor','harbor','#6ac8b3'),sector(.23,.47,'Lighthouse Cliffs','cliffs','#b4be7d'),sector(.47,.73,'Emerald Falls','jungle','#328b57'),sector(.73,1,'Sunset Boardwalk','boardwalk','#d6be86',.86,.97,24,true)],ramps:[{s:.13,length:14,width:10,height:3,launch:7},{s:.42,length:16,width:11,height:4,launch:8},{s:.86,length:12,width:9,height:2.7,launch:6}],tunnels:[]},
  canyon:{sectors:[sector(0,.26,'Red Mesa Climb','mesa','#b66a43'),sector(.26,.47,'Copper Mine','mine','#8d634b'),sector(.47,.68,'Eagle Gorge','gorge','#ca8e63',1,1,24,true),sector(.68,1,'Lost Temple','ruins','#d3ac78',.72,.92)],ramps:[{s:.2,length:16,width:11,height:4.5,launch:8},{s:.52,length:18,width:12,height:5,launch:9},{s:.885,length:14,width:10,height:3.5,launch:7}],tunnels:[{from:.29,to:.34,color:'#976447'}]},
  midnight:{sectors:[sector(0,.24,'Neon Downtown','downtown','#243250'),sector(.24,.44,'Cloudline Skyway','skyway','#354f75',1.05,1.04,24,true),sector(.44,.65,'Moon Blossom Park','garden','#29505a'),sector(.65,1,'Low-G Reactor','reactor','#2e315b',.9,1,13)],ramps:[{s:.31,length:18,width:12,height:4.5,launch:8},{s:.5,length:16,width:11,height:4,launch:9},{s:.9375,length:14,width:10,height:3,launch:7}],tunnels:[{from:.74,to:.79,color:'#7355bf'}]},
  rainbow:{sectors:[sector(0,.26,'Prism Ascent','prism','#bd58ee',1.08,1,24),sector(.26,.48,'Saturn Slingshot','saturn','#e893c5',1.12,1.03,24),sector(.48,.73,'Aurora Cathedral','aurora','#50dedb',1.14,1,20),sector(.73,1,'Meteor Sprint','meteor','#b086ff',1.1,1.05,24)],ramps:[{s:.12,length:20,width:15,height:3.2,launch:6},{s:.4,length:22,width:16,height:3.6,launch:6},{s:.83,length:20,width:15,height:3.2,launch:6}],tunnels:[]},
};

export const mod = (n: number, m = 1) => ((n % m) + m) % m;
export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export const angleDelta = (a: number, b: number) => mod(a - b + Math.PI, Math.PI * 2) - Math.PI;
const spline = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((2*b) + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t);
function build(id: TrackId): Track {
  const def = DEFINITIONS[id], raw: number[][] = [],scale={coast:1.8,canyon:1.6,midnight:1.6,rainbow:1.5}[id];
  for (let i = 0; i < 768; i++) {
    const f = i / 768 * def.nodes.length, k = Math.floor(f), t = f-k;
    raw.push([0,1,2].map(axis => {const value=spline(...[-1,0,1,2].map(offset => def.nodes[mod(k+offset, def.nodes.length)][axis]) as [number,number,number,number], t)*(axis===1?1.4:scale);return axis===1?(id==='rainbow'?168+(value-168)*.88*scale/3:value*scale/3):value;}));
  }
  const lengths = [0];
  for (let i=1;i<=raw.length;i++) lengths.push(lengths[i-1]+Math.hypot(raw[i%raw.length][0]-raw[i-1][0], raw[i%raw.length][2]-raw[i-1][2]));
  const length = lengths.at(-1)!;
  const points: Point[] = [];
  let cursor=0;
  for(let i=0;i<384;i++) {
    const distance=i/384*length;
    while(lengths[cursor+1]<distance) cursor++;
    const t=(distance-lengths[cursor])/(lengths[cursor+1]-lengths[cursor]), a=raw[cursor], b=raw[(cursor+1)%raw.length];
    points.push({x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,z:a[2]+(b[2]-a[2])*t,s:i/384,heading:0});
  }
  for(let i=0;i<points.length;i++) {const a=points[mod(i-1,points.length)],b=points[(i+1)%points.length];points[i].heading=Math.atan2(b.x-a.x,b.z-a.z);}
  return {id,...def,...FEATURES[id],length,points,gates:16,...(id==='rainbow'?{shoulder:1.5,boosts:[.035,.21,.32,.455,.585,.735,.945],boxes:[.065,.235,.43,.60,.79,.93]}:{boosts:[.18,.51,.79],boxes:[.09,.34,.62,.87]}),coins:Array.from({length:id==='rainbow'?108:72},(_,i)=>({s:(Math.floor(i/3)+.5)/(id==='rainbow'?36:24)+i%3*2.5/length,offset:Math.sin(Math.floor(i/3)*1.7)*3}))};
}
const addLoop=(track:Track)=>{
  const baseFrom=.49,baseTo=.70,a=sample(track,baseFrom),b=sample(track,baseTo),route=createMagneticRoad(a,b,a.heading,b.heading),baseLength=track.length;
  track.length+=route.length-(baseTo-baseFrom)*baseLength;
  track.magnetic={...route,baseFrom,baseTo,baseLength,from:baseFrom*baseLength/track.length,to:(baseFrom*baseLength+route.length)/track.length};
  const remap=(s:number)=>s===1?1:s<baseFrom?s*baseLength/track.length:(s<baseTo?baseFrom*baseLength+(s-baseFrom)/(baseTo-baseFrom)*route.length:s*baseLength+route.length-(baseTo-baseFrom)*baseLength)/track.length;
  track.sectors=track.sectors.map(v=>({...v,from:remap(v.from),to:remap(v.to)}));track.ramps=track.ramps.map(v=>({...v,s:remap(v.s)}));track.boosts=track.boosts.map(remap);track.boxes=track.boxes.map(remap);track.coins=track.coins.map(v=>({...v,s:remap(v.s)}));return track;
};
export const TRACKS: Record<TrackId,Track> = { coast:build('coast'),canyon:build('canyon'),midnight:build('midnight'),rainbow:addLoop(build('rainbow')) };
export function bankAt(track:Track,s:number){
  if(track.id!=='rainbow'||magneticAt(track,s))return 0;
  const fade=track.magnetic?Math.min(1,Math.min(Math.abs(s-track.magnetic.from),Math.abs(s-track.magnetic.to))*track.length/20):1;
  s=baseProgress(track,s);
  const f=mod(s)*track.points.length,i=Math.floor(f),t=f-i;
  const bend=(index:number)=>clamp(-angleDelta(track.points[mod(index+2,track.points.length)].heading,track.points[mod(index-2,track.points.length)].heading)/(4*track.length/track.points.length)*18,-.18,.18);
  return (bend(i)*(1-t)+bend(i+1)*t)*fade;
}
export function magneticAt(track:Track,s:number){return !!track.magnetic&&mod(s)>=track.magnetic.from&&mod(s)<=track.magnetic.to;}
function baseProgress(track:Track,s:number){const m=track.magnetic,d=mod(s)*track.length;return !m?mod(s):d<m.from*track.length?d/m.baseLength:(d-m.length+(m.baseTo-m.baseFrom)*m.baseLength)/m.baseLength;}
export function surfaceFrame(track:Track,s:number,offset=0,lift=0):LoopFrame{
  if(magneticAt(track,s))return sampleMagneticRoad(track.magnetic!,(mod(s)-track.magnetic!.from)*track.length,offset,lift);
  const p=sample(track,s,offset),bank=bankAt(track,s),slope=(sample(track,s+.5/track.length).y-sample(track,s-.5/track.length).y),norm=Math.hypot(1,slope),forward={x:Math.sin(p.heading)/norm,y:slope/norm,z:Math.cos(p.heading)/norm};
  const flatRight={x:Math.cos(p.heading),y:0,z:-Math.sin(p.heading)},flatUp={x:forward.y*flatRight.z,y:forward.z*flatRight.x-forward.x*flatRight.z,z:-forward.y*flatRight.x};
  const right={x:flatRight.x*Math.cos(bank)+flatUp.x*Math.sin(bank),y:flatUp.y*Math.sin(bank),z:flatRight.z*Math.cos(bank)+flatUp.z*Math.sin(bank)},up={x:forward.y*right.z-forward.z*right.y,y:forward.z*right.x-forward.x*right.z,z:forward.x*right.y-forward.y*right.x};
  return {position:{x:p.x+up.x*lift,y:p.y+up.y*lift,z:p.z+up.z*lift},forward,right,up,distance:mod(s)*track.length,fraction:mod(s)};
}
export function sample(track: Track, s: number, offset=0): Point {
  if(magneticAt(track,s)){const f=surfaceFrame(track,s,offset);return {...f.position,s:mod(s),heading:Math.atan2(f.forward.x,f.forward.z)};}
  const f=mod(baseProgress(track,s))*track.points.length, i=Math.floor(f),t=f-i,a=track.points[i],b=track.points[(i+1)%track.points.length];
  const heading=a.heading+angleDelta(b.heading,a.heading)*t;
  return {x:a.x+(b.x-a.x)*t+Math.cos(heading)*offset,y:a.y+(b.y-a.y)*t+Math.tan(bankAt(track,s))*offset,z:a.z+(b.z-a.z)*t-Math.sin(heading)*offset,s:mod(s),heading};
}
export function nearest(track: Track,x: number,z: number) {
  let best=Infinity,result={s:0,offset:0,distance:0};
  for(let i=0;i<track.points.length;i++) {
    if(track.magnetic&&i/track.points.length>=track.magnetic.baseFrom-1/track.points.length&&i/track.points.length<=track.magnetic.baseTo)continue;
    const a=track.points[i],b=track.points[(i+1)%track.points.length],dx=b.x-a.x,dz=b.z-a.z;
    const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),px=a.x+dx*t,pz=a.z+dz*t,d=(x-px)**2+(z-pz)**2;
    if(d<best) {best=d;result={s:mod((i+t)/track.points.length),offset:((x-px)*dz-(z-pz)*dx)/Math.hypot(dx,dz),distance:Math.sqrt(d)};}
  }
  const m=track.magnetic;if(m){const base=result.s;result.s=(base*m.baseLength+(base>=m.baseTo?m.length-(m.baseTo-m.baseFrom)*m.baseLength:0))/track.length;}
  return result;
}
export function groundHeight(track:Track,x:number,z:number) {
  if(track.id==='rainbow')return -900;
  const p=nearest(track,x,z),road=sample(track,p.s),wave=Math.sin(x*.018)*Math.cos(z*.016);
  // Coarse terrain triangles need a wide flat shoulder to stay below the road.
  let y=road.y-.65+clamp((p.distance-track.width/2-24)/45,0,1)*wave*(track.id==='canyon'?13:4);
  if(track.id==='coast')y-=Math.max(0,p.distance-65)*.28;
  else if(track.id==='canyon')y+=Math.max(0,p.distance-45)*.12;
  const sector=sectorAt(track,p.s);
  if(sector.bridge)y-=Math.sin((p.s-sector.from)/(sector.to-sector.from)*Math.PI)**2*(track.id==='coast'?18:track.id==='canyon'?48:42);
  return Math.max(track.id==='canyon'?-25:-15,y);
}

export function sectorAt(track:Track,s:number){return track.sectors.find(sector=>mod(s)>=sector.from&&mod(s)<sector.to)??track.sectors[0];}
export function rampAt(track:Track,s:number,offset=0){return track.ramps.find(ramp=>mod(s-ramp.s)*track.length<=ramp.length&&Math.abs(offset)<=ramp.width/2);}
export function rampHeight(track:Track,s:number,offset=0){const ramp=rampAt(track,s,offset);return ramp?ramp.height*Math.pow(clamp(mod(s-ramp.s)*track.length/ramp.length,0,1),1.2):0;}
export function roadHeight(track:Track,s:number,offset=0){return sample(track,s,offset).y+rampHeight(track,s,offset);}
