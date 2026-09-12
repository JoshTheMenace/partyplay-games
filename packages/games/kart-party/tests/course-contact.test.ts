import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKartContact } from '../src/engine/kart-contact';
import { applyCourseLane, COURSE_LANES, courseObstacles, resolveCourseObstacles } from '../src/engine/course-features';
import { createRace, stepRace } from '../src/engine/simulation';
import { sample, TRACKS } from '../src/engine/tracks';
import type { TrackId } from '../src/engine/types';

function pair(){const race=createRace({track:'coast',players:[]}),[a,b]=race.racers;Object.assign(a,{x:0,z:0,y:0,heading:0,speed:30});Object.assign(b,{x:0,z:2,y:0,heading:0,speed:10});return {race,a,b};}
void test('rear impact transfers speed and separates karts without changing earned progress',()=>{
  const {race,a,b}=pair(),s=a.s;resolveKartContact(race,a,b);
  assert.equal(a.speed,18);assert.equal(b.speed,22);assert.equal(b.z-a.z,2.5);assert.equal(a.s,s);
});
void test('side contact makes a sideways bump, and separating contact adds no energy',()=>{
  const {race,a,b}=pair();Object.assign(b,{x:2,z:0,speed:30});a.lateral=8;
  resolveKartContact(race,a,b);assert.ok(a.lateral<8);assert.ok(b.lateral>0);
  b.x=2;const velocity=[a.speed,a.lateral,b.speed,b.lateral];resolveKartContact(race,a,b);assert.deepEqual([a.speed,a.lateral,b.speed,b.lateral],velocity);
});
void test('coincident karts separate deterministically, elevated and finished karts are ghosts',()=>{
  const {race,a,b}=pair();b.z=0;resolveKartContact(race,a,b);assert.equal(Math.hypot(a.x-b.x,a.z-b.z),2.5);
  const elevated=pair();elevated.b.y=4;resolveKartContact(elevated.race,elevated.a,elevated.b);assert.equal(elevated.a.speed,30);
  const finished=pair();finished.b.finishTime=1;resolveKartContact(finished.race,finished.a,finished.b);assert.equal(finished.a.speed,30);
});
void test('star contact retains shield and stun rules',()=>{
  const {race,a,b}=pair();a.star=2;b.shield=2;resolveKartContact(race,a,b);assert.equal(b.shield,0);assert.equal(b.stun,0);
});
for(const id of Object.keys(TRACKS) as TrackId[])void test(`${id}: course collisions match visible geometry and preserve progress`,()=>{
  const track=TRACKS[id],race=createRace({track:id,players:[]}),r=race.racers[0],obstacles=courseObstacles(track,1),o=obstacles[0],p=sample(track,o.s,o.offset);
  Object.assign(r,p,{speed:25,finishTime:null});resolveCourseObstacles(track,r,obstacles);
  assert.ok(Math.hypot(r.x-p.x,r.z-p.z)>=o.radius+1.24);assert.equal(r.s,p.s);assert.equal(r.checkpoints,0);
  Object.assign(r,p,{y:p.y+o.height+1});resolveCourseObstacles(track,r,obstacles);assert.equal(r.x,p.x);assert.equal(r.z,p.z);
  assert.deepEqual(courseObstacles(track,1),obstacles);
});
void test('water slows only its lane, express boosts, and launch lanes require grounded forward speed',()=>{
  for(const id of ['coast','midnight','rainbow'] as const){
    const track=TRACKS[id],r=createRace({track:id,players:[]}).racers[0],lane=COURSE_LANES[id][0];r.s=lane.s+1/track.length;r.speed=25;
    applyCourseLane(track,r,track.width,.1);assert.equal(r.speed,25);assert.equal(r.boost,0);
    applyCourseLane(track,r,lane.offset,.1);
    if(id==='coast'){assert.ok(r.speed<25);assert.ok(r.oil>0);}else assert.ok(r.boost>0);
    if(id==='rainbow'){assert.equal(r.airborne,true);assert.equal(r.verticalSpeed,8);r.verticalSpeed=4;applyCourseLane(track,r,lane.offset,.1);assert.equal(r.verticalSpeed,4);}
  }
});
void test('moving boulders and traffic change position on the authoritative clock',()=>{
  assert.notEqual(courseObstacles(TRACKS.canyon,0)[0].offset,courseObstacles(TRACKS.canyon,2)[0].offset);
  assert.notEqual(courseObstacles(TRACKS.midnight,0)[0].s,courseObstacles(TRACKS.midnight,2)[0].s);
});
void test('a ten-kart race starts without overlapping the grid or producing nonfinite motion',()=>{
  const race=createRace({track:'canyon',players:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`Player ${i}`,driver:i}))});
  for(const r of race.racers)r.connected=false;
  for(let i=0;i<1200;i++)stepRace(race,{});
  assert.equal(race.racers.length,10);assert.ok(race.racers.every(r=>[r.x,r.y,r.z,r.speed,r.lateral].every(Number.isFinite)));
});
