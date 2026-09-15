import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPlayerIds, hasPersonalCamera, setPersonalCamera } from '../game/personal-camera';
import { createRace } from '../game/simulation';

test('a personal camera removes that racer from the shared display', () => {
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]});
  setPersonalCamera(race,'b',true);
  assert.equal(hasPersonalCamera(race,'b'),true);
  assert.deepEqual(cameraPlayerIds(race,['a','b'],'display',null),['a']);
  assert.deepEqual(cameraPlayerIds(race,['a','b'],'controller','b'),['b']);
});

test('the shared display falls back to a CPU broadcast camera when every phone is personal', () => {
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]});
  setPersonalCamera(race,'a',true);setPersonalCamera(race,'b',true);
  assert.deepEqual(cameraPlayerIds(race,['a','b'],'display',null),['cpu-2']);
  setPersonalCamera(race,'a',false);
  assert.deepEqual(cameraPlayerIds(race,['a','b'],'display',null),['a']);
});
