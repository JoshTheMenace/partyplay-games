import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkClock} from '../src/engine/network-clock';
void test('clock aligns epoch to monotonic time using the lowest RTT and resets across reconnect',()=>{
 const clock=createNetworkClock();clock.receive(100000,1000);assert.equal(clock.now(1200),100200);
 clock.receive(100200,1240,1200);assert.equal(clock.now(1240),100220);
 clock.receive(999999,1300,1200);assert.equal(clock.now(1300),100280,'slower RTT must not move the clock');
 clock.reset();clock.receive(200000,5000);assert.equal(clock.now(5100),200100);
});
