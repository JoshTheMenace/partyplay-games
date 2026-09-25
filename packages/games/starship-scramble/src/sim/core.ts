/** Shared simulation plumbing: lookups, seeded RNG, events, per-tick context and derived ship values. */
import type { Combat, CombatEvent, CombatEventType, Crew, Faction, HullDef, RoomDef, RoomState, Ship, SystemId, WeaponDef } from '../contracts';
import { ROLES, WEAPONS, speciesDef, weaponDef } from '../defs/catalog';
import { roomSlots } from '../defs/geometry';
import { HULLS, hullDef } from '../defs/hulls';
import type { CrewSpec, ShipSpec, World } from './index';

const HULL_BY_ID = new Map(HULLS.map(h => [h.id, h])), WEAPON_BY_ID = new Map(WEAPONS.map(w => [w.id, w])), SLOTS = new Map<RoomDef, { x: number; y: number }[]>();
export const hullOf = (ship: Ship): HullDef => HULL_BY_ID.get(ship.hullId) ?? hullDef(ship.hullId);
export const wdef = (id: string): WeaponDef => WEAPON_BY_ID.get(id) ?? weaponDef(id);
export const roomDef = (ship: Ship, id: string) => hullOf(ship).rooms.find(r => r.id === id);
export const slotsOf = (room: RoomDef) => SLOTS.get(room) ?? SLOTS.set(room, roomSlots(room)).get(room)!;
export const alive = (m: Crew) => m.state !== 'dead';
/** Room a crew member is in or walking to. */
export const dest = (m: Crew) => m.path.length ? m.path[m.path.length - 1] : m.roomId;
export const systemRoom = (ship: Ship, system: SystemId) => ship.rooms.find(r => r.system === system && r.tier > 0);
export const level = (r: RoomState) => r.ionMs > 0 ? 0 : Math.max(0, r.tier - r.damage);
/** Effective level of a ship's system (0 when missing). */
export const lv = (ship: Ship, system: SystemId) => { const r = systemRoom(ship, system); return r ? level(r) : 0; };
export const has = (ship: Ship, augment: string) => ship.augments.includes(augment);
export const crossed = (t0: number, t1: number, period: number) => Math.floor(t0 / period) !== Math.floor(t1 / period);

