import assert from 'node:assert/strict';
import test from 'node:test';
import { MOVE_SOURCES, POSES, ROSTER, ROSTER_DATA, type FighterKind } from '../src/model';
import { MOVESET } from '../src/moveset';
import { POSE_TABLE } from '../src/poses-table';
import { KITS, type Slot } from '../src/specials';
import { setState } from '../src/sim/common';
import { arena, type Arena } from '../src/sim/harness';

const SLOTS: [Slot, number, number][] = [['n', 0, 0], ['s', 1, 0], ['hi', 0, 1], ['lw', 0, -1]];
function vs(kind: FighterKind, gap = 1, other: FighterKind = 'sandbag', seed = 1): Arena {
  const a = arena({ fighters: [kind, other], seed }); a.place(0, -3, { facing: 1 }); a.place(1, gap - 3, { facing: -1 }); return a;
}
const airborne = (a: Arena, i: number, dy = 3) => { const f = a.f(i); f.y += dy; f.grounded = false; f.ground = null; setState(f, 'air'); };
const until = (a: Arena, done: () => boolean, max = 300) => { for (let t = 0; t < max && !done(); t++) a.tick(); return done(); };
const special = (a: Arena, i: number, x: number, y: number, hold = false) => { a.press(i, 'special', { x, y }); a.hold(i, { x: 0, y: 0, special: hold }); };

test('every fighter has a kit for all four named specials, and every pose-table entry is a real pose and limb', () => {
  for (const kind of ROSTER) {
    assert.equal(ROSTER_DATA[kind].specials.length, 4, kind);
    for (const [slot] of SLOTS) assert.ok(KITS[kind][slot], `${kind} ${slot}`);
    for (const move of Object.keys(MOVE_SOURCES) as (keyof typeof MOVE_SOURCES)[]) {
      const e = POSE_TABLE[kind][move];
      assert.ok((POSES as readonly string[]).includes(e.pose) && ['handL', 'handR', 'footL', 'footR', 'head', 'body', 'weapon'].includes(e.limb), `${kind} ${move}`);
      if (MOVESET[kind][move]) assert.deepEqual([MOVESET[kind][move]!.pose, MOVESET[kind][move]!.limb], [e.pose, e.limb], `engine uses the table for ${kind} ${move}`);
    }
  }
  assert.equal(POSE_TABLE['captain-falcon'].fair.pose, 'knee'); assert.equal(POSE_TABLE.fox.usmash.pose, 'flip-kick');
  assert.equal(POSE_TABLE.marth.fair.limb, 'weapon'); assert.deepEqual(POSE_TABLE.peach.dsmash, { pose: 'spin', limb: 'body' });
  assert.deepEqual(POSE_TABLE.samus.fsmash, { pose: 'palm-thrust', limb: 'weapon' }); assert.deepEqual(POSE_TABLE.ness.fsmash, { pose: 'item-swing', limb: 'weapon' });
  assert.equal(POSE_TABLE.popo.fsmash.pose, 'hammer-overhead');
  const a = vs('marth', 1.2); a.press(0, 'attack', { x: 1, y: 0 }); a.hold(0, { x: 0 });
  assert.ok(until(a, () => !!a.view().fighters[0]!.hits?.length, 20)); assert.equal(a.view().fighters[0]!.hits![0]!.limb, 'weapon', 'hits[].limb follows the table');
});

test('all 264 specials start and end: ground and air, bounded height, never unkillable, never stuck', () => {
  for (const kind of ROSTER) for (const [slot, x, y] of SLOTS) for (const air of [false, true]) {
    const a = vs(kind, 6), f = a.f(0), tag = `${kind} ${slot}${air ? ' air' : ''}`;
    if (air) airborne(a, 0, 3);
    const y0 = f.y; special(a, 0, x, y);
    let started = false, top = y0, safe = 0, t = 0;
    for (; t < 480; t++) {
      a.tick(); started ||= !!f.move?.includes('special');
      top = Math.max(top, f.y); if (f.intangibleNow || f.armorNow) safe++;
      assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), `${tag} position`);
      if (started && !f.move && f.state !== 'dizzy') break;
    }
    if (KITS[kind][slot]!.groundOnly && air) { assert.ok(!started, `${tag} is ground-only`); continue; }
    assert.ok(started, `${tag} never started`);
    assert.ok(t < 480, `${tag} never ended (${f.state} ${f.move} ${f.phase})`);
    assert.ok(top - y0 < 12, `${tag} rose ${(top - y0).toFixed(1)} m`);
    assert.ok(safe < 200, `${tag} intangible/armored for ${safe} frames`);
    assert.notEqual(f.state, 'out', `${tag} self-destructed`);
  }
});

