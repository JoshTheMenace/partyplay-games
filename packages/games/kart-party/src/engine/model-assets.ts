import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadGarage(signal:AbortSignal){
  const response=await fetch('/games/kart-party/models/garage.glb',{signal});
  if(!response.ok)throw new Error(`Kart models could not load (${response.status}).`);
  return (await new GLTFLoader().parseAsync(await response.arrayBuffer(),'')).scene;
}
/** Each instance owns its render resources, so track swaps and replay can dispose safely. */
export function cloneModel(garage:T.Group,name:string){
  const source=garage.getObjectByName(name);
  if(!source)throw new Error(`Missing Kart model: ${name}`);
  const root=source.clone(true) as T.Group,materials=new Map<T.Material,T.Material>();
  root.traverse(object=>{if(object instanceof T.Mesh){object.geometry=object.geometry.clone();const copy=(mat:T.Material)=>{if(!materials.has(mat))materials.set(mat,mat.clone());return materials.get(mat)!;};object.material=Array.isArray(object.material)?object.material.map(copy):copy(object.material);object.castShadow=true;object.receiveShadow=true;}});
  return root;
}
