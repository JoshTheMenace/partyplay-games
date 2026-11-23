/** Sola's stance and state clips: idle, locomotion, air, hurt, guard, dodges, ledge, grabs, knockdown, win. Frames are 60 per second. */
import type { Clip, Ease, Key, Pose } from '../../anim/core';
import type { StateClip } from '../types';

/** Pike guard: rear hand at the hip, front hand up the shaft, weight low, chest opened toward the camera. Every clip's keys merge over this. */
export const STANCE: Pose = {
  hips: [0, -.07, 0], turn: -28, lean: 6, spine: [4, 8, 0], chest: [4, 10, 0], neck: [-4, 6, 0], head: [-4, 10, 0],
  armR: { to: [-.2, 1.0, -.16], pole: [-.6, -.3, -.7] }, aim: [28, 14, 0], armL: { grip: .4 }, gripL: 1,
  footL: [.03, 0, .2, 0, 10], footR: [-.05, 0, -.2, 0, 35], kneeL: 4, kneeR: 18, face: [0, -.15, 0],
};
export const k = (f: number, p: Pose = {}, e?: Ease): Key => (e ? { f, p, e } : { f, p });
export const clip = (keys: Key[], o: Partial<Clip> = {}): Clip => ({ keys, base: STANCE, ...o });
/** The free off hand: out for balance instead of on the shaft. */
export const free = (fwd = -10, out = 30, bend = 35): Pose => ({ armL: { fwd, out, bend }, gripL: .25 });
/** Legs in the air: tucked a little, toes down. */
export const AIR: Pose = { hips: [0, .02, 0], footL: [.03, .2, .12, 35, 5], footR: [-.05, .08, -.1, 50, 15] };
const FALL: Pose = { ...AIR, lean: 6, stretch: .04, footL: [.03, .14, .1, 40, 5], footR: [-.05, .04, -.06, 50, 15], armR: { to: [-.3, 1.2, -.1] }, aim: [75, -5, 0], ...free(110, 50, 30), head: [8, 10, 0] };
const RUN: Pose = { lean: 20, turn: -18, spine: [8, 6, 0], chest: [6, 8, 0], head: [-14, 8, 0], armR: { to: [-.26, .93, -.12] }, aim: [10, 4, 0] };
const SHIELD: Pose = { hips: [0, -.16, -.02], lean: 10, turn: -34, chest: [8, 12, 0], head: [-10, 12, 0], armR: { to: [-.16, .92, .16] }, aim: [84, 4, 0], armL: { grip: .42 }, footL: [.03, 0, .24, 0, 10], footR: [-.05, 0, -.24, 0, 40] };
const TUCK: Pose = { hips: [0, 0, 0], lean: 24, lift: -.45, spine: [20, 0, 0], chest: [30, 0, 0], head: [30, 0, 0], footL: [.03, .42, .12, 10, 0], footR: [-.05, .42, -.06, 20, 0], armR: { to: [-.2, 1.0, .15] }, aim: [0, 90, 0], armL: { grip: .3 } };
export const LEDGE: Pose = { hips: [0, -.5, .02], lean: -6, turn: -10, spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [-10, 0, 0], head: [-14, 0, 0], armL: { to: [.12, 1.37, .24], pole: [.5, -.5, -.3] }, gripL: 1,
  armR: { to: [-.14, 1.3, .2], pole: [-.5, -.5, -.3] }, aim: [86, 0, 0], footL: [.03, -.5, .06, 45, 5], footR: [-.05, -.56, -.04, 50, 10] };
export const DOWN: Pose = { spin: [-90, 0, 0], lift: -.82, hips: [0, 0, 0], lean: 0, turn: 0, spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [0, 0, 0], head: [-6, 20, 0], footL: [.03, 0, 0, 30, 15], footR: [-.05, 0, 0, 30, 25],
  armR: { to: [-.5, 1.2, .1] }, aim: [90, 0, 0], ...free(-10, 70, 20), gripL: 0, face: [1, .3, .2] };
