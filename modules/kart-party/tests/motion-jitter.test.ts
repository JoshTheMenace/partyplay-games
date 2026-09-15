import test from 'node:test';
import assert from 'node:assert/strict';
import {createMotionBuffer,PARTY_PRESENTATION,type MotionRace} from '../game/motion-buffer';

const snapshot=(time:number):MotionRace=>({track:'coast',phase:'racing',time,countdown:0,racers:[{id:'a',x:time*40,y:5,z:0,heading:Math.PI/2,s:time*.01,speed:40,verticalSpeed:0,airborne:false}]});
function lcg(seed:number){let s=seed>>>0;return ()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/2**32;}

/** Ordered 20Hz delivery with bounded jitter and an optional stall, sampled at 60 FPS after a warm-up. */
function play(options:Parameters<typeof createMotionBuffer>[0],jitterMs:number,{stallAt=-1,stallMs=0,seconds=10}={}){
  const random=lcg(7),buffer=createMotionBuffer<MotionRace>(options),packets:{at:number;race:MotionRace}[]=[];let arrival=0;
  for(let i=0;i*.05<=seconds+1;i++){
    const time=i*.05,stalled=stallAt>=0&&time>=stallAt&&time<stallAt+stallMs/1000?stallAt+stallMs/1000-time:0;
    arrival=Math.max(arrival,time+.01+random()*jitterMs/1000+stalled);packets.push({at:arrival,race:snapshot(time)});
  }
  let next=0,previous:number|null=null,frozen=0,backward=0,frames=0;
  for(let frame=0;frame<seconds*60;frame++){
    const now=frame/60;
    while(next<packets.length&&packets[next].at<=now){buffer.push(packets[next].race,packets[next].at);next++;}
    const x=buffer.sample(now)?.race.racers[0].x;
    if(now>2&&x!==undefined&&previous!==null){frames++;if(x-previous<1e-6)frozen++;if(x<previous-1e-9)backward++;}
    if(x!==undefined)previous=x;
  }
  return {frozen,backward,frames};
}

test('the previous 50 ms party presentation froze under modest ordered jitter',()=>{
  assert.ok(play({maxExtrapolationSeconds:0},26).frozen>0);
});

test('party presentation stays smooth through 0–26 ms ordered delivery jitter',()=>{
  const result=play(PARTY_PRESENTATION,26);
  assert.equal(result.frozen,0,`${result.frozen} of ${result.frames} frames froze`);
  assert.equal(result.backward,0);
});

test('a clean link settles toward the minimum delay without dropping below it',()=>{
  const buffer=createMotionBuffer<MotionRace>(PARTY_PRESENTATION);let delay=0;
  for(let i=0;i<200;i++){buffer.push(snapshot(i*.05),i*.05+.01);for(let f=0;f<3;f++)delay=buffer.sample(i*.05+.01+f/60)!.delaySeconds;}
  assert.ok(delay>=.075-1e-9&&delay<.09,`delay ${delay}`);
});

test('a 250 ms stall never moves presentation backward and motion resumes',()=>{
  const result=play(PARTY_PRESENTATION,5,{stallAt:4,stallMs:250});
  assert.equal(result.backward,0);
  assert.ok(result.frozen<=15,`${result.frozen} frozen frames`);
});
