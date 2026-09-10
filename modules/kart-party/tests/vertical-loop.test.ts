import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceVerticalLoop,createVerticalLoop,loopCamera,sampleVerticalLoop,type Vector3 } from '../game/vertical-loop';
const dot=(a:Vector3,b:Vector3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=(v:Vector3)=>Math.hypot(v.x,v.y,v.z);
const distance=(a:Vector3,b:Vector3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const loop=createVerticalLoop({origin:{x:100,y:180,z:20},forward:{x:0,y:0,z:1}});
void test('vertical loop has distinct portals, forward entry/exit tangents and a fully inverted apex',()=>{
  const entry=sampleVerticalLoop(loop,0),apex=sampleVerticalLoop(loop,loop.length/2),exit=sampleVerticalLoop(loop,loop.length);
  assert.ok(distance(entry.position,loop.origin)<1e-10);assert.ok(Math.abs(exit.position.z-entry.position.z-loop.advance)<1e-8);assert.ok(distance(entry.forward,exit.forward)<1e-8);assert.ok(distance(entry.up,exit.up)<1e-8);
  assert.ok(Math.abs(apex.position.y-entry.position.y-2*loop.radius)<1e-7);assert.ok(apex.forward.z<-.8);assert.ok(apex.up.y<-.999);assert.ok(loop.length>2*Math.PI*loop.radius);
});
void test('every frame is finite and right-handed through the verticals without pole flips',()=>{
  let previous=sampleVerticalLoop(loop,0);
  for(let i=0;i<=2048;i++){
    const frame=sampleVerticalLoop(loop,i/2048*loop.length);
    for(const vector of [frame.forward,frame.up,frame.right])assert.ok(Math.abs(norm(vector)-1)<1e-10);
    assert.ok(Math.abs(dot(frame.up,frame.forward))<1e-10);assert.ok(Math.abs(dot(frame.right,frame.forward))<1e-10);
    assert.ok(dot(previous.up,frame.up)>.999);assert.ok(dot(previous.forward,frame.forward)>.999);previous=frame;
  }
});
void test('arc-length sampling moves at uniform physical speed on the climb, inversion and descent',()=>{
  let previous=sampleVerticalLoop(loop,0);
  for(let travelled=.2;travelled<loop.length;travelled+=.2){const frame=sampleVerticalLoop(loop,travelled);assert.ok(Math.abs(distance(previous.position,frame.position)-.2)<.002);previous=frame;}
});
void test('road, kart and camera use the same local up while inverted',()=>{
  const frame=sampleVerticalLoop(loop,loop.length/2),lifted=sampleVerticalLoop(loop,loop.length/2,3,.2),camera=loopCamera(frame,30);
  assert.ok(Math.abs(dot({x:lifted.position.x-frame.position.x,y:lifted.position.y-frame.position.y,z:lifted.position.z-frame.position.z},frame.up)-.2)<1e-8);
  assert.ok(camera.position.y<frame.position.y);assert.equal(camera.up.y,frame.up.y);assert.ok(Math.abs(dot({x:lifted.position.x-frame.position.x,y:lifted.position.y-frame.position.y,z:lifted.position.z-frame.position.z},frame.right)-3)<1e-8);
});
void test('50,100,150,200cc traverse the same full loop monotonically and preserve exit overshoot',()=>{
  for(const speed of [22.5,30,37.5,46.5]){
    let state={distance:0,offset:0},steps=0,exited=false,overshoot=0;
    while(!exited&&steps<2000){const next=advanceVerticalLoop(loop,state,speed,0,1/60);assert.ok(next.distance>=state.distance);state=next;exited=next.exited;overshoot=next.remainingDistance;steps++;}
    assert.ok(exited);assert.equal(state.distance,loop.length);assert.ok(Math.abs(steps/60-(loop.length+overshoot)/speed)<1e-8);
  }
});
void test('braking to zero at the apex does not drop or advance the kart, and lane steering stays on the road',()=>{
  const state={distance:loop.length/2,offset:0},stopped=advanceVerticalLoop(loop,state,0,0,.05);assert.equal(stopped.distance,state.distance);assert.equal(stopped.frame.up.y,sampleVerticalLoop(loop,state.distance).up.y);
  const edge=advanceVerticalLoop(loop,state,30,1000,.05);assert.equal(edge.offset,loop.width/2-1.25);assert.equal(edge.exited,false);
});
void test('arbitrary sloped headings remain continuous and deterministic',()=>{
  const a=createVerticalLoop({origin:{x:-40,y:200,z:80},forward:{x:1,y:.2,z:1}}),b=createVerticalLoop({origin:{x:-40,y:200,z:80},forward:{x:1,y:.2,z:1}});
  for(let i=0;i<200;i++)assert.deepEqual(sampleVerticalLoop(a,i),sampleVerticalLoop(b,i));
  const entry=sampleVerticalLoop(a,0),exit=sampleVerticalLoop(a,a.length);assert.ok(distance(entry.forward,exit.forward)<1e-8);assert.ok(Math.abs(dot(entry.up,entry.forward))<1e-10);
});
void test('invalid dimensions and sample state fail before propagating NaNs',()=>{
  assert.throws(()=>createVerticalLoop({origin:loop.origin,forward:{x:0,y:1,z:0}}));assert.throws(()=>createVerticalLoop({origin:loop.origin,forward:loop.forward,advance:200}));assert.throws(()=>sampleVerticalLoop(loop,NaN));assert.throws(()=>advanceVerticalLoop(loop,{distance:0,offset:0},30,0,.1));
});

void test('the loop twists sideways enough to separate its otherwise overlapping climb and descent',()=>{
  const positions=Array.from({length:1025},(_,i)=>sampleVerticalLoop(loop,i/1024*loop.length).position);let closest=Infinity;
  for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){if((j-i)/1024*loop.length<60)continue;closest=Math.min(closest,distance(positions[i],positions[j]));}
  assert.ok(closest>loop.width+4,`remote loop branches only ${closest} metres apart`);
});
