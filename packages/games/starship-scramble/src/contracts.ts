/**
 * Starship Scramble v2 — the frozen shared contract between simulation, run logic, TV and phone.
 * Everything here is browser-safe. Server-only content (events, enemies, sectors) lives in src/content.
 * Units: grid cells for positions, milliseconds of *combat time* (pauses stop it) for combat timers.
 */
import type { GameClientContext } from '../../../party-contract/src/index';

/** Version 2 packs ships, crew and shots as rows (a 64-captain battle would not fit the room's 256 KiB save limit as keyed objects); version 1 saves still load. */
export const SAVE_VERSION = 2;

// ---------- identifiers ----------
export type SystemId = 'helm' | 'engines' | 'shields' | 'weapons' | 'oxygen' | 'medbay' | 'teleporter' | 'cloak' | 'defense';
export type SpeciesId = 'human' | 'bastion' | 'skitter' | 'ember' | 'lumen';
export type CrewRole = 'pilot' | 'gunner' | 'engineer' | 'medic' | 'soldier';
export type WeaponKind = 'laser' | 'missile' | 'beam' | 'ion' | 'flak' | 'support';
export type Hazard = 'none' | 'asteroids' | 'solar' | 'ion-storm' | 'nebula';
export type Faction = 'ally' | 'enemy';

export type RunLength = 'short' | 'standard' | 'long';
export type Settings = { difficulty: 'cadet' | 'captain'; length: RunLength };
/** Sectors per run by length; the last sector's exit is the Flagship. */
export const RUN_SECTORS: Record<RunLength, number> = { short: 1, standard: 3, long: 5 };

// ---------- wings ----------
/**
 * A fleet flies in wings of up to WING_SIZE ships. Each wing fights its own engagement of a battle (its own enemy squad, loot and store shelf);
 * a fleet of one to four captains is a single wing and plays as it always did. Wings fill in seat order with sizes within one of each other.
 */
export const WING_SIZE = 4;
export const WINGS = ['Anvil', 'Beacon', 'Comet', 'Drift', 'Echo', 'Falcon', 'Garnet', 'Harbor', 'Indigo', 'Jade', 'Kestrel', 'Lantern', 'Mistral', 'Nova', 'Onyx', 'Pike'] as const;
export const WING_COLORS = ['#ffb347', '#5cc8ff', '#b58aff', '#78d955', '#ff7ac8', '#ffd24a', '#ff6b4a', '#5fe0c0', '#8c9bff', '#9be36b', '#ff9b3d', '#f4e58a', '#7fd6f2', '#ff8fa8', '#c9d1e8', '#e39bff'] as const;
export const wingCount = (captains: number) => Math.max(1, Math.ceil(captains / WING_SIZE));
/** The wing seat `seat` flies in, for a fleet of `captains`. */
export function wingOf(seat: number, captains: number) {
  const wings = wingCount(captains), small = Math.floor(captains / wings), big = captains % wings, cut = big * (small + 1);
  return seat < cut ? Math.floor(seat / (small + 1)) : big + Math.floor((seat - cut) / small);
}
/** "A · Anvil": the letter is what a crowded screen shows. */
export const wingName = (wing: number) => WINGS[wing % WINGS.length];
export const wingLetter = (wing: number) => String.fromCharCode(65 + wing % 26);
/** Ships a fleet may lose in one battle before it breaks: it is beaten when this many or fewer are still flying (0 for a single wing: every ship must fall). */
export const routLine = (captains: number) => Math.floor((captains - 1) / WING_SIZE);

