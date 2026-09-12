import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { foxData } from '../fidelity/fox-data';
import { decodeHitbox, commandBytes } from '../fidelity/commands';
import { driftAcceleration, fallVelocity, traceAir } from '../fidelity/physics';
const fixture = JSON.parse(readFileSync(new URL('./reference-vectors.json', import.meta.url), 'utf8'));
test('ported air helpers match 320 native-C probes including reversal, overspeed, neutral and terminal clamp', () => {
  assert.equal(fixture.vectors.length, 320);
  for (const {input:[vx,stick,vy],output:[accel,fall]} of fixture.vectors) {
    assert.equal(driftAcceleration(vx,stick), Math.fround(accel), `drift ${vx},${stick}`);
    assert.equal(fallVelocity(vy,foxData.attributes.gravity,foxData.attributes.terminal_velocity), Math.fround(fall), `fall ${vy}`);
  }
});
test('raw command decoding corrects published Fox jab dimensions and retains bone-space meaning', () => {
  const jab = foxData.actions.find(a=>a.name==='Attack11')!;
  const hit = decodeHitbox(jab.events.find(e=>e.name==='hitbox')!.hex);
  assert.equal(hit.damage,4); assert.equal(hit.bone,25); assert.equal(hit.angle,70); assert.equal(hit.growth,100);
  assert.equal(hit.size,3.327911853790283); assert.equal(hit.offset.x,4.655951976776123);
  assert.notEqual(hit.size,3.3411764705882354); // Published fields use a different scale; raw bytes win.
  assert.deepEqual([hit.offset.y,hit.offset.z],[0,0]); assert(hit.hitGrounded && hit.hitAirborne);
});
test('signed offsets, shield damage, flags and strict command boundaries survive decoding', () => {
  const hit=decodeHitbox('2c00c8040100ff000100fe002319001303fbfc00');
  assert.equal(hit.offset.x,-.9999359846115112); assert.equal(hit.offset.y,.9999359846115112);
  assert.equal(hit.offset.z,-1.9998719692230225); assert.equal(hit.shieldDamage,-1);
  assert.equal(hit.hitGrounded,false); assert.equal(hit.hitAirborne,false);
  for(const bad of ['', 'xyz','0','00','2c00c804']) assert.throws(()=>decodeHitbox(bad));
  assert.throws(()=>commandBytes('2c zz'));
});
test('imported data preserves source values, typed integer words, and all raw script boundaries', () => {
  assert.equal(foxData.source.revisionVerified,false); assert.equal(foxData.attributes.unused_0,1);
  assert.equal(foxData.attributes.weight,75); assert.equal(foxData.attributes.jump_startup_time,3);
  assert.equal(foxData.actions.length,327); assert.equal(foxData.subroutines.length,63);
  assert.equal(foxData.actions.find(a=>a.name==='Attack11')!.animationFrames,18);
  let hitboxes=0;
  for(const action of [...foxData.actions,...foxData.subroutines]) for(const event of action.events) {
    const bytes=commandBytes(event.hex); assert.equal(bytes.length%4,0);
    if(bytes[0]>>>2===11) {const hit=decodeHitbox(event.hex); assert(Number.isFinite(hit.size)); hitboxes++;}
  }
  assert(hitboxes>100);
});
test('prescribed movement probes expose source-unit trajectories without adding model scale', () => {
  const full=traceAir(foxData.attributes.jump_v_initial_velocity,1,80);
  const short=traceAir(foxData.attributes.hop_v_initial_velocity,1,80);
  assert(Math.max(...full.map(s=>s.y))>Math.max(...short.map(s=>s.y)));
  assert.equal(full.at(-1)!.vy,-foxData.attributes.terminal_velocity);
  assert.equal(full.at(-1)!.vx,foxData.attributes.air_drift_max);
  assert.deepEqual(full,traceAir(foxData.attributes.jump_v_initial_velocity,1,80));
  assert.throws(()=>traceAir(1,0,Infinity)); assert.throws(()=>driftAcceleration(0,NaN));
});
