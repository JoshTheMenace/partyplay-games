/** Sola, the Lamplighter: an all-rounder with reach. Everything here was authored for her: physics, frame data, hitboxes on the pike, specials and every clip. */
import type { CrewDef } from '../types';
import { KIT, MOVES, SPECIALS } from './moves';
import { RIG } from './rig';
import { STANCE, STATES } from './states';

export const SOLA: CrewDef = {
  rig: RIG, stance: STANCE, states: STATES, moves: MOVES, specials: SPECIALS, kit: KIT,
  physics: { walk: .085, run: .14, dashInitial: .15, friction: .0065, jumpsquat: 4, fullHop: .23, shortHop: .14, airJump: .22, jumps: 2, gravity: .011, terminal: .19, fastFall: .26, airSpeed: .08, airAccel: .0055, airFriction: .0015, weight: 95, landing: 4, shieldSize: .95 },
  element: { color: '#ff9a3c', hot: '#fff2c4' }, stride: { walk: 1.0, run: 2.3 },
  springs: { tail: [.08, .82, 16, 70], scarf: [.05, .86, 14, 85], lantern: [.012, .93, 30, 170] },
};
