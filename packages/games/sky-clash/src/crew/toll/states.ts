/** Toll's stance and state clips: a heavy boxer's guard on short legs. The state library supplies legs and trunk; this is how he carries his fists. */
import { arm, hangPose, k, makeStates } from '../lib';
import type { Pose } from '../../anim/core';
import { RIG } from './rig';

export const LEG = .78;
/** Fists by angles (they follow the body): forward swing, lift to the side, elbow bend. */
export const Lf = (fwd: number, out: number, bend: number, grip = .9): Pose => arm('L', fwd, out, bend, grip), Rf = (fwd: number, out: number, bend: number, grip = .9): Pose => arm('R', fwd, out, bend, grip);
/** Fists by target in fighter space (strikes and holds). */
export const Lt = (x: number, y: number, z: number, grip = 1): Pose => ({ armL: { to: [x, y, z], pole: [.9, -.3, -.4] }, gripL: grip }), Rt = (x: number, y: number, z: number, grip = 1): Pose => ({ armR: { to: [x, y, z], pole: [-.9, -.3, -.4] }, gripR: grip });
export const STANCE: Pose = {
  hips: [0, -.05, 0], turn: -22, lean: 8, spine: [4, 6, 0], chest: [8, 10, 0], neck: [0, 4, 0], head: [-8, 10, 0], ...Lf(52, 20, 96), ...Rf(16, 26, 86),
  footL: [.05, 0, .16, 0, 12], footR: [-.08, 0, -.16, 0, 32], kneeL: 6, kneeR: 16, face: [0, -.3, 0],
};
const PLANT: Pose = { ...Lf(6, 22, 26), ...Rf(6, 22, 26) };
export const LEDGE = hangPose(RIG, 2.0, .5, LEG);
export const BELL: Pose = { hips: [0, .1, 0], footL: [.05, .36, .06, 10, 12], footR: [-.08, .36, 0, 10, 32], stretch: -.1, lean: 4, turn: 0, ...Lf(40, 10, 140), ...Rf(40, 10, 140), head: [20, 0, 0], face: [1, -1, 0] };
export const STATES = makeStates(RIG, STANCE, {
  breathe: { ...Lf(48, 21, 93), ...Rf(13, 27, 83), chest: [10, 10, 0] },
  walk: [{ ...Lf(64, 20, 90), ...Rf(2, 28, 80) }, { ...Lf(36, 22, 96), ...Rf(30, 24, 90) }],
  run: [{ ...Lf(-28, 26, 70), ...Rf(62, 24, 84) }, { ...Lf(62, 24, 84), ...Rf(-28, 26, 70) }],
  crouch: { ...Lf(44, 30, 112), ...Rf(32, 30, 112) },
  rise: { ...Lf(124, 30, 40), ...Rf(100, 36, 50) }, apex: { ...Lf(72, 46, 60), ...Rf(52, 50, 60) }, fall: { ...Lf(104, 56, 40, .2), ...Rf(92, 60, 40, .2) },
  hurt: { ...Lf(-20, 56, 40, 0), ...Rf(-30, 50, 50, 0) }, tumble: { ...Lf(112, 70, 40, 0), ...Rf(60, 80, 50, 0) },
  shield: { ...Lf(72, 4, 122), ...Rf(62, 4, 126) }, tuck: { ...Lf(60, 10, 132), ...Rf(60, 10, 132) },
  ledge: LEDGE, grab: { ...Lt(.1, 1.3, .82), ...Rf(20, 30, 92) }, held: { ...Lf(20, 40, 60, .2), ...Rf(10, 46, 60, .2) }, down: { ...Lf(-10, 70, 20, 0), ...Rf(-10, 70, 20, 0) },
  dizzy: { ...Lf(10, 25, 25, .2), ...Rf(5, 30, 20, .2) }, plant: PLANT,
  // Victory: he throws his fists up, then strikes his own bell and lets it ring.
  win: [k(14, { hips: [0, .02, 0], lean: -6, turn: -34, chest: [-8, 12, 0], head: [-14, 16, 0], stretch: .05, ...Lt(.3, 2.2, .1), ...Rt(-.3, 2.2, .1), face: [0, .8, .8] }, 'back'),
    k(40, { hips: [0, 0, 0], lean: -4, turn: -34, chest: [-6, 12, 0], head: [-12, 16, 0], ...Lt(.3, 2.16, .1), ...Rt(-.3, 2.16, .1), face: [0, .8, .6] }),
    k(52, { hips: [0, -.06, 0], lean: 2, turn: -34, chest: [4, 12, 0], head: [-4, 16, 0], ...Lf(20, 30, 60), ...Rt(-.06, 1.2, .46), face: [0, .5, .3] }, 'snap'),
    k(110, { hips: [0, -.05, 0], lean: 2, turn: -34, chest: [5, 12, 0], head: [-4, 16, 0], ...Lf(18, 30, 60), ...Rt(-.06, 1.22, .45), face: [0, .5, .2] })],
  lose: { hips: [0, -.08, 0], lean: 16, turn: -30, chest: [16, 0, 0], head: [28, 0, 0], ...Lf(4, 18, 14, .1), ...Rf(4, 18, 14, .1), face: [.7, -.6, 0] },
  select: { hips: [0, 0, 0], lean: 0, turn: -32, spine: [0, 8, 0], chest: [0, 12, 0], head: [-2, 14, 0], ...Lf(34, 26, 104), ...Rf(8, 44, 112), footL: [.05, 0, .06, 0, 12], footR: [-.08, 0, -.06, 0, 32], face: [0, .2, 0] },
}, { leg: LEG, lean: 16, bob: 1.3, heavy: 1, crouch: .3, depth: .44, idle: 130, walkLoop: 48, runLoop: 30 });
