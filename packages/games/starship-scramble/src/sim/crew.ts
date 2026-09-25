/** Crew: walking between cell slots, room jobs, melee, boarding, healing, fire and oxygen, crew AI and orders. */
import type { Crew, HullDef, RoomState, Ship } from '../contracts';
import { speciesDef } from '../defs/catalog';
import { doorBetween, neighbors, roomPath } from '../defs/geometry';
import { type Ctx, alive, context, crewOn, dest, emit, freeCells, has, hullOf, level, pick, rand, roomDef, slotsOf, space, stationOf, systemRoom } from './core';
import type { World } from './index';

/** Per-ms rates. */
const WALK = 1.6e-3, MELEE = 12e-3, JOB_MS = { douse: 3000, patch: 5000, fix: 6000 }, SABOTAGE_MS = 6000, TELEPORT_MS = [20000, 15000, 10000];
export const teleportCapacity = (lvl: number) => Math.min(lvl, 3) + 1;
const cell = (m: Crew, x = m.x, y = m.y) => `${m.faction}${x},${y}`;

export function kill(ctx: Ctx, m: Crew) {
  m.hp = 0; m.state = 'dead'; m.path = [];
  if (ctx.c) emit(ctx.c, 'crew-death', m.shipId, { crewId: m.id, roomId: m.roomId });
}
export const hurt = (ctx: Ctx, m: Crew, amount: number) => { if (alive(m) && (m.hp -= amount) <= 0) kill(ctx, m); };
export function damageSystem(ctx: Ctx, ship: Ship, room: RoomState, n: number) {
  if (!room.system || room.damage >= room.tier) return;
  room.damage = Math.min(room.tier, room.damage + n);
  if (room.damage === room.tier && ctx.c) emit(ctx.c, 'system-down', ship.id, { roomId: room.id });
}
/** Start a fire, or feed an existing one. */
export function ignite(ctx: Ctx, ship: Ship, room: RoomState) {
  if (room.fire) room.fire = Math.min(3, room.fire + 1);
  else { room.fire = 1; if (ctx.c) emit(ctx.c, 'fire', ship.id, { roomId: room.id }); }
}

/** One crew step on a ship: walk, then fight / work / sabotage per room, then damage, healing, fire and oxygen. Hostile effects only in combat. */
export function tickCrew(ctx: Ctx, ship: Ship, dt: number) {
  const c = ctx.c, list = crewOn(ctx, ship).filter(alive), taken = new Set<string>(), hits = new Map<Crew, number>();
  const walkers = list.filter(m => { const k = cell(m); if (m.state === 'walking' || m.path.length || taken.has(k)) return true; taken.add(k); return false; });
  for (const m of walkers) walk(ship, m, taken, dt * WALK * speciesDef(m.species).speed);
  const settled = list.filter(m => m.state !== 'walking'), medbay = systemRoom(ship, 'medbay');
  for (const room of ship.rooms) {
    const here = settled.filter(m => m.roomId === room.id), own = here.filter(m => m.faction === ship.faction), foes = here.filter(m => m.faction !== ship.faction);
    if (c && own.length && foes.length) { fight(own, foes, dt, hits); fight(foes, own, dt, hits); room.repair = 0; continue; }
    if (own.length) work(ctx, ship, room, own, dt, room === medbay); else room.repair = 0;
    if (c && foes.length) sabotage(ctx, ship, room, foes, dt); else for (const m of foes) m.state = 'idle';
  }
  const med = medbay ? 8 * level(medbay) : 0, nanite = has(ship, 'nanite-medics') ? 1.5 : 0;
  for (const m of list) {
    const room = ship.rooms.find(r => r.id === m.roomId)!, medic = settled.some(o => o !== m && o.role === 'medic' && o.state === 'healing' && o.roomId === m.roomId && o.faction === m.faction);
    if (m.faction === ship.faction) m.hp = Math.min(m.maxHp, m.hp + dt * ((m.roomId === medbay?.id ? med : 0) + nanite + (medic ? 3 : 0)) / 1000);
    hurt(ctx, m, (hits.get(m) ?? 0) + (c ? dt * (room.fire * 5 + (room.oxygen < 15 ? 6 : 0)) / 1000 : 0));
  }
  if (c) burn(ctx, ship, dt);
  if (!hullOf(ship).automated) {
    const o2 = systemRoom(ship, 'oxygen'), lv = o2 ? level(o2) : 0;
    for (const r of ship.rooms) r.oxygen = Math.max(0, Math.min(100, r.oxygen + dt * ((lv ? 8 * lv : c ? -3 : 0) - (c ? (r.breach ? 12 : 0) + r.fire * 5 : 0)) / 1000));
  }
}

