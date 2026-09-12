import test from 'node:test';
import assert from 'node:assert/strict';
import { updateHazards } from '../src/engine/items';
import { createRace } from '../src/engine/simulation';
import { roadHeight, sample, TRACKS } from '../src/engine/tracks';

void test('a low airborne kart can hit a trap sitting on an elevated ramp',()=>{
  const track=TRACKS.midnight,ramp=track.ramps[0],s=ramp.s+(ramp.length-2)/track.length,p=sample(track,s);
  const race=createRace({track:'midnight',players:[{id:'owner',name:'Owner',driver:0},{id:'victim',name:'Victim',driver:1}]}),victim=race.racers[1];
  race.phase='racing';race.racers=race.racers.slice(0,2);
  Object.assign(victim,{x:p.x,z:p.z,s,y:roadHeight(track,s)+1,airborne:true});
  race.hazards=[{id:1,kind:'banana',owner:'owner',x:p.x,z:p.z,heading:p.heading,life:10}];
  updateHazards(race,.01);
  assert.equal(victim.stun,1.2,'height separation must use the ramp surface where the trap is rendered');
});
