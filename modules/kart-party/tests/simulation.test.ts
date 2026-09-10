import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCheckpoints, botInput, createRace, rankRacers, respawn, sanitizeInput, STEP, stepRace } from '../game/simulation';
import { TRACKS, groundHeight, mod, nearest, sample } from '../game/tracks';
import type { TrackId } from '../game/types';

void test('controls reject non-finite values and coerced booleans',()=>{
  assert.deepEqual(sanitizeInput({steer:Infinity,throttle:'true',use:1}),{steer:0,throttle:false,brake:false,drift:false,use:false});
  assert.equal(sanitizeInput({steer:-9}).steer,-1);
});
void test('ordered forward gates are required before completing a lap',()=>{
  const race=createRace({track:'coast',laps:1,players:[{id:'human',name:'Racer',driver:0}]});
  const r=race.racers[0];race.time=1;
  advanceCheckpoints(race,r,.5,.51,0,STEP);assert.equal(r.checkpoints,0);
  advanceCheckpoints(race,r,.001,.999,0,STEP);assert.equal(r.checkpoints,0);
  advanceCheckpoints(race,r,.999,.001,20,STEP);assert.equal(r.checkpoints,0);
  advanceCheckpoints(race,r,.999,.001,0,STEP);assert.equal(r.checkpoints,1);assert.equal(r.finishTime,null);
  for(let gate=1;gate<=16;gate++) {const s=mod(gate/16);advanceCheckpoints(race,r,mod(s-.001),mod(s+.001),0,STEP);}
  assert.equal(r.checkpoints,17);assert.notEqual(r.finishTime,null);
});
void test('respawn returns to earned progress, and finished order remains stable',()=>{
  const race=createRace({track:'coast',players:[]}),r=race.racers[0];r.checkpoints=4;r.s=.8;respawn(race,r);
  assert.ok(r.s<.2);assert.equal(r.checkpoints,4);
  r.finishTime=10;race.racers[1].finishTime=11;race.racers[1].checkpoints=100;
  rankRacers(race);assert.equal(r.rank,1);assert.equal(race.racers[1].rank,2);
});
void test('seeded simulation is deterministic',()=>{
  const a=createRace({track:'canyon',players:[],seed:42}),b=createRace({track:'canyon',players:[],seed:42});
  for(let i=0;i<1200;i++){stepRace(a,{});stepRace(b,{});}
  assert.deepEqual(a,b);
});
void test('barrier-side crossings count, reversing loses rank, and finishers cannot fire items',()=>{
  const race=createRace({track:'coast',players:[{id:'h',name:'H',driver:0}]}),a=race.racers[0],b=race.racers[1];race.phase='racing';race.time=10;
  advanceCheckpoints(race,a,.999,.001,TRACKS.coast.width/2+5,STEP);assert.equal(a.checkpoints,1);
  a.checkpoints=b.checkpoints=3;a.s=2/16-.002;b.s=2/16+.002;rankRacers(race);assert.ok(b.rank<a.rank);
  a.finishTime=9;a.item='shell';a.itemCooldown=0;stepRace(race,{});assert.equal(race.hazards.length,0);assert.equal(a.item,'shell');
});
for(const id of Object.keys(TRACKS) as TrackId[]) void test(`${id}: compact continuous track and every CPU can finish a lap`,()=>{
  const track=TRACKS[id];assert.ok(track.length>=1700&&track.length<2800,`${track.length}m`);
  const start=sample(track,0),end=sample(track,1);assert.deepEqual(start,end);
  const race=createRace({track:id,laps:1,players:[]});
  for(let i=0;i<60*240&&race.phase!=='results';i++) stepRace(race,{});
  assert.ok(race.racers.every(r=>r.finishTime!==null),JSON.stringify(race.racers.map(r=>({id:r.id,cp:r.checkpoints,s:r.s,speed:r.speed}))));
  console.log(`${id}: ${Math.round(track.length)}m; first AI lap ${Math.round(Math.min(...race.racers.map(r=>r.finishTime!)))}s`);
});
for(const id of Object.keys(TRACKS) as TrackId[]) void test(`${id}: terrain triangles stay below the full road width`,()=>{
  const track=TRACKS[id],cell=1500/120;
  for(let i=0;i<768;i++)for(const offset of [-track.width/2,0,track.width/2]) {
    const p=sample(track,i/768,offset),gx=Math.floor((p.x+750)/cell)*cell-750,gz=Math.floor((p.z+750)/cell)*cell-750,tx=(p.x-gx)/cell,tz=(p.z-gz)/cell;
    const a=groundHeight(track,gx,gz),b=groundHeight(track,gx,gz+cell),c=groundHeight(track,gx+cell,gz+cell),d=groundHeight(track,gx+cell,gz);
    const terrain=tx+tz<=1?a+(d-a)*tx+(b-a)*tz:c+(b-c)*(1-tx)+(d-c)*(1-tz);
    assert.ok(terrain<p.y+.02,`road buried at sample ${i}, offset ${offset}: terrain ${terrain}, road ${p.y}`);
  }
});
void test('human intent can complete the same course without CPU authority',()=>{
  const race=createRace({track:'coast',laps:1,players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0];
  for(let i=0;i<60*240&&race.phase!=='results';i++) stepRace(race,{h:botInput(race,r)});
  assert.notEqual(r.finishTime,null);assert.equal(race.phase,'results');
});
void test('a kart pinned against the outside barrier is rescued onto earned track',()=>{
  const race=createRace({track:'coast',players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],track=TRACKS.coast,p=sample(track,.125,track.width/2+5);
  race.phase='racing';Object.assign(r,{x:p.x,z:p.z,s:.125,heading:p.heading+Math.PI/2,speed:30,checkpoints:3});
  for(let i=0;i<180;i++)stepRace(race,{h:{steer:0,throttle:true,drift:false,brake:false,use:false}});
  assert.ok(nearest(track,r.x,r.z).distance<track.width/2);assert.ok(r.s>.125&&r.s<.14);assert.equal(r.wallTime,0);
});
void test('all three visible coins are collected once per lap',()=>{
  const race=createRace({track:'coast',players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],track=TRACKS.coast;
  race.phase='racing';race.racers=[r];
  const place=()=>{const p=sample(track,.5/24-.2/track.length);Object.assign(r,{x:p.x,z:p.z,s:p.s,heading:p.heading,speed:30});};
  place();for(let i=0;i<12;i++)stepRace(race,{h:{steer:0,throttle:true,drift:false,brake:false,use:false}});
  assert.equal(r.coins,3,'each of the three visible coins must award a coin');
  place();for(let i=0;i<12;i++)stepRace(race,{h:{steer:0,throttle:true,drift:false,brake:false,use:false}});
  assert.equal(r.coins,3,'reversing and recrossing must not farm the same coins');
});
void test('finished racers do not consume active race hazards',()=>{
  const race=createRace({track:'coast',players:[{id:'h',name:'Human',driver:0}]}),finished=race.racers[1];
  race.phase='racing';finished.finishTime=0;
  race.hazards=[{id:1,kind:'banana',owner:'h',x:finished.x,z:finished.z,heading:0,life:20}];
  stepRace(race,{});assert.equal(race.hazards.length,1,'a ghost finisher cannot shield other racers from hazards');
});
void test('rescue loses a few metres rather than a whole long checkpoint sector',()=>{
  const race=createRace({track:'midnight',players:[]}),r=race.racers[0],track=TRACKS.midnight;
  r.checkpoints=4;r.s=3/track.gates+150/track.length;const before=r.s;respawn(race,r);
  assert.ok(Math.abs((before-r.s)*track.length-8)<.001);assert.equal(r.checkpoints,4);
  r.s=6/track.gates;respawn(race,r);assert.ok(r.s<4/track.gates,'unearned sectors must fall back to the earned gate');
});

void test('CPU drivers fill unused characters for solo and party grids',()=>{
 for(const drivers of [[5],[2,5,7,0]]){const race=createRace({track:'coast',players:drivers.map((driver,i)=>({id:`p${i}`,name:`P${i}`,driver}))});assert.equal(new Set(race.racers.map(r=>r.driver)).size,8);assert.deepEqual(race.racers.slice(0,drivers.length).map(r=>r.driver),drivers);}
});
