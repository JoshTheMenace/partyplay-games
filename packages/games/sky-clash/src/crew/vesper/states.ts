/** Vesper's stance and state clips: upright, the blowpipe planted like a staff, the off hand folded behind her back. The state library supplies legs and trunk. */
import { arm, hangPose, k, makeStates } from '../lib';
import type { Pose } from '../../anim/core';
import { RIG } from './rig';

export const LEG = 1.066;
/** The staff hand by wrist target; the pipe points along `aim` [pitch (0 forward, 90 up), yaw (+ to her left), roll]. */
export const R = (x: number, y: number, z: number, aim: readonly number[]): Pose => ({ armR: { to: [x, y, z], pole: [-.6, -.3, -.7] }, aim });
/** The off hand: free by angles, on a target, or on the pipe `d` meters from the grip toward the gather. */
export const Lf = (fwd: number, out: number, bend: number, grip = .5): Pose => arm('L', fwd, out, bend, grip), Lt = (x: number, y: number, z: number, grip = 1): Pose => ({ armL: { to: [x, y, z], pole: [.6, -.4, -.4] }, gripL: grip }), Lg = (d: number): Pose => ({ armL: { grip: d }, gripL: 1 });
export const fl = (y: number, z: number, pitch = 0): number[] => [.02, y * LEG, z * LEG, pitch, 10], fr = (y: number, z: number, pitch = 0): number[] => [-.04, y * LEG, z * LEG, pitch, 30];
/** Folded behind her back. */
const BACK = arm('L', -12, 10, 98, .5, 135);
export const STANCE: Pose = {
  hips: [0, -.03, 0], turn: -22, lean: 2, spine: [0, 6, 0], chest: [-2, 10, 0], neck: [0, 4, 0], head: [2, 8, 0], ...R(-.3, .9, .14, [84, 4, 0]), ...BACK,
  footL: fl(0, .1), footR: fr(0, -.12), kneeL: 3, kneeR: 12, face: [.15, -.1, 0],
};
export const LEDGE: Pose = { ...hangPose(RIG, 1.82, .3, LEG), aim: [86, 0, 0] };
export const STATES = makeStates(RIG, STANCE, {
  breathe: { ...R(-.3, .89, .14, [83, 4, 0]) },
  walk: [{ ...R(-.3, .93, .22, [76, 4, 0]) }, { ...R(-.3, .9, .04, [90, 4, 0]) }],
  run: [{ ...R(-.3, 1.0, -.1, [14, 8, 0]), ...Lf(40, 20, 80) }, { ...R(-.3, 1.02, -.06, [18, 8, 0]), ...Lf(-30, 22, 60) }],
  crouch: { ...R(-.3, .64, .2, [38, 6, 0]) },
  rise: { ...R(-.3, 1.3, 0, [60, 0, 0]), ...Lf(120, 30, 30) }, apex: { ...R(-.3, 1.2, .05, [30, 10, 0]), ...Lf(60, 50, 40) }, fall: { ...R(-.3, 1.4, 0, [76, -4, 0]), ...Lf(110, 50, 30, .2) },
  hurt: { ...R(-.36, 1.4, -.2, [70, -20, 0]), ...Lf(-30, 50, 40, 0) }, tumble: { ...R(-.4, 1.4, 0, [80, -30, 0]), ...Lf(100, 70, 40, 0) },
  shield: { ...R(-.2, 1.1, .3, [86, 0, 0]), ...Lg(.45) }, tuck: { ...R(-.2, 1.1, .15, [0, 90, 0]), ...Lg(.3) },
  ledge: LEDGE, grab: { ...Lt(.06, 1.32, .52), ...R(-.3, 1.0, -.1, [60, -10, 0]) }, held: { ...R(-.3, 1.2, -.05, [70, -30, 0]), ...Lf(20, 40, 70, .2) }, down: { ...R(-.5, 1.3, .1, [90, 0, 0]), ...Lf(-10, 70, 20, 0) },
  dizzy: { ...R(-.3, .9, .1, [80, 10, 0]), ...Lf(10, 30, 20, .2) }, plant: { ...R(-.32, .92, .1, [88, 0, 0]), ...BACK },
  // Victory: the gather goes up and flares; she straightens her lenses and allows herself half a smile.
  win: [k(16, { hips: [0, 0, 0], lean: -2, turn: -40, chest: [-4, 14, 0], head: [4, 16, 0], ...R(-.3, 1.3, .15, [80, 0, 0]), ...Lt(.03, 1.69, .15, .3), face: [.1, .3, .15] }, 'back'),
    k(60, { hips: [0, -.01, 0], lean: -2, turn: -40, chest: [-3, 14, 0], head: [6, 16, 0], ...R(-.3, 1.32, .15, [80, 0, 0]), ...Lt(.03, 1.69, .15, .3), face: [.1, .3, .15] }),
    k(78, { hips: [0, 0, 0], lean: -2, turn: -40, chest: [-4, 14, 0], head: [-2, 20, 0], ...R(-.3, 1.3, .15, [82, 0, 0]), ...BACK, face: [0, .5, .3] }, 'io'),
    k(130, { hips: [0, -.01, 0], lean: -2, turn: -40, chest: [-4, 14, 0], head: [-2, 20, 0], ...R(-.3, 1.31, .15, [82, 0, 0]), ...BACK, face: [0, .5, .3] })],
  lose: { hips: [0, -.06, 0], lean: 10, turn: -26, chest: [10, 0, 0], head: [20, 0, 0], ...R(-.3, .9, .2, [80, 0, 0]), ...BACK, face: [.6, .6, 0] },
  select: { hips: [0, 0, 0], lean: 0, turn: -30, spine: [0, 8, 0], chest: [0, 12, 0], head: [0, 12, 0], ...R(-.3, .92, .12, [86, 2, 0]), ...BACK, footL: fl(0, .05), footR: fr(0, -.05), face: [.1, .1, 0] },
}, { leg: LEG, lean: 14, bob: .7, heavy: .3, crouch: .36, idle: 130, walkLoop: 44, runLoop: 26 });
