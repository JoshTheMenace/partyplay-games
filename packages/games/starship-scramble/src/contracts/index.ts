import type { GameClientContext } from '../../../../party-contract/src/index';
export const SCHEMA_VERSION = 1;
export const CONTENT_VERSION = 2;
export type CaptainId = string;
export type ShipId = string;
export type CrewId = string;
export type SpeciesId = 'human' | 'bastion' | 'skitter' | 'ember';
export type Phase = 'assignment' | 'hangar' | 'route' | 'event' | 'combat' | 'rewards' | 'store' | 'results';
export type Settings = { difficulty: 'relaxed' | 'standard'; expedition: 'standard' | 'training' };
export type WeaponFamily = 'laser' | 'beam' | 'missile' | 'flak' | 'ion' | 'plasma' | 'boarding' | 'support';
export type SystemId = 'piloting' | 'engines' | 'shields' | 'weaponry' | 'life-support' | 'doors' | 'medical' | 'teleporter' | 'drone-bay' | 'hacking' | 'cloak' | 'point-defense' | 'shield-projector' | 'repair-relay' | 'tractor' | 'scanner' | 'decoy' | 'boarding-defense' | 'medical-support';
export type RoomDefinition = { id: string; name: string; x: number; y: number; w: number; h: number; capacity: number; system: SystemId | null; adjacent: string[] };
export type HullDefinition = { id: string; name: string; description: string; color: string; maxHull: number; maxWeapons: number; rooms: RoomDefinition[]; startingWeapons: string[]; startingSystems: SystemId[]; crew: number; traits: string[] };
export type WeaponDefinition = { id: string; name: string; description: string; family: WeaponFamily; price: number; chargeMs: number; damage: number; shieldDamage: number; pierce: number; roomDamage: number; crewDamage: number; fire: number; breach: number; ionMs: number; ammo: number; shots: number; tier: number; target: 'enemy' | 'ally'; tags: string[] };
export type SystemDefinition = { id: SystemId; name: string; description: string; price: number; cooldownMs: number; durationMs: number; strength: number; maxTier: number; tags: string[] };
export type DroneDefinition = { id: string; name: string; description: string; price: number; behavior: 'attack' | 'intercept' | 'repair' | 'board' | 'scan' | 'shield' | 'heal' | 'fire' | 'ion' | 'breach' | 'decoy' | 'salvage'; intervalMs: number; strength: number; hp: number; tags: string[] };
export type AugmentDefinition = { id: string; name: string; description: string; price: number; effect: 'hull' | 'evasion' | 'reload' | 'shield' | 'repair' | 'medical' | 'oxygen' | 'boarding' | 'scrap' | 'ammo' | 'sensors' | 'teleport'; strength: number; tags: string[] };
export type EnemyDefinition = { id: string; name: string; hullId: string; weapons: string[]; systems: SystemId[]; ai: 'aggressive' | 'shield-breaker' | 'boarder' | 'support' | 'artillery' | 'saboteur' | 'coward' | 'hunter'; threat: number; tags: string[] };
export type SectorDefinition = { id: string; name: string; description: string; color: string; tags: string[]; enemies: string[]; boss: string };
export type Definitions = { hulls: HullDefinition[]; weapons: WeaponDefinition[]; systems: SystemDefinition[]; drones: DroneDefinition[]; augments: AugmentDefinition[]; enemies: EnemyDefinition[]; sectors: SectorDefinition[]; events: EventDefinition[] };
export type Room = { id: string; system: SystemId | null; tier: number; damage: number; fire: number; breach: number; oxygen: number; locked: boolean; disruptedUntilMs: number };
export type WeaponOrder = { shipId: ShipId; roomId: string; hold: boolean };
export type InstalledWeapon = { itemId: string; definitionId: string; chargeMs: number; order: WeaponOrder | null };
export type InstalledSystem = { id: SystemId; tier: number; cooldownUntilMs: number; activeUntilMs: number; targetShipId: ShipId | null; targetRoomId: string | null };
export type Ship = { id: ShipId; ownerCaptainId: CaptainId | null; faction: 'allied' | 'enemy'; hullId: string; name: string; color: string; formation: number; hull: number; maxHull: number; status: 'active' | 'surrendered' | 'escaped' | 'destroyed' | 'abandoned'; rooms: Room[]; weapons: InstalledWeapon[]; systems: InstalledSystem[]; augments: string[]; shield: number; shieldChargeMs: number; ammo: number; ai: EnemyDefinition['ai'] | null; escapeAtMs: number | null };
export type CrewOrder = { kind: 'move' | 'repair' | 'fight' | 'heal' | 'hold'; roomId: string };
export type Crew = { id: CrewId; species?: SpeciesId; ownerCaptainId: CaptainId | null; homeShipId: ShipId; currentShipId: ShipId; name: string; roomId: string; x: number; y: number; hp: number; maxHp: number; status: 'alive' | 'dead' | 'captured' | 'dismissed'; skill: 'pilot' | 'engineer' | 'gunner' | 'medic' | 'fighter' | 'scientist'; traits: string[]; order: CrewOrder; activity: 'idle' | 'moving' | 'repairing' | 'fighting' | 'healing' | 'direct'; controlEpoch: number };
export type Projectile = { id: string; sourceShipId: ShipId; targetShipId: ShipId; roomId: string; weaponId: string; arriveAtMs: number; damage: number; shieldDamage: number; pierce: number; roomDamage: number; crewDamage: number; fire: number; breach: number; ionMs: number; family: WeaponFamily };
export type Drone = { id: string; definitionId: string; sourceShipId: ShipId; targetShipId: ShipId; targetRoomId: string; hp: number; nextAtMs: number };
export type CombatEffect = { id: string; kind: 'shot' | 'impact' | 'teleport' | 'repair' | 'destroyed' | 'shield' | 'warning'; sourceShipId: string; targetShipId: string; text: string; atMs: number };
export type CombatObjective = { kind: 'destroy' | 'survive' | 'escape' | 'defend' | 'finale'; deadlineMs: number | null; stage: number; description: string };
export type Simulation = { timeMs: number; rng: number; nextId: number; ships: Ship[]; crew: Crew[]; projectiles: Projectile[]; drones: Drone[]; effects: CombatEffect[]; objective: CombatObjective | null };
export type Item = { id: string; definitionId: string; kind: 'weapon' | 'drone' | 'augment' | 'system'; ownerCaptainId: CaptainId | null; carrierShipId: ShipId | null; location: 'loot' | 'cargo' | 'installed' | 'store' | 'destroyed' | 'sold'; price: number; version: number; stockCaptainId: CaptainId | null };
export type Captain = { id: CaptainId; playerId: string | null; name: string; color: string; currentOwnedShipId: ShipId | null; connected: boolean; wallet: number; cargoShipId: ShipId | null; ready: boolean; vote: string | null; contribution: string | null; stats: { damage: number; repairs: number; kills: number; collected: number }; abandonedCrew: boolean };
export type Capability = { kind: 'system' | 'weapon-family' | 'crew-skill' | 'item-tag'; id: string; tier?: number };
export type EventEffect =
  | { kind: 'scrap'; amount: number }
  | { kind: 'items'; count: number; tags?: string[] }
  | { kind: 'damage' | 'repair'; amount: number }
  | { kind: 'combat'; objective: CombatObjective['kind']; threat: number }
  | { kind: 'crew-health'; amount: number; skill?: Crew['skill'] }
  | { kind: 'ammo'; amount: number }
  | { kind: 'hazard'; hazard: 'fire' | 'breach' | 'oxygen'; amount: number }
  | { kind: 'reputation'; faction: string; amount: number }
  | { kind: 'timed-status'; system: SystemId; durationMs: number }
  | { kind: 'store' }
  | { kind: 'recruit'; skill: Crew['skill'] }
  | { kind: 'replacement'; hullId: string; cost: number }
  | { kind: 'threat'; amount: number }
  | { kind: 'flag'; id: string; value: boolean }
  | { kind: 'followup'; eventId: string };
