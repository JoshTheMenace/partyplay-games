/**
 * Sola's moveset: frame data, hitboxes riding the lantern-pike and one keyframed clip per move, all authored for her.
 * Frames are the simulation's action frames (1 = first). Hits name a rig anchor: pikeTip (blade), pikeHead (hook and lantern), pikeMid, pikeButt.
 * Shape language: thrusts are fast and narrow, lantern arcs are slow, wide and burn.
 */
import type { Pose } from '../../anim/core';
import type { MoveId } from '../../model';
import { hit, rise, shot, still, type Kit } from '../../specials/types';
import type { CrewHit, CrewMove } from '../types';
import { AIR, DOWN, GRAB, LEDGE, clip, free, k } from './states';

const h = (from: number, to: number, at: string, r: number, damage: number, angle: number, base: number, growth: number, o: Partial<CrewHit> = {}): CrewHit => ({ from, to, at, r, damage, angle, kb: [base, growth], ...o });
const R = (x: number, y: number, z: number): Pose['armR'] => ({ to: [x, y, z], pole: [-.6, -.3, -.7] });
const FIRE = { effect: 'fire' as const }, CUT = { effect: 'slash' as const };
const BLADE = (f: [number, number]) => ({ tip: 'pikeTip', base: 'pikeMid', frames: f, color: '#dff3ff', width: .5 }), LAMP = (f: [number, number]) => ({ tip: 'pikeHead', base: 'pikeMid', frames: f, color: '#ffb04a', width: .75 });
const fallTo: Pose = { ...AIR, lean: 6, armR: R(-.3, 1.2, -.1), aim: [75, -5, 0], ...free(110, 50, 30) };

