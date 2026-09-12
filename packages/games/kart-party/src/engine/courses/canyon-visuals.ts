import * as T from 'three';
import { routeSample } from '../course-routes';
import { groundHeight, type Track } from '../tracks';
import { CANYON_DESIGN } from './canyon';

/** Open trestles leave the ridge exposed, with nothing above the driving surface. */
export function createCanyonDetails(track:Track):T.Group{
  const group=new T.Group(),route=CANYON_DESIGN.routes[0],matrices:T.Matrix4[]=[],dummy=new T.Object3D();
  const beam=(x:number,y:number,z:number,width:number,height:number,depth:number,heading:number)=>{
    dummy.position.set(x,y,z);dummy.scale.set(width,height,depth);dummy.rotation.y=heading;dummy.updateMatrix();matrices.push(dummy.matrix.clone());
  };
  for(let s=route.from+.22*(route.to-route.from);s<route.to-.2*(route.to-route.from);s+=15/track.length){
    const p=routeSample(track,route,s);
    beam(p.x,p.y-.8,p.z,route.width+1,1.1,1.1,p.heading);
    for(const side of [-1,1]){
      const q=routeSample(track,route,s,side*(route.width/2-.7)),floor=groundHeight(track,q.x,q.z),height=Math.max(1,q.y-floor-.8);
      beam(q.x,q.y-.8-height/2,q.z,.8,height,.8,p.heading);
    }
  }
  const trestles=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:'#654536',roughness:.92}),matrices.length);
  matrices.forEach((matrix,i)=>trestles.setMatrixAt(i,matrix));trestles.castShadow=true;trestles.receiveShadow=true;trestles.computeBoundingSphere();group.add(trestles);
  return group;
}
