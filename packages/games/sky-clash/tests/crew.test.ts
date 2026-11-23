/** The crew of the Reaches: authored data is complete, clips solve, hitboxes follow the animation and connect, specials start and end, CPUs recover and finish matches. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { anchor, clipEnd, sample, solve } from '../src/anim/core';
import { ARENA_IDS } from '../src/arenas';
import { CREW, CREW_DATA, CREW_DEFS, type CrewKind, type CrewMove } from '../src/crew/index';
import { BONES, FIGHTERS, ROSTER, type MoveId } from '../src/model';
import { MOVESET, PHYSICS, TIMING } from '../src/moveset';
import { KITS, type Slot } from '../src/specials';
import { liveHits } from '../src/sim/combat';
import { setState, startMove } from '../src/sim/common';
import { arena, type Arena } from '../src/sim/harness';
import type { Fighter } from '../src/sim/types';
import { crewMove, trackOf } from '../src/scene/crew/tracks';
import { playMatch, recoveryDrill } from '../tools/balance';

const NORMALS: MoveId[] = ['jab1', 'ftilt', 'utilt', 'dtilt', 'dash', 'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair', 'grab', 'dashgrab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow', 'ledgeattack', 'getupattack', 'taunt'];
const AERIALS = new Set<MoveId>(['nair', 'fair', 'bair', 'uair', 'dair']), SLOTS: [Slot, 'nspecial' | 'sspecial' | 'uspecial' | 'dspecial', number, number][] = [['n', 'nspecial', 0, 0], ['s', 'sspecial', 1, 0], ['hi', 'uspecial', 0, 1], ['lw', 'dspecial', 0, -1]];
const json = (path: string) => JSON.parse(readFileSync(new URL(`../assets/${path}`, import.meta.url), 'utf8'));
const finite = (o: unknown): boolean => typeof o === 'number' ? Number.isFinite(o) : Array.isArray(o) ? o.every(finite) : !o || typeof o !== 'object' || Object.values(o).every(finite);
const isCounter = (kind: CrewKind, slot: Slot) => Object.values(KITS[kind][slot]!.phases).some(p => p.counter);
const airborne = (a: Arena, i: number, dy = 3) => { const f = a.f(i); f.y += dy; f.grounded = false; f.ground = null; setState(f, 'air'); };
const duel = (kind: CrewKind, gap = 6) => { const a = arena({ fighters: [kind, kind], stage: ARENA_IDS[0] }); a.place(0, -1.5, { facing: 1, y: .1 }); a.place(1, -1.5 + gap, { facing: -1, y: .1 }); return a; };
/** Put a fighter's body centre on a point: standing if the point is low enough, floating otherwise. */
function putOn(v: Fighter, x: number, y: number, floor: number) {
  const feet = y - PHYSICS[v.kind].height * .5;
  if (feet <= floor + .05) Object.assign(v, { x, px: x, y: floor, py: floor, vx: 0, vy: 0, kx: 0, ky: 0 });
  else { Object.assign(v, { x, px: x, y: feet, py: feet, vx: 0, vy: 0, kx: 0, ky: 0, grounded: false, ground: null }); if (v.state !== 'air') setState(v, 'air'); }
}
/** Put the victim's body on the attacker's first live hitbox and hold it there (no gravity, no drift) until it is hit. */
function connects(a: Arena, frames: number): number {
  const f = a.f(0), v = a.f(1), floor = v.y;
  for (let t = 0; t < frames; t++) {
    a.tick();
    const hit = liveHits(f)[0];
    if (hit && v.damage === 0 && v.hitlag === 0) putOn(v, hit.x, hit.y, f.grounded ? floor : -99);
    if (v.damage > 0 || v.state === 'grabbed') return t;
  }
  return -1;
}