export const MOVES: Partial<Record<MoveId, CrewMove>> = {
  // ── Jab: two quick thrusts and a rising lantern flick ──
  jab1: { name: 'Tap', total: 18, iasa: 15, followup: 7, hits: [h(4, 6, 'pikeTip', .24, 3, 75, 16, 22, CUT), h(4, 6, 'pikeHead', .22, 3, 75, 16, 22)], trail: BLADE([3, 7]),
    clip: clip([k(1, { armR: R(-.24, 1.02, -.26), aim: [10, 8, 0], hips: [0, -.08, -.03], turn: -36, armL: { grip: .5 } }), k(4, { armR: R(-.16, 1.1, .22), aim: [3, 3, 0], hips: [0, -.09, .08], turn: -14, lean: 10, chest: [6, 2, 0], footL: [.03, 0, .28, 0, 10], armL: { grip: .32 } }, 'snap'),
      k(7, { armR: R(-.16, 1.1, .25), aim: [3, 3, 0], hips: [0, -.09, .09], turn: -14, lean: 10, chest: [6, 2, 0], footL: [.03, 0, .28, 0, 10], armL: { grip: .32 } }), k(18, {}, 'io')]) },
  jab2: { name: 'Rap', total: 20, iasa: 17, followup: 8, hits: [h(4, 6, 'pikeTip', .24, 3, 70, 18, 24, CUT), h(4, 6, 'pikeHead', .22, 3, 70, 18, 24)], trail: BLADE([3, 7]),
    clip: clip([k(1, { armR: R(-.22, 1.08, -.1), aim: [8, 6, 0], hips: [0, -.08, .02], turn: -30, armL: { grip: .46 } }), k(4, { armR: R(-.14, 1.2, .26), aim: [-4, 2, 0], hips: [0, -.1, .1], turn: -8, lean: 12, chest: [8, 0, 0], footL: [.03, 0, .3, 0, 10], armL: { grip: .3 } }, 'snap'),
      k(8, { armR: R(-.14, 1.2, .28), aim: [-4, 2, 0], hips: [0, -.1, .11], turn: -8, lean: 12, chest: [8, 0, 0], footL: [.03, 0, .3, 0, 10], armL: { grip: .3 } }), k(20, {}, 'io')]) },
  jab3: { name: 'Flick', total: 30, iasa: 27, hits: [h(6, 9, 'pikeHead', .34, 5, 55, 45, 60, FIRE), h(6, 9, 'pikeTip', .24, 5, 55, 45, 60, CUT)], trail: LAMP([5, 11]),
    clip: clip([k(1, { armR: R(-.2, .85, 0), aim: [-25, 6, 0], hips: [0, -.14, .04], lean: 12 }), k(5, { armR: R(-.2, .82, .02), aim: [-30, 6, 0], hips: [0, -.16, .04], lean: 14 }, 'out'),
      k(7, { armR: R(-.2, 1.25, .2), aim: [58, 4, 0], hips: [0, -.04, .08], lean: -4, stretch: .03, chest: [-8, 4, 0] }, 'snap'), k(12, { armR: R(-.2, 1.3, .18), aim: [76, 4, 0], hips: [0, -.03, .07], lean: -6, chest: [-10, 4, 0] }, 'out'), k(30, {}, 'io')]) },
  // ── Tilts ──
  ftilt: { name: 'Rising Cut', total: 30, iasa: 27, hits: [h(8, 11, 'pikeTip', .26, 9, 40, 30, 70, CUT), h(8, 11, 'pikeHead', .3, 9, 40, 30, 70, CUT)], trail: BLADE([7, 13]),
    clip: clip([k(1, { armR: R(-.3, .9, -.25), aim: [-35, -10, 0], hips: [0, -.12, -.04], turn: -44, chest: [8, -8, 0] }), k(6, { armR: R(-.31, .88, -.27), aim: [-40, -12, 0], hips: [0, -.13, -.05], turn: -46, chest: [9, -10, 0] }, 'out'),
      k(9, { armR: R(-.14, 1.15, .25), aim: [28, 6, 0], hips: [0, -.08, .08], turn: -8, chest: [-2, 16, 0], lean: 6, footL: [.03, 0, .28, 0, 10] }, 'snap'),
      k(13, { armR: R(-.14, 1.22, .2), aim: [48, 10, 0], hips: [0, -.07, .07], turn: -6, chest: [-4, 18, 0], lean: 4, footL: [.03, 0, .28, 0, 10] }, 'out'), k(30, {}, 'io')]) },
  utilt: { name: 'Crook', total: 28, iasa: 25, hits: [h(6, 12, 'pikeHead', .34, 8, 95, 35, 75, FIRE), h(6, 12, 'pikeTip', .26, 8, 95, 35, 75, CUT)], trail: LAMP([5, 14]),
    clip: clip([k(1, { armR: R(-.18, 1.1, .2), aim: [20, 6, 0] }), k(5, { armR: R(-.18, 1.2, .2), aim: [58, 4, 0], hips: [0, -.1, .02] }, 'in'),
      k(8, { armR: R(-.16, 1.45, .05), aim: [100, 0, 0], stretch: .04, hips: [0, -.02, 0], chest: [-10, 6, 0], head: [-20, 10, 0] }, 'lin'), k(12, { armR: R(-.18, 1.4, -.1), aim: [150, 0, 0], hips: [0, -.03, -.02], chest: [-12, 6, 0], head: [-22, 10, 0] }, 'out'),
      k(16, { armR: R(-.18, 1.38, -.1), aim: [158, 0, 0], hips: [0, -.04, -.02], chest: [-12, 6, 0] }), k(28, {}, 'io')]) },
  dtilt: { name: 'Hem Cutter', total: 22, iasa: 19, hits: [h(6, 9, 'pikeTip', .24, 7, 75, 25, 55, CUT), h(6, 9, 'pikeHead', .22, 7, 75, 25, 55)], trail: BLADE([5, 10]),
    clip: clip([k(1, { hips: [0, -.3, -.02], lean: 18, armR: R(-.24, .6, -.25), aim: [-4, 8, 0] }), k(6, { hips: [0, -.36, .1], lean: 26, armR: R(-.16, .5, .25), aim: [-14, 3, 0], footL: [.03, 0, .34, 0, 10] }, 'snap'),
      k(10, { hips: [0, -.36, .11], lean: 26, armR: R(-.16, .5, .27), aim: [-14, 3, 0], footL: [.03, 0, .34, 0, 10] }), k(22, {}, 'io')]) },
  dash: { name: 'Lunge', total: 38, iasa: 34, hits: [h(7, 10, 'pikeTip', .28, 10, 50, 50, 55, CUT), h(10, 15, 'pikeTip', .26, 7, 60, 35, 45, CUT), h(7, 15, 'pikeMid', .26, 7, 60, 35, 45)], trail: BLADE([6, 15]),
    clip: clip([k(1, { lean: 24, hips: [0, -.14, 0], armR: R(-.26, .95, -.3), aim: [4, 4, 0] }), k(7, { hips: [0, -.2, .2], lean: 30, armR: R(-.14, 1.0, .35), aim: [0, 2, 0], footL: [.03, 0, .5, -10, 5], footR: [-.05, 0, -.5, 40, 20], stretch: .05 }, 'snap'),
      k(16, { hips: [0, -.21, .2], lean: 30, armR: R(-.14, 1.0, .36), aim: [0, 2, 0], footL: [.03, 0, .5, 0, 5], footR: [-.05, 0, -.46, 40, 20] }), k(38, {}, 'io')]) },
  // ── Smashes: the lantern does the work ──
  fsmash: { name: 'Beacon Break', total: 52, iasa: 48, charge: 6, hits: [h(18, 22, 'pikeHead', .42, 17, 42, 30, 98, FIRE), h(18, 22, 'pikeTip', .28, 15, 42, 28, 96, CUT), h(18, 22, 'pikeMid', .26, 13, 42, 26, 92)], trail: LAMP([15, 24]),
    cues: [{ f: 18, kind: 'flare', at: 'pikeHead', power: 1 }, { f: 20, kind: 'step', power: .8 }],
    clip: clip([k(1, { armR: R(-.2, 1.2, -.1), aim: [60, 0, 0] }), k(6, { armR: R(-.22, 1.55, -.25), aim: [130, -8, 0], hips: [0, -.12, -.08], lean: -10, turn: -40, chest: [-12, -6, 0], armL: { grip: .45 }, stretch: .03, footL: [.03, 0, .16, 0, 10] }, 'out'),
      k(14, { armR: R(-.22, 1.57, -.27), aim: [140, -8, 0], hips: [0, -.13, -.1], lean: -12, turn: -42, chest: [-14, -6, 0], armL: { grip: .45 }, stretch: .04, footL: [.03, .04, .14, 0, 10] }, 'out'),
      k(18, { armR: R(-.14, 1.05, .3), aim: [-12, 2, 0], hips: [0, -.2, .14], lean: 24, turn: -6, chest: [14, 10, 0], stretch: -.04, footL: [.03, 0, .34, 0, 10], face: [0, -1, .7] }, 'snap'),
      k(22, { armR: R(-.14, .9, .3), aim: [-24, 2, 0], hips: [0, -.24, .15], lean: 28, turn: -4, chest: [16, 10, 0], stretch: -.06, footL: [.03, 0, .34, 0, 10], face: [0, -1, .7] }, 'out'),
      k(36, { armR: R(-.14, .92, .28), aim: [-20, 2, 0], hips: [0, -.22, .13], lean: 24, turn: -6, chest: [14, 10, 0], footL: [.03, 0, .34, 0, 10], face: [0, -.6, .2] }), k(52, {}, 'io')]) },
  usmash: { name: 'Skylight', total: 46, iasa: 42, charge: 5, hits: [h(12, 18, 'pikeHead', .4, 15, 88, 32, 96, FIRE), h(12, 18, 'pikeTip', .26, 13, 88, 30, 94, CUT)], trail: LAMP([10, 18]), cues: [{ f: 12, kind: 'flare', at: 'pikeHead', power: .9 }],
    clip: clip([k(1, { hips: [0, -.16, 0], armR: R(-.2, .9, .05), aim: [60, 4, 0] }), k(5, { hips: [0, -.3, 0], lean: 10, armR: R(-.2, .75, .05), aim: [70, 4, 0], armL: { grip: .35 }, stretch: -.05 }, 'out'),
      k(12, { hips: [0, 0, .02], stretch: .1, lean: -4, armR: R(-.16, 1.6, .08), aim: [88, 2, 0], head: [-30, 10, 0], footL: [.03, 0, .2, 25, 10], footR: [-.05, 0, -.2, 25, 35], face: [0, -1, .6] }, 'snap'),
      k(19, { hips: [0, -.01, .02], stretch: .07, lean: -4, armR: R(-.16, 1.58, .08), aim: [88, 2, 0], head: [-30, 10, 0], footL: [.03, 0, .2, 20, 10], footR: [-.05, 0, -.2, 20, 35] }), k(46, {}, 'io')]) },
  dsmash: { name: 'Ring the Ground', total: 48, iasa: 44, charge: 4, hits: [h(10, 13, 'pikeTip', .3, 13, 30, 35, 78, CUT), h(10, 13, 'pikeHead', .32, 13, 30, 35, 78, FIRE), h(18, 22, 'pikeTip', .3, 12, 30, 35, 76, { ...CUT, group: 1 }), h(18, 22, 'pikeHead', .32, 12, 30, 35, 76, { ...FIRE, group: 1 })],
    trail: LAMP([9, 23]),
    clip: clip([k(1, { hips: [0, -.2, 0], armR: R(-.28, .8, -.1), aim: [-6, 40, 0] }), k(4, { hips: [0, -.34, 0], lean: 14, armR: R(-.3, .7, -.2), aim: [-10, 60, 0], turn: -50 }, 'out'),
      k(10, { armR: R(-.16, .62, .22), aim: [-16, 0, 0], turn: -10, hips: [0, -.36, .06], lean: 16 }, 'snap'), k(13, { armR: R(-.2, .62, .16), aim: [-16, -40, 0], turn: -30, hips: [0, -.36, .04], lean: 14 }, 'lin'),
      k(18, { armR: R(-.22, .62, -.2), aim: [-16, -178, 0], turn: -70, hips: [0, -.36, -.04], lean: 8, chest: [6, -30, 0] }, 'lin'), k(22, { armR: R(-.2, .62, -.22), aim: [-16, -205, 0], turn: -74, hips: [0, -.36, -.04], lean: 8, chest: [6, -34, 0] }, 'out'),
      k(32, { armR: R(-.2, .64, -.2), aim: [-14, -210, 0], turn: -70, hips: [0, -.34, -.03], lean: 8, chest: [6, -30, 0] }), k(48, { aim: [28, -346, 0] }, 'io')]) },
  // ── Aerials ──
  nair: { name: 'Wheel', total: 40, landingLag: 12, autoCancel: [5, 30], hits: [h(6, 15, 'pikeHead', .36, 8, 45, 22, 80, FIRE), h(6, 15, 'pikeButt', .26, 8, 45, 22, 80), h(15, 25, 'pikeHead', .34, 5, 45, 15, 70, { ...FIRE, group: 1 }), h(15, 25, 'pikeButt', .24, 5, 45, 15, 70, { group: 1 })],
    trail: LAMP([5, 25]),
    clip: clip([k(1, { ...AIR, armR: R(-.12, 1.2, .05), aim: [10, 20, 0], ...free(60, 60, 30) }), k(5, { ...AIR, armR: R(-.1, 1.25, .05), aim: [0, 0, 0], ...free(80, 70, 20), footL: [.03, .3, .16, 30, 5], footR: [-.05, .24, 0, 40, 15] }, 'in'),
      k(24, { ...AIR, armR: R(-.1, 1.25, .05), aim: [0, -720, 0], ...free(80, 70, 20), footL: [.03, .3, .16, 30, 5], footR: [-.05, .24, 0, 40, 15], turn: -388 }, 'lin'), k(40, { ...fallTo, aim: [75, -725, 0], turn: -388 }, 'io')], { drag: 0 }) },
  fair: { name: 'Lamp Swing', total: 38, landingLag: 16, autoCancel: [8, 32], hits: [h(10, 14, 'pikeHead', .38, 11, 45, 25, 90, FIRE), h(10, 14, 'pikeTip', .26, 9, 45, 22, 86, CUT)], trail: LAMP([8, 15]),
    clip: clip([k(1, { ...AIR, armR: R(-.2, 1.4, -.2), aim: [120, -6, 0], lean: -8 }), k(7, { ...AIR, armR: R(-.2, 1.44, -.24), aim: [132, -6, 0], lean: -12, chest: [-10, -4, 0] }, 'out'),
      k(10, { ...AIR, armR: R(-.14, 1.1, .3), aim: [-5, 2, 0], lean: 20, chest: [12, 8, 0], footL: [.03, .1, -.2, 50, 5], footR: [-.05, .2, -.3, 60, 15] }, 'snap'),
      k(15, { ...AIR, armR: R(-.14, .95, .28), aim: [-40, 2, 0], lean: 26, chest: [14, 8, 0], footL: [.03, .12, -.22, 50, 5], footR: [-.05, .22, -.3, 60, 15] }, 'out'), k(38, fallTo, 'io')]) },
  bair: { name: 'Butt Strike', total: 34, landingLag: 14, autoCancel: [6, 28], hits: [h(8, 11, 'pikeButt', .32, 12, 40, 28, 92)], trail: { tip: 'pikeButt', base: 'grip', frames: [7, 12], color: '#ffe2b0', width: .5 },
    clip: clip([k(1, { ...AIR, armR: R(-.2, 1.1, .1), aim: [5, 0, 0], ...free(40, 40, 60) }), k(5, { ...AIR, armR: R(-.2, 1.1, .32), aim: [5, 0, 0], turn: -10, ...free(60, 40, 60) }, 'out'),
      k(8, { ...AIR, armR: R(-.2, 1.1, -.35), aim: [4, 0, 0], turn: -64, chest: [0, -30, 0], head: [0, -50, 0], footR: [-.05, .1, -.4, 60, 15], ...free(90, 30, 20) }, 'snap'),
      k(12, { ...AIR, armR: R(-.2, 1.1, -.36), aim: [4, 0, 0], turn: -64, chest: [0, -30, 0], head: [0, -50, 0], footR: [-.05, .1, -.4, 60, 15], ...free(90, 30, 20) }), k(34, fallTo, 'io')]) },
  uair: { name: 'Hook Lift', total: 34, landingLag: 12, autoCancel: [5, 28], hits: [h(7, 12, 'pikeHead', .36, 9, 85, 22, 88, FIRE), h(7, 12, 'pikeTip', .26, 9, 85, 22, 88, CUT)], trail: LAMP([6, 13]),
    clip: clip([k(1, { ...AIR, armR: R(-.18, 1.3, .1), aim: [30, 0, 0] }), k(5, { ...AIR, armR: R(-.18, 1.36, .12), aim: [36, 0, 0], lean: 6 }, 'out'),
      k(8, { ...AIR, armR: R(-.16, 1.5, 0), aim: [92, 0, 0], lean: -6, stretch: .05, head: [-26, 10, 0] }, 'snap'), k(12, { ...AIR, armR: R(-.18, 1.46, -.08), aim: [134, 0, 0], lean: -10, head: [-28, 10, 0] }, 'out'), k(34, fallTo, 'io')]) },
  dair: { name: 'Plumb Line', total: 44, landingLag: 22, autoCancel: [9, 36], hits: [h(12, 16, 'pikeTip', .28, 12, 280, 20, 80, CUT), h(12, 16, 'pikeHead', .3, 10, 280, 18, 76), h(16, 25, 'pikeTip', .26, 7, 60, 20, 60, { ...CUT, group: 1 })], trail: BLADE([11, 18]),
    clip: clip([k(1, { ...AIR, armR: R(-.16, 1.4, .08), aim: [-50, 0, 0] }), k(8, { ...AIR, armR: R(-.14, 1.5, .1), aim: [-88, 0, 0], stretch: -.04, footL: [.03, .3, .1, 30, 5], footR: [-.05, .3, -.02, 30, 15], armL: { grip: -.2 } }, 'out'),
      k(12, { ...AIR, armR: R(-.14, .95, .12), aim: [-88, 0, 0], stretch: .08, footL: [.03, .34, -.1, 50, 5], footR: [-.05, .36, -.2, 55, 15], armL: { grip: -.25 }, head: [16, 10, 0] }, 'snap'),
      k(25, { ...AIR, armR: R(-.14, .95, .12), aim: [-88, 0, 0], stretch: .06, footL: [.03, .34, -.1, 50, 5], footR: [-.05, .36, -.2, 55, 15], armL: { grip: -.25 }, head: [16, 10, 0] }), k(44, fallTo, 'io')]) },
  // ── Grab and throws: the off hand catches, the pike finishes ──
  grab: { name: 'Collar', total: 30, hits: [h(7, 9, 'hand_L', .3, 0, 0, 0, 0)],
    clip: clip([k(1, { ...GRAB, armL: { to: [.06, 1.22, .2], pole: [.5, -.4, -.3] }, gripL: 0, hips: [0, -.08, -.02] }), k(7, { ...GRAB, armL: { to: [.04, 1.22, .62], pole: [.5, -.4, -.3] }, gripL: 0, hips: [0, -.1, .12], lean: 12 }, 'snap'),
      k(10, { ...GRAB, armL: { to: [.04, 1.22, .6], pole: [.5, -.4, -.3] }, gripL: 1, hips: [0, -.1, .1], lean: 12 }), k(30, {}, 'io')]) },
  dashgrab: { name: 'Running Collar', total: 40, hits: [h(10, 13, 'hand_L', .32, 0, 0, 0, 0)],
    clip: clip([k(1, { ...GRAB, lean: 22, armL: { to: [.06, 1.1, .2], pole: [.5, -.4, -.3] }, gripL: 0, hips: [0, -.14, .04] }), k(10, { ...GRAB, lean: 26, armL: { to: [.04, 1.12, .7], pole: [.5, -.4, -.3] }, gripL: 0, hips: [0, -.18, .22], footL: [.03, 0, .44, 0, 5] }, 'snap'),
      k(14, { ...GRAB, lean: 26, armL: { to: [.04, 1.12, .68], pole: [.5, -.4, -.3] }, gripL: 1, hips: [0, -.18, .2], footL: [.03, 0, .44, 0, 5] }), k(40, {}, 'io')]) },
  pummel: { name: 'Knock', total: 16, iasa: 14, hits: [h(6, 8, 'head', .3, 2, 0, 0, 0)],
    clip: clip([k(1, GRAB), k(4, { ...GRAB, head: [-22, 10, 0], chest: [-10, 10, 0], hips: [0, -.08, 0] }, 'out'), k(6, { ...GRAB, head: [26, 10, 0], chest: [16, 10, 0], hips: [0, -.1, .1] }, 'snap'), k(16, GRAB, 'io')]) },
  fthrow: { name: 'Send Off', total: 30, throw: { damage: 8, angle: 45, kb: [55, 55], release: 14 }, trail: BLADE([11, 16]),
    clip: clip([k(1, GRAB), k(8, { ...GRAB, armL: { to: [.06, 1.2, .3], pole: [.5, -.4, -.3] }, hips: [0, -.1, -.04], armR: R(-.3, 1.1, -.3), aim: [20, -5, 0] }, 'out'),
      k(13, { armR: R(-.14, 1.15, .3), aim: [6, 2, 0], ...free(20, 40, 30), gripL: 0, hips: [0, -.1, .12], lean: 12, turn: -10 }, 'snap'), k(18, { armR: R(-.14, 1.15, .32), aim: [6, 2, 0], ...free(20, 40, 30), hips: [0, -.1, .12], lean: 12, turn: -10 }), k(30, {}, 'io')]) },
  bthrow: { name: 'Round the Post', total: 36, throw: { damage: 9, angle: 45, kb: [60, 60], release: 18, turn: true },
    clip: clip([k(1, GRAB), k(8, { ...GRAB, hips: [0, -.1, -.06], lean: -6 }, 'out'), k(16, { ...GRAB, turn: -200, lean: -10, armL: { to: [-.06, 1.24, -.5], pole: [.5, -.4, .3] } }, 'in'),
      k(18, { ...GRAB, turn: -200, lean: -12, armL: { to: [-.06, 1.3, -.6], pole: [.5, -.4, .3] }, gripL: 0 }), k(23, { turn: -56, ...free(40, 50, 30) }, 'lin'), k(36, {}, 'io')]) },
  uthrow: { name: 'Hoist', total: 30, throw: { damage: 7, angle: 88, kb: [60, 70], release: 12 },
    clip: clip([k(1, GRAB), k(6, { ...GRAB, hips: [0, -.28, .04], lean: 16, armL: { to: [.06, .9, .45], pole: [.5, -.4, -.3] } }, 'out'), k(11, { ...GRAB, hips: [0, 0, .04], lean: -6, stretch: .08, armL: { to: [.05, 1.7, .3], pole: [.5, -.4, -.3] }, aim: [86, 0, 0], armR: R(-.26, 1.1, 0) }, 'snap'),
      k(13, { hips: [0, 0, .04], lean: -6, stretch: .06, ...free(170, 20, 10), gripL: 0, aim: [86, 0, 0], armR: R(-.26, 1.1, 0) }), k(30, {}, 'io')]) },
  dthrow: { name: 'Set Down', total: 34, throw: { damage: 6, angle: 70, kb: [50, 40], release: 16 },
    clip: clip([k(1, GRAB), k(8, { ...GRAB, armL: { to: [.06, 1.5, .4], pole: [.5, -.4, -.3] }, hips: [0, -.04, 0], lean: -4 }, 'out'), k(14, { ...GRAB, armL: { to: [.06, .5, .5], pole: [.5, -.4, -.3] }, hips: [0, -.3, .1], lean: 26 }, 'snap'),
      k(17, { hips: [0, -.3, .1], lean: 26, ...free(60, 30, 20), gripL: 0 }), k(34, {}, 'io')]) },
  // ── Getting back in ──
  ledgeattack: { name: 'Edge Sweep', total: 54, intangible: [[1, 18]], hits: [h(20, 24, 'pikeTip', .26, 8, 45, 40, 50, CUT), h(20, 24, 'pikeHead', .28, 8, 45, 40, 50)], trail: BLADE([18, 25]),
    clip: clip([k(1, LEDGE), k(12, { ...LEDGE, hips: [0, -.3, .04], lean: 10, footL: [.03, -.1, .2, 10, 5], footR: [-.05, -.5, -.05, 50, 10] }, 'out'), k(17, { hips: [0, -.3, .04], lean: 16, armR: R(-.26, .64, -.2), aim: [0, 10, 0] }, 'io'),
      k(20, { hips: [0, -.3, .1], lean: 22, armR: R(-.16, .6, .3), aim: [-6, 2, 0], footL: [.03, 0, .3, 0, 10] }, 'snap'), k(26, { hips: [0, -.3, .1], lean: 22, armR: R(-.16, .6, .32), aim: [-6, 2, 0], footL: [.03, 0, .3, 0, 10] }), k(54, {}, 'io')]) },
  getupattack: { name: 'Rising Ring', total: 50, intangible: [[1, 24]], hits: [h(18, 22, 'pikeTip', .28, 6, 45, 45, 40, CUT), h(24, 28, 'pikeTip', .28, 6, 45, 45, 40, { ...CUT, group: 1 })], trail: BLADE([17, 29]),
    clip: clip([k(1, DOWN), k(12, { spin: [-30, 0, 0], lift: -.5, hips: [0, -.3, 0], armR: R(-.26, .8, 0), aim: [20, 30, 0] }, 'io'), k(18, { spin: [0, 0, 0], lift: 0, hips: [0, -.4, 0], lean: 14, armR: R(-.16, .6, .25), aim: [-10, 0, 0] }, 'snap'),
      k(24, { hips: [0, -.4, 0], lean: 8, armR: R(-.2, .6, -.2), aim: [-10, -180, 0], turn: -80 }, 'lin'), k(32, { hips: [0, -.38, 0], lean: 8, armR: R(-.2, .62, -.2), aim: [-8, -190, 0], turn: -80 }), k(50, { aim: [28, -346, 0] }, 'io')], { drag: 0 }) },
  taunt: { name: 'Light the Way', total: 70,
    clip: clip([k(1), k(14, { hips: [0, 0, 0], lean: -4, turn: -46, chest: [-6, 16, 0], head: [-8, 22, 0], armR: R(-.26, 1.5, .15), aim: [88, 0, 0], ...free(10, 30, 100), face: [0, .6, .3] }, 'back'),
      k(50, { hips: [0, -.01, 0], lean: -4, turn: -46, chest: [-6, 16, 0], head: [-8, 22, 0], armR: R(-.26, 1.52, .15), aim: [88, 0, 0], ...free(10, 30, 100), face: [0, .7, .4] }), k(70, {}, 'io')]) },
};

