import type { GameRules } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import type { Action, Captain, DomainEvent, EconomyCommand, EventEffect, Input, PrivateView, PublicView, Settings, Ship, SimulationCommand, State } from './contracts';
import { CONTENT_VERSION, SCHEMA_VERSION } from './contracts';
import { activeCaptain, captainFor, changePhase, eligibleCaptains, livingCrew } from './model';
import { definitions as defs } from './definitions/server';
import { SPECIES, speciesFor } from './definitions/presentation/species';
import { advanceSector, applyEconomyCommand, availableChoices, awardRewards, createExpedition, enterBeacon, openStore, resolveEvent, suppliesCapability } from './expedition';
import { applySimulationCommand, createShip, destroyShips, standingPlaces, tickSimulation } from './simulation';
import { projectPrivate, projectPublic } from './projections';
import { exportSave, loadSave } from './save';
const simulationActions = new Set(['targetWeapon', 'holdFire', 'orderCrew', 'controlCrew', 'teleportCrew', 'activateSystem', 'deployDrone', 'setDoor']);
const economyActions = new Set(['collectItem', 'purchaseItem', 'sellItem', 'installItem', 'upgradeRoom', 'repairHull', 'buyAmmo', 'transferCargo', 'recruitCrew']);
const fields: Record<string, string[]> = {
  targetWeapon: ['weaponId', 'targetShipId', 'roomId'], holdFire: ['weaponId'], orderCrew: ['crewId', 'roomId', 'order'], controlCrew: [], teleportCrew: ['transporterShipId', 'targetShipId', 'roomId'], activateSystem: ['systemId', 'targetShipId', 'roomId'], deployDrone: ['itemId', 'targetShipId', 'roomId'], setDoor: ['roomId'], collectItem: ['itemId'], purchaseItem: ['itemId'], sellItem: ['itemId'], installItem: ['itemId'], upgradeRoom: ['roomId'], repairHull: [], buyAmmo: [], transferCargo: ['shipId'], recruitCrew: ['skill'], chooseHull: ['hullId', 'name', 'color'], claimCaptain: ['captainId'], ready: [], pause: [], retreat: [], resume: [], vote: ['choiceId'], commitChoice: ['choiceId'], contribute: ['choiceId'], continue: [], abandonCrew: [], abandonShip: ['shipId'], inspectShip: ['shipId'],
};
export function parseAction(raw: unknown): Action {
  assertSerializable(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid command.');
  const action = raw as Record<string, unknown>;
  if (typeof action.type !== 'string' || !Object.hasOwn(fields, action.type) || !Number.isSafeInteger(action.epoch) || Number(action.epoch) < 0) throw Error('Invalid command or phase.');
  for (const key of fields[action.type]) if (typeof action[key] !== 'string' || !action[key] || String(action[key]).length > 80) throw Error(`Invalid ${key}.`);
  for (const key of ['version', 'requestId']) if (action.type === 'inspectShip' && key === 'requestId' || ['collectItem', 'purchaseItem', 'sellItem'].includes(action.type) && key === 'version') if (!Number.isSafeInteger(action[key]) || Number(action[key]) < 0) throw Error(`Invalid ${key}.`);
  for (const [type, key] of [['holdFire', 'hold'], ['setDoor', 'locked'], ['resume', 'force']]) if (action.type === type && typeof action[key] !== 'boolean') throw Error(`Invalid ${key}.`);
  for (const [type, key] of [['controlCrew', 'crewId'], ['installItem', 'replaceItemId'], ['transferCargo', 'itemId'], ['recruitCrew', 'replaceCrewId']]) if (action.type === type && action[key] !== null && (typeof action[key] !== 'string' || !action[key] || String(action[key]).length > 80)) throw Error(`Invalid ${key}.`);
  if (action.type === 'teleportCrew' && (!Array.isArray(action.crewIds) || !action.crewIds.length || action.crewIds.length > 8 || action.crewIds.some(id => typeof id !== 'string' || id.length > 80) || new Set(action.crewIds).size !== action.crewIds.length)) throw Error('Select one to eight different owned crew.');
  if (action.type === 'orderCrew' && !['move', 'repair', 'fight', 'heal', 'hold'].includes(String(action.order))) throw Error('Unknown crew order.');
  if (action.type === 'chooseHull' && (String(action.name).length > 16 || !/^#[0-9a-f]{6}$/i.test(String(action.color)))) throw Error('Use a ship name up to 16 characters and a valid paint color.');
  if (action.type === 'recruitCrew' && !['pilot', 'engineer', 'gunner', 'medic', 'fighter', 'scientist'].includes(String(action.skill))) throw Error('Unknown crew specialty.');
  if (action.type === 'recruitCrew' && action.species !== undefined && !SPECIES.some(species => species.id === action.species)) throw Error('Unknown crew species.');
  return structuredClone(action) as Action;
}
function registerEquipment(state: State, ship: Ship) {
  if (!ship.ownerCaptainId) return;
  for (const weapon of ship.weapons) {
    const definition = defs.weapons.find(item => item.id === weapon.definitionId)!;
    state.expedition.items.push({ id: weapon.itemId, definitionId: definition.id, kind: 'weapon', ownerCaptainId: ship.ownerCaptainId, carrierShipId: ship.id, location: 'installed', price: definition.price, version: 1, stockCaptainId: null });
  }
  for (const system of ship.systems.filter(system => defs.systems.some(item => item.id === system.id && item.cooldownMs > 0))) {
    const definition = defs.systems.find(item => item.id === system.id)!;
    state.expedition.items.push({ id: `${ship.id}-system-${system.id}`, definitionId: system.id, kind: 'system', ownerCaptainId: ship.ownerCaptainId, carrierShipId: ship.id, location: 'installed', price: definition.price, version: 1, stockCaptainId: null });
  }
}
function clearControl(state: State) {
  state.controlledCrew = {};
  for (const crew of state.simulation.crew) { crew.controlEpoch++; if (crew.activity === 'direct') crew.activity = 'idle'; }
}
function reconcile(state: State, events: DomainEvent[] = []) {
  for (const event of events) if (event.kind === 'ship-destroyed') for (const item of state.expedition.items) if (item.carrierShipId === event.shipId && ['cargo', 'installed', 'loot'].includes(item.location)) { item.location = 'destroyed'; item.version++; }
  const carrier = state.simulation.ships.find(ship => ship.faction === 'allied' && ship.status === 'active');
  for (const captain of state.captains) {
    if (!state.simulation.ships.some(ship => ship.id === captain.currentOwnedShipId && ship.status === 'active')) captain.currentOwnedShipId = null;
    if (!state.simulation.ships.some(ship => ship.id === captain.cargoShipId && ship.status === 'active')) captain.cargoShipId = captain.currentOwnedShipId ?? carrier?.id ?? null;
    if (!activeCaptain(state, captain)) { captain.ready = false; captain.vote = null; delete state.controlledCrew[captain.id]; }
  }
  const eligible = eligibleCaptains(state);
  if (!eligible.some(captain => captain.id === state.leaderCaptainId) && eligible.length) state.leaderCaptainId = eligible[0].id;
  if (state.phase !== 'hangar' && state.phase !== 'assignment' && !state.result && (!carrier || !state.captains.some(captain => activeCaptain(state, captain)))) end(state, 'defeat');
}
function end(state: State, result: 'victory' | 'defeat') {
  state.result = result; state.paused = true; state.message = result === 'victory' ? 'The fleet has reached the far beacon. Expedition complete!' : 'The expedition is lost. Your captains’ contributions remain in the log.'; changePhase(state, 'results');
}
function clearEncounterTargets(state: State) {
  const enemies = new Set(state.simulation.ships.filter(ship => ship.faction === 'enemy').map(ship => ship.id));
  for (const ship of state.simulation.ships) {
    for (const weapon of ship.weapons) if (weapon.order && enemies.has(weapon.order.shipId)) weapon.order = null;
    for (const system of ship.systems) if (system.targetShipId && enemies.has(system.targetShipId)) { system.targetShipId = null; system.targetRoomId = null; system.activeUntilMs = 0; }
  }
  for (const [captainId, inspection] of Object.entries(state.inspections)) if (enemies.has(inspection.shipId)) delete state.inspections[captainId];
}
function beginCombat(state: State, threat: number, objective: NonNullable<State['simulation']['objective']>['kind'], stage = 1) {
  clearEncounterTargets(state);
  state.simulation.ships = state.simulation.ships.filter(ship => ship.faction === 'allied');
  state.simulation.crew = state.simulation.crew.filter(crew => crew.ownerCaptainId !== null);
  state.simulation.projectiles = []; state.simulation.drones = [];
  const sector = defs.sectors.find(item => item.id === state.expedition.sectorIds[state.expedition.sectorIndex])!;
  const pool = defs.enemies.filter(enemy => sector.enemies.includes(enemy.id));
  const composition: typeof defs.enemies = [];
  let budget = state.captains.length * 1.3 + (state.expedition.sectorIndex * .35 + Math.floor(state.expedition.threat / 8) * .25 + threat * .2) * Math.min(1, state.captains.length / 3);
  if (state.settings.expedition === 'training') budget = Math.min(budget, state.captains.length);
  if (objective === 'finale' && stage === 2) {
    const boss = defs.enemies.find(enemy => enemy.id === sector.boss)!;
    composition.push(boss); budget = Math.max(0, budget - boss.threat);
  }
  while (composition.length < 6) {
    const candidates = [...pool, ...defs.enemies.filter(enemy => enemy.threat === 1)].filter(enemy => enemy.threat <= budget && !(enemy.ai === 'support' && (state.captains.length === 1 || composition.some(item => item.ai === 'support'))));
    if (!candidates.length) break;
    const enemy = candidates[(state.expedition.completedBeacons + composition.length) % candidates.length];
    composition.push(enemy); budget -= enemy.threat;
  }
  if (!composition.length) composition.push(defs.enemies[0]);
  for (const [index, enemy] of composition.entries()) {
    const created = createShip(defs, { id: `enemy-${state.epoch}-${index}`, hullId: enemy.hullId, ownerCaptainId: null, name: `E${index + 1} · ${enemy.name}`, color: '#ff5748', formation: index, faction: 'enemy', enemyId: enemy.id });
    if (state.settings.difficulty === 'relaxed') { created.ship.hull = Math.round(created.ship.hull * .7); created.ship.maxHull = created.ship.hull; }
    state.simulation.ships.push(created.ship); state.simulation.crew.push(...created.crew);
  }
  state.simulation.objective = { kind: objective, deadlineMs: ['survive', 'escape', 'defend'].includes(objective) ? state.simulation.timeMs + 45000 : null, stage, description: objective === 'finale' ? stage === 1 ? 'Break through the relay guard, then stop the flagship.' : 'Final relay: disable the flagship and bring the fleet home.' : objective === 'escape' ? 'Hold the fleet together until the jump solution completes.' : objective === 'defend' ? 'Keep your fleet alive while the convoy escapes.' : 'Defeat the hostile fleet. Target a weapon, then a ship and room.' };
  state.message = objective === 'finale' ? 'The relay is ahead. Coordinate targets and protect the fleet.' : 'Choose a weapon, a vessel, then a room. Pause to plan together.';
  state.paused = false; state.pausedBy = null; changePhase(state, 'combat');
}
function applyEffects(state: State, effects: EventEffect[], supplier?: Captain) {
  let combat: Extract<EventEffect, { kind: 'combat' }> | null = null;
  let store = false;
  for (const effect of effects) {
    if (state.result) break;
    switch (effect.kind) {
    case 'scrap': awardRewards(state, effect.amount * state.captains.length, 0, defs); break;
    case 'items': awardRewards(state, 0, effect.count, defs, effect.tags); break;
    case 'damage': case 'repair':
      for (const ship of state.simulation.ships.filter(ship => ship.faction === 'allied' && ship.status === 'active')) ship.hull = Math.min(ship.maxHull, Math.max(0, ship.hull + (effect.kind === 'repair' ? effect.amount : -effect.amount)));
      break;
    case 'crew-health':
      for (const crew of state.simulation.crew.filter(crew => crew.ownerCaptainId !== null && crew.status === 'alive' && (!effect.skill || crew.skill === effect.skill))) { crew.hp = Math.max(0, Math.min(crew.maxHp, crew.hp + effect.amount)); if (!crew.hp) crew.status = 'dead'; }
      break;
    case 'ammo': for (const ship of state.simulation.ships.filter(ship => ship.faction === 'allied' && ship.status === 'active')) ship.ammo = Math.max(0, ship.ammo + effect.amount); break;
    case 'hazard':
      for (const ship of state.simulation.ships.filter(ship => ship.faction === 'allied' && ship.status === 'active')) { const rooms = effect.hazard === 'oxygen' ? ship.rooms : [ship.rooms.find(room => room.system === 'engines') ?? ship.rooms[0]]; for (const room of rooms) room[effect.hazard] = Math.max(0, Math.min(effect.hazard === 'oxygen' ? 100 : 5, room[effect.hazard] + effect.amount)); }
      break;
    case 'reputation': state.expedition.reputation[effect.faction] = (state.expedition.reputation[effect.faction] ?? 0) + effect.amount; break;
    case 'timed-status': for (const ship of state.simulation.ships.filter(ship => ship.faction === 'allied' && ship.status === 'active')) for (const room of ship.rooms.filter(room => room.system === effect.system)) room.disruptedUntilMs = state.simulation.timeMs + effect.durationMs; break;
    case 'combat': combat = effect; break;
    case 'store': store = true; break;
    case 'threat': state.expedition.threat = Math.max(0, state.expedition.threat + effect.amount); break;
    case 'flag': state.expedition.flags[effect.id] = effect.value; break;
    case 'followup': state.expedition.flags[`followup:${effect.eventId}`] = true; break;
    case 'recruit': {
      const captain = supplier ?? state.captains.find(item => livingCrew(state, item.id).length < 8);
      const carrier = state.simulation.ships.find(ship => ship.id === captain?.cargoShipId && ship.status === 'active');
      if (!captain || !carrier || livingCrew(state, captain.id).length >= 8) { state.message = 'The recruit waits at the next store; your roster is full.'; break; }
      const hull = defs.hulls.find(item => item.id === carrier.hullId)!;
      const landing = hull.rooms.flatMap(room => standingPlaces(state, carrier, room.id, defs).map(place => ({ room, ...place })))[0];
      if (!landing) throw Error('No safe berth for a recruit.');
      const { room, x, y } = landing;
      const roster = livingCrew(state, captain.id);
      const count = (id: typeof SPECIES[number]['id']) => roster.filter(crew => speciesFor(crew.species).id === id).length;
      const species = [...SPECIES].sort((a, b) => count(a.id) - count(b.id))[0];
      state.simulation.crew.push({ id: `recruit-${state.simulation.nextId++}`, ownerCaptainId: captain.id, homeShipId: captain.currentOwnedShipId ?? carrier.id, currentShipId: carrier.id, name: 'New specialist', roomId: room.id, x, y, species: species.id, hp: species.maxHp, maxHp: species.maxHp, status: 'alive', skill: effect.skill, traits: [effect.skill], order: { kind: 'hold', roomId: room.id }, activity: 'idle', controlEpoch: 0 }); break;
    }
    case 'replacement': {
      if (!supplier || supplier.currentOwnedShipId || supplier.wallet < effect.cost) throw Error('This offer needs a shipless captain with enough scrap.');
      const created = createShip(defs, { id: `replacement-${state.simulation.nextId++}`, hullId: effect.hullId, ownerCaptainId: supplier.id, name: `${supplier.name} II`.slice(0, 16), color: supplier.color, formation: state.captains.indexOf(supplier), faction: 'allied' });
      supplier.wallet -= effect.cost; supplier.currentOwnedShipId = created.ship.id; supplier.cargoShipId = created.ship.id; state.simulation.ships.push(created.ship); registerEquipment(state, created.ship); break;
    }
    }
    // Resolve casualties before a later reward, rescue or encounter transition.
    reconcile(state, destroyShips(state));
  }
  if (state.result) return;
  if (combat) beginCombat(state, combat.threat, combat.objective);
  else if (store) { openStore(state, defs); changePhase(state, 'store'); }
}
function resolveChoice(state: State, choiceId: string | null) {
  const supplierId = availableChoices(state, defs).find(choice => choice.id === choiceId)?.contributors[0];
  const supplier = state.captains.find(captain => captain.id === supplierId);
  const effects = resolveEvent(state, choiceId, defs);
  applyEffects(state, effects, supplier);
}
function requireCrewsForJump(state: State) {
  if (state.simulation.ships.some(ship => ship.faction === 'allied' && ship.status === 'active' && !state.simulation.crew.some(crew => crew.currentShipId === ship.id && crew.ownerCaptainId !== null && crew.status === 'alive'))) throw Error('An allied ship is uncrewed. Transfer friendly crew aboard or have the leader explicitly abandon it before jumping.');
}
function leaveEncounter(state: State) {
  const nextFinaleStage = state.simulation.objective?.kind === 'finale' && state.simulation.objective.stage === 1;
  if (!nextFinaleStage) requireCrewsForJump(state);
  const stranded = state.captains.filter(captain => livingCrew(state, captain.id).some(crew => state.simulation.ships.find(ship => ship.id === crew.currentShipId)?.faction === 'enemy') && !captain.abandonedCrew);
  if (stranded.some(captain => captain.connected)) throw Error('A captain still has crew aboard an enemy. Extract them or acknowledge abandonment first.');
  for (const crew of state.simulation.crew) if (crew.status === 'alive' && state.simulation.ships.find(ship => ship.id === crew.currentShipId)?.faction === 'enemy') crew.status = 'captured';
  state.expedition.items = state.expedition.items.filter(item => item.location !== 'loot');
  clearEncounterTargets(state);
  state.simulation.ships = state.simulation.ships.filter(ship => ship.faction === 'allied');
  state.simulation.crew = state.simulation.crew.filter(crew => crew.ownerCaptainId !== null);
  state.simulation.objective = null; state.simulation.projectiles = []; state.simulation.drones = [];
  if (nextFinaleStage) { reconcile(state); if (!state.result) beginCombat(state, 3, 'finale', 2); return; }
  const beacon = state.expedition.beacons.find(item => item.id === state.expedition.currentBeaconId);
  if (beacon?.kind === 'exit' && state.expedition.flags[`retreated:${beacon.id}`]) {
    beacon.visited = false; state.expedition.currentBeaconId = state.expedition.beacons.find(item => item.next.includes(beacon.id) && item.visited)?.id ?? '';
    state.expedition.flags[`retreated:${beacon.id}`] = false;
  } else if (beacon?.kind === 'exit') {
    if (state.expedition.sectorIndex >= state.expedition.sectorIds.length - 1) { end(state, 'victory'); return; }
    advanceSector(state, defs);
  }
  reconcile(state); if (!state.result) { state.message = 'Choose the next beacon.'; changePhase(state, 'route'); }
}
function readyAdvance(state: State) {
  if (!eligibleCaptains(state).length || !eligibleCaptains(state).every(captain => captain.ready)) return;
  if (state.phase === 'hangar') { state.message = 'Vote for a beacon, or let the expedition leader choose.'; changePhase(state, 'route'); }
  else if (state.phase === 'assignment') { const phase = state.resumePhase ?? 'route'; state.resumePhase = null; changePhase(state, phase); state.paused = phase === 'combat'; }
  else if (state.phase === 'rewards' && state.simulation.objective && state.simulation.objective.stage !== 0 && (state.settings.expedition === 'training' || state.simulation.objective.kind === 'finale' && state.simulation.objective.stage === 1) && !state.expedition.flags[`store:${state.expedition.currentBeaconId}`]) {
    openStore(state, defs); state.message = 'The secured dock offers repairs and refits before departure. Spend scrap or continue when ready.'; changePhase(state, 'store');
  } else if (state.phase === 'rewards' || state.phase === 'store') leaveEncounter(state);
}
function commit(state: State, captain: Captain, choiceId: string, force: boolean) {
  const eligible = eligibleCaptains(state);
  if (force && captain.id !== state.leaderCaptainId) throw Error('Only the expedition leader can settle a split vote.');
  if (!force && !eligible.every(item => item.vote === choiceId)) return;
  if (state.phase === 'route') {
    requireCrewsForJump(state);
    const effects = enterBeacon(state, choiceId, defs);
    changePhase(state, 'event'); applyEffects(state, effects);
    if (state.expedition.event && !availableChoices(state, defs).length) resolveChoice(state, null);
  } else if (state.phase === 'event') resolveChoice(state, choiceId);
  else throw Error('No fleet choice is open.');
}
function apply(state: State, playerId: string, action: Action) {
  if (action.epoch !== state.epoch) throw Error('The fleet has moved on. Try the current screen.');
  if (state.result) throw Error('This expedition has ended.');
  if (action.type === 'claimCaptain') {
    if (state.phase !== 'assignment') throw Error('Captain assignment is closed.');
    if (state.captains.some(captain => captain.playerId === playerId)) throw Error('You already chose a captain.');
    const captain = state.captains.find(item => item.id === action.captainId);
    if (!captain || captain.playerId) throw Error('That captain was already selected.');
    captain.playerId = playerId; captain.connected = true; return;
  }
  const captain = captainFor(state, playerId);
  if (action.type === 'inspectShip') {
    const previous = state.inspections[captain.id];
    if (previous && action.requestId <= previous.requestId) { if (action.requestId === previous.requestId && action.shipId === previous.shipId) return; throw Error('A newer ship inspection is already selected.'); }
    if (!state.simulation.ships.some(ship => ship.id === action.shipId && ['active', 'surrendered'].includes(ship.status))) throw Error('That ship is no longer available.');
    clearControlFor(state, captain.id); state.inspections[captain.id] = { shipId: action.shipId, requestId: action.requestId }; return;
  }
  if (state.phase === 'assignment') {
    if (action.type !== 'ready' || state.captains.some(item => !item.playerId)) throw Error('Every saved captain must be assigned before resuming.');
    captain.ready = true; readyAdvance(state); return;
  }
  if (!activeCaptain(state, captain) && !(action.type === 'recruitCrew' && state.phase === 'store')) throw Error('You are spectating until an explicit rescue or recruitment restores your crew.');
  if (simulationActions.has(action.type)) {
    if (!['combat', 'event', 'route', 'store', 'rewards'].includes(state.phase)) throw Error('Crew and ship orders are unavailable here.');
    const command = action as SimulationCommand;
    if (state.paused && state.phase === 'combat' && !['controlCrew'].includes(command.type)) {
      applySimulationCommand(structuredClone(state), captain.id, command, defs);
      const key = commandKey(command);
      state.queue = state.queue.filter(entry => entry.captainId !== captain.id || commandKey(entry.command) !== key);
      if (state.queue.filter(entry => entry.captainId === captain.id).length >= 32) throw Error('Your tactical order queue is full.');
      state.queue.push({ captainId: captain.id, command }); captain.ready = false;
    } else reconcile(state, applySimulationCommand(state, captain.id, command, defs));
    return;
  }
  if (economyActions.has(action.type)) {
    if (!['store', 'rewards', 'route', 'event'].includes(state.phase)) throw Error('Refitting is available between battles.');
    applyEconomyCommand(state, captain.id, action as EconomyCommand, defs); captain.ready = false; reconcile(state); return;
  }
  switch (action.type) {
    case 'chooseHull': {
      if (state.phase !== 'hangar') throw Error('Choose a hull before departure.');
      if (!defs.hulls.some(hull => hull.id === action.hullId)) throw Error('Unknown hull.');
      state.expedition.items = state.expedition.items.filter(item => item.ownerCaptainId !== captain.id);
      state.simulation.ships = state.simulation.ships.filter(ship => ship.ownerCaptainId !== captain.id); state.simulation.crew = state.simulation.crew.filter(crew => crew.ownerCaptainId !== captain.id);
      const created = createShip(defs, { id: `ship-${captain.id}`, hullId: action.hullId, ownerCaptainId: captain.id, name: action.name.trim() || captain.name, color: action.color, formation: state.captains.indexOf(captain), faction: 'allied' });
      state.simulation.ships.push(created.ship); state.simulation.crew.push(...created.crew); registerEquipment(state, created.ship); captain.ready = false; break;
    }
    case 'retreat':
      if (state.phase !== 'combat' || captain.id !== state.leaderCaptainId) throw Error('Only the expedition leader can order a battle retreat.');
      if (state.simulation.objective?.kind === 'escape') throw Error('The fleet is already preparing to escape.');
      state.simulation.objective = { kind: 'escape', deadlineMs: state.simulation.timeMs + 20000, stage: 0, description: 'Retreat ordered. Survive 20 seconds, then extract or acknowledge stranded crew before jumping.' };
      state.message = 'Retreat preparations are underway. No victory salvage is awarded for withdrawing.'; break;
    case 'pause': if (state.phase !== 'combat') throw Error('Tactical pause is available during battle.'); if (!state.paused) { state.paused = true; state.pausedBy = captain.id; state.captains.forEach(item => { item.ready = false; }); clearControl(state); } break;
    case 'resume': {
      if (state.phase !== 'combat' || !state.paused) throw Error('The battle is not paused.');
      if (action.force && captain.id !== state.leaderCaptainId) throw Error('Only the expedition leader can continue without idle captains.');
      captain.ready = true;
      if (action.force || eligibleCaptains(state).every(item => item.ready)) {
        for (const entry of state.queue) { try { reconcile(state, applySimulationCommand(state, entry.captainId, entry.command, defs)); } catch (error) { state.message = `Queued order cancelled: ${(error as Error).message}`; } }
        state.queue = []; state.paused = false; state.pausedBy = null; state.captains.forEach(item => { item.ready = false; }); clearControl(state);
      } break;
    }
    case 'ready': if (!['hangar', 'store', 'rewards'].includes(state.phase)) throw Error('Ready is unavailable in this phase.'); captain.ready = true; readyAdvance(state); break;
    case 'vote': {
      if (!['route', 'event'].includes(state.phase)) throw Error('No vote is open.');
      const valid = state.phase === 'route' ? state.expedition.beacons.find(item => item.id === state.expedition.currentBeaconId)?.next.includes(action.choiceId) || (!state.expedition.currentBeaconId && state.expedition.beacons.some(item => item.column === 0 && item.id === action.choiceId)) : availableChoices(state, defs).some(choice => choice.id === action.choiceId && choice.available);
      if (!valid) throw Error('That choice is no longer available.'); captain.vote = action.choiceId; commit(state, captain, action.choiceId, false); break;
    }
    case 'commitChoice': commit(state, captain, action.choiceId, true); break;
    case 'contribute': {
      if (state.phase !== 'event') throw Error('No event contribution is open.');
      const choice = availableChoices(state, defs).find(item => item.id === action.choiceId);
      const definition = defs.events.find(event => event.id === state.expedition.event?.definitionId)?.choices.find(item => item.id === action.choiceId);
      if (!choice || !choice.available || choice.cost > captain.wallet || !definition || !suppliesCapability(state, captain.id, definition.requirement, defs)) throw Error('You cannot supply this option.');
      captain.contribution = action.choiceId; break;
    }
    case 'abandonShip': {
      if (!['route', 'event', 'store', 'rewards'].includes(state.phase) || captain.id !== state.leaderCaptainId) throw Error('Only the leader can abandon an uncrewed ship between battles.');
      const ship = state.simulation.ships.find(ship => ship.id === action.shipId && ship.faction === 'allied' && ship.status === 'active');
      if (!ship || state.simulation.crew.some(crew => crew.currentShipId === ship.id && crew.ownerCaptainId !== null && crew.status === 'alive')) throw Error('Only an uncrewed allied ship may be abandoned.');
      ship.status = 'abandoned'; ship.weapons.forEach(weapon => { weapon.order = null; });
      for (const crew of state.simulation.crew.filter(crew => crew.currentShipId === ship.id && crew.status === 'alive')) crew.status = 'captured';
      for (const item of state.expedition.items.filter(item => item.carrierShipId === ship.id && ['loot', 'cargo', 'installed'].includes(item.location))) { item.location = 'destroyed'; item.version++; }
      state.message = `${ship.name} was abandoned. Its physical cargo is lost.`; reconcile(state); break;
    }
    case 'abandonCrew': captain.abandonedCrew = true; state.message = `${captain.name} accepts the loss of crew left aboard enemy ships on the next jump.`; break;
    case 'continue':
      if (state.phase !== 'event') throw Error('There is no event to continue.');
      if (!state.expedition.event?.resolved) { if (availableChoices(state, defs).length) throw Error('Choose how to respond first.'); resolveChoice(state, null); }
      else if (state.expedition.items.some(item => item.location === 'loot')) changePhase(state, 'rewards');
      else { captain.ready = true; if (eligibleCaptains(state).every(item => item.ready)) leaveEncounter(state); }
      break;
    default: throw Error('Unknown command.');
  }
}
function commandKey(command: SimulationCommand) { return 'weaponId' in command ? `weapon:${command.weaponId}:${command.type}` : 'crewId' in command ? `crew:${command.crewId}` : 'systemId' in command ? `system:${command.systemId}` : command.type === 'setDoor' ? `door:${command.roomId}` : command.type === 'deployDrone' ? `drone:${command.itemId}` : command.type; }
function clearControlFor(state: State, captainId: string) { delete state.controlledCrew[captainId]; for (const crew of state.simulation.crew.filter(item => item.ownerCaptainId === captainId)) { crew.controlEpoch++; if (crew.activity === 'direct') crew.activity = 'idle'; } }
export const rules: GameRules<State, Input, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) { const value = raw as Partial<Settings> | null; return { difficulty: value?.difficulty === 'relaxed' ? 'relaxed' : 'standard', expedition: value?.expedition === 'training' ? 'training' : 'standard' }; },
  parseInput(raw) { const input = raw as Input; if (!input || !(input.crewId === null || typeof input.crewId === 'string' && input.crewId.length < 81) || !Number.isSafeInteger(input.controlEpoch) || !Number.isFinite(input.x) || !Number.isFinite(input.y) || Math.abs(input.x) > 1 || Math.abs(input.y) > 1 || !['none', 'repair', 'fight', 'heal'].includes(input.action)) throw Error('Invalid crew input.'); return { crewId: input.crewId, controlEpoch: input.controlEpoch, x: input.x, y: input.y, action: input.action }; },
  parseAction,
  create(ctx, settings) {
    const captains: Captain[] = ctx.players.map((player, index) => ({ id: `captain-${index + 1}`, playerId: player.id, name: player.name, color: player.color, currentOwnedShipId: `ship-captain-${index + 1}`, connected: true, wallet: 100, cargoShipId: `ship-captain-${index + 1}`, ready: false, vote: null, contribution: null, stats: { damage: 0, repairs: 0, kills: 0, collected: 0 }, abandonedCrew: false }));
    const state: State = { schemaVersion: SCHEMA_VERSION, contentVersion: CONTENT_VERSION, expeditionId: ctx.roundId, seed: ctx.seed, settings, phase: 'hangar', resumePhase: null, epoch: 1, captains, leaderCaptainId: captains[0].id, simulation: { timeMs: 0, rng: ctx.seed >>> 0 || 1, nextId: 1, ships: [], crew: [], projectiles: [], drones: [], effects: [], objective: null }, expedition: createExpedition(ctx.seed, settings, captains.length, defs), paused: false, pausedBy: null, queue: [], inspections: {}, controlledCrew: {}, result: null, message: 'Choose a ship, then mark ready to launch together.', revision: 1 };
    for (const [index, captain] of captains.entries()) { const created = createShip(defs, { id: captain.currentOwnedShipId!, hullId: defs.hulls[0].id, ownerCaptainId: captain.id, name: captain.name, color: captain.color, formation: index, faction: 'allied' }); state.simulation.ships.push(created.ship); state.simulation.crew.push(...created.crew); registerEquipment(state, created.ship); }
    reconcile(state);
    return state;
  },
  neutralInput: () => ({ crewId: null, controlEpoch: 0, x: 0, y: 0, action: 'none' }),
  applyAction(state, playerId, action) { const candidate = structuredClone(state); apply(candidate, playerId, action); candidate.revision++; assertSerializable(candidate); Object.assign(state, candidate); },
  tick(state, inputs, dtSeconds) {
    if (state.result || state.paused || ['assignment', 'hangar'].includes(state.phase)) return;
    const events = tickSimulation(state, inputs, dtSeconds * 1000, defs); reconcile(state, events);
    if (state.result) return;
    const finished = events.find(event => event.kind === 'combat-complete');
    if (finished?.kind === 'combat-complete' && state.phase === 'combat') {
      if (finished.result === 'defeat') end(state, 'defeat');
      else {
        if (state.simulation.objective?.kind === 'finale' && state.simulation.objective.stage === 1) { state.message = 'The relay guard is broken. Extract your crew and regroup before the flagship arrives.'; changePhase(state, 'rewards'); return; }
        if (state.simulation.objective?.stage !== 0) awardRewards(state, (40 + state.expedition.sectorIndex * 15) * state.captains.length, state.captains.length, defs);
        if (state.simulation.objective?.stage === 0) state.expedition.flags[`retreated:${state.expedition.currentBeaconId}`] = true;
        state.message = state.simulation.objective?.stage === 0 ? 'The fleet can withdraw. Extract your crew from hostile vessels before jumping.' : 'Battle complete. Collect equipment, repair, and regroup before jumping.'; changePhase(state, 'rewards');
      }
    }
    state.revision++;
  },
  onPresenceChange(state, playerId, connected) { const captain = state.captains.find(item => item.playerId === playerId); if (!captain || captain.connected === connected) return; captain.connected = connected; clearControlFor(state, captain.id); if (!connected && state.phase === 'combat' && activeCaptain(state, captain)) { state.paused = true; state.pausedBy = captain.id; state.captains.forEach(item => { item.ready = false; }); clearControl(state); state.message = `${captain.name} disconnected. The leader can explicitly continue when the fleet is ready.`; } reconcile(state); },
  publicView: state => projectPublic(state, defs), playerView: (state, playerId) => projectPrivate(state, playerId, defs),
  exportSave: state => exportSave(state), loadSave: (ctx, raw, settings) => loadSave(ctx, raw, settings, defs),
  finish(state) { if (!state.result) { state.result = 'suspended'; state.paused = true; clearControl(state); state.message = 'Expedition paused. Resume this session or download a save to continue later.'; } },
  outcome(state) { return { complete: state.result !== null, winners: state.result === 'victory' ? state.captains.flatMap(captain => captain.playerId ? [captain.playerId] : []) : [], rows: state.captains.flatMap(captain => captain.playerId ? [{ playerId: captain.playerId, score: Math.round(captain.stats.damage + captain.stats.repairs), label: `${Math.round(captain.stats.damage)} damage · ${Math.round(captain.stats.repairs)} repairs · ${livingCrew(state, captain.id).length} survivors` }] : []) }; },
  dispose(state) { clearControl(state); },
};
export default rules;
