/**
 * Toll's moveset: frame data, hitboxes riding his fists, shoulders, crown and feet, and one keyframed clip per move, all authored for him.
 * Shape language: long honest wind-ups, short violent contacts, a held pose while the bell rings. Slow, heavy, hard to move.
 */
import type { Pose } from '../../anim/core';
import type { MoveId } from '../../model';
import { hit, rise, still, type Kit } from '../../specials/types';
import { clipOn, h, k, trail } from '../lib';
import type { CrewMove } from '../types';
import { BELL, LEDGE, LEG, Lf, Lt, Rf, Rt, STANCE, STATES } from './states';

const clip = clipOn(STANCE), GOLD = '#ffd27a', FR = trail('fistR', 'elbowR', GOLD, .7), FL = trail('fistL', 'elbowL', GOLD, .7);
const fl = (y: number, z: number, pitch = 0): number[] => [.05, y * LEG, z * LEG, pitch, 12], fr = (y: number, z: number, pitch = 0): number[] => [-.08, y * LEG, z * LEG, pitch, 32];
const AIR: Pose = { hips: [0, .02, 0], footL: fl(.2, .12, 35), footR: fr(.08, -.1, 50) }, fallTo: Pose = { ...AIR, lean: 6, ...Lf(104, 56, 40, .2), ...Rf(92, 60, 40, .2) };
const DOWN = STATES.knockdown.keys[STATES.knockdown.keys.length - 1]!.p, HOLD: Pose = { hips: [0, -.06, .04], lean: 8, turn: -8, ...Lt(.1, 1.3, .82), ...Rf(20, 30, 92) };
const ARM = { limb: 'handR' as const }, HEAD = { limb: 'head' as const }, FOOT = { limb: 'footL' as const }, BODY = { limb: 'body' as const };