/** Walk toward the next door midpoint, then into a free cell of the final room. */
function walk(ship: Ship, m: Crew, taken: Set<string>, step: number) {
  const hull = hullOf(ship);
  m.state = 'walking';
  while (step > 0) {
    const door = m.path.length ? doorBetween(hull, m.roomId, m.path[0]) : null;
    if (m.path.length && !door) { m.path = []; continue; }
    const target = door ?? claim(ship, m, m.roomId, taken);
    if (!target) { const alt = neighbors(hull, m.roomId).find(id => free(ship, m, id, taken)); if (!alt) return; m.path = [alt]; continue; }
    const d = Math.hypot(target.x - m.x, target.y - m.y);
    if (d > step) { m.x += (target.x - m.x) * step / d; m.y += (target.y - m.y) * step / d; return; }
    m.x = target.x; m.y = target.y; step -= d;
    if (!door) { m.state = 'idle'; return; }
    m.roomId = m.path.shift()!;
  }
}
const free = (ship: Ship, m: Crew, roomId: string, taken: Set<string>) => slotsOf(roomDef(ship, roomId)!).some(s => !taken.has(cell(m, s.x, s.y)));
function claim(ship: Ship, m: Crew, roomId: string, taken: Set<string>) {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const s of slotsOf(roomDef(ship, roomId)!)) { const d = (s.x - m.x) ** 2 + (s.y - m.y) ** 2; if (d < bd && !taken.has(cell(m, s.x, s.y))) { best = s; bd = d; } }
  if (best) taken.add(cell(m, best.x, best.y));
  return best;
}

function fight(a: Crew[], b: Crew[], dt: number, hits: Map<Crew, number>) {
  for (const m of a) {
    const foe = b.reduce((x, y) => y.hp < x.hp ? y : x);
    m.state = 'fighting';
    hits.set(foe, (hits.get(foe) ?? 0) + dt * MELEE * (m.role === 'soldier' ? 1.3 : 1) * speciesDef(m.species).melee);
  }
}
/** Room job priority: extinguish → patch breach → repair system → man it. room.repair is the shared progress (0..1). */
function work(ctx: Ctx, ship: Ship, room: RoomState, own: Crew[], dt: number, medbay: boolean) {
  const kind = room.fire ? 'douse' : room.breach ? 'patch' : room.damage ? 'fix' : null;
  if (!kind) {
    room.repair = 0;
    for (const m of own) m.state = medbay && m.hp < m.maxHp || m.role === 'medic' && own.some(o => o !== m && o.hp < o.maxHp) ? 'healing' : room.system && room.tier ? 'manning' : 'idle';
    return;
  }
  for (const m of own) m.state = kind === 'douse' ? 'extinguishing' : 'repairing';
  room.repair += dt * (kind === 'douse' && has(ship, 'fire-suppressant') ? 2 : 1) * own.reduce((sum, m) => sum + (m.role === 'engineer' ? 1.5 : 1) * speciesDef(m.species).repair, 0) / JOB_MS[kind];
  if (room.repair < 1) return;
  room.repair = 0;
  if (kind === 'douse') room.fire--;
  else if (kind === 'patch') room.breach = false;
  else { room.damage--; if (ctx.c) emit(ctx.c, 'repair', ship.id, { roomId: room.id, amount: 1, crewId: own[0].id }); }
}
/** Unopposed boarders wreck the room's system, then head for the nearest working one. */
function sabotage(ctx: Ctx, ship: Ship, room: RoomState, foes: Crew[], dt: number) {
  const c = ctx.c!;
  if (room.damage < room.tier) {
    for (const m of foes) { m.state = 'fighting'; if (rand(c) < dt / SABOTAGE_MS) damageSystem(ctx, ship, room, 1); }
    return;
  }
  const hull = hullOf(ship), aboard = crewOn(ctx, ship);
  for (const m of foes) {
    let best: string[] | null = null;
    for (const r of ship.rooms) if (r.damage < r.tier && space(ship, r.id, m.faction, aboard) > 0) { const path = roomPath(hull, m.roomId, r.id); if (path.length && (!best || path.length < best.length)) best = path; }
    if (best) m.path = best; else m.state = 'idle';
  }
}
function burn(ctx: Ctx, ship: Ship, dt: number) {
  const c = ctx.c!, hull = hullOf(ship), calm = has(ship, 'fire-suppressant') ? .5 : 1;
  for (const room of ship.rooms) {
    if (!room.fire) continue;
    if (room.oxygen < 10) { room.fire = 0; continue; }
    if (room.damage < room.tier && rand(c) < dt / 8000) damageSystem(ctx, ship, room, 1);
    if (room.fire < 3 && calm === 1 && !crewOn(ctx, ship).some(m => m.roomId === room.id && m.state === 'extinguishing') && rand(c) < dt / 15000) room.fire++;
    for (const id of neighbors(hull, room.id)) { const next = ship.rooms.find(r => r.id === id)!; if (!next.fire && rand(c) < dt * .012 * room.fire * calm / 1000) ignite(ctx, ship, next); }
  }
}

