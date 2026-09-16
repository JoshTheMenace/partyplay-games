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
    const body=model.getObjectByName(`body_${i}`)!;
    for(const name of ['chassis','rider','head','arm_l','arm_r','steer'])assert.equal(model.getObjectByName(`${name}_${i}`)?.parent,body,`${name} stays independently swappable or articulated`);
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

void test('Arrow and Rover keep vehicle bounds and every original wheel animation pivot',async()=>{
  const bytes=readFileSync(new URL('../public/models/garage.glb',import.meta.url));
  assert.ok(bytes.byteLength<10*1024*1024,'garage library must stay below 10 MiB');
  const document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert.equal(document.cameras,undefined);assert.equal(document.extensions?.KHR_lights_punctual,undefined);
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  for(const suffix of ['sprint','trail']){
    const model=cloneModel(scene,`kart_${suffix}`),size=new Box3().setFromObject(model).getSize(new Vector3());
    assert.ok(size.x>2&&size.x<=2.8,`${suffix} width ${size.x}`);
    assert.ok(size.z>3&&size.z<4,`${suffix} length ${size.z}`);
    assert.equal(model.getObjectByName(`chassis_${suffix}`)?.parent,model);
    assert.equal(model.getObjectByName(`steer_${suffix}`),undefined,'retain the selected driver steering wheel');
    for(const name of ['front_l','front_r','rear_l','rear_r']){
      const axle=model.getObjectByName(`${name}_${suffix}`)!,wheel=model.getObjectByName(`wheel_${name}_${suffix}`)!;
      assert.equal(axle.parent,model);assert.equal(wheel.parent,axle);
      assert.ok(axle.position.distanceTo(scene.getObjectByName(`${name}_0`)!.position)<1e-6,'all bodies use the same axle locations');
      const before=new Box3().setFromObject(wheel),center=before.getCenter(new Vector3());
      wheel.rotation.x=Math.PI/2;
      assert.ok(new Box3().setFromObject(wheel).getCenter(new Vector3()).distanceTo(center)<.04,'variant wheel spins on its axle');
      assert.ok(Math.abs(before.getSize(new Vector3()).y-.88)<.05,'variant tire radius matches the roadster');
    }
    disposeObject(model);
  }
  for(let i=0;i<10;i++)for(const suffix of ['sprint','trail'] as const){
    const kart=createKart(i,scene,suffix),racer=createRace({track:'coast',players:[]}).racers[0];
    assert.equal(kart.group.getObjectByName(`chassis_${i}`),undefined,'the original chassis must be removed');
    assert.equal(kart.group.getObjectByName(`chassis_${suffix}`)?.parent,kart.body);
    assert.equal(kart.group.getObjectByName(`rider_${i}`)?.parent,kart.body);
    assert.equal(kart.wheels.length,4);assert.equal(kart.frontWheels?.length,2);
    racer.heading=0;animateKart(kart,racer,1/60,0);racer.heading=.1;animateKart(kart,racer,1/60,1);
    assert.ok(kart.frontWheels![0].rotation.y>0&&kart.steer!.rotation.z<0&&kart.head!.rotation.y>0,'every character steers the replacement kart');
    racer.airborne=true;animateKart(kart,racer,1/60,2);
    assert.ok(kart.arms![0].rotation.z<0&&kart.arms![1].rotation.z>0,'replacement kart keeps both animated arms');
    disposeObject(kart.group);
  }
  disposeObject(scene);
});

void test('garage supplies transparent thumbnails for all ten characters and three karts',()=>{
  for(const name of [...Array.from({length:10},(_,i)=>`driver-${i}`),'kart-standard','kart-sprint','kart-trail']){
    const png=readFileSync(new URL(`../public/models/previews/${name}.png`,import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),192);
    assert.equal(png[25],6,'garage thumbnails must retain RGBA transparency');
  }
});