// ---------- browser-safe definitions (src/defs) ----------
/** A room is an axis-aligned rectangle of grid cells. Ships face +x (nose right); enemies are drawn mirrored. */
export type RoomDef = { id: string; x: number; y: number; w: number; h: number; system: SystemId | null };
/** A door joins two rooms along one shared cell edge. (x,y) is the edge midpoint in cell units. */
export type DoorDef = { a: string; b: string; x: number; y: number; vertical: boolean };
export type HullDef = {
  id: string; name: string; blurb: string; role: string; player: boolean;
  gridW: number; gridH: number; rooms: RoomDef[]; doors: DoorDef[];
  maxHull: number; weaponSlots: number; automated: boolean;
  /** Installed tiers at creation; systems with a room but no entry start at tier 0 (purchasable). */
  startSystems: Partial<Record<SystemId, number>>;
  startWeapons: string[]; startCrew: { species: SpeciesId; role: CrewRole }[]; startAmmo: number; paint: string;
};
export type WeaponDef = {
  id: string; name: string; kind: WeaponKind; blurb: string; price: number; tier: 1 | 2 | 3;
  chargeMs: number; shots: number; damage: number; pierce: number; ion: number; crewDamage: number;
  fireChance: number; breachChance: number; ammo: number;
  /** Beams sweep this many rooms starting at the target room (following doors). */
  beamRooms?: number;
  /** Support weapons target allied ships. */
  support?: 'repair' | 'shield' | 'heal';
  target: Faction;
};
export type SystemDef = { id: SystemId; name: string; short: string; blurb: string; maxTier: number; installPrice: number; upgradePrices: number[] };
export type AugmentDef = { id: string; name: string; blurb: string; price: number };
export type SpeciesDef = { id: SpeciesId; name: string; blurb: string; maxHp: number; speed: number; melee: number; repair: number; color: string };

// ---------- live combat state (server-authoritative, fully public) ----------
export type RoomState = {
  id: string; system: SystemId | null;
  /** Installed level (0 = not installed). */ tier: number;
  /** Damaged levels, 0..tier. Effective level = tier - damage (0 while ionized). */ damage: number;
  ionMs: number; fire: number; breach: boolean; oxygen: number; repair: number;
};
export type WeaponState = { uid: string; defId: string; charge: number; target: { shipId: string; roomId: string } | null; auto: boolean; powered: boolean };
export type ShipStatus = 'active' | 'destroyed' | 'fled';
export type Ship = {
  id: string; faction: Faction; captainId: string | null; enemyId: string | null; hullId: string; name: string; paint: string;
  /** The engagement this ship fights in: its captain's wing, the wing an enemy was sent against, or −1 for the Flagship, which fights every wing at once. */ wing: number;
  /** Formation slot within its wing and faction, 0..n-1, used for scene placement. */ slot: number;
  hull: number; maxHull: number; shields: number;
  /** Progress to the next layer 0..1; negative while ion locks recharge (clamp for display). */ shieldCharge: number; tempShield: number; tempShieldMs: number;
  rooms: RoomState[]; weapons: WeaponState[]; ammo: number; augments: string[];
  status: ShipStatus; cloakMs: number; cloakCooldownMs: number; teleportCooldownMs: number; defenseCooldownMs: number;
  /** Enemy escape countdown (combat ms when it jumps away) or null. */ fleeAtMs: number | null;
  /** Boss phase index into `phases`, which lists ALL boss phases (phases[0] is the opening one; [] for ordinary ships). At 0 hull the next phase replaces hull/weapons/systems. */ phase: number; phases: BossPhase[];
  /** Enemy behavior, or null for player ships (autopilot uses 'balanced'). */ ai: EnemyAi | null;
  /** Enemy starts its escape countdown when hull/maxHull drops below this fraction (0 = never flees). */ fleeBelow: number;
  /** True while the captain is disconnected or absent: weapons auto-target and crew hold stations. */ autopilot: boolean;
  /** Damage control: idle crew answer boarders, fires, breaches and damage by themselves and walk back when done (the captain's own orders always win). */ assist: boolean;
  /** Fleet-scale ships (the Flagship against several wings) carry `scale` times the shield layers and shrug off system, crew, fire and breach effects in proportion, so every wing fights the ship a single wing would. 1 for everything else. */ scale: number;
  /** Last ship that damaged this one, for kill credit. */ lastHitBy: string | null;
};
export type EnemyAi = 'balanced' | 'weapons' | 'shields' | 'boarder' | 'hunter';
export type BossPhase = { maxHull: number; weapons: string[]; systems: Partial<Record<SystemId, number>>; line: string };
export type CrewState = 'idle' | 'walking' | 'manning' | 'repairing' | 'fighting' | 'extinguishing' | 'healing' | 'dead';
export type Crew = {
  id: string; name: string; species: SpeciesId; role: CrewRole; faction: Faction;
  /** Owning captain (allies) or null (enemy crew). Ownership never changes. */ ownerId: string | null;
  shipId: string; roomId: string; x: number; y: number; hp: number; maxHp: number; state: CrewState;
  /** Room this crew returns to on "Stations". */ station: string | null;
  /** Remaining room path when walking. */ path: string[];
  /** Queued teleport: walking to their own teleporter, then beaming here with the rest of their group. */ beam?: { shipId: string; roomId: string };
  /** Sent somewhere by damage control: the room to walk back to when the job is done. */ back?: string;
};
export type Projectile = {
  id: string; kind: WeaponKind; weaponId: string; fromShipId: string; toShipId: string; roomId: string;
  /** Weapon slot index on the source ship (muzzle position). */ mount: number;
  launchMs: number; arriveMs: number;
};
export type CombatEventType = 'launch' | 'hit' | 'miss' | 'shield' | 'intercept' | 'fire' | 'breach' | 'ion' | 'repair' | 'heal' | 'crew-death' | 'teleport' | 'explode' | 'flee' | 'cloak' | 'phase' | 'hazard' | 'system-down';
/**
 * shipId is the ship the event happens on; weaponId is always a weapon DEF id; fromShipId is the attacker/source.
 * launch: shipId = the firing ship (one event per weapon fired; its shots are in `projectiles`). hit/miss/shield/ion/heal: shipId = target, fromShipId = shooter.
 * intercept: shipId = the defender whose point defense fired, fromShipId = the attacker. teleport: emitted on both ships (roomId = the room on that ship), fromShipId = the origin ship, amount = crew count.
 * phase: amount = new phase index. explode: fromShipId = last attacker. shield: amount = layers removed. repair: crewId = first repairer.
 */
