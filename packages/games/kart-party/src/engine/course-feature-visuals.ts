import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { courseBends } from './course-markings';
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
  const stripe=paint('#ffe1a1'),water=paint('#4cdbef'),express=paint('#72f59d'),launch=paint('#28c6e7');
  const markings=new T.Group();
  function tile(s:number,offset:number,width:number,length:number,material:T.Material,lift=.08){
    const mesh=new T.Mesh(new T.PlaneGeometry(width,length),material);mesh.rotateX(-Math.PI/2);
    const anchor=new T.Group();anchor.add(mesh);place(anchor,track,s,offset,lift);markings.add(anchor);return mesh;
  }
  // Visible approach markings show the swept crossing, not only the obstacle's current position.
  if(track.id==='canyon'||track.id==='rainbow')for(const obstacle of obstacles){
    for(let i=-3;i<=3;i++)tile(obstacle.s+i*1.5/track.length,0,track.width, .4,stripe);
  }
  for(const lane of COURSE_LANES[track.id]){
    for(let d=1;d<lane.length;d+=2){
      const s=lane.s+d/track.length,mat=lane.kind==='water'?water:lane.kind==='launch'?launch:express;
      tile(s,lane.offset,lane.width,2.1,mat);
      if(d%6===1){
        if(lane.kind==='water')tile(s,lane.offset,lane.width,.18,stripe,.12);
        else for(const side of [-1,1]){const arrow=tile(s,lane.offset+side*.42,.18,1.3,stripe,.12);arrow.rotation.z=side*-.65;}
      }
    }
  }
  // Three raised chevrons on the outside of each bend stay visible above other karts.
  const board=paint('#101c30'),shape=new T.Shape();
  shape.moveTo(-.75,-.7);shape.lineTo(-.1,-.7);shape.lineTo(.75,0);shape.lineTo(-.1,.7);shape.lineTo(-.75,.7);shape.lineTo(.1,0);shape.closePath();
  const arrowGeometry=new T.ShapeGeometry(shape);
  for(const bend of courseBends(track))for(const d of [0,8,16]){
    const anchor=new T.Group(),panel=new T.Mesh(new T.PlaneGeometry(3.1,2),board),arrow=new T.Mesh(arrowGeometry.clone(),stripe);
    arrow.scale.x=bend.direction;arrow.position.z=-.04;anchor.add(panel,arrow);
    place(anchor,track,bend.s+d/track.length,-bend.direction*(track.width/2+2),2.8);markings.add(anchor);
  }
  arrowGeometry.dispose();
  // Batch static paint and signs by material so extra guidance costs only a few draw calls.
  markings.updateMatrixWorld(true);
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  markings.traverse(object=>{if(object instanceof T.Mesh){const geometries=batches.get(object.material)??[];geometries.push(object.geometry.applyMatrix4(object.matrixWorld));batches.set(object.material,geometries);}});
  for(const [material,geometries] of batches){group.add(new T.Mesh(mergeGeometries(geometries)!,material));for(const geometry of geometries)geometry.dispose();}
  for(const material of [stripe,water,express,launch,board])if(!batches.has(material))material.dispose();
  return {group,update(time:number){courseObstacles(track,time).forEach((obstacle,i)=>{place(models[i],track,obstacle.s,obstacle.offset,rampHeight(track,obstacle.s,obstacle.offset));if(rollers[i])rollers[i]!.rotation.z=-obstacle.offset/2;});}};
}