export const MOVES: Partial<Record<MoveId, CrewMove>> = {
  // ── Jab: a swat with the lead hand, then the hook ──
  jab1: { name: 'Clang', total: 24, iasa: 20, followup: 9, hits: [h(6, 9, 'fistL', .32, 5, 62, 20, 25, ARM)], trail: FL([5, 9]),
    clip: clip([k(1, { turn: -28, ...Lf(74, 34, 124) }), k(4, { turn: -26, ...Lf(80, 38, 128) }, 'out'), k(6, { turn: -46, hips: [0, -.06, .08], lean: 12, ...Lt(.22, 1.36, .98) }, 'snap'), k(10, { turn: -46, hips: [0, -.06, .09], lean: 12, ...Lt(.22, 1.36, 1.0) }), k(24, {}, 'io')]) },
  jab2: { name: 'Clong', total: 34, iasa: 29, hits: [h(9, 13, 'fistR', .38, 8, 45, 40, 62, ARM)], trail: FR([7, 13]), cues: [{ f: 9, kind: 'step', power: .6 }],
    clip: clip([k(1, { turn: -38, ...Rf(-12, 46, 100) }), k(6, { turn: -44, hips: [0, -.07, -.04], ...Rf(-28, 52, 96) }, 'out'),
      k(9, { turn: 28, hips: [0, -.09, .13], lean: 14, chest: [10, 22, 0], ...Rt(.06, 1.32, .98), ...Lf(20, 40, 110), footR: fr(.03, -.12, 25) }, 'snap'),
      k(14, { turn: 36, hips: [0, -.09, .13], lean: 14, chest: [10, 26, 0], ...Rt(.28, 1.3, .8), ...Lf(20, 40, 110), footR: fr(.03, -.12, 25) }, 'out'), k(34, {}, 'io')]) },
  // ── Tilts ──
  ftilt: { name: 'Shoulder Peal', total: 40, iasa: 35, hits: [h(11, 16, 'shoulderR', .46, 12, 36, 40, 70, BODY), h(11, 16, 'elbowR', .34, 10, 36, 36, 66, BODY)], cues: [{ f: 11, kind: 'step', power: .8 }],
    clip: clip([k(1, { hips: [0, -.08, -.06], lean: -2, turn: -40, ...Rf(-28, 30, 100), ...Lf(60, 25, 92) }), k(8, { hips: [0, -.11, -.1], lean: -6, turn: -46, ...Rf(-36, 32, 104), ...Lf(64, 25, 92) }, 'out'),
      k(11, { hips: [0, -.14, .3], lean: 26, turn: 52, chest: [10, 26, 0], head: [-16, -30, 0], ...Rf(-20, 34, 112), ...Lf(-34, 40, 60), footL: fl(0, .5), stretch: .03 }, 'snap'),
      k(17, { hips: [0, -.15, .31], lean: 27, turn: 54, chest: [10, 26, 0], head: [-16, -30, 0], ...Rf(-20, 34, 112), ...Lf(-34, 40, 60), footL: fl(0, .5) }), k(40, {}, 'io')]) },
  utilt: { name: 'Lift the Roof', total: 38, iasa: 33, hits: [h(10, 15, 'fistR', .4, 10, 88, 42, 70, ARM), h(10, 15, 'fistL', .4, 10, 88, 42, 70, ARM)], trail: [FR([8, 15]), FL([8, 15])],
    clip: clip([k(1, { hips: [0, -.18, 0], lean: 14, ...Rf(20, 30, 100), ...Lf(30, 25, 100) }), k(7, { hips: [0, -.26, 0], lean: 18, stretch: -.05, ...Rf(-10, 36, 92), ...Lf(0, 30, 92) }, 'out'),
      k(10, { hips: [0, .0, .03], stretch: .07, lean: -6, chest: [-10, 10, 0], head: [-22, 10, 0], ...Rt(-.26, 2.3, .22), ...Lt(.22, 2.3, .26) }, 'snap'), k(16, { hips: [0, -.01, .03], stretch: .05, lean: -6, chest: [-10, 10, 0], head: [-22, 10, 0], ...Rt(-.26, 2.28, .2), ...Lt(.22, 2.28, .24) }), k(38, {}, 'io')]) },
  dtilt: { name: 'Deck Stamp', total: 36, iasa: 32, hits: [h(10, 13, 'footL', .44, 11, 72, 36, 60, FOOT)], cues: [{ f: 10, kind: 'step', power: 1 }, { f: 10, kind: 'ring', at: 'footL', power: .6 }],
    clip: clip([k(1, { footL: fl(.2, .2, 10), hips: [0, -.04, -.06], lean: -4 }), k(8, { footL: fl(.5, .32, 22), hips: [0, -.02, -.1], lean: -9, ...Lf(80, 30, 80), ...Rf(40, 40, 90) }, 'out'),
      k(10, { footL: fl(0, .62), hips: [0, -.17, .13], lean: 17, stretch: -.05, ...Lf(30, 40, 80), ...Rf(10, 44, 80) }, 'snap'), k(15, { footL: fl(0, .62), hips: [0, -.16, .13], lean: 16, ...Lf(30, 40, 80), ...Rf(10, 44, 80) }), k(36, {}, 'io')]) },
  dash: { name: 'Rolling Peal', total: 46, iasa: 42, hits: [h(8, 13, 'shoulderL', .5, 13, 50, 60, 55, BODY), h(13, 19, 'shoulderL', .44, 9, 60, 40, 45, BODY), h(8, 19, 'belly', .4, 9, 60, 40, 45, BODY)],
    clip: clip([k(1, { lean: 24, hips: [0, -.13, 0], turn: -50, ...Lf(20, 30, 112), ...Rf(-20, 36, 90) }), k(8, { lean: 34, hips: [0, -.19, .2], turn: -64, ...Lf(10, 40, 116), ...Rf(-42, 40, 70), footL: fl(0, .56, -10), footR: fr(0, -.5, 40), stretch: .04 }, 'snap'),
      k(20, { lean: 34, hips: [0, -.2, .2], turn: -64, ...Lf(10, 40, 116), ...Rf(-42, 40, 70), footL: fl(0, .56), footR: fr(0, -.46, 40) }), k(46, {}, 'io')]) },
  // ── Smashes ──
  fsmash: { name: 'Great Knell', total: 62, iasa: 58, charge: 9, hits: [h(24, 29, 'fistR', .5, 21, 40, 34, 96, ARM), h(24, 29, 'elbowR', .38, 17, 40, 32, 92, ARM)], trail: FR([21, 30]),
    cues: [{ f: 23, kind: 'step', power: 1 }, { f: 24, kind: 'ring', at: 'fistR', power: 1.1 }],
    clip: clip([k(1, { turn: -36, ...Rf(-10, 40, 100) }), k(9, { turn: -58, hips: [0, -.12, -.14], lean: -12, chest: [-8, -16, 0], ...Rf(-70, 50, 122), ...Lf(72, 20, 58), footL: fl(.08, .18), stretch: .03 }, 'out'),
      k(21, { turn: -64, hips: [0, -.15, -.17], lean: -15, chest: [-10, -18, 0], ...Rf(-82, 52, 126), ...Lf(76, 20, 56), footL: fl(.1, .16), stretch: .04 }, 'out'),
      k(24, { turn: 40, hips: [0, -.16, .27], lean: 24, chest: [14, 26, 0], ...Rt(.06, 1.3, 1.36), ...Lf(-40, 35, 70), footL: fl(0, .6), footR: fr(.04, -.2, 30), stretch: -.04, face: [0, -1, .8] }, 'snap'),
      k(30, { turn: 47, hips: [0, -.18, .29], lean: 26, chest: [14, 28, 0], ...Rt(.22, 1.26, 1.24), ...Lf(-40, 35, 70), footL: fl(0, .6), footR: fr(.04, -.2, 30), stretch: -.05, face: [0, -1, .8] }, 'out'),
      k(44, { turn: 40, hips: [0, -.16, .25], lean: 22, chest: [12, 24, 0], ...Rt(.2, 1.24, 1.14), ...Lf(-30, 35, 70), footL: fl(0, .6), face: [0, -.6, .2] }), k(62, {}, 'io')]) },
  usmash: { name: 'Crown Strike', total: 54, iasa: 50, charge: 8, hits: [h(17, 23, 'crown', .48, 19, 85, 40, 96, HEAD)], cues: [{ f: 17, kind: 'ring', at: 'crown', power: 1 }],
    clip: clip([k(1, { hips: [0, -.18, 0], lean: 16 }), k(8, { hips: [0, -.3, 0], lean: 24, head: [22, 0, 0], stretch: -.08, ...Lf(-20, 40, 60), ...Rf(-20, 40, 60) }, 'out'), k(15, { hips: [0, -.33, 0], lean: 26, head: [24, 0, 0], stretch: -.1, ...Lf(-24, 42, 60), ...Rf(-24, 42, 60) }, 'out'),
      k(17, { hips: [0, .04, .04], stretch: .13, lean: -8, head: [-32, 0, 0], chest: [-10, 0, 0], ...Lf(-40, 50, 20), ...Rf(-40, 50, 20), footL: fl(0, .2, 22), footR: fr(0, -.2, 22), face: [0, -1, .7] }, 'snap'),
      k(24, { hips: [0, .03, .04], stretch: .1, lean: -8, head: [-32, 0, 0], chest: [-10, 0, 0], ...Lf(-40, 50, 20), ...Rf(-40, 50, 20), footL: fl(0, .2, 18), footR: fr(0, -.2, 18) }), k(54, {}, 'io')]) },
  dsmash: { name: 'Ground Toll', total: 58, iasa: 54, charge: 8, hits: [h(19, 23, 'fistL', .48, 16, 28, 40, 84, ARM), h(19, 23, 'fistR', .48, 16, 28, 40, 84, ARM)], trail: [FL([16, 23]), FR([16, 23])],
    cues: [{ f: 19, kind: 'ring', at: 'fistL', power: .9 }, { f: 19, kind: 'ring', at: 'fistR', power: .9 }, { f: 19, kind: 'step', power: 1 }],
    clip: clip([k(1, { ...Lf(90, 30, 60), ...Rf(90, 30, 60) }), k(8, { hips: [0, .01, 0], stretch: .06, lean: -6, turn: -70, ...Lt(.3, 2.25, .3), ...Rt(-.3, 2.25, -.3), head: [-10, 30, 0] }, 'out'),
      k(17, { hips: [0, .02, 0], stretch: .07, lean: -7, turn: -74, ...Lt(.3, 2.28, .3), ...Rt(-.3, 2.28, -.3), head: [-10, 30, 0] }, 'out'),
      k(19, { hips: [0, -.34, 0], lean: 4, turn: -78, stretch: -.1, ...Lt(.25, .3, 1.0), ...Rt(-.25, .3, -1.0), chest: [6, 0, 0], head: [8, 30, 0], face: [0, -1, .7] }, 'snap'),
      k(26, { hips: [0, -.33, 0], lean: 4, turn: -78, stretch: -.08, ...Lt(.25, .3, 1.0), ...Rt(-.25, .3, -1.0), chest: [6, 0, 0], head: [8, 30, 0] }), k(58, {}, 'io')]) },
  // ── Aerials ──
  nair: { name: 'Carillon', total: 44, landingLag: 14, autoCancel: [5, 34], hits: [h(6, 16, 'fistL', .4, 10, 45, 25, 80, ARM), h(6, 16, 'fistR', .4, 10, 45, 25, 80, ARM), h(16, 28, 'fistL', .36, 7, 45, 15, 70, { ...ARM, group: 1 }), h(16, 28, 'fistR', .36, 7, 45, 15, 70, { ...ARM, group: 1 })],
    trail: [FL([5, 28]), FR([5, 28])],
    clip: clip([k(1, { ...AIR, ...Lf(40, 60, 30), ...Rf(40, 60, 30) }), k(6, { ...AIR, turn: -22, ...Lf(0, 88, 6), ...Rf(0, 88, 6), footL: fl(.3, .12, 30), footR: fr(.26, 0, 40) }, 'in'),
      k(28, { ...AIR, turn: -742, ...Lf(0, 88, 6), ...Rf(0, 88, 6), footL: fl(.3, .12, 30), footR: fr(.26, 0, 40) }, 'lin'), k(44, { ...fallTo, turn: -742 }, 'io')], { drag: 0 }) },
  fair: { name: 'Hammer Fall', total: 48, landingLag: 22, autoCancel: [9, 38], hits: [h(15, 19, 'fistR', .5, 15, 290, 20, 82, ARM), h(15, 19, 'fistL', .4, 13, 290, 18, 78, ARM)], trail: [FR([12, 20]), FL([12, 20])],
    clip: clip([k(1, { ...AIR, ...Lt(.1, 2.1, .12), ...Rt(-.1, 2.1, .12) }), k(11, { ...AIR, lean: -14, chest: [-14, 0, 0], stretch: .04, ...Lt(.08, 2.3, -.18), ...Rt(-.08, 2.3, -.18) }, 'out'),
      k(15, { ...AIR, lean: 24, chest: [20, 0, 0], ...Lt(.08, 1.0, .92), ...Rt(-.08, 1.0, .92), footL: fl(.1, -.2, 50), footR: fr(.2, -.3, 60) }, 'snap'),
      k(20, { ...AIR, lean: 28, chest: [22, 0, 0], ...Lt(.08, .66, .74), ...Rt(-.08, .66, .74), footL: fl(.1, -.2, 50), footR: fr(.2, -.3, 60) }, 'out'), k(48, fallTo, 'io')]) },
  bair: { name: 'Back Peal', total: 38, landingLag: 16, autoCancel: [6, 30], hits: [h(9, 13, 'elbowR', .44, 13, 40, 28, 92, BODY), h(9, 13, 'shoulderR', .36, 11, 40, 26, 88, BODY)],
    clip: clip([k(1, { ...AIR, ...Rf(40, 30, 110) }), k(6, { ...AIR, turn: 8, ...Rf(72, 30, 122), ...Lf(40, 40, 80) }, 'out'),
      k(9, { ...AIR, turn: -78, chest: [0, -30, 0], head: [0, -44, 0], ...Rf(-64, 60, 104), ...Lf(80, 30, 60) }, 'snap'), k(14, { ...AIR, turn: -80, chest: [0, -30, 0], head: [0, -44, 0], ...Rf(-66, 60, 104), ...Lf(80, 30, 60) }), k(38, fallTo, 'io')]) },
  uair: { name: 'Dome', total: 36, landingLag: 14, autoCancel: [5, 28], hits: [h(8, 14, 'crown', .46, 12, 85, 25, 88, HEAD)],
    clip: clip([k(1, { ...AIR, head: [10, 0, 0] }), k(6, { ...AIR, lean: 12, stretch: -.05, head: [24, 0, 0], ...Lf(60, 30, 100), ...Rf(60, 30, 100) }, 'out'),
      k(8, { ...AIR, lean: -10, stretch: .1, head: [-34, 0, 0], chest: [-10, 0, 0], ...Lf(-30, 40, 20), ...Rf(-30, 40, 20) }, 'snap'), k(15, { ...AIR, lean: -10, stretch: .08, head: [-34, 0, 0], chest: [-10, 0, 0], ...Lf(-30, 40, 20), ...Rf(-30, 40, 20) }), k(36, fallTo, 'io')]) },
  dair: { name: 'Dead Weight', total: 46, landingLag: 24, autoCancel: [9, 38], hits: [h(12, 16, 'footL', .4, 14, 280, 20, 80, FOOT), h(12, 16, 'footR', .4, 14, 280, 20, 80, FOOT), h(16, 23, 'footL', .36, 9, 60, 20, 60, { ...FOOT, group: 1 }), h(16, 23, 'footR', .36, 9, 60, 20, 60, { ...FOOT, group: 1 })],
    clip: clip([k(1, { ...AIR, footL: fl(.4, .1, 20), footR: fr(.4, 0, 20), stretch: -.05 }), k(10, { ...AIR, footL: fl(.5, .12, 20), footR: fr(.5, 0, 20), stretch: -.08, ...Lf(60, 30, 100), ...Rf(60, 30, 100) }, 'out'),
      k(12, { ...AIR, footL: fl(-.03, .05, -10), footR: fr(-.03, -.05, -10), stretch: .1, ...Lf(150, 30, 20), ...Rf(150, 30, 20) }, 'snap'), k(23, { ...AIR, footL: fl(-.03, .05, -10), footR: fr(-.03, -.05, -10), stretch: .08, ...Lf(150, 30, 20), ...Rf(150, 30, 20) }), k(46, fallTo, 'io')]) },
  // ── Grab and throws ──
  grab: { name: 'Clamp', total: 36, hits: [h(9, 12, 'fistL', .36, 0, 0, 0, 0)],
    clip: clip([k(1, { ...HOLD, ...Lt(.12, 1.3, .3, 0), hips: [0, -.06, -.02] }), k(9, { ...HOLD, ...Lt(.06, 1.3, 1.02, 0), hips: [0, -.08, .12], lean: 12, turn: -40 }, 'snap'), k(12, { ...HOLD, ...Lt(.06, 1.3, 1.0), hips: [0, -.08, .1], lean: 12, turn: -40 }), k(36, {}, 'io')]) },
  dashgrab: { name: 'Running Clamp', total: 46, hits: [h(12, 15, 'fistL', .38, 0, 0, 0, 0)],
    clip: clip([k(1, { ...HOLD, lean: 22, ...Lt(.12, 1.2, .3, 0), hips: [0, -.12, .04] }), k(12, { ...HOLD, lean: 28, ...Lt(.06, 1.2, 1.08, 0), hips: [0, -.16, .2], turn: -44, footL: fl(0, .52) }, 'snap'),
      k(16, { ...HOLD, lean: 28, ...Lt(.06, 1.2, 1.06), hips: [0, -.16, .19], turn: -44, footL: fl(0, .52) }), k(46, {}, 'io')]) },
  pummel: { name: 'Knock Heads', total: 18, iasa: 16, hits: [h(6, 8, 'crown', .34, 3, 0, 0, 0, HEAD)],
    clip: clip([k(1, HOLD), k(4, { ...HOLD, head: [-24, 0, 0], chest: [-8, 0, 0], hips: [0, -.06, -.02] }, 'out'), k(6, { ...HOLD, head: [30, 0, 0], chest: [18, 0, 0], hips: [0, -.08, .12], lean: 16 }, 'snap'), k(18, HOLD, 'io')]) },
  fthrow: { name: 'Ring Out', total: 36, throw: { damage: 10, angle: 40, kb: [60, 55], release: 16 }, trail: FR([13, 18]),
    clip: clip([k(1, HOLD), k(10, { ...HOLD, turn: -46, hips: [0, -.08, -.06], ...Rf(-40, 44, 112) }, 'out'), k(15, { turn: 32, hips: [0, -.1, .14], lean: 14, ...Rt(.04, 1.3, 1.16), ...Lf(-20, 40, 70, 0) }, 'snap'), k(21, { turn: 36, hips: [0, -.1, .14], lean: 14, ...Rt(.16, 1.28, 1.08), ...Lf(-20, 40, 70) }), k(36, {}, 'io')]) },
  bthrow: { name: 'Over the Yoke', total: 42, throw: { damage: 11, angle: 45, kb: [65, 60], release: 20, turn: true },
    clip: clip([k(1, HOLD), k(8, { ...HOLD, hips: [0, -.1, -.06], lean: -6 }, 'out'), k(18, { ...HOLD, turn: -208, lean: -10, ...Lt(-.1, 1.4, -.8) }, 'in'), k(20, { ...HOLD, turn: -208, lean: -12, ...Lt(-.1, 1.5, -.9, 0) }), k(27, { turn: -382, ...Lf(40, 50, 30) }, 'lin'), k(42, { turn: -382 }, 'io')]) },
  uthrow: { name: 'Hoist', total: 34, throw: { damage: 9, angle: 88, kb: [65, 65], release: 14 },
    clip: clip([k(1, HOLD), k(7, { ...HOLD, hips: [0, -.26, .04], lean: 16, ...Lt(.1, 1.0, .7) }, 'out'), k(13, { hips: [0, .02, .04], lean: -6, stretch: .08, ...Lt(.1, 2.3, .3), ...Rt(-.1, 2.3, .3) }, 'snap'), k(16, { hips: [0, .02, .04], lean: -6, stretch: .06, ...Lt(.12, 2.3, .3, 0), ...Rt(-.12, 2.3, .3, 0) }), k(34, {}, 'io')]) },
  dthrow: { name: 'Flatten', total: 40, throw: { damage: 8, angle: 75, kb: [55, 40], release: 18 }, cues: [{ f: 18, kind: 'step', power: 1 }],
    clip: clip([k(1, HOLD), k(10, { ...HOLD, ...Lt(.1, 2.0, .4), hips: [0, -.02, 0], lean: -6 }, 'out'), k(17, { ...HOLD, ...Lt(.1, .4, .8), hips: [0, -.3, .12], lean: 28 }, 'snap'), k(21, { hips: [0, -.3, .12], lean: 28, ...Lt(.1, .42, .8, 0) }), k(40, {}, 'io')]) },
  // ── Getting back in ──
  ledgeattack: { name: 'Edge Hammer', total: 58, intangible: [[1, 20]], hits: [h(24, 28, 'fistR', .44, 9, 45, 42, 52, ARM)], trail: FR([21, 29]),
    clip: clip([k(1, LEDGE), k(13, { ...LEDGE, hips: [0, (LEDGE.hips?.[1] ?? -.5) * .6, .04], lean: 10, footL: fl(-.1, .2, 10) }, 'out'), k(20, { hips: [0, -.28, .04], lean: 16, ...Rf(-50, 40, 110), ...Lf(40, 30, 100) }, 'io'),
      k(24, { hips: [0, -.24, .14], lean: 24, turn: 30, ...Rt(.02, .9, 1.1), ...Lf(-20, 40, 70), footL: fl(0, .4) }, 'snap'), k(30, { hips: [0, -.24, .14], lean: 24, turn: 34, ...Rt(.12, .86, 1.04), ...Lf(-20, 40, 70), footL: fl(0, .4) }), k(58, {}, 'io')]) },
  getupattack: { name: 'Rising Toll', total: 56, intangible: [[1, 26]], hits: [h(21, 25, 'fistL', .44, 7, 45, 45, 42, ARM), h(27, 31, 'fistR', .44, 7, 45, 45, 42, { ...ARM, group: 1 })], trail: [FL([19, 26]), FR([25, 32])],
    clip: clip([k(1, DOWN), k(13, { spin: [-30, 0, 0], lift: -.3, hips: [0, -.24, 0], ...Lf(40, 40, 100), ...Rf(30, 40, 100) }, 'io'), k(21, { spin: [0, 0, 0], lift: 0, hips: [0, -.3, 0], lean: 10, turn: -70, ...Lt(.25, .6, 1.0), ...Rf(-30, 50, 90) }, 'snap'),
      k(27, { hips: [0, -.3, 0], lean: 4, turn: -78, ...Lt(.25, .62, .96), ...Rt(-.25, .6, -1.0) }, 'snap'), k(34, { hips: [0, -.29, 0], lean: 4, turn: -78, ...Lt(.25, .62, .96), ...Rt(-.25, .62, -.96) }), k(56, {}, 'io')], { drag: 0 }) },
  taunt: { name: 'Chime', total: 84, cues: [{ f: 22, kind: 'ring', at: 'furnace', power: .5 }, { f: 46, kind: 'ring', at: 'furnace', power: .5 }],
    clip: clip([k(1), k(12, { hips: [0, 0, 0], lean: -4, turn: -34, chest: [-6, 12, 0], head: [-8, 16, 0], ...Rf(40, 60, 100), ...Lf(20, 30, 60) }, 'out'), k(22, { hips: [0, -.03, 0], lean: 0, turn: -34, chest: [2, 12, 0], ...Rt(-.06, 1.2, .46), ...Lf(20, 30, 60) }, 'snap'),
      k(36, { hips: [0, 0, 0], lean: -4, turn: -34, chest: [-6, 12, 0], ...Rf(40, 60, 100), ...Lf(20, 30, 60) }, 'out'), k(46, { hips: [0, -.03, 0], lean: 0, turn: -34, chest: [2, 12, 0], ...Rt(-.06, 1.2, .46), ...Lf(20, 30, 60) }, 'snap'), k(66, { hips: [0, -.02, 0], turn: -34, ...Rt(-.06, 1.22, .45), ...Lf(20, 30, 60), face: [0, .6, .3] }), k(84, {}, 'io')]) },
};