export type CombatEvent = { id: string; type: CombatEventType; atMs: number; shipId: string; roomId?: string; amount?: number; weaponId?: string; fromShipId?: string; crewId?: string };
export type CombatObjective = 'destroy' | 'survive' | 'boss';
export type Combat = {
  id: string; t: number; paused: boolean; pausedBy: string | null; hazard: Hazard; objective: CombatObjective;
  /** Survive objective ends at this combat ms. */ surviveUntilMs: number | null;
  /** Fleet FTL drive charge 0..1; at 1 the fleet may vote to jump away (not in boss fights). jumpVotes holds captain ids. */ ftl: number; jumpVotes: string[];
  projectiles: Projectile[];
  /** Rolling window of recent events (~4 s) for animation/audio; ids are unique for the whole run. */ events: CombatEvent[];
  introUntilMs: number;
  /** Enemy weapon charge-rate multiplier (Cadet 0.8). */ enemyCharge: number;
  outcome: 'victory' | 'escaped' | 'defeat' | null; nextId: number; rng: number;
};
/** Stalemate breaker: after OVERHEAT_MS[0] of fighting (post-intro) every ship's shield recharge slows linearly, stopping at OVERHEAT_MS[1]. Returns 0..1 for display. */
export const OVERHEAT_MS = [60000, 150000] as const;
export const overheat = (c: Pick<Combat, 't' | 'introUntilMs'>) => Math.min(1, Math.max(0, (c.t - c.introUntilMs - OVERHEAT_MS[0]) / (OVERHEAT_MS[1] - OVERHEAT_MS[0])));

// ---------- run state ----------
export type NodeKind = 'start' | 'unknown' | 'hostile' | 'distress' | 'store' | 'nebula' | 'elite' | 'drydock' | 'derelict' | 'wormhole' | 'exit' | 'boss';
/** A link to a node more than one column ahead is a wormhole shortcut. Exits name the sector they lead to. */
export type MapNode = { id: string; col: number; row: number; x: number; y: number; kind: NodeKind; links: string[]; visited: boolean; hazard: Hazard; dest?: { id: string; name: string; blurb: string } };
export type SectorMap = { sectorId: string; name: string; theme: string; nodes: MapNode[]; currentId: string; armadaCol: number; columns: number };
export type ItemKind = 'weapon' | 'augment';
/** Loot belongs to a wing: only its captains may claim it. */
export type Item = { id: string; kind: ItemKind; defId: string; ownerId: string | null; wing?: number };
/** Store stock. Crew offers are specific recruits (defId is their role); not every store has them. */
export type Offer = { id: string; kind: ItemKind | 'system' | 'crew'; defId: string; price: number; soldTo: string | null; /** Every wing has its own shelf. */ wing: number; crew?: { name: string; species: SpeciesId; role: CrewRole } };
/** votes holds captain ids. */
export type EventChoiceView = { id: string; label: string; badge: string | null; available: boolean; votes: string[] };
export type EventView = { id: string; title: string; text: string; choices: EventChoiceView[]; result: string | null; resultLines: string[]; deadlineMs: number | null };
export type Captain = {
  id: string; playerId: string | null; name: string; color: string; connected: boolean; wing: number;
  shipId: string | null; hullId: string | null; scrap: number; ready: boolean; vote: string | null;
  /** Unequipped cargo (weapons not installed). Augments are always active on the ship. */ cargo: Item[];
  stats: { damage: number; kills: number; repairs: number; scrapEarned: number; saves: number };
};
export type Phase = 'hangar' | 'map' | 'event' | 'combat' | 'loot' | 'store' | 'over';
export type Loot = { scrapEach: number; items: Item[]; claims: Record<string, string> };

