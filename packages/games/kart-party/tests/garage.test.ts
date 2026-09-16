import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { kartStats } from '../src/engine/garage';
import { assertSerializable } from '../../../party-contract/src/serializable';
const ctx={roomId:'test',roundId:'race',nowMs:1000,seed:77,players:[{id:'a',name:'A',color:'#fff'},{id:'b',name:'B',color:'#fff'}]};
const create=()=>rules.create(ctx,rules.validateSettings({}));
void test('garage starts with defaults and accepts only owned, valid choices before racing',()=>{
  const race=create();assert.equal(race.garage?.remaining,45);assert.equal(kartStats(race.racers[0].kart).id,'standard');
  for(const value of [{type:'choose',driver:-1,kart:'standard'},{type:'choose',driver:10,kart:'sprint'},{type:'choose',driver:0,kart:'wheels'},{type:'choose',driver:'0',kart:'trail'},null])assert.throws(()=>rules.parseAction(value));
  const choice=rules.parseAction({type:'choose',driver:7,kart:'sprint'});rules.applyAction(race,'a',choice,1001);
  assert.equal(race.racers[0].driver,7);assert.equal(race.racers[0].kart,'sprint');assert.equal(race.racers[1].driver,1);
  rules.applyAction(race,'spectator',choice,1001);assert.equal(race.racers[1].driver,1);
  assertSerializable(rules.publicView(race,{nowMs:1001,phase:'playing'}));
});
void test('each ready choice is counted once, changes unready it, and everyone ready starts one common countdown',()=>{
  const race=create();rules.applyAction(race,'a',{type:'ready'},1001);rules.applyAction(race,'a',{type:'ready'},1001);assert.deepEqual(race.garage?.readyIds,['a']);
  rules.applyAction(race,'a',{type:'choose',driver:0,kart:'trail'},1002);assert.deepEqual(race.garage?.readyIds,[]);
  rules.applyAction(race,'a',{type:'ready'},1003);rules.applyAction(race,'b',{type:'ready'},1003);rules.tick(race,new Map(),1/60,2000);
  assert.equal(race.garage,undefined);assert.equal(race.startAt,5500);assert.equal(race.phase,'countdown');
  assert.throws(()=>rules.applyAction(race,'a',{type:'choose',driver:4,kart:'standard'},2001));
  rules.tick(race,new Map(),1/60,5500);assert.equal(race.phase,'racing');
});
void test('garage timeout races with the current choices and never moves the grid while waiting',()=>{
  const race=create(),x=race.racers[0].x;
  rules.tick(race,new Map([['a',{steer:1,throttle:true,drift:true,brake:false,use:false}]]),1/60,45000);
  assert.equal(race.racers[0].x,x);assert.equal(race.time,0);assert.equal(race.garage?.remaining,1);
  rules.tick(race,new Map(),1/60,46000);assert.equal(race.garage,undefined);assert.equal(race.startAt,49500);
});
void test('disconnect and reconnect retain the selected kart; missing players do not block ready players',()=>{
  const race=create();rules.applyAction(race,'b',{type:'choose',driver:9,kart:'trail'},1001);rules.onPresenceChange(race,'b',false,1002);rules.applyAction(race,'a',{type:'ready'},1003);rules.tick(race,new Map(),1/60,2000);
  assert.equal(race.garage,undefined);rules.onPresenceChange(race,'b',true,2001);assert.equal(race.racers[1].kart,'trail');assert.equal(race.racers[1].driver,9);
});
