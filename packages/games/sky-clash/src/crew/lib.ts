/**
 * Shared authoring kit for crew fighters: key, clip and hitbox helpers, and the state library.
 *
 * A fighter supplies its stance, how it carries its arms and gear in each family of states (`Carriage`) and a few style numbers. The
 * library supplies legs, hips, trunk, timing, squash and stretch for every state clip, scaled to the fighter's legs, so feet land where
 * they should on any build. Any clip can then be replaced by a hand-authored one (Sola's whole set is; see src/crew/sola/states.ts).
 */
import { lerpPose, type Clip, type Ease, type Key, type Pose, type Rig } from '../anim/core';
import type { CrewHit, CrewTrail, StateClip } from './types';

export const k = (f: number, p: Pose = {}, e?: Ease): Key => (e ? { f, p, e } : { f, p });
/** Clips whose keys merge over `stance`. */
export const clipOn = (stance: Pose) => (keys: Key[], o: Partial<Clip> = {}): Clip => ({ keys, base: stance, ...o });
/** A hitbox on a rig anchor or bone for frames from..to (exclusive). */
export const h = (from: number, to: number, at: string, r: number, damage: number, angle: number, base: number, growth: number, o: Partial<CrewHit> = {}): CrewHit => ({ from, to, at, r, damage, angle, kb: [base, growth], ...o });
export const trail = (tip: string, base: string, color: string, width = .6) => (frames: [number, number]): CrewTrail => ({ tip, base, frames, color, width });
/** A free arm by forward swing, lift to the side and elbow bend (degrees), with how closed the hand is. */
export const arm = (side: 'L' | 'R', fwd = 0, out = 14, bend = 20, grip = .3, twist = 0): Pose => ({ [`arm${side}`]: { fwd, out, bend, twist }, [`grip${side}`]: grip });

const ARMS = ['armL', 'armR', 'aim', 'gripL', 'gripR', 'shrugL', 'shrugR', 'wristL', 'wristR'] as const;
/** Blend only the arm and weapon channels of two pose fragments (both must pose each arm the same way: by angles or by target). */
export function armMix(a: Pose, b: Pose, t: number): Pose {
  const m = lerpPose(a, b, t) as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const key of ARMS) if (a[key] !== undefined || b[key] !== undefined) out[key] = m[key];
  return out as Pose;
}

/** How a fighter holds its arms and gear. Every entry is a pose fragment laid over the library's legs and trunk; it may also override them. */
export type Carriage = {
  /** Low point of the idle breath, and the arms at the two foot contacts of the walk. */
  breathe?: Pose; walk?: readonly [Pose, Pose];
  /** Run: arms at the two contacts (the passing frames are blended), or all four of contact, pass, contact, pass. */
  run: readonly Pose[]; dash?: Pose; crouch: Pose;
  rise: Pose; apex: Pose; fall: Pose; airjump?: readonly [Pose, Pose];
  hurt: Pose; tumble: Pose; helpless?: Pose;
  shield: Pose; tuck: Pose; dodge?: Pose;
  /** Hanging from a ledge (see hangPose), reaching to grab, held by a grab, lying on the back, dazed, asleep, windmilling at an edge. */
  ledge: Pose; grab: Pose; held: Pose; down: Pose; dizzy: Pose; sleep?: Pose; teeter?: readonly [Pose, Pose];
  /** Standing tall (respawn halo), then the personal ones: victory keys, defeat and the select-screen pose. */
  plant: Pose; win: readonly Key[]; lose: Pose; select: Pose;
};
export type Style = {
  /** Leg length relative to 0.83 m: scales every foot and hip offset. */
  leg?: number;
  /** Run lean in degrees, idle and walk bounce (1 = default), crouch depth in meters, how far the lying figure's hips sit above the floor. */
  lean?: number; bob?: number; crouch?: number; depth?: number;
  /** 0 light and snappy .. 1 heavy: landings and recoveries take longer to settle and squash more. */
  heavy?: number;
  /** Frames of one idle breath, one walk cycle and one run cycle. */
  idle?: number; walkLoop?: number; runLoop?: number;
};

