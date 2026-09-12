import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { courseObstacles } from '../src/engine/course-features';
import { routeSample } from '../src/engine/course-routes';
import { courseScenery } from '../src/engine/course-scenery';
import { CANYON_DESIGN } from '../src/engine/courses/canyon';
import { createCanyonDetails } from '../src/engine/courses/canyon-visuals';
import { angleDelta, groundHeight, sample, TRACKS } from '../src/engine/tracks';

const track=TRACKS.canyon,route=CANYON_DESIGN.routes[0];
void test('Eagle Ridge is a separated shortcut with smooth merges clear of the ramps',()=>{
  let length=0,separate=0;
  for(let i=1;i<=1000;i++){
    const s=route.from+(route.to-route.from)*i/1000,p=routeSample(track,route,s),a=routeSample(track,route,s-(route.to-route.from)/1000),main=sample(track,s);
    length+=Math.hypot(p.x-a.x,p.z-a.z);
    if(Math.hypot(p.x-main.x,p.z-main.z)>(track.width+route.width)/2+2)separate++;
  }
  const span=(route.to-route.from)*track.length;
  assert.ok(span>=100&&span<=220);
  assert.ok(length<span*.94&&separate>450,'the ridge must shorten the bend and have a distinct central lane');
  for(const s of [route.from,route.to]){
    const p=routeSample(track,route,s),main=sample(track,s);
    assert.ok(Math.hypot(p.x-main.x,p.y-main.y,p.z-main.z)<1e-6);
    assert.ok(Math.abs(angleDelta(p.heading,main.heading))<.08);
  }
  assert.ok(track.ramps.every(ramp=>ramp.s>route.to||ramp.s+ramp.length/track.length<route.from));
});
void test('Eagle Ridge keeps both edges driveable and clear of unrelated roads',()=>{
  for(let i=1;i<=2000;i++)for(const offset of [-route.width/2,0,route.width/2]){
    const s=route.from+(route.to-route.from)*i/2000,p=routeSample(track,route,s,offset),a=routeSample(track,route,s-(route.to-route.from)/2000,offset),d=Math.hypot(p.x-a.x,p.z-a.z);
    assert.ok(Math.abs(p.y-a.y)/d<.25,`steep edge at ${s}, ${offset}`);
    assert.ok(p.y>groundHeight(track,p.x,p.z)+.2,'ridge must remain above terrain');
    if(i%20)continue;
    for(let j=0;j<1000;j++){
      const otherS=j/1000;if(otherS>route.from-.025&&otherS<route.to+.025)continue;
      const other=sample(track,otherS);
      assert.ok(Math.hypot(p.x-other.x,p.z-other.z)>track.width/2+2,'ridge must not cross another road');
    }
  }
});
void test('Eagle Ridge scenery leaves headroom across the branch and original road',()=>{
  const group=courseScenery(track).group,details=createCanyonDetails(track),ray=new Raycaster();
  group.add(details);group.updateMatrixWorld(true);ray.far=2.5;
  for(let i=0;i<=600;i++){
    const s=route.from+(route.to-route.from)*i/600;
    for(const offset of [-route.width/2+1,0,route.width/2-1]){
      const p=routeSample(track,route,s,offset);ray.set(new Vector3(p.x,p.y+.3,p.z),new Vector3(0,1,0));
      assert.equal(ray.intersectObject(group,true).length,0,`branch scenery at ${s}, ${offset}`);
    }
    for(const offset of [-track.width/2+1.5,0,track.width/2-1.5]){
      const p=sample(track,s,offset);ray.set(new Vector3(p.x,p.y+.3,p.z),new Vector3(0,1,0));
      assert.equal(ray.intersectObject(details,true).length,0,`trestle on original road at ${s}, ${offset}`);
    }
  }
});
void test('the ridge center bypasses every position of the Eagle Gorge crossing boulder',()=>{
  const p=routeSample(track,route,.6);
  for(let i=0;i<200;i++){
    const rock=courseObstacles(track,i/10).find(obstacle=>obstacle.s===.6)!;
    const q=sample(track,rock.s,rock.offset);
    assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>rock.radius+1.25);
  }
});