export const GRAB: Pose = { hips: [0, -.08, .04], lean: 8, turn: -10, armL: { to: [.06, 1.24, .5], pole: [.5, -.4, -.3] }, gripL: 1, armR: { to: [-.3, 1.0, -.2] }, aim: [60, -10, 0] };
const HURT: Pose = { lean: -16, hips: [0, -.05, -.08], spine: [-10, 0, 0], chest: [-14, -6, 0], neck: [-10, 0, 0], head: [-18, -8, 0], armR: { to: [-.34, 1.2, -.2] }, aim: [70, -20, 0], ...free(-30, 50, 40), gripL: 0, face: [.9, 1, .8],
  footL: [.03, 0, .12, -10, 10], footR: [-.05, 0, -.26, 10, 35] };
const TUMBLE: Pose = { hips: [0, .05, 0], lean: 0, chest: [-10, 0, 0], footL: [.03, .3, .25, 20, 0], footR: [-.05, .18, .05, 40, 0], armR: { to: [-.4, 1.25, 0] }, aim: [80, -30, 0], ...free(100, 70, 40), face: [1, 1, .6] };
const PLANT: Pose = { hips: [0, 0, 0], lean: 0, turn: -40, spine: [0, 10, 0], chest: [0, 14, 0], head: [0, 16, 0], armR: { to: [-.3, 1.05, .12] }, aim: [88, 0, 0], ...free(10, 18, 30), gripL: .5, footL: [.03, 0, .06, 0, 10], footR: [-.05, 0, -.06, 0, 30] };