test('up specials gain height from mid-air (Jigglypuff sings instead; Ness is steered, tested below)', () => {
  for (const kind of ROSTER.filter(k => k !== 'jigglypuff' && k !== 'ness')) {
    const a = vs(kind, 6), f = a.f(0); airborne(a, 0, 2); a.press(0, 'special', { x: 0, y: 1 }); a.hold(0, { x: 0, y: 1 });
    const y0 = f.y; let top = y0; for (let t = 0; t < 90; t++) { a.tick(); top = Math.max(top, f.y); }
    assert.ok(top - y0 > 1, `${kind} rose only ${(top - y0).toFixed(2)} m`);
  }
});

test('Ness: PK Thunder steers with the stick, and striking Ness launches him along its path (PK Thunder 2)', () => {
  const a = vs('ness', 6), f = a.f(0); airborne(a, 0, 2); special(a, 0, 0, 1); a.tick(); a.hold(0, { x: 1, y: 0 });
  assert.ok(until(a, () => a.s.projectiles.some(p => p.kind === 'pk-thunder'), 40));
  const bolt = a.s.projectiles.find(p => p.kind === 'pk-thunder')!; a.tick(12);
  assert.ok(bolt.vx > .1, `steered right (${bolt.vx})`);
  Object.assign(bolt, { x: f.x - 1.2, y: f.y + .7, vx: .24, vy: 0 }); a.hold(0, { x: 1, y: .4 });
  assert.ok(until(a, () => f.phase === '', 20), `self-hit (${f.phase})`);
  const x0 = f.x; a.tick(22); assert.ok(f.x - x0 > 4, `launched ${(f.x - x0).toFixed(1)} m`);
  const hit = vs('ness', 2.5, 'mario'); special(hit, 0, 0, 1); hit.tick(); hit.hold(0, { x: .6, y: -1 });
  assert.ok(until(hit, () => hit.f(1).damage > 0, 90), 'the bolt strikes foes');
});

test('Pikachu and Pichu: the Thunder bolt striking the caster sets off the big hit; Pichu pays for it in damage', () => {
  for (const kind of ['pikachu', 'pichu'] as const) {
    const a = vs(kind, .7, 'mario'); special(a, 0, 0, -1);
    assert.ok(until(a, () => a.f(0).phase === 'Loop#2', 60), `${kind} bolt reached the caster`);
    const bolt = a.f(1).damage; a.tick(20); assert.ok(a.f(1).damage > bolt + 8, `${kind} big hit`);
    if (kind === 'pichu') assert.ok(a.f(0).damage >= 3, 'Pichu self-damage');
  }
  const j = vs('pichu', 6); special(j, 0, 0, 0); until(j, () => !j.f(0).move && j.s.frame > 20, 90); assert.equal(j.f(0).damage, 1, 'Thunder Jolt costs Pichu 1%');
});

test('Peach floats while Jump is held after the peak, once per airtime', () => {
  const a = vs('peach', 6), f = a.f(0); a.press(0, 'jump'); a.hold(0, { jump: true });
  until(a, () => !f.grounded && f.vy <= 0, 90); const y = f.y; a.tick(100);
  assert.ok(Math.abs(f.y - y) < .01, `floating (${(f.y - y).toFixed(2)})`);
  a.hold(0, { jump: false }); a.tick(10); assert.ok(f.y < y - .05, 'release falls');
  a.hold(0, { jump: true }); const y2 = f.y; a.tick(10); assert.ok(f.y < y2 - .05, 'no second float before landing');
  const m = vs('mario', 6); m.press(0, 'jump'); m.hold(0, { jump: true }); until(m, () => !m.f(0).grounded && m.f(0).vy <= 0, 90); const my = m.f(0).y; m.tick(30);
  assert.ok(m.f(0).y < my - .3, 'only Peach floats');
});

test('Luigi: Green Missile misfires about one launch in eight (seeded) and flies much farther', () => {
  const runs = Array.from({ length: 48 }, (_, i) => {
    const a = vs('luigi', 8, 'sandbag', i + 1), f = a.f(0); special(a, 0, 1, 0, true); a.tick(40); a.hold(0, { special: false });
    let phase = ''; const x0 = f.x; for (let t = 0; t < 60; t++) { a.tick(); if (f.phase === '' || f.phase === '#2') phase = f.phase; }
    return { phase, dist: f.x - x0 };
  });
  const misfires = runs.filter(r => r.phase === '#2'), normal = runs.filter(r => r.phase === '');
  assert.ok(misfires.length >= 1 && misfires.length <= 14, `${misfires.length} misfires of 48`);
  assert.ok(Math.min(...misfires.map(r => r.dist)) > Math.max(...normal.map(r => r.dist)), 'misfires fly farther');
});

