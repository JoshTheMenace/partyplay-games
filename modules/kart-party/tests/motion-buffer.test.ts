import test from 'node:test';
import assert from 'node:assert/strict';
import {createMotionBuffer,type MotionRace} from '../game/motion-buffer';
const snapshot=(time:number,x=time*40):MotionRace=>({track:'coast',phase:'racing',time,countdown:0,racers:[{id:'a',x,y:5,z:0,heading:Math.PI/2,s:time*.01,speed:40,verticalSpeed:0,airborne:false}]});
const near=(a:number,b:number,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
const stats=(values:number[])=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return {mean,stddev:Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length),min:Math.min(...values),max:Math.max(...values)};};
function measure(delays:number[],dropEvery=0){
  const packets=Array.from({length:301},(_,i)=>({at:i*.05+delays[i%delays.length],race:snapshot(i*.05),i})).filter(packet=>!dropEvery||packet.i%dropEvery!==0);
  const buffer=createMotionBuffer<MotionRace>();let packet=0,raw=0,mesh=0,camera=0,previousMesh=0,previousCamera=0,previousRaw=0,previousPresented=0;
  const oldMesh:number[]=[],oldCamera:number[]=[],oldLookAt:number[]=[],presented:number[]=[],lags:number[]=[];
  for(let frame=0;frame<900;frame++){
    const now=frame/60;
    while(packet<packets.length&&packets[packet].at<=now+1e-9){const next=packets[packet++];raw=next.race.racers[0].x;buffer.push(next.race,next.at);}
    mesh+=(raw-mesh)*(1-Math.exp(-18/60));camera+=(raw-camera)*(1-Math.exp(-7/60));
    const pose=buffer.sample(now)?.race.racers[0].x??0;
    if(frame>120){oldMesh.push(mesh-previousMesh);oldCamera.push(camera-previousCamera);oldLookAt.push(raw-previousRaw);presented.push(pose-previousPresented);lags.push(now-pose/40);}
    previousMesh=mesh;previousCamera=camera;previousRaw=raw;previousPresented=pose;
  }
  return {oldMesh:stats(oldMesh),oldCamera:stats(oldCamera),oldLookAt:stats(oldLookAt),presented:stats(presented),presentationAgeSeconds:stats(lags)};
}
void test('20Hz packets produce uniform 60Hz poses instead of the current exponential speed pulses',()=>{
  const result=measure([.01]);assert.ok(result.oldMesh.stddev>.15);assert.ok(result.oldCamera.stddev>.05);assert.ok(result.oldLookAt.stddev>.8);
  assert.ok(result.presented.stddev<1e-8);near(result.presented.mean,40/60);near(result.presentationAgeSeconds.mean,.06);
});
void test('arrival jitter and isolated packet loss do not change constant-speed displacement',()=>{
  for(const result of [measure([.01,.025,.018,.035,.013]),measure([.01,.025,.018,.035,.013],7)]){
    assert.ok(result.presented.stddev<1e-8);near(result.presentationAgeSeconds.mean,.06);assert.ok(result.presentationAgeSeconds.max<.12);
  }
});
void test('late first arrival corrects clock alignment gradually without packet-sized jumps',()=>{
  const result=measure([.035,.01,.028,.022]);assert.ok(result.presented.stddev<1e-8);near(result.presentationAgeSeconds.mean,.06);
});
void test('extrapolation stops after 100ms and cannot run a kart indefinitely through the course',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(1),1.01);buffer.push(snapshot(1.05),1.06);
  near(buffer.sample(1.21)!.race.racers[0].x,46);near(buffer.sample(4)!.race.racers[0].x,46);
  near(buffer.sample(4)!.extrapolatedSeconds,.1);
});
void test('a long reconnect gap snaps to the received race without replaying stale motion',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(1),1.01);buffer.sample(1.02);
  buffer.push(snapshot(4),4.01);const frame=buffer.sample(4.01)!;near(frame.race.racers[0].x,160);assert.deepEqual(frame.snappedIds,['a']);
  buffer.reset();assert.equal(buffer.sample(4.02),null);buffer.push(snapshot(8),8.01);near(buffer.sample(8.01)!.race.racers[0].x,320);
});
void test('teleports snap the affected racer without drawing a path through intervening terrain',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(1),1.01);buffer.sample(1.01);buffer.push(snapshot(1.05,180),1.06);
  const frame=buffer.sample(1.06)!;near(frame.race.racers[0].x,180);assert.deepEqual(frame.snappedIds,['a']);
  near(buffer.sample(1.09)!.race.racers[0].x,180);
});
void test('headings and lap progress cross their wrap in the short direction',()=>{
  const buffer=createMotionBuffer<MotionRace>(),a=snapshot(1),b=snapshot(1.05);
  a.racers[0].heading=Math.PI-.02;b.racers[0].heading=-Math.PI+.02;a.racers[0].s=.999;b.racers[0].s=.001;
  buffer.push(a,1.01);buffer.push(b,1.06);const pose=buffer.sample(1.085)!.race.racers[0];near(pose.heading,Math.PI);near(pose.s,0);
});
void test('countdown uses its decreasing clock and crosses zero into racing continuously',()=>{
  const buffer=createMotionBuffer<MotionRace>(),a=snapshot(0,0),b=snapshot(0,0);a.phase=b.phase='countdown';a.countdown=.1;b.countdown=.05;
  buffer.push(a,1);buffer.push(b,1.05);buffer.push(snapshot(0,0),1.1);buffer.push(snapshot(.05,2),1.15);
  const frame=buffer.sample(1.15)!;near(frame.race.racers[0].x,0);near(frame.race.time,0);
});
void test('rematch and track changes reset old trajectories even when racer IDs match',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(100),100.01);buffer.sample(100.01);
  const next=snapshot(0,0);next.phase='countdown';next.countdown=3.5;buffer.push(next,100.06);
  near(buffer.sample(100.06)!.race.racers[0].x,0);const other=snapshot(2,800);other.track='rainbow';buffer.push(other,100.11);near(buffer.sample(100.11)!.race.racers[0].x,800);
});
void test('duplicate ticks and stale packets cannot bias the clock or replace a newer pose',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(1),1.01);buffer.push(snapshot(1.05),1.06);
  buffer.push(snapshot(1.05),1.08);buffer.push(snapshot(1,700),1.09);near(buffer.sample(1.11)!.race.racers[0].x,42);
});
void test('sampling creates display poses and never mutates authoritative snapshots or discrete metadata',()=>{
  const buffer=createMotionBuffer<MotionRace&{serial:number}>(),a={...snapshot(1),serial:1},b={...snapshot(1.05),serial:2};const original=JSON.stringify([a,b]);
  buffer.push(a,1.01);buffer.push(b,1.06);const frame=buffer.sample(1.085)!;assert.equal(frame.race.serial,2);near(frame.race.racers[0].x,41);assert.equal(JSON.stringify([a,b]),original);assert.notEqual(frame.race.racers[0],b.racers[0]);
});

