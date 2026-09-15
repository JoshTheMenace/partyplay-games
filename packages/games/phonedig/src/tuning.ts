import { UPGRADES, applyUpgrades } from './worldgen';
import type { Owned, Tune } from './worldgen';

/* The party build has no shop, so it has no ladder to climb — every player
 * arrives with the same kit. Half of every upgrade's tiers is the middle of the
 * roguelike's curve: enough that the tools feel bought rather than borrowed,
 * short of the top tiers that were priced to be a whole run's saving.
 *
 * The Relic Cache is excluded. It is a terminal purchase that buys nothing the
 * simulation reads — what it changes is which relic a run starts carrying, and
 * that is meta-progression, which is the thing this build removes.
 *
 * This preset preserves the one safety invariant the shop was written around:
 * monsters top out at 7.36 and Boots tier 2 puts the player at 9.0, so a clear
 * tunnel is always an escape. Raising Boots past tier 3 would break that. */
export const MIDGAME_TIERS: Record<string, number> = Object.freeze(
  Object.fromEntries(
    UPGRADES.filter(u => !u.endgame).map(u => [u.id, Math.ceil(u.costs.length / 2)]),
  ),
) as Record<string, number>;

/** The one tune every room runs. Frozen by applyUpgrades. */
export const PARTY_TUNE: Tune = applyUpgrades(MIDGAME_TIERS as Owned);

/* ── the co-op rules ──────────────────────────────────────────────────────
 *
 * These are the party build's own numbers and have no equivalent upstream: the
 * roguelike ends a run on the hit that takes your last health, because there is
 * nobody else down there. A crew changes the question from "did you die" to
 * "can they reach you in time", and the answer has to be reachable — the window
 * is long enough to cross most of a level, because crossing it is the cost.
 */
export const COOP = Object.freeze({
  /** Team lives, spent only when nobody reaches a downed digger in time. */
  LIVES: 3,
  /** Seconds a downed digger stays reachable before a life is spent. */
  DOWN_WINDOW: 25,
  /** Pumps needed to pull a downed digger back onto their feet.
   *
   *  You revive them the way you kill everything else down here: harpoon them
   *  and pump. It reuses the verb the whole game is built on, it works at
   *  harpoon range so the rescuer is not obliged to stand on top of whatever
   *  put them down, and the line still stops on dirt — so reaching them is
   *  digging to them, which is where this started.
   *
   *  Ten, and deliberately not quick. Each pump visibly inflates them, so a
   *  short count gave the rescue animation no time on screen; and a revive the
   *  rescuer has to stand still and pump through is a real decision when the
   *  thing that put them down is still in the tunnel. Still under a monster's
   *  default twelve, so a rescue never costs more than the fight. */
  REVIVE_PUMPS: 10,
  /** Health a revived digger stands up with. Enough to move, not to fight. */
  REVIVE_HP: 2,
  /** Health after respawning at the entry pocket, which costs a team life. */
  RESPAWN_HP: 3,
  /** Grace on standing up, so the thing that downed you cannot immediately
   *  repeat it while the player is still working out where they are. */
  REVIVE_INVULN: 3,

  /** Seconds the crew has to pick a suit before the drill starts regardless. */
  KIT_SECONDS: 30,
  /** Once everyone has picked, this long to change your mind before it starts.
   *  Without it the last person to tap never gets a second look. */
  KIT_GRACE: 2.5,
});
