import test from 'node:test';
import assert from 'node:assert/strict';
import { partyAwards } from '../game/awards';
import { createRace } from '../game/simulation';
import { statsFor } from '../game/race-stats';

void test('party awards use recorded human stats and deterministic race-order tie breaks',()=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]});
  const [a,b]=race.racers;Object.assign(statsFor(a),{maxSpeed:40,driftBoosts:3,hitsDealt:1});Object.assign(statsFor(b),{maxSpeed:38,driftBoosts:1,hitsDealt:4});
  a.rank=2;b.rank=1;const awards=partyAwards(race);
  assert.equal(awards.find(award=>award.id==='speed')?.racer.id,'a');assert.equal(awards.find(award=>award.id==='hits')?.racer.id,'b');assert.equal(awards.find(award=>award.id==='drift')?.value,'3 boosts');
  assert.ok(awards.every(award=>!award.racer.bot));
});

void test('solo awards include the whole field and omit categories nobody earned',()=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});statsFor(race.racers[2]).coinsCollected=7;
  const awards=partyAwards(race);assert.equal(awards.find(award=>award.id==='coins')?.racer.id,race.racers[2].id);assert.equal(awards.some(award=>award.id==='shield'),false);
});