// ---------- actions (every action carries the current turn) ----------
export type Action = { turn: number } & (
  | { type: 'hangar'; hullId: string; name: string; paint: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'vote'; nodeId: string }
  | { type: 'choose'; choiceId: string }
  | { type: 'target'; weapon: string; shipId: string; roomId: string }
  | { type: 'untarget'; weapon: string }
  | { type: 'autofire'; weapon: string; auto: boolean }
  | { type: 'fire' }
  | { type: 'crew'; crewIds: string[]; roomId: string }
  | { type: 'stations' }
  | { type: 'teleport'; crewIds: string[]; shipId: string; roomId: string }
  | { type: 'recall'; shipId: string }
  | { type: 'cloak' }
  | { type: 'pause'; paused: boolean }
  | { type: 'assist'; on: boolean }
  | { type: 'jump'; vote: boolean }
  | { type: 'claim'; itemId: string }
  | { type: 'buy'; offerId: string }
  | { type: 'sell'; itemId: string }
  | { type: 'repair'; amount: number }
  | { type: 'ammo' }
  | { type: 'upgrade'; system: SystemId }
  | { type: 'equip'; itemId: string; slot: number }
  | { type: 'unequip'; slot: number }
);
export type ActionType = Action['type'];
/** No continuous input: all play is reliable actions. */
export type Input = null;

// ---------- views ----------
export type ShipView = Ship & {
  /** Derived for display: current evasion %, max shield layers (excluding the temporary tempShield layer), effective levels by system. */
  evasion: number; maxShields: number; levels: Partial<Record<SystemId, number>>;
};
export type CaptainView = Omit<Captain, 'cargo'> & { cargo: Item[]; status: 'flying' | 'wrecked' | 'lifeboat' };
/** A ship as the fleet broadcast draws it: the hull, its bars and its state, without the interior. */
export type FleetShip = Pick<Ship, 'id' | 'wing' | 'faction' | 'captainId' | 'hullId' | 'name' | 'paint' | 'slot' | 'hull' | 'maxHull' | 'shields' | 'status' | 'phase'> & {
  maxShields: number; /** Boss phases in all (0 for ordinary ships). */ phases: number; cloaked: boolean; fleeing: boolean; /** Rooms on fire. */ fires: number };
export type FleetShot = Pick<Projectile, 'id' | 'kind' | 'fromShipId' | 'toShipId' | 'launchMs' | 'arriveMs'>;
export type PublicView = {
  phase: Phase; turn: number; settings: Settings;
  /**
   * A single wing (one to four captains) sees everything: `ships`, `crew` and the battle's projectiles and events cover the whole fight.
   * A fleet of several wings gets `fleet` (every ship without its interior, and the shots in flight) and each phone additionally its own
   * wing's engagement in `ships`, `crew`, projectiles and events; a TV gets none of those and draws the broadcast from `fleet`.
   */
  captains: CaptainView[]; ships: ShipView[]; crew: Crew[]; fleet: { ships: FleetShip[]; shots: FleetShot[] } | null;
  combat: Combat | null;
  map: SectorMap; sectorIndex: number; sectorCount: number; /** Names of the sectors flown so far, in order. */ route: string[];
  event: EventView | null; loot: Loot | null; store: { offers: Offer[]; repairPrice: number; ammoPrice: number } | null;
  /** Votes resolve at this server wall-clock ms (map/event), or null while waiting for a first vote. Big fleets also close the hangar, loot and store on it. */ voteDeadline: number | null;
  reserves: number; message: string; result: 'victory' | 'defeat' | 'suspended' | null;
  fleetStats: { jumps: number; kills: number; scrap: number; lostShips: number };
};
export type PrivateView = { captainId: string | null };
/** What the UI components receive: the decoded view for this screen (see src/wire.ts for what travels). */
export type ClientProps = GameClientContext<Input, Action, PublicView, PrivateView>;