export type EventChoice = { id: string; label: string; text: string; requirement: Capability | null; cost: number; effects: EventEffect[]; outcomes?: { weight: number; text: string; effects: EventEffect[] }[] };
export type EventDefinition = { id: string; category: 'travel' | 'distress' | 'hostile' | 'trade' | 'science' | 'faction' | 'quest'; title: string; text: string; tags: string[]; weight: number; sectors: string[]; requiresFlag?: string; minReputation?: { faction: string; amount: number }; choices: EventChoice[]; effects: EventEffect[]; repeatable: boolean };
export type Beacon = { id: string; column: number; lane: number; kind: 'event' | 'store' | 'combat' | 'exit'; label: string; next: string[]; visited: boolean; eventId: string | null };
export type EventInstance = { id: string; definitionId: string; resolved: boolean; choiceId: string | null; text: string; result: string; optionIds: string[] };
export type Expedition = { rng: number; sectorIds: string[]; sectorIndex: number; beacons: Beacon[]; currentBeaconId: string; seenRoots: string[]; event: EventInstance | null; items: Item[]; rewardRemainder: number; rewardSerial: number; threat: number; flags: Record<string, boolean>; reputation: Record<string, number>; completedBeacons: number; nextItemId: number };
export type DomainEvent = { kind: 'ship-destroyed'; shipId: string } | { kind: 'crew-lost'; crewId: string } | { kind: 'enemy-escaped'; shipId: string } | { kind: 'combat-complete'; result: 'victory' | 'escape' | 'defeat' | 'surrender' };
export type SimulationCommand =
  | { type: 'targetWeapon'; weaponId: string; targetShipId: string; roomId: string }
  | { type: 'holdFire'; weaponId: string; hold: boolean }
  | { type: 'orderCrew'; crewId: string; roomId: string; order: CrewOrder['kind'] }
  | { type: 'controlCrew'; crewId: string | null }
  | { type: 'teleportCrew'; crewIds: string[]; transporterShipId: string; targetShipId: string; roomId: string }
  | { type: 'activateSystem'; systemId: SystemId; targetShipId: string; roomId: string }
  | { type: 'deployDrone'; itemId: string; targetShipId: string; roomId: string }
  | { type: 'setDoor'; roomId: string; locked: boolean };
