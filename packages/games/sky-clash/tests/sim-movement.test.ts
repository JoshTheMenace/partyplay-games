import assert from 'node:assert/strict';
import test from 'node:test';
import type { FighterKind } from '../src/model';
import { PHYSICS } from '../src/moveset';
import { stageFrame } from '../src/stages';
import { arena, type Arena } from '../src/sim/harness';

/** Peak of a jump in this engine: launch speed v, gravity subtracted before each frame's move. */
const peak = (v: number, g: number) => { let y = 0, vy = v, top = 0; for (let i = 0; i < 200; i++) { vy -= g; y += vy; top = Math.max(top, y); } return top; };
const jump = (a: Arena, i: number, holdFrames: number) => {
  const y0 = a.f(i).y; a.press(i, 'jump'); a.hold(i, { jump: holdFrames > 0 });
  let top = 0;
  let left = false;
  for (let t = 0; t < 160; t++) { if (t === holdFrames) a.hold(i, { jump: false }); a.tick(); top = Math.max(top, a.f(i).y - y0); left ||= !a.f(i).grounded; if (left && a.f(i).grounded) break; }
  return top;
};
const floor = (id: 'final-destination' | 'battlefield') => stageFrame(id, 0).blocks[0]!;
function place(a: Arena, i: number, x: number, y?: number) {
  const f = a.f(i), top = y ?? floor(a.s.stageId as 'battlefield').top;
  f.x = f.px = x; f.y = f.py = top; f.vx = f.vy = 0; f.grounded = true; f.ground = null; f.state = 'idle';
  const env = stageFrame(a.s.stageId, a.s.stageTick), q = [...env.blocks.map(b => ({ id: b.id, l: b.left, r: b.right, y: b.top })), ...env.platforms.map(p => ({ id: p.id, l: p.left, r: p.right, y: p.y }))]
    .find(s => Math.abs(s.y - top) < .01 && x >= s.l && x <= s.r);
  f.ground = q?.id ?? null;
}

