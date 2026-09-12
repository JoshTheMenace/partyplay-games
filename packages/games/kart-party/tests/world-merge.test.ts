import test from 'node:test';
import assert from 'node:assert/strict';
import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { branchClearance } from '../src/engine/course-interactions';
import { createWorld } from '../src/engine/world';

for(const id of ['coast','canyon','midnight','rainbow'] as const)void test(`${id}: main-road barriers leave the branch footprint open without cutting the road`,()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({fillRect(){},fillText(){},strokeRect(){}})})}});
  const world=createWorld(id),track=world.track;
  try{
    const road=world.group.getObjectByName(id==='rainbow'?'prismatic-road':'main-road') as Mesh;
    assert.equal(road.geometry.index!.count,id==='rainbow'?Math.ceil(track.length/1.5)*Math.ceil(track.width/3)*6:768*6);
    const barriers=world.group.children.filter((mesh):mesh is Mesh=>mesh instanceof Mesh&&['main-road-barrier','safety-rail'].includes(mesh.name));
    assert.equal(barriers.length,id==='rainbow'?8:4);let triangles=0;
    for(const barrier of barriers){
      const position=barrier.geometry.attributes.position,index=barrier.geometry.index!;triangles+=index.count/3;
      for(let i=0;i<index.count;i+=3){
        let x=0,z=0;for(let j=0;j<3;j++){const k=index.getX(i+j);x+=position.getX(k)/3;z+=position.getZ(k)/3;}
        assert.ok(!branchClearance(track,x,z),`barrier triangle ${i/3} crosses the branch`);
      }
    }
    assert.ok(triangles<(id==='rainbow'?8*Math.ceil(track.length/1.5):4*768)*2,'the merge must remove barrier segments');
    const matrix=new Matrix4(),position=new Vector3(),scale=new Vector3();let posts=0,bridgePosts=0;
    world.group.traverse(mesh=>{
      if(!(mesh instanceof InstancedMesh))return;
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);scale.setFromMatrixScale(matrix);
        const bridgePost=Math.abs(scale.x-.45)<.001&&Math.abs(scale.y-3)<.001&&Math.abs(scale.z-.45)<.001;
        if(!['main-road-curbs','main-road-posts'].includes(mesh.name)&&!bridgePost)continue;
        assert.ok(!branchClearance(track,position.x,position.z),`post or curb at ${position.x},${position.z} crosses the branch`);
        if(bridgePost)bridgePosts++;else posts++;
      }
    });
    assert.ok(posts>20,'barriers elsewhere remain present');
    if(id==='canyon')assert.ok(bridgePosts>10,'the wide bridge retains posts outside the merge');
  }finally{
    world.dispose();if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');
  }
});
