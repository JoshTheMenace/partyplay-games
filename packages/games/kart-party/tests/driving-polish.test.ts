import test from 'node:test';
import assert from 'node:assert/strict';
import { drivingSpeed } from '../src/engine/driving';
import { createChaseCamera } from '../src/engine/chase-camera';
import { contactRecoil, recordContact } from '../src/engine/contact-feedback';
import { courseBends } from '../src/engine/course-markings';
import { resolveKartContact } from '../src/engine/kart-contact';
import { resolveLoopContact } from '../src/engine/loop-contact';
import { createRace, stepRace } from '../src/engine/simulation';
import { NEUTRAL } from '../src/engine/types';
import { angleDelta, sample, surfaceFrame, TRACKS } from '../src/engine/tracks';

void test('boost expiry preserves momentum, settles to cruising speed, and braking remains immediate',()=>{
  assert.ok(drivingSpeed(46.5,30,17,12,1/60)>46);
  let speed=46.5;for(let i=0;i<120;i++)speed=drivingSpeed(speed,30,17,12,1/60);
  assert.equal(speed,30);
  assert.ok(drivingSpeed(46.5,30,-17,12,1/60)<drivingSpeed(46.5,30,17,12,1/60));
  assert.equal(drivingSpeed(0,30,-34,12,1/60),0);
  for(const dt of [1/120,1/60,1/30]){let value=46.5;for(let t=0;t<Math.round(.5/dt);t++)value=drivingSpeed(value,30,17,12,dt);assert.ok(Math.abs(value-40.5)<1e-9);}
});
void test('the real simulation eases expired boost and coasts on neutral input',()=>{
  const race=createRace({track:'coast',players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0];race.racers=[r];race.phase='racing';
  Object.assign(r,sample(TRACKS.coast,.02),{speed:46.5,boost:.001});
  stepRace(race,{h:{...NEUTRAL,throttle:true}});assert.ok(r.speed>46&&r.speed<46.5);
  const before=r.speed;stepRace(race,{h:NEUTRAL});assert.ok(r.speed<before);
});
void test('contact has bounded feedback without a stun, and resting pile-ups do not spam it',()=>{
  const race=createRace({track:'coast',players:[]}),[a,b]=race.racers;
  Object.assign(a,{x:0,z:0,y:0,heading:0,speed:30});Object.assign(b,{x:0,z:2,y:0,heading:0,speed:10});
  resolveKartContact(race,a,b);assert.equal(race.events.filter(e=>e.type==='bump').length,2);assert.equal(a.stun,0);assert.equal(a.speed,18);assert.equal(b.speed,22);
  recordContact(race,a,100);assert.equal(race.events.length,2);
  race.time=.3;recordContact(race,a,3);assert.equal(race.events.length,2);
  recordContact(race,a,100);assert.equal(a.impact?.strength,1);assert.equal(race.events.length,3);
  assert.equal(contactRecoil(a,.2),0);assert.ok(contactRecoil(a,.35)>0);assert.equal(contactRecoil(a,1),0);
  for(let i=0;i<100;i++){race.time+=.3;recordContact(race,a,10);}assert.equal(race.events.length,24);
});
void test('loop impacts use the same feedback without changing earned progress',()=>{
  const race=createRace({track:'rainbow',players:[]}),[a,b]=race.racers,track=TRACKS.rainbow;
  for(const [i,r] of [a,b].entries()){const s=track.magnetic!.from+(80+i*2)/track.length;Object.assign(r,surfaceFrame(track,s).position,{s,loopDistance:80+i*2,loopOffset:0,speed:i?10:30});}
  resolveLoopContact(race,a,b);assert.equal(race.events.filter(e=>e.type==='bump').length,2);assert.equal(a.checkpoints,0);assert.equal(a.stun,0);
});
void test('camera eases turns and boosts, wraps yaw, and cuts immediately to a new subject',()=>{
  const r=createRace({track:'coast',players:[]}).racers[0],camera=createChaseCamera();r.heading=Math.PI-.05;
  camera.sample(r,1/60,true,false);r.heading=-Math.PI+.05;r.boost=1;
  const first=camera.sample(r,1/60,true,false);assert.ok(first.fov>60&&first.fov<61);assert.ok(Math.abs(angleDelta(first.heading,Math.PI-.05))<.03);
  const switched=camera.sample({...r,id:'next'},1/60,true,false);assert.equal(switched.cut,true);assert.equal(switched.heading,r.heading);
  assert.equal(camera.sample(r,1/60,true,true).fov,60);
  camera.reset();assert.equal(camera.sample(r,1/60,true,false).cut,true);
});
void test('camera smoothing has the same response at 30 and 120 fps',()=>{
  const r=createRace({track:'coast',players:[]}).racers[0];r.heading=0;
  const sample=(dt:number)=>{const camera=createChaseCamera();camera.sample(r,dt,true,false);let pose;for(let i=0;i<Math.round(.5/dt);i++)pose=camera.sample({...r,heading:1,boost:1},dt,true,false);return pose!;};
  const a=sample(1/30),b=sample(1/120);assert.ok(Math.abs(a.heading-b.heading)<1e-10);assert.ok(Math.abs(a.fov-b.fov)<1e-10);
});
for(const track of Object.values(TRACKS))void test(`${track.id}: bend signs match route curvature and remain spaced`,()=>{
  const bends=courseBends(track);assert.ok(bends.length>0);
  for(const [i,bend] of bends.entries()){
    assert.equal(bend.direction,Math.sign(angleDelta(sample(track,bend.s+20/track.length).heading,sample(track,bend.s-20/track.length).heading)));
    if(i)assert.ok((bend.s-bends[i-1].s)*track.length>=71);
  }
});
void test('an obstacle impact emits feedback through the authoritative simulation',()=>{
  const race=createRace({track:'coast',players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],track=TRACKS.coast,p=sample(track,.8,3.5);
  race.phase='racing';race.racers=[r];Object.assign(r,p,{x:p.x-Math.sin(p.heading)*2,z:p.z-Math.cos(p.heading)*2,s:.8-2/track.length,speed:25});
  stepRace(race,{h:{...NEUTRAL,throttle:true}});assert.ok(race.events.some(event=>event.type==='bump'&&event.racer==='h'));assert.equal(r.stun,0);
});
