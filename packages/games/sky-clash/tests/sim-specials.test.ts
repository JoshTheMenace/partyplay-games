import assert from 'node:assert/strict';
import test from 'node:test';
import type { FighterKind } from '../src/model';
import { MOVESET } from '../src/moveset';
import { setState } from '../src/sim/common';
import { arena, type Arena } from '../src/sim/harness';

function vs(kind: FighterKind, gap = 1, other: FighterKind = 'sandbag'): Arena {
  const a = arena({ fighters: [kind, other] }); a.place(0, 0, { facing: 1 }); a.place(1, gap, { facing: -1 }); return a;
}
const airborne = (a: Arena, i: number, dy = 3) => { const f = a.f(i); f.y += dy; f.grounded = false; f.ground = null; setState(f, 'air'); };
const until = (a: Arena, done: () => boolean, max = 300) => { for (let t = 0; t < max && !done(); t++) a.tick(); return done(); };
const shoot = (a: Arena, i: number, kind: string) => { a.s.projectiles.push({ id: 999, owner: a.f(i).id, team: null, kind, x: a.f(i).x + .6, y: a.f(i).y + .9, vx: .3, vy: 0, r: .2, life: 60, effect: 'normal',
  damage: 6, angle: 361, kbBase: 10, kbGrowth: 50, fixedKb: 0, gravity: 0, bounce: 0, ground: false, reflectable: true, absorbable: true, pierce: false, flinch: true, hitIds: [], move: 'nspecial', hits: 0 }); };