// ── Specials ──────────────────────────────────────────────────────────────
const LOB = [k(1), k(8, { armR: R(-.26, 1.1, -.3), aim: [100, -10, 0], hips: [0, -.1, -.06], turn: -44, chest: [-6, -8, 0] }, 'out'), k(13, { armR: R(-.14, 1.3, .25), aim: [40, 2, 0], hips: [0, -.08, .08], turn: -10, chest: [6, 14, 0], lean: 8 }, 'snap'),
  k(19, { armR: R(-.14, 1.24, .26), aim: [16, 2, 0], hips: [0, -.09, .08], turn: -8, chest: [8, 14, 0], lean: 10 }, 'out'), k(40, {}, 'io')];
const WHIRL: Pose = { ...AIR, armR: R(-.1, 1.76, .04), ...free(70, 60, 20), footL: [.03, .05, .03, 60, 5], footR: [-.05, 0, -.03, 60, 10], stretch: .08, lean: 0, head: [-16, 10, 0] };
const DIVE: Pose = { ...AIR, armR: R(-.14, 1.0, .1), aim: [-88, 0, 0], armL: { grip: -.25 }, stretch: .08, footL: [.03, .36, -.1, 50, 5], footR: [-.05, .38, -.2, 55, 15], head: [16, 10, 0], lean: 6 };
const updraft: CrewHit[] = [...[0, 1, 2, 3, 4].flatMap(i => [h(8 + i * 6, 13 + i * 6, 'pikeHead', .4, 2, 96, 0, 0, { ...FIRE, fixed: 46, group: i + 1 }), h(8 + i * 6, 13 + i * 6, 'pikeButt', .3, 2, 96, 0, 0, { fixed: 46, group: i + 1 })]),
  h(38, 43, 'pikeHead', .44, 5, 78, 70, 80, { ...FIRE, group: 7 }), h(38, 43, 'pikeButt', .32, 5, 78, 70, 80, { group: 7 })];
