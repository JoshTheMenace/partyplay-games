import type { CaptainId, Definitions, DomainEvent, SimulationCommand, State } from '../contracts';
import { actorShip, alive, augment, effect, ownedCrew, pathTo, releaseControl, requireValue, roomFor, shipById, standingPlaces, systemTier } from './core';

export function applySimulationCommand(state: State, actorId: CaptainId, command: SimulationCommand, defs: Definitions): DomainEvent[] {
  requireValue(state.simulation.crew.some(crew => crew.ownerCaptainId === actorId && alive(crew)), 'No available crew remain.');
  if (command.type === 'orderCrew') {
    const crew = ownedCrew(state, actorId, command.crewId);
    const ship = requireValue(shipById(state, crew.currentShipId), 'This vessel is unavailable.');
    requireValue(ship.rooms.find(room => room.id === command.roomId), 'Choose an existing room.');
    requireValue(pathTo(ship, crew.roomId, command.roomId, defs), 'Locked doors block that route.');
    if (crew.roomId !== command.roomId) requireValue(standingPlaces(state, ship, command.roomId, defs).length, 'That room is full.');
    if (state.controlledCrew[actorId] === crew.id) releaseControl(state, actorId);
    crew.order = { kind: command.order, roomId: command.roomId };
    crew.activity = crew.roomId === command.roomId ? 'idle' : 'moving';
    return [];
  }
  if (command.type === 'controlCrew') {
    const crew = command.crewId ? ownedCrew(state, actorId, command.crewId) : null;
    releaseControl(state, actorId);
    if (crew) { state.controlledCrew[actorId] = crew.id; crew.controlEpoch++; crew.activity = 'direct'; }
    return [];
  }
  if (command.type === 'teleportCrew') {
    requireValue(command.crewIds.length && command.crewIds.length <= 8 && new Set(command.crewIds).size === command.crewIds.length, 'Select distinct crew to transport.');
    const crew = command.crewIds.map(id => ownedCrew(state, actorId, id));
    const source = requireValue(shipById(state, command.transporterShipId), 'Transporter unavailable.');
    const target = requireValue(shipById(state, command.targetShipId), 'Destination destroyed or unavailable.');
    const room = requireValue(target.rooms.find(room => room.id === command.roomId), 'Choose a destination room.');
    const transporter = requireValue(source.systems.find(system => system.id === 'teleporter'), 'This ship has no teleporter.');
    const tier = systemTier(state, source, 'teleporter');
    requireValue(source.faction === 'allied' && tier > 0 && transporter.cooldownUntilMs <= state.simulation.timeMs, 'The allied teleporter is damaged or recharging.');
    requireValue(crew.length <= tier + 1, `This teleporter can carry ${tier + 1} crew.`);
    requireValue(crew.every(member => shipById(state, member.currentShipId) && (member.currentShipId === source.id || target.id === source.id)), 'Transport must depart from or return to the selected teleporter.');
    requireValue(target.faction === 'allied' || target.status === 'surrendered' || target.shield <= Math.max(0, tier - 1), 'Enemy shields block boarding.');
    requireValue(!room.locked && room.disruptedUntilMs <= state.simulation.timeMs, 'Destination is locked or jammed.');
    const places = standingPlaces(state, target, room.id, defs, command.crewIds);
    requireValue(places.length >= crew.length, 'Destination is full; nobody was transported.');
    for (const [index, member] of crew.entries()) {
      if (state.controlledCrew[actorId] === member.id) releaseControl(state, actorId);
      member.currentShipId = target.id; member.roomId = room.id; Object.assign(member, places[index]);
      member.order = { kind: 'hold', roomId: room.id }; member.activity = 'idle'; member.controlEpoch++;
    }
    transporter.cooldownUntilMs = state.simulation.timeMs + (defs.systems.find(system => system.id === 'teleporter')?.cooldownMs ?? 8000) / (tier * (1 + augment(source, 'teleport', defs)));
    effect(state, 'teleport', source.id, target.id, `${crew.length} crew transferred`);
    return [];
  }
  const ship = actorShip(state, actorId);
  requireValue(ship.ownerCaptainId === actorId && ship.status === 'active', 'Only this ship’s captain may operate it.');
  if (command.type === 'targetWeapon' || command.type === 'holdFire') {
    const weapon = requireValue(ship.weapons.find(weapon => weapon.itemId === command.weaponId), 'That weapon is not installed on your ship.');
    if (command.type === 'holdFire') { requireValue(weapon.order, 'Choose a target first.').hold = command.hold; return []; }
    const definition = requireValue(defs.weapons.find(definition => definition.id === weapon.definitionId), 'Weapon definition unavailable.');
    const target = requireValue(shipById(state, command.targetShipId), 'Target no longer exists.');
    requireValue(target.rooms.find(room => room.id === command.roomId), 'Target room no longer exists.');
    requireValue(definition.target === 'ally' ? target.faction === ship.faction : target.faction !== ship.faction && target.status === 'active', 'This weapon cannot target that vessel.');
    weapon.order = { shipId: target.id, roomId: command.roomId, hold: false };
  } else if (command.type === 'setDoor') {
    requireValue(systemTier(state, ship, 'doors') > 0, 'Door controls are disabled.');
    requireValue(ship.rooms.find(room => room.id === command.roomId), 'Unknown room.').locked = command.locked;
  } else if (command.type === 'deployDrone') {
    const item = requireValue(state.expedition.items.find(item => item.id === command.itemId && item.ownerCaptainId === actorId && item.kind === 'drone' && ['cargo', 'installed'].includes(item.location) && item.carrierShipId === ship.id), 'Carry an owned drone on this ship first.');
    const definition = requireValue(defs.drones.find(drone => drone.id === item.definitionId), 'Unknown drone.');
    const target = requireValue(shipById(state, command.targetShipId), 'Drone target unavailable.');
    requireValue(target.rooms.find(room => room.id === command.roomId), 'Unknown target room.');
    const hostile = ['attack', 'board', 'fire', 'ion', 'breach'].includes(definition.behavior);
    requireValue(hostile ? target.faction !== ship.faction && target.status === 'active' : ['scan', 'salvage'].includes(definition.behavior) || target.faction === ship.faction, 'Choose a legal target for this drone.');
    const tier = systemTier(state, ship, 'drone-bay');
    requireValue(tier > state.simulation.drones.filter(drone => drone.sourceShipId === ship.id).length, 'Drone bay is damaged or at capacity.');
    requireValue(!state.simulation.drones.some(drone => drone.id === item.id), 'That drone is already deployed.');
    requireValue(ship.ammo >= 1, 'Drone deployment requires one ammunition unit.');
    ship.ammo--;
    state.simulation.drones.push({ id: item.id, definitionId: item.definitionId, sourceShipId: ship.id, targetShipId: target.id, targetRoomId: command.roomId, hp: definition.hp, nextAtMs: state.simulation.timeMs + definition.intervalMs });
  } else if (command.type === 'activateSystem') {
    requireValue(!['piloting', 'engines', 'shields', 'weaponry', 'life-support', 'doors', 'medical', 'teleporter', 'drone-bay'].includes(command.systemId), 'Use this system’s crew or deployment controls.');
    const system = requireValue(ship.systems.find(system => system.id === command.systemId), 'This system is not installed.');
    const definition = requireValue(defs.systems.find(system => system.id === command.systemId), 'Unknown system.');
    const tier = systemTier(state, ship, command.systemId);
    requireValue(tier && system.cooldownUntilMs <= state.simulation.timeMs, 'System is disabled or recharging.');
    const target = requireValue(shipById(state, command.targetShipId), 'System target unavailable.');
    const room = requireValue(target.rooms.find(room => room.id === command.roomId), 'Choose an existing room.');
    const hostile = ['hacking', 'tractor', 'scanner'].includes(command.systemId);
    requireValue(hostile ? target.faction !== ship.faction : target.faction === ship.faction, 'Choose a legal system target.');
    requireValue(!['cloak', 'point-defense', 'decoy', 'boarding-defense'].includes(command.systemId) || target.id === ship.id, 'This system protects its own vessel.');
    system.targetShipId = target.id; system.targetRoomId = room.id;
    const sensors = command.systemId === 'scanner' ? 1 + augment(ship, 'sensors', defs) : 1;
    system.activeUntilMs = state.simulation.timeMs + Math.max(1000, definition.durationMs) * (1 + (tier - 1) * .25) * sensors;
    system.cooldownUntilMs = state.simulation.timeMs + definition.cooldownMs / sensors;
    if (command.systemId === 'hacking') { room.disruptedUntilMs = system.activeUntilMs; if (room.system === 'doors') target.rooms.forEach(room => { room.locked = false; }); }
    if (command.systemId === 'shield-projector') target.shield = Math.min(systemTier(state, target, 'shields') * 2 + definition.strength * tier, target.shield + definition.strength * tier);
    if (command.systemId === 'boarding-defense') roomFor(ship, 'doors').locked = false;
    effect(state, command.systemId === 'repair-relay' || command.systemId === 'medical-support' ? 'repair' : 'shield', ship.id, target.id, definition.name);
  }
  return [];
}
