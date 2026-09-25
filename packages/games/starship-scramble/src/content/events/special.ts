/** Events the run engine triggers by id (SPECIAL_EVENT_IDS). */
import type { EventDef } from '../types';
import { ev, fight, hull, opt, opt1, out, sys } from './dsl';

export const SPECIAL: readonly EventDef[] = [
  ev('armada-ambush', 'any', [], 'The Armada Catches Up', "Crimson hulls tear out of warp on every side. The Armada was faster than anyone hoped, and it brought friends.", [
    opt1('fight', 'Fight our way out', "Gold trim, red paint and a lot of guns. Make them regret catching up.", [fight(['armada-interceptor', 'armada-gunship'])]),
    opt('slip', 'Cloak the fleet and slip away', [
      out("The cloaked ship masks the whole fleet's wake. The Armada fires at empty space.", [], 3),
      out("You slip away, but not before a broadside rakes every hull.", [hull(-4)], 2),
    ], sys('cloak')),
  ]),
  ev('flagship-hail', 'any', [], 'The Flagship Hails', "The Flagship fills the viewscreen, then the sky. 'Little fleet. You ran so far. Let me show you why it never mattered.'", [
    opt1('fight', 'Battle stations', "Every captain, every gun, one last fight. End the Armada here.", [fight(['flagship'], { objective: 'destroy' })]),
  ]),
];