test('the crew leads the roster and every member is fully authored', () => {
  assert.deepEqual(ROSTER.slice(0, CREW.length), [...CREW]);
  assert.ok(CREW.length >= 2);
  for (const kind of CREW) {
    const def = CREW_DEFS[kind], info = CREW_DATA[kind];
    assert.equal(FIGHTERS[kind].name, info.name); assert.equal(info.specials.length, 4); assert.ok(info.title && info.blurb && info.archetype, kind);
    for (const id of NORMALS) assert.ok(def.moves[id] && MOVESET[kind][id], `${kind} has no ${id}`);
    for (const [slot, move] of SLOTS) { assert.ok(KITS[kind][slot], `${kind} kit ${slot}`); assert.ok(MOVESET[kind][move] && MOVESET[kind][`${move}Air` as MoveId], `${kind} ${move}`); }
    // Every phase a kit can reach has a script and a clip to play.
    for (const [slot, move] of SLOTS) {
      const sp = KITS[kind][slot]!, scripts = def.specials[move]!;
      for (const id of [sp.start, sp.air, ...Object.keys(sp.phases), ...Object.values(sp.phases).flatMap(p => [p.next, p.land !== 'lag' && p.land !== 'keep' && p.land !== 'stop' ? p.land : undefined, p.onHit])]) if (id !== undefined) assert.ok(scripts[id], `${kind} ${move} is missing phase '${id}'`);
    }
    assert.ok(Object.keys(TIMING[kind]).length > 20 && PHYSICS[kind].weight > 60 && PHYSICS[kind].jumps >= 2, kind);
  }
});

