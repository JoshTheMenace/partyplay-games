/**
 * Compiles the crew's authored data into what the simulation reads (src/moveset.ts): moves with hit windows, timing and physics.
 * Hitboxes ride the animation: for every live frame the same clip the display plays is solved, and the hitbox is put on its bone
 * or anchor. Each hit carries that path (`track`), one sample per frame starting one frame early so fast swings can be swept.
 */
import { anchor, sample, solve } from '../anim/core';
import type { MoveId } from '../model';
import type { Move, Physics, Timing, TimingId } from '../moveset';
import { CREW, CREW_DATA, type CrewKind } from './roster';
import type { CrewDef, CrewMove, CrewPhysics } from './types';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export function compileMove(def: CrewDef, m: CrewMove): Move {
  const cache = new Map<number, ReturnType<typeof solve>>(), at = (f: number) => cache.get(f) ?? cache.set(f, solve(def.rig, sample(m.clip, f))).get(f)!;
  const windows = (m.hits ?? []).map((h, i) => {
    const track: number[] = [];
    for (let f = h.from - 1; f < h.to; f++) { const p = anchor(def.rig, at(Math.max(1, f)), h.at); track.push(r3(p[2] + (h.off?.[0] ?? 0)), r3(p[1] + (h.off?.[1] ?? 0))); }
    return { from: h.from, to: h.to, group: h.group ?? 0, hitboxes: [{ id: i, x: track[2]!, y: track[3]!, r: h.r, damage: h.damage, angle: h.angle, kbBase: h.kb[0], kbGrowth: h.kb[1], limb: h.limb ?? 'weapon', effect: h.effect ?? 'normal',
      clank: h.clank ?? true, bone: 0, onlyGrabbed: false, sfx: 0, track, ...(h.fixed ? { fixedKb: h.fixed } : {}), ...(h.shield ? { shieldDamage: h.shield } : {}), ...(h.ground === false ? { hitsGrounded: false } : {}), ...(h.air === false ? { hitsAirborne: false } : {}) }] };
  });
  const out: Move = { name: m.name, source: m.name, pose: 'jab', limb: m.hits?.[0]?.limb ?? 'weapon', total: m.total, windows, intangible: (m.intangible ?? []).map(r => [r[0], r[1]]), flags: [], shots: [...m.shots ?? []], selfDamage: [] };
  if (m.iasa !== undefined) out.iasa = m.iasa;
  if (m.charge !== undefined) out.charge = { frame: m.charge, max: 60 };
  if (m.landingLag !== undefined) out.landingLag = m.landingLag;
  if (m.autoCancel) out.autoCancel = [[m.autoCancel[0], false], [m.autoCancel[1], true]];
  if (m.followup !== undefined) out.followup = m.followup;
  if (m.throw) { out.throw = { damage: m.throw.damage, angle: m.throw.angle, kbBase: m.throw.kb[0], kbGrowth: m.throw.kb[1], fixedKb: 0, effect: m.throw.effect ?? 'normal' }; out.release = m.throw.release; if (m.throw.turn) out.turn = m.throw.release; }
  return out;
}
export function compileMoves(def: CrewDef): Partial<Record<MoveId, Move>> {
  const out: Partial<Record<MoveId, Move>> = {};
  for (const [id, m] of Object.entries(def.moves) as [MoveId, CrewMove][]) out[id] = compileMove(def, m);
  for (const [slot, scripts] of Object.entries(def.specials) as ['nspecial', Record<string, CrewMove>][]) {
    const phases = Object.fromEntries(Object.entries(scripts).map(([key, m]) => [key, compileMove(def, m)])), main = phases[''] ?? Object.values(phases)[0]; if (!main) continue;
    out[slot] = { ...main, phases }; out[`${slot}Air` as MoveId] = { ...main, phases };
  }
  return out;
}
const TIMING_DEFAULT: Record<TimingId, readonly [number, number?, number?]> = {
  spotdodge: [26, 2, 16], rollF: [32, 4, 18], rollB: [32, 4, 18], airdodge: [40, 3, 28], tech: [26, 1, 20], techF: [40, 1, 20], techB: [40, 1, 20], techWall: [26, 1, 14], techCeil: [26, 1, 14],
  bound: [24], downWait: [60], getup: [30, 1, 22], getupF: [36, 1, 20], getupB: [36, 1, 20], ledgeCatch: [8], climb: [32, 1, 26], climbSlow: [56, 1, 50], ledgeRoll: [44, 1, 30], ledgeRollSlow: [70, 1, 50],
  ledgeJump: [12, 1, 12], ledgeJumpSlow: [18, 1, 18], guardOff: [14], rebound: [22], turn: [10], dash: [14], landing: [4], squat: [8], dizzy: [400], grabRelease: [30], capturedRelease: [30],
};
export function compileTiming(def: CrewDef): Record<TimingId, Timing> {
  return Object.fromEntries((Object.keys(TIMING_DEFAULT) as TimingId[]).map(id => { const t = (def.timing as Partial<Record<TimingId, readonly [number, number?, number?]>> | undefined)?.[id] ?? TIMING_DEFAULT[id];
    return [id, { total: t[0], intangible: t[1] !== undefined && t[2] !== undefined ? [[t[1], t[2]]] : [] }]; })) as Record<TimingId, Timing>;
}
/** The simulation's full physics record from the handful of numbers a crew fighter is tuned with. */
export function compilePhysics(kind: CrewKind, p: CrewPhysics): Physics {
  const info = CREW_DATA[kind];
  return { walk: p.walk, walkAccel: p.walk * .14, walkBase: p.walk * .06, friction: p.friction, dashInitial: p.dashInitial, dashAccel: p.run * .08, dashBase: p.run * .02, run: p.run, dashFrames: 14,
    jumpsquat: p.jumpsquat, jumpH: p.airSpeed * .9, jumpHMax: p.airSpeed * 1.6, jumpMomentum: .8, fullHop: p.fullHop, shortHop: p.shortHop, airJumpV: p.airJump, airJumpH: p.airSpeed, airJumpDecay: p.jumps > 2 ? .08 : 0, jumps: p.jumps,
    gravity: p.gravity, terminal: p.terminal, fastFall: p.fastFall, drift: p.airSpeed, driftAccel: p.airAccel, driftBase: p.airAccel * .35, airFriction: p.airFriction, airMax: p.airSpeed * 1.7,
    weight: p.weight, landing: p.landing, turnFrames: 6, jabWindow: 12, scale: 1, shieldSize: p.shieldSize, shieldBreakVy: .22, ledgeJumpH: .06, ledgeJumpV: .24, height: info.height, radius: info.radius };
}
export { CREW };