void test('a short respawn with speed reset snaps instead of rewinding smoothly through the road',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(1),1.01);buffer.sample(1.01);const respawn=snapshot(1.05,32);respawn.racers[0].speed=0;buffer.push(respawn,1.06);
  const frame=buffer.sample(1.06)!;near(frame.race.racers[0].x,32);assert.deepEqual(frame.snappedIds,['a']);near(buffer.sample(1.2)!.race.racers[0].x,32);
});
void test('a stopped kart is not extrapolated using its previous moving interval',()=>{
  const buffer=createMotionBuffer<MotionRace>();buffer.push(snapshot(1),1.01);const stopped=snapshot(1.05,40.3);stopped.racers[0].speed=0;buffer.push(stopped,1.06);near(buffer.sample(1.2)!.race.racers[0].x,40.3);
});
void test('steady result broadcasts do not repeatedly reset an idle camera',()=>{
  const buffer=createMotionBuffer<MotionRace>(),result=snapshot(30);result.phase='results';buffer.push(result,30.01);buffer.sample(30.01);
  for(let i=1;i<80;i++){buffer.push({...result},30.01+i*.05);assert.deepEqual(buffer.sample(30.01+i*.05)!.snappedIds,[]);}
});

void test('render preparation does not bias the racing motion clock toward extrapolation',()=>{
 const buffer=createMotionBuffer<MotionRace>(),ready={...snapshot(0,0),phase:'countdown' as const,countdown:3.5,startId:'race',startAt:null};
 for(let i=0;i<20;i++)buffer.push({...ready},i*.05);
 for(let i=0;i<70;i++)buffer.push({...ready,startAt:4500,countdown:3.5-i*.05},1+i*.05);
 buffer.push({...snapshot(0),startId:'race',startAt:4500},4.5);
 buffer.push({...snapshot(.05),startId:'race',startAt:4500},4.55);
 const frame=buffer.sample(4.58)!;near(frame.extrapolatedSeconds,0);near(frame.race.racers[0].x,1.2,.0001);
});
