/**
 * Vesper's moveset: frame data, hitboxes riding the blowpipe and its molten gather, and one keyframed clip per move, all authored for her.
 * Shape language: long reach, measured arcs, the gather always the brightest thing on screen. She keeps people out; up close she is slow.
 */
import type { Pose } from '../../anim/core';
import type { MoveId } from '../../model';
import { counter, rise, shot, type Kit } from '../../specials/types';
import { clipOn, h, k, trail } from '../lib';
import type { CrewMove } from '../types';
import { LEDGE, Lf, Lg, Lt, R, STANCE, STATES, fl, fr } from './states';

const clip = clipOn(STANCE), GLOW = trail('staffTip', 'staffMid', '#bfeaff', .6), BUTT = trail('staffButt', 'grip', '#e8f4ff', .5);
const AIR: Pose = { hips: [0, .02, 0], footL: fl(.2, .12, 35), footR: fr(.08, -.1, 50) }, fallTo: Pose = { ...AIR, lean: 6, ...R(-.3, 1.4, 0, [76, -4, 0]), ...Lf(110, 50, 30, .2) };
const DOWN = STATES.knockdown.keys[STATES.knockdown.keys.length - 1]!.p, HOLD: Pose = { hips: [0, -.05, .04], lean: 6, turn: -10, ...Lt(.06, 1.32, .52), ...R(-.3, 1.0, -.1, [60, -10, 0]) };
const GLASS = { effect: 'ice' as const }, HOT = { effect: 'fire' as const }, HAND = { limb: 'handL' as const };

