import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Vector3} from 'three';
import {KART_TIRE_RADIUS,poseDriverArms,wheelSpinRadians} from '../game/kart-animation';
import type {Kart} from '../game/kart';

test('wheel spin follows distance travelled and the authored tire radius',()=>{
  assert.equal(wheelSpinRadians(KART_TIRE_RADIUS),1);
  assert.ok(Math.abs(wheelSpinRadians(Math.PI*2*KART_TIRE_RADIUS)-Math.PI*2)<1e-10);
});

test('authored driver hands remain on the rotating steering-wheel grips',()=>{
  const steer=new Group();steer.position.set(0,1.48,.38);
  const arm=()=>({upper:new Group(),forearm:new Group(),hand:new Group()});
  const arms:[ReturnType<typeof arm>,ReturnType<typeof arm>]=[arm(),arm()];
  const kart={steer,driverArms:arms} as unknown as Kart,wheelAngle=.62;
  poseDriverArms(kart,wheelAngle);
  arms!.forEach((arm,index)=>{
    const side=index?1:-1,expected=new Vector3(side*.23,0,0).applyAxisAngle(new Vector3(0,0,1),wheelAngle).add(steer.position);
    assert.ok(arm.hand.position.distanceTo(expected)<1e-10);
    assert.equal(arm.hand.rotation.z,wheelAngle);
    assert.ok(arm.upper.scale.y>.5&&arm.forearm.scale.y>.5);
  });
});