/**
 * Crew AI for enemy and autopilot ships (full) and for everyone out of combat (repairs only):
 * retreat to medbay when badly hurt, answer boarders → fires → breaches → damage with the nearest free crew, then return to stations.
 */
export function planCrew(ctx: Ctx, ship: Ship, full: boolean) {
  const hull = hullOf(ship), c = ctx.c, list = crewOn(ctx, ship).filter(alive);
  const mine = list.filter(m => m.faction === ship.faction && (ship.faction === 'enemy' || m.ownerId === ship.captainId));
  if (!mine.length) return;
  const team = full && c ? boarders(ctx, ship, mine) : [], medbay = systemRoom(ship, 'medbay');
  let idle = mine.filter(m => !team.includes(m) && !m.path.length && (m.state === 'idle' || m.state === 'manning' || m.state === 'healing') && !(m.roomId === medbay?.id && m.hp < m.maxHp));
  if (full && medbay && level(medbay)) for (const m of mine)
    if (m.hp < m.maxHp * .3 && dest(m) !== medbay.id && !team.includes(m) && space(ship, medbay.id, m.faction, list) > 0) { send(ship, m, medbay.id); idle = idle.filter(o => o !== m); }
  const jobs = ship.rooms.map(r => {
    const foes = c ? list.filter(m => m.roomId === r.id && m.faction !== ship.faction).length : 0;
    return { r, rank: foes ? 0 : r.fire ? 1 : r.breach ? 2 : 3, need: foes ? foes + 1 : r.fire ? Math.min(2, r.fire) : r.breach || r.damage ? 1 : 0 };
  }).filter(j => j.need).sort((a, b) => a.rank - b.rank);
  for (const { r, need } of jobs) for (let have = mine.filter(m => dest(m) === r.id).length; have < need && idle.length && space(ship, r.id, ship.faction, list) > 0; have++) {
    const m = nearest(hull, idle, r.id); send(ship, m, r.id); idle = idle.filter(o => o !== m);
  }
  if (full) for (const m of idle) { const st = stationOf(ship, m); if (st && dest(m) !== st && space(ship, st, m.faction, list) > 0) send(ship, m, st); }
}
/** Pilots are pulled off the helm last. */
const nearest = (hull: HullDef, crew: Crew[], roomId: string) => crew.reduce((best, m) => cost(hull, m, roomId) < cost(hull, best, roomId) ? m : best);
const cost = (hull: HullDef, m: Crew, roomId: string) => roomPath(hull, m.roomId, roomId).length + (m.role === 'pilot' ? 2 : 0);

/** Enemy ships with a teleporter gather two healthy crew in it, then beam them into an allied weapons or shields room. */
function boarders(ctx: Ctx, ship: Ship, mine: Crew[]): Crew[] {
  const c = ctx.c!, tp = systemRoom(ship, 'teleporter');
  if (ship.faction !== 'enemy' || !tp || !level(tp) || mine.length < 3 || ship.teleportCooldownMs > 5000) return [];
  const rank = (m: Crew) => m.role === 'soldier' ? 0 : m.role === 'pilot' ? 2 : 1;
  const team = mine.filter(m => m.hp > m.maxHp * .6 && m.state !== 'fighting').sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1)).slice(0, 2);
  if (team.length < 2) return [];
  for (const m of team) if (dest(m) !== tp.id) send(ship, m, tp.id);
  if (ship.teleportCooldownMs <= 0 && team.every(m => m.roomId === tp.id && m.state !== 'walking' && !m.path.length)) {
    const to = pick(c, ctx.world.ships.filter(s => s.status === 'active' && s.faction !== ship.faction));
    const room = to && (rand(c) < .5 ? ['weapons', 'shields'] as const : ['shields', 'weapons'] as const).map(id => systemRoom(to, id)).find(r => r && space(to, r.id, ship.faction, crewOn(ctx, to)) >= 2);
    if (room) beam(ctx, ship, team, to, room.id);
  }
  return team;
}

