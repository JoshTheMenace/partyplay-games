import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Object3D,Quaternion,Vector3} from 'three';
import {createCoinViews,type CoinPose} from '../game/powerup-models';
import {TRACKS,groundHeight,nearest} from '../game/tracks';

/** The per-coin matrix the renderer used to solve for every coin, for every camera, every frame. */
function reference(pose:CoinPose,time:number,taken:boolean){
  const dummy=new Object3D();dummy.position.copy(pose.position);dummy.quaternion.copy(pose.quaternion);
  dummy.rotateY(time*.8);dummy.scale.setScalar(taken?0:1);dummy.updateMatrix();return dummy.matrix.clone();
}
const same=(a:Matrix4,b:Matrix4)=>a.elements.forEach((value,i)=>assert.ok(Math.abs(value-b.elements[i])<1e-9,`element ${i}: ${value} vs ${b.elements[i]}`));

test('cached coin views match the per-camera coin matrices exactly',()=>{
  const poses:CoinPose[]=[
    {position:new Vector3(12,3,-40),quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.3)},
    {position:new Vector3(-8,7.5,90),quaternion:new Quaternion().setFromAxisAngle(new Vector3(1,0,0).normalize(),-.4)},
  ];
  const written:Matrix4[]=[];let commits=0;
  const instances={group:null,setMatrixAt:(index:number,matrix:Matrix4)=>{written[index]=matrix.clone();},commit:()=>{commits++;}} as unknown as Parameters<typeof createCoinViews>[0];
  const views=createCoinViews(instances,poses);
  for(const [time,taken] of [[1.3,[false,true]],[1.3,[true,false]],[2.05,[false,false]]] as const){
    views(time,index=>taken[index]);
    poses.forEach((pose,index)=>same(written[index],reference(pose,time,taken[index])));
  }
  assert.equal(commits,3);
});

test('ground height with a precomputed nearest point matches the plain query',()=>{
  for(const track of Object.values(TRACKS)){
    for(let i=0;i<track.points.length;i+=Math.max(1,Math.floor(track.points.length/12))){
      const point=track.points[i];
      for(const [dx,dz] of [[0,0],[14,-9],[-60,35]]){
        const x=point.x+dx,z=point.z+dz;
        assert.equal(groundHeight(track,x,z,nearest(track,x,z)),groundHeight(track,x,z));
      }
    }
  }
});
