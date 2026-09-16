import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, botInput, stepRace, STEP } from '../src/engine/simulation';
import { isSpeedClass, SPEED_CLASSES } from '../src/engine/speed';
import { nearest, sample, TRACKS } from '../src/engine/tracks';
import { NEUTRAL, type SpeedClass } from '../src/engine/types';

void test('speed classes accept only numeric 50, 100, 150, and 200 and default to the original 100cc pace',()=>{
  assert.deepEqual(SPEED_CLASSES.map(option=>option.value),[50,100,150,200]);
  for(const value of [undefined,null,'150',0,75,250,NaN,Infinity])assert.equal(isSpeedClass(value),false);
  const options={track:'coast' as const,players:[]};
  assert.deepEqual(createRace(options),createRace({...options,speedClass:100}));
  assert.equal(createRace({...options,speedClass:999 as SpeedClass}).speedClass,100);
});
for(const option of SPEED_CLASSES) {
  void test(`${option.label}: top speed and cornering scale together without changing CPU difficulty`,()=>{
    const race=createRace({track:'coast',speedClass:option.value,difficulty:'easy',players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],p=sample(TRACKS.coast,.02);
    race.phase='racing';race.racers=[r];Object.assign(r,{x:p.x,z:p.z,y:p.y,s:p.s,heading:p.heading,speed:30*option.multiplier});
    stepRace(race,{h:{...NEUTRAL,throttle:true,steer:.5}});
    assert.equal(r.speed,30*option.multiplier);
    assert.ok(Math.abs((r.heading-p.heading)/option.multiplier-1.5/1.72*.5*STEP)<1e-10);
    assert.equal(race.difficulty,'easy');assert.equal(race.speedClass,option.value);
  });
  for(const track of Object.values(TRACKS)) {
    void test(`${option.label} ${track.id}: every CPU completes a full lap`,()=>{
      const race=createRace({track:track.id,speedClass:option.value,laps:1,players:[]});
      for(let i=0;i<60*(track.length/(10*option.multiplier)+120)&&race.phase!=='results';i++)stepRace(race,{});
      assert.ok(race.racers.every(r=>r.finishTime!==null),JSON.stringify(race.racers.map(r=>({id:r.id,finish:r.finishTime,checkpoints:r.checkpoints}))));
      console.log(`${option.label} ${track.id}: first lap ${Math.round(race.firstFinish!)}s`);
    });
    for(const ramp of track.ramps)for(const boosted of [false,true])void test(`${option.label} ${track.id}: ${boosted?'boosted':'normal'} ramp ${ramp.s} launches and lands safely`,()=>{
      const race=createRace({track:track.id,speedClass:option.value,players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],p=sample(track,ramp.s-3/track.length);
      race.phase='racing';race.racers=[r];Object.assign(r,{x:p.x,z:p.z,y:p.y,s:p.s,heading:p.heading,speed:(boosted?48:30)*option.multiplier,boost:boosted?8:0,coins:8,checkpoints:Math.floor(p.s*track.gates)+1});
      let airSteps=0,landed=false,maxOffset=0;
      for(let i=0;i<600;i++){
        stepRace(race,{h:{...botInput(race,r),use:false}});
        if(r.airborne){airSteps++;maxOffset=Math.max(maxOffset,nearest(track,r.x,r.z).distance);}
        else if(airSteps){landed=true;break;}
      }
      assert.ok(airSteps>15&&landed,'must launch and complete its landing');
      assert.ok(maxOffset<track.width/2,`guided flight left the road by ${maxOffset-track.width/2}m`);
      assert.ok(nearest(track,r.x,r.z).distance<track.width/2,'must land within the road');
    });
  }
}