/** Queued boarding parties beam over together once every member stands on the pad and the teleporter is ready; stale queues are dropped. */
export function departures(ctx: Ctx, ship: Ship) {
  const pad = systemRoom(ship, 'teleporter'), queued = crewOn(ctx, ship).filter(m => m.beam && alive(m));
  for (const m of queued) if (!pad?.tier || ctx.ships.get(m.beam!.shipId)?.status !== 'active') delete m.beam;
  const live = queued.filter(m => m.beam); if (!pad || !live.length || !level(pad) || ship.teleportCooldownMs > 0) return;
  const { shipId, roomId } = live[0].beam!, group = live.filter(m => m.beam!.shipId === shipId && m.beam!.roomId === roomId), to = ctx.ships.get(shipId)!;
  if (group.some(m => m.roomId !== pad.id || m.path.length)) return;
  const fit = group.slice(0, space(to, roomId, ship.faction, crewOn(ctx, to))); if (!fit.length) return;
  for (const m of fit) delete m.beam;
  beam(ctx, ship, fit, to, roomId);
}
/** Teleport crew (all aboard one ship) into a room using `user`'s teleporter; starts its cooldown. */
export function beam(ctx: Ctx, user: Ship, crew: Crew[], to: Ship, roomId: string) {
  const from = crew[0].shipId, fromRoom = crew[0].roomId, cells = freeCells(to, roomId, crew[0].faction, crewOn(ctx, to));
  crew.forEach((m, i) => relocate(ctx, m, to, roomId, cells[i] ?? slotsOf(roomDef(to, roomId)!)[0]));
  user.teleportCooldownMs = TELEPORT_MS[Math.min(level(systemRoom(user, 'teleporter')!), 3) - 1];
  if (ctx.c) for (const [shipId, room] of [[from, fromRoom], [to.id, roomId]]) emit(ctx.c, 'teleport', shipId, { roomId: room, amount: crew.length, fromShipId: from });
}
function relocate(ctx: Ctx, m: Crew, to: Ship, roomId: string, at: { x: number; y: number }) {
  const old = ctx.aboard.get(m.shipId); old?.splice(old.indexOf(m), 1); ctx.aboard.get(to.id)?.push(m);
  Object.assign(m, { shipId: to.id, roomId, x: at.x, y: at.y, path: [], state: 'idle' });
}
/** Allied crew aboard a ship that jumps away are beamed home (any free cell), or lost if their captain has no ship. */
export function rescue(ctx: Ctx, m: Crew) {
  const home = ctx.world.ships.find(s => s.captainId === m.ownerId && s.status === 'active' && s.id !== m.shipId), from = m.shipId;
  const at = home && [systemRoom(home, 'teleporter'), ...home.rooms].flatMap(r => r ? freeCells(home, r.id, m.faction, crewOn(ctx, home)).map(s => ({ roomId: r.id, s })) : [])[0];
  if (!home || !at) return kill(ctx, m);
  relocate(ctx, m, home, at.roomId, at.s);
  if (ctx.c) emit(ctx.c, 'teleport', home.id, { roomId: at.roomId, amount: 1, fromShipId: from });
}

/** Path a crew member to a room of the ship they are on. */
export const send = (ship: Ship, m: Crew, roomId: string) => { m.path = m.roomId === roomId ? [] : roomPath(hullOf(ship), m.roomId, roomId); };
/** Validate and path a captain's crew (all aboard one ship) to a room on that ship. */
export function orderCrew(world: World, captainId: string, crewIds: readonly string[], roomId: string) {
  const crew = [...new Set(crewIds)].map(id => world.crew.find(m => m.id === id));
  if (!crew.length) throw new Error('Pick crew to move.');
  for (const m of crew) { if (!m || m.ownerId !== captainId) throw new Error("That crew member isn't yours."); if (!alive(m)) throw new Error('That crew member has fallen.'); }
  const list = crew as Crew[], ship = world.ships.find(s => s.id === list[0].shipId);
  if (list.some(m => m.shipId !== list[0].shipId)) throw new Error('Pick crew aboard one ship.');
  if (!ship || ship.status !== 'active') throw new Error('That ship is out of action.');
  if (!roomDef(ship, roomId)) throw new Error("That room isn't on this ship.");
  const moving = list.filter(m => dest(m) !== roomId);
  if (space(ship, roomId, list[0].faction, world.crew.filter(m => m.shipId === ship.id)) < moving.length) throw new Error('Not enough space in that room.');
  for (const m of list) delete m.beam; // a new order cancels a queued teleport
  for (const m of moving) send(ship, m, roomId);
}
/** Out of combat: crew walk, heal and fix damage; oxygen refills; ion wears off. */
export function stepIdle(world: World, dtMs: number) {
  for (let left = dtMs; left > 0; left -= 250) {
    const dt = Math.min(left, 250), ctx = context(world, null);
    for (const s of world.ships) if (s.status === 'active') { for (const r of s.rooms) r.ionMs = Math.max(0, r.ionMs - dt); planCrew(ctx, s, false); tickCrew(ctx, s, dt); }
  }
}