export const MOVES: Partial<Record<MoveId, CrewMove>> = {
  // ── Jab: two measured taps of the gather ──
  jab1: { name: 'Tap', total: 18, iasa: 15, followup: 7, hits: [h(4, 6, 'staffTip', .26, 3, 70, 16, 22, GLASS)], trail: GLOW([3, 7]),
    clip: clip([k(1, { ...R(-.28, 1.05, -.1, [20, 6, 0]) }), k(4, { ...R(-.2, 1.15, .3, [4, 2, 0]), hips: [0, -.04, .06], turn: -10 }, 'snap'), k(7, { ...R(-.2, 1.15, .31, [4, 2, 0]), hips: [0, -.04, .06], turn: -10 }), k(18, {}, 'io')]) },
  jab2: { name: 'Rap', total: 26, iasa: 22, hits: [h(5, 8, 'staffTip', .28, 5, 60, 34, 54, GLASS)], trail: GLOW([4, 9]),
    clip: clip([k(1, { ...R(-.22, 1.1, .1, [-10, 4, 0]) }), k(5, { ...R(-.2, 1.25, .3, [24, 2, 0]), hips: [0, -.04, .08], turn: -8, chest: [-4, 12, 0] }, 'snap'), k(9, { ...R(-.2, 1.27, .3, [30, 2, 0]), hips: [0, -.04, .08], turn: -8, chest: [-4, 12, 0] }, 'out'), k(26, {}, 'io')]) },
  // ── Tilts ──
  ftilt: { name: 'Long Draw', total: 34, iasa: 30, hits: [h(9, 13, 'staffTip', .32, 11, 38, 32, 76, GLASS), h(9, 13, 'staffMid', .26, 8, 38, 28, 68)], trail: GLOW([8, 14]),
    clip: clip([k(1, { ...R(-.34, 1.1, -.2, [10, -60, 0]), turn: -50, chest: [0, -14, 0] }), k(7, { ...R(-.36, 1.12, -.26, [10, -84, 0]), turn: -58, chest: [0, -18, 0] }, 'out'),
      k(10, { ...R(-.16, 1.15, .3, [4, 6, 0]), turn: 4, chest: [0, 16, 0], hips: [0, -.05, .08], lean: 6 }, 'snap'), k(14, { ...R(-.1, 1.15, .28, [4, 44, 0]), turn: 10, chest: [0, 20, 0], hips: [0, -.05, .08], lean: 6 }, 'out'), k(34, {}, 'io')]) },
  utilt: { name: 'Raise the Gather', total: 32, iasa: 28, hits: [h(7, 14, 'staffTip', .3, 8, 95, 35, 75, GLASS)], trail: GLOW([6, 15]),
    clip: clip([k(1, { ...R(-.2, 1.1, .2, [20, 4, 0]) }), k(6, { ...R(-.2, 1.2, .22, [50, 4, 0]), hips: [0, -.08, 0] }, 'in'), k(9, { ...R(-.18, 1.5, .06, [100, 0, 0]), stretch: .03, head: [-18, 8, 0] }, 'lin'),
      k(14, { ...R(-.2, 1.46, -.1, [150, 0, 0]), head: [-20, 8, 0] }, 'out'), k(18, { ...R(-.2, 1.44, -.1, [156, 0, 0]) }), k(32, {}, 'io')]) },
  dtilt: { name: 'Punty Poke', total: 26, iasa: 23, hits: [h(7, 10, 'staffTip', .25, 7, 72, 25, 55, GLASS)], trail: GLOW([6, 11]),
    clip: clip([k(1, { hips: [0, -.3, 0], lean: 16, ...R(-.26, .7, -.2, [-6, 6, 0]) }), k(7, { hips: [0, -.36, .1], lean: 24, ...R(-.18, .55, .3, [-10, 2, 0]), footL: fl(0, .3) }, 'snap'), k(11, { hips: [0, -.36, .1], lean: 24, ...R(-.18, .55, .31, [-10, 2, 0]), footL: fl(0, .3) }), k(26, {}, 'io')]) },
  dash: { name: 'Sweep Through', total: 40, iasa: 36, hits: [h(8, 12, 'staffTip', .32, 11, 55, 52, 58, GLASS), h(12, 17, 'staffTip', .28, 6, 65, 35, 45, GLASS), h(8, 17, 'staffMid', .24, 6, 65, 35, 45)], trail: GLOW([7, 17]),
    clip: clip([k(1, { lean: 20, ...R(-.3, .9, -.3, [-20, -20, 0]) }), k(8, { lean: 26, hips: [0, -.16, .18], ...R(-.16, 1.0, .34, [10, 4, 0]), footL: fl(0, .48), footR: fr(0, -.44, 30) }, 'snap'),
      k(17, { lean: 22, hips: [0, -.14, .18], ...R(-.14, 1.2, .3, [44, 10, 0]), footL: fl(0, .48), footR: fr(0, -.4, 30) }, 'out'), k(40, {}, 'io')]) },
  // ── Smashes: the gather does the work ──
  fsmash: { name: 'Gather Burst', total: 56, iasa: 52, charge: 7, hits: [h(20, 24, 'staffTip', .48, 19, 42, 30, 104, HOT), h(20, 24, 'staffMid', .28, 14, 42, 26, 94)], trail: GLOW([17, 26]),
    cues: [{ f: 20, kind: 'flare', at: 'staffTip', power: 1.1 }, { f: 21, kind: 'step', power: .7 }],
    clip: clip([k(1, { ...R(-.2, 1.2, -.1, [60, 0, 0]), ...Lg(.4) }), k(7, { ...R(-.22, 1.6, -.25, [128, -6, 0]), ...Lg(.42), hips: [0, -.1, -.08], lean: -10, turn: -36, chest: [-12, -6, 0], stretch: .03, footL: fl(0, .14) }, 'out'),
      k(17, { ...R(-.22, 1.62, -.27, [138, -6, 0]), ...Lg(.42), hips: [0, -.12, -.1], lean: -12, turn: -40, chest: [-14, -6, 0], stretch: .04, footL: fl(.04, .12) }, 'out'),
      k(20, { ...R(-.14, 1.08, .32, [-10, 2, 0]), ...Lg(.4), hips: [0, -.18, .14], lean: 22, turn: -4, chest: [14, 10, 0], stretch: -.04, footL: fl(0, .36), face: [0, -1, .6] }, 'snap'),
      k(25, { ...R(-.14, .94, .32, [-22, 2, 0]), ...Lg(.4), hips: [0, -.21, .15], lean: 26, turn: -2, chest: [16, 10, 0], stretch: -.05, footL: fl(0, .36), face: [0, -1, .6] }, 'out'),
      k(40, { ...R(-.14, .96, .3, [-18, 2, 0]), ...Lg(.4), hips: [0, -.2, .13], lean: 22, turn: -4, chest: [14, 10, 0], footL: fl(0, .36), face: [0, -.5, .2] }), k(56, {}, 'io')]) },
  usmash: { name: 'Blow', total: 50, iasa: 46, charge: 6, hits: [h(14, 18, 'staffTip', .3, 4, 90, 0, 0, { ...GLASS, fixed: 40 }), h(19, 25, 'staffTip', .54, 15, 88, 40, 98, { ...GLASS, off: [0, .3], group: 1 })],
    cues: [{ f: 19, kind: 'flare', at: 'staffTip', power: 1.2 }], aura: { at: 'staffTip', r: .5, frames: [14, 19], off: [0, .3] },
    clip: clip([k(1, { hips: [0, -.14, 0], ...R(-.2, .95, .1, [70, 4, 0]) }), k(6, { hips: [0, -.26, 0], lean: 10, stretch: -.05, ...R(-.2, .8, .1, [80, 2, 0]), ...Lg(.3) }, 'out'),
      k(14, { hips: [0, 0, .02], stretch: .08, lean: -4, head: [-28, 8, 0], ...R(-.16, 1.5, .1, [88, 2, 0]), ...Lg(.3) }, 'snap'), k(26, { hips: [0, -.01, .02], stretch: .06, lean: -4, head: [-28, 8, 0], ...R(-.16, 1.48, .1, [88, 2, 0]), ...Lg(.3) }), k(50, {}, 'io')]) },
  dsmash: { name: 'Floor Mirror', total: 48, iasa: 44, charge: 5, hits: [h(12, 16, 'staffButt', .38, 13, 30, 35, 80, { ...GLASS, off: [.62, .2] }), h(12, 16, 'staffButt', .38, 13, 30, 35, 80, { ...GLASS, off: [-1.12, .2] })],
    cues: [{ f: 12, kind: 'swish', power: 1.2 }, { f: 12, kind: 'step', power: 1 }],
    clip: clip([k(1, { ...R(-.2, 1.3, .2, [86, 0, 0]), ...Lg(.3) }), k(6, { ...R(-.14, 1.7, .24, [88, 0, 0]), ...Lg(.3), hips: [0, .0, 0], stretch: .05 }, 'out'), k(11, { ...R(-.14, 1.74, .24, [88, 0, 0]), ...Lg(.3), hips: [0, .01, 0], stretch: .06 }, 'out'),
      k(12, { ...R(-.14, .92, .26, [88, 0, 0]), ...Lg(.3), hips: [0, -.24, .04], lean: 12, stretch: -.06, face: [0, -1, .5] }, 'snap'), k(22, { ...R(-.14, .93, .26, [88, 0, 0]), ...Lg(.3), hips: [0, -.23, .04], lean: 12, stretch: -.04 }), k(48, {}, 'io')]) },
  // ── Aerials ──
  nair: { name: 'Glass Wheel', total: 42, landingLag: 9, autoCancel: [5, 32], hits: [h(6, 16, 'staffTip', .34, 8, 45, 22, 80, GLASS), h(6, 16, 'staffButt', .26, 7, 45, 22, 78), h(16, 26, 'staffTip', .32, 5, 45, 15, 70, { ...GLASS, group: 1 }), h(16, 26, 'staffButt', .24, 5, 45, 15, 70, { group: 1 })],
    trail: [GLOW([5, 26]), BUTT([5, 26])],
    clip: clip([k(1, { ...AIR, ...R(-.12, 1.3, .05, [10, 20, 0]), ...Lf(60, 60, 30) }), k(6, { ...AIR, ...R(-.1, 1.34, .05, [0, 0, 0]), ...Lf(80, 70, 20), footL: fl(.3, .16, 30), footR: fr(.24, 0, 40) }, 'in'),
      k(26, { ...AIR, turn: -382, ...R(-.1, 1.34, .05, [0, -540, 0]), ...Lf(80, 70, 20), footL: fl(.3, .16, 30), footR: fr(.24, 0, 40) }, 'lin'), k(42, { ...fallTo, turn: -382, aim: [76, -544, 0] }, 'io')], { drag: 0 }) },
  fair: { name: 'Gather Swing', total: 40, landingLag: 12, autoCancel: [8, 32], hits: [h(11, 15, 'staffTip', .4, 12, 45, 25, 92, HOT), h(11, 15, 'staffMid', .24, 8, 45, 22, 84)], trail: GLOW([9, 16]),
    clip: clip([k(1, { ...AIR, lean: -8, ...R(-.2, 1.5, -.2, [120, -6, 0]) }), k(8, { ...AIR, lean: -12, chest: [-10, -4, 0], ...R(-.2, 1.54, -.24, [132, -6, 0]) }, 'out'),
      k(11, { ...AIR, lean: 20, chest: [12, 8, 0], ...R(-.14, 1.2, .3, [-5, 2, 0]), footL: fl(.1, -.2, 50), footR: fr(.2, -.3, 60) }, 'snap'), k(16, { ...AIR, lean: 26, chest: [14, 8, 0], ...R(-.14, 1.05, .28, [-40, 2, 0]), footL: fl(.12, -.22, 50), footR: fr(.22, -.3, 60) }, 'out'), k(40, fallTo, 'io')]) },
  bair: { name: 'Back Draw', total: 36, landingLag: 14, autoCancel: [6, 28], hits: [h(9, 12, 'staffButt', .32, 11, 40, 28, 90)], trail: BUTT([8, 13]),
    clip: clip([k(1, { ...AIR, ...R(-.2, 1.2, .1, [5, 0, 0]), ...Lf(40, 40, 60) }), k(6, { ...AIR, turn: -10, ...R(-.2, 1.2, .32, [5, 0, 0]), ...Lf(60, 40, 60) }, 'out'),
      k(9, { ...AIR, turn: -64, chest: [0, -30, 0], head: [0, -50, 0], ...R(-.2, 1.2, -.3, [4, 0, 0]), ...Lf(90, 30, 20), footR: fr(.1, -.4, 60) }, 'snap'), k(13, { ...AIR, turn: -64, chest: [0, -30, 0], head: [0, -50, 0], ...R(-.2, 1.2, -.31, [4, 0, 0]), ...Lf(90, 30, 20), footR: fr(.1, -.4, 60) }), k(36, fallTo, 'io')]) },
  uair: { name: 'Halo', total: 36, landingLag: 12, autoCancel: [5, 28], hits: [h(7, 13, 'staffTip', .34, 9, 86, 22, 88, GLASS)], trail: GLOW([6, 14]),
    clip: clip([k(1, { ...AIR, ...R(-.18, 1.4, .1, [30, 0, 0]) }), k(5, { ...AIR, lean: 6, ...R(-.18, 1.46, .12, [36, 0, 0]) }, 'out'), k(8, { ...AIR, lean: -6, stretch: .05, head: [-26, 10, 0], ...R(-.16, 1.6, 0, [92, 0, 0]) }, 'snap'),
      k(13, { ...AIR, lean: -10, head: [-28, 10, 0], ...R(-.18, 1.56, -.08, [134, 0, 0]) }, 'out'), k(36, fallTo, 'io')]) },
  dair: { name: 'Plumb', total: 44, landingLag: 22, autoCancel: [9, 36], hits: [h(12, 16, 'staffTip', .3, 11, 280, 20, 80, GLASS), h(16, 23, 'staffTip', .28, 7, 60, 20, 60, { ...GLASS, group: 1 })], trail: GLOW([11, 18]),
    clip: clip([k(1, { ...AIR, ...R(-.16, 1.5, .08, [-50, 0, 0]) }), k(10, { ...AIR, stretch: -.04, ...R(-.14, 1.6, .1, [-88, 0, 0]), ...Lg(-.25), footL: fl(.3, .1, 30), footR: fr(.3, -.02, 30) }, 'out'),
      k(12, { ...AIR, stretch: .08, head: [16, 10, 0], ...R(-.14, 1.1, .12, [-88, 0, 0]), ...Lg(-.25), footL: fl(.34, -.1, 50), footR: fr(.36, -.2, 55) }, 'snap'), k(23, { ...AIR, stretch: .06, head: [16, 10, 0], ...R(-.14, 1.1, .12, [-88, 0, 0]), ...Lg(-.25), footL: fl(.34, -.1, 50), footR: fr(.36, -.2, 55) }), k(44, fallTo, 'io')]) },
  // ── Grab and throws: the off hand takes hold, the pipe does the rest ──
  grab: { name: 'Take Hold', total: 32, hits: [h(8, 10, 'hand_L', .3, 0, 0, 0, 0, HAND)],
    clip: clip([k(1, { ...HOLD, ...Lt(.06, 1.3, .22, 0), hips: [0, -.05, -.02] }), k(8, { ...HOLD, ...Lt(.04, 1.3, .68, 0), hips: [0, -.06, .1], lean: 10, turn: -40 }, 'snap'), k(11, { ...HOLD, ...Lt(.04, 1.3, .66), hips: [0, -.06, .09], lean: 10, turn: -40 }), k(32, {}, 'io')]) },
  dashgrab: { name: 'Passing Hold', total: 42, hits: [h(11, 14, 'hand_L', .32, 0, 0, 0, 0, HAND)],
    clip: clip([k(1, { ...HOLD, lean: 20, ...Lt(.06, 1.2, .22, 0), hips: [0, -.12, .04] }), k(11, { ...HOLD, lean: 24, ...Lt(.04, 1.2, .76, 0), hips: [0, -.16, .2], turn: -40, footL: fl(0, .44) }, 'snap'),
      k(15, { ...HOLD, lean: 24, ...Lt(.04, 1.2, .74), hips: [0, -.16, .19], turn: -40, footL: fl(0, .44) }), k(42, {}, 'io')]) },
  pummel: { name: 'Rap', total: 18, iasa: 16, hits: [h(6, 8, 'staffMid', .3, 2, 0, 0, 0)],
    clip: clip([k(1, HOLD), k(4, { ...HOLD, ...R(-.3, 1.2, -.2, [70, -10, 0]) }, 'out'), k(6, { ...HOLD, ...R(-.2, 1.2, .2, [46, 0, 0]) }, 'snap'), k(18, HOLD, 'io')]) },
  fthrow: { name: 'Show Out', total: 34, throw: { damage: 7, angle: 42, kb: [50, 52], release: 15 }, trail: GLOW([12, 17]),
    clip: clip([k(1, HOLD), k(9, { ...HOLD, ...R(-.34, 1.1, -.26, [10, -70, 0]), turn: -40 }, 'out'), k(14, { ...R(-.16, 1.15, .3, [4, 6, 0]), ...Lf(20, 40, 30, 0), hips: [0, -.05, .1], turn: 0, lean: 8 }, 'snap'), k(19, { ...R(-.12, 1.15, .28, [4, 30, 0]), ...Lf(20, 40, 30), hips: [0, -.05, .1], turn: 4, lean: 8 }, 'out'), k(34, {}, 'io')]) },
  bthrow: { name: 'Turn Out', total: 38, throw: { damage: 9, angle: 45, kb: [58, 60], release: 18, turn: true },
    clip: clip([k(1, HOLD), k(8, { ...HOLD, hips: [0, -.08, -.06], lean: -6 }, 'out'), k(16, { ...HOLD, turn: -200, lean: -10, ...Lt(-.06, 1.34, -.5) }, 'in'), k(18, { ...HOLD, turn: -200, lean: -12, ...Lt(-.06, 1.4, -.6, 0) }), k(24, { turn: -382, ...Lf(40, 50, 30) }, 'lin'), k(38, { turn: -382 }, 'io')]) },
  uthrow: { name: 'Lift', total: 32, throw: { damage: 7, angle: 88, kb: [58, 66], release: 13 },
    clip: clip([k(1, HOLD), k(7, { ...HOLD, hips: [0, -.26, .04], lean: 16, ...Lt(.06, 1.0, .46) }, 'out'), k(12, { ...HOLD, hips: [0, 0, .04], lean: -6, stretch: .08, ...Lt(.05, 1.86, .3), ...R(-.26, 1.2, 0, [86, 0, 0]) }, 'snap'),
      k(14, { hips: [0, 0, .04], lean: -6, stretch: .06, ...Lt(.05, 1.86, .3, 0), ...R(-.26, 1.2, 0, [86, 0, 0]) }), k(32, {}, 'io')]) },
  dthrow: { name: 'Set Down', total: 36, throw: { damage: 6, angle: 72, kb: [50, 40], release: 16 },
    clip: clip([k(1, HOLD), k(9, { ...HOLD, ...Lt(.06, 1.6, .4), hips: [0, -.03, 0], lean: -4 }, 'out'), k(15, { ...HOLD, ...Lt(.06, .5, .5), hips: [0, -.3, .1], lean: 26 }, 'snap'), k(18, { hips: [0, -.3, .1], lean: 26, ...Lt(.06, .52, .5, 0) }), k(36, {}, 'io')]) },
  // ── Getting back in ──
  ledgeattack: { name: 'Edge Draw', total: 56, intangible: [[1, 18]], hits: [h(21, 25, 'staffTip', .28, 8, 45, 40, 50, GLASS), h(21, 25, 'staffMid', .24, 7, 45, 38, 48)], trail: GLOW([19, 26]),
    clip: clip([k(1, LEDGE), k(12, { ...LEDGE, hips: [0, (LEDGE.hips?.[1] ?? -.5) * .6, .04], lean: 10, footL: fl(-.1, .2, 10) }, 'out'), k(18, { hips: [0, -.3, .04], lean: 16, ...R(-.26, .7, -.2, [0, 10, 0]) }, 'io'),
      k(21, { hips: [0, -.3, .1], lean: 22, ...R(-.16, .64, .3, [-6, 2, 0]), footL: fl(0, .3) }, 'snap'), k(27, { hips: [0, -.3, .1], lean: 22, ...R(-.16, .64, .32, [-6, 2, 0]), footL: fl(0, .3) }), k(56, {}, 'io')]) },
  getupattack: { name: 'Rising Wheel', total: 52, intangible: [[1, 24]], hits: [h(19, 23, 'staffTip', .3, 6, 45, 45, 40, GLASS), h(25, 29, 'staffTip', .3, 6, 45, 45, 40, { ...GLASS, group: 1 })], trail: GLOW([18, 30]),
    clip: clip([k(1, DOWN), k(12, { spin: [-30, 0, 0], lift: -.5, hips: [0, -.3, 0], ...R(-.26, .8, 0, [20, 30, 0]) }, 'io'), k(19, { spin: [0, 0, 0], lift: 0, hips: [0, -.42, 0], lean: 14, ...R(-.16, .64, .25, [-8, 0, 0]) }, 'snap'),
      k(25, { hips: [0, -.42, 0], lean: 8, turn: -80, ...R(-.2, .64, -.2, [-8, -180, 0]) }, 'lin'), k(33, { hips: [0, -.4, 0], lean: 8, turn: -80, ...R(-.2, .66, -.2, [-6, -190, 0]) }), k(52, { aim: [84, -356, 0] }, 'io')], { drag: 0 }) },
  taunt: { name: 'Polish', total: 84,
    clip: clip([k(1), k(16, { head: [8, 12, 0], chest: [0, 12, 0], ...Lt(.03, 1.68, .15, .3), face: [.3, .1, 0] }, 'io'), k(34, { head: [4, 2, 0], chest: [0, 12, 0], ...Lt(.03, 1.69, .15, .3), face: [.3, .1, 0] }, 'io'),
      k(52, { head: [8, 14, 0], chest: [0, 12, 0], ...Lt(.03, 1.68, .15, .3), face: [0, .3, .1] }, 'io'), k(84, {}, 'io')]) },
};

