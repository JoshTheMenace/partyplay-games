/**
 * Combat simulation API (frozen signatures; implemented in core/crew/combat/commands).
 * Pure, deterministic functions over plain serializable data. Randomness comes only from combat.rng / an explicit seed.
 * All user-facing rejections throw Error with a short, friendly message.
 */
import type { Action, BossPhase, Combat, CombatObjective, Crew, CrewRole, EnemyAi, Faction, Hazard, Ship, SpeciesId, SystemId } from '../contracts';
import { derive } from './core';

export type ShipSpec = {
  id: string; faction: Faction; captainId: string | null; enemyId: string | null; hullId: string; name: string; paint: string; slot: number;
  /** Defaults from the hull. */ maxHull?: number; hull?: number; systems?: Partial<Record<SystemId, number>>;
  weapons: string[]; ammo: number; augments: string[]; ai: EnemyAi | null; fleeBelow: number; phases: BossPhase[];
};
export type CrewSpec = { id: string; name: string; species: SpeciesId; role: CrewRole; faction: Faction; ownerId: string | null; hp?: number };
export type World = { ships: Ship[]; crew: Crew[] };
export type CombatWorld = World & { combat: Combat };
type WithoutTurn<A> = A extends { turn: number } ? Omit<A, 'turn'> : never;
export type CombatCommand = WithoutTurn<Extract<Action, { type: 'target' | 'untarget' | 'autofire' | 'fire' | 'crew' | 'stations' | 'teleport' | 'recall' | 'cloak' }>>;
export type StartOptions = { id: string; seed: number; hazard: Hazard; objective: CombatObjective; surviveMs?: number; enemyCharge?: number };

/** Build a ship from its hull, applying spec overrides. Weapon uids are `${ship.id}-w${index}`; rooms start at 100% oxygen. */
export { createShip } from './core';
/** Create a crew member aboard `ship`, in its role's station room when free, else any free slot. Does not add it to world.crew. */
export { createCrew } from './core';
/** Derived display/rule values: evasion %, maximum shield layers and effective system levels. */
export function deriveShip(ship: Ship, world: World): { evasion: number; maxShields: number; levels: Partial<Record<SystemId, number>> } {
  return derive(ship, world.crew.filter(m => m.shipId === ship.id), (world as Partial<CombatWorld>).combat?.hazard === 'nebula');
}
/** Begin a battle among world.ships (allies + already-created enemies). Resets charge/targets, starts a short intro. */
export { startCombat } from './combat';
/** Advance combat by dtMs of combat time (no-op while paused, in intro, or finished). Runs enemy AI, autopilot allies, hazards, boss phases, and sets combat.outcome. */
export { stepCombat } from './combat';
/** Apply a captain's combat order. Captains command only their own weapons and their own crew (wherever they are). */
export { applyCombatCommand } from './commands';
/** Out of combat: crew walk, repair, extinguish, heal and oxygen refills continue; nothing hostile happens. */
export { stepIdle } from './crew';
/** Move a captain's crew (any ship) to a room on the ship they are standing on, out of combat as well. */
export { orderCrew } from './crew';