/** mulberry32 over combat.rng. */
export function rand(c: Combat) {
  let t = c.rng = (c.rng + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
export const pick = <T>(c: Combat, list: readonly T[]): T => list[Math.floor(rand(c) * list.length)];
export const emit = (c: Combat, type: CombatEventType, shipId: string, extra: Omit<Partial<CombatEvent>, 'id' | 'type' | 'atMs' | 'shipId'> = {}) =>
  void c.events.push({ id: `${c.id}-${c.nextId++}`, type, atMs: c.t, shipId, ...extra });

/** Per-tick index. `aboard` lists crew alive at build time; always re-check `alive` after damage. */
export type Ctx = { world: World; c: Combat | null; ships: Map<string, Ship>; aboard: Map<string, Crew[]>; cache: Map<string, Derived> };
export function context(world: World, c: Combat | null): Ctx {
  const ships = new Map(world.ships.map(s => [s.id, s])), aboard = new Map(world.ships.map(s => [s.id, [] as Crew[]]));
  for (const m of world.crew) if (alive(m)) aboard.get(m.shipId)?.push(m);
  return { world, c, ships, aboard, cache: new Map() };
}
export const crewOn = (ctx: Ctx, ship: Ship) => ctx.aboard.get(ship.id) ?? [];

export type Derived = { evasion: number; maxShields: number; levels: Partial<Record<SystemId, number>> };
export function derive(ship: Ship, aboard: readonly Crew[], nebula: boolean): Derived {
  const levels: Derived['levels'] = {};
  for (const r of ship.rooms) if (r.system && r.tier) levels[r.system] = level(r);
  const pilots = helmCrew(ship, aboard);
  const base = Math.min(60, levels.helm && (pilots.length || hullOf(ship).automated)
    ? (levels.engines ?? 0) * 5 + levels.helm * 3 + (pilots.some(m => m.role === 'pilot') ? 5 : 0) + (has(ship, 'thruster-kit') ? 7 : 0) + (nebula ? 10 : 0) : 0);
  return { levels, maxShields: levels.shields ?? 0, evasion: ship.cloakMs > 0 ? Math.min(90, base + 60) : base };
}
/** Living crew of the ship's own faction standing at the helm. */
export function helmCrew(ship: Ship, aboard: readonly Crew[]) {
  const helm = systemRoom(ship, 'helm');
  return helm ? aboard.filter(m => alive(m) && m.roomId === helm.id && m.faction === ship.faction && !m.path.length) : [];
}
export function derived(ctx: Ctx, ship: Ship) {
  let d = ctx.cache.get(ship.id);
  if (!d) ctx.cache.set(ship.id, d = derive(ship, crewOn(ctx, ship), ctx.c?.hazard === 'nebula'));
  return d;
}
/** Crew of `ship` (settled, same faction) with the given role in the room of `system`. */
export function manned(ctx: Ctx, ship: Ship, system: SystemId, role: Crew['role']) {
  const room = systemRoom(ship, system);
  return !!room && crewOn(ctx, ship).some(m => alive(m) && m.roomId === room.id && m.role === role && m.faction === ship.faction && !m.path.length);
}

/** Free slots in a room for a faction, counting crew already there or walking there. */
export function space(ship: Ship, roomId: string, faction: Faction, aboard: readonly Crew[]) {
  const room = roomDef(ship, roomId);
  return room ? slotsOf(room).length - aboard.filter(m => alive(m) && m.faction === faction && dest(m) === roomId).length : 0;
}
/** Slot cells not occupied by a faction's crew standing in the room. */
export function freeCells(ship: Ship, roomId: string, faction: Faction, aboard: readonly Crew[]) {
  const room = roomDef(ship, roomId);
  return room ? slotsOf(room).filter(s => !aboard.some(m => alive(m) && m.faction === faction && m.roomId === roomId && m.x === s.x && m.y === s.y)) : [];
}
export const roleRoom = (ship: Ship, role: Crew['role']) => {
  const station = ROLES.find(r => r.id === role)?.station ?? (role === 'soldier' ? 'teleporter' : null);
  return station ? systemRoom(ship, station)?.id ?? null : null;
};
export const stationOf = (ship: Ship, m: Crew) => m.station && ship.rooms.some(r => r.id === m.station) ? m.station : roleRoom(ship, m.role);

export function createShip(spec: ShipSpec): Ship {
  const hull = hullDef(spec.hullId), systems = spec.systems ?? hull.startSystems;
  const maxHull = spec.maxHull ?? hull.maxHull;
  const rooms: RoomState[] = hull.rooms.map(r => ({ id: r.id, system: r.system, tier: r.system ? systems[r.system] ?? 0 : 0, damage: 0, ionMs: 0, fire: 0, breach: false, oxygen: 100, repair: 0 }));
  return {
    id: spec.id, faction: spec.faction, captainId: spec.captainId, enemyId: spec.enemyId, hullId: hull.id, name: spec.name, paint: spec.paint, slot: spec.slot,
    hull: Math.min(spec.hull ?? maxHull, maxHull), maxHull, shields: systems.shields ?? 0, shieldCharge: 0, tempShield: 0, tempShieldMs: 0, rooms,
    weapons: weaponStates(spec.id, spec.weapons, systems.weapons ?? 0), ammo: spec.ammo, augments: [...spec.augments],
    status: 'active', cloakMs: 0, cloakCooldownMs: 0, teleportCooldownMs: 0, defenseCooldownMs: 0, fleeAtMs: null,
    phase: 0, phases: spec.phases, ai: spec.ai, fleeBelow: spec.fleeBelow, autopilot: false, lastHitBy: null,
  };
}
export const weaponStates = (prefix: string, ids: readonly string[], powered: number) =>
  ids.map((defId, i) => ({ uid: `${prefix}-w${i}`, defId: wdef(defId).id, charge: 0, target: null, auto: true, powered: i < powered }));

export function createCrew(spec: CrewSpec, ship: Ship, world: World): Crew {
  const aboard = world.crew.filter(m => m.shipId === ship.id), want = roleRoom(ship, spec.role), species = speciesDef(spec.species);
  for (const id of [want, ...ship.rooms.map(r => r.id)]) {
    const cell = id && freeCells(ship, id, spec.faction, aboard)[0];
    if (cell) return { id: spec.id, name: spec.name, species: species.id, role: spec.role, faction: spec.faction, ownerId: spec.ownerId, shipId: ship.id, roomId: id,
      x: cell.x, y: cell.y, hp: Math.min(spec.hp ?? species.maxHp, species.maxHp), maxHp: species.maxHp, state: 'idle', station: want ?? id, path: [] };
  }
  throw new Error('There is no room aboard.');
}
