import assert from 'node:assert/strict';
import test from 'node:test';
import { UNIT } from '../src/model';
import { MOVESET, PHYSICS } from '../src/moveset';
import { applyDI, chargeMultiplier, hitlagFrames, hitstunFrames, knockback, launchAngle, shieldstunFrames, staleness } from '../src/sim/formulas';
import { arena, type Arena } from '../src/sim/harness';

// Melee's documented knockback: ((p/10 + p·d/20) · 200/(w+100) · 1.4 + 18) · g/100 + b, set knockback replacing p with 10 and d with the set value.
test('knockback, hitstun, hitlag and angles follow Melee\'s formulas and constants', () => {
  assert.ok(Math.abs(knockback(100, 18, 75, 30, 112) - 229.36) < 1e-9);   // hand-computed
  assert.ok(Math.abs(knockback(0, 5, 100, 20, 50) - 29) < 1e-9);        // (0 + 18)·0.5 + 20
  assert.ok(Math.abs(knockback(250, 12, 100, 0, 100, 80) - 75.4) < 1e-9); // set knockback ignores percent
  assert.ok(knockback(80, 10, 60, 10, 100) > knockback(80, 10, 120, 10, 100)); // lighter flies farther
  assert.equal(knockback(999, 999, 50, 999, 999), 2500);
  assert.equal(hitstunFrames(229.36), 91);
  assert.equal(hitlagFrames(18), 9); assert.equal(hitlagFrames(18, true), 13); assert.equal(hitlagFrames(18, false, true), 6); assert.equal(hitlagFrames(90), 20);
  assert.equal(shieldstunFrames(10), 6);
  assert.equal(launchAngle(361, 20, true, 1), 0); assert.equal(launchAngle(361, 50, true, 1), 44); assert.equal(launchAngle(361, 50, false, 1), 45);
  assert.equal(launchAngle(30, 90, false, -1), 150);
  assert.ok(Math.abs(applyDI(45, -Math.SQRT1_2, Math.SQRT1_2) - 63) < 1e-9); // full perpendicular: +18°
  assert.ok(Math.abs(applyDI(45, Math.SQRT1_2, Math.SQRT1_2) - 45) < 1e-9);  // along the launch: no change
  assert.equal(applyDI(45, .2, 0), 45);                                      // inside Melee's 0.2875 deadzone
  assert.ok(Math.abs(staleness(['fsmash', 'jab1', 'fsmash'], 'fsmash') - (1 - .09 - .07)) < 1e-9);
  assert.ok(Math.abs(chargeMultiplier(60) - 1.367) < 1e-9); assert.equal(chargeMultiplier(0), 1);
});

