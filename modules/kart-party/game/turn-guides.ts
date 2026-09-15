import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { angleDelta, magneticAt, mod, sample, type Track } from './tracks';

/** Batched roadside chevrons at the strongest bends. They communicate before the HUD has to. */
export function createTurnGuides(track:Track){
  const candidates=Array.from({length:80},(_,i)=>{
    const s=(i+.5)/80,turn=angleDelta(sample(track,s+.013).heading,sample(track,s-.013).heading);
    return {s,turn,strength:Math.abs(turn)};
  }).filter(v=>v.strength>.18&&!magneticAt(track,v.s)).sort((a,b)=>b.strength-a.strength);
  const selected:typeof candidates=[];
  for(const candidate of candidates){if(selected.every(other=>Math.min(mod(candidate.s-other.s),mod(other.s-candidate.s))>.055))selected.push(candidate);if(selected.length===10)break;}
  const backing:T.BufferGeometry[]=[],arrows:T.BufferGeometry[]=[],posts:T.BufferGeometry[]=[];
  const add=(list:T.BufferGeometry[],geometry:T.BufferGeometry,position:T.Vector3,rotation:T.Euler)=>{geometry.applyMatrix4(new T.Matrix4().compose(position,new T.Quaternion().setFromEuler(rotation),new T.Vector3(1,1,1)));list.push(geometry);};
  for(const {s,turn} of selected){
    const direction=Math.sign(turn)||1,side=-direction,p=sample(track,s,side*(track.width/2+3.2)),rotation=new T.Euler(0,p.heading,0);
    add(backing,new T.BoxGeometry(4.6,3,.28),new T.Vector3(p.x,p.y+2.7,p.z),rotation);
    for(const y of [-.62,.62])add(arrows,new T.BoxGeometry(2,.42,.36),new T.Vector3(p.x+Math.cos(p.heading)*direction*.45,p.y+2.7+y,p.z-Math.sin(p.heading)*direction*.45),new T.Euler(0,p.heading,y<0?direction*.72:-direction*.72));
    for(const x of [-1.75,1.75])add(posts,new T.BoxGeometry(.22,2.6,.22),new T.Vector3(p.x+Math.cos(p.heading)*x,p.y+1.3,p.z-Math.sin(p.heading)*x),rotation);
  }
  const group=new T.Group();group.name='turn-guides';
  const merged=(list:T.BufferGeometry[],material:T.Material)=>{if(!list.length)return;const mesh=new T.Mesh(mergeGeometries(list,false)!,material);for(const geometry of list)geometry.dispose();mesh.castShadow=true;group.add(mesh);};
  merged(backing,new T.MeshStandardMaterial({color:'#10182f',roughness:.7}));
  merged(arrows,new T.MeshBasicMaterial({color:track.id==='rainbow'?'#fff2a5':'#fff6e5'}));
  merged(posts,new T.MeshStandardMaterial({color:'#ff5748',roughness:.65}));
  return group;
}
