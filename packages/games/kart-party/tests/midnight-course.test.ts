import test from 'node:test';
import assert from 'node:assert/strict';
import { MIDNIGHT_DESIGN } from '../src/engine/courses/midnight';
import { routeSample } from '../src/engine/course-routes';
import { angleDelta, sample, TRACKS } from '../src/engine/tracks';

const track=TRACKS.midnight,route=MIDNIGHT_DESIGN.routes[0];
void test('freight road separates from downtown, rejoins smoothly, and avoids unrelated roads and ramps',()=>{
  assert.ok((route.to-route.from)*track.length>=200);
  for(const s of [route.from,route.to]){
    const p=routeSample(track,route,s),main=sample(track,s);
    assert.ok(Math.hypot(p.x-main.x,p.y-main.y,p.z-main.z)<.01);
    assert.ok(Math.abs(angleDelta(p.heading,main.heading))<.03);
  }
  let detached=0;
  for(let i=0;i<=200;i++){
    const s=route.from+(route.to-route.from)*i/200,p=routeSample(track,route,s),main=sample(track,s);
    if(Math.hypot(p.x-main.x,p.z-main.z)>(track.width+route.width)/2+2)detached++;
    for(const point of track.points){
      if(Math.abs(angleDelta(point.s*Math.PI*2,s*Math.PI*2))*track.length/(Math.PI*2)<60)continue;
      assert.ok(Math.hypot(p.x-point.x,p.z-point.z)>(track.width+route.width)/2+3,'branch intersects another road section');
    }
    assert.ok(track.ramps.every(r=>s<r.s||s>r.s+r.length/track.length),'branch crosses a main-road ramp');
  }
  assert.ok(detached>110,'express road must be a substantial separate road');
});
void test('the freight belt crosses a fully blocking timed gate while the public road stays available',()=>{
  const belt=MIDNIGHT_DESIGN.zones[0],gate=MIDNIGHT_DESIGN.gates[0];
  assert.equal(belt.kind,'conveyor');assert.equal(belt.routeId,route.id);assert.ok(belt.strength>0);
  assert.ok(belt.from>route.from&&belt.to<route.to);assert.ok((belt.to-belt.from)*track.length>80);
  assert.equal(gate.routeId,route.id);assert.ok(gate.s>belt.from&&gate.s<belt.to);
  assert.ok(gate.width>=route.width);assert.equal(gate.period-gate.openFor,3);assert.equal(gate.openFor,5);
  const p=routeSample(track,route,gate.s),main=sample(track,gate.s);
  assert.ok(Math.hypot(p.x-main.x,p.z-main.z)>(track.width+gate.width)/2+2);
});
