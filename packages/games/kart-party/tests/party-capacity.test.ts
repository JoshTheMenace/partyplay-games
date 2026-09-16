import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, STEP, stepRace, botInput } from '../src/engine/simulation';
import { DRIVERS, MAX_PLAYERS, DEFAULT_GRID_SIZE } from '../src/engine/types';
import { viewportRect } from '../src/engine/split-screen';
import { TRACKS } from '../src/engine/tracks';
import type { TrackId } from '../src/engine/types';
import { createKart } from '../src/engine/kart';
import { disposeObject } from '../src/engine/dispose';
import { readPreferences } from '../src/engine/preferences';

for(let count=1;count<=MAX_PLAYERS;count++)void test(`${count} players all get a valid kart, a separate starting slot and a non-overlapping viewport`,()=>{
  const players=Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Player ${i}`,driver:i}));
  const race=createRace({track:'coast',players});
  assert.deepEqual(race.racers.filter(r=>!r.bot).map(r=>r.id),players.map(p=>p.id));
  assert.equal(race.racers.length,Math.max(DEFAULT_GRID_SIZE,count));
  assert.equal(new Set(race.racers.map(r=>r.driver)).size,race.racers.length);
  assert.equal(new Set(race.racers.map(r=>`${r.x},${r.z}`)).size,race.racers.length);
  const views=players.map((_,i)=>viewportRect(count,i));
  for(const [i,a] of views.entries()){
    assert.ok(a.width>0&&a.height>0&&a.x>=0&&a.y>=0&&a.x+a.width<=1.000001&&a.y+a.height<=1.000001);
    for(const b of views.slice(i+1))assert.ok(a.x+a.width<=b.x+1e-8||b.x+b.width<=a.x+1e-8||a.y+a.height<=b.y+1e-8||b.y+b.height<=a.y+1e-8);
  }
});
void test('new drivers survive preferences and create colored 3D karts',()=>{
  for(const driver of [8,9]){
    assert.equal(readPreferences(JSON.stringify({driver})).driver,driver);
    const kart=createKart(driver);assert.equal(kart.driver,driver);assert.ok(kart.group.children.length);disposeObject(kart.group);
  }
  assert.equal(DRIVERS.length,MAX_PLAYERS);
});
for(const track of Object.keys(TRACKS) as TrackId[])for(const speedClass of [50,100,150,200] as const)void test(`ten racers finish and receive ranks on ${track} at ${speedClass}cc`,()=>{
  const race=createRace({track,laps:1,speedClass,players:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`P${i}`,driver:i}))});
  for(let tick=0;tick<60*600&&race.phase!=='results';tick++)stepRace(race,Object.fromEntries(race.racers.map(r=>[r.id,botInput(race,r)])),STEP);
  assert.equal(race.phase,'results');assert.ok(race.racers.every(r=>r.finishTime!==null));
  assert.deepEqual(race.racers.map(r=>r.rank).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9,10]);
});
