import type { Crew, Definitions, DomainEvent, Input, Projectile, Ship, State, SystemId } from '../contracts';
import { alive, augment, crewFriendly, effect, effectiveTier, layout, opponents, pathTo, present, random, roomFor, roomManning, shipById, standingPlaces, systemTier } from './core';

import { speciesFor } from '../definitions/presentation/species';

const activeSystem = (state: State, ship: Ship, id: SystemId) => systemTier(state, ship, id) > 0 && ship.systems.some(system => system.id === id && system.activeUntilMs > state.simulation.timeMs);
const onboard = (state: State, shipId: string) => state.simulation.crew.filter(crew => alive(crew) && crew.currentShipId === shipId);
function healHull(state: State, source: Ship, target: Ship, amount: number) {
  const restored = Math.min(amount, target.maxHull - target.hull);
  target.hull += restored;
  const captain = state.captains.find(captain => captain.id === source.ownerCaptainId);
  if (captain) captain.stats.repairs += restored;
}
function moveCrew(state: State, crew: Crew, ship: Ship, defs: Definitions, seconds: number, input: Input | undefined) {
  const settling = !input && crew.activity === 'moving';
  crew.activity = 'idle';
  const room = layout(defs, ship).rooms.find(room => room.id === crew.roomId)!;
  const speed = 2.4 * seconds * speciesFor(crew.species).speed;
  if (input && (input.x || input.y)) {
    crew.activity = 'direct';
    const magnitude = Math.max(1, Math.hypot(input.x, input.y));
    let x = crew.x + input.x / magnitude * speed;
    let y = crew.y + input.y / magnitude * speed;
    const target = layout(defs, ship).rooms.find(next => x >= next.x && x <= next.x + next.w && y >= next.y && y <= next.y + next.h);
    if (!target || (target.id !== room.id && (!room.adjacent.includes(target.id) || ship.rooms.find(r => r.id === room.id)?.locked || ship.rooms.find(r => r.id === target.id)?.locked || !standingPlaces(state, ship, target.id, defs).length))) return;
    x = Math.max(target.x + .1, Math.min(target.x + target.w - .1, x));
    y = Math.max(target.y + .1, Math.min(target.y + target.h - .1, y));
    if (onboard(state, ship.id).some(other => other.id !== crew.id && Math.hypot(other.x - x, other.y - y) < .3)) return;
    crew.x = x; crew.y = y; crew.roomId = target.id; crew.order = { kind: 'hold', roomId: target.id };
    return;
  }
  if (input) { crew.activity = 'idle'; crew.order = { kind: input.action === 'none' ? 'hold' : input.action, roomId: crew.roomId }; }
  if (crew.roomId === crew.order.roomId && crew.order.kind !== 'move' && (!settling || crew.order.kind === 'hold')) return;
  const path = crew.roomId === crew.order.roomId ? [crew.roomId, crew.roomId] : pathTo(ship, crew.roomId, crew.order.roomId, defs);
  if (!path || path.length < 2) { crew.activity = 'idle'; return; }
  const place = standingPlaces(state, ship, path[1], defs, [crew.id])[0];
  if (!place) { crew.activity = 'idle'; return; }
  const nextRoom = layout(defs, ship).rooms.find(room => room.id === path[1])!;
  const inside = (position: { x: number; y: number }, bounds: typeof room) => position.x >= bounds.x && position.x <= bounds.x + bounds.w && position.y >= bounds.y && position.y <= bounds.y + bounds.h;
  const left = Math.max(room.x, nextRoom.x), right = Math.min(room.x + room.w, nextRoom.x + nextRoom.w);
  const top = Math.max(room.y, nextRoom.y), bottom = Math.min(room.y + room.h, nextRoom.y + nextRoom.h);
  if (right < left || bottom < top) { crew.activity = 'idle'; return; }
  const target = inside(crew, nextRoom) ? place : { x: (left + right) / 2, y: (top + bottom) / 2 };
  const distance = Math.hypot(target.x - crew.x, target.y - crew.y);
  crew.activity = 'moving';
  if (distance <= speed) {
    if (onboard(state, ship.id).some(other => other.id !== crew.id && Math.hypot(other.x - target.x, other.y - target.y) < .3)) return;
    Object.assign(crew, target);
    if (inside(crew, nextRoom)) crew.roomId = path[1];
    if (target === place && crew.roomId === crew.order.roomId) crew.activity = 'idle';
  } else {
    const dx = (target.x - crew.x) / distance * speed, dy = (target.y - crew.y) / distance * speed;
    const candidates = [{ x: crew.x + dx, y: crew.y + dy }, { x: crew.x - dy, y: crew.y + dx }, { x: crew.x + dy, y: crew.y - dx }];
    const position = candidates.find(candidate => [room, nextRoom].some(bounds => inside(candidate, bounds)) && !onboard(state, ship.id).some(other => other.id !== crew.id && Math.hypot(other.x - candidate.x, other.y - candidate.y) < .3));
    if (position) { Object.assign(crew, position); if (inside(crew, nextRoom)) crew.roomId = nextRoom.id; }
  }
}
function crewStep(state: State, inputs: ReadonlyMap<string, Input>, seconds: number, defs: Definitions) {
  const combat = state.phase === 'combat';
  const damage = new Map<Crew, number>();
  for (const crew of [...state.simulation.crew].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!alive(crew)) continue;
    if (!combat && crew.ownerCaptainId === null) { crew.activity = 'idle'; continue; }
    const ship = shipById(state, crew.currentShipId);
    if (!ship) continue;
    const captain = state.captains.find(captain => captain.id === crew.ownerCaptainId);
    const held = captain?.playerId ? inputs.get(captain.playerId) : undefined;
    const input = state.controlledCrew[captain?.id ?? ''] === crew.id && held?.crewId === crew.id && held.controlEpoch === crew.controlEpoch ? held : undefined;
    if (state.controlledCrew[captain?.id ?? ''] === crew.id && !input) crew.order = { kind: 'hold', roomId: crew.roomId };
    moveCrew(state, crew, ship, defs, seconds, input);
    if (['moving', 'direct'].includes(crew.activity)) continue;
    const room = ship.rooms.find(room => room.id === crew.roomId)!;
    const enemies = onboard(state, ship.id).filter(other => other.roomId === room.id && opponents(crew, other)).sort((a, b) => a.id.localeCompare(b.id));
    if (combat && enemies.length) {
      crew.activity = 'fighting';
      const home = state.simulation.ships.find(ship => ship.ownerCaptainId === crew.ownerCaptainId && present(ship));
      damage.set(enemies[0], (damage.get(enemies[0]) ?? 0) + seconds * speciesFor(crew.species).melee * (crew.skill === 'fighter' ? 11 : 7) * (home ? 1 + augment(home, 'boarding', defs) : 1));
    } else if (crewFriendly(crew, ship) && (room.damage > 0 || room.fire > 0 || room.breach > 0) && crew.order.kind !== 'move' && crew.order.kind !== 'heal') {
      crew.activity = 'repairing';
      const repair = seconds * speciesFor(crew.species).repair * (crew.skill === 'engineer' ? 5 : 3) * (1 + augment(ship, 'repair', defs));
      room.fire = Math.max(0, room.fire - repair * 2); room.breach = Math.max(0, room.breach - repair); room.damage = Math.max(0, room.damage - repair);
      if (captain) captain.stats.repairs += repair;
    } else if (combat && !crewFriendly(crew, ship) && crew.order.kind !== 'move') {
      crew.activity = 'fighting'; room.damage = Math.min(room.tier * 10, room.damage + seconds * 2); ship.hull -= seconds * .1;
    } else if ((room.system === 'medical' && effectiveTier(room, state.simulation.timeMs) > 0) || crew.order.kind === 'heal') {
      const medic = room.system === 'medical' || onboard(state, ship.id).some(other => other.roomId === room.id && other.skill === 'medic' && !opponents(crew, other));
      if (medic && crew.hp < crew.maxHp) { crew.activity = 'healing'; crew.hp = Math.min(crew.maxHp, crew.hp + seconds * 5 * (1 + augment(ship, 'medical', defs))); }
    }
  }
  for (const [crew, amount] of damage) crew.hp -= amount;
}
function aiStep(state: State, ship: Ship, defs: Definitions) {
  if (ship.faction !== 'enemy' || ship.status !== 'active') return;
  const targets = state.simulation.ships.filter(target => target.faction === 'allied' && target.status === 'active');
  if (!targets.length) return;
  const target = [...targets].sort((a, b) => ship.ai === 'hunter' || ship.ai === 'aggressive' ? a.hull - b.hull || a.formation - b.formation : a.formation - b.formation)[0];
  const preferred = ship.ai === 'shield-breaker' ? 'shields' : ship.ai === 'saboteur' ? 'life-support' : ship.ai === 'artillery' ? 'weaponry' : 'engines';
  const teleporter = ship.systems.find(system => system.id === 'teleporter');
  if (ship.ai === 'boarder' && teleporter && systemTier(state, ship, 'teleporter') > 0 && teleporter.cooldownUntilMs <= state.simulation.timeMs && target.shield <= 0) {
    const room = target.rooms.find(room => room.system === 'weaponry') ?? target.rooms[0];
    const places = standingPlaces(state, target, room.id, defs);
    const boarders = onboard(state, ship.id).filter(crew => crew.ownerCaptainId === null).slice(0, Math.min(2, places.length));
    for (const [index, crew] of boarders.entries()) { crew.currentShipId = target.id; crew.roomId = room.id; Object.assign(crew, places[index]); crew.order = { kind: 'fight', roomId: room.id }; crew.activity = 'fighting'; }
    if (boarders.length) { teleporter.cooldownUntilMs = state.simulation.timeMs + 14000; effect(state, 'teleport', ship.id, target.id, 'Boarders incoming'); }
  }
  for (const weapon of ship.weapons) {
    if (weapon.order && shipById(state, weapon.order.shipId)?.status === 'active') continue;
    const definition = defs.weapons.find(definition => definition.id === weapon.definitionId)!;
    const destination = definition.target === 'ally' ? [...state.simulation.ships].filter(candidate => candidate.faction === 'enemy' && candidate.status === 'active').sort((a, b) => a.hull / a.maxHull - b.hull / b.maxHull)[0] : target;
    weapon.order = { shipId: destination.id, roomId: (destination.rooms.find(room => room.system === preferred) ?? destination.rooms[0]).id, hold: false };
  }
  if (ship.ai === 'coward' && ship.hull < ship.maxHull * .3 && ship.escapeAtMs === null) { ship.escapeAtMs = state.simulation.timeMs + 12000; effect(state, 'warning', ship.id, ship.id, 'Escape in 12 seconds; extract boarders'); }
  if (ship.ai === 'support' && ship.hull < ship.maxHull * .15 && ship.escapeAtMs === null) { ship.status = 'surrendered'; ship.weapons.forEach(weapon => { weapon.order = null; }); effect(state, 'warning', ship.id, ship.id, 'Surrendered; extract your crew before leaving'); }
  for (const system of ship.systems) {
    if (!systemTier(state, ship, system.id) || system.cooldownUntilMs > state.simulation.timeMs) continue;
    const definition = defs.systems.find(definition => definition.id === system.id);
    if (!definition || ['teleporter', 'drone-bay', 'piloting', 'engines', 'shields', 'weaponry', 'life-support', 'doors', 'medical'].includes(system.id)) continue;
    const hostile = ['hacking', 'tractor', 'scanner'].includes(system.id);
    const destination = hostile ? target : ship;
    system.targetShipId = destination.id; system.targetRoomId = (destination.rooms.find(room => room.system === preferred) ?? destination.rooms[0]).id;
    const sensors = system.id === 'scanner' ? 1 + augment(ship, 'sensors', defs) : 1;
    system.activeUntilMs = state.simulation.timeMs + definition.durationMs * sensors;
    system.cooldownUntilMs = state.simulation.timeMs + definition.cooldownMs / sensors;
    if (system.id === 'hacking') destination.rooms.find(room => room.id === system.targetRoomId)!.disruptedUntilMs = system.activeUntilMs;
    if (system.id === 'shield-projector') destination.shield = Math.min(systemTier(state, destination, 'shields') * 2 + definition.strength, destination.shield + definition.strength);
  }
}
function shipStep(state: State, ship: Ship, seconds: number, defs: Definitions) {
  const combat = state.phase === 'combat';
  const life = systemTier(state, ship, 'life-support');
  for (const room of ship.rooms) {
    const oxygenChange = seconds * (life * 4 * (1 + augment(ship, 'oxygen', defs)) - room.breach * 3 - room.fire * .3 - (life ? 0 : 2));
    room.oxygen = Math.max(0, Math.min(100, room.oxygen + (combat ? oxygenChange : Math.max(0, oxygenChange))));
    if (!combat) continue;
    if (room.fire > 0) {
      if (room.oxygen < 10) room.fire = Math.max(0, room.fire - seconds * 3);
      room.damage = Math.min(room.tier * 10, room.damage + room.fire * seconds * .1);
      ship.hull -= room.fire * seconds * .015;
    }
    for (const crew of onboard(state, ship.id).filter(crew => crew.roomId === room.id)) crew.hp -= seconds * (room.fire * .4 + (room.oxygen < 15 ? 6 : 0));
  }
  const shields = systemTier(state, ship, 'shields');
  const shieldRoom = roomFor(ship, 'shields');
  const maxShield = shields * 2 + augment(ship, 'shield', defs);
  const reinforcement = state.simulation.ships.filter(present).reduce((sum, source) => sum + source.systems.filter(system => system.id === 'shield-projector' && system.targetShipId === ship.id && activeSystem(state, source, system.id)).reduce((strength, system) => strength + (defs.systems.find(definition => definition.id === system.id)?.strength ?? 0) * systemTier(state, source, system.id), 0), 0);
  ship.shield = Math.min(ship.shield, maxShield + reinforcement);
  if (shields && ship.shield < maxShield) {
    ship.shieldChargeMs += seconds * 1000 * (shieldRoom && roomManning(state, ship.id, shieldRoom.id, defs) ? 1.25 : 1);
    if (ship.shieldChargeMs >= 5000) { ship.shield = Math.min(maxShield, ship.shield + 1); ship.shieldChargeMs -= 5000; }
  } else ship.shieldChargeMs = 0;
  if (!shields) ship.shield = 0;
  for (const system of ship.systems) {
    if (!activeSystem(state, ship, system.id)) continue;
    const target = shipById(state, system.targetShipId ?? '');
    const room = target?.rooms.find(room => room.id === system.targetRoomId);
    const definition = defs.systems.find(definition => definition.id === system.id);
    if (!target || !room || !definition) continue;
    const strength = definition.strength * systemTier(state, ship, system.id) * seconds / Math.max(1, definition.durationMs / 1000);
    if (system.id === 'repair-relay') { healHull(state, ship, target, strength * .5); room.damage = Math.max(0, room.damage - strength); room.breach = Math.max(0, room.breach - strength * .5); }
    if (system.id === 'medical-support') for (const crew of onboard(state, target.id).filter(crew => crewFriendly(crew, ship) && crew.roomId === room.id)) crew.hp = Math.min(crew.maxHp, crew.hp + strength * 3);
    if (combat && system.id === 'boarding-defense') for (const crew of onboard(state, ship.id).filter(crew => !crewFriendly(crew, ship))) crew.hp -= strength * 2;
    if (combat && system.id === 'tractor') for (const drone of state.simulation.drones.filter(drone => drone.sourceShipId === target.id)) { drone.nextAtMs += seconds * 700; drone.hp -= strength; }
  }
}
function weaponStep(state: State, ship: Ship, seconds: number, defs: Definitions) {
  if (ship.status !== 'active') return;
  const weaponry = ship.rooms.find(room => room.system === 'weaponry');
  const tier = weaponry ? effectiveTier(weaponry, state.simulation.timeMs) : 0;
  const capacity = Math.min(layout(defs, ship).maxWeapons, tier);
  const manning = weaponry && roomManning(state, ship.id, weaponry.id, defs) ? 1.2 : 1;
  const captainAlive = ship.ownerCaptainId === null || state.simulation.crew.some(crew => crew.ownerCaptainId === ship.ownerCaptainId && alive(crew));
  for (const [slot, weapon] of ship.weapons.entries()) {
    const definition = defs.weapons.find(definition => definition.id === weapon.definitionId);
    if (!definition || slot >= capacity || definition.tier > tier) continue;
    weapon.chargeMs = Math.min(definition.chargeMs, weapon.chargeMs + seconds * 1000 * manning * (1 + augment(ship, 'reload', defs)));
    const order = weapon.order;
    if (!order || order.hold || !captainAlive) continue;
    const target = shipById(state, order.shipId);
    if (!target || (definition.target === 'enemy' && target.status !== 'active')) { weapon.order = null; continue; }
    if (weapon.chargeMs < definition.chargeMs || ship.ammo < definition.ammo) continue;
    if (activeSystem(state, target, 'cloak') && !activeSystem(state, ship, 'scanner')) continue;
    weapon.chargeMs = 0;
    if (!definition.ammo || random(state) >= augment(ship, 'ammo', defs)) ship.ammo -= definition.ammo;
    const cloak = ship.systems.find(system => system.id === 'cloak');
    if (cloak) cloak.activeUntilMs = 0;
    for (let shot = 0; shot < definition.shots; shot++) {
      const roomId = definition.family === 'flak' ? target.rooms[Math.floor(random(state) * target.rooms.length)].id : order.roomId;
      state.simulation.projectiles.push({ id: `shot-${state.simulation.nextId++}`, sourceShipId: ship.id, targetShipId: target.id, roomId, weaponId: definition.id, arriveAtMs: state.simulation.timeMs + (definition.family === 'beam' ? 0 : definition.family === 'missile' || definition.family === 'boarding' ? 1300 : 550) + shot * 80, damage: definition.damage, shieldDamage: definition.shieldDamage, pierce: definition.pierce, roomDamage: definition.roomDamage, crewDamage: definition.crewDamage, fire: definition.fire, breach: definition.breach, ionMs: definition.ionMs, family: definition.family });
    }
    effect(state, 'shot', ship.id, target.id, definition.name);
  }
}
function impact(state: State, projectile: Projectile, defs: Definitions) {
  const target = shipById(state, projectile.targetShipId);
  if (!target) return;
  const source = state.simulation.ships.find(ship => ship.id === projectile.sourceShipId);
  const room = target.rooms.find(room => room.id === projectile.roomId);
  if (!room) return;
  if (projectile.family === 'support') {
    if (source) healHull(state, source, target, Math.abs(projectile.damage));
    target.shield = Math.min(8, target.shield + Math.abs(projectile.shieldDamage)); room.damage = Math.max(0, room.damage - Math.abs(projectile.roomDamage));
    for (const crew of onboard(state, target.id).filter(crew => crew.roomId === room.id && crewFriendly(crew, target))) crew.hp = Math.min(crew.maxHp, crew.hp + Math.abs(projectile.crewDamage));
    effect(state, 'repair', projectile.sourceShipId, target.id, 'Support delivered'); return;
  }
  const interceptable = ['missile', 'boarding', 'flak'].includes(projectile.family);
  const interceptor = state.simulation.drones.find(drone => drone.targetShipId === target.id && drone.hp > 0 && systemTier(state, shipById(state, drone.sourceShipId) ?? target, 'drone-bay') > 0 && defs.drones.find(def => def.id === drone.definitionId)?.behavior === 'intercept');
  if (interceptable && (activeSystem(state, target, 'point-defense') || interceptor)) {
    const defense = target.systems.find(system => system.id === 'point-defense');
    if (interceptor || (defense && defense.activeUntilMs - state.simulation.timeMs > 400)) { if (interceptor) interceptor.hp -= Math.max(1, projectile.damage / 2); else if (defense) defense.activeUntilMs = Math.max(state.simulation.timeMs, defense.activeUntilMs - 1000); effect(state, 'shield', target.id, target.id, 'Projectile intercepted'); return; }
  }
  if (activeSystem(state, target, 'decoy') && source?.ai !== 'hunter' && random(state) < .6) return;
  const pilot = roomFor(target, 'piloting');
  const cloaked = activeSystem(state, target, 'cloak') && !(source && activeSystem(state, source, 'scanner'));
  const evasion = Math.min(cloaked ? .9 : .55, systemTier(state, target, 'engines') * .04 + (pilot && roomManning(state, target.id, pilot.id, defs) ? .08 : 0) + augment(target, 'evasion', defs) + (cloaked ? .7 : 0));
  if (projectile.family !== 'beam' && random(state) < evasion) { effect(state, 'shield', target.id, target.id, 'Evaded'); return; }
  const blocked = target.shield > projectile.pierce;
  target.shield = Math.max(0, target.shield - projectile.shieldDamage);
  if (blocked && projectile.family !== 'ion') { effect(state, 'shield', projectile.sourceShipId, target.id, 'Shields absorbed the hit'); return; }
  if (projectile.ionMs > 0) { room.disruptedUntilMs = Math.max(room.disruptedUntilMs, state.simulation.timeMs + projectile.ionMs); if (blocked) return; }
  const beamScale = projectile.family === 'beam' && target.shield > 0 ? .5 : 1;
  const amount = projectile.damage * beamScale / (1 + augment(target, 'hull', defs));
  target.hull -= amount;
  room.damage = Math.min(room.tier * 10, room.damage + projectile.roomDamage);
  room.fire = Math.min(20, room.fire + projectile.fire); room.breach = Math.min(10, room.breach + projectile.breach);
  for (const crew of onboard(state, target.id).filter(crew => crew.roomId === room.id)) crew.hp -= projectile.crewDamage;
  if (source) {
    const captain = state.captains.find(captain => captain.id === source.ownerCaptainId);
    if (captain) captain.stats.damage += amount;
  }
  effect(state, 'impact', projectile.sourceShipId, target.id, `${Math.round(amount)} hull damage`);
}
function dronesStep(state: State, defs: Definitions) {
  for (const drone of state.simulation.drones) {
    const source = shipById(state, drone.sourceShipId);
    const target = shipById(state, drone.targetShipId);
    const definition = defs.drones.find(definition => definition.id === drone.definitionId);
    if (!source || !target || !definition) { drone.hp = 0; continue; }
    if (!systemTier(state, source, 'drone-bay') || drone.nextAtMs > state.simulation.timeMs || drone.hp <= 0) continue;
    drone.nextAtMs = state.simulation.timeMs + definition.intervalMs;
    const room = target.rooms.find(room => room.id === drone.targetRoomId);
    if (!room) { drone.hp = 0; continue; }
    const strength = definition.strength;
    switch (definition.behavior) {
      case 'attack': if (target.shield > 0) target.shield = Math.max(0, target.shield - strength); else target.hull -= strength; break;
      case 'intercept': { const hostile = state.simulation.drones.find(other => other.sourceShipId !== source.id && shipById(state, other.sourceShipId)?.faction !== source.faction && other.targetShipId === target.id); if (hostile) hostile.hp -= strength; break; }
      case 'repair': healHull(state, source, target, strength); room.damage = Math.max(0, room.damage - strength * 2); room.breach = Math.max(0, room.breach - strength); break;
      case 'board': { const victims = onboard(state, target.id).filter(crew => !crewFriendly(crew, source) && crew.roomId === room.id); victims.forEach(crew => { crew.hp -= strength * 3; }); room.damage = Math.min(room.tier * 10, room.damage + strength); drone.hp -= victims.length; break; }
      case 'scan': { const scanner = source.systems.find(system => system.id === 'scanner'); if (scanner) { scanner.targetShipId = target.id; scanner.activeUntilMs = state.simulation.timeMs + definition.intervalMs * 2; } room.disruptedUntilMs = Math.max(0, room.disruptedUntilMs - strength * 100); break; }
      case 'shield': target.shield = Math.min(8, target.shield + strength); break;
      case 'heal': onboard(state, target.id).filter(crew => crewFriendly(crew, source)).forEach(crew => { crew.hp = Math.min(crew.maxHp, crew.hp + strength * 4); }); break;
      case 'fire': room.fire = Math.min(20, room.fire + strength); break;
      case 'ion': target.shield = Math.max(0, target.shield - 1); room.disruptedUntilMs = state.simulation.timeMs + Math.max(1000, strength); break;
      case 'breach': room.breach = Math.min(10, room.breach + strength); target.hull -= strength * .5; break;
      case 'decoy': { const projectile = state.simulation.projectiles.find(projectile => projectile.targetShipId === target.id && projectile.family !== 'beam'); if (projectile) { state.simulation.projectiles = state.simulation.projectiles.filter(shot => shot.id !== projectile.id); drone.hp -= Math.max(1, projectile.damage); } break; }
      case 'salvage': if (state.simulation.ships.some(ship => ship.faction !== source.faction && ship.status === 'destroyed')) { source.ammo = Math.min(40, source.ammo + strength); drone.hp -= 1; } break;
    }
  }
  state.simulation.drones = state.simulation.drones.filter(drone => drone.hp > 0);
}
export function destroyShips(state: State): DomainEvent[] {
  const events: DomainEvent[] = [];
  const destroyed = state.simulation.ships.filter(ship => present(ship) && ship.hull <= 0);
  for (const ship of destroyed) {
    ship.hull = 0; ship.status = 'destroyed'; ship.shield = 0; ship.escapeAtMs = null;
    ship.weapons.forEach(weapon => { weapon.order = null; weapon.chargeMs = 0; });
    ship.systems.forEach(system => { system.activeUntilMs = 0; system.targetShipId = null; system.targetRoomId = null; });
    for (const crew of state.simulation.crew.filter(crew => crew.currentShipId === ship.id && crew.status === 'alive')) crew.hp = 0;
    events.push({ kind: 'ship-destroyed', shipId: ship.id });
    effect(state, 'destroyed', ship.id, ship.id, `${ship.name} destroyed`);
  }
  for (const crew of state.simulation.crew.filter(crew => crew.status === 'alive' && crew.hp <= 0)) {
    crew.hp = 0; crew.status = 'dead'; crew.activity = 'idle'; crew.controlEpoch++;
    if (crew.ownerCaptainId && state.controlledCrew[crew.ownerCaptainId] === crew.id) delete state.controlledCrew[crew.ownerCaptainId];
    events.push({ kind: 'crew-lost', crewId: crew.id });
  }
  for (const ship of state.simulation.ships) for (const weapon of ship.weapons) if (weapon.order && !shipById(state, weapon.order.shipId)) weapon.order = null;
  state.simulation.drones = state.simulation.drones.filter(drone => drone.hp > 0 && shipById(state, drone.sourceShipId) && shipById(state, drone.targetShipId));
  return events;
}
export function tickSimulation(state: State, inputs: ReadonlyMap<string, Input>, dtMs: number, defs: Definitions): DomainEvent[] {
  if (state.paused || !Number.isFinite(dtMs) || dtMs <= 0) return [];
  const seconds = Math.min(dtMs, 250) / 1000;
  state.simulation.timeMs += seconds * 1000;
  state.simulation.effects = state.simulation.effects.filter(effect => effect.atMs > state.simulation.timeMs - 4000).slice(-64);
  crewStep(state, inputs, seconds, defs);
  for (const ship of state.simulation.ships.filter(present)) { if (state.phase === 'combat') aiStep(state, ship, defs); shipStep(state, ship, seconds, defs); }
  if (state.phase === 'combat') {
    for (const ship of state.simulation.ships.filter(present)) weaponStep(state, ship, seconds, defs);
    dronesStep(state, defs);
  }
  const arrivals = state.simulation.projectiles.filter(projectile => projectile.arriveAtMs <= state.simulation.timeMs);
  state.simulation.projectiles = state.simulation.projectiles.filter(projectile => projectile.arriveAtMs > state.simulation.timeMs);
  if (state.phase === 'combat') for (const projectile of arrivals) impact(state, projectile, defs);
  const events = destroyShips(state);
  if (state.phase !== 'combat') return events;
  for (const ship of state.simulation.ships.filter(ship => ship.status === 'active' && ship.escapeAtMs !== null && ship.escapeAtMs <= state.simulation.timeMs)) {
    ship.status = 'escaped'; ship.weapons.forEach(weapon => { weapon.order = null; });
    events.push({ kind: 'enemy-escaped', shipId: ship.id });
    for (const crew of onboard(state, ship.id)) { crew.status = 'captured'; crew.activity = 'idle'; crew.controlEpoch++; if (crew.ownerCaptainId) delete state.controlledCrew[crew.ownerCaptainId]; events.push({ kind: 'crew-lost', crewId: crew.id }); }
  }
  const allies = state.simulation.ships.filter(ship => ship.faction === 'allied' && present(ship));
  const enemies = state.simulation.ships.filter(ship => ship.faction === 'enemy' && ship.status === 'active');
  const livingCaptains = state.simulation.crew.some(crew => crew.ownerCaptainId !== null && alive(crew));
  const objective = state.simulation.objective;
  if (!allies.length || !livingCaptains) events.push({ kind: 'combat-complete', result: 'defeat' });
  else if (objective?.deadlineMs !== null && objective?.deadlineMs !== undefined && objective.deadlineMs <= state.simulation.timeMs && ['survive', 'escape', 'defend'].includes(objective.kind)) events.push({ kind: 'combat-complete', result: objective.kind === 'escape' ? 'escape' : 'victory' });
  else if (!enemies.length) events.push({ kind: 'combat-complete', result: state.simulation.ships.some(ship => ship.status === 'surrendered') ? 'surrender' : 'victory' });
  return events;
}
