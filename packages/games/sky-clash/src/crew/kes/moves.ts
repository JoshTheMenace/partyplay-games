/**
 * Kes's moveset: frame data, hitboxes riding hands, knees and feet, and one keyframed clip per move, all authored for him.
 * Shape language: short wind-ups, long lines through the kicking leg, the hips thrown back for balance. Fast, light, easy to launch.
 */
import type { Pose } from '../../anim/core';
import type { MoveId } from '../../model';
import { hit, rise, shot, still, type Kit } from '../../specials/types';
import { clipOn, h, k, trail } from '../lib';
import type { CrewMove } from '../types';
import { LEDGE, Lf, Lt, Rf, Rt, STANCE, STATES, fl, fr } from './states';

const clip = clipOn(STANCE), MINT = '#8ff0d0', KR = trail('footR', 'kneeR', MINT, .8), KL = trail('footL', 'kneeL', MINT, .8);
const AIR: Pose = { hips: [0, .02, 0], footL: fl(.2, .12, 35), footR: fr(.08, -.1, 50) }, fallTo: Pose = { ...AIR, lean: 6, ...Lf(102, 72, 18, .1), ...Rf(96, 76, 18, .1) };
const DOWN = STATES.knockdown.keys[STATES.knockdown.keys.length - 1]!.p, HOLD: Pose = { hips: [0, -.07, .04], lean: 8, turn: -12, ...Lt(.06, 1.14, .5, 1), ...Rf(20, 30, 92) };
const HAND = { limb: 'handL' as const }, FOOT = { limb: 'footR' as const }, BODY = { limb: 'body' as const };
/** Arms thrown out for balance behind a kick. */
const BAL: Pose = { ...Lf(92, 52, 46, .2), ...Rf(-52, 60, 28, .2) };

