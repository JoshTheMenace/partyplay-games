import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroundContact } from '../game/race-contact';
import { createRace } from '../game/simulation';

void test('rear contact transfers speed, adds lateral reaction and emits one cue per racer',()=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]}),[a,b]=race.racers;
  Object.assign(a,{x:0,z:0,y:0,heading:0,speed:20,lateral:0});Object.assign(b,{x:.5,z:2,y:0,heading:0,speed:5,lateral:0});
  assert.equal(resolveGroundContact(race,a,b),true);assert.ok(a.speed<20);assert.ok(b.speed>5);assert.notEqual(a.lateral,0);
  assert.equal(race.events.filter(event=>event.type==='contact').length,2);assert.equal(a.stats?.collisions,1);assert.equal(b.stats?.collisions,1);
});

void test('separate heights and finished racers do not collide',()=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]}),[a,b]=race.racers;
  Object.assign(a,{x:0,z:0,y:0});Object.assign(b,{x:0,z:0,y:4});assert.equal(resolveGroundContact(race,a,b),false);
  b.y=0;b.finishTime=1;assert.equal(resolveGroundContact(race,a,b),false);
});