export const SPECIALS = {
  nspecial: {
    '': { name: 'Cinder Lob', total: 40, shots: [14], trail: LAMP([10, 16]), cues: [{ f: 14, kind: 'flare' as const, at: 'pikeHead', power: .6 }], clip: clip(LOB) },
    Air: { name: 'Cinder Lob', total: 40, shots: [14], trail: LAMP([10, 16]), cues: [{ f: 14, kind: 'flare' as const, at: 'pikeHead', power: .6 }], clip: clip(LOB.map(key => ({ ...key, p: { ...AIR, ...key.p } }))) },
  },
  sspecial: {
    Start: { name: 'Pike Vault', total: 12, cues: [{ f: 8, kind: 'step' as const, power: .6 }],
      clip: clip([k(1, { armR: R(-.18, 1.1, .1), aim: [-20, 0, 0] }), k(8, { armR: R(-.16, 1.2, .35), aim: [-70, 0, 0], hips: [0, -.2, .1], lean: 20, armL: { grip: -.3 } }, 'snap'), k(12, { armR: R(-.16, 1.16, .36), aim: [-72, 0, 0], hips: [0, -.24, .12], lean: 22, armL: { grip: -.3 } })]) },
    '': { name: 'Pike Vault', total: 36, hits: [h(4, 22, 'foot_L', .34, 10, 40, 40, 70), h(4, 22, 'foot_R', .34, 10, 40, 40, 70)],
      clip: clip([k(1, { armR: R(-.16, 1.16, .36), aim: [-72, 0, 0], hips: [0, -.2, .12], lean: 20 }), k(6, { spin: [-65, 0, 0], lift: .1, hips: [0, 0, 0], lean: -10, stretch: .08, footL: [.03, 0, .08, -20, 0], footR: [-.05, .04, .04, -20, 0], armR: R(-.2, 1.3, -.2), aim: [150, 0, 0], ...free(-40, 40, 20) }, 'snap'),
        k(22, { spin: [-58, 0, 0], lift: .1, hips: [0, 0, 0], lean: -8, stretch: .06, footL: [.03, 0, .08, -20, 0], footR: [-.05, .04, .04, -20, 0], armR: R(-.2, 1.3, -.2), aim: [150, 0, 0], ...free(-40, 40, 20) }), k(36, { ...fallTo, spin: [0, 0, 0] }, 'io')], { drag: 0 }) },
    Lunge: { name: 'Sky Lunge', total: 34, hits: [h(6, 18, 'pikeTip', .28, 9, 45, 40, 70, CUT), h(6, 18, 'pikeMid', .26, 7, 45, 34, 60)], trail: BLADE([5, 18]),
      clip: clip([k(1, { ...AIR, armR: R(-.24, 1.05, -.3), aim: [0, 6, 0], lean: 10 }), k(6, { ...AIR, armR: R(-.14, 1.15, .35), aim: [-4, 0, 0], lean: 32, stretch: .08, footL: [.03, .16, -.3, 60, 5], footR: [-.05, .24, -.4, 65, 15] }, 'snap'),
        k(20, { ...AIR, armR: R(-.14, 1.15, .36), aim: [-4, 0, 0], lean: 32, stretch: .06, footL: [.03, .16, -.3, 60, 5], footR: [-.05, .24, -.4, 65, 15] }), k(34, fallTo, 'io')]) },
  },
  uspecial: {
    '': { name: 'Updraft', total: 48, hits: updraft, trail: [LAMP([6, 44]), { tip: 'pikeButt', base: 'grip', frames: [6, 44] as const, color: '#ffd9a0', width: .5 }], cues: [{ f: 6, kind: 'burst' as const, power: .7 }],
      clip: clip([k(1, { hips: [0, -.2, 0], armR: R(-.2, .9, .1), aim: [80, 0, 0], lean: 8 }), k(6, { ...WHIRL, aim: [0, 0, 0] }, 'snap'), k(42, { ...WHIRL, aim: [0, -1080, 0], turn: -388 }, 'lin'), k(48, { ...fallTo, aim: [75, -1085, 0], turn: -388 }, 'io')], { drag: 0 }) },
  },
  dspecial: {
    '': { name: 'Kindle', total: 44, cues: [{ f: 13, kind: 'burst' as const, power: 1 }, { f: 13, kind: 'step' as const, power: 1 }],
      clip: clip([k(1, { armR: R(-.18, 1.1, .2), aim: [70, 0, 0] }), k(8, { armR: R(-.16, 1.45, .2), aim: [88, 0, 0], hips: [0, -.02, 0], stretch: .05, lean: -4, armL: { grip: -.25 } }, 'out'),
        k(12, { armR: R(-.16, .78, .25), aim: [88, 0, 0], hips: [0, -.26, .06], lean: 14, stretch: -.06, armL: { grip: -.25 }, face: [0, -1, .5] }, 'snap'), k(22, { armR: R(-.16, .8, .25), aim: [88, 0, 0], hips: [0, -.24, .06], lean: 12, armL: { grip: -.25 } }), k(44, {}, 'io')]) },
    Dive: { name: 'Plummet', total: 12, clip: clip([k(1, { ...AIR, armR: R(-.16, 1.4, .08), aim: [-50, 0, 0] }), k(10, { ...DIVE, armR: R(-.14, 1.5, .1), stretch: -.04 }, 'out'), k(12, DIVE, 'snap')]) },
    DiveFall: { name: 'Plummet', total: 90, hits: [h(1, 90, 'pikeTip', .3, 11, 290, 25, 78, CUT), h(1, 90, 'pikeHead', .3, 9, 60, 25, 60)], trail: BLADE([1, 90]), clip: clip([k(1, DIVE), k(90, DIVE)], { drag: 0 }) },
    DiveLand: { name: 'Plummet', total: 26, cues: [{ f: 1, kind: 'burst' as const, power: .8 }, { f: 1, kind: 'step' as const, power: 1 }],
      clip: clip([k(1, { armR: R(-.16, .78, .25), aim: [-80, 0, 0], hips: [0, -.34, .06], lean: 20, stretch: -.1 }), k(8, { armR: R(-.16, .8, .25), aim: [-70, 0, 0], hips: [0, -.28, .06], lean: 16 }, 'out'), k(26, {}, 'io')]) },
  },
} satisfies Record<string, Record<string, CrewMove>>;

