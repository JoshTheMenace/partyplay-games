import type { CaptainId, Crew, Definitions, Room, Ship, ShipSpec, State, SystemId } from '../contracts';

import { SPECIES } from '../definitions/presentation/species';

export const alive = (crew: Crew) => crew.status === 'alive' && crew.hp > 0;
export const present = (ship: Ship) => ship.status === 'active' || ship.status === 'surrendered';
export const shipById = (state: State, id: string) => state.simulation.ships.find(ship => ship.id === id && present(ship));
export const layout = (defs: Definitions, ship: Ship) => defs.hulls.find(hull => hull.id === ship.hullId)!;
export const roomFor = (ship: Ship, id: SystemId) => ship.rooms.find(room => room.system === id) ?? ship.rooms.find(room => room.system === null) ?? ship.rooms.find(room => room.system === 'weaponry')!;
export const effectiveTier = (room: Room, timeMs = 0) => room.disruptedUntilMs > timeMs ? 0 : Math.max(0, room.tier - Math.ceil(room.damage / 10));
export function systemTier(state: State, ship: Ship, id: SystemId) {
  const installed = ship.systems.find(system => system.id === id);
  const room = roomFor(ship, id);
  return installed && room ? Math.min(installed.tier, effectiveTier(room, state.simulation.timeMs)) : 0;
}
export const crewFriendly = (crew: Crew, ship: Ship) => (crew.ownerCaptainId === null ? 'enemy' : 'allied') === ship.faction;
export const opponents = (a: Crew, b: Crew) => (a.ownerCaptainId === null) !== (b.ownerCaptainId === null);
export const augment = (ship: Ship, effect: Definitions['augments'][number]['effect'], defs: Definitions) => ship.augments.reduce((sum, id) => sum + (defs.augments.find(item => item.id === id && item.effect === effect)?.strength ?? 0), 0);
export const requireValue = <T>(value: T | undefined | null | false, error: string): T => { if (!value) throw new Error(error); return value; };
export function actorShip(state: State, id: CaptainId) {
  const captain = requireValue(state.captains.find(captain => captain.id === id), 'Captain not found.');
  return requireValue(shipById(state, captain.currentOwnedShipId ?? ''), 'Your ship is no longer available.');
}
export function ownedCrew(state: State, owner: string, id: string) {
  return requireValue(state.simulation.crew.find(crew => crew.id === id && crew.ownerCaptainId === owner && alive(crew)), 'You can command only your own living crew.');
}
export function pathTo(ship: Ship, from: string, to: string, defs: Definitions): string[] | null {
  const queue = [[from]];
  const seen = new Set([from]);
  for (const path of queue) {
    const last = path[path.length - 1];
    if (last === to) return path;
    for (const next of layout(defs, ship).rooms.find(room => room.id === last)?.adjacent ?? []) {
      if (seen.has(next) || ship.rooms.find(room => room.id === next)?.locked || ship.rooms.find(room => room.id === last)?.locked) continue;
      seen.add(next); queue.push([...path, next]);
    }
  }
  return null;
}
export function standingPlaces(state: State, ship: Ship, roomId: string, defs: Definitions, excluding: string[] = []) {
  const room = requireValue(layout(defs, ship).rooms.find(room => room.id === roomId), 'That room does not exist.');
  const occupied = state.simulation.crew.filter(crew => alive(crew) && crew.currentShipId === ship.id && crew.roomId === roomId && !excluding.includes(crew.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(room.capacity * room.w / room.h)));
  const rows = Math.ceil(room.capacity / columns);
  const places: { x: number; y: number }[] = [];
  for (let i = 0; i < room.capacity; i++) {
    const x = room.x + ((i % columns) + .5) * room.w / columns;
    const y = room.y + (Math.floor(i / columns) + .5) * room.h / rows;
    if (!occupied.some(crew => Math.hypot(crew.x - x, crew.y - y) < .35)) places.push({ x, y });
  }
  return places.slice(0, Math.max(0, room.capacity - occupied.length));
}
export function roomManning(state: State, shipId: string, roomId: string, _defs: Definitions): string | null {
  const ship = shipById(state, shipId);
  const room = ship?.rooms.find(room => room.id === roomId);
  if (!ship || !room?.system || effectiveTier(room, state.simulation.timeMs) === 0) return null;
  const skill = room.system === 'piloting' || room.system === 'engines' ? 'pilot' : room.system === 'weaponry' ? 'gunner' : room.system === 'medical' ? 'medic' : 'engineer';
  return state.simulation.crew.filter(crew => alive(crew) && crew.currentShipId === shipId && crew.roomId === roomId && crewFriendly(crew, ship) && crew.activity === 'idle')
    .sort((a, b) => Number(b.skill === skill) - Number(a.skill === skill) || a.id.localeCompare(b.id))[0]?.id ?? null;
}
export function createShip(defs: Definitions, spec: ShipSpec): { ship: Ship; crew: Crew[] } {
  const hull = requireValue(defs.hulls.find(hull => hull.id === spec.hullId), 'Unknown hull.');
  const enemy = spec.enemyId ? requireValue(defs.enemies.find(enemy => enemy.id === spec.enemyId), 'Unknown enemy.') : null;
  const systems = new Set<SystemId>(['piloting', 'engines', 'shields', 'weaponry', 'life-support', 'doors', 'medical', ...(enemy?.systems ?? hull.startingSystems)]);
  const ship: Ship = { id: spec.id, hullId: spec.hullId, ownerCaptainId: spec.ownerCaptainId, name: spec.name, color: spec.color, formation: spec.formation, faction: spec.faction, hull: hull.maxHull, maxHull: hull.maxHull, status: 'active', rooms: hull.rooms.map(room => ({ id: room.id, system: room.system, tier: room.system === 'weaponry' ? 2 : 1, damage: 0, fire: 0, breach: 0, oxygen: 100, locked: false, disruptedUntilMs: 0 })), weapons: (enemy?.weapons ?? hull.startingWeapons).map((definitionId, index) => ({ itemId: `${spec.id}-weapon-${index}`, definitionId, chargeMs: 0, order: null })), systems: [...systems].map(id => ({ id, tier: id === 'weaponry' ? 2 : 1, cooldownUntilMs: 0, activeUntilMs: 0, targetShipId: null, targetRoomId: null })), augments: [], shield: 2, shieldChargeMs: 0, ammo: 16, ai: enemy?.ai ?? null, escapeAtMs: null };
  const skills: Crew['skill'][] = ['pilot', 'engineer', 'gunner', 'medic', 'fighter', 'scientist'];
  const crew: Crew[] = Array.from({ length: Math.min(8, hull.crew) }, (_, index) => {
    const room = hull.rooms[index % hull.rooms.length];
    const species = SPECIES[index % SPECIES.length];
    return { id: `${spec.id}-crew-${index}`, ownerCaptainId: spec.ownerCaptainId, homeShipId: spec.id, currentShipId: spec.id, name: ['Ari', 'Bo', 'Cleo', 'Dax', 'Eli', 'Faye', 'Gus', 'Hal'][index], roomId: room.id, x: room.x + room.w / 2, y: room.y + room.h / 2, species: species.id, hp: species.maxHp, maxHp: species.maxHp, status: 'alive', skill: skills[index % skills.length], traits: [hull.traits[index % Math.max(1, hull.traits.length)] ?? 'adaptable'], order: { kind: 'hold', roomId: room.id }, activity: 'idle', controlEpoch: 0 };
  });
  for (const room of ship.rooms) if (room.system && !systems.has(room.system)) room.system = null;
  for (const system of ship.systems) if (!ship.rooms.some(room => room.system === system.id)) {
    const bay = ship.rooms.find(room => room.system === null);
    if (bay) bay.system = system.id;
  }
  if (enemy) {
    const tier = Math.min(hull.maxWeapons, Math.max(2, enemy.weapons.length));
    const room = ship.rooms.find(room => room.system === 'weaponry');
    if (room) room.tier = tier;
    ship.systems.find(system => system.id === 'weaponry')!.tier = tier;
  }
  return { ship, crew };
}
export function effect(state: State, kind: State['simulation']['effects'][number]['kind'], sourceShipId: string, targetShipId: string, text: string, visual: Partial<Pick<State['simulation']['effects'][number], 'weaponId' | 'roomId' | 'mountIndex' | 'flightMs' | 'delayMs'>> = {}) {
  state.simulation.effects.push({ id: `effect-${state.simulation.nextId++}`, kind, sourceShipId, targetShipId, text, atMs: state.simulation.timeMs, ...visual });
  if (state.simulation.effects.length > 64) state.simulation.effects.shift();
}
export function random(state: State) {
  let value = state.simulation.rng | 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.simulation.rng = value >>> 0 || 1;
  return state.simulation.rng / 0x100000000;
}
export function releaseControl(state: State, captainId: string) {
  const crew = state.simulation.crew.find(crew => crew.id === state.controlledCrew[captainId]);
  if (crew) { crew.controlEpoch++; crew.activity = 'idle'; crew.order = { kind: 'hold', roomId: crew.roomId }; }
  delete state.controlledCrew[captainId];
}
