import * as T from 'three';
import { COURSE_LANES, courseObstacles } from './course-features';
import { cloneModel } from './model-assets';
import { rampHeight, surfaceFrame, type Track } from './tracks';

/** Follow the road's full surface frame, including bank and elevation. */
function place(object:T.Object3D,track:Track,s:number,offset=0,lift=0){
  const f=surfaceFrame(track,s,offset,lift);
  object.position.copy(f.position);
  object.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().copy(f.right),new T.Vector3().copy(f.up),new T.Vector3().copy(f.forward)));
}
export function createCourseFeatures(track:Track,garage:T.Group){
  const group=new T.Group(),obstacles=courseObstacles(track,0),models=obstacles.map(obstacle=>cloneModel(garage,obstacle.kind));
  group.add(...models);
  const rollers=models.map((model,i)=>{
    if(obstacles[i].kind!=='boulder')return null;
    const pivot=new T.Group();pivot.position.y=2;
    for(const child of model.children.slice()){child.position.y-=2;pivot.add(child);}model.add(pivot);return pivot;
  });
  const paint=(color:string)=>new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.3,roughness:.55,side:T.DoubleSide});
  const stripe=paint('#ffe1a1'),water=paint('#4cdbef'),express=paint('#72f59d');
  function tile(s:number,offset:number,width:number,length:number,material:T.Material,lift=.08){
    const mesh=new T.Mesh(new T.PlaneGeometry(width,length),material);mesh.rotateX(-Math.PI/2);
    const anchor=new T.Group();anchor.add(mesh);place(anchor,track,s,offset,lift);group.add(anchor);return mesh;
  }
  // Visible approach markings show the swept crossing, not only the obstacle's current position.
  if(track.id==='canyon'||track.id==='rainbow')for(const obstacle of obstacles){
    for(let i=-3;i<=3;i++)tile(obstacle.s+i*1.5/track.length,0,track.width, .4,stripe);
  }
  for(const lane of COURSE_LANES[track.id]){
    for(let d=1;d<lane.length;d+=2){
      const s=lane.s+d/track.length,mat=lane.kind==='water'?water:express;
      tile(s,lane.offset,lane.width,2.1,mat);
      if(d%6===1){
        if(lane.kind==='water')tile(s,lane.offset,lane.width,.18,stripe,.12);
        else for(const side of [-1,1]){const arrow=tile(s,lane.offset+side*.42,.18,1.3,stripe,.12);arrow.rotation.z=side*-.65;}
      }
    }
  }
  return {group,update(time:number){courseObstacles(track,time).forEach((obstacle,i)=>{place(models[i],track,obstacle.s,obstacle.offset,rampHeight(track,obstacle.s,obstacle.offset));if(rollers[i])rollers[i]!.rotation.z=-obstacle.offset/2;});}};
}
