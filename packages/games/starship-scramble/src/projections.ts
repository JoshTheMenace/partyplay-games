import type { Captain, CaptainView, Definitions, InteriorView, Item, ItemView, PrivateView, PublicView, Ship, ShipSummary, State } from './contracts';
import { activeCaptain, livingCrew } from './model';
import { availableChoices } from './expedition';
import { effectiveTier, roomManning } from './simulation';
export function captainView(state: State, captain: Captain): CaptainView {
  return { id: captain.id, playerId: captain.playerId, name: captain.name, color: captain.color, shipId: captain.currentOwnedShipId, connected: captain.connected, ready: captain.ready, vote: captain.vote, status: !activeCaptain(state, captain) ? 'spectator' : captain.currentOwnedShipId ? 'active' : 'shipless', crewCount: livingCrew(state, captain.id).length };
}
export function itemView(item: Item, defs: Definitions): ItemView {
  const bank = item.kind === 'weapon' ? defs.weapons : item.kind === 'drone' ? defs.drones : item.kind === 'system' ? defs.systems : defs.augments;
  const definition = bank.find(entry => entry.id === item.definitionId);
  return { id: item.id, definitionId: item.definitionId, kind: item.kind, name: definition?.name ?? 'Unknown equipment', description: definition?.description ?? '', price: item.price, version: item.version, ownerCaptainId: item.ownerCaptainId, carrierShipId: item.carrierShipId, location: item.location };
}
export function shipSummary(state: State, ship: Ship, defs: Definitions): ShipSummary {
  const hull = defs.hulls.find(item => item.id === ship.hullId)!;
  const alerts: string[] = [];
  if (ship.faction === 'allied' && ship.status === 'active' && !state.simulation.crew.some(crew => crew.currentShipId === ship.id && crew.ownerCaptainId !== null && crew.status === 'alive')) alerts.push('Uncrewed');
  if (ship.hull < ship.maxHull / 3 && ship.status === 'active') alerts.push('Critical hull');
  if (ship.rooms.some(room => room.fire > 0)) alerts.push('Fire');
  if (ship.rooms.some(room => room.breach > 0)) alerts.push('Hull breach');
  if (ship.rooms.some(room => room.oxygen < 25)) alerts.push('Low oxygen');
  if (state.simulation.crew.some(crew => crew.currentShipId === ship.id && crew.status === 'alive' && (crew.ownerCaptainId === null) !== (ship.faction === 'enemy'))) alerts.push('Boarders');
  return { id: ship.id, ownerCaptainId: ship.ownerCaptainId, faction: ship.faction, hullId: ship.hullId, name: ship.name, color: ship.color, formation: ship.formation, hull: ship.hull, maxHull: ship.maxHull, status: ship.status, shield: ship.shield, alerts, rooms: ship.rooms.map(room => ({ id: room.id, name: defs.systems.find(system => system.id === room.system)?.name ?? hull.rooms.find(geometry => geometry.id === room.id)!.name, system: room.system })), crewCount: state.simulation.crew.filter(crew => crew.currentShipId === ship.id && crew.status === 'alive').length, targetShipId: ship.weapons.find(weapon => weapon.order && !weapon.order.hold)?.order?.shipId ?? null, escapeAtMs: ship.escapeAtMs };
}
export function interiorView(state: State, ship: Ship, captain: Captain, defs: Definitions): InteriorView {
  const hull = defs.hulls.find(item => item.id === ship.hullId)!;
  const own = ship.ownerCaptainId === captain.id;
  const sensor = state.simulation.ships.find(item => item.id === captain.currentOwnedShipId)?.systems.find(system => system.id === 'scanner');
  const scanned = !!sensor && sensor.activeUntilMs > state.simulation.timeMs && sensor.targetShipId === ship.id || state.simulation.drones.some(drone => drone.targetShipId === ship.id && defs.drones.some(definition => definition.id === drone.definitionId && definition.behavior === 'scan') && state.simulation.ships.find(source => source.id === drone.sourceShipId)?.ownerCaptainId === captain.id);
  const visible = (roomId: string) => ship.faction === 'allied' || scanned || state.simulation.crew.some(crew => crew.currentShipId === ship.id && crew.roomId === roomId && crew.ownerCaptainId === captain.id && crew.status === 'alive');
  const tier = Math.max(0, ...ship.rooms.filter(room => room.system === 'weaponry').map(room => effectiveTier(room, state.simulation.timeMs)));
  return { ship: shipSummary(state, ship, defs), rooms: ship.rooms.map(room => {
    const geometry = hull.rooms.find(item => item.id === room.id)!;
    const known = visible(room.id);
    return { ...geometry, ...room, name: defs.systems.find(system => system.id === room.system)?.name ?? geometry.name, ...(known ? {} : { tier: 0, damage: 0, fire: 0, breach: 0, oxygen: 0, locked: false, disruptedUntilMs: 0 }), known, mannedBy: known ? roomManning(state, ship.id, room.id, defs) : null };
  }), crew: state.simulation.crew.filter(crew => crew.currentShipId === ship.id && crew.status === 'alive' && visible(crew.roomId)).map(crew => ({ ...crew, order: crew.ownerCaptainId === captain.id ? { ...crew.order } : { kind: 'hold', roomId: crew.roomId }, traits: [...crew.traits] })), weapons: own ? ship.weapons.map((weapon, index) => {
    const definition = defs.weapons.find(item => item.id === weapon.definitionId)!;
    return { ...weapon, name: definition.name, description: definition.description, family: definition.family, readyInMs: Math.max(0, definition.chargeMs - weapon.chargeMs), disabled: index >= tier || definition.tier > tier, ammoCost: definition.ammo, target: definition.target };
  }) : [], systems: own ? ship.systems.map(system => ({ ...system })) : [], ammo: own ? ship.ammo : 0 };
}
export function projectPublic(state: State, defs: Definitions): PublicView {
  const sector = defs.sectors.find(item => item.id === state.expedition.sectorIds[state.expedition.sectorIndex]);
  const instance = state.expedition.event;
  const event = instance && defs.events.find(item => item.id === instance.definitionId);
  return { phase: state.phase, epoch: state.epoch, timeMs: state.simulation.timeMs, paused: state.paused, pausedBy: state.pausedBy, leaderCaptainId: state.leaderCaptainId, captains: state.captains.map(captain => captainView(state, captain)), ships: [...state.captains.flatMap(captain => { const ship = state.simulation.ships.find(ship => ship.id === captain.currentOwnedShipId) ?? state.simulation.ships.filter(ship => ship.ownerCaptainId === captain.id).at(-1); return ship ? [ship] : []; }), ...state.simulation.ships.filter(ship => ship.faction === 'enemy')].map(ship => shipSummary(state, ship, defs)), effects: state.simulation.effects.slice(-32), drones: state.simulation.drones.map(drone => ({ ...drone })), sector: { index: state.expedition.sectorIndex + 1, count: state.expedition.sectorIds.length, name: sector?.name ?? 'The departure dock', color: sector?.color ?? '#28c6e7' }, beacons: state.expedition.beacons.map(beacon => ({ ...beacon, eventId: null, next: [...beacon.next] })), currentBeaconId: state.expedition.currentBeaconId, threat: state.expedition.threat, event: event && instance ? { id: instance.id, title: event.title, text: instance.text, result: instance.result, resolved: instance.resolved, choices: instance.resolved ? [] : availableChoices(state, defs) } : null, loot: state.expedition.items.filter(item => item.location === 'loot').map(item => itemView(item, defs)), objective: state.simulation.objective, message: state.message, result: state.result, assignment: state.phase === 'assignment' };
}
export function projectPrivate(state: State, playerId: string, defs: Definitions): PrivateView {
  const captain = state.captains.find(item => item.playerId === playerId);
  const empty: PrivateView = { captainId: null, captain: null, wallet: 0, cargoShipId: null, ownShip: null, inspectedShip: null, inspectedShipId: null, viewRequestId: 0, crew: [], inventory: [], store: [], controlledCrewId: null, queued: [], canAct: false, hulls: state.phase === 'hangar' ? defs.hulls : defs.hulls.filter(hull => state.simulation.ships.some(ship => ship.ownerCaptainId === captain?.id && ship.status === 'active' && ship.hullId === hull.id)) };
  if (!captain) return empty;
  const own = state.simulation.ships.find(ship => ship.id === captain.currentOwnedShipId && ship.status === 'active');
  const inspection = state.inspections[captain.id];
  const inspected = state.simulation.ships.find(ship => ship.id === inspection?.shipId && ['active', 'surrendered'].includes(ship.status));
  return { ...empty, captainId: captain.id, captain: captainView(state, captain), wallet: captain.wallet, cargoShipId: captain.cargoShipId, ownShip: own ? interiorView(state, own, captain, defs) : null, inspectedShip: inspected ? interiorView(state, inspected, captain, defs) : null, inspectedShipId: inspected?.id ?? null, viewRequestId: inspection?.requestId ?? 0, crew: state.simulation.crew.filter(crew => crew.ownerCaptainId === captain.id).map(crew => ({ ...crew, order: { ...crew.order }, traits: [...crew.traits] })), inventory: state.expedition.items.filter(item => item.ownerCaptainId === captain.id && ['cargo', 'installed'].includes(item.location)).map(item => itemView(item, defs)), store: state.expedition.items.filter(item => item.location === 'store' && item.stockCaptainId === captain.id).map(item => itemView(item, defs)), controlledCrewId: state.controlledCrew[captain.id] ?? null, queued: state.queue.filter(entry => entry.captainId === captain.id).map(entry => entry.command), canAct: activeCaptain(state, captain) };
}
