import test from 'node:test';
import assert from 'node:assert/strict';
import { itemRoulette, ROULETTE_SECONDS } from '../game/item-roulette';
import { createRace } from '../game/simulation';

void test('item roulette is deterministic presentation and never changes the authoritative held item',()=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});race.phase='racing';const racer=race.racers[0];racer.item='rocket';
  race.events.push({id:7,type:'item',racer:racer.id,time:10,item:'rocket'});race.time=10.35;
  const first=itemRoulette(race,racer),again=itemRoulette(race,racer);assert.deepEqual(first,again);assert.equal(first.active,true);assert.equal(racer.item,'rocket');
  race.time=10+ROULETTE_SECONDS;assert.deepEqual(itemRoulette(race,racer),{active:false,item:'rocket',progress:1});
});

void test('using an item immediately ends its client-side roulette',()=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});race.phase='racing';const racer=race.racers[0];racer.item=null;
  race.events.push({id:1,type:'item',racer:racer.id,time:0,item:'star'});assert.deepEqual(itemRoulette(race,racer),{active:false,item:null,progress:1});
});
