import { MAX_SAVE_BYTES, type RoundContext } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { CONTENT_VERSION, SCHEMA_VERSION, type Definitions, type Settings, type State } from './contracts';
import { legacyHullIds, legacyRoomShapes } from './definitions/presentation/legacy-layouts';
type Check = (value: unknown) => void;
const invalid = (message = 'Invalid expedition save.'): never => { throw Error(message); };
const str: Check = value => { if (typeof value !== 'string' || value.length > 4000) invalid(); };
const num: Check = value => { if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) invalid(); };
const nonnegative: Check = value => { num(value); if (Number(value) < 0) invalid(); };
const integer: Check = value => { nonnegative(value); if (!Number.isSafeInteger(value)) invalid(); };
const bool: Check = value => { if (typeof value !== 'boolean') invalid(); };
const enumeration = (...values: unknown[]): Check => value => { if (!values.includes(value)) invalid(); };
const nullable = (check: Check): Check => value => { if (value !== null) check(value); };
const list = (check: Check, max: number): Check => value => { if (!Array.isArray(value) || value.length > max) invalid('Save exceeds expedition limits.'); for (const item of value as unknown[]) check(item); };
const object = (shape: Record<string, Check>): Check => value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !Object.hasOwn(shape, key))) invalid(`Unknown save field: ${Object.keys(record).filter(key => !Object.hasOwn(shape, key)).join(', ')}.`);
  for (const [key, check] of Object.entries(shape)) check(record[key]);
};
const record = (check: Check, max: number): Check => value => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > max) invalid(); for (const [key, item] of Object.entries(value!)) { if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 100) invalid(); check(item); } };
const strings = list(str, 100);
const phase = enumeration('assignment', 'hangar', 'route', 'event', 'combat', 'rewards', 'store', 'results');
const skill = enumeration('pilot', 'engineer', 'gunner', 'medic', 'fighter', 'scientist');
const settingsCheck = object({ difficulty: enumeration('relaxed', 'standard'), expedition: enumeration('standard', 'training') });
const orderCheck = object({ kind: enumeration('move', 'repair', 'fight', 'heal', 'hold'), roomId: str });
const weaponOrder = object({ shipId: str, roomId: str, hold: bool });
const systemCheck = object({ id: str, tier: integer, cooldownUntilMs: nonnegative, activeUntilMs: nonnegative, targetShipId: nullable(str), targetRoomId: nullable(str) });
const roomCheck = object({ id: str, system: nullable(str), tier: integer, damage: nonnegative, fire: nonnegative, breach: nonnegative, oxygen: nonnegative, locked: bool, disruptedUntilMs: nonnegative });
const shipCheck = object({ id: str, ownerCaptainId: nullable(str), faction: enumeration('allied', 'enemy'), hullId: str, name: str, color: str, formation: integer, hull: nonnegative, maxHull: nonnegative, status: enumeration('active', 'surrendered', 'escaped', 'destroyed', 'abandoned'), rooms: list(roomCheck, 12), weapons: list(object({ itemId: str, definitionId: str, chargeMs: nonnegative, order: nullable(weaponOrder) }), 6), systems: list(systemCheck, 19), augments: list(str, 24), shield: nonnegative, shieldChargeMs: nonnegative, ammo: integer, ai: nullable(enumeration('aggressive', 'shield-breaker', 'boarder', 'support', 'artillery', 'saboteur', 'coward', 'hunter')), escapeAtMs: nullable(nonnegative) });
const crewCheck = object({ species: value => { if (value !== undefined) enumeration('human', 'bastion', 'skitter', 'ember')(value); }, id: str, ownerCaptainId: nullable(str), homeShipId: str, currentShipId: str, name: str, roomId: str, x: num, y: num, hp: nonnegative, maxHp: nonnegative, status: enumeration('alive', 'dead', 'captured', 'dismissed'), skill, traits: strings, order: orderCheck, activity: enumeration('idle', 'moving', 'repairing', 'fighting', 'healing', 'direct'), controlEpoch: integer });
const projectileCheck = object({ id: str, sourceShipId: str, targetShipId: str, roomId: str, weaponId: str, arriveAtMs: nonnegative, damage: num, shieldDamage: num, pierce: nonnegative, roomDamage: num, crewDamage: num, fire: nonnegative, breach: nonnegative, ionMs: nonnegative, family: enumeration('laser', 'beam', 'missile', 'flak', 'ion', 'plasma', 'boarding', 'support') });
const droneCheck = object({ id: str, definitionId: str, sourceShipId: str, targetShipId: str, targetRoomId: str, hp: nonnegative, nextAtMs: nonnegative });
const effectCheck = object({ id: str, kind: enumeration('shot', 'impact', 'teleport', 'repair', 'destroyed', 'shield', 'warning'), sourceShipId: str, targetShipId: str, text: str, atMs: nonnegative });
const objectiveCheck = object({ kind: enumeration('destroy', 'survive', 'escape', 'defend', 'finale'), deadlineMs: nullable(nonnegative), stage: integer, description: str });
const captainCheck = object({ id: str, playerId: nullable(str), name: str, color: str, currentOwnedShipId: nullable(str), connected: bool, wallet: integer, cargoShipId: nullable(str), ready: bool, vote: nullable(str), contribution: nullable(str), stats: object({ damage: nonnegative, repairs: nonnegative, kills: integer, collected: integer }), abandonedCrew: bool });
const itemCheck = object({ id: str, definitionId: str, kind: enumeration('weapon', 'drone', 'augment', 'system'), ownerCaptainId: nullable(str), carrierShipId: nullable(str), location: enumeration('loot', 'cargo', 'installed', 'store', 'destroyed', 'sold'), price: integer, version: integer, stockCaptainId: nullable(str) });
const beaconCheck = object({ id: str, column: integer, lane: integer, kind: enumeration('event', 'store', 'combat', 'exit'), label: str, next: strings, visited: bool, eventId: nullable(str) });
const eventCheck = object({ id: str, definitionId: str, resolved: bool, choiceId: nullable(str), text: str, result: str, optionIds: strings });
const stateCheck = object({ schemaVersion: enumeration(SCHEMA_VERSION), contentVersion: enumeration(1, CONTENT_VERSION), expeditionId: str, seed: num, settings: settingsCheck, phase, resumePhase: nullable(phase), epoch: integer, captains: list(captainCheck, 4), leaderCaptainId: str, simulation: object({ timeMs: nonnegative, rng: integer, nextId: integer, ships: list(shipCheck, 64), crew: list(crewCheck, 256), projectiles: list(projectileCheck, 128), drones: list(droneCheck, 48), effects: list(effectCheck, 64), objective: nullable(objectiveCheck) }), expedition: object({ rng: integer, sectorIds: list(str, 5), sectorIndex: integer, beacons: list(beaconCheck, 36), currentBeaconId: str, seenRoots: list(str, 300), event: nullable(eventCheck), items: list(itemCheck, 1024), rewardRemainder: integer, rewardSerial: integer, threat: nonnegative, flags: record(bool, 256), reputation: record(num, 32), completedBeacons: integer, nextItemId: integer }), paused: bool, pausedBy: nullable(str), queue: list(() => invalid(), 0), inspections: record(() => invalid(), 0), controlledCrew: record(() => invalid(), 0), result: nullable(enumeration('victory', 'defeat', 'suspended')), message: str, revision: integer });
function unique(items: { id: string }[]) { if (new Set(items.map(item => item.id)).size !== items.length) invalid('Duplicate identities in save.'); }
function legacyRoom(hullId: string, roomId: string) {
  const shape = legacyRoomShapes[legacyHullIds.indexOf(hullId)]?.find((_, index) => roomId === `r${index}`);
  return shape && { x: shape[0], y: shape[1], w: shape[2], h: shape[3] };
}
export function validateSave(raw: unknown, defs: Definitions): State { return validateState(raw, defs); }
function validateState(raw: unknown, defs: Definitions, checkSize = true): State {
  assertSerializable(raw);
  if (checkSize && new TextEncoder().encode(JSON.stringify(raw)).length > MAX_SAVE_BYTES) invalid('Expedition save exceeds 256 KiB.');
  stateCheck(raw);
  const state = structuredClone(raw) as State;
  const legacy = state.contentVersion === 1;
  const sim = state.simulation, exp = state.expedition;
  if (!state.captains.length || !exp.sectorIds.length || exp.sectorIndex >= exp.sectorIds.length || exp.rewardRemainder >= state.captains.length) invalid();
  if (state.result !== 'victory' && state.result !== 'defeat' && !sim.crew.some(crew => crew.ownerCaptainId !== null && crew.status === 'alive')) invalid('A resumable expedition needs a captain with living crew.');
  if (exp.items.some(item => ['cargo', 'installed'].includes(item.location) && item.ownerCaptainId === null || item.location === 'loot' && item.ownerCaptainId !== null)) invalid('Cargo ownership does not match its location.');
  for (const items of [state.captains, sim.ships, sim.crew, sim.projectiles, sim.drones, exp.items, exp.beacons]) unique(items);
  const captainIds = new Set(state.captains.map(captain => captain.id));
  if (!captainIds.has(state.leaderCaptainId) || state.pausedBy !== null && !captainIds.has(state.pausedBy)) invalid('Invalid captain ownership.');
  const ships = new Map(sim.ships.map(ship => [ship.id, ship]));
  const owner = (id: string | null) => { if (id !== null && !captainIds.has(id)) invalid('Invalid item or crew owner.'); };
  const roomExists = (shipId: string, roomId: string) => ships.get(shipId)?.rooms.some(room => room.id === roomId);
  for (const captain of state.captains) {
    if (captain.currentOwnedShipId !== null && (ships.get(captain.currentOwnedShipId)?.ownerCaptainId !== captain.id || ships.get(captain.currentOwnedShipId)?.status !== 'active')) invalid('Captain ship binding is invalid.');
    if (captain.cargoShipId !== null && (ships.get(captain.cargoShipId)?.faction !== 'allied' || ships.get(captain.cargoShipId)?.status !== 'active')) invalid('Cargo carrier is unavailable.');
    if (sim.crew.filter(crew => crew.ownerCaptainId === captain.id && crew.status === 'alive').length > 8) invalid('Crew cap exceeded.');
  }
  for (const ship of sim.ships) {
    owner(ship.ownerCaptainId);
    const hull = defs.hulls.find(item => item.id === ship.hullId);
    if (!hull || legacy && !legacyHullIds.includes(ship.hullId) || ship.rooms.length !== hull.rooms.length || ship.hull > ship.maxHull || ship.maxHull > 1000 || ship.shield > 100 || ship.weapons.length > hull.maxWeapons || ship.faction === 'allied' && ship.ownerCaptainId === null || ship.faction === 'enemy' && ship.ownerCaptainId !== null) invalid('Invalid ship configuration.');
    unique(ship.rooms); unique(ship.systems);
    for (const room of ship.rooms) { if (!hull!.rooms.some(item => item.id === room.id) || room.system !== null && !defs.systems.some(system => system.id === room.system) || room.tier > 5 || room.damage > 50 || room.oxygen > 100 || room.fire > 100 || room.breach > 100) invalid('Invalid room state.'); }
    for (const weapon of ship.weapons) { if (!defs.weapons.some(item => item.id === weapon.definitionId) || weapon.order && !roomExists(weapon.order.shipId, weapon.order.roomId)) invalid('Invalid weapon target or definition.'); }
    for (const system of ship.systems) if (!defs.systems.some(item => item.id === system.id && system.tier <= item.maxTier) || (system.targetShipId === null) !== (system.targetRoomId === null) || system.targetShipId !== null && !ships.has(system.targetShipId) || system.targetRoomId !== null && (system.targetShipId === null || !roomExists(system.targetShipId, system.targetRoomId))) invalid('Invalid installed system.');
    for (const augment of ship.augments) if (!defs.augments.some(item => item.id === augment)) invalid('Unknown augment.');
  }
  for (const crew of sim.crew) {
    owner(crew.ownerCaptainId);
    if (crew.hp > crew.maxHp || crew.maxHp > 500 || crew.status === 'alive' && (crew.hp === 0 || !['active', 'surrendered'].includes(ships.get(crew.currentShipId)?.status ?? '') || !roomExists(crew.currentShipId, crew.roomId) || !roomExists(crew.currentShipId, crew.order.roomId))) invalid('Invalid crew location or health.');
    if (crew.ownerCaptainId !== null && !ships.has(crew.homeShipId)) invalid('Missing original ship record.');
    if (crew.status === 'alive' || legacy) {
      const ship = ships.get(crew.currentShipId);
      const room = ship && (legacy ? legacyRoom(ship.hullId, crew.roomId) : defs.hulls.find(item => item.id === ship.hullId)!.rooms.find(item => item.id === crew.roomId));
      if (room && (crew.x < room.x || crew.y < room.y || crew.x > room.x + room.w || crew.y > room.y + room.h)) invalid('Crew is outside its room.');
    }
  }
  for (const ship of sim.ships) for (const room of defs.hulls.find(item => item.id === ship.hullId)!.rooms) if (sim.crew.filter(crew => crew.status === 'alive' && crew.currentShipId === ship.id && crew.roomId === room.id).length > room.capacity) invalid('Room occupancy exceeded.');
  for (const item of exp.items) { owner(item.ownerCaptainId); owner(item.stockCaptainId); const bank = item.kind === 'weapon' ? defs.weapons : item.kind === 'drone' ? defs.drones : item.kind === 'system' ? defs.systems : defs.augments; if (!bank.some(entry => entry.id === item.definitionId) || ['cargo', 'installed', 'loot'].includes(item.location) && (item.carrierShipId === null || ships.get(item.carrierShipId)?.status !== 'active' || ships.get(item.carrierShipId)?.faction !== 'allied')) invalid('Invalid cargo definition or location.'); }
  for (const ship of sim.ships.filter(ship => ship.faction === 'allied' && ship.status === 'active')) {
    for (const weapon of ship.weapons) if (!exp.items.some(item => item.id === weapon.itemId && item.kind === 'weapon' && item.definitionId === weapon.definitionId && item.location === 'installed' && item.ownerCaptainId === ship.ownerCaptainId && item.carrierShipId === ship.id)) invalid('Installed weapon is missing its physical item.');
    for (const system of ship.systems.filter(system => defs.systems.some(definition => definition.id === system.id && definition.cooldownMs > 0))) if (!exp.items.some(item => item.kind === 'system' && item.definitionId === system.id && item.location === 'installed' && item.ownerCaptainId === ship.ownerCaptainId && item.carrierShipId === ship.id)) invalid('Installed system is missing its physical item.');
    const cargo = exp.items.filter(item => item.location === 'installed' && item.carrierShipId === ship.id);
    if (new Set(ship.weapons.map(weapon => weapon.itemId)).size !== ship.weapons.length || ship.augments.length > 4) invalid('Equipment occupies an invalid slot.');
    for (const item of cargo) {
      if (item.ownerCaptainId !== ship.ownerCaptainId || item.kind === 'drone' || item.kind === 'weapon' && !ship.weapons.some(weapon => weapon.itemId === item.id) || item.kind === 'system' && !ship.systems.some(system => system.id === item.definitionId) || item.kind === 'augment' && !ship.augments.includes(item.definitionId)) invalid('Installed item has no matching owned equipment slot.');
    }
    for (const system of ship.systems.filter(system => defs.systems.some(definition => definition.id === system.id && definition.cooldownMs > 0))) if (cargo.filter(item => item.kind === 'system' && item.definitionId === system.id).length !== 1) invalid('A system occupies more than one physical item slot.');
    for (const id of new Set(ship.augments)) if (ship.augments.filter(augment => augment === id).length !== cargo.filter(item => item.kind === 'augment' && item.definitionId === id).length) invalid('Augment ownership does not match its equipment slot.');
  }
  for (const sector of exp.sectorIds) if (!defs.sectors.some(item => item.id === sector)) invalid('Unknown sector.');
  if (exp.currentBeaconId && !exp.beacons.some(item => item.id === exp.currentBeaconId)) invalid('Unknown current beacon.');
  for (const beacon of exp.beacons) if (beacon.next.some(id => !exp.beacons.some(next => next.id === id && next.column > beacon.column)) || beacon.eventId !== null && !defs.events.some(event => event.id === beacon.eventId)) invalid('Invalid route.');
  for (const id of exp.seenRoots) if (!defs.events.some(event => event.id === id)) invalid('Unknown encounter history.');
  if (exp.event) { const definition = defs.events.find(event => event.id === exp.event!.definitionId); if (!definition || exp.event.optionIds.some(id => !definition.choices.some(choice => choice.id === id)) || exp.event.choiceId !== null && !definition.choices.some(choice => choice.id === exp.event!.choiceId)) invalid('Invalid saved event.'); }
  for (const projectile of sim.projectiles) if (!ships.has(projectile.sourceShipId) || !roomExists(projectile.targetShipId, projectile.roomId) || !defs.weapons.some(weapon => weapon.id === projectile.weaponId)) invalid('Invalid projectile.');
  for (const drone of sim.drones) if (!ships.has(drone.sourceShipId) || !roomExists(drone.targetShipId, drone.targetRoomId) || !defs.drones.some(item => item.id === drone.definitionId)) invalid('Invalid drone.');
  if (legacy) {
    for (const crew of sim.crew) {
      const ship = ships.get(crew.currentShipId), oldRoom = ship && legacyRoom(ship.hullId, crew.roomId);
      const room = ship && defs.hulls.find(item => item.id === ship.hullId)!.rooms.find(item => item.id === crew.roomId);
      if (oldRoom && room) {
        crew.x = room.x + (crew.x - oldRoom.x) / oldRoom.w * room.w;
        crew.y = room.y + (crew.y - oldRoom.y) / oldRoom.h * room.h;
      }
      crew.species ??= 'human';
    }
    state.contentVersion = CONTENT_VERSION;
    return validateState(state, defs, false);
  }
  return state;
}
export function exportSave(state: State) {
  const saved = structuredClone(state);
  saved.queue = []; saved.inspections = {}; saved.controlledCrew = {};
  for (const captain of saved.captains) { captain.playerId = null; captain.connected = false; captain.ready = false; }
  for (const crew of saved.simulation.crew) { crew.controlEpoch++; if (crew.activity === 'direct') crew.activity = 'idle'; }
  assertSerializable(saved);
  if (new TextEncoder().encode(JSON.stringify(saved)).length > MAX_SAVE_BYTES) throw Error('This expedition exceeds the save size limit.');
  return saved;
}
export function loadSave(ctx: RoundContext, raw: unknown, _settings: Settings, defs: Definitions) {
  const state = validateSave(raw, defs);
  if (ctx.players.length !== state.captains.length) throw Error(`This expedition needs ${state.captains.length} player seats, including any eliminated captains.`);
  if (state.result === 'victory' || state.result === 'defeat') throw Error('This expedition has ended. Start a new expedition to play again.');
  state.resumePhase = state.phase === 'assignment' ? state.resumePhase : state.phase;
  state.phase = 'assignment'; state.epoch++; state.result = null; state.paused = true;
  state.queue = []; state.inspections = {}; state.controlledCrew = {};
  for (const captain of state.captains) { captain.playerId = null; captain.connected = false; captain.ready = false; captain.vote = null; captain.contribution = null; }
  for (const crew of state.simulation.crew) { crew.controlEpoch++; if (crew.activity === 'direct') crew.activity = 'idle'; }
  state.message = 'Choose the saved captain you want to command. Everyone must choose before the fleet resumes.';
  return { state, settings: state.settings };
}
