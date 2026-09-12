import test from 'node:test';
import assert from 'node:assert/strict';
import { activateItem, hit, ITEM_IDS, ITEMS, selectItem, tickStatuses, updateHazards } from '../src/engine/items';
import { createRace, stepRace } from '../src/engine/simulation';
import { nearest, roadHeight, sample, TRACKS } from '../src/engine/tracks';
import { NEUTRAL, type Item, type Racer } from '../src/engine/types';

function place(racer:Racer,x:number,z:number,extra:Partial<Racer>={}){
  const location=nearest(TRACKS.coast,x,z);Object.assign(racer,{x,z,s:location.s,y:roadHeight(TRACKS.coast,location.s,location.offset),...extra});
}
function setup(item?: Item) {
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1},{id:'c',name:'C',driver:2}],seed:42});
  race.phase='racing';race.racers=race.racers.slice(0,3);
  race.racers.forEach((r,i)=>{const p=sample(TRACKS.coast,.2+i*.02);Object.assign(r,{x:p.x,y:p.y,z:p.z,s:p.s,heading:p.heading,speed:0,bot:false});});
  const [a,b,c]=race.racers;if(item) a.item=item;
  return {race,a,b,c};
}
void test('all twelve items have complete metadata and deterministic placement-weighted drops',()=>{
  assert.equal(ITEM_IDS.length,12);
  for(const item of ITEM_IDS) for(const value of Object.values(ITEMS[item])) assert.ok(value.length>0);
  const {race:a}=setup(),{race:b}=setup(),{race:rear}=setup();const seen=new Set<Item>();let frontPower=0,rearPower=0;
  for(let i=0;i<5000;i++) {
    const item=selectItem(a,1);assert.equal(item,selectItem(b,1));seen.add(item);
    if(['star','triple','pulse','rocket'].includes(item)) frontPower++;
    if(['star','triple','pulse','rocket'].includes(selectItem(rear,3))) rearPower++;
  }
  assert.equal(seen.size,12);assert.ok(rearPower>frontPower*2);
});
void test('Comet Kick grants a bounded boost and Bubble Guard blocks exactly one attack',()=>{
  const {race,a}=setup('boost');activateItem(race,a);assert.equal(a.boost,2.3);assert.equal(a.item,null);
  a.item='shield';activateItem(race,a);assert.equal(a.shield,7);a.coins=5;hit(race,a);assert.equal(a.shield,0);assert.equal(a.stun,0);assert.equal(a.coins,5);
  hit(race,a);assert.equal(a.stun,1.2);assert.equal(a.coins,3);
});
void test('Seeker Beetle homes toward a rival and excludes finishers as targets',()=>{
  const {race,a,b,c}=setup('shell');place(a,0,0,{heading:0});place(b,20,30);place(c,-4,10,{finishTime:0});
  activateItem(race,a);const shell=race.hazards[0];updateHazards(race,.05);
  assert.equal(shell.kind,'shell');assert.ok(shell.heading>0);assert.ok(shell.z>4);assert.equal(shell.owner,a.id);
});
void test('Peel Out stays behind its owner and spins out one rival',()=>{
  const {race,a,b}=setup('banana');a.heading=0;a.coins=4;activateItem(race,a);const trap=race.hazards[0];
  assert.equal(trap.z,a.z-4);updateHazards(race,.05);assert.equal(trap.z,a.z-4);assert.equal(a.stun,0);
  place(b,trap.x,trap.z,{coins:4});updateHazards(race,.05);assert.equal(b.stun,1.2);assert.equal(b.coins,2);assert.equal(race.hazards.length,0);
});
void test('Thunderclap hits only nearby rivals and respects a shield',()=>{
  const {race,a,b,c}=setup('pulse');place(b,a.x+10,a.z,{shield:2});place(c,a.x+33,a.z);activateItem(race,a);
  assert.equal(b.shield,0);assert.equal(b.stun,0);assert.equal(c.stun,0);assert.equal(a.stun,0);
  b.shield=0;a.item='pulse';activateItem(race,a);assert.equal(b.stun,1.2);
});
void test('Beetle Brigade fires three spread seekers and assigns different available rivals',()=>{
  const {race,a,b,c}=setup('triple');activateItem(race,a);
  assert.equal(race.hazards.length,3);assert.ok(race.hazards.every(h=>h.kind==='shell'));
  assert.equal(new Set(race.hazards.map(h=>h.heading)).size,3);
  assert.deepEqual(new Set(race.hazards.map(h=>h.target)),new Set([b.id,c.id]));
});
void test('Jelly Slick persists, affects multiple rivals once each, and cannot bypass a shield next frame',()=>{
  const {race,a,b,c}=setup('oil');activateItem(race,a);const slick=race.hazards[0];
  place(b,slick.x,slick.z,{shield:2});place(c,slick.x+1,slick.z);
  updateHazards(race,.05);assert.equal(b.shield,0);assert.equal(b.oil,0);assert.equal(c.oil,3);assert.equal(race.hazards.length,1);
  tickStatuses(c,.5);updateHazards(race,.05);assert.equal(c.oil,2.5);assert.equal(b.oil,0);assert.equal(c.stun,0);
});
void test('Snowball Express travels straight and slows without a spinout or coin loss',()=>{
  const {race,a,b}=setup('frost');place(a,0,0,{heading:0});activateItem(race,a);place(b,0,7,{speed:30,coins:5});
  updateHazards(race,.05);assert.equal(b.frost,4);assert.equal(b.speed,18);assert.equal(b.stun,0);assert.equal(b.coins,5);assert.equal(race.hazards.length,0);
});
void test('Coin Comet attracts nearby off-lane coins once per lap',()=>{
  const {race,a}=setup('magnet');race.racers=[a];const track=TRACKS.coast,coin=track.coins[0],p=sample(track,coin.s-5/track.length,coin.offset+5);
  Object.assign(a,{x:p.x,y:p.y,z:p.z,s:p.s,heading:p.heading});stepRace(race,{});assert.equal(a.coins,0);
  activateItem(race,a);assert.equal(a.magnet,8);stepRace(race,{});assert.ok(a.coins>0);const collected=a.coins;
  stepRace(race,{});assert.equal(a.coins,collected);assert.equal(a.coinsTaken.length,collected);
});
void test('Solar Crown clears slow and slip, protects its shield, and attacks on contact',()=>{
  const {race,a,b}=setup('star');a.frost=3;a.oil=2;a.shield=4;activateItem(race,a);
  assert.equal(a.star,6);assert.equal(a.frost,0);assert.equal(a.oil,0);hit(race,a);assert.equal(a.shield,4);assert.equal(a.stun,0);
  place(b,a.x+1,a.z,{heading:a.heading});stepRace(race,{});assert.ok(b.stun>0);assert.equal(a.stun,0);
});
void test('Pop Rocket uses fast straight travel and bursts across nearby rivals',()=>{
  const {race,a,b,c}=setup('rocket'),p=sample(TRACKS.coast,.02);place(a,p.x,p.z,{heading:0});activateItem(race,a);
  place(b,p.x,p.z+7);place(c,p.x+9,p.z+8);updateHazards(race,.05);
  assert.equal(b.stun,1.2);assert.equal(c.stun,1.2);assert.equal(a.stun,0);assert.equal(race.hazards.length,0);
});
void test('Pop Rocket bursts when its fuse expires even without direct contact',()=>{
  const {race,a,b}=setup('rocket'),p=sample(TRACKS.coast,.02);place(a,p.x,p.z,{heading:0});activateItem(race,a);race.hazards[0].life=.01;place(b,p.x+9,p.z+8);
  updateHazards(race,.05);assert.equal(b.stun,1.2);assert.equal(race.hazards.length,0);
});
void test('Surprise Parcel removes the victim item while ordinary traps preserve it',()=>{
  const {race,a,b}=setup('decoy');activateItem(race,a);const trap=race.hazards[0];place(b,trap.x,trap.z,{item:'star'});
  updateHazards(race,.05);assert.equal(b.stun,1.2);assert.equal(b.item,null);
  b.stun=0;b.item='boost';hit(race,b);assert.equal(b.item,'boost');
});
void test('all harmful effects respect invincibility and finishers without consuming shields or items',()=>{
  for(const effect of ['stun','frost','oil','decoy'] as const) for(const immune of ['star','finished'] as const) {
    const {race,a}=setup('boost');a.shield=3;if(immune==='star') a.star=2;else a.finishTime=0;
    hit(race,a,effect);assert.equal(a.shield,3);assert.equal(a.item,'boost');assert.equal(a.stun+a.frost+a.oil,0);
  }
});
void test('finishers cannot activate any item or consume any hazard',()=>{
  for(const item of ITEM_IDS) {
    const {race,a,b}=setup(item);a.finishTime=0;activateItem(race,a);assert.equal(a.item,item);assert.equal(race.hazards.length,0);
    b.item=item;activateItem(race,b);
    for(const h of race.hazards) {Object.assign(h,{x:a.x,z:a.z,heading:0});}
    const count=race.hazards.length;updateHazards(race,.01);assert.equal(race.hazards.length,count);
  }
});
void test('timed effects expire, item pickup cooldown prevents activation, and released buttons can fire later',()=>{
  const {race,a}=setup('boost');a.itemCooldown=1;activateItem(race,a);assert.equal(a.item,'boost');assert.equal(a.boost,0);
  Object.assign(a,{boost:2,shield:2,stun:2,frost:2,oil:2,magnet:2,star:2});tickStatuses(a,10);
  for(const field of ['boost','shield','stun','frost','oil','magnet','star','itemCooldown'] as const) assert.equal(a[field],0);
  stepRace(race,{a:{...NEUTRAL,use:true}});assert.equal(a.item,null);assert.ok(a.boost>0);
});
void test('frost limits speed and oil produces lateral slip through the movement simulation',()=>{
  const normal=setup(),frozen=setup(),slick=setup();
  for(const state of [normal,frozen,slick]) {state.race.racers=[state.a];state.a.speed=25;}
  frozen.a.frost=4;slick.a.oil=3;
  const input={a:{...NEUTRAL,throttle:true,steer:.8}};
  stepRace(normal.race,input);stepRace(frozen.race,input);stepRace(slick.race,input);
  assert.ok(frozen.a.speed<=18);assert.ok(frozen.a.speed<normal.a.speed);assert.ok(slick.a.lateral<0);assert.equal(normal.a.lateral,0);
});
void test('jumping above a ground trap avoids it until the racer lands',()=>{
  const {race,a,b}=setup('banana');activateItem(race,a);const trap=race.hazards[0];
  place(b,trap.x,trap.z,{y:1000,airborne:true});updateHazards(race,.05);
  assert.equal(b.stun,0);assert.equal(race.hazards.length,1);
  place(b,trap.x,trap.z,{airborne:false});updateHazards(race,.05);assert.equal(b.stun,1.2);assert.equal(race.hazards.length,0);
});
void test('Thunderclap measures vertical distance as well as distance across the road',()=>{
  const {race,a,b}=setup('pulse');Object.assign(b,{x:a.x,z:a.z,y:a.y+33,airborne:true});activateItem(race,a);
  assert.equal(b.stun,0);a.item='pulse';b.y=a.y+20;activateItem(race,a);assert.equal(b.stun,1.2);
});