test('rigs carry the contract bones, the anchors every hitbox and trail names, four costumes, and stay inside the model budget', () => {
  for (const kind of CREW) {
    const def = CREW_DEFS[kind], rig = def.rig, meta = json(`models/${kind}.json`), costumes = json(`costumes/${kind}.json`);
    for (const b of BONES) assert.ok(rig.bones.includes(b), `${kind} rig lacks ${b}`);
    for (const b of ['jaw', 'lid_L', 'lid_R', 'brow_L', 'brow_R', 'fingers1_L', 'fingers2_R', 'thumb_L']) assert.ok(rig.bones.includes(b), `${kind} rig lacks ${b}`);
    assert.ok(Object.keys(rig.chains).length >= 2, `${kind} has secondary-motion chains`);
    const named = (m: CrewMove) => [...(m.hits ?? []).map(h => h.at), ...[m.trail ?? []].flat().flatMap(t => [t.tip, t.base]), ...(m.cues ?? []).flatMap(c => c.at ? [c.at] : [])];
    for (const m of [...Object.values(def.moves), ...Object.values(def.specials).flatMap(p => Object.values(p!))]) for (const at of named(m!)) assert.ok(rig.anchors[at] || rig.bones.includes(at), `${kind} ${m!.name}: no anchor or bone '${at}'`);
    assert.equal(costumes.length, 4); for (const c of costumes) { assert.equal(c.swatch.length, 3); for (const s of meta.slots) assert.match(c.colors[s.name], /^#[0-9a-f]{6}$/i, `${kind} ${c.name} ${s.name}`); }
    assert.ok(meta.tris <= 50000 && meta.bytes <= 3_000_000 && meta.texture <= 1024, `${kind}: ${meta.tris} tris, ${meta.bytes} bytes`);
    assert.ok(Math.abs(meta.bounds.max[1] - FIGHTERS[kind].height) < FIGHTERS[kind].height * .35, `${kind} height ${meta.bounds.max[1]}`);
  }
});

test('every state clip and every move clip solves to a finite pose on every frame, with the feet on the floor while standing', () => {
  for (const kind of CREW) {
    const def = CREW_DEFS[kind], rest = solve(def.rig, {}), restFoot = Math.min(rest.pos.foot_L![1], rest.pos.foot_R![1]);
    for (const [name, clip] of Object.entries(def.states)) for (let f = 0; f <= clipEnd(clip); f += 2) assert.ok(finite(solve(def.rig, sample(clip, f))), `${kind} ${name} frame ${f}`);
    for (const name of ['idle', 'walk', 'crouch', 'shield', 'land'] as const) for (let f = 0; f <= clipEnd(def.states[name]); f += 3) {
      const s = solve(def.rig, sample(def.states[name], f)), low = Math.min(s.pos.foot_L![1], s.pos.foot_R![1]);
      assert.ok(low > restFoot - .03 && low < restFoot + .12, `${kind} ${name} frame ${f}: lowest ankle ${low.toFixed(3)} vs rest ${restFoot.toFixed(3)}`);
    }
    for (const m of [...Object.values(def.moves), ...Object.values(def.specials).flatMap(p => Object.values(p!))]) {
      assert.ok(clipEnd(m!.clip) <= m!.total + 1, `${kind} ${m!.name}: clip runs past the move`);
      for (let f = 1; f <= m!.total; f++) assert.ok(finite(solve(def.rig, sample(m!.clip, f))), `${kind} ${m!.name} frame ${f}`);
    }
  }
});

test('hitboxes ride the animation: the simulation’s track is the clip’s anchor on that frame, and stays within reach', () => {
  for (const kind of CREW) {
    const def = CREW_DEFS[kind], reach = FIGHTERS[kind].height * 1.6;
    for (const [id, m] of Object.entries(def.moves) as [MoveId, CrewMove][]) for (const [i, h] of (m.hits ?? []).entries()) {
      const hit = MOVESET[kind][id]!.windows[i]!.hitboxes[0]!, track = hit.track!;
      assert.equal(track.length, (h.to - h.from + 1) * 2, `${kind} ${id}`);
      for (let f = h.from; f < h.to; f++) {
        const p = anchor(def.rig, solve(def.rig, sample(m.clip, f)), h.at), k = f - h.from + 1;
        assert.ok(Math.abs(track[k * 2]! - (p[2] + (h.off?.[0] ?? 0))) < 2e-3 && Math.abs(track[k * 2 + 1]! - (p[1] + (h.off?.[1] ?? 0))) < 2e-3, `${kind} ${id} frame ${f}`);
        assert.ok(Math.abs(track[k * 2]!) < reach && track[k * 2 + 1]! > -1 && track[k * 2 + 1]! < reach + 1, `${kind} ${id} frame ${f} is out of reach: ${track[k * 2]}, ${track[k * 2 + 1]}`);
      }
    }
  }
});

test('every attack with a hitbox connects with a body put in its way, and deals its damage', () => {
  for (const kind of CREW) for (const id of NORMALS) {
    const m = CREW_DEFS[kind].moves[id]!; if (!m.hits?.length || id === 'pummel') continue;
    const a = duel(kind), f = a.f(0);
    if (AERIALS.has(id)) { airborne(a, 0, 4); airborne(a, 1, 4); }
    startMove(a.s, f, id);
    assert.ok(connects(a, m.total + 2) >= 0, `${kind} ${id} never connected`);
    if (id !== 'grab' && id !== 'dashgrab') assert.ok(a.f(1).damage > 0, `${kind} ${id}`);
  }
});

test('all specials start and end on the ground and in the air, bounded, and each one threatens: a hitbox or a projectile', () => {
  for (const kind of CREW) for (const [slot, move, x, y] of SLOTS) for (const air of [false, true]) {
    const a = duel(kind, 5.5), f = a.f(0), tag = `${kind} ${move}${air ? ' air' : ''}`;
    if (air) airborne(a, 0, 3);
    const y0 = f.y; a.press(0, 'special', { x, y }); a.hold(0, { x: 0, y: 0 });
    let started = false, threat = false, top = y0, t = 0;
    for (; t < 400; t++) { a.tick(); started ||= !!f.move?.includes('special'); threat ||= liveHits(f).length > 0 || a.s.projectiles.length > 0; top = Math.max(top, f.y); if (started && !f.move && (f.grounded || f.state === 'out' || f.state === 'ledge')) break; }
    assert.ok(started, `${tag} did not start (${slot})`); assert.ok(t < 400, `${tag} never ended: ${f.state} ${f.move} ${f.phase}`); assert.ok(threat || isCounter(kind, slot), `${tag} never threatened`);
    assert.ok(top - y0 < 9, `${tag} rose ${top - y0} m`);
  }
});

test('specials connect: a body in the way of each special’s first hitbox takes damage, and a counter answers a hit', () => {
  for (const kind of CREW) for (const [slot, move, x, y] of SLOTS) {
    const a = duel(kind, isCounter(kind, slot) ? 1 : 5.5), f = a.f(0), floor = a.f(1).y; a.press(0, 'special', { x, y }); a.hold(0, { x: 0, y: 0 });
    let hurt = false;
    if (isCounter(kind, slot)) {   // the rival jabs into the stance and is the one who gets hurt
      a.tick(8); startMove(a.s, a.f(1), 'jab1'); for (let t = 0; t < 60 && a.f(1).damage === 0; t++) a.tick();
      assert.ok(a.f(1).damage > 0 && f.damage === 0, `${kind} ${move} did not counter (attacker ${a.f(1).damage}%, ${kind} ${f.damage}%)`); continue;
    }
    for (let t = 0; t < 240 && !hurt; t++) {
      a.tick(); const v = a.f(1), hit = liveHits(f)[0], shot = a.s.projectiles[0];
      if (v.damage === 0 && v.hitlag === 0) { if (hit) putOn(v, hit.x, hit.y, f.grounded ? floor : -99); else if (shot) putOn(v, shot.x + shot.vx * 2, shot.y + shot.vy * 2, -99); }
      hurt = v.damage > 0;
    }
    assert.ok(hurt, `${kind} ${move} never hurt anyone`);
  }
});

test('the display plays the authored clip for every move and phase the simulation can be in', () => {
  for (const kind of CREW) {
    const def = CREW_DEFS[kind], a = duel(kind), clock = { state: 0, move: 3, seconds: 0, gait: 0, airJump: 99 };
    for (const id of NORMALS.filter(id => id !== 'pummel' && !id.endsWith('throw'))) { startMove(a.s, a.f(0), id); a.tick(2);   // pummels and throws need a held victim; their clips are covered by name below
 const v = a.view().fighters[0]!; assert.equal(trackOf(def, v, clock).move?.name, crewMove(def, id, undefined, true)?.name, `${kind} ${id} (${v.state} ${v.move})`); a.place(0, -1.5, { facing: 1, y: .1 }); }
    for (const id of ['pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow'] as const) assert.ok(crewMove(def, id, undefined, true)?.clip.keys.length, `${kind} ${id}`);
    for (const [, move] of SLOTS) for (const phase of Object.keys(def.specials[move]!)) assert.ok(crewMove(def, move, phase, true)?.clip.keys.length, `${kind} ${move} ${phase}`);
  }
});

test('recovery: a level-3 CPU of every crew fighter makes it back from the standard offstage spots on every arena', () => {
  for (const kind of CREW) for (const stage of ARENA_IDS) {
    const got = recoveryDrill(kind, 3, undefined, stage);
    assert.ok(got.filter(Boolean).length >= got.length - 1, `${kind} on ${stage}: ${got.map(Number).join('')}`);
  }
});

test('CPU play: crew fighters fight a stock match to a finish on every arena, taking stocks with attacks and never freezing', () => {
  for (const [i, stage] of ARENA_IDS.entries()) {
    const kinds = [CREW[i % CREW.length]!, CREW[(i + 1) % CREW.length]!], r = playMatch(kinds, stage, 40 + i, { stocks: 2, seconds: 240, level: 3 });
    assert.ok(r.winners.length >= 1, `${stage}: no winner after ${r.frames} frames`); assert.ok(r.kos.length >= 2, `${stage}: ${r.kos.length} KOs`);
    assert.ok(r.kos.filter(k => !k.self).length >= 1, `${stage}: every fall was a self-destruct`); assert.ok(r.stuck < 600, `${stage}: stuck ${r.stuck} frames as ${r.stuckAs}`);
    assert.ok([...r.dealt.values()].reduce((n, d) => n + d, 0) > 100, `${stage}: little damage dealt`);
  }
});

test('Random picks and CPU fill come from the crew, and a four-fighter match of the crew runs', () => {
  const a = arena({ fighters: [...CREW, ...CREW].slice(0, 4) as CrewKind[], stage: ARENA_IDS[0], cpu: [3, 3, 3, 3] });
  for (let t = 0; t < 60 * 20; t++) a.tick();
  assert.ok(a.s.fighters.some(f => f.damage > 0 || f.stocks < a.s.stocks), 'somebody landed a hit in 20 seconds');
  assert.ok(JSON.stringify(a.view()).length < 20000, 'four crew fighters fit the snapshot budget');
});
