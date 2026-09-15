import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';

const create=()=>rules.create({roomId:'room',roundId:'round',players:[{id:'p0',name:'Player',color:'#fff'}],seed:1,nowMs:0},{track:'coast',laps:3,speedClass:100,difficulty:'normal'});

test('camera actions are validated and update authoritative race state',()=>{
  const race=create();
  assert.deepEqual(rules.parseAction({type:'camera',enabled:true}),{type:'camera',enabled:true});
  assert.throws(()=>rules.parseAction({type:'camera',enabled:'yes'}));
  rules.applyAction(race,'p0',{type:'camera',enabled:true},0);
  assert.deepEqual(race.personalCameraIds,['p0']);
  rules.applyAction(race,'p0',{type:'camera',enabled:false},0);
  assert.deepEqual(race.personalCameraIds,[]);
});

test('disconnecting a personal camera restores its racer to the shared display',()=>{
  const race=create();
  rules.applyAction(race,'p0',{type:'camera',enabled:true},0);
  rules.onPresenceChange(race,'p0',false,1);
  assert.deepEqual(race.personalCameraIds,[]);
  assert.equal(race.racers.find(racer=>racer.id==='p0')?.connected,false);
});
