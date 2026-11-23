/** Toll, the Bellyard's old casting automaton: a heavy with armoured specials. Everything here was authored for him. */
import type { CrewDef } from '../types';
import { KIT, MOVES, SPECIALS } from './moves';
import { RIG } from './rig';
import { STANCE, STATES } from './states';

export const TOLL: CrewDef = {
  rig: RIG, stance: STANCE, states: STATES, moves: MOVES, specials: SPECIALS, kit: KIT,
  physics: { walk: .06, run: .105, dashInitial: .11, friction: .009, jumpsquat: 6, fullHop: .2, shortHop: .125, airJump: .19, jumps: 2, gravity: .0115, terminal: .2, fastFall: .27, airSpeed: .062, airAccel: .004, airFriction: .001, weight: 122, landing: 6, shieldSize: 1.3 },
  timing: { turn: [14], dash: [18], getup: [36, 1, 26], rollF: [38, 5, 20], rollB: [38, 5, 20], spotdodge: [28, 3, 16] },
  element: { color: '#ffd27a', hot: '#fff6d8' }, stride: { walk: .8, run: 1.35 },
  springs: { clapper: [.03, .9, 26, 55], charm: [.02, .92, 28, 110] },
};
