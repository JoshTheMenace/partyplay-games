import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLoopContact} from '../src/engine/loop-contact';
import {createRace} from '../src/engine/simulation';
import {surfaceFrame,TRACKS} from '../src/engine/tracks';
function setup(){
 const race=createRace({track:'rainbow',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]}),[a,b]=race.racers,track=TRACKS.rainbow,s=track.magnetic!.from+80/track.length;
 for(const racer of [a,b])Object.assign(racer,surfaceFrame(track,s).position,{s,loopDistance:80,loopOffset:0});return {race,a,b,track};
}
void test('overlapping loop karts separate by local lane without changing race progress',()=>{
 const {race,a,b}=setup(),s=a.s;assert.equal(resolveLoopContact(race,a,b),true);assert.equal(a.s,s);assert.equal(b.s,s);assert.equal(a.loopDistance,80);assert.equal(b.loopDistance,80);assert.equal(Math.abs(a.loopOffset!-b.loopOffset!),2.5);
});
void test('loop contact respects barriers and star shield semantics',()=>{
 const {race,a,b,track}=setup(),edge=track.width/2-1.25;
 for(const racer of [a,b])Object.assign(racer,surfaceFrame(track,racer.s,edge).position,{loopOffset:edge});a.star=3;b.shield=2;resolveLoopContact(race,a,b);
 assert.equal(b.shield,0);assert.equal(b.stun,0);assert.ok(a.loopOffset!<=edge&&b.loopOffset!<=edge);assert.ok(a.loopOffset!>=-edge&&b.loopOffset!>=-edge);assert.equal(Math.abs(a.loopOffset!-b.loopOffset!),2.5);
});
void test('loop star hits unshielded contacts but never hits a different route branch or finisher',()=>{
 const {race,a,b}=setup();a.star=3;resolveLoopContact(race,a,b);assert.equal(b.stun,1.2);
 const remote=setup();remote.a.star=3;remote.b.loopDistance=180;resolveLoopContact(remote.race,remote.a,remote.b);assert.equal(remote.b.stun,0);
 const finished=setup();finished.a.star=3;finished.b.finishTime=1;resolveLoopContact(finished.race,finished.a,finished.b);assert.equal(finished.b.stun,0);assert.equal(finished.a.loopOffset,0);
});