export const MOVES: Partial<Record<MoveId, CrewMove>> = {
  // ── Jab: two palm flicks and a snap kick ──
  jab1: { name: 'Flick', total: 14, iasa: 12, followup: 5, hits: [h(3, 5, 'handL', .23, 2, 70, 14, 20, HAND)],
    clip: clip([k(1, { ...Lf(62, 20, 122) }), k(3, { turn: -48, hips: [0, -.06, .05], ...Lt(.12, 1.22, .64, 0) }, 'snap'), k(6, { turn: -48, hips: [0, -.06, .06], ...Lt(.12, 1.22, .65, 0) }), k(14, {}, 'io')]) },
  jab2: { name: 'Flick', total: 16, iasa: 13, followup: 6, hits: [h(3, 5, 'handR', .23, 2, 70, 14, 20, HAND)],
    clip: clip([k(1, { ...Rf(22, 30, 122) }), k(3, { turn: 8, hips: [0, -.06, .08], chest: [4, 22, 0], ...Rt(-.04, 1.2, .68, 0), ...Lf(30, 30, 122) }, 'snap'), k(6, { turn: 10, hips: [0, -.06, .09], chest: [4, 22, 0], ...Rt(-.04, 1.2, .69, 0), ...Lf(30, 30, 122) }), k(16, {}, 'io')]) },
  jab3: { name: 'Snap Kick', total: 26, iasa: 23, hits: [h(5, 8, 'footR', .29, 4, 50, 45, 55, FOOT)], trail: KR([4, 8]),
    clip: clip([k(1, { hips: [0, -.04, -.04], footR: fr(.3, .1, 20) }), k(4, { hips: [0, -.03, -.08], lean: -10, turn: -6, footR: fr(.52, .25, 40), ...BAL }, 'out'),
      k(5, { hips: [0, -.02, -.1], lean: -16, turn: 8, footR: [.02, .86, .82, -50, 0], ...BAL }, 'snap'), k(9, { hips: [0, -.02, -.1], lean: -16, turn: 8, footR: [.02, .86, .84, -50, 0], ...BAL }), k(26, {}, 'io')]) },
  // ── Tilts ──
  ftilt: { name: 'Crescent', total: 26, iasa: 23, hits: [h(6, 9, 'footR', .31, 8, 38, 30, 70, FOOT)], trail: KR([5, 10]),
    clip: clip([k(1, { turn: -50, hips: [0, -.05, -.04], footR: fr(.2, -.22, 30), ...Lf(60, 30, 100), ...Rf(30, 40, 92) }), k(4, { turn: -66, lean: -6, hips: [0, -.05, -.06], footR: [-.3, .5, -.1, 20, 60], ...Lf(60, 30, 100), ...Rf(40, 46, 90) }, 'out'),
      k(6, { turn: 52, lean: -18, hips: [0, -.02, -.1], chest: [0, -20, 0], head: [0, -30, 0], footR: [.1, .95, .8, -40, -20], ...BAL }, 'snap'),
      k(10, { turn: 74, lean: -16, hips: [0, -.02, -.1], chest: [0, -24, 0], head: [0, -40, 0], footR: [.32, .9, .58, -40, -20], ...BAL }, 'out'), k(26, {}, 'io')]) },
  utilt: { name: 'Skyhook', total: 24, iasa: 21, hits: [h(5, 9, 'footR', .31, 7, 92, 30, 72, FOOT)], trail: KR([4, 9]),
    clip: clip([k(1, { hips: [0, -.1, 0], footR: fr(.1, 0, 10) }), k(4, { hips: [0, -.15, 0], lean: 8, footR: fr(.2, .05, 20) }, 'out'),
      k(5, { hips: [0, .02, -.06], lean: -22, stretch: .05, head: [-22, 10, 0], footR: [0, 1.46, .3, -80, 0], ...Lf(40, 54, 60, .2), ...Rf(-30, 60, 30, .2) }, 'snap'),
      k(9, { hips: [0, .02, -.06], lean: -22, stretch: .04, head: [-22, 10, 0], footR: [0, 1.48, .26, -80, 0], ...Lf(40, 54, 60, .2), ...Rf(-30, 60, 30, .2) }), k(24, {}, 'io')]) },
  dtilt: { name: 'Low Sweep', total: 20, iasa: 17, hits: [h(5, 8, 'footR', .27, 6, 78, 25, 50, FOOT)], trail: KR([4, 8]),
    clip: clip([k(1, { hips: [0, -.34, 0], lean: 14, ...Lf(40, 40, 100) }), k(4, { hips: [0, -.4, -.04], lean: 10, turn: -52, footR: fr(.05, -.32, 10), ...Lf(30, 40, 60), ...Rf(40, 40, 100) }, 'out'),
      k(5, { hips: [0, -.43, -.06], lean: 2, turn: 30, footR: [.06, .08, .94, -30, 0], ...Lf(-10, 40, 30, .2), ...Rf(-30, 50, 40, .2) }, 'snap'), k(8, { hips: [0, -.43, -.06], lean: 2, turn: 44, footR: [.2, .08, .86, -30, 0], ...Lf(-10, 40, 30, .2), ...Rf(-30, 50, 40, .2) }, 'out'), k(20, {}, 'io')]) },
  dash: { name: 'Slipstream', total: 34, iasa: 30, hits: [h(5, 9, 'footL', .31, 8, 62, 50, 45, FOOT), h(9, 13, 'footL', .28, 6, 70, 35, 40, FOOT)], trail: KL([4, 13]), cues: [{ f: 5, kind: 'step', power: .8 }],
    clip: clip([k(1, { lean: 20, hips: [0, -.2, 0] }), k(5, { hips: [0, -.52, .1], lean: -30, turn: -10, stretch: .04, footL: [.03, .06, .72, -30, 8], footR: fr(0, -.1, 30), ...Lf(-20, 40, 30, .2), ...Rf(-40, 50, 30, .2) }, 'snap'),
      k(14, { hips: [0, -.52, .1], lean: -30, turn: -10, footL: [.03, .06, .72, -30, 8], footR: fr(0, -.1, 30), ...Lf(-20, 40, 30, .2), ...Rf(-40, 50, 30, .2) }), k(34, {}, 'io')]) },
  // ── Smashes ──
  fsmash: { name: 'Gale Kick', total: 44, iasa: 40, charge: 5, hits: [h(13, 16, 'footR', .35, 14, 40, 28, 94, FOOT), h(13, 16, 'kneeR', .27, 10, 40, 26, 88, FOOT)], trail: KR([11, 17]),
    cues: [{ f: 13, kind: 'swish', at: 'footR', power: 1 }],
    clip: clip([k(1, { turn: -44, hips: [0, -.08, -.06], footR: fr(.15, -.25, 30) }), k(5, { turn: -72, hips: [0, -.12, -.14], lean: 10, chest: [6, -20, 0], stretch: -.03, footR: [-.25, .55, -.3, 20, 70], ...Lf(70, 30, 100), ...Rf(60, 40, 110) }, 'out'),
      k(11, { turn: -78, hips: [0, -.14, -.16], lean: 12, chest: [6, -24, 0], stretch: -.04, footR: [-.27, .58, -.34, 20, 70], ...Lf(74, 30, 100), ...Rf(64, 40, 110) }, 'out'),
      k(13, { turn: 60, hips: [0, -.02, .1], lean: -26, chest: [-6, 10, 0], head: [0, -36, 0], stretch: .06, footR: [.08, .98, 1.0, -30, -40], footL: fl(0, .12, -10), ...Lf(112, 60, 30, 0), ...Rf(-60, 70, 20, 0), face: [0, -1, .8] }, 'snap'),
      k(18, { turn: 64, hips: [0, -.02, .1], lean: -26, chest: [-6, 10, 0], head: [0, -36, 0], stretch: .05, footR: [.1, .98, 1.0, -30, -40], footL: fl(0, .12, -10), ...Lf(112, 60, 30, 0), ...Rf(-60, 70, 20, 0), face: [0, -1, .8] }),
      k(28, { turn: 30, hips: [0, -.08, 0], lean: -6, footR: fr(.3, .2, 20), ...Lf(80, 40, 60), ...Rf(-20, 50, 50) }, 'io'), k(44, {}, 'io')]) },
  usmash: { name: 'Windmill', total: 44, iasa: 40, charge: 4, hits: [h(10, 16, 'footR', .35, 13, 88, 35, 92, FOOT), h(10, 16, 'footL', .3, 11, 88, 32, 88, FOOT)], trail: [KR([9, 18]), KL([9, 18])], cues: [{ f: 10, kind: 'swish', at: 'footR', power: .8 }],
    clip: clip([k(1, { hips: [0, -.2, 0], lean: 14, stretch: -.06 }), k(8, { hips: [0, -.3, 0], lean: 20, stretch: -.1, ...Lf(-30, 40, 40), ...Rf(-30, 40, 40) }, 'out'),
      k(11, { spin: [-95, 0, 0], lift: .32, hips: [0, 0, 0], lean: 0, stretch: .08, footL: fl(0, .1, -30), footR: fr(-.05, .1, -30), ...Lf(150, 30, 10, .2), ...Rf(150, 30, 10, .2) }, 'snap'),
      k(16, { spin: [-200, 0, 0], lift: .5, hips: [0, 0, 0], lean: 0, stretch: .06, footL: fl(.1, .2, -20), footR: fr(-.05, .0, -30), ...Lf(150, 30, 10, .2), ...Rf(150, 30, 10, .2) }, 'lin'),
      k(26, { spin: [-360, 0, 0], lift: 0, hips: [0, -.24, 0], lean: 12, stretch: -.06 }, 'out'), k(44, { spin: [-360, 0, 0] }, 'io')], { drag: 0 }) },
  dsmash: { name: 'Split', total: 40, iasa: 36, charge: 4, hits: [h(8, 11, 'footL', .33, 12, 25, 35, 80, FOOT), h(8, 11, 'footR', .33, 12, 25, 35, 80, FOOT)], trail: [KL([6, 11]), KR([6, 11])], cues: [{ f: 8, kind: 'step', power: 1 }],
    clip: clip([k(1, { hips: [0, -.2, 0] }), k(6, { hips: [0, -.1, 0], stretch: .04, lean: -4, ...Lf(152, 30, 20, .2), ...Rf(152, 30, 20, .2), footL: fl(.1, .1), footR: fr(.1, -.1) }, 'out'),
      k(8, { hips: [0, -.62, 0], lean: 6, turn: -80, stretch: -.06, footL: [.03, .02, .95, -20, 8], footR: [-.04, .02, -.95, 20, 40], ...Lf(40, 82, 10, 0), ...Rf(40, 82, 10, 0) }, 'snap'),
      k(13, { hips: [0, -.62, 0], lean: 6, turn: -80, stretch: -.05, footL: [.03, .02, .95, -20, 8], footR: [-.04, .02, -.95, 20, 40], ...Lf(40, 82, 10, 0), ...Rf(40, 82, 10, 0) }), k(40, {}, 'io')]) },
  // ── Aerials ──
  nair: { name: 'Pinwheel', total: 34, landingLag: 8, autoCancel: [3, 26], hits: [h(4, 12, 'footR', .31, 7, 45, 20, 75, FOOT), h(12, 22, 'footR', .28, 4, 45, 12, 60, { ...FOOT, group: 1 })], trail: KR([3, 22]),
    clip: clip([k(1, { ...AIR }), k(4, { ...AIR, lean: -20, turn: -34, footR: [0, .4, .72, -30, 0], footL: fl(.3, -.1, 40), ...Lf(60, 70, 20, .2), ...Rf(60, 70, 20, .2) }, 'snap'),
      k(22, { ...AIR, lean: -20, turn: -754, footR: [0, .4, .72, -30, 0], footL: fl(.3, -.1, 40), ...Lf(60, 70, 20, .2), ...Rf(60, 70, 20, .2) }, 'lin'), k(34, { ...fallTo, turn: -754 }, 'io')], { drag: 0 }) },
  fair: { name: 'Scissor', total: 30, landingLag: 10, autoCancel: [4, 24], hits: [h(6, 9, 'footL', .3, 6, 50, 20, 40, FOOT), h(10, 13, 'footR', .33, 8, 42, 25, 85, { ...FOOT, group: 1 })], trail: [KL([5, 9]), KR([9, 14])],
    clip: clip([k(1, { ...AIR, lean: -6 }), k(5, { ...AIR, lean: -16, footL: [.03, .5, .2, 10, 8] }, 'out'), k(6, { ...AIR, lean: -24, footL: [.03, .75, .8, -40, 8], footR: fr(.1, -.3, 60), ...BAL }, 'snap'),
      k(9, { ...AIR, lean: -24, footL: [.03, .75, .8, -40, 8], footR: fr(.1, -.3, 60), ...BAL }), k(10, { ...AIR, lean: -12, turn: 14, footR: [-.04, .8, .84, -40, 0], footL: fl(.1, -.3, 60), ...BAL }, 'snap'),
      k(14, { ...AIR, lean: -12, turn: 16, footR: [-.04, .8, .84, -40, 0], footL: fl(.1, -.3, 60), ...BAL }), k(30, fallTo, 'io')]) },
  bair: { name: 'Heel', total: 28, landingLag: 10, autoCancel: [4, 22], hits: [h(6, 9, 'footR', .33, 10, 40, 25, 92, FOOT)], trail: KR([5, 10]),
    clip: clip([k(1, { ...AIR }), k(5, { ...AIR, lean: 14, footR: fr(.3, .2, 20) }, 'out'), k(6, { ...AIR, lean: 36, turn: -10, head: [0, -40, 0], footR: [-.04, .55, -.92, 60, 40], ...Lf(100, 40, 30, .2), ...Rf(80, 50, 30, .2) }, 'snap'),
      k(10, { ...AIR, lean: 36, turn: -10, head: [0, -40, 0], footR: [-.04, .55, -.94, 60, 40], ...Lf(100, 40, 30, .2), ...Rf(80, 50, 30, .2) }), k(28, fallTo, 'io')]) },
  uair: { name: 'Bicycle', total: 26, landingLag: 8, autoCancel: [3, 20], hits: [h(4, 8, 'footL', .3, 5, 85, 25, 60, FOOT), h(8, 12, 'footR', .31, 6, 88, 25, 80, { ...FOOT, group: 1 })], trail: [KL([3, 8]), KR([7, 12])],
    clip: clip([k(1, AIR), k(4, { ...AIR, lean: -30, footL: [.03, 1.3, .3, -70, 8], footR: fr(.2, .1, 20), ...Lf(20, 60, 20, .2), ...Rf(20, 60, 20, .2) }, 'snap'),
      k(8, { ...AIR, lean: -36, footR: [-.04, 1.35, .3, -70, 0], footL: fl(.3, .1, 20), ...Lf(20, 60, 20, .2), ...Rf(20, 60, 20, .2) }, 'snap'), k(12, { ...AIR, lean: -36, footR: [-.04, 1.35, .26, -70, 0], footL: fl(.3, .1, 20), ...Lf(20, 60, 20, .2), ...Rf(20, 60, 20, .2) }), k(26, fallTo, 'io')]) },
  dair: { name: 'Stoop', total: 36, landingLag: 16, autoCancel: [5, 28], hits: [h(8, 12, 'footR', .31, 9, 285, 15, 70, FOOT), h(12, 22, 'footR', .28, 6, 60, 15, 55, { ...FOOT, group: 1 })], trail: KR([7, 22]),
    clip: clip([k(1, AIR), k(7, { ...AIR, hips: [0, .06, 0], stretch: -.05, footR: fr(.4, .1, 10), footL: fl(.4, .15, 10) }, 'out'),
      k(8, { ...AIR, lean: 10, stretch: .08, footR: [-.04, -.1, .25, 60, 0], footL: fl(.3, -.1, 40), ...Lf(140, 40, 20, .2), ...Rf(120, 50, 20, .2) }, 'snap'), k(22, { ...AIR, lean: 10, stretch: .06, footR: [-.04, -.1, .25, 60, 0], footL: fl(.3, -.1, 40), ...Lf(140, 40, 20, .2), ...Rf(120, 50, 20, .2) }), k(36, fallTo, 'io')]) },
  // ── Grab and throws ──
  grab: { name: 'Snatch', total: 28, hits: [h(6, 8, 'handL', .29, 0, 0, 0, 0)],
    clip: clip([k(1, { ...HOLD, ...Lt(.06, 1.14, .25, 0), hips: [0, -.07, -.02] }), k(6, { ...HOLD, ...Lt(.04, 1.14, .74, 0), hips: [0, -.08, .1], lean: 12, turn: -46 }, 'snap'), k(8, { ...HOLD, ...Lt(.04, 1.14, .72, 1), hips: [0, -.08, .09], lean: 12, turn: -46 }), k(28, {}, 'io')]) },
  dashgrab: { name: 'Running Snatch', total: 36, hits: [h(8, 11, 'handL', .31, 0, 0, 0, 0)],
    clip: clip([k(1, { ...HOLD, lean: 22, ...Lt(.06, 1.04, .25, 0), hips: [0, -.14, .04] }), k(8, { ...HOLD, lean: 28, ...Lt(.04, 1.04, .8, 0), hips: [0, -.18, .2], turn: -46, footL: fl(0, .5) }, 'snap'),
      k(12, { ...HOLD, lean: 28, ...Lt(.04, 1.04, .78, 1), hips: [0, -.18, .19], turn: -46, footL: fl(0, .5) }), k(36, {}, 'io')]) },
  pummel: { name: 'Knee', total: 14, iasa: 12, hits: [h(4, 6, 'kneeR', .29, 1.5, 0, 0, 0, FOOT)],
    clip: clip([k(1, HOLD), k(3, { ...HOLD, footR: fr(.1, -.24, 30) }, 'out'), k(4, { ...HOLD, footR: [-.02, .5, .4, 50, 0], hips: [0, -.06, .1] }, 'snap'), k(14, HOLD, 'io')]) },
  fthrow: { name: 'Send Off', total: 28, throw: { damage: 6, angle: 42, kb: [50, 50], release: 12 }, trail: KR([9, 13]),
    clip: clip([k(1, HOLD), k(8, { ...HOLD, hips: [0, -.06, -.06], footR: fr(.4, .1, 30) }, 'out'), k(11, { hips: [0, -.02, -.08], lean: -16, turn: 8, footR: [.02, .8, .86, -40, 0], ...BAL }, 'snap'), k(15, { hips: [0, -.02, -.08], lean: -16, turn: 8, footR: [.02, .8, .88, -40, 0], ...BAL }), k(28, {}, 'io')]) },
  bthrow: { name: 'Turnabout', total: 34, throw: { damage: 8, angle: 45, kb: [55, 62], release: 16, turn: true },
    clip: clip([k(1, HOLD), k(7, { ...HOLD, hips: [0, -.1, -.06], lean: -6 }, 'out'), k(14, { ...HOLD, turn: -214, lean: -12, ...Lt(-.06, 1.2, -.6, 1) }, 'in'), k(16, { ...HOLD, turn: -214, lean: -12, ...Lt(-.06, 1.24, -.66, 0) }), k(22, { turn: -394, ...Lf(40, 50, 30) }, 'lin'), k(34, { turn: -394 }, 'io')]) },
  uthrow: { name: 'Updraft', total: 26, throw: { damage: 6, angle: 90, kb: [55, 60], release: 10 },
    clip: clip([k(1, HOLD), k(6, { ...HOLD, hips: [0, -.26, .04], lean: 16, ...Lt(.06, .9, .5, 1) }, 'out'), k(9, { hips: [0, .02, .02], lean: -6, stretch: .08, ...Lt(.05, 1.68, .3, 0), ...Rt(-.05, 1.68, .3, 0) }, 'snap'), k(12, { hips: [0, .02, .02], lean: -6, stretch: .06, ...Lt(.05, 1.68, .3, 0), ...Rt(-.05, 1.68, .3, 0) }), k(26, {}, 'io')]) },
  dthrow: { name: 'Pin', total: 30, throw: { damage: 5, angle: 80, kb: [50, 35], release: 14 }, cues: [{ f: 14, kind: 'step', power: .8 }],
    clip: clip([k(1, HOLD), k(8, { ...HOLD, ...Lt(.06, 1.4, .4, 1), hips: [0, -.03, 0], lean: -4 }, 'out'), k(13, { ...HOLD, ...Lt(.06, .4, .5, 1), hips: [0, -.3, .1], lean: 26 }, 'snap'), k(16, { hips: [0, -.3, .1], lean: 26, ...Lt(.06, .42, .5, 0) }), k(30, {}, 'io')]) },
  // ── Getting back in ──
  ledgeattack: { name: 'Edge Kick', total: 50, intangible: [[1, 16]], hits: [h(18, 22, 'footR', .29, 7, 45, 40, 50, FOOT)], trail: KR([16, 23]),
    clip: clip([k(1, LEDGE), k(11, { ...LEDGE, hips: [0, (LEDGE.hips?.[1] ?? -.5) * .6, .04], lean: 10, footL: fl(-.1, .2, 10) }, 'out'), k(16, { hips: [0, -.3, .04], lean: 16, footR: fr(.2, -.1, 20) }, 'io'),
      k(18, { hips: [0, -.34, .1], lean: -10, footR: [.02, .1, .92, -30, 0], ...BAL }, 'snap'), k(23, { hips: [0, -.34, .1], lean: -10, footR: [.02, .1, .94, -30, 0], ...BAL }), k(50, {}, 'io')]) },
  getupattack: { name: 'Rising Split', total: 46, intangible: [[1, 22]], hits: [h(16, 20, 'footL', .31, 6, 45, 45, 40, FOOT), h(22, 26, 'footR', .31, 6, 45, 45, 40, { ...FOOT, group: 1 })], trail: [KL([14, 21]), KR([20, 27])],
    clip: clip([k(1, DOWN), k(10, { spin: [-30, 0, 0], lift: -.3, hips: [0, -.3, 0] }, 'io'), k(16, { spin: [0, 0, 0], lift: 0, hips: [0, -.52, 0], turn: -80, footL: [.03, .02, .92, -20, 8], ...Lf(40, 60, 30, .2), ...Rf(40, 60, 30, .2) }, 'snap'),
      k(22, { hips: [0, -.52, 0], turn: -80, footL: [.03, .02, .92, -20, 8], footR: [-.04, .02, -.92, 20, 40], ...Lf(40, 60, 30, .2), ...Rf(40, 60, 30, .2) }, 'snap'), k(28, { hips: [0, -.5, 0], turn: -80, footL: [.03, .02, .9, -20, 8], footR: [-.04, .02, -.9, 20, 40] }), k(46, {}, 'io')], { drag: 0 }) },
  taunt: { name: 'Catch the Wind', total: 64, cues: [{ f: 14, kind: 'swish', at: 'bead', power: .5 }],
    clip: clip([k(1), k(12, { hips: [0, 0, 0], lean: -4, turn: -52, footR: fr(.42, .1, 30), ...Lf(20, 86, 5, 0), ...Rf(20, 86, 5, 0), head: [-10, 20, 0], face: [0, .8, .4] }, 'back'),
      k(30, { hips: [0, -.01, 0], lean: -6, turn: -52, roll: 5, footR: fr(.44, .12, 30), ...Lf(26, 86, 5, 0), ...Rf(14, 86, 5, 0), head: [-10, 20, 0], face: [0, .8, .4] }),
      k(46, { hips: [0, -.01, 0], lean: -3, turn: -52, roll: -4, footR: fr(.42, .08, 30), ...Lf(15, 86, 5, 0), ...Rf(25, 86, 5, 0), head: [-10, 20, 0], face: [0, .8, .5] }), k(64, {}, 'io')]) },
};