test('Bowser: Koopa Klaw grabs, bites add damage, Special + back throws behind', () => {
  const a = vs('bowser', 1.2, 'mario'), v = a.f(1); special(a, 0, 1, 0);
  assert.ok(until(a, () => v.state === 'grabbed', 40), 'klaw grab');
  a.tick(6); special(a, 0, 0, 0); assert.ok(until(a, () => v.damage > 0, 40), 'bite');
  const bitten = v.damage; until(a, () => a.f(0).phase === 'Hold', 40); a.press(0, 'special', { x: -1, y: 0 }); a.hold(0, { x: 0 });
  assert.ok(until(a, () => v.state !== 'grabbed', 60)); assert.ok(v.damage > bitten, 'throw damage');
  a.tick(15); assert.ok(v.x < a.f(0).x && v.vx + v.kx < 0, `thrown behind (${v.x.toFixed(2)} vs ${a.f(0).x.toFixed(2)})`);
});

test('Donkey Kong buries grounded foes with Headbutt; Yoshi traps them in an egg; Mewtwo\'s Disable freezes a facing foe', () => {
  const dk = vs('donkey-kong', 1.3, 'mario'); special(dk, 0, 1, 0);
  assert.ok(until(dk, () => dk.f(1).state === 'dizzy', 40), 'buried'); assert.equal(dk.f(1).pending, null, 'no launch');
  const y = vs('yoshi', 1.1, 'mario'); special(y, 0, 0, 0);
  assert.ok(until(y, () => y.f(1).state === 'dizzy', 60), 'egged');
  const m = vs('mewtwo', 1.6, 'mario'); special(m, 0, 0, -1); assert.ok(until(m, () => m.f(1).state === 'dizzy', 40), 'disabled');
  const back = vs('mewtwo', 1.6, 'mario'); back.f(1).facing = 1; special(back, 0, 0, -1); back.tick(40); assert.notEqual(back.f(1).state, 'dizzy', 'a foe facing away is not');
});

test('Mr. Game & Watch: Judgment rolls 1–9 by seed (1 costs him 12%), Oil Panic returns absorbed shots at double damage', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const a = vs('game-watch', 6, 'sandbag', seed); special(a, 0, 1, 0); a.tick(2); seen.add(a.f(0).phase);
    if (a.f(0).phase === '') { a.tick(30); assert.equal(a.f(0).damage, 12, 'Judge 1 self-damage'); }
  }
  assert.ok(seen.size >= 7, [...seen].join());
  const o = vs('game-watch', 1.2, 'fox');
  for (let n = 0; n < 3; n++) {
    special(o, 0, 0, -1); o.tick(4);
    o.s.projectiles.push({ id: 900 + n, owner: o.f(1).id, team: null, kind: 'laser', x: o.f(0).x + .7, y: o.f(0).y + .9, vx: -.3, vy: 0, r: .14, life: 20, effect: 'electric',
      damage: 5, angle: 361, kbBase: 0, kbGrowth: 0, fixedKb: 0, gravity: 0, bounce: 0, ground: false, reflectable: true, absorbable: true, pierce: false, flinch: false, hitIds: [], move: 'nspecial', hits: 0 });
    until(o, () => !o.f(0).move, 80);
  }
  assert.equal(o.f(0).special.bucket, 3, 'bucket full');
  special(o, 0, 0, -1); assert.ok(until(o, () => o.f(1).damage > 0, 40)); assert.ok(Math.abs(o.f(1).damage - 30) < 1, `oil ${o.f(1).damage}`);
});

test('Sheik throws one needle on a tap and six at full charge; Shield stores the charge', () => {
  const count = (frames: number) => {
    const a = vs('sheik', 8); special(a, 0, 0, 0, true); a.tick(frames); a.hold(0, { special: false });
    let n = 0; const ids = new Set<number>(); for (let t = 0; t < 60; t++) { a.tick(); for (const p of a.s.projectiles) ids.add(p.id); } n = ids.size; return n;
  };
  assert.equal(count(1), 1); assert.equal(count(100), 6);
  const s = vs('sheik', 8); special(s, 0, 0, 0, true); s.tick(50); s.press(0, 'shield'); s.tick(2);
  assert.equal(s.f(0).move, null); assert.ok((s.f(0).special.stored ?? 0) > 40, 'stored');
});