/** Phase flow, movement and projectiles for the four specials. */
export const KIT: Kit = {
  // Cinder Lob: the lantern flings an ember in an arc; it bursts where it lands or on whoever it touches.
  n: { start: '', phases: { '': { shots: [shot(13, 'cinder', 6, .115, { angle: 38, gravity: .0062, life: 80, r: .2, x: 1.05, y: 1.85, effect: 'fire', kbAngle: 70, kbBase: 25, kbGrowth: 40, max: 2, blast: { r: .6, damage: 5, life: 10, kbBase: 30, kbGrowth: 50, angle: 80 } })] } } },
  // Pike Vault: plant and swing through feet first; in the air it is a straight lunge. Once per airtime.
  s: { start: 'Start', air: 'Lunge', once: true, lag: 12, phases: {
    Start: { next: '', motion: [{ brake: .6 }] }, '': { land: 'lag', motion: [{ from: 0, to: 1, vx: .165, vy: .2 }, { from: 1, gravity: .95, drift: .35 }] },
    Lunge: { motion: [{ from: 0, to: 6, ...still }, { from: 6, to: 16, vx: .19, vy: .015, gravity: .1 }, { from: 16, brake: .92, gravity: 1 }] } } },
  // Updraft: the pike whirls overhead and she rides the heat up, steering.
  hi: { start: '', helpless: true, lag: 16, once: true, phases: { '': { motion: rise(6, 40, .158, .0026, .03), ledge: 18 } } },
  // Kindle: the butt of the pike strikes the stone and flame leaps both sides. In the air she drops like a plumb line and bursts on landing.
  lw: { start: '', air: 'Dive', phases: {
    '': { hits: [hit(13, 19, 10, 80, 50, 70, .85, .35, .55, 'fire'), hit(13, 19, 10, 100, 50, 70, -.85, .35, .55, 'fire')], motion: [{ brake: .7 }] },
    Dive: { next: 'DiveFall', motion: [{ ...still }] }, DiveFall: { land: 'DiveLand', motion: [{ vx: 0, vy: -.3, gravity: 0 }] },
    DiveLand: { hits: [hit(0, 6, 6, 70, 40, 60, .8, .3, .5, 'fire'), hit(0, 6, 6, 110, 40, 60, -.8, .3, .5, 'fire')] } } },
};
