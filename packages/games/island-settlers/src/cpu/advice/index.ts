/**
 * Module advisors: what the generic planner cannot read from a command's `hint` alone. Each active
 * module may add settlement bonuses, rate its own commands in planner units and answer its own
 * commands and prompts. Everything else falls back to the generic planner and filler.
 */
import type { CardPicks, Command, ModuleId, Picks, VertexId } from '../../model';
import type { Ctx } from '../context';
import type { Needs } from '../trade';
import { citiesKnights } from './cities-knights';
import { explorers } from './explorers';
import { seafarers } from './seafarers';
import { caravans, fishing, rivers } from './scenarios';

export type Answer = { picks: Picks; cards: CardPicks };

export type Advisor = {
  /** Extra VP a new settlement on `v` brings this seat (island bonus, river gold...). */
  spot?(c: Ctx, v: VertexId): number;
  /** Worth of running `cmd` now in planner units (about 2.2 per VP); null leaves it to the hint. */
  worth?(c: Ctx, cmd: Command): number | null;
  /** Answer for this module's command or prompt; undefined falls back to the generic filler. */
  answer?(c: Ctx, cmd: Command, n: Needs): Answer | null | undefined;
};

/** Planner units per VP (a city scores about 2.3, a settlement about 2.1). */
export const VP = 2.2;

const ADVISORS: Partial<Record<ModuleId, Advisor>> = {
  'cities-knights': citiesKnights, seafarers, explorers, fishing, rivers, caravans,
};

const spotters = new WeakMap<readonly ModuleId[], Advisor[]>();

/** Sum of the active modules' settlement bonuses at `v`, in VP. */
export function spotBonus(c: Ctx, v: VertexId) {
  let list = spotters.get(c.pub.modules);
  if (!list) {
    list = c.pub.modules.flatMap(id => (ADVISORS[id]?.spot ? [ADVISORS[id]] : []));
    spotters.set(c.pub.modules, list);
  }
  return list.reduce((n, a) => n + a.spot!(c, v), 0);
}

/** A module command's worth: its advisor's estimate, else the engine hint scaled by the persona. */
export function worth(c: Ctx, cmd: Command): number {
  const own = cmd.module === 'core' ? null : ADVISORS[cmd.module]?.worth?.(c, cmd);
  return own ?? cmd.hint * 2 * c.persona.modules;
}

export const advisedAnswer = (c: Ctx, cmd: Command, n: Needs) =>
  (cmd.module === 'core' ? undefined : ADVISORS[cmd.module]?.answer?.(c, cmd, n));