test('Samus fires a homing Missile, or a straight Super Missile on a flick', () => {
  const fire = (flick: boolean) => {
    const a = vs('samus', 5); a.hold(0, { x: flick ? .1 : 1 }); a.tick(6); a.press(0, 'special', { x: 1, y: 0 }); a.tick(); a.hold(0, { x: 0 });
    until(a, () => a.s.projectiles.some(p => p.kind === 'missile'), 40); const p = a.s.projectiles.find(q => q.kind === 'missile')!; a.tick(10); return p;
  };
  const homing = fire(false), superM = fire(true);
  assert.ok(homing.vy < -.003, `homing curves down toward the grounded foe (${homing.vy})`); assert.equal(superM.vy, 0);
  assert.ok(superM.damage > homing.damage && Math.abs(superM.vx) > Math.abs(homing.vx));
});

test('explosives and pillars: Link\'s bomb bursts, Din\'s Fire steers and detonates on release, PK Fire traps with repeated hits', () => {
  const l = vs('link', 1.6, 'mario'); special(l, 0, 0, -1);
  assert.ok(until(l, () => l.s.projectiles.some(p => p.kind === 'explosion'), 200), 'bomb blast'); assert.ok(until(l, () => l.f(1).damage > 0, 20));
  const z = vs('zelda', 8), f = z.f(0); special(z, 0, 1, 0, true);
  until(z, () => z.s.projectiles.some(p => p.kind === 'dins-fire'), 40); z.hold(0, { special: true, y: 1 }); z.tick(8);
  assert.ok(z.s.projectiles[0]!.vy > .03, 'steered up'); z.hold(0, { special: false }); z.tick(3);
  assert.ok(z.s.projectiles.some(p => p.kind === 'explosion'), 'detonated on release'); assert.ok(f.move);
  const n = vs('ness', 1.5, 'mario'); special(n, 0, 1, 0); const hits = () => n.s.events.filter(e => e.kind === 'hit' && e.target === n.f(1).id).length;
  let count = 0; for (let t = 0; t < 90; t++) { n.tick(); count = Math.max(count, hits()); }
  assert.ok(count >= 3, `pillar hits ${count}`);
});

test('Kirby\'s Stone gives way after soaking 25%; Captain Falcon\'s aerial Falcon Kick dives', () => {
  const a = vs('kirby', .9, 'captain-falcon'), k = a.f(0); airborne(a, 0, 1.5); special(a, 0, 0, -1); until(a, () => k.grounded && k.armorNow, 60);
  for (let n = 0; n < 8 && !k.pending && k.state !== 'hitstun' && k.state !== 'tumble'; n++) { a.place(1, k.x + .9, { facing: -1 }); a.press(1, 'smash', { x: -1, y: 0 }); a.hold(1, { x: 0 }); a.tick(60); }
  assert.ok(k.damage > 25 && k.move === null, `stone broke at ${k.damage.toFixed(0)}%`);
  const c = vs('captain-falcon', 8), f = c.f(0); airborne(c, 0, 4); special(c, 0, 0, -1); c.tick(20);
  assert.ok(f.vy < -.1 && f.vx > .1, `dive ${f.vx.toFixed(2)}, ${f.vy.toFixed(2)}`);
});

test('bonus fighters: every bonus special connects with a foe in front', () => {
  for (const kind of ROSTER.filter(k => ROSTER_DATA[k].bonus)) for (const [slot, x, y] of SLOTS) {
    if (slot === 'hi') continue;
    const a = vs(kind, 1.3, 'mario'); special(a, 0, x, y);
    assert.ok(until(a, () => a.f(1).damage > 0 || a.f(1).state === 'grabbed', 150), `${kind} ${slot}`);
  }
});
test('Link and Young Link: arrows leave the bow held forward at chest height; the boomerang and bomb leave the throwing hand', () => {
  for (const [kind, size] of [['link', 1], ['young-link', 1.45 / 1.98]] as [FighterKind, number][]) for (const [x, y, px, py] of [[0, 0, .55, 1.15], [1, 0, .5, 1.3], [0, -1, .5, 1.3]]) {
    const a = vs(kind, 6), f = a.f(0); special(a, 0, x!, y!);
    assert.ok(until(a, () => a.s.events.some(e => e.kind === 'projectile'), 120), `${kind} ${x},${y} shot`);
    const e = a.s.events.find(q => q.kind === 'projectile')!;
    assert.ok(Math.abs(e.x - f.x - px! * size) < .15 && Math.abs(e.y - f.y - py! * size) < .05, `${kind} ${x},${y} from ${(e.x - f.x).toFixed(2)}, ${(e.y - f.y).toFixed(2)}`);
  }
});
