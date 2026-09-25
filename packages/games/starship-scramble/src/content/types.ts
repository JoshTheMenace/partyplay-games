/** Server-only content schema. Never import src/content from browser code. */
import type { BossPhase, CrewRole, EnemyAi, Hazard, NodeKind, SpeciesId, SystemId, WeaponKind } from '../contracts';

/** A requirement makes a choice "blue": shown with a badge, available only if some ship in the fleet qualifies. */
export type Requirement =
  | { kind: 'system'; system: SystemId; tier: number }
  | { kind: 'weapon'; weaponKind: WeaponKind }
  | { kind: 'species'; species: SpeciesId }
  | { kind: 'role'; role: CrewRole }
  | { kind: 'augment'; augment: string }
  /** Costs `amount` per captain, pooled: available if the fleet's total scrap covers amount × captains; richer captains cover poorer ones. Deducted when chosen; scaled by sector tier like scrap effects. */
  | { kind: 'scrap'; amount: number };
/** 'fleet' = every active ship; 'random' = one random active ship; 'weakest' = lowest hull fraction. */
export type Who = 'fleet' | 'random' | 'weakest';
export type EventEffect =
  | { kind: 'scrap'; amount: number }                              // per captain: each captain gains (or, if negative, pays up to) this; the engine scales by sector tier
  | { kind: 'hull'; amount: number; who: Who }                      // +repair / -damage
  | { kind: 'item'; item: 'weapon' | 'augment'; tier?: 1 | 2 | 3; id?: string } // goes to the claimable loot pool
  | { kind: 'crew'; species?: SpeciesId; role?: CrewRole }          // joins the captain with the fewest crew
  | { kind: 'crewDamage'; amount: number; who: Who }                // damages every crew aboard the chosen ship(s)
  | { kind: 'crewLoss' }                                           // one random allied crew member dies
  | { kind: 'ammo'; amount: number; who: Who }
  | { kind: 'systemDamage'; system: SystemId; amount: number; who: Who }
  | { kind: 'upgrade'; system: SystemId; who: Who }                // free tier if below max
  | { kind: 'combat'; enemies: string[] | 'sector'; hazard?: Hazard; objective?: 'destroy' | 'survive'; bonus?: number } // enemy ids or a sector-appropriate squad; bonus multiplies loot
  | { kind: 'store' }                                              // open a store after this event
  | { kind: 'armada'; amount: number }                              // +n advances the pursuit front, -n delays it
  | { kind: 'reveal' }                                             // reveal all node kinds in this sector
  | { kind: 'reserves'; amount: number }                            // fleet rebuild charges
  | { kind: 'flag'; flag: string }                                 // set a run flag (quest chains)
  | { kind: 'event'; eventId: string };                             // chain straight into a follow-up event
export type Outcome = { weight: number; text: string; effects: EventEffect[] };
export type ChoiceDef = { id: string; label: string; requires?: Requirement; outcomes: Outcome[] };
export type EventDef = {
  id: string; title: string; text: string;
  /** Sector ids this event may appear in, or 'any'. */ sectors: string[] | 'any';
  /** Node kinds that may draw this event. Follow-ups use []. */ kinds: NodeKind[];
  weight: number; unique?: boolean; requiresFlag?: string;
  /** At least one choice; a single-choice event is a no-decision beat. */ choices: ChoiceDef[];
};
export type EnemyDef = {
  id: string; name: string; faction: 'raiders' | 'vesk' | 'wardens' | 'armada'; hullId: string; ai: EnemyAi;
  weapons: string[]; systems: Partial<Record<import('../contracts').SystemId, number>>; hullBonus: number;
  crew: { species: SpeciesId; role: CrewRole }[]; fleeBelow: number; threat: number; scrap: [number, number];
  phases?: BossPhase[];
};
export type SectorDef = { id: string; name: string; theme: string; blurb: string; factions: EnemyDef['faction'][]; hazards: Hazard[]; tier: 1 | 2 | 3 | 4 };

/** Every enemy id the content may reference. The run owner defines exactly these in src/content/enemies.ts. */
export const ENEMY_IDS = ['raider-skiff', 'raider-brawler', 'raider-gunship', 'rogue-trader', 'vesk-scout', 'vesk-hive', 'vesk-brood', 'warden-drone', 'warden-lancer', 'warden-sentinel', 'armada-interceptor', 'armada-gunship', 'armada-dreadnought', 'flagship'] as const;
export const SECTOR_IDS = ['rustbelt', 'veil', 'meridian'] as const;
/** Events the run engine triggers by id (content must define them, with kinds: []). */
export const SPECIAL_EVENT_IDS = ['armada-ambush', 'flagship-hail'] as const;
