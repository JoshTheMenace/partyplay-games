/** Vesper, the glasswright: a zoner with long reach, a slow floating trap and a counter. Everything here was authored for her. */
import type { CrewDef } from '../types';
import { KIT, MOVES, SPECIALS } from './moves';
import { RIG } from './rig';
import { STANCE, STATES } from './states';

export const VESPER: CrewDef = {
  rig: RIG, stance: STANCE, states: STATES, moves: MOVES, specials: SPECIALS, kit: KIT,
  physics: { walk: .085, run: .14, dashInitial: .145, friction: .007, jumpsquat: 4, fullHop: .22, shortHop: .135, airJump: .2, jumps: 2, gravity: .0095, terminal: .16, fastFall: .23, airSpeed: .088, airAccel: .006, airFriction: .0012, weight: 96, landing: 4, shieldSize: 1.0 },
  element: { color: '#bfeaff', hot: '#ffffff' }, stride: { walk: 1.06, run: 1.8 },
  springs: { tail: [.06, .85, 16, 55], braid: [.05, .88, 14, 90] },
};