export const STATES: Record<StateClip, Clip> = {
  idle: clip([k(0), k(55, { hips: [0, -.086, .005], chest: [6, 10, 0], aim: [26, 14, 0], armR: { to: [-.2, .99, -.16] } }), k(110)], { loop: 110 }),
  walk: clip([
    k(0, { hips: [0, -.075, 0], chest: [4, 15, 0], footL: [.03, 0, .26, -8, 10], footR: [-.05, 0, -.24, 20, 30] }), k(10, { hips: [0, -.045, 0], footL: [.03, 0, .02, 0, 10], footR: [-.05, .09, 0, 25, 25], aim: [30, 14, 0] }, 'lin'),
    k(20, { hips: [0, -.075, 0], chest: [4, 5, 0], footR: [-.05, 0, .26, -8, 25], footL: [.03, 0, -.24, 20, 10] }, 'lin'), k(30, { hips: [0, -.045, 0], footR: [-.05, 0, .02, 0, 25], footL: [.03, .09, 0, 25, 10], aim: [30, 14, 0] }, 'lin'),
    k(40, { hips: [0, -.075, 0], chest: [4, 15, 0], footL: [.03, 0, .26, -8, 10], footR: [-.05, 0, -.24, 20, 30] }, 'lin')], { loop: 40, drag: .5 }),
  run: clip([
    k(0, { ...RUN, hips: [0, -.10, .04], footL: [.03, 0, .42, -10, 5], footR: [-.05, .32, -.42, 70, 10], ...free(-35, 14, 75) }), k(6, { ...RUN, hips: [0, -.06, .04], footL: [.03, 0, -.05, 10, 5], footR: [-.05, .28, .18, 20, 10], ...free(0, 14, 80) }, 'lin'),
    k(12, { ...RUN, hips: [0, -.10, .04], footR: [-.05, 0, .42, -10, 10], footL: [.03, .32, -.42, 70, 5], ...free(40, 14, 75) }, 'lin'), k(18, { ...RUN, hips: [0, -.06, .04], footR: [-.05, 0, -.05, 10, 10], footL: [.03, .28, .18, 20, 5], ...free(0, 14, 80) }, 'lin'),
    k(24, { ...RUN, hips: [0, -.10, .04], footL: [.03, 0, .42, -10, 5], footR: [-.05, .32, -.42, 70, 10], ...free(-35, 14, 75) }, 'lin')], { loop: 24, drag: .6 }),
  dash: clip([k(0), k(4, { ...RUN, lean: 30, hips: [0, -.16, .06], footR: [-.05, 0, -.45, 35, 20], footL: [.03, .12, .25, 0, 5], aim: [6, 4, 0], armR: { to: [-.26, .9, -.2] }, ...free(40, 14, 70) }, 'snap'),
    k(10, { ...RUN, hips: [0, -.10, .04], footL: [.03, 0, .42, -10, 5], footR: [-.05, .32, -.42, 70, 10], ...free(-35, 14, 75) })]),
  turn: clip([k(0), k(3, { lean: -14, hips: [0, -.16, -.1], footL: [.03, 0, .38, -15, 10], footR: [-.05, 0, .05, 0, 30], aim: [50, 10, 0], chest: [-6, 14, 0] }, 'out'), k(10, {}, 'io')]),
  crouch: clip([k(0), k(8, { hips: [0, -.40, .02], lean: 16, spine: [10, 8, 0], chest: [8, 10, 0], head: [-18, 10, 0], armR: { to: [-.24, .66, -.12] }, aim: [14, 12, 0], armL: { grip: .38 } }, 'out')]),
  jumpsquat: clip([k(0), k(4, { hips: [0, -.26, 0], lean: 14, stretch: -.10, armR: { to: [-.24, .80, -.2] }, aim: [8, 10, 0] }, 'out')], { drag: 0 }),
  rise: clip([k(0, { ...AIR, lean: -4, stretch: .10, turn: -20, footL: [.03, .16, .14, 35, 5], footR: [-.05, .02, -.14, 55, 15], armR: { to: [-.26, 1.12, -.1] }, aim: [62, 8, 0], ...free(150, 25, 25), head: [-12, 10, 0] }),
    k(12, { ...AIR, lean: -2, stretch: .03, turn: -22, footL: [.03, .26, .16, 30, 5], footR: [-.05, .12, -.12, 50, 15], armR: { to: [-.26, 1.1, -.08] }, aim: [50, 8, 0], ...free(120, 30, 35), head: [-8, 10, 0] }, 'out')]),
  apex: clip([k(0, { ...AIR, lean: 2, footL: [.03, .28, .16, 30, 5], footR: [-.05, .14, -.1, 45, 15], armR: { to: [-.26, 1.08, -.06] }, aim: [40, 8, 0], ...free(70, 40, 50) }),
    k(25, { ...AIR, lean: 3, footL: [.03, .26, .15, 32, 5], footR: [-.05, .13, -.1, 46, 15], armR: { to: [-.26, 1.09, -.06] }, aim: [36, 8, 0], ...free(60, 42, 50) }), k(50, { ...AIR, lean: 2, footL: [.03, .28, .16, 30, 5], footR: [-.05, .14, -.1, 45, 15], armR: { to: [-.26, 1.08, -.06] }, aim: [40, 8, 0], ...free(70, 40, 50) })], { loop: 50 }),
  fall: clip([k(0, FALL), k(15, { ...FALL, ...free(118, 46, 30), aim: [72, -5, 0], footL: [.03, .16, .1, 42, 5] }), k(30, FALL)], { loop: 30 }),
  airjump: clip([k(0, { ...AIR, hips: [0, .04, 0], footL: [.03, .36, .18, 20, 5], footR: [-.05, .34, .05, 30, 10], lean: 16, stretch: -.06, aim: [20, 10, 0], armR: { to: [-.24, .95, -.1] }, ...free(30, 30, 80) }),
    k(5, { ...AIR, stretch: .12, lean: -6, footL: [.03, .02, .05, 60, 5], footR: [-.05, -.02, -.1, 65, 10], ...free(160, 20, 10), aim: [70, 6, 0], armR: { to: [-.26, 1.2, -.05] } }, 'snap'),
    k(14, { ...AIR, lean: -2, stretch: .03, turn: -22, footL: [.03, .26, .16, 30, 5], footR: [-.05, .12, -.12, 50, 15], armR: { to: [-.26, 1.1, -.08] }, aim: [50, 8, 0], ...free(120, 30, 35) })], { drag: .5 }),
  land: clip([k(0, { hips: [0, -.20, 0], stretch: -.08, lean: 12 }), k(2, { hips: [0, -.30, 0], stretch: -.12, lean: 16, armR: { to: [-.24, .78, -.16] }, aim: [12, 12, 0] }, 'out'), k(9, {}, 'back')], { drag: .5 }),
  landHard: clip([k(0, { hips: [0, -.26, 0], stretch: -.1, lean: 14 }), k(3, { hips: [0, -.36, 0], stretch: -.14, lean: 20, armR: { to: [-.24, .72, -.16] }, aim: [6, 12, 0] }, 'out'), k(14, {}, 'back')]),
  hurt: clip([k(0), k(2, HURT, 'snap'), k(10, { ...HURT, lean: -11, face: [.6, .8, .5], head: [-12, -8, 0] }), k(26, { ...HURT, lean: -5, hips: [0, -.06, -.04], chest: [-6, 0, 0], head: [-6, 4, 0], face: [.2, .2, .2] })], { drag: 1.4 }),
  hurtAir: clip([k(0), k(2, { ...HURT, lean: -22, hips: [0, .05, 0], chest: [-16, -6, 0], head: [-20, -8, 0], footL: [.03, .2, .3, 20, 5], footR: [-.05, .12, .16, 30, 15], armR: { to: [-.36, 1.25, -.1] }, aim: [80, -25, 0], ...free(60, 60, 30), spin: [-12, 0, 0] }, 'snap'),
    k(30, { ...HURT, lean: -14, hips: [0, .05, 0], footL: [.03, .22, .24, 25, 5], footR: [-.05, .14, .1, 35, 15], armR: { to: [-.36, 1.25, -.1] }, aim: [86, -25, 0], ...free(80, 60, 30), spin: [-20, 0, 0], face: [.7, .8, .5] })], { drag: 1.4 }),
  tumble: clip([k(0, { ...TUMBLE, spin: [0, 0, 0] }), k(18, { ...TUMBLE, spin: [-180, 0, 0], aim: [140, -30, 0], ...free(60, 80, 60), footL: [.03, .22, .1, 30, 0], footR: [-.05, .3, .25, 20, 0] }, 'lin'), k(36, { ...TUMBLE, spin: [-360, 0, 0] }, 'lin')], { loop: 36, drag: 2 }),
  shield: clip([k(0), k(6, SHIELD, 'out')]),
  shieldstun: clip([k(0, { ...SHIELD, hips: [0, -.2, -.09], lean: 3, chest: [2, 12, 0] }), k(8, SHIELD, 'back')]),
  dizzy: clip([k(0, { hips: [.04, -.14, 0], roll: 6, lean: 10, chest: [10, 0, 6], head: [14, -10, 10], armR: { to: [-.3, .8, .05] }, aim: [-30, 10, 0], ...free(10, 30, 20), gripL: 0, face: [.6, .6, .4] }),
    k(45, { hips: [-.05, -.14, .02], roll: -6, lean: 12, chest: [8, 0, -6], head: [10, 10, -10], armR: { to: [-.3, .8, .05] }, aim: [-30, 10, 0], ...free(-10, 34, 20), gripL: 0, face: [.75, .6, .5] }),
    k(90, { hips: [.04, -.14, 0], roll: 6, lean: 10, chest: [10, 0, 6], head: [14, -10, 10], armR: { to: [-.3, .8, .05] }, aim: [-30, 10, 0], ...free(10, 30, 20), gripL: 0, face: [.6, .6, .4] })], { loop: 90 }),
  sleep: clip([k(0, { hips: [0, -.2, .04], lean: 14, chest: [16, 0, 4], head: [30, 0, 8], armR: { to: [-.14, 1.05, .22] }, aim: [86, 0, 0], armL: { grip: .25 }, face: [1, 0, .1] }),
    k(60, { hips: [0, -.215, .04], lean: 15, chest: [17, 0, 4], head: [34, 0, 8], armR: { to: [-.14, 1.05, .22] }, aim: [86, 0, 0], armL: { grip: .25 }, face: [1, 0, .15] }),
    k(120, { hips: [0, -.2, .04], lean: 14, chest: [16, 0, 4], head: [30, 0, 8], armR: { to: [-.14, 1.05, .22] }, aim: [86, 0, 0], armL: { grip: .25 }, face: [1, 0, .1] })], { loop: 120 }),
  rollF: clip([k(0), k(5, { ...TUCK, spin: [0, 0, 0] }, 'out'), k(8, { ...TUCK, spin: [0, 0, 0] }), k(24, { ...TUCK, spin: [360, 0, 0] }, 'lin'), k(32, { spin: [360, 0, 0] }, 'io')], { drag: 0 }),
  rollB: clip([k(0), k(5, { ...TUCK, lean: 10, spin: [0, 0, 0] }, 'out'), k(8, { ...TUCK, lean: 10, spin: [0, 0, 0] }), k(24, { ...TUCK, lean: 10, spin: [-360, 0, 0] }, 'lin'), k(32, { spin: [-360, 0, 0] }, 'io')], { drag: 0 }),
  spotdodge: clip([k(0), k(6, { turn: 40, hips: [.28, -.1, 0], lean: -8, aim: [80, 30, 0], armR: { to: [-.1, 1.1, -.1] }, chest: [-6, -10, 0] }, 'snap'), k(16, { turn: 40, hips: [.28, -.1, 0], lean: -8, aim: [80, 30, 0], armR: { to: [-.1, 1.1, -.1] }, chest: [-6, -10, 0] }), k(26, {}, 'io')]),
  airdodge: clip([k(0, AIR), k(4, { ...AIR, stretch: .06, footL: [.03, .3, .1, 30, 0], footR: [-.05, .3, 0, 30, 0], aim: [85, 0, 0], armR: { to: [-.18, 1.2, .05] }, armL: { grip: .3 }, turn: -60 }, 'snap'),
    k(18, { ...AIR, footL: [.03, .3, .1, 30, 0], footR: [-.05, .3, 0, 30, 0], aim: [85, 0, 0], armR: { to: [-.18, 1.2, .05] }, armL: { grip: .3 }, turn: -388 }, 'out'), k(40, { ...FALL, turn: -388 })], { drag: 0 }),
  helpless: clip([k(0, { ...AIR, lean: 22, chest: [10, 0, 0], head: [20, 0, 0], footL: [.03, .2, .05, 50, 5], footR: [-.05, .1, -.12, 60, 15], armR: { to: [-.32, 1.32, -.12] }, aim: [78, -12, 0], ...free(150, 40, 20), gripL: 0, face: [.3, .6, .2] }),
    k(20, { ...AIR, lean: 26, chest: [10, 0, 0], head: [20, 0, 0], footL: [.03, .22, .05, 50, 5], footR: [-.05, .1, -.14, 60, 15], armR: { to: [-.32, 1.32, -.12] }, aim: [74, -12, 0], ...free(140, 44, 20), gripL: 0, face: [.3, .6, .2] }),
    k(40, { ...AIR, lean: 22, chest: [10, 0, 0], head: [20, 0, 0], footL: [.03, .2, .05, 50, 5], footR: [-.05, .1, -.12, 60, 15], armR: { to: [-.32, 1.32, -.12] }, aim: [78, -12, 0], ...free(150, 40, 20), gripL: 0, face: [.3, .6, .2] })], { loop: 40 }),
  ledge: clip([k(0, LEDGE), k(30, { ...LEDGE, hips: [0, -.5, .05], footL: [.03, -.5, .1, 45, 5], footR: [-.05, -.56, .0, 50, 10] }), k(60, LEDGE)], { loop: 60 }),
  ledgeclimb: clip([k(0, LEDGE), k(10, { ...LEDGE, hips: [0, -.3, .04], lean: 10, footL: [.03, -.1, .2, 10, 5], footR: [-.05, -.5, -.05, 50, 10] }, 'out'),
    k(20, { hips: [0, -.3, .1], lean: 24, footL: [.03, 0, .2, 0, 10], footR: [-.05, -.05, -.1, 20, 30], armL: { to: [.14, 1.0, .35] }, armR: { to: [-.2, 1.0, .1] }, aim: [50, 10, 0] }), k(32, {}, 'io')]),
  grab: clip([k(0, GRAB), k(20, { ...GRAB, armL: { to: [.06, 1.26, .51], pole: [.5, -.4, -.3] }, hips: [0, -.085, .04] }), k(40, GRAB)], { loop: 40 }),
  grabbed: clip([k(0, { hips: [0, 0, 0], lean: -8, chest: [-6, 0, 0], head: [-10, 0, 6], armR: { to: [-.3, 1.1, -.05] }, aim: [70, -30, 0], ...free(20, 40, 70), footL: [.03, .04, .1, 30, 5], footR: [-.05, .03, -.02, 35, 15], face: [.5, .6, .4] }),
    k(12, { hips: [0, 0, 0], lean: -8, chest: [-6, 0, 0], head: [-10, 0, -6], armR: { to: [-.3, 1.12, -.05] }, aim: [74, -30, 0], ...free(30, 40, 60), footL: [.03, .02, .02, 30, 5], footR: [-.05, .05, .1, 35, 15], face: [.5, .6, .4] }),
    k(24, { hips: [0, 0, 0], lean: -8, chest: [-6, 0, 0], head: [-10, 0, 6], armR: { to: [-.3, 1.1, -.05] }, aim: [70, -30, 0], ...free(20, 40, 70), footL: [.03, .04, .1, 30, 5], footR: [-.05, .03, -.02, 35, 15], face: [.5, .6, .4] })], { loop: 24 }),
  thrown: clip([k(0, { ...TUMBLE, spin: [0, 0, 0] }), k(15, { ...TUMBLE, spin: [-180, 0, 0], aim: [140, -30, 0] }, 'lin'), k(30, { ...TUMBLE, spin: [-360, 0, 0] }, 'lin')], { loop: 30, drag: 2 }),
  knockdown: clip([k(0, { ...DOWN, spin: [-70, 0, 0], lift: -.6 }), k(5, DOWN, 'in'), k(11, { ...DOWN, lift: -.74, spin: [-84, 0, 0] }, 'out'), k(18, DOWN, 'in')], { drag: 0 }),
  getup: clip([k(0, DOWN), k(10, { spin: [-40, 0, 0], lift: -.5, hips: [0, -.2, 0], footL: [.03, .1, .25, 0, 10], footR: [-.05, .1, 0, 10, 30], armR: { to: [-.3, .9, .1] }, aim: [60, 0, 0] }, 'io'),
    k(20, { spin: [0, 0, 0], lift: 0, hips: [0, -.3, 0], lean: 20 }, 'io'), k(30, {}, 'io')]),
  tech: clip([k(0, DOWN), k(8, { ...DOWN, spin: [-200, 0, 0], lift: -.3, footL: [.03, .3, .1, 20, 0], footR: [-.05, .3, 0, 20, 0] }, 'out'), k(16, { spin: [-360, 0, 0], lift: 0, hips: [0, -.25, 0], lean: 10 }, 'io'), k(26, { spin: [-360, 0, 0] }, 'back')], { drag: 0 }),
  teeter: clip([k(0, { lean: 16, hips: [0, -.04, .06], footL: [.03, 0, .08, 25, 10], footR: [-.05, 0, -.02, 25, 30], armR: { to: [-.3, 1.3, -.3] }, aim: [100, -10, 0], ...free(-50, 60, 20), face: [0, 1, .5] }),
    k(18, { lean: -6, hips: [0, -.04, -.04], footL: [.03, 0, .08, 5, 10], footR: [-.05, 0, -.02, 5, 30], armR: { to: [-.3, 1.2, .1] }, aim: [50, 0, 0], ...free(80, 60, 20), face: [0, 1, .5] }),
    k(36, { lean: 16, hips: [0, -.04, .06], footL: [.03, 0, .08, 25, 10], footR: [-.05, 0, -.02, 25, 30], armR: { to: [-.3, 1.3, -.3] }, aim: [100, -10, 0], ...free(-50, 60, 20), face: [0, 1, .5] })], { loop: 36 }),
  respawn: clip([k(0, PLANT), k(40, { ...PLANT, hips: [0, -.012, 0], chest: [2, 14, 0] }), k(80, PLANT)], { loop: 80 }),
  win: clip([k(0), k(16, { ...PLANT, turn: -50, lean: -4, chest: [-6, 16, 0], head: [-8, 24, 0], armR: { to: [-.28, 1.5, .1] }, ...free(10, 30, 100), face: [0, .6, .3] }, 'back'),
    k(70, { ...PLANT, turn: -50, lean: -3, chest: [-5, 16, 0], head: [-6, 24, 0], armR: { to: [-.28, 1.52, .1] }, ...free(10, 30, 100), face: [0, .7, .35] }), k(120, { ...PLANT, turn: -50, lean: -4, chest: [-6, 16, 0], head: [-8, 24, 0], armR: { to: [-.28, 1.5, .1] }, ...free(10, 30, 100), face: [0, .6, .3] })]),
  lose: clip([k(0, { hips: [0, -.1, 0], lean: 14, chest: [14, 0, 0], head: [26, 0, 0], armR: { to: [-.2, 1.0, .2] }, aim: [84, 0, 0], armL: { grip: .2 }, face: [.6, .9, 0] })]),
  select: clip([k(0, { ...PLANT, turn: -34, chest: [0, 12, 0], head: [-2, 12, 0], armR: { to: [-.3, 1.12, .1] }, ...free(10, 30, 95), face: [0, .2, 0] })]),
};