test('full and short hop heights match each fighter\'s jump attributes (hold through jumpsquat vs release)', () => {
  for (const kind of ['fox', 'mario', 'kirby', 'jigglypuff', 'bowser', 'captain-falcon'] as FighterKind[]) {
    const a = arena({ fighters: [kind, 'sandbag'] }), p = PHYSICS[kind];
    place(a, 1, 6); place(a, 0, -2);
    const full = jump(a, 0, 12); a.tick(30);
    const short = jump(a, 0, 0);
    assert.ok(Math.abs(full - peak(p.fullHop, p.gravity)) < .02, `${kind} full ${full} vs ${peak(p.fullHop, p.gravity)}`);
    assert.ok(Math.abs(short - peak(p.shortHop, p.gravity)) < .02, `${kind} short ${short}`);
    assert.ok(full > short * 1.4, kind);
  }
});
test('jumpsquat lasts the attribute frames; Jump + Attack together is a short-hop aerial', () => {
  const a = arena({ fighters: ['fox', 'sandbag'] }); place(a, 1, 6); place(a, 0, -2);
  a.press(0, 'jump'); a.hold(0, { jump: true });
  for (let t = 0; t < PHYSICS.fox.jumpsquat; t++) { a.tick(); assert.equal(a.f(0).state, 'jumpsquat', `frame ${t}`); }
  a.tick(); assert.equal(a.f(0).grounded, false);
  a.hold(0, { jump: false }); a.tick(60);
  a.press(0, 'jump'); a.press(0, 'attack'); a.hold(0, { jump: true, attack: true });
  a.tick(PHYSICS.fox.jumpsquat + 1);
  assert.equal(a.f(0).move, 'nair'); assert.ok(Math.abs(a.f(0).vy - (PHYSICS.fox.shortHop - PHYSICS.fox.gravity)) < 1e-6);
});
test('Kirby and Jigglypuff get six jumps in total; air jumps restore on landing', () => {
  for (const kind of ['kirby', 'jigglypuff'] as FighterKind[]) {
    const a = arena({ fighters: [kind, 'sandbag'] }); place(a, 1, 6); place(a, 0, -2);
    a.press(0, 'jump'); a.hold(0, { jump: true }); a.tick(8);
    for (let k = 0; k < 7; k++) { a.press(0, 'jump'); a.tick(6); }
    const air = new Set(a.s.events.filter(e => e.kind === 'airjump' && e.source === 'p0').map(e => e.id)).size;
    assert.equal(air, 5, kind); assert.equal(a.f(0).jumpsLeft, 0); assert.equal(a.f(0).grounded, false);
    a.hold(0, { jump: false }); for (let t = 0; t < 400 && !a.f(0).grounded; t++) a.tick();
    a.tick(2); assert.equal(a.f(0).jumpsLeft, 6);
  }
});
test('fast fall snaps to the attribute speed after the peak', () => {
  const a = arena({ fighters: ['fox', 'sandbag'] }); place(a, 1, 6); place(a, 0, -2);
  a.press(0, 'jump'); a.hold(0, { jump: true }); a.tick(24); a.hold(0, { jump: false });
  assert.ok(a.f(0).vy <= 0);
  a.hold(0, { y: -1 }); a.tick();
  assert.ok(Math.abs(a.f(0).vy + PHYSICS.fox.fastFall) < 1e-9);
});
test('dash starts at initial dash speed, runs toward max, and dash-dances on a reverse flick', () => {
  const a = arena({ fighters: ['fox', 'sandbag'] }); place(a, 1, 6); place(a, 0, -2);
  a.hold(0, { x: 1 }); a.tick();
  assert.equal(a.f(0).state, 'run'); assert.ok(Math.abs(a.f(0).vx - PHYSICS.fox.dashInitial) < 1e-9);
  a.hold(0, { x: 0 }); a.tick(); a.hold(0, { x: -1 }); a.tick();
  assert.equal(a.f(0).state, 'run'); assert.equal(a.f(0).facing, -1);
  a.hold(0, { x: 0 }); a.tick(40); a.hold(0, { x: 1 }); a.tick(60);
  assert.ok(Math.abs(a.f(0).vx - PHYSICS.fox.run) < .01, `${a.f(0).vx}`);
  const w = arena({ fighters: ['fox', 'sandbag'] }); place(w, 1, 6); place(w, 0, -2);
  w.hold(0, { x: .5 }); w.tick(30);
  assert.equal(w.f(0).state, 'walk'); assert.ok(w.f(0).vx <= PHYSICS.fox.walk * .5 + 1e-9);
});
test('soft platforms drop through on a down flick; the main floor catches the fighter', () => {
  const a = arena({ fighters: ['mario', 'sandbag'], stage: 'battlefield' });
  const plat = stageFrame('battlefield', 0).platforms.sort((p, q) => p.y - q.y)[0]!;
  place(a, 1, 4); place(a, 0, (plat.left + plat.right) / 2, plat.y);
  a.tick(2); assert.equal(a.f(0).ground, plat.id);
  a.hold(0, { y: -1 }); a.tick(); a.tick(); a.hold(0, { y: 0 });
  assert.equal(a.f(0).grounded, false);
  for (let t = 0; t < 120 && !a.f(0).grounded; t++) a.tick();
  assert.equal(a.f(0).ground, floor('battlefield').id);
});
test('coyote time: a jump just after running off an edge is a full jump, not the air jump', () => {
  const a = arena({ fighters: ['fox', 'sandbag'], stage: 'battlefield' }), main = floor('battlefield');
  place(a, 1, main.left + 2); place(a, 0, main.right - 1);
  a.hold(0, { x: 1 }); for (let t = 0; t < 60 && a.f(0).grounded; t++) a.tick();
  assert.equal(a.f(0).grounded, false);
  a.tick(2); a.press(0, 'jump'); a.tick();
  assert.equal(a.f(0).jumpsLeft, PHYSICS.fox.jumps - 1);
  assert.ok(a.f(0).vy > PHYSICS.fox.fullHop - 3 * PHYSICS.fox.gravity);
});
test('air dodge moves along the stick, ends helpless, and lands with 10 frames of lag', () => {
  const a = arena({ fighters: ['marth', 'sandbag'] }); place(a, 1, 6); place(a, 0, -2);
  a.press(0, 'jump'); a.hold(0, { jump: true }); a.tick(14);
  a.press(0, 'shield', { x: 1, y: 0 }); a.tick();
  assert.equal(a.f(0).state, 'airdodge'); assert.ok(a.f(0).vx > .2);
  a.hold(0, { x: 0, jump: false }); a.tick(8);
  for (let t = 0; t < 200 && !a.f(0).grounded; t++) { assert.ok(['airdodge', 'helpless'].includes(a.f(0).state)); a.tick(); }
  assert.equal(a.f(0).state, 'land'); assert.equal(a.f(0).timer, 10);
});
test('idle at a ledge-side edge teeters', () => {
  const a = arena({ fighters: ['luigi', 'sandbag'] }), main = floor('final-destination');
  place(a, 1, 0); place(a, 0, main.right - .02); a.f(0).facing = 1; a.tick(3);
  assert.equal(a.f(0).state, 'teeter');
});
test('party recovery (default): stronger air jumps, a jump back after hitstun, Jump with none left up-specials, generous up; melee keeps Melee', () => {
  const air = (recovery: 'party' | 'melee', kind: FighterKind = 'mario', jumps = 1) => {
    const a = arena({ fighters: [kind, 'sandbag'], settings: { recovery } }); place(a, 1, 6); place(a, 0, -2);
    Object.assign(a.f(0), { y: 4, grounded: false, ground: null, jumpsLeft: jumps, state: 'air', stateFrame: 0 }); return a;
  };
  const rise = (recovery: 'party' | 'melee') => { const a = air(recovery), y0 = a.f(0).y; a.press(0, 'jump'); let top = 0; for (let t = 0; t < 60; t++) { a.tick(); top = Math.max(top, a.f(0).y - y0); } return top; };
  const [p, m] = [rise('party'), rise('melee')]; assert.ok(p > m * 1.5, `air jump ${p} vs ${m}`);
  for (const recovery of ['party', 'melee'] as const) {
    const party = recovery === 'party', h = air(recovery, 'mario', 0); Object.assign(h.f(0), { state: 'hitstun', hitstun: 3, used: ['hi'] }); h.tick(5);
    assert.equal(h.f(0).jumpsLeft, party ? 1 : 0, `${recovery} jump after hitstun`); assert.deepEqual(h.f(0).used, party ? [] : ['hi']);
    const j = air(recovery, 'mario', 0); j.press(0, 'jump'); j.tick(); assert.equal(j.f(0).move, party ? 'uspecialAir' : null, `${recovery} jump → up-special`);
    const hp = air(recovery, 'mario', 0); Object.assign(hp.f(0), { state: 'helpless', helpless: true }); hp.press(0, 'jump'); hp.tick(); assert.equal(hp.f(0).move, null, 'helpless stays helpless');
    const g = air(recovery); g.press(0, 'special', { x: .8, y: .5 }); g.hold(0, { x: 0, y: 0 }); g.tick(); assert.equal(g.f(0).move, party ? 'uspecialAir' : 'sspecialAir', `${recovery} up-right special`);
    // A swipe's captured aim beats the live stick (here held forward).
    const c = air(recovery); c.press(0, 'special', { x: 0, y: -1 }); c.hold(0, { x: 1, y: 0 }); c.tick(); assert.equal(c.f(0).move, 'dspecialAir', `${recovery} captured aim`);
  }
});
