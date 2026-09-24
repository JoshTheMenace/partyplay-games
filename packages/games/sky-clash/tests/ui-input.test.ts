import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLICK, InputEncoder, SWIPE, keyStick, readSwipe } from '../src/ui/input';
/** Slide the pad from its current spot to (x, y) in `steps` samples, `ms` apart, starting at t. Returns the end time. */
function slide(e: InputEncoder, t: number, x: number, y: number, steps = 3, ms = 16) {
  for (let i = 1; i <= steps; i++) e.stick(x * i / steps, y * i / steps, t + i * ms, 'slide');
  return t + steps * ms;
}
test('a quick flick then Attack is a smash aimed along the flick', () => {
  const e = new InputEncoder(), t = slide(e, 0, 1, 0);
  e.button('attack', true, t + 60);
  const i = e.input();
  assert.deepEqual([i.presses.smash, i.presses.attack], [1, 0]); assert.deepEqual(i.aim, { x: 1, y: 0 }); assert.equal(i.held.attack, true, 'held for charging');
});
test('Attack long after a flick, or after a slow tilt, stays a tilt', () => {
  const late = new InputEncoder(), t = slide(late, 0, 1, 0);
  late.button('attack', true, t + FLICK.after + 20);
  assert.deepEqual([late.input().presses.attack, late.input().presses.smash], [1, 0]);
  const tilt = new InputEncoder(), t2 = slide(tilt, 0, .95, 0, 10, 30); // 300 ms to the edge: not a flick
  tilt.button('attack', true, t2 + 200);
  assert.deepEqual([tilt.input().presses.attack, tilt.input().presses.smash], [1, 0]);
});
test('Attack pressed while the thumb slides outward becomes a smash when the flick lands', () => {
  const e = new InputEncoder();
  e.stick(.35, 0, 0, 'slide'); e.button('attack', true, 10);
  assert.equal(e.input().presses.attack, 0, 'deferred while sliding'); assert.equal(e.deferredUntil, 10 + FLICK.before);
  e.stick(.95, 0, 40, 'slide');
  assert.deepEqual([e.input().presses.attack, e.input().presses.smash], [0, 1]); assert.equal(e.deferredUntil, null);
});
test('a deferred Attack that never flicks fires as a normal attack aimed where it was pressed', () => {
  const e = new InputEncoder();
  e.stick(.4, 0, 0, 'slide'); e.button('attack', true, 5); e.stick(.6, -.2, 30, 'slide');
  assert.equal(e.tick(40), false); assert.equal(e.tick(5 + FLICK.before), true);
  assert.deepEqual([e.input().presses.attack, e.input().presses.smash], [1, 0]); assert.deepEqual(e.input().aim, { x: .4, y: 0 });
});
test('a thumb landing on the pad edge, or keys, never counts as a flick', () => {
  const touch = new InputEncoder();
  touch.stick(1, 0, 0, 'touch'); touch.button('attack', true, 30);
  assert.deepEqual([touch.input().presses.attack, touch.input().presses.smash], [1, 0]);
  const keys = new InputEncoder();
  keys.stick(1, 0, 0, 'key'); keys.button('attack', true, 20, 'key');
  assert.deepEqual([keys.input().presses.attack, keys.input().presses.smash], [1, 0]);
});
test('Shield + Attack is a grab; the grab key and the Smash key are presses too', () => {
  const e = new InputEncoder();
  e.button('shield', true, 0); e.button('attack', true, 20);
  const i = e.input();
  assert.deepEqual([i.presses.grab, i.presses.attack, i.presses.shield], [1, 0, 1]); assert.equal(i.held.shield, true);
  e.grab(); assert.equal(e.input().presses.grab, 2);
  e.stick(0, 1, 30, 'key'); e.button('smash', true, 40, 'key');
  assert.equal(e.input().presses.smash, 1); assert.deepEqual(e.input().aim, { x: 0, y: 1 }); assert.equal(e.input().held.smash, true);
});
test('a swipe on Special is a special aimed along the swipe, whatever the stick says', () => {
  const e = new InputEncoder();
  e.stick(1, 0, 0, 'touch'); e.button('special', true, 10, 'touch', { x: 0, y: -1 });
  assert.equal(e.input().presses.special, 1); assert.deepEqual(e.input().aim, { x: 0, y: -1 }, 'swipe up = up-special'); assert.equal(e.input().held.special, true);
  e.button('special', false, 20); e.button('special', true, 30); assert.deepEqual(e.input().aim, { x: 1, y: 0 }, 'a tap aims with the stick');
  assert.equal(e.input().presses.special, 2);
});
test('a swipe on Attack is a smash aimed along the swipe, held for charging, even with Shield held', () => {
  const e = new InputEncoder({ smash: 4 });
  e.button('shield', true, 0); e.button('attack', true, 10, 'touch', { x: -.6, y: .8 });
  const i = e.input();
  assert.deepEqual([i.presses.smash, i.presses.attack, i.presses.grab], [5, 0, 0]); assert.deepEqual(i.aim, { x: -.6, y: .8 }); assert.equal(i.held.attack, true);
  e.button('attack', true, 20, 'touch', { x: 1, y: 0 }); assert.equal(e.input().presses.smash, 5, 'still held: not a new press');
  e.sync({ smash: 2 }); assert.equal(e.input().presses.smash, 5, 'an old echo never lowers the counter');
});
test('readSwipe: travel or a fast flick is a swipe, a still thumb soon becomes a tap', () => {
  assert.deepEqual(readSwipe(0, -SWIPE.distance, 30), { x: 0, y: -1 });
  assert.deepEqual(readSwipe(21, 20, 40), { x: .724, y: .69 });
  assert.equal(readSwipe(3, 2, 20), null, 'undecided at first');
  assert.equal(readSwipe(3, 2, SWIPE.tap), 'tap');
  assert.equal(readSwipe(12, 0, SWIPE.tap), null, 'a thumb on the move keeps waiting');
  assert.equal(readSwipe(12, 0, SWIPE.max), 'tap');
  assert.deepEqual(readSwipe(-16, 0, 30, true), { x: -1, y: 0 }, 'short fast flick on release');
  assert.equal(readSwipe(-16, 0, 200, true), 'tap', 'slow short drift is a tap');
  assert.equal(readSwipe(0, 0, 5, true), 'tap');
});
test('counters are monotonic across holds, sources, releases and server echoes', () => {
  const e = new InputEncoder({ jump: 5, attack: 2 });
  e.button('jump', true, 0); e.button('jump', true, 1, 'key');
  assert.equal(e.input().presses.jump, 6, 'a second source while held is not a new press');
  e.button('jump', false, 2); assert.equal(e.input().held.jump, true, 'still held by the keyboard');
  e.button('jump', false, 3, 'key'); e.button('jump', true, 4); assert.equal(e.input().presses.jump, 7);
  e.release(); assert.equal(e.input().presses.jump, 7); assert.equal(e.input().held.jump, false); assert.equal(e.neutral(), true);
  e.sync({ jump: 3, attack: 9 }); assert.deepEqual([e.input().presses.jump, e.input().presses.attack], [7, 9]);
  const before = e.input().presses; e.sync({ attack: Number.NaN }); assert.deepEqual(e.input().presses, before);
});
test('aim captures the stick at attack/special/smash/grab presses and survives recentering', () => {
  const e = new InputEncoder();
  e.stick(0, -1, 0, 'touch'); e.button('special', true, 10); e.stick(0, 0, 20, 'slide');
  assert.deepEqual(e.input().aim, { x: 0, y: -1 }); assert.deepEqual([e.input().x, e.input().y], [0, 0]);
  e.stick(-.6, .6, 30, 'key'); e.button('smash', true, 40); assert.deepEqual(e.input().aim, { x: -.6, y: .6 });
  e.stick(.2, .1, 50, 'key'); e.button('jump', true, 60); assert.deepEqual(e.input().aim, { x: -.6, y: .6 }, 'jump does not move aim');
});
test('release drops holds and a pending attack but keeps the input schema complete', () => {
  const e = new InputEncoder();
  e.stick(.4, 0, 0, 'slide'); e.button('attack', true, 5); e.button('shield', true, 6); e.release();
  const i = e.input();
  assert.deepEqual(Object.keys(i.held).sort(), ['attack', 'jump', 'shield', 'smash', 'special']); assert.deepEqual(Object.keys(i.presses).sort(), ['attack', 'grab', 'jump', 'shield', 'smash', 'special']);
  assert.equal(e.tick(1000), false); assert.equal(i.presses.attack, 0); assert.ok(Object.values(i.held).every(v => !v));
});
test('keyboard movement normalizes diagonals and ignores duplicate directions', () => {
  assert.deepEqual(keyStick(['d']), { x: 1, y: 0 });
  const d = keyStick(['w', 'a']); assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9); assert.ok(d.x < 0 && d.y < 0);
  assert.deepEqual(keyStick(['d', 'arrowright']), { x: 1, y: 0 }); assert.deepEqual(keyStick([]), { x: 0, y: 0 });
});
