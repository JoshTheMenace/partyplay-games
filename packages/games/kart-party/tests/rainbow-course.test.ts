import test from 'node:test';
import assert from 'node:assert/strict';
import { RAINBOW_DESIGN } from '../src/engine/courses/rainbow';
import { routeSample } from '../src/engine/course-routes';
import { angleDelta, sample, TRACKS } from '../src/engine/tracks';

const track=TRACKS.rainbow,route=RAINBOW_DESIGN.routes[0];
void test('starwind orbit is an elevated separate road beyond the remapped loop and ramps',()=>{
  assert.ok((route.to-route.from)*track.length>200);assert.ok(route.width<track.width/2);
  assert.ok(route.from>track.magnetic!.to+60/track.length);
  assert.ok(track.ramps.every(r=>route.to<r.s-20/track.length||route.from>r.s+(r.length+20)/track.length));
  for(const s of [route.from,route.to]){
    const p=routeSample(track,route,s),main=sample(track,s);
    assert.ok(Math.hypot(p.x-main.x,p.y-main.y,p.z-main.z)<.01);
    assert.ok(Math.abs(angleDelta(p.heading,main.heading))<.03);
  }
  let detached=0;
  for(let i=0;i<=200;i++){
    const s=route.from+(route.to-route.from)*i/200,p=routeSample(track,route,s),main=sample(track,s);
    if(Math.hypot(p.x-main.x,p.z-main.z)>(track.width+route.width)/2+2)detached++;
    for(let j=0;j<500;j++){
      const progress=j/500;if(Math.abs(angleDelta(progress*Math.PI*2,s*Math.PI*2))*track.length/(Math.PI*2)<60)continue;
      const q=sample(track,progress);
      assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>(track.width+route.width)/2+3,'orbit intersects another road section');
    }
  }
  assert.ok(detached>110);assert.ok(routeSample(track,route,.895).y-sample(track,.895).y>6);
});
void test('the forward current and outward wind pulse together with room to merge calmly',()=>{
  const current=RAINBOW_DESIGN.zones.find(z=>z.kind==='conveyor')!,wind=RAINBOW_DESIGN.zones.find(z=>z.kind==='wind')!;
  assert.deepEqual([wind.period,wind.activeFor,wind.phase],[current.period,current.activeFor,current.phase]);
  assert.ok(current.activeFor!<current.period!);assert.ok(current.strength>wind.strength&&wind.strength>0);
  for(const zone of [current,wind]){
    assert.equal(zone.routeId,route.id);assert.ok(zone.from>route.from+40/track.length);assert.ok(zone.to<route.to-40/track.length);
    assert.ok((zone.to-zone.from)*track.length>70);
  }
  assert.equal(RAINBOW_DESIGN.gates.length,0);
});