// ── Specials ──────────────────────────────────────────────────────────────
const BLOW = [k(1), k(10, { ...R(-.14, 1.42, .26, [6, 4, 0]), ...Lg(-.3), hips: [0, -.04, -.04], lean: -4, chest: [-6, 6, 0], head: [-6, 8, 0] }, 'out'), k(20, { ...R(-.14, 1.43, .25, [8, 4, 0]), ...Lg(-.3), hips: [0, -.04, -.05], lean: -6, chest: [-12, 6, 0], head: [-8, 8, 0], stretch: .02 }),
  k(22, { ...R(-.12, 1.4, .32, [0, 4, 0]), ...Lg(-.3), hips: [0, -.05, .06], lean: 6, chest: [6, 8, 0], face: [0, 0, .7] }, 'snap'), k(34, { ...R(-.12, 1.4, .32, [0, 4, 0]), ...Lg(-.3), hips: [0, -.05, .06], lean: 6, chest: [6, 8, 0], face: [0, 0, .4] }), k(50, {}, 'io')];
const FLICK = [k(1), k(8, { ...R(-.3, 1.3, -.2, [70, -30, 0]), turn: -46, chest: [0, -10, 0] }, 'out'), k(13, { ...R(-.14, 1.3, .3, [20, 10, 0]), turn: -6, hips: [0, -.05, .08], chest: [4, 14, 0] }, 'snap'), k(19, { ...R(-.12, 1.28, .3, [4, 24, 0]), turn: -4, hips: [0, -.05, .08], chest: [4, 16, 0] }, 'out'), k(42, {}, 'io')];
const RIDE: Pose = { hips: [0, .04, 0], lean: -6, stretch: .04, footL: fl(.3, .3, 10), footR: fr(.26, .2, 20), ...R(-.26, 1.0, .1, [-70, 6, 0]), ...Lf(60, 50, 30, .2) };
const air = (keys: ReturnType<typeof k>[]) => keys.map(key => ({ ...key, p: { ...AIR, ...key.p } }));
export const SPECIALS = {
  nspecial: {
    '': { name: 'Glass Bulb', total: 50, shots: [22], cues: [{ f: 22, kind: 'flare' as const, at: 'staffTip', power: .7 }], aura: { at: 'staffTip', r: .32, frames: [10, 22] as const }, clip: clip(BLOW) },
    Air: { name: 'Glass Bulb', total: 50, shots: [22], cues: [{ f: 22, kind: 'flare' as const, at: 'staffTip', power: .7 }], aura: { at: 'staffTip', r: .32, frames: [10, 22] as const }, clip: clip(air(BLOW)) },
  },
  sspecial: {
    '': { name: 'Shard Fan', total: 42, shots: [13], trail: GLOW([10, 16]), cues: [{ f: 13, kind: 'swish' as const, at: 'staffTip', power: .7 }], clip: clip(FLICK) },
    Air: { name: 'Shard Fan', total: 42, shots: [13], trail: GLOW([10, 16]), cues: [{ f: 13, kind: 'swish' as const, at: 'staffTip', power: .7 }], clip: clip(air(FLICK)) },
  },
  uspecial: {
    '': { name: 'Bubble Lift', total: 70, hits: [h(58, 64, 'hips', .75, 8, 80, 45, 60, { ...GLASS, off: [0, -.55], limb: 'body' })], cues: [{ f: 58, kind: 'swish' as const, power: 1.2 }, { f: 10, kind: 'step' as const, power: .6 }],
      aura: { at: 'hips', r: .72, frames: [10, 58] as const, off: [0, -.6] },
      clip: clip([k(1, { hips: [0, -.2, 0], lean: 8, ...R(-.2, .9, .1, [-60, 0, 0]), ...Lg(.3) }), k(9, { hips: [0, -.26, 0], lean: 10, stretch: -.06, ...R(-.2, .86, .1, [-64, 0, 0]), ...Lg(.3) }, 'out'), k(11, RIDE, 'snap'),
        k(34, { ...RIDE, lean: -2, roll: 4, footL: fl(.3, .34, 10) }), k(58, { ...RIDE, lean: -8, roll: -3 }), k(62, { ...AIR, stretch: .1, lean: -4, ...R(-.3, 1.3, 0, [60, 0, 0]), ...Lf(120, 30, 30) }, 'snap'), k(70, fallTo, 'io')]) },
  },
  dspecial: {
    '': { name: 'Kiln Mirror', total: 46, aura: { at: 'staffMid', r: .78, frames: [6, 28] as const },
      clip: clip([k(1), k(6, { ...R(-.1, 1.2, .32, [88, 0, 0]), ...Lg(.4), hips: [0, -.08, -.02], lean: -4, turn: -10 }, 'out'), k(28, { ...R(-.1, 1.2, .32, [88, 0, 0]), ...Lg(.4), hips: [0, -.09, -.02], lean: -4, turn: -10 }), k(46, {}, 'io')]) },
    Hit: { name: 'Kiln Mirror', total: 36, hits: [h(5, 10, 'staffTip', .5, 10, 45, 50, 70, GLASS), h(5, 10, 'staffMid', .3, 8, 45, 45, 66)], trail: GLOW([3, 11]), cues: [{ f: 5, kind: 'swish' as const, at: 'staffTip', power: 1.2 }],
      clip: clip([k(1, { ...R(-.3, 1.2, -.2, [10, -70, 0]), turn: -50 }), k(5, { ...R(-.14, 1.2, .32, [4, 10, 0]), turn: 6, hips: [0, -.08, .1], lean: 10, chest: [0, 16, 0] }, 'snap'), k(11, { ...R(-.1, 1.2, .3, [4, 54, 0]), turn: 12, hips: [0, -.08, .1], lean: 10, chest: [0, 20, 0] }, 'out'), k(36, {}, 'io')]) },
  },
} satisfies Record<string, Record<string, CrewMove>>;