// ── Specials ──────────────────────────────────────────────────────────────
const DART = [k(1), k(5, { turn: -60, hips: [0, -.08, -.06], chest: [0, -14, 0], ...Lf(40, 40, 132), ...Rf(-40, 50, 60) }, 'out'), k(9, { turn: -20, hips: [0, -.06, .1], lean: 12, chest: [4, 10, 0], ...Lt(.1, 1.1, .78, 0), ...Rf(-60, 60, 20, 0) }, 'snap'),
  k(14, { turn: -18, hips: [0, -.06, .1], lean: 12, chest: [4, 10, 0], ...Lt(.1, 1.1, .8, 0), ...Rf(-60, 60, 20, 0) }), k(30, {}, 'io')];
const ZIP: Pose = { lean: 50, hips: [0, -.2, .2], turn: -40, stretch: .1, head: [-40, 10, 0], ...Lf(-72, 26, 8, 0), ...Rf(-62, 30, 8, 0), footL: fl(0, .5, -10), footR: fr(.3, -.62, 70) };
const HANG: Pose = { hips: [0, .03, 0], stretch: .12, lean: -6, turn: -30, head: [-24, 10, 0], ...Lt(.12, 1.74, .1, 1), ...Rt(-.12, 1.74, .1, 1), footL: fl(.1, .05, 50), footR: fr(0, -.08, 60) };
export const SPECIALS = {
  nspecial: {
    '': { name: 'Gale Dart', total: 30, shots: [9], cues: [{ f: 9, kind: 'swish' as const, at: 'handL', power: .5 }], clip: clip(DART) },
    Air: { name: 'Gale Dart', total: 30, shots: [9], cues: [{ f: 9, kind: 'swish' as const, at: 'handL', power: .5 }], clip: clip(DART.map(key => ({ ...key, p: { ...AIR, ...key.p } }))) },
  },
  sspecial: {
    Start: { name: 'Tailwind', total: 6, clip: clip([k(1), k(5, { hips: [0, -.22, -.1], lean: 20, turn: -50, stretch: -.06, ...Lf(-40, 30, 60), ...Rf(-50, 35, 60) }, 'out'), k(6, { hips: [0, -.23, -.1], lean: 20, turn: -50, stretch: -.07, ...Lf(-40, 30, 60), ...Rf(-50, 35, 60) })]) },
    '': { name: 'Tailwind', total: 30, intangible: [[1, 9]], hits: [h(2, 12, 'crown', .32, 8, 62, 45, 60, BODY), h(2, 12, 'footL', .3, 8, 62, 45, 60, BODY)], cues: [{ f: 2, kind: 'swish' as const, at: 'bead', power: 1 }],
      clip: clip([k(1, { hips: [0, -.22, -.1], lean: 20, turn: -50 }), k(3, ZIP, 'snap'), k(12, ZIP), k(20, { lean: -6, hips: [0, -.3, 0], footL: fl(0, .4), footR: fr(0, -.3, 20), ...Lf(60, 40, 60), ...Rf(40, 50, 60) }, 'out'), k(30, {}, 'io')], { drag: 0 }) },
  },
  uspecial: {
    '': { name: 'Kite Lift', total: 56, hits: [h(5, 10, 'handR', .36, 6, 88, 50, 60, HAND), h(10, 44, 'crown', .3, 3, 90, 30, 30, { ...BODY, group: 1 })], cues: [{ f: 5, kind: 'swish' as const, at: 'kiteTop', power: 1.2 }, { f: 5, kind: 'step' as const, power: .7 }],
      clip: clip([k(1, { hips: [0, -.22, 0], lean: 10, stretch: -.08, ...Lf(30, 30, 100), ...Rf(30, 30, 100) }), k(4, { hips: [0, -.28, 0], lean: 12, stretch: -.1, ...Lf(30, 30, 104), ...Rf(30, 30, 104) }, 'out'), k(6, HANG, 'snap'),
        k(26, { ...HANG, lean: 4, footL: fl(.06, -.08, 55), footR: fr(.06, .04, 50) }), k(46, { ...HANG, lean: -8, footL: fl(.1, .08, 50), footR: fr(0, -.1, 60) }), k(56, fallTo, 'io')]) },
  },
  dspecial: {
    '': { name: 'Downdraft', total: 40, cues: [{ f: 8, kind: 'swish' as const, power: 1.4 }, { f: 8, kind: 'step' as const, power: 1 }],
      clip: clip([k(1), k(6, { hips: [0, .02, 0], stretch: .06, lean: -6, ...Lf(162, 30, 10, 0), ...Rf(162, 30, 10, 0) }, 'out'), k(8, { hips: [0, -.34, 0], lean: 10, turn: -394, stretch: -.08, ...Lf(40, 82, 10, 0), ...Rf(40, 82, 10, 0) }, 'snap'),
        k(16, { hips: [0, -.33, 0], lean: 10, turn: -394, stretch: -.06, ...Lf(40, 82, 10, 0), ...Rf(40, 82, 10, 0) }), k(40, { turn: -394 }, 'io')], { drag: 0 }) },
    Air: { name: 'Downdraft', total: 40, cues: [{ f: 8, kind: 'swish' as const, at: 'footR', power: 1.2 }],
      clip: clip([k(1, AIR), k(7, { ...AIR, stretch: -.06, footL: fl(.4, .1, 10), footR: fr(.4, 0, 10), ...Lf(150, 30, 20, .2), ...Rf(150, 30, 20, .2) }, 'out'),
        k(8, { ...AIR, stretch: .1, footL: [.03, -.06, .05, 60, 8], footR: [-.04, -.06, -.05, 60, 40], ...Lf(60, 86, 5, 0), ...Rf(60, 86, 5, 0) }, 'snap'), k(18, { ...AIR, stretch: .06, footL: [.03, -.06, .05, 60, 8], footR: [-.04, -.06, -.05, 60, 40], ...Lf(60, 86, 5, 0), ...Rf(60, 86, 5, 0) }), k(40, fallTo, 'io')]) },
  },
} satisfies Record<string, Record<string, CrewMove>>;

