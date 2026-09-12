import test from 'node:test';
import assert from 'node:assert/strict';
import { COAST_DESIGN } from '../src/engine/courses/coast';
import { sample, TRACKS } from '../src/engine/tracks';

const track=TRACKS.coast,route=COAST_DESIGN.routes[0];
void test('the tidal causeway is a substantial separate road with gradual, grounded merges',()=>{
  const length=(route.to-route.from)*track.length;
  assert.ok(length>=100&&length<=220);
  assert.ok(route.width>=7&&route.width<=10);
  assert.deepEqual(route.points[0],{t:0,offset:0,lift:0});
  assert.deepEqual(route.points.at(-1),{t:1,offset:0,lift:0});
  assert.ok(route.points[1].t*length>45);
  assert.ok((1-route.points.at(-2)!.t)*length>40);
  for(const [i,p] of route.points.entries()){
    assert.ok(p.lift>=-6&&p.lift<=0);
    if(i)assert.ok(p.t>route.points[i-1].t);
    if(i>0&&i<route.points.length-1)assert.ok(p.offset>track.width/2+route.width/2+4);
    const main=sample(track,route.from+(route.to-route.from)*p.t),branch=sample(track,main.s,p.offset);
    assert.ok(branch.y+p.lift>2);
    // Positive lateral offsets are screen-left in the chase camera.
    assert.ok((branch.x-main.x)*Math.cos(main.heading)-(branch.z-main.z)*Math.sin(main.heading)>=-.001);
  }
});
void test('the causeway avoids launch ramps and other sections of road',()=>{
  for(const ramp of track.ramps)assert.ok(ramp.s>route.to||ramp.s+ramp.length/track.length<route.from-12/track.length);
  for(const p of route.points.slice(1,-1)){
    const s=route.from+(route.to-route.from)*p.t,branch=sample(track,s,p.offset);
    for(const other of track.points){
      if(Math.abs(other.s-s)*track.length<100)continue;
      assert.ok(Math.hypot(other.x-branch.x,other.z-branch.z)>track.width/2+route.width/2+5);
    }
  }
});
void test('the tide washes the full branch while the main clifftop remains an alternative',()=>{
  const wash=COAST_DESIGN.zones.find(zone=>zone.id==='causeway-surge')!;
  assert.equal(wash.routeId,route.id);assert.equal(wash.kind,'water');
  assert.ok(wash.from>route.from&&wash.to<route.to);
  assert.ok((wash.to-wash.from)*track.length>75);
  assert.equal(wash.offset,0);assert.equal(wash.width,route.width);
  assert.ok(wash.strength>=.6&&wash.strength<=1);
  assert.ok(wash.activeFor!>0&&wash.period!-wash.activeFor!>10);
  assert.ok(route.speed>1&&route.grip<1);
  assert.ok(COAST_DESIGN.zones.every(zone=>zone.routeId===route.id));
});
