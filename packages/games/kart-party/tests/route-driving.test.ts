import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_DESIGNS } from '../src/engine/course-designs';
import { gateOpen } from '../src/engine/course-interactions';
import { routeNearest, routeSample } from '../src/engine/course-routes';
import { KARTS, type KartId } from '../src/engine/garage';
import { activateItem, updateHazards } from '../src/engine/items';
import { botInput, createRace, respawn, STEP, stepRace } from '../src/engine/simulation';
import { speedMultiplier } from '../src/engine/speed';
import { angleDelta, mod, sample, TRACKS } from '../src/engine/tracks';
import { NEUTRAL, type Race, type SpeedClass, type TrackId } from '../src/engine/types';

function solo(id:TrackId,speedClass:SpeedClass=100,kart:KartId='standard'){
  const race=createRace({track:id,speedClass,laps:1,players:[{id:'driver',name:'Route driver',driver:0}]}),r=race.racers[0];
  race.phase='racing';race.time=8;race.racers=[r];r.kart=kart;return {race,r,track:TRACKS[id],route:COURSE_DESIGNS[id].routes[0]};
}
function drive(race:Race){const r=race.racers[0];stepRace(race,{[r.id]:{...botInput(race,r),use:false}});}
function finite(race:Race){assert.ok(race.racers.every(r=>[r.x,r.y,r.z,r.s,r.heading,r.speed,r.lateral].every(Number.isFinite)));}

for(const id of Object.keys(TRACKS) as TrackId[])for(const speedClass of [50,100,150,200] as const)for(const kart of KARTS)void test(`${id}: ${speedClass}cc ${kart.id} steers into and finishes its fork without route injection`,()=>{
  const {race,r,track,route}=solo(id,speedClass,kart.id),s=route.from-25/track.length;
  Object.assign(r,sample(track,s),{speed:25*speedMultiplier(speedClass),checkpoints:Math.floor(s*track.gates)+1});
  let entered=false,exited=false,backward=0,largestStep=0;
  for(let i=0;i<60*45;i++){
    const previous=r.s;drive(race);finite(race);
    const delta=angleDelta(r.s*Math.PI*2,previous*Math.PI*2)/(Math.PI*2)*track.length;
    if(delta<-3)backward++;largestStep=Math.max(largestStep,delta);
    entered||=r.routeId===route.id;
    if(r.s>route.to+5/track.length){exited=!r.routeId;break;}
  }
  const detail=JSON.stringify({s:r.s,route:r.routeId,checkpoints:r.checkpoints,backward,speed:r.speed});
  assert.ok(entered,`fork never entered: ${detail}`);assert.ok(exited,`fork never completed: ${detail}`);
  assert.equal(backward,0,`unexpected recovery: ${detail}`);assert.ok(largestStep<4,'progress teleported forward');
  assert.equal(r.checkpoints,Math.floor(r.s*track.gates)+1,'branch must pass every canonical checkpoint');
});

void test('isolated freight gate holds a forward kart before its plane until the gate opens',()=>{
  const {race,r,track,route}=solo('midnight',200),gate=COURSE_DESIGNS.midnight.gates[0];race.time=5.2;
  Object.assign(r,routeSample(track,route,gate.s-2.2/track.length),{routeId:route.id,speed:60,checkpoints:2});
  const initialCheckpoints=r.checkpoints;let movedPast=false;
  for(let i=0;i<60;i++){
    assert.equal(gateOpen(gate,race.time+STEP),false);drive(race);
    const p=routeSample(track,route,gate.s),along=(r.x-p.x)*Math.sin(p.heading)+(r.z-p.z)*Math.cos(p.heading);
    movedPast||=along>0;finite(race);
    assert.ok(r.s<gate.s,'closed gate advanced canonical progress beyond its plane');
  }
  assert.equal(movedPast,false);assert.equal(r.checkpoints,initialCheckpoints);
  race.time=8;for(let i=0;i<120&&r.s<gate.s+5/track.length;i++)drive(race);
  assert.ok(r.s>gate.s+5/track.length,'open gate did not release the waiting kart');
});

