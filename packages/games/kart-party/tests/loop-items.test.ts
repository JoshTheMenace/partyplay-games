import test from 'node:test';
import assert from 'node:assert/strict';
import { activateItem,updateHazards } from '../src/engine/items';
import { magneticAt,surfaceFrame,TRACKS } from '../src/engine/tracks';
import type {Hazard,Item,Race,Racer} from '../src/engine/types';
const track=TRACKS.rainbow;
function setup(item?:Item){
  const middle=Array.from({length:201},(_,i)=>track.magnetic!.from+(track.magnetic!.to-track.magnetic!.from)*i/200).sort((a,b)=>surfaceFrame(track,a).up.y-surfaceFrame(track,b).up.y)[0];
  const racer=(id:string,s:number)=>{const frame=surfaceFrame(track,s);return {id,...frame.position,s,heading:Math.atan2(frame.forward.x,frame.forward.z),loopOffset:0,loopDistance:(s-track.magnetic!.from)*track.length,item:null,itemCooldown:0,finishTime:null,stun:0,shield:0,star:0,coins:4,drift:0,driftSide:0,frost:0,oil:0,airborne:false,speed:30} as Racer;};
  const a=racer('a',middle),b=racer('b',track.magnetic!.from-30/track.length),race={track:'rainbow',racers:[a,b],hazards:[],events:[],serial:0,time:0} as unknown as Race;if(item)a.item=item;return {race,a,b};
}
function place(r:Racer,s:number,offset=0){const frame=surfaceFrame(track,s,offset);Object.assign(r,frame.position,{s,loopOffset:offset});}
void test('all projectile and trap items retain loop road coordinates when launched inverted',()=>{
  for(const item of ['shell','triple','frost','rocket','banana','oil','decoy'] as Item[]){
    const {race,a}=setup(item);activateItem(race,a);assert.equal(race.hazards.length,item==='triple'?3:1);
    for(const hazard of race.hazards){assert.ok(hazard.s!==undefined);const frame=surfaceFrame(track,hazard.s!,hazard.offset);assert.ok(Math.hypot(hazard.x-frame.position.x,hazard.z-frame.position.z)<1e-8);}
  }
});
void test('loop traps stay fixed on the ceiling, affect the next racer and retain shields',()=>{
  for(const item of ['banana','oil','decoy'] as Item[]){
    const {race,a,b}=setup(item);activateItem(race,a);const h=race.hazards[0],s=h.s!;updateHazards(race,.05);assert.equal(h.s,s);place(b,s,h.offset);b.shield=3;
    updateHazards(race,.05);assert.equal(b.shield,0);assert.equal(b.stun,0);assert.equal(b.oil,0);
  }
});
void test('surface projectiles travel forward at their specified speed through inversion',()=>{
  for(const [item,speed]of [['frost',48],['rocket',85],['shell',53]] as const){const {race,a}=setup(item);activateItem(race,a);const h=race.hazards[0],s=h.s!;updateHazards(race,.05);assert.ok(Math.abs((h.s!-s)*track.length-speed*.05)<1e-8);}
});
void test('loop seekers home laterally toward nearby forward rivals',()=>{
  const {race,a,b}=setup('shell');place(b,a.s+18/track.length,4);activateItem(race,a);updateHazards(race,.05);assert.ok(race.hazards[0].offset!>0);
});
void test('rockets and pulses cannot attack another route branch even if XYZ overlaps',()=>{
  const {race,a,b}=setup('pulse');Object.assign(b,{x:a.x,y:a.y,z:a.z,s:a.s+100/track.length});activateItem(race,a);assert.equal(b.stun,0);
  a.item='rocket';activateItem(race,a);const h=race.hazards[0],frame=surfaceFrame(track,h.s!,h.offset);Object.assign(b,frame.position);h.life=.001;updateHazards(race,.05);assert.equal(b.stun,0);
});
void test('ordinary hazards reject racers at another height even when they are not airborne',()=>{
  const {race,a,b}=setup();place(a,track.magnetic!.from-30/track.length);place(b,a.s);b.y+=30;
  race.hazards=[{id:1,kind:'banana',owner:a.id,x:a.x,z:a.z,heading:0,life:10}];updateHazards(race,.05);assert.equal(b.stun,0);assert.equal(race.hazards.length,1);
});
void test('a forward projectile approaching the portal attaches and one leaving resumes ordinary movement',()=>{
  const {race,a}=setup();const entry=surfaceFrame(track,track.magnetic!.from);race.hazards=[{id:1,kind:'frost',owner:a.id,x:entry.position.x-entry.forward.x*2,z:entry.position.z-entry.forward.z*2,heading:Math.atan2(entry.forward.x,entry.forward.z),life:5}];
  updateHazards(race,.05);assert.ok(race.hazards[0].s!==undefined);assert.ok(magneticAt(track,race.hazards[0].s!));
  const h:Hazard=race.hazards[0];h.s=track.magnetic!.to-1/track.length;h.offset=0;const exit=surfaceFrame(track,h.s);h.x=exit.position.x;h.z=exit.position.z;
  updateHazards(race,.05);assert.equal(h.s,undefined);assert.equal(h.offset,undefined);
});

void test('inverted traps and projectiles apply their distinct effects to racers on the same surface',()=>{
  for(const item of ['banana','oil','decoy','frost','shell','rocket'] as Item[]){
    const {race,a,b}=setup(item);assert.ok(surfaceFrame(track,a.s).up.y<-.9);activateItem(race,a);const h=race.hazards[0];place(b,h.s!,h.offset);b.item='boost';updateHazards(race,.01);
    if(item==='oil')assert.equal(b.oil,3);else if(item==='frost')assert.equal(b.frost,4);else assert.equal(b.stun,1.2);if(item==='decoy')assert.equal(b.item,null);
  }
});
