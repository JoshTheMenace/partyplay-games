import assert from 'node:assert/strict';
import test from 'node:test';
import { rules } from '../src/server';
import { ECHO } from '../src/sim/cpu';
import { arena } from '../src/sim/harness';

const out = (a: ReturnType<typeof arena>, i: number) => { Object.assign(a.f(i), { x: 99, grounded: false, ground: null }); a.f(i).state = 'air'; a.tick(); };

test('Ice Climbers: a Popo pick fights with Nana, who shares his stock and never counts as a player', () => {
  const a = arena({ fighters: ['popo', 'fox'] }), nana = a.f(2), v = a.view().fighters[2]!;
  assert.equal(nana.kind, 'nana'); assert.equal(nana.leader, 'p0'); assert.equal(nana.costume, a.f(0).costume);
  assert.equal(v.partner, 'p0'); assert.equal(v.stocks, a.f(0).stocks);
  assert.deepEqual(rules.outcome(a.s).rows.map(r => r.playerId).sort(), ['p0', 'p1']);
  assert.equal(arena({ fighters: ['nana', 'fox'] }).f(2).kind, 'popo', 'a Nana pick leads Popo');
});
test('Nana replays Popo\'s input a few frames late and never hits him', () => {
  const a = arena({ fighters: ['popo', 'fox'] });
  a.place(0, 0, { facing: 1 }); a.place(2, .3, { facing: 1 }); a.place(1, 5.5); a.tick();
  a.press(0, 'attack', { x: 0, y: 0 }); a.tick();
  assert.equal(a.f(0).move, 'jab1'); assert.equal(a.f(2).move, null);
  a.tick(ECHO - 1); assert.equal(a.f(2).move, null); a.tick(); assert.equal(a.f(2).move, 'jab1');
  a.tick(30); assert.equal(a.f(0).damage, 0); assert.equal(a.f(2).damage, 0);
});
test('Nana walks back to a grounded Popo when separated', () => {
  const a = arena({ fighters: ['popo', 'fox'] });
  a.place(0, -3); a.place(2, 3); a.place(1, 5.5); a.tick(90);
  assert.ok(Math.abs(a.f(2).x - a.f(0).x) < 2.6, `Nana regrouped (${a.f(2).x.toFixed(2)} vs ${a.f(0).x.toFixed(2)})`);
});
test('losing Nana costs no stock; losing Popo takes Nana too, and both return together', () => {
  const a = arena({ fighters: ['popo', 'fox'], settings: { stocks: 3 } });
  out(a, 2);
  assert.equal(a.f(2).state, 'out'); assert.equal(a.f(0).stocks, 3); assert.equal(a.f(0).falls, 0);
  a.tick(200); assert.equal(a.f(2).state, 'out', 'she waits for her leader\'s next stock');
  out(a, 0);
  assert.equal(a.f(0).stocks, 2); assert.equal(a.f(2).state, 'out');
  a.tick(100);
  assert.equal(a.f(0).state, 'respawn'); assert.equal(a.f(2).state, 'respawn'); assert.equal(a.f(2).damage, 0);
  a.f(0).stocks = 1; out(a, 0);
  assert.equal(a.s.phase, 'complete'); assert.deepEqual(rules.outcome(a.s).winners, ['p1']);
});
test('Nana\'s damage and KOs are credited to her leader', () => {
  const a = arena({ fighters: ['popo', 'fox'] });
  a.place(0, -4, { facing: 1 }); a.place(2, 0, { facing: 1 }); a.place(1, .6, { facing: -1 });
  a.f(0).state = 'dizzy'; a.f(0).timer = 99; // a disabled leader: Nana fights on her own brain
  for (let i = 0; i < 240 && !a.f(1).damage; i++) a.tick();
  assert.ok(a.f(1).damage > 0 && a.f(0).dealt > 0 && !a.f(2).dealt, 'her hits count as Popo\'s damage dealt');
  Object.assign(a.f(1), { lastHitBy: 'p0+nana', lastHitFrame: a.s.frame }); out(a, 1);
  assert.equal(a.f(0).kos, 1); assert.equal(a.f(2).kos, 0);
  assert.ok(a.s.events.some(e => e.kind === 'ko' && e.source === 'p0'));
});
test('short-hop aerials read the stick against the facing at the press: forward is fair, back is bair', () => {
  for (const facing of [1, -1] as const) for (const [stick, move] of [[facing, 'fair'], [-facing, 'bair']] as const) {
    const a = arena({ fighters: ['mario', 'fox'] });
    a.place(0, 0, { facing }); a.place(1, facing * -6);
    a.press(0, 'jump'); a.tick(); a.hold(0, { x: stick }); a.tick(); a.press(0, 'attack', { x: stick, y: 0 });
    for (let i = 0; i < 12 && !a.f(0).move; i++) a.tick();
    assert.equal(a.f(0).move, move, `facing ${facing}, stick ${stick}`); assert.equal(a.f(0).facing, facing, 'no turn in the air');
  }
});
