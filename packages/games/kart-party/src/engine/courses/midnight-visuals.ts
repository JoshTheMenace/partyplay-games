import * as T from 'three';
import type { Track } from '../tracks';
import { routeSample } from '../course-routes';
import { MIDNIGHT_DESIGN } from './midnight';

/** Open freight gantries leave the conveyor, gate and merging traffic visible. */
export function createMidnightDetails(track:Track){
  const group=new T.Group(),geometry=new T.BoxGeometry(1,1,1);
  const frame=new T.MeshStandardMaterial({color:'#405c72',metalness:.65,roughness:.45});
  const neon=new T.MeshBasicMaterial({color:'#57eed0'}),cargo=new T.MeshStandardMaterial({color:'#bd853e',roughness:.85});
  const route=MIDNIGHT_DESIGN.routes[0];
  const box=(parent:T.Group,mat:T.Material,x:number,y:number,z:number,w:number,h:number,d:number)=>{
    const mesh=new T.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);parent.add(mesh);
  };
  for(const s of [.061,.075,.089]){
    const p=routeSample(track,route,s),bay=new T.Group();bay.position.set(p.x,p.y,p.z);bay.rotation.y=p.heading;
    for(const side of [-1,1]){
      box(bay,frame,side*5.8,3.7,0,.55,7.4,.65);
      box(bay,neon,side*5.8,5.8,-.36,.2,2,.12);
    }
    box(bay,frame,0,7.3,0,12.2,.5,.8);box(bay,neon,0,7,-.46,10.8,.12,.12);
    // Cargo remains outside the driving surface and the public-road gap.
    box(bay,cargo,8,1.2,3,2.2,2.4,3);box(bay,frame,8,.16,3,2.6,.32,3.4);
    group.add(bay);
  }
  return group;
}