/** The ledge hang for a rig: hands on the ledge (the simulation hangs a fighter 0.8 of its height below it), body dropped until the arms are nearly straight. */
export function hangPose(rig: Rig, height: number, radius: number, leg = 1): Pose {
  const J = rig.joints, d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const reach = (d(J.upperarm_L, J.forearm_L) + d(J.forearm_L, J.hand_L)) * .94, y = height * .8, z = radius * .7 + .04, drop = Math.max(.1, J.upperarm_L[1] + reach - y), x = Math.min(.14, Math.abs(J.upperarm_L[0]) * .7);
  return { hips: [0, -drop, .02], lean: -6, turn: -10, spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [-10, 0, 0], head: [-14, 0, 0], armL: { to: [x, y, z], pole: [.5, -.5, -.3] }, armR: { to: [-x, y - .04, z - .03], pole: [-.5, -.5, -.3] }, gripL: 1, gripR: 1,
    footL: [J.foot_L[0] * .3, -drop, .06 * leg, 45, 5], footR: [J.foot_R[0] * .3, -drop - .06 * leg, -.04 * leg, 50, 10] };
}

export function makeStates(rig: Rig, stance: Pose, c: Carriage, style: Style = {}): Record<StateClip, Clip> {
  const L = style.leg ?? 1, lean = style.lean ?? 20, bob = (style.bob ?? 1) * L, heavy = style.heavy ?? 0, sq = 1 + .4 * heavy;
  const sl = stance.footL ?? [.03, 0, .2, 0, 10], sr = stance.footR ?? [-.05, 0, -.2, 0, 35], sh = stance.hips ?? [0, 0, 0], st = stance.turn ?? 0;
  const fl = (y: number, z: number, pitch = 0): number[] => [sl[0], y * L, z * L, pitch, sl[4] ?? 0], fr = (y: number, z: number, pitch = 0): number[] => [sr[0], y * L, z * L, pitch, sr[4] ?? 0];
  const hip = (y: number, z = 0, x = 0): number[] => [x, y * L, z * L], clip = clipOn(stance);
  /** Heavier fighters take longer to settle. */
  const T = (n: number) => Math.round(n * (1 + .45 * heavy));
  const run = c.run.length >= 4 ? c.run : [c.run[0], armMix(c.run[0], c.run[1] ?? c.run[0], .5), c.run[1] ?? c.run[0], armMix(c.run[0], c.run[1] ?? c.run[0], .5)];
  const AIR: Pose = { hips: hip(.02), footL: fl(.2, .12, 35), footR: fr(.08, -.1, 50) };
  const RUN: Pose = { lean, turn: st * .65, spine: [8, 6, 0], chest: [6, 8, 0], head: [-lean * .7, 8, 0] };
  const FALL: Pose = { ...AIR, lean: 6, stretch: .04, footL: fl(.14, .1, 40), footR: fr(.04, -.06, 50), head: [8, 10, 0], ...c.fall };
  const RISE2: Pose = { ...AIR, lean: -2, stretch: .03, footL: fl(.26, .16, 30), footR: fr(.12, -.12, 50), head: [-8, 10, 0], ...armMix(c.rise, c.apex, .6) };
  const HURT: Pose = { lean: -16, hips: hip(-.05, -.08), spine: [-10, 0, 0], chest: [-14, -6, 0], neck: [-10, 0, 0], head: [-18, -8, 0], face: [.9, 1, .8], footL: fl(0, .12, -10), footR: fr(0, -.26, 10), ...c.hurt };
  const TUMBLE: Pose = { hips: hip(.05), lean: 0, chest: [-10, 0, 0], footL: fl(.3, .25, 20), footR: fr(.18, .05, 40), face: [1, 1, .6], ...c.tumble };
  const SHIELD: Pose = { hips: hip(-.16, -.02), lean: 10, chest: [8, 12, 0], head: [-10, 12, 0], footL: fl(0, .24), footR: fr(0, -.24), ...c.shield };
  const TUCK: Pose = { hips: [0, 0, 0], lean: 24, lift: -.45 * L, spine: [20, 0, 0], chest: [30, 0, 0], head: [30, 0, 0], footL: fl(.42, .12, 10), footR: fr(.42, -.06, 20), ...c.tuck };
  const lift = -(rig.joints.hips[1] - (style.depth ?? .135));
  const DOWN: Pose = { spin: [-90, 0, 0], lift, hips: [0, 0, 0], lean: 0, turn: 0, spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [0, 0, 0], head: [-6, 20, 0], footL: [sl[0], 0, 0, 30, 15], footR: [sr[0], 0, 0, 30, 25], face: [1, .3, .2], ...c.down };
  const GRAB: Pose = { hips: hip(-.08, .04), lean: 8, turn: st * .35, ...c.grab };
  const HELD: Pose = { hips: [0, 0, 0], lean: -8, chest: [-6, 0, 0], head: [-10, 0, 6], footL: fl(.04, .1, 30), footR: fr(.03, -.02, 35), face: [.5, .6, .4], ...c.held };
  const PLANT: Pose = { hips: [0, 0, 0], lean: 0, turn: st * 1.4, spine: [0, 10, 0], chest: [0, 14, 0], head: [0, 16, 0], footL: fl(0, .06), footR: fr(0, -.06), ...c.plant };
  const DIZZY: Pose = { hips: [.04, -.14 * L, 0], roll: 6, lean: 10, chest: [10, 0, 6], head: [14, -10, 10], face: [.6, .6, .4], ...c.dizzy };
  const SLEEP: Pose = { hips: hip(-.2, .04), lean: 14, chest: [16, 0, 4], head: [30, 0, 8], face: [1, 0, .1], ...(c.sleep ?? c.dizzy) };
  const HELPLESS: Pose = { ...AIR, lean: 22, chest: [10, 0, 0], head: [20, 0, 0], footL: fl(.2, .05, 50), footR: fr(.1, -.12, 60), face: [.3, .6, .2], ...(c.helpless ?? c.fall) };
  const tee = c.teeter ?? [c.tumble, c.fall], N = style.idle ?? 110, W = style.walkLoop ?? 40, R = style.runLoop ?? 24;
  const walkKey = (a: 0 | 1, pass: boolean): Pose => {
    const front = a ? fr : fl, back = a ? fl : fr, [F, B] = a ? ['footR', 'footL'] : ['footL', 'footR'], ch = stance.chest ?? [0, 0, 0];
    return pass ? { hips: [sh[0], sh[1] + .025 * bob, sh[2]], [F]: front(0, .02, 0), [B]: back(.09, 0, 25), ...armMix(c.walk?.[a] ?? {}, c.walk?.[1 - a] ?? {}, .5) }
      : { hips: [sh[0], sh[1] - .005 * bob, sh[2]], chest: [ch[0], ch[1] + (a ? -5 : 5), ch[2] ?? 0], [F]: front(0, .26, -8), [B]: back(0, -.24, 20), ...c.walk?.[a] };
  };
  const runKey = (i: number): Pose => {
    const a = i >> 1, pass = i & 1, front = a ? fr : fl, back = a ? fl : fr, [F, B] = a ? ['footR', 'footL'] : ['footL', 'footR'];
    return pass ? { ...RUN, hips: hip(-.06, .04), [F]: front(0, -.05, 10), [B]: back(.28, .18, 20), ...run[i] } : { ...RUN, hips: hip(-.10, .04), [F]: front(0, .42, -10), [B]: back(.32, -.42, 70), ...run[i] };
  };
  return {
    idle: clip([k(0), k(N / 2, { hips: [sh[0], sh[1] - .016 * bob, sh[2] + .005], ...c.breathe }), k(N)], { loop: N }),
    walk: clip([k(0, walkKey(0, false)), k(W / 4, walkKey(0, true), 'lin'), k(W / 2, walkKey(1, false), 'lin'), k(W * 3 / 4, walkKey(1, true), 'lin'), k(W, walkKey(0, false), 'lin')], { loop: W, drag: .5 }),
    run: clip([k(0, runKey(0)), k(R / 4, runKey(1), 'lin'), k(R / 2, runKey(2), 'lin'), k(R * 3 / 4, runKey(3), 'lin'), k(R, runKey(0), 'lin')], { loop: R, drag: .6 }),
    dash: clip([k(0), k(4, { ...RUN, lean: lean + 10, hips: hip(-.16, .06), footR: fr(0, -.45, 35), footL: fl(.12, .25, 0), ...(c.dash ?? run[0]) }, 'snap'), k(10, runKey(0))]),
    turn: clip([k(0), k(3, { lean: -14, hips: hip(-.16, -.1), footL: fl(0, .38, -15), footR: fr(0, .05, 0), chest: [-6, 14, 0] }, 'out'), k(T(10), {}, 'io')]),
    crouch: clip([k(0), k(8, { hips: hip(-(style.crouch ?? .4), .02), lean: 16, spine: [10, 8, 0], chest: [8, 10, 0], head: [-18, 10, 0], ...c.crouch }, 'out')]),
    jumpsquat: clip([k(0), k(4, { hips: hip(-.26), lean: 14, stretch: -.10 * sq, ...c.crouch }, 'out')], { drag: 0 }),
    rise: clip([k(0, { ...AIR, lean: -4, stretch: .10, footL: fl(.16, .14, 35), footR: fr(.02, -.14, 55), head: [-12, 10, 0], ...c.rise }), k(12, RISE2, 'out')]),
    apex: clip([k(0, { ...AIR, lean: 2, footL: fl(.28, .16, 30), footR: fr(.14, -.1, 45), ...c.apex }), k(25, { ...AIR, lean: 3, footL: fl(.26, .15, 32), footR: fr(.13, -.1, 46), ...c.apex }), k(50, { ...AIR, lean: 2, footL: fl(.28, .16, 30), footR: fr(.14, -.1, 45), ...c.apex })], { loop: 50 }),
    fall: clip([k(0, FALL), k(15, { ...FALL, footL: fl(.16, .1, 42), lean: 7 }), k(30, FALL)], { loop: 30 }),
    airjump: clip([k(0, { ...AIR, hips: hip(.04), footL: fl(.36, .18, 20), footR: fr(.34, .05, 30), lean: 16, stretch: -.06, ...(c.airjump?.[0] ?? c.apex) }),
      k(5, { ...AIR, stretch: .12, lean: -6, footL: fl(.02, .05, 60), footR: fr(-.02, -.1, 65), ...(c.airjump?.[1] ?? c.rise) }, 'snap'), k(14, RISE2)], { drag: .5 }),
    land: clip([k(0, { hips: hip(-.20), stretch: -.08 * sq, lean: 12 }), k(2, { hips: hip(-.30), stretch: -.12 * sq, lean: 16, ...c.crouch }, 'out'), k(T(9), {}, 'back')], { drag: .5 }),
    landHard: clip([k(0, { hips: hip(-.26), stretch: -.1 * sq, lean: 14 }), k(3, { hips: hip(-.36), stretch: -.14 * sq, lean: 20, ...c.crouch }, 'out'), k(T(14), {}, 'back')]),
    hurt: clip([k(0), k(2, HURT, 'snap'), k(10, { ...HURT, lean: -11, face: [.6, .8, .5], head: [-12, -8, 0] }), k(26, { ...HURT, lean: -5, hips: hip(-.06, -.04), chest: [-6, 0, 0], head: [-6, 4, 0], face: [.2, .2, .2] })], { drag: 1.4 }),
    hurtAir: clip([k(0), k(2, { ...HURT, lean: -22, hips: hip(.05), chest: [-16, -6, 0], head: [-20, -8, 0], footL: fl(.2, .3, 20), footR: fr(.12, .16, 30), spin: [-12, 0, 0] }, 'snap'),
      k(30, { ...HURT, lean: -14, hips: hip(.05), footL: fl(.22, .24, 25), footR: fr(.14, .1, 35), spin: [-20, 0, 0], face: [.7, .8, .5] })], { drag: 1.4 }),
    tumble: clip([k(0, { ...TUMBLE, spin: [0, 0, 0] }), k(18, { ...TUMBLE, spin: [-180, 0, 0], footL: fl(.22, .1, 30), footR: fr(.3, .25, 20) }, 'lin'), k(36, { ...TUMBLE, spin: [-360, 0, 0] }, 'lin')], { loop: 36, drag: 2 }),
    shield: clip([k(0), k(6, SHIELD, 'out')]),
    shieldstun: clip([k(0, { ...SHIELD, hips: hip(-.2, -.09), lean: 3, chest: [2, 12, 0] }), k(8, SHIELD, 'back')]),
    dizzy: clip([k(0, DIZZY), k(45, { ...DIZZY, hips: [-.05, -.14 * L, .02], roll: -6, lean: 12, chest: [8, 0, -6], head: [10, 10, -10], face: [.75, .6, .5] }), k(90, DIZZY)], { loop: 90 }),
    sleep: clip([k(0, SLEEP), k(60, { ...SLEEP, hips: hip(-.215, .04), lean: 15, head: [34, 0, 8], face: [1, 0, .15] }), k(120, SLEEP)], { loop: 120 }),
    rollF: clip([k(0), k(5, { ...TUCK, spin: [0, 0, 0] }, 'out'), k(8, { ...TUCK, spin: [0, 0, 0] }), k(24, { ...TUCK, spin: [360, 0, 0] }, 'lin'), k(32, { spin: [360, 0, 0] }, 'io')], { drag: 0 }),
    rollB: clip([k(0), k(5, { ...TUCK, lean: 10, spin: [0, 0, 0] }, 'out'), k(8, { ...TUCK, lean: 10, spin: [0, 0, 0] }), k(24, { ...TUCK, lean: 10, spin: [-360, 0, 0] }, 'lin'), k(32, { spin: [-360, 0, 0] }, 'io')], { drag: 0 }),
    spotdodge: clip([k(0), k(6, { turn: st + 68, hips: [.28, -.1 * L, 0], lean: -8, chest: [-6, -10, 0], ...(c.dodge ?? c.shield) }, 'snap'), k(16, { turn: st + 68, hips: [.28, -.1 * L, 0], lean: -8, chest: [-6, -10, 0], ...(c.dodge ?? c.shield) }), k(26, {}, 'io')]),
    airdodge: clip([k(0, { ...AIR, ...c.apex }), k(4, { ...AIR, stretch: .06, footL: fl(.3, .1, 30), footR: fr(.3, 0, 30), turn: st - 32, ...(c.dodge ?? c.apex) }, 'snap'),
      k(18, { ...AIR, footL: fl(.3, .1, 30), footR: fr(.3, 0, 30), turn: st - 360, ...(c.dodge ?? c.apex) }, 'out'), k(40, { ...FALL, turn: st - 360 })], { drag: 0 }),
    helpless: clip([k(0, HELPLESS), k(20, { ...HELPLESS, lean: 26, footL: fl(.22, .05, 50), footR: fr(.1, -.14, 60) }), k(40, HELPLESS)], { loop: 40 }),
    ledge: clip([k(0, c.ledge), k(30, { ...c.ledge, hips: [0, (c.ledge.hips?.[1] ?? -.5), .05], footL: [...(c.ledge.footL ?? fl(-.5, .06, 45))].map((v, i) => i === 2 ? v + .04 : v) }), k(60, c.ledge)], { loop: 60 }),
    ledgeclimb: clip([k(0, c.ledge), k(10, { ...c.ledge, hips: [0, (c.ledge.hips?.[1] ?? -.5) * .6, .04], lean: 10, footL: fl(-.1, .2, 10) }, 'out'), k(20, { hips: hip(-.3, .1), lean: 24, footL: fl(0, .2), footR: fr(-.05, -.1, 20), ...c.crouch }), k(T(32), {}, 'io')]),
    grab: clip([k(0, GRAB), k(20, { ...GRAB, hips: hip(-.085, .045) }), k(40, GRAB)], { loop: 40 }),
    grabbed: clip([k(0, HELD), k(12, { ...HELD, head: [-10, 0, -6], footL: fl(.02, .02, 30), footR: fr(.05, .1, 35) }), k(24, HELD)], { loop: 24 }),
    thrown: clip([k(0, { ...TUMBLE, spin: [0, 0, 0] }), k(15, { ...TUMBLE, spin: [-180, 0, 0] }, 'lin'), k(30, { ...TUMBLE, spin: [-360, 0, 0] }, 'lin')], { loop: 30, drag: 2 }),
    knockdown: clip([k(0, { ...DOWN, spin: [-70, 0, 0], lift: lift * .73 }), k(5, DOWN, 'in'), k(11, { ...DOWN, lift: lift * .9, spin: [-84, 0, 0] }, 'out'), k(18, DOWN, 'in')], { drag: 0 }),
    getup: clip([k(0, DOWN), k(10, { spin: [-40, 0, 0], lift: lift * .6, hips: hip(-.2), footL: fl(.1, .25), footR: fr(.1, 0, 10), ...c.crouch }, 'io'), k(20, { spin: [0, 0, 0], lift: 0, hips: hip(-.3), lean: 20, ...c.crouch }, 'io'), k(30, {}, 'io')]),
    tech: clip([k(0, DOWN), k(8, { ...DOWN, spin: [-200, 0, 0], lift: lift * .37, footL: fl(.3, .1, 20), footR: fr(.3, 0, 20) }, 'out'), k(16, { spin: [-360, 0, 0], lift: 0, hips: hip(-.25), lean: 10 }, 'io'), k(26, { spin: [-360, 0, 0] }, 'back')], { drag: 0 }),
    teeter: clip([k(0, { lean: 16, hips: hip(-.04, .06), footL: fl(0, .08, 25), footR: fr(0, -.02, 25), face: [0, 1, .5], ...tee[0] }), k(18, { lean: -6, hips: hip(-.04, -.04), footL: fl(0, .08, 5), footR: fr(0, -.02, 5), face: [0, 1, .5], ...tee[1] }),
      k(36, { lean: 16, hips: hip(-.04, .06), footL: fl(0, .08, 25), footR: fr(0, -.02, 25), face: [0, 1, .5], ...tee[0] })], { loop: 36 }),
    respawn: clip([k(0, PLANT), k(40, { ...PLANT, hips: [0, -.012, 0] }), k(80, PLANT)], { loop: 80 }),
    win: clip([k(0), ...c.win]),
    lose: clip([k(0, c.lose)]),
    select: clip([k(0, c.select)]),
  };
}
