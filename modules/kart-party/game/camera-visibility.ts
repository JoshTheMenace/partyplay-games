import * as T from 'three';
import type {Kart} from './kart';
const materials=new WeakMap<Kart,{last:number;entries:{material:T.Material;opacity:number;transparent:boolean;depthWrite:boolean}[]}>();
export function fadeNearCamera(kart:Kart,camera:T.Camera,followed:boolean){
 let state=materials.get(kart);
 if(!state){const unique=new Set<T.Material>();kart.group.traverse(obj=>{if(obj instanceof T.Mesh)for(const m of Array.isArray(obj.material)?obj.material:[obj.material])unique.add(m);});state={last:1,entries:[...unique].map(material=>({material,opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite}))};materials.set(kart,state);}
 const distance=Math.hypot(kart.group.position.x-camera.position.x,kart.group.position.y+1.5-camera.position.y,kart.group.position.z-camera.position.z);
 const opacity=followed?1:T.MathUtils.smoothstep(distance,8,10.5);
 kart.group.visible=opacity>.001;if(state.last===opacity)return;state.last=opacity;
 for(const entry of state.entries){const {material}=entry,transparent=entry.transparent||opacity<1;material.opacity=entry.opacity*opacity;material.depthWrite=opacity<1?false:entry.depthWrite;if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}}
}