/** Fox faces right at x=0, the victim stands just inside the jab. */
function duel(victim = 'mario' as const, gap = .7): Arena {
  const a = arena({ fighters: ['fox', victim] });
  a.place(0, 0, { facing: 1 }); a.place(1, gap, { facing: -1 });
  return a;
}
const hitEvents = (a: Arena) => a.s.events.filter(e => e.kind === 'hit');
test('a jab lands on its first active frame: damage, equal hitlag both sides, then launch at 0.03 units/kb', () => {
  const a = duel(), jab = MOVESET.fox.jab1!, hb = jab.windows[0]!.hitboxes[0]!;
  a.press(0, 'attack', { x: 0, y: 0 });
  a.tick(); assert.equal(a.f(1).damage, 0);
  a.tick(); // frame 2
  assert.equal(a.f(1).damage, hb.damage);
  const lag = hitlagFrames(hb.damage);
  assert.equal(a.f(1).hitlag, lag); assert.equal(a.f(0).hitlag, lag);
  const frozen = a.f(1).x; a.tick(lag - 1); assert.equal(a.f(1).x, frozen);
  a.tick();
  const kb = knockback(hb.damage, hb.damage, PHYSICS.mario.weight, hb.kbBase, hb.kbGrowth);
  assert.ok(Math.abs(Math.hypot(a.f(1).kx, a.f(1).ky) - kb * .03 * UNIT) < 1e-9);
  assert.equal(hitEvents(a).length, 1);
  a.tick(3); assert.equal(hitEvents(a).length, 1, 'one hit per target per hitbox group');
});
test('DI rotates a strong launch and SDI shifts the victim during hitlag', () => {
  const launch = (sdi: boolean, di: number) => {
    const a = duel('mario', .8); a.f(1).damage = 120;
    a.press(0, 'smash', { x: 1, y: 0 }); a.hold(0, { smash: false });
    for (let t = 0; t < 40 && !a.f(1).hitlag; t++) a.tick();
    assert.ok(a.f(1).hitlag > 2);
    const x0 = a.f(1).x;
    if (sdi) { for (let t = 0; t < 4; t++) { a.hold(1, { x: t % 2 ? 0 : 1, y: 0 }); a.tick(); } }
    const moved = a.f(1).x - x0;
    a.hold(1, { x: -di * Math.SQRT1_2, y: di * Math.SQRT1_2 });
    while (a.f(1).hitlag) a.tick();
    return { angle: Math.atan2(a.f(1).ky, a.f(1).kx) * 180 / Math.PI, moved };
  };
  const none = launch(false, 0), di = launch(false, 1), sdi = launch(true, 0);
  assert.ok(Math.abs(di.angle - none.angle) > 5 && Math.abs(di.angle - none.angle) <= 18.01, `${none.angle} → ${di.angle}`);
  assert.ok(sdi.moved >= 6 * UNIT * 2 - 1e-9, `SDI ${sdi.moved}`);
});
test('shields: damage and shieldstun, powershield parry in the first frames, drain while held, break into dizzy', () => {
  const a = duel(); a.hold(1, { shield: true }); a.tick(10);
  assert.equal(a.f(1).state, 'shield');
  const hp = a.f(1).shield;
  a.press(0, 'attack', { x: 0, y: 0 }); a.tick(2);
  assert.equal(a.f(1).damage, 0); assert.ok(a.f(1).shield < hp - 5); assert.equal(a.f(1).state, 'shieldstun');
  assert.ok(a.s.events.some(e => e.kind === 'shield'));
  const b = duel(); b.press(0, 'attack', { x: 0, y: 0 }); b.tick(); b.hold(1, { shield: true }); b.press(1, 'shield'); b.tick();
  assert.ok(b.s.events.some(e => e.kind === 'parry'), 'powershield'); assert.equal(b.f(1).damage, 0); assert.ok(b.f(1).shield > 99);
  const c = duel(); c.hold(1, { shield: true }); let broke = false;
  for (let t = 0; t < 400; t++) { c.tick(); broke ||= c.s.events.some(e => e.kind === 'shieldbreak'); }
  assert.equal(c.f(1).state, 'dizzy'); assert.ok(broke);
  c.hold(1, { shield: false }); for (let t = 0; t < 600 && c.f(1).state === 'dizzy'; t++) c.tick();
  assert.equal(c.f(1).state, 'idle');
});
test('grab beats shield; pummel adds damage; throws launch with their own command; mashing breaks out sooner', () => {
  const a = duel('mario', .6); a.hold(1, { shield: true }); a.tick(12);
  a.press(0, 'grab'); a.tick(10);
  assert.equal(a.f(0).state, 'grab'); assert.equal(a.f(1).state, 'grabbed'); assert.equal(a.f(1).grabbedBy, 'p0');
  a.hold(1, { shield: false }); a.tick(4);
  a.press(0, 'attack'); a.tick(2); assert.equal(a.f(0).move, 'pummel');
  for (let t = 0; t < 120 && a.f(0).state !== 'grab'; t++) a.tick();
  assert.ok(a.f(1).damage > 0, 'pummel'); const d = a.f(1).damage;
  a.hold(0, { x: -1 }); a.tick(); a.hold(0, { x: 0 });
  assert.equal(a.f(0).move, 'bthrow');
  a.tick(MOVESET.fox.bthrow!.release! + 1);
  assert.equal(a.f(1).grabbedBy, null); assert.equal(a.f(1).damage, d + MOVESET.fox.bthrow!.throw!.damage);
  while (a.f(1).hitlag) a.tick();
  assert.ok(a.f(1).kx < 0, 'Fox back throw launches behind him (script reversal)');
  const hold = (mash: boolean) => {
    const b = duel('mario', .6); b.press(0, 'grab'); b.tick(10); let t = 0;
    for (; t < 400 && b.f(1).state === 'grabbed'; t++) { if (mash && t % 2) b.press(1, 'attack'); b.tick(); }
    return t;
  };
  assert.ok(hold(true) < hold(false) / 2);
});
test('equal grounded attacks clank and both rebound; unequal ones only rebound the weaker', () => {
  const a = arena({ fighters: ['mario', 'mario'] }); a.place(0, 0, { facing: 1 }); a.place(1, 1.1, { facing: -1 });
  a.press(0, 'attack', { x: 1, y: 0 }); a.press(1, 'attack', { x: -1, y: 0 });
  for (let t = 0; t < 12 && !a.s.events.some(e => e.kind === 'clash'); t++) a.tick();
  assert.ok(a.s.events.some(e => e.kind === 'clash'));
  assert.equal(a.f(0).damage + a.f(1).damage, 0); assert.equal(a.f(0).move, null); assert.equal(a.f(1).move, null);
});
test('simultaneous hits trade: both take damage the same frame', () => {
  const a = arena({ fighters: ['fox', 'fox'] }); a.place(0, 0, { facing: 1 }); a.place(1, .8, { facing: -1 });
  for (const i of [0, 1]) { const f = a.f(i); f.y += 2; f.grounded = false; f.ground = null; f.state = 'air'; f.vy = .05; } // airborne attacks never clank
  a.press(0, 'attack', { x: 0, y: 0 }); a.press(1, 'attack', { x: 0, y: 0 });
  let t = 0; for (; t < 10 && !a.f(0).damage; t++) a.tick();
  assert.equal(a.f(0).move, null); assert.ok(a.f(0).damage > 0 && a.f(0).damage === a.f(1).damage, `${a.f(0).damage} ${a.f(1).damage}`);
});
test('stale moves weaken with repetition; a fully charged smash deals ×1.367', () => {
  const hit = (charge: number, repeats: number) => {
    const a = duel('mario', .9); a.f(0).stale = Array(repeats).fill('fsmash');
    a.press(0, 'smash', { x: 1, y: 0 }); a.hold(0, { smash: charge > 0 });
    for (let t = 0; t < 120 && !a.f(1).damage; t++) { if (a.f(0).charge >= charge) a.hold(0, { smash: false }); a.tick(); }
    return a.f(1).damage;
  };
  const fresh = hit(0, 0), staled = hit(0, 3), charged = hit(60, 0);
  assert.ok(Math.abs(staled - fresh * (1 - .09 - .08 - .07)) < 1e-6, `${staled} vs ${fresh}`);
  assert.ok(Math.abs(charged / fresh - 1.367) < 1e-6, `${charged / fresh}`);
});
test('crouch-cancel softens knockback to two thirds', () => {
  const kb = (crouch: boolean) => {
    const a = duel('mario', .7); a.f(1).damage = 60; if (crouch) { a.hold(1, { y: -1 }); a.tick(3); }
    a.press(0, 'attack', { x: 0, y: 0 }); a.tick(2); while (a.f(1).hitlag) a.tick();
    return Math.hypot(a.f(1).kx, a.f(1).ky);
  };
  assert.ok(Math.abs(kb(true) / kb(false) - 2 / 3) < .03);
});
