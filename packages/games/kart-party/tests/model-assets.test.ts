import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, Vector3 } from 'three';
import { animateKart } from '../src/engine/kart-animation';
import { createRace } from '../src/engine/simulation';
import { createKart } from '../src/engine/kart';
import { cloneModel } from '../src/engine/model-assets';
import { disposeObject } from '../src/engine/dispose';

void test('shipped Blender library loads all ten articulated rigs at gameplay scale',async()=>{
  const bytes=readFileSync(new URL('../public/models/garage.glb',import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  for(let i=0;i<10;i++){
    const model=cloneModel(scene,`driver_${i}`),size=new Box3().setFromObject(model).getSize(new Vector3());
    assert.ok(size.x>2&&size.x<3,`kart ${i} width ${size.x}`);assert.ok(size.y>2.5&&size.y<3.6,`kart ${i} height ${size.y}`);assert.ok(size.z>3&&size.z<4);
    const kart=createKart(i,scene);assert.equal(kart.wheels.length,4);assert.ok(kart.head&&kart.steer&&kart.arms?.every(Boolean));assert.equal(kart.frontWheels?.length,2);
    const wheel=kart.wheels[0],before=new Box3().setFromObject(wheel).getCenter(new Vector3());wheel.rotation.x+=Math.PI/2;const after=new Box3().setFromObject(wheel).getCenter(new Vector3());assert.ok(before.distanceTo(after)<.04,'wheel spins around its axle');
    const racer=createRace({track:'coast',players:[]}).racers[0];racer.heading=0;
    animateKart(kart,racer,1/60,0);racer.heading=.1;animateKart(kart,racer,1/60,1);
    const yaw=kart.frontWheels![0].rotation.y;
    assert.ok(yaw>0&&yaw<.4,'front steering eases toward the turn');assert.ok(kart.steer!.rotation.z<0,'steering wheel follows the turn');assert.ok(kart.head!.rotation.y>0,'driver looks into the corner');
    animateKart(kart,racer,1/60,2);assert.ok(kart.frontWheels![0].rotation.y<yaw,'steering eases back toward neutral');
    racer.airborne=true;animateKart(kart,racer,1/60,2);assert.ok(kart.arms![0].rotation.z<0&&kart.arms![1].rotation.z>0,'arms respond to jumps');
    racer.finishTime=1;animateKart(kart,racer,1/60,3);assert.ok(Math.abs(kart.arms![0].rotation.z)>1,'driver celebrates at the finish');
    disposeObject(model);disposeObject(kart.group);
  }
  for(const name of ['buoy','boulder','traffic','satellite'])assert.ok(scene.getObjectByName(name));
  disposeObject(scene);
});
