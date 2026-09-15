import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from 'three';
import {KART_IMPACT_SECONDS,poseKartBody,type KartImpact} from '../game/kart-animation';
import type {Racer} from '../game/types';

const racer={driver:1,driftSide:.4,speed:0,stun:0} as Racer;
const EPS=1e-9;

/** Drive the body pose like the render loop does, hitting at the given race times. */
function run(fps:number,seconds:number,hits:number[],strength=1){
  const body=new Group(),dt=1/fps;let impact:KartImpact|undefined,maxLift=0,maxPitch=0;
  for(let frame=0;frame*dt<=seconds;frame++){
    const time=frame*dt;
    if(hits.some(hit=>Math.abs(hit-time)<dt/2))impact={until:time+KART_IMPACT_SECONDS,strength};
    if(!poseKartBody(body,racer,time,impact))impact=undefined;
    maxLift=Math.max(maxLift,Math.abs(body.position.y));maxPitch=Math.max(maxPitch,Math.abs(body.rotation.x));
  }
  return {body,maxLift,maxPitch};
}

for(const fps of [30,60,120]){
  test(`an isolated collision leaves no residual lift or pitch at ${fps} FPS`,()=>{
    const {body,maxPitch}=run(fps,2,[.5]);
    assert.ok(maxPitch>0,'the impact should visibly shake the body');
    assert.ok(Math.abs(body.position.y)<EPS);
    assert.ok(Math.abs(body.rotation.x)<EPS);
    assert.ok(Math.abs(body.rotation.z-(-racer.driftSide*.1))<EPS);
    assert.ok(Math.abs(body.rotation.y-(-racer.driftSide*.15))<EPS);
  });

  test(`repeated collisions stay bounded and settle at ${fps} FPS`,()=>{
    const hits=Array.from({length:16},(_,i)=>.2+i*.3);
    const {body,maxLift,maxPitch}=run(fps,6,hits,1);
    assert.ok(maxLift<=.22+EPS,`lift ${maxLift}`);
    assert.ok(maxPitch<=.18+EPS,`pitch ${maxPitch}`);
    assert.ok(Math.abs(body.position.y)<EPS&&Math.abs(body.rotation.x)<EPS);
  });
}

test('an impact from a later race time cannot exceed its strength',()=>{
  const body=new Group(),impact={until:10+KART_IMPACT_SECONDS,strength:.5};
  for(let t=0;t<2;t+=1/60){poseKartBody(body,racer,t,impact);assert.ok(Math.abs(body.position.y)<=.22*.5+EPS);assert.ok(Math.abs(body.rotation.x)<=.18*.5+EPS);}
});

test('an expired impact reports itself finished and restores the neutral pose',()=>{
  const body=new Group();body.position.y=3;body.rotation.x=1;
  assert.equal(poseKartBody(body,racer,5,{until:4,strength:1}),false);
  assert.ok(Math.abs(body.position.y)<EPS&&Math.abs(body.rotation.x)<EPS);
  assert.equal(poseKartBody(body,racer,5,undefined),false);
});
