import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { courseScenery } from '../src/engine/course-scenery';
import { botInput, createRace, stepRace, STEP } from '../src/engine/simulation';
import { advanceTrackMotion } from '../src/engine/track-physics';
import { nearest, roadHeight, sample, surfaceFrame, magneticAt, sectorAt, TRACKS } from '../src/engine/tracks';

for(const track of Object.values(TRACKS)) {
  void test(`${track.id}: named sectors cover the loop and road grades remain driveable`,()=>{
    assert.equal(track.sectors[0].from,0);assert.equal(track.sectors.at(-1)!.to,1);
    track.sectors.forEach((sector,i)=>{
      assert.ok(sector.to>sector.from);
      if(i)assert.equal(track.sectors[i-1].to,sector.from);
      assert.equal(sectorAt(track,sector.from+1e-8),sector);
      assert.ok(sector.grip>0&&sector.speed>0&&sector.gravity>0);
    });
    for(let i=0;i<2000;i++){
      if(magneticAt(track,i/2000)||magneticAt(track,(i+1)/2000))continue;
      const a=sample(track,i/2000),b=sample(track,(i+1)/2000);
      assert.ok(Math.abs(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)<.25,`steep road at ${i/2000}`);
    }
  });
  void test(`${track.id}: sector scenery clears the driving lanes and tunnel passages`,()=>{
    const {group}=courseScenery(track),ray=new Raycaster();group.updateMatrixWorld(true);ray.far=2.5;
    for(let i=0;i<1200;i++)for(const offset of [-track.width/2+1.5,0,track.width/2-1.5]){
      const s=i/1200,p=sample(track,s,offset);
      const f=surfaceFrame(track,s,offset,.3);
      ray.set(magneticAt(track,s)?new Vector3(f.position.x,f.position.y,f.position.z):new Vector3(p.x,roadHeight(track,s,offset)+.3,p.z),magneticAt(track,s)?new Vector3(f.up.x,f.up.y,f.up.z):new Vector3(0,1,0));
      assert.equal(ray.intersectObject(group,true).length,0,`scenery intersects kart at ${s}, lane ${offset}`);
    }
  });
  for(const ramp of track.ramps)for(const boosted of [false,true])void test(`${track.id}: ramp ${ramp.s} launches and lands on the road at ${boosted?'boosted':'normal'} speed`,()=>{
    const race=createRace({track:track.id,players:[{id:'human',name:'Human',driver:0}]}),r=race.racers[0],p=sample(track,ramp.s-3/track.length);
    race.phase='racing';race.racers=[r];Object.assign(r,{x:p.x,z:p.z,y:p.y,s:p.s,heading:p.heading,speed:boosted?48:30,boost:boosted?8:0,coins:8,checkpoints:Math.floor(p.s*track.gates)+1});
    let airSteps=0,landed=false;
    for(let i=0;i<600;i++){
      stepRace(race,{human:{...botInput(race,r),use:false}});
      if(r.airborne){airSteps++;assert.ok(nearest(track,r.x,r.z).distance<track.width/2,'guided jump must stay within the road');}
      else if(airSteps){landed=true;break;}
    }
    assert.ok(airSteps>15&&landed,'must have a sustained flight and complete its landing');
    assert.ok(nearest(track,r.x,r.z).distance<track.width/2,'guided approach must land within the road');
    assert.equal(r.y,roadHeight(track,r.s,nearest(track,r.x,r.z).offset));
    assert.ok(r.boost>0,'a completed landing grants its boost');
  });
}
void test('steering off a raised ramp side starts a fall instead of snapping down to the road',()=>{
  const track=TRACKS.coast,ramp=track.ramps[0],race=createRace({track:'coast',players:[]}),r=race.racers[0];
  const previousS=ramp.s+ramp.length*.8/track.length;
  Object.assign(r,{s:previousS+1/track.length,y:roadHeight(track,previousS),speed:20});
  const before=r.y;
  advanceTrackMotion(race,r,previousS,ramp.width/2+.1,STEP);
  assert.equal(r.airborne,true);
  assert.ok(r.y>before-.1,'vertical position must advance continuously during the fall');
});
