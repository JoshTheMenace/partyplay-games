import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { humanInput } from '../game/input';
import { createRace, stepRace } from '../game/simulation';
import { sample, TRACKS } from '../game/tracks';
import { NEUTRAL } from '../game/types';

for(const [key,direction] of [['arrowleft',-1],['a',-1],['arrowright',1],['d',1]] as const) void test(`${key} moves toward the requested side of the chase camera`,()=>{
  const race=createRace({track:'coast',players:[{id:'human',name:'Human',driver:0}]}),r=race.racers[0],p=sample(TRACKS.coast,.1);
  race.phase='racing';race.racers=[r];Object.assign(r,{x:p.x,z:p.z,s:p.s,heading:p.heading,speed:20});
  const camera=new PerspectiveCamera(60,1,.1,1000);
  camera.position.set(p.x-Math.sin(p.heading)*10,p.y+5.3,p.z-Math.cos(p.heading)*10);
  camera.lookAt(p.x+Math.sin(p.heading)*8,p.y+1.6,p.z+Math.cos(p.heading)*8);camera.updateMatrixWorld();
  const origin=new Vector3(r.x,p.y,r.z).project(camera).x;
  stepRace(race,{human:humanInput({...NEUTRAL},new Set([key]),true,true)});
  assert.ok((new Vector3(r.x,p.y,r.z).project(camera).x-origin)*direction>0);
});
void test('touch and keyboard combine in screen space and convert only once without mutating held input',()=>{
  const touch={...NEUTRAL,steer:.75},keys=new Set(['d']);
  assert.equal(humanInput(touch,keys,true,true).steer,-1);
  assert.equal(humanInput(touch,keys,true,true).steer,-1);
  assert.equal(touch.steer,.75);
  assert.equal(humanInput({...NEUTRAL,steer:-1},keys,true,true).steer,0);
  assert.equal(humanInput({...NEUTRAL,steer:-.5},new Set(),true,true).steer,.5);
});
void test('item press and release retain the same world steering as normal frames, including keyboard controls',()=>{
  const touch={...NEUTRAL,steer:.4},keys=new Set(['a','shift','w']);
  const frame=humanInput(touch,keys,false,true);
  assert.deepEqual(humanInput({...touch,use:true},keys,false,true),{...frame,use:true});
  assert.deepEqual(humanInput({...touch,use:false},keys,false,true),frame);
  assert.deepEqual(humanInput(touch,keys,false,true,true),{...frame,use:true});
  assert.equal(frame.steer,.6);assert.equal(frame.throttle,true);assert.equal(frame.drift,true);
});
void test('inactive races do not accelerate and item key aliases remain available',()=>{
  assert.equal(humanInput(NEUTRAL,new Set(['w']),true,false).throttle,false);
  for(const key of ['e','enter','x','control'])assert.equal(humanInput(NEUTRAL,new Set([key]),false,true).use,true);
});
