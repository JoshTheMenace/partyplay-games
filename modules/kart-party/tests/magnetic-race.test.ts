import test from 'node:test';
import assert from 'node:assert/strict';
import {botInput,createRace,stepRace,advanceCheckpoints,STEP,respawn} from '../game/simulation';
import {TRACKS,sample,surfaceFrame,magneticAt} from '../game/tracks';
import {NEUTRAL,type SpeedClass} from '../game/types';
const track=TRACKS.rainbow,m=track.magnetic!;
for(const speedClass of [50,100,150,200] as SpeedClass[])void test(`${speedClass}cc drives the real inversion, exits continuously and keeps earned gates`,()=>{
 const race=createRace({track:'rainbow',speedClass,laps:2,players:[{id:'h',name:'H',driver:0}]}),r=race.racers[0],p=sample(track,m.from-5/track.length);race.racers=[r];race.phase='racing';
 Object.assign(r,{...p,speed:25,checkpoints:Math.floor(p.s*16)+1});let attached=false,inverted=false,exited=false;
 for(let i=0;i<2400;i++){const previous={x:r.x,y:r.y,z:r.z};stepRace(race,{h:{...botInput(race,r),use:false}});assert.ok(Math.hypot(r.x-previous.x,r.y-previous.y,r.z-previous.z)<3,'entry and exit cannot teleport');if(r.loopDistance!==undefined){attached=true;inverted ||= surfaceFrame(track,r.s).up.y<-.95;const f=surfaceFrame(track,r.s,r.loopOffset);assert.ok(Math.hypot(r.x-f.position.x,r.y-f.position.y,r.z-f.position.z)<.001);}else if(attached){exited=true;break;}}
 assert.ok(attached&&inverted&&exited,JSON.stringify({attached,inverted,exited,s:r.s}));assert.ok(r.checkpoints>Math.floor(m.from*16)+1,'loop gates are earned in order');assert.ok(r.s>=m.to);
});
void test('braking on the ceiling holds the road and rescue stays in the earned loop sector',()=>{
 const race=createRace({track:'rainbow',players:[{id:'h',name:'H',driver:0}]}),r=race.racers[0],distance=94,s=m.from+distance/track.length,f=surfaceFrame(track,s);race.phase='racing';race.racers=[r];
 Object.assign(r,{...f.position,s,loopDistance:distance,loopOffset:0,checkpoints:Math.floor(s*16)+1});
 for(let i=0;i<120;i++)stepRace(race,{h:{...NEUTRAL,brake:true}});
 assert.ok(surfaceFrame(track,r.s).up.y<-.8);assert.equal(r.speed,0);assert.equal(r.loopDistance,distance);const earned=r.checkpoints;respawn(race,r);assert.equal(r.checkpoints,earned);assert.ok(magneticAt(track,r.s));
});
void test('lap banners carry the completed lap once, never the initial grid crossing',()=>{
 const race=createRace({track:'coast',laps:3,players:[]}),r=race.racers[0];advanceCheckpoints(race,r,.9999,.0001,0,STEP);assert.equal(race.events.length,0);
 r.checkpoints=16;advanceCheckpoints(race,r,.9999,.0001,0,STEP);assert.deepEqual(race.events.map(e=>[e.type,e.lap]),[['lap',1]]);
 advanceCheckpoints(race,r,.0001,.0002,0,STEP);assert.equal(race.events.length,1);
 r.checkpoints=32;advanceCheckpoints(race,r,.9999,.0001,0,STEP);assert.equal(race.events.at(-1)?.lap,2);
});
void test('loop entry rejects wide karts and clamps a shoulder entry onto the magnetic lane',()=>{
 for(const offset of [track.width/2+track.shoulder!-.1,track.width/2+track.shoulder!+4]){
  const race=createRace({track:'rainbow',players:[{id:'h',name:'H',driver:0}]}),r=race.racers[0],p=sample(track,m.from-.1/track.length,offset);race.phase='racing';race.racers=[r];Object.assign(r,{...p,speed:30});
  stepRace(race,{h:{...NEUTRAL,throttle:true}});
  if(offset>track.width/2+track.shoulder!)assert.equal(r.loopDistance,undefined);
  else{assert.ok(r.loopDistance!==undefined);assert.ok(Math.abs(r.loopOffset!)<=track.width/2-1.25);const f=surfaceFrame(track,r.s,r.loopOffset!);assert.ok(Math.hypot(r.x-f.position.x,r.y-f.position.y,r.z-f.position.z)<.001);}
 }
});