test('Mario: fireballs bounce along the floor, the Cape turns foes around and reflects shots, Super Jump Punch rises into helpless', () => {
  const a = vs('mario', 6); a.press(0, 'special', { x: 0, y: 0 }); a.hold(0, { x: 0 });
  assert.ok(until(a, () => a.s.projectiles.some(p => p.kind === 'fireball')));
  const p = a.s.projectiles[0]!; let bounced = false;
  for (let t = 0; t < 60; t++) { const vy = p.vy; a.tick(); if (vy < 0 && p.vy > 0) bounced = true; }
  assert.ok(bounced);
  const c = vs('mario', .8); c.press(0, 'special', { x: 1, y: 0 }); c.hold(0, { x: 0 });
  until(c, () => c.f(1).damage > 0, 40); assert.equal(c.f(1).facing, 1, 'cape turns the victim around');
  const r = vs('mario', 4, 'fox'); r.press(0, 'special', { x: 1, y: 0 }); r.hold(0, { x: 0 }); r.tick(8); shoot(r, 1, 'laser'); r.s.projectiles[0]!.x = r.f(1).x - .6; r.s.projectiles[0]!.vx = -.3;
  assert.ok(until(r, () => r.s.projectiles[0]?.owner === 'p0', 20), 'cape reflect');
  const u = vs('mario', 6); u.press(0, 'special', { x: 0, y: 1 }); u.hold(0, { y: 0 });
  let top = 0; for (let t = 0; t < 40; t++) { u.tick(); top = Math.max(top, u.f(0).y); }
  assert.ok(top > 2.5, `rise ${top}`); assert.ok(until(u, () => u.f(0).state === 'helpless' || u.f(0).grounded));
});
test('Fox: lasers add damage without flinching, the shine hits on frame 1, reflects and jump-cancels, Fire Fox travels where aimed', () => {
  const a = vs('fox', 5); a.press(0, 'special', { x: 0, y: 0 }); a.hold(0, { special: true, x: 0 });
  assert.ok(until(a, () => a.f(1).damage > 0, 60)); assert.equal(a.f(1).state, 'idle'); assert.equal(a.f(1).damage, 3);
  const s = vs('fox', .6); s.press(0, 'special', { x: 0, y: -1 }); s.hold(0, { y: 0 }); s.tick();
  assert.equal(s.f(1).damage, MOVESET.fox.dspecial!.phases!.Start!.windows[0]!.hitboxes[0]!.damage, 'frame 1');
  const r = vs('fox', 4, 'falco'); r.press(0, 'special', { x: 0, y: -1 }); r.hold(0, { y: 0, special: true }); r.tick(2);
  shoot(r, 1, 'laser'); r.s.projectiles[0]!.x = r.f(1).x - .6; r.s.projectiles[0]!.vx = -.3;
  assert.ok(until(r, () => r.s.projectiles[0]?.owner === 'p0', 20), 'shine reflect'); assert.ok(r.s.projectiles[0]!.vx > 0 && r.s.projectiles[0]!.damage > 6);
  r.press(0, 'jump'); r.tick(2); assert.equal(r.f(0).move, null, 'jump cancel');
  // The press's captured aim (up) picks Fire Fox; the stick held right at launch aims its flight.
  const ff = vs('fox', 6); airborne(ff, 0); ff.press(0, 'special', { x: 0, y: 1 }); ff.hold(0, { x: 1, y: 0 });
  assert.ok(until(ff, () => ff.f(0).move === 'uspecialAir' && ff.f(0).phase === '', 60)); const x0 = ff.f(0).x; ff.tick(20);
  assert.ok(ff.f(0).x - x0 > 3, `fire fox ${ff.f(0).x - x0}`);
  assert.ok(until(ff, () => ff.f(0).state === 'helpless' || ff.f(0).state === 'land' || ff.f(0).state === 'idle'));
});
test('Marth: Shield Breaker charges for more damage, Dancing Blade chains four swings, Dolphin Slash rises, Counter answers a hit', () => {
  const hit = (holdFrames: number) => {
    const a = vs('marth', 1.4); a.press(0, 'special', { x: 0, y: 0 }); a.hold(0, { special: true, x: 0 });
    for (let t = 0; t < holdFrames; t++) a.tick(); a.hold(0, { special: false });
    until(a, () => a.f(1).damage > 0, 120); return a.f(1).damage;
  };
  const tap = hit(1), full = hit(120);
  assert.ok(Math.abs(tap - MOVESET.marth.nspecial!.phases!.End!.windows[0]!.hitboxes[0]!.damage) < 1.5, `tap ${tap}`); assert.ok(full > tap * 3, `full ${full}`);
  const d = vs('marth', 1.2); d.press(0, 'special', { x: 1, y: 0 }); d.hold(0, { x: 0 }); const phases = new Set<string>();
  for (let t = 0; t < 120 && (t < 2 || d.f(0).move); t++) { if (t % 6 === 0) d.press(0, 'special', { x: 1, y: 0 }); d.hold(0, { x: 0 }); d.tick(); phases.add(d.f(0).phase); }
  assert.ok(phases.has('4S') || phases.has('4Hi') || phases.has('4Lw'), [...phases].join());
  const u = vs('marth', 6); u.press(0, 'special', { x: 0, y: 1 }); u.hold(0, { y: 0 }); let top = 0; for (let t = 0; t < 40; t++) { u.tick(); top = Math.max(top, u.f(0).y); }
  assert.ok(top > 2.5, `dolphin ${top}`);
  const c = vs('marth', .9, 'mario'); c.press(0, 'special', { x: 0, y: -1 }); c.hold(0, { y: 0 }); c.tick(6);
  c.f(1).facing = -1; c.press(1, 'attack', { x: 0, y: 0 });
  assert.ok(until(c, () => c.f(0).phase === 'Hit', 20)); assert.equal(c.f(0).damage, 0);
  assert.ok(until(c, () => c.f(1).damage > 0, 60), 'counter slash');
});
test('Kirby: Inhale swallows and spits a foe, Final Cutter rises then crashes down with a shockwave, Stone armors and drops', () => {
  const a = vs('kirby', .8, 'mario'); a.press(0, 'special', { x: 0, y: 0 }); a.hold(0, { special: true, x: 0 });
  assert.ok(until(a, () => a.f(1).state === 'grabbed', 40)); assert.equal(a.f(0).phase, 'Eat');
  a.hold(0, { special: false }); a.press(0, 'special');
  assert.ok(until(a, () => a.f(1).state !== 'grabbed', 80)); assert.ok(a.f(1).damage > 0);
  const c = vs('kirby', 6); c.press(0, 'special', { x: 0, y: 1 }); c.hold(0, { y: 0 }); let top = 0, wave = false;
  for (let t = 0; t < 120; t++) { c.tick(); top = Math.max(top, c.f(0).y); wave ||= c.s.projectiles.some(p => p.kind === 'wave'); }
  assert.ok(top > 1.5, `cutter ${top}`); assert.ok(wave, 'landing shockwave');
  const s = vs('kirby', .9, 'mario'); airborne(s, 0, 2); s.press(0, 'special', { x: 0, y: -1 }); s.hold(0, { y: 0 });
  assert.ok(until(s, () => s.f(0).grounded, 60)); s.place(1, s.f(0).x + .8, { facing: -1 });
  s.tick(4); s.press(1, 'attack', { x: 0, y: 0 }); until(s, () => s.f(0).damage > 0, 20);
  assert.ok(s.f(0).damage > 0); assert.equal(s.f(0).pending, null, 'stone takes damage without launching');
});
test('Zelda and Sheik transform into each other with down-special', () => {
  const a = vs('zelda', 5); a.press(0, 'special', { x: 0, y: -1 }); a.hold(0, { y: 0 });
  assert.ok(until(a, () => a.f(0).kind === 'sheik', 200));
  a.tick(10); a.press(0, 'special', { x: 0, y: -1 }); a.hold(0, { y: 0 });
  assert.ok(until(a, () => a.f(0).kind === 'zelda', 200));
});