// ── Specials ──────────────────────────────────────────────────────────────
const RAM: Pose = { lean: 36, hips: [0, -.2, .2], turn: -66, stretch: .05, ...Lf(10, 40, 116), ...Rf(-50, 40, 60), footL: fl(0, .56, -10), footR: fr(.1, -.6, 50) };
const LIFT: Pose = { hips: [0, .03, 0], stretch: .12, lean: -4, turn: -30, ...Rt(-.2, 2.35, .16), ...Lf(-20, 40, 30), head: [-20, 10, 0], footL: fl(.06, 0, 50), footR: fr(0, -.05, 55) };
export const SPECIALS = {
  nspecial: {
    '': { name: 'Knell', total: 56, cues: [{ f: 17, kind: 'ring' as const, at: 'furnace', power: 1.6 }, { f: 17, kind: 'step' as const, power: .8 }],
      clip: clip([k(1), k(10, { hips: [0, -.03, 0], lean: -10, turn: -30, chest: [-14, 0, 0], stretch: .04, ...Lf(10, 86, 20, .6), ...Rf(10, 86, 20, .6) }, 'out'), k(15, { hips: [0, -.02, 0], lean: -12, turn: -30, chest: [-16, 0, 0], stretch: .05, ...Lf(4, 92, 16, .9), ...Rf(4, 92, 16, .9) }, 'out'),
        k(17, { hips: [0, -.14, .04], lean: 10, turn: -30, chest: [10, 0, 0], stretch: -.06, ...Lt(.14, 1.2, .46), ...Rt(-.14, 1.2, .46), face: [0, -1, .9] }, 'snap'),
        k(34, { hips: [0, -.13, .04], lean: 9, turn: -30, chest: [9, 0, 0], stretch: -.04, ...Lt(.14, 1.21, .45), ...Rt(-.14, 1.21, .45), face: [0, -.6, .5] }), k(56, {}, 'io')]) },
  },
  sspecial: {
    Start: { name: 'Ram', total: 14, clip: clip([k(1), k(12, { hips: [0, -.2, -.1], lean: 10, turn: -56, stretch: -.05, ...Lf(30, 20, 122), ...Rf(-30, 40, 80), footL: fl(.06, .2) }, 'out'), k(14, { hips: [0, -.21, -.11], lean: 10, turn: -56, stretch: -.06, ...Lf(30, 20, 122), ...Rf(-30, 40, 80), footL: fl(.06, .2) })]) },
    '': { name: 'Ram', total: 36, hits: [h(3, 22, 'shoulderL', .52, 14, 42, 55, 72, BODY), h(3, 22, 'belly', .42, 12, 42, 50, 68, BODY)], cues: [{ f: 2, kind: 'step' as const, power: 1 }, { f: 12, kind: 'step' as const, power: .8 }],
      clip: clip([k(1, { hips: [0, -.2, -.1], lean: 10, turn: -56, ...Lf(30, 20, 122), ...Rf(-30, 40, 80) }), k(4, RAM, 'snap'), k(13, { ...RAM, footL: fl(.1, -.5, 50), footR: fr(0, .56, -10) }, 'lin'), k(22, RAM, 'lin'), k(36, { lean: 10, hips: [0, -.14, 0] }, 'io')], { drag: 0 }) },
  },
  uspecial: {
    '': { name: 'Steam Hoist', total: 52, hits: [h(9, 14, 'fistR', .48, 12, 82, 60, 62, ARM), h(14, 34, 'fistR', .42, 6, 80, 40, 50, { ...ARM, group: 1 })], trail: FR([8, 34]), cues: [{ f: 9, kind: 'burst' as const, power: 1.1 }, { f: 9, kind: 'step' as const, power: 1 }],
      clip: clip([k(1, { hips: [0, -.22, 0], lean: 12, stretch: -.08, ...Lf(30, 30, 110), ...Rf(30, 30, 110) }), k(8, { hips: [0, -.3, 0], lean: 14, stretch: -.12, ...Lf(30, 30, 114), ...Rf(-20, 40, 110) }, 'out'), k(10, LIFT, 'snap'),
        k(34, { ...LIFT, ...Rt(-.2, 2.33, .16), footL: fl(.08, .02, 52) }), k(52, fallTo, 'io')]) },
  },
  dspecial: {
    Start: { name: 'Bell Drop', total: 16, cues: [{ f: 2, kind: 'step' as const, power: .8 }], clip: clip([k(1, { hips: [0, -.24, 0], lean: 12, stretch: -.1 }), k(5, { hips: [0, .02, 0], stretch: .1, ...Lf(120, 30, 40), ...Rf(120, 30, 40) }, 'snap'), k(16, BELL, 'io')]) },
    Stall: { name: 'Bell Drop', total: 10, clip: clip([k(1, { ...AIR, stretch: .06, ...Lf(120, 30, 40), ...Rf(120, 30, 40) }), k(10, BELL, 'io')]) },
    Fall: { name: 'Bell Drop', total: 90, hits: [h(1, 90, 'belly', .6, 15, 285, 30, 72, BODY), h(1, 90, 'footL', .42, 13, 285, 28, 68, BODY)], clip: clip([k(1, BELL), k(90, BELL)], { drag: 0 }) },
    Land: { name: 'Bell Drop', total: 36, cues: [{ f: 1, kind: 'ring' as const, power: 1.5 }, { f: 1, kind: 'step' as const, power: 1 }],
      clip: clip([k(1, { hips: [0, -.34, 0], stretch: -.16, lean: 10, ...Lf(20, 50, 60), ...Rf(20, 50, 60) }), k(10, { hips: [0, -.26, 0], stretch: -.06, lean: 12, ...Lf(20, 50, 60), ...Rf(20, 50, 60) }, 'out'), k(36, {}, 'back')]) },
  },
} satisfies Record<string, Record<string, CrewMove>>;

