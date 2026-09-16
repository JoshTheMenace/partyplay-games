import test from 'node:test';
import assert from 'node:assert/strict';
import {botInput,createRace,stepRace,STEP} from '../src/engine/simulation';
import {estimatedRaceSeconds,raceTimeRemaining} from '../src/engine/race-timing';
import {NEUTRAL} from '../src/engine/types';
void test('CPU finishes do not cut off a solo family racer',()=>{
 const race=createRace({track:'rainbow',speedClass:50,laps:3,players:[{id:'h',name:'Human',driver:0}]});race.phase='racing';race.time=450;race.firstFinish=300;race.racers[1].finishTime=300;
 stepRace(race,{h:NEUTRAL});assert.equal(race.phase,'racing');assert.ok(raceTimeRemaining(race)>120);
 race.firstHumanFinish=400;assert.ok(Math.abs(raceTimeRemaining(race)-110)<.1,'50cc racers get 160 seconds after the first human finish');
});
void test('a 50cc Rainbow solo player more than two minutes behind the CPUs earns a finish',()=>{
 const race=createRace({track:'rainbow',speedClass:50,laps:3,players:[{id:'h',name:'Human',driver:0}]}),human=race.racers[0];
 for(let step=0;step<60*1500&&race.phase!=='results';step++)stepRace(race,{h:race.time<210?NEUTRAL:{...botInput(race,human),use:false}});
 assert.ok(human.finishTime!==null,'the slower player must finish instead of being DNF');
 const leader=Math.min(...race.racers.filter(r=>r.bot).map(r=>r.finishTime??Infinity));assert.ok(human.finishTime-leader>=120);assert.equal(race.phase,'results');
});
void test('race estimates scale with laps and class and hard timeout remains bounded',()=>{
 assert.ok(estimatedRaceSeconds('rainbow',3,50)>estimatedRaceSeconds('rainbow',3,200));
 const race=createRace({track:'coast',laps:1,players:[{id:'h',name:'H',driver:0}]});race.phase='racing';race.time=600-STEP/2;stepRace(race,{});assert.equal(race.phase,'results');
});
