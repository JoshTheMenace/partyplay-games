/** Kes's stance and state clips: light on the balls of the feet, never still, arms swept back at a run. The state library supplies legs and trunk. */
import { arm, hangPose, k, makeStates } from '../lib';
import type { Pose } from '../../anim/core';
import { RIG } from './rig';

export const LEG = .93;
export const Lf = (fwd: number, out: number, bend: number, grip = .4): Pose => arm('L', fwd, out, bend, grip), Rf = (fwd: number, out: number, bend: number, grip = .4): Pose => arm('R', fwd, out, bend, grip);
export const Lt = (x: number, y: number, z: number, grip = .6): Pose => ({ armL: { to: [x, y, z], pole: [.7, -.5, -.4] }, gripL: grip }), Rt = (x: number, y: number, z: number, grip = .6): Pose => ({ armR: { to: [x, y, z], pole: [-.7, -.5, -.4] }, gripR: grip });
/** Foot targets: [up, forward, toe pitch] from the stance spot of each foot (scaled to the legs). */
export const fl = (y: number, z: number, pitch = 0): number[] => [.03, y * LEG, z * LEG, pitch, 8], fr = (y: number, z: number, pitch = 0): number[] => [-.04, y * LEG, z * LEG, pitch, 40];
export const STANCE: Pose = {
  hips: [0, -.06, 0], turn: -34, lean: 6, spine: [2, 8, 0], chest: [2, 12, 0], neck: [0, 4, 0], head: [-2, 14, 0], ...Lf(52, 24, 100), ...Rf(10, 30, 95),
  footL: fl(0, .19), footR: fr(.02, -.21, 14), kneeL: 4, kneeR: 20, face: [0, .1, 0],
};
export const LEDGE = hangPose(RIG, 1.6, .26, LEG);
export const STATES = makeStates(RIG, STANCE, {
  breathe: { ...Lf(47, 25, 97), ...Rf(7, 31, 92), footR: fr(0, -.2, 6) },
  walk: [{ ...Lf(62, 22, 95), ...Rf(-6, 30, 90) }, { ...Lf(34, 25, 100), ...Rf(28, 28, 95) }],
  run: [{ ...Lf(-62, 26, 18, .2), ...Rf(-50, 32, 24, .2) }, { ...Lf(-50, 32, 24, .2), ...Rf(-62, 26, 18, .2) }],
  crouch: { ...Lf(50, 30, 116), ...Rf(30, 34, 110) },
  rise: { ...Lf(152, 24, 18, .2), ...Rf(-30, 36, 30, .2) }, apex: { ...Lf(82, 62, 28, .2), ...Rf(72, 66, 28, .2) }, fall: { ...Lf(102, 72, 18, .1), ...Rf(96, 76, 18, .1) },
  airjump: [{ ...Lf(40, 30, 104), ...Rf(40, 30, 104) }, { ...Lf(164, 20, 8, .2), ...Rf(164, 20, 8, .2) }],
  hurt: { ...Lf(-25, 56, 40, 0), ...Rf(-35, 50, 50, 0) }, tumble: { ...Lf(116, 70, 40, 0), ...Rf(60, 80, 50, 0) },
  shield: { ...Lf(76, 5, 126), ...Rf(66, 5, 130) }, tuck: { ...Lf(60, 10, 136), ...Rf(60, 10, 136) },
  ledge: LEDGE, grab: { ...Lt(.06, 1.14, .5, 1), ...Rf(20, 30, 92) }, held: { ...Lf(20, 40, 60, .2), ...Rf(10, 46, 60, .2) }, down: { ...Lf(-10, 70, 20, 0), ...Rf(-10, 70, 20, 0) },
  dizzy: { ...Lf(10, 25, 25, .2), ...Rf(5, 30, 20, .2) }, plant: { ...Lf(6, 18, 20, .3), ...Rf(6, 18, 20, .3) },
  // Victory: one arm to the sky, the back leg kicked up, a breath, then a small bow.
  win: [k(12, { hips: [0, .0, 0], lean: -8, turn: -52, chest: [-10, 16, 0], head: [-12, 22, 0], stretch: .05, ...Lf(160, 34, 10, 0), ...Rf(40, 84, 16, 0), footR: fr(.34, -.24, 50), face: [0, 1, .8] }, 'back'),
    k(50, { hips: [0, -.01, 0], lean: -7, turn: -52, chest: [-9, 16, 0], head: [-10, 22, 0], stretch: .04, ...Lf(158, 36, 10, 0), ...Rf(42, 84, 16, 0), footR: fr(.32, -.24, 50), face: [0, 1, .6] }),
    k(66, { hips: [0, -.08, 0], lean: 14, turn: -44, chest: [10, 12, 0], head: [6, 16, 0], ...Lf(20, 30, 110), ...Rf(-30, 40, 30, .1), footR: fr(0, -.2, 10), face: [.2, .6, .3] }, 'io'),
    k(120, { hips: [0, -.07, 0], lean: 12, turn: -44, chest: [9, 12, 0], head: [4, 16, 0], ...Lf(20, 30, 110), ...Rf(-30, 40, 30, .1), footR: fr(0, -.2, 10), face: [0, .6, .3] })],
  lose: { hips: [0, -.1, 0], lean: 14, turn: -36, chest: [14, 0, 0], head: [26, 0, 0], ...Lf(4, 16, 12, .1), ...Rf(4, 16, 12, .1), face: [.6, .9, 0] },
  select: { hips: [0, 0, 0], lean: -2, turn: -38, spine: [0, 8, 0], chest: [-2, 14, 0], head: [-4, 18, 0], ...Lf(30, 34, 122), ...Rf(18, 46, 118), footL: fl(0, .08), footR: fr(0, -.08), face: [0, .5, .25] },
}, { leg: LEG, lean: 30, bob: 1.5, heavy: 0, crouch: .38, idle: 72, walkLoop: 34, runLoop: 20 });