/** Phase flow, movement and armour for the four specials. */
export const KIT: Kit = {
  // Knell: he strikes his own bell and the ring throws back everyone near him. Armoured through the wind-up.
  n: { start: '', phases: { '': { armor: [6, 20], hits: [hit(17, 24, 13, 50, 55, 72, 0, 1.0, 1.35)], motion: [{ brake: .8, gravity: .6 }] } } },
  // Ram: shoulder down, then an armoured charge that carries on through whoever is in the way. Once per airtime.
  s: { start: 'Start', once: true, lag: 14, phases: { Start: { next: '', armor: [4, 14], motion: [{ brake: .7, gravity: .5 }] }, '': { armor: [0, 22], motion: [{ from: 0, to: 20, vx: .165, gravity: .35 }, { from: 20, brake: .86 }] } } },
  // Steam Hoist: a squat, a blast of steam, and the whole bell goes up fist first.
  hi: { start: '', helpless: true, lag: 20, once: true, phases: { '': { armor: [3, 12], motion: rise(9, 34, .152, .0024, .018), ledge: 16 } } },
  // Bell Drop: a hop (or a pause in the air), then he pulls everything in and falls like the bell he is. The landing rings both sides.
  lw: { start: 'Start', air: 'Stall', phases: {
    Start: { next: 'Fall', motion: [{ from: 0, to: 1, vx: 0, vy: .15 }, { from: 1, gravity: .5 }] }, Stall: { next: 'Fall', motion: [{ ...still }] },
    Fall: { land: 'Land', armor: [0, 999], motion: [{ vx: 0, vy: -.36, gravity: 0 }] }, Land: { hits: [hit(0, 6, 9, 70, 45, 60, .95, .35, .6), hit(0, 6, 9, 110, 45, 60, -.95, .35, .6)] } } },
};