export type EconomyCommand =
  | { type: 'collectItem'; itemId: string; version: number }
  | { type: 'purchaseItem'; itemId: string; version: number }
  | { type: 'sellItem'; itemId: string; version: number }
  | { type: 'installItem'; itemId: string; replaceItemId: string | null }
  | { type: 'upgradeRoom'; roomId: string }
  | { type: 'repairHull' }
  | { type: 'buyAmmo' }
  | { type: 'transferCargo'; itemId: string | null; shipId: string }
  | { type: 'recruitCrew'; replaceCrewId: string | null; skill: Crew['skill']; species?: SpeciesId };
export type Action = { epoch: number } & (SimulationCommand | EconomyCommand
  | { type: 'chooseHull'; hullId: string; name: string; color: string }
  | { type: 'claimCaptain'; captainId: string }
  | { type: 'ready' }
  | { type: 'pause' }
  | { type: 'retreat' }
  | { type: 'resume'; force: boolean }
  | { type: 'vote'; choiceId: string }
  | { type: 'commitChoice'; choiceId: string }
  | { type: 'contribute'; choiceId: string }
  | { type: 'continue' }
  | { type: 'abandonCrew' }
  | { type: 'abandonShip'; shipId: string }
  | { type: 'inspectShip'; shipId: string; requestId: number });
