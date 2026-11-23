/** Kes, the kite-runner: fast and light, three jumps, a kite that lifts him out of trouble. Everything here was authored for him. */
import type { CrewDef } from '../types';
import { KIT, MOVES, SPECIALS } from './moves';
import { RIG } from './rig';
import { STANCE, STATES } from './states';

export const KES: CrewDef = {
  rig: RIG, stance: STANCE, states: STATES, moves: MOVES, specials: SPECIALS, kit: KIT,
  physics: { walk: .095, run: .175, dashInitial: .19, friction: .0055, jumpsquat: 3, fullHop: .245, shortHop: .15, airJump: .225, jumps: 3, gravity: .0105, terminal: .17, fastFall: .24, airSpeed: .1, airAccel: .0075, airFriction: .0012, weight: 78, landing: 3, shieldSize: .85 },
  timing: { turn: [8], dash: [11], rollF: [28, 3, 16], rollB: [28, 3, 16], spotdodge: [24, 2, 15], getup: [26, 1, 20] },
  element: { color: '#8ff0d0', hot: '#f0fff8' }, stride: { walk: .95, run: 1.6 },
  springs: { tail: [.06, .86, 10, 80], ribbon: [.03, .9, 6, 120], sash: [.06, .86, 14, 80] },
};
