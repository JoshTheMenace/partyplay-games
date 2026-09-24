import assert from 'node:assert/strict';
import test from 'node:test';
import type { FighterKind } from '../src/model';
import { MOVESET } from '../src/moveset';
import { getStage, stageFrame } from '../src/stages';
import { setState } from '../src/sim/common';
import { HANG } from '../src/sim/fighter';
import { arena, type Arena } from '../src/sim/harness';

const FD = stageFrame('final-destination', 0), MAIN = FD.blocks[0]!, RIGHT = FD.ledges.find(l => l.side === 1)!;
/** Fighter i falling beside the right ledge (in the generous snap box). */
function nearLedge(a: Arena, i: number, dx = .35) {
  const f = a.f(i); Object.assign(f, { x: RIGHT.x + dx, y: RIGHT.y - 1.1, vx: 0, vy: -.02, grounded: false, ground: null, facing: -1 }); setState(f, 'air');
}
function onLedge(kind: FighterKind = 'marth', damage = 0) {
  const a = arena({ fighters: [kind, 'sandbag'] }); a.place(1, MAIN.left + 2); nearLedge(a, 0); a.f(0).damage = damage;
  for (let t = 0; t < 10 && a.f(0).state !== 'ledge'; t++) a.tick();
  assert.equal(a.f(0).state, 'ledge'); a.tick(40); // past the catch and its intangibility
  return a;
}
test('falling beside a ledge snaps to it; the first grab after landing is intangible, a regrab is not', () => {
  const a = arena({ fighters: ['fox', 'sandbag'] }); a.place(1, 0); nearLedge(a, 0, .55);
  for (let t = 0; t < 10 && a.f(0).state !== 'ledge'; t++) a.tick();
  assert.equal(a.f(0).state, 'ledge'); assert.equal(a.f(0).ledgeSide, 1); assert.ok(a.f(0).intangibleNow);
  assert.ok(a.s.events.some(e => e.kind === 'ledge'));
  a.tick(20); a.hold(0, { x: 1 }); a.tick(); a.hold(0, { x: 0 }); // drop away
  assert.equal(a.f(0).state, 'air'); a.tick(40);
  a.f(0).invincible = 0; nearLedge(a, 0); for (let t = 0; t < 10 && a.f(0).state !== 'ledge'; t++) a.tick();
  assert.equal(a.f(0).state, 'ledge'); assert.equal(a.f(0).invincible, 0);
});
test('ledge options: climb, roll, jump, attack (quick below 100%, slow above) and drop', () => {
  const climb = onLedge(); climb.hold(0, { x: -1 }); climb.tick(); climb.hold(0, { x: 0 }); climb.tick(60);
  assert.equal(climb.f(0).state, 'idle'); assert.ok(climb.f(0).grounded && climb.f(0).x < RIGHT.x);
  const roll = onLedge(); roll.press(0, 'shield'); roll.tick(80);
  assert.ok(roll.f(0).grounded && roll.f(0).x < climb.f(0).x - 1);
  const jump = onLedge(); jump.press(0, 'jump'); for (let t = 0; t < 60 && jump.f(0).state !== 'air'; t++) jump.tick();
  assert.equal(jump.f(0).state, 'air'); assert.ok(jump.f(0).vy > 0);
  const atk = onLedge(); atk.press(0, 'attack'); atk.tick();
  assert.equal(atk.f(0).move, 'ledgeattack'); assert.equal(atk.f(0).phase, 'climb');
  const slow = onLedge('marth', 120); slow.press(0, 'attack'); slow.tick();
  assert.equal(slow.f(0).move, 'ledgeattackSlow');
  const slowClimb = onLedge('marth', 120); slowClimb.hold(0, { x: -1 }); slowClimb.tick();
  assert.equal(slowClimb.f(0).phase, 'climbSlow');
});
test('hanging lasts five seconds, then the fighter drops', () => {
  const a = onLedge(); a.tick(HANG - 40 - 5); assert.equal(a.f(0).state, 'ledge'); a.tick(10); assert.equal(a.f(0).state, 'air');
});
test('one fighter per ledge: the arriving grab trumps the hanging one', () => {
  const a = arena({ fighters: ['fox', 'falco'] }); nearLedge(a, 0);
  for (let t = 0; t < 10 && a.f(0).state !== 'ledge'; t++) a.tick();
  a.tick(40); nearLedge(a, 1);
  for (let t = 0; t < 10 && a.f(1).state !== 'ledge'; t++) a.tick();
  assert.equal(a.f(1).state, 'ledge'); assert.notEqual(a.f(0).state, 'ledge');
});
function tumbleOnto(a: Arena, i: number) {
  const f = a.f(i); Object.assign(f, { x: 0, y: MAIN.top + 1.2, grounded: false, ground: null, ky: -.12, kx: 0, vx: 0, vy: 0, hitstun: 40, tumble: true, launch: .12 }); setState(f, 'tumble');
}
test('tech: Shield within 20 frames before landing techs (in place or rolling); otherwise knockdown and getup options', () => {
  const t = arena({ fighters: ['mario', 'sandbag'] }); t.place(1, 4); tumbleOnto(t, 0); t.tick(2); t.press(0, 'shield');
  for (let k = 0; k < 30 && !t.f(0).grounded; k++) t.tick();
  assert.equal(t.f(0).state, 'tech');
  const r = arena({ fighters: ['mario', 'sandbag'] }); r.place(1, 4); tumbleOnto(r, 0); r.tick(2); r.press(0, 'shield', { x: -1 });
  for (let k = 0; k < 30 && !r.f(0).grounded; k++) r.tick();
  assert.equal(r.f(0).phase, 'techB'); r.hold(0, { x: 0 }); r.tick(50); assert.ok(r.f(0).x < -1);
  const late = arena({ fighters: ['mario', 'sandbag'] }); late.place(1, 4); tumbleOnto(late, 0); late.press(0, 'shield'); late.tick(1);
  late.f(0).y += 3; for (let k = 0; k < 80 && !late.f(0).grounded; k++) late.tick();
  assert.equal(late.f(0).state, 'knockdown', 'a press long before landing is not a tech');
  late.tick(40); late.press(0, 'attack'); late.tick();
  assert.equal(late.f(0).move, 'getupattack'); assert.equal(late.f(0).state, 'getup');
  late.tick(MOVESET.mario.getupattack!.total + 2); assert.equal(late.f(0).state, 'idle');
});
test('wall tech: a tumbling fighter pressing Shield techs off the stage side', () => {
  const a = arena({ fighters: ['fox', 'sandbag'] }); a.place(1, 0); const f = a.f(0);
  Object.assign(f, { x: MAIN.right + .7, y: MAIN.top - 1.2, grounded: false, ground: null, kx: -.3, ky: 0, hitstun: 30, tumble: true, launch: .3 }); setState(f, 'tumble');
  a.press(0, 'shield'); for (let k = 0; k < 10 && f.state !== 'tech'; k++) a.tick();
  assert.equal(f.state, 'tech'); assert.equal(f.phase, 'techWall');
});
test('blast zones: a KO costs a stock, credits the recent attacker, respawns on a halo with invincibility', () => {
  const a = arena({ fighters: ['fox', 'mario'], settings: { stocks: 3 } }), blast = getStage('final-destination').blast;
  a.place(0, -2); a.place(1, 2); a.f(1).lastHitBy = 'p0'; a.f(1).lastHitFrame = a.s.frame;
  Object.assign(a.f(1), { x: blast.right + .5, grounded: false, vx: .3 }); a.tick();
  assert.equal(a.f(1).state, 'out'); assert.equal(a.f(1).stocks, 2); assert.equal(a.f(1).falls, 1); assert.equal(a.f(0).kos, 1);
  const ko = a.s.events.find(e => e.kind === 'ko')!; assert.equal(ko.source, 'p0'); assert.equal(ko.target, 'p1'); assert.ok(Number.isFinite(ko.angle));
  for (let t = 0; t < 200 && a.f(1).state !== 'respawn'; t++) a.tick();
  assert.equal(a.f(1).state, 'respawn'); assert.equal(a.f(1).damage, 0);
  a.tick(60); a.hold(1, { x: 1 }); a.tick();
  assert.equal(a.f(1).state, 'air'); assert.ok(a.f(1).intangibleNow);
});
test('the top blast zone only KOs launched fighters', () => {
  const a = arena({ fighters: ['fox', 'mario'] }), top = getStage('final-destination').blast.top;
  Object.assign(a.f(1), { y: top + .2, grounded: false, vy: .1 }); setState(a.f(1), 'air'); a.tick();
  assert.notEqual(a.f(1).state, 'out'); assert.equal(a.f(1).stocks, 4);
  Object.assign(a.f(1), { y: top + .2, ky: .5, launch: .5, hitstun: 30, tumble: true }); setState(a.f(1), 'tumble'); a.tick();
  assert.equal(a.f(1).state, 'out');
});