/** Phase flow, movement and projectiles for the four specials. */
export const KIT: Kit = {
  // Gale Dart: a quick, flat dart of wind. Two at most in the air.
  n: { start: '', phases: { '': { shots: [shot(9, 'galedart', 5, .21, { angle: 0, gravity: 0, life: 36, r: .17, x: .85, y: 1.05, kbAngle: 55, kbBase: 18, kbGrowth: 32, max: 2 })] } } },
  // Tailwind: a crouch, then he is simply somewhere else. Brief intangibility at the start; once per airtime.
  s: { start: 'Start', once: true, lag: 8, phases: { Start: { next: '', motion: [{ brake: .5, gravity: .3 }] }, '': { motion: [{ from: 0, to: 12, vx: .27, vy: 0, gravity: 0 }, { from: 12, brake: .8 }] } } },
  // Kite Lift: both hands on the lines and the kite carries him up, steering as it goes.
  hi: { start: '', helpless: true, lag: 10, once: true, phases: { '': { motion: rise(5, 46, .135, .0014, .05), ledge: 10 } } },
  // Downdraft: on the ground a spin that blows everyone back; in the air a pause, then a gust below that lifts him a little. Once per airtime.
  lw: { start: '', air: 'Air', once: true, phases: {
    '': { hits: [{ ...hit(8, 14, 4, 35, 0, 0, 1.0, .6, .78), fixedKb: 95 }, { ...hit(8, 14, 4, 35, 0, 0, -1.0, .6, .78), fixedKb: 95 }], motion: [{ brake: .7 }] },
    Air: { hits: [hit(8, 16, 7, 275, 20, 60, 0, -.5, .72)], motion: [{ from: 0, to: 8, ...still }, { from: 8, to: 9, vy: .13 }, { from: 9, gravity: .8 }] } } },
};