export type Input = { crewId: string | null; controlEpoch: number; x: number; y: number; action: 'none' | 'repair' | 'fight' | 'heal' };
export type Inspection = { shipId: string; requestId: number };
export type State = { schemaVersion: number; contentVersion: number; expeditionId: string; seed: number; settings: Settings; phase: Phase; resumePhase: Phase | null; epoch: number; captains: Captain[]; leaderCaptainId: string; simulation: Simulation; expedition: Expedition; paused: boolean; pausedBy: string | null; queue: { captainId: string; command: SimulationCommand }[]; inspections: Record<string, Inspection>; controlledCrew: Record<string, string>; result: 'victory' | 'defeat' | 'suspended' | null; message: string; revision: number };
export type ChoiceView = { id: string; label: string; text: string; special: boolean; available: boolean; requirement: string; cost: number; contributors: string[] };
export type ItemView = { id: string; definitionId: string; kind: Item['kind']; name: string; description: string; price: number; version: number; ownerCaptainId: string | null; carrierShipId: string | null; location: Item['location'] };
export type CaptainView = { id: string; playerId: string | null; name: string; color: string; shipId: string | null; connected: boolean; ready: boolean; vote: string | null; status: 'active' | 'shipless' | 'spectator'; crewCount: number };
export type ShipSummary = Pick<Ship, 'id' | 'ownerCaptainId' | 'faction' | 'hullId' | 'name' | 'color' | 'formation' | 'hull' | 'maxHull' | 'status' | 'shield'> & { alerts: string[]; rooms: { id: string; name: string; system: SystemId | null }[]; crewCount: number; targetShipId: string | null; escapeAtMs: number | null };
export type RoomView = Room & { name: string; x: number; y: number; w: number; h: number; capacity: number; adjacent: string[]; mannedBy: string | null; known: boolean };
export type InteriorView = { ship: ShipSummary; rooms: RoomView[]; crew: Crew[]; weapons: (InstalledWeapon & { name: string; description: string; family: WeaponFamily; readyInMs: number; disabled: boolean; ammoCost: number; target: 'enemy' | 'ally' })[]; systems: InstalledSystem[]; ammo: number };
export type PublicView = { phase: Phase; epoch: number; timeMs: number; paused: boolean; pausedBy: string | null; leaderCaptainId: string; captains: CaptainView[]; ships: ShipSummary[]; effects: CombatEffect[]; drones: Drone[]; sector: { index: number; count: number; name: string; color: string }; beacons: Beacon[]; currentBeaconId: string; threat: number; event: { id: string; title: string; text: string; result: string; resolved: boolean; choices: ChoiceView[] } | null; loot: ItemView[]; objective: CombatObjective | null; message: string; result: State['result']; assignment: boolean };
export type PrivateView = { captainId: string | null; captain: CaptainView | null; wallet: number; cargoShipId: string | null; ownShip: InteriorView | null; inspectedShip: InteriorView | null; inspectedShipId: string | null; viewRequestId: number; crew: Crew[]; inventory: ItemView[]; store: ItemView[]; controlledCrewId: string | null; queued: SimulationCommand[]; canAct: boolean; hulls: HullDefinition[] };
export type ClientProps = GameClientContext<Input, Action, PublicView, PrivateView>;
export type CommandResult = { events: DomainEvent[] };
// Frozen module APIs: simulation/index.ts exports createShip, applySimulationCommand,
// tickSimulation, roomManning; expedition/index.ts exports createExpedition,
// enterBeacon, resolveEvent, applyEconomyCommand, awardRewards, openStore,
// advanceSector, availableChoices. All commands validate fully before mutation.
// createShip(defs, spec) => {ship, crew}; other mutators take (state, ...args, defs).
export type ShipSpec = { id: string; hullId: string; ownerCaptainId: string | null; name: string; color: string; formation: number; faction: Ship['faction']; enemyId?: string };