for(const offset of [-6,0,6])void test(`isolated freight gate blocks lane ${offset} at the maximum supported step and speed`,()=>{
  const {race,r,track,route}=solo('midnight',200),gate=COURSE_DESIGNS.midnight.gates[0];race.time=5.2;
  Object.assign(r,routeSample(track,route,gate.s-2.2/track.length,offset),{routeId:route.id,speed:65,checkpoints:2});
  stepRace(race,{[r.id]:{...NEUTRAL,throttle:true}},.05);
  const p=routeSample(track,route,gate.s),along=(r.x-p.x)*Math.sin(p.heading)+(r.z-p.z)*Math.cos(p.heading);
  assert.ok(along<0,`kart crossed the closed gate by ${along.toFixed(2)}m`);assert.ok(r.s<gate.s);assert.equal(r.checkpoints,2);
});

for(const id of Object.keys(TRACKS) as TrackId[])void test(`${id}: isolated branch recovery and reconnect retain earned progress`,()=>{
  const {race,r,track,route}=solo(id),s=(route.from+route.to)/2;
  Object.assign(r,routeSample(track,route,s),{routeId:route.id,speed:15,checkpoints:Math.floor(s*track.gates)+1});
  const earned=r.checkpoints;r.connected=false;drive(race);r.connected=true;
  const before=r.s;stepRace(race,{[r.id]:NEUTRAL});assert.ok(Math.abs(r.s-before)*track.length<2);
  respawn(race,r);assert.equal(r.routeId,undefined);assert.equal(r.checkpoints,earned);
  assert.ok(mod(s-r.s)*track.length<12,'recovery advanced ahead or fell behind its earned sector');
  assert.equal(r.speed,0);finite(race);
});

void test('isolated late branch placement cannot bypass missing mandatory checkpoints',()=>{
  const {race,r,track,route}=solo('rainbow'),s=route.to-5/track.length;
  Object.assign(r,routeSample(track,route,s),{routeId:route.id,speed:25,checkpoints:1});
  for(let i=0;i<300;i++)drive(race);
  assert.equal(r.checkpoints,1);assert.equal(r.finishTime,null);finite(race);
});

for(const id of Object.keys(TRACKS) as TrackId[])void test(`${id}: isolated branch trap hits its deck and ignores a kart above it`,()=>{
  const {race,r,track,route}=solo(id),control=route.points.reduce((a,b)=>Math.abs(a.lift)>Math.abs(b.lift)?a:b);
  const s=route.from+(route.to-route.from)*(control.lift===0?.5:control.t);
  Object.assign(r,routeSample(track,route,s),{routeId:route.id,item:'banana'});activateItem(race,r);
  const trap=race.hazards[0],location=routeNearest(track,route,trap.x,trap.z),deck=routeSample(track,route,location.s,location.offset);
  const victim={...r,...deck,id:'victim',item:null,y:deck.y+10};race.racers.push(victim);
  updateHazards(race,STEP);assert.equal(victim.stun,0);assert.equal(race.hazards.length,1);
  victim.y=deck.y;updateHazards(race,STEP);assert.ok(victim.stun>0,'trap was not on its branch deck');assert.equal(race.hazards.length,0);
});

for(const id of Object.keys(TRACKS) as TrackId[])void test(`${id}: a main-road driver completes one ordered lap`,()=>{
  const {race,r}=solo(id);r.driver=1;
  for(let i=0;i<60*210&&r.finishTime===null;i++){drive(race);if(i%60===0)finite(race);assert.equal(r.routeId,undefined,`main-road driver took a fork at s=${r.s}, time=${race.time}`);}
  assert.notEqual(r.finishTime,null,JSON.stringify({s:r.s,checkpoints:r.checkpoints,speed:r.speed}));assert.equal(r.checkpoints,17);
});