const shard = (angle: number) => shot(13, 'shard', 5, .22, { angle, gravity: .0008, life: 28, r: .13, x: 1.25, y: 1.45, effect: 'ice', kbAngle: 50, kbBase: 14, kbGrowth: 26, max: 6 });
/** Phase flow, movement and projectiles for the four specials. */
export const KIT: Kit = {
  // Glass Bulb: she blows a bulb that drifts slowly forward and bursts when it touches someone or runs out of breath. One at a time.
  n: { start: '', phases: { '': { shots: [shot(22, 'glassbulb', 8, .06, { angle: 6, gravity: -.00035, life: 110, r: .32, x: 1.5, y: 1.42, effect: 'ice', kbAngle: 70, kbBase: 30, kbGrowth: 55, max: 1, blast: { r: .9, damage: 10, life: 10, kbBase: 35, kbGrowth: 70, angle: 75 } })] } } },
  // Shard Fan: a flick of the gather throws three shards in a fan. Short reach, quick.
  s: { start: '', phases: { '': { shots: [shard(16), shard(2), shard(-12)] } } },
  // Bubble Lift: a bubble under her feet carries her up, slow and steerable, and bursts under whoever followed. Nothing protects her on the way.
  hi: { start: '', helpless: true, lag: 14, once: true, phases: { '': { motion: rise(10, 60, .108, .0006, .05), ledge: 14 } } },
  // Kiln Mirror: a pane of glass held out for a moment. Strike it and it answers with everything you gave it.
  lw: counter([6, 28], 1.3),
};
