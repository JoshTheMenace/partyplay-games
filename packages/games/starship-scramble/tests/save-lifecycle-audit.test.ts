import assert from 'node:assert/strict';
import test from 'node:test';
import { rules } from '../src/server';
import { definitions as defs } from '../src/definitions/server';
import { validateSave } from '../src/save';
import { battleFixture, fixture } from './fixtures';
import type { Action, State } from '../src/contracts';

const act = (state: State, type: Action['type'], fields = {}, playerId = 'player-1') => rules.applyAction(state, playerId, rules.parseAction({ type, epoch: state.epoch, ...fields }), 0);
const context = (count: number) => ({ roomId: 'audit-room', roundId: 'audit-round', nowMs: 900000, seed: 71, players: Array.from({ length: count }, (_, index) => ({ id: `restored-${index}`, name: `Restored ${index}`, color: '#28c6e7' })) });
const saved = (state: State) => validateSave(rules.exportSave!(state), defs);
function readyThroughDock(state: State, players: string[]) {
  for (const playerId of players) act(state, 'ready', {}, playerId);
  if (state.phase === 'store') for (const playerId of players) act(state, 'ready', {}, playerId);
}
function placeCrew(state: State, crewId: string, shipId: string) {
  const crew = state.simulation.crew.find(item => item.id === crewId)!, ship = state.simulation.ships.find(item => item.id === shipId)!;
  const room = defs.hulls.find(hull => hull.id === ship.hullId)!.rooms[5];
  Object.assign(crew, { currentShipId: ship.id, roomId: room.id, x: room.x + .75, y: room.y + .75, order: { kind: 'hold', roomId: room.id }, activity: 'idle' });
}
function installEvent(state: State, id: string) {
  const event = defs.events.find(item => item.id === id)!; assert(event, id);
  state.phase = 'event';
  state.expedition.event = { id: `audit:${id}`, definitionId: id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
}

for (const [name, mutate] of [
  ['cargo without a personal owner', (state: State) => { state.expedition.items.push({ ...state.expedition.items[0], id: 'ownerless-cargo', ownerCaptainId: null, location: 'cargo' }); }],
  ['encounter loot already assigned to a captain', (state: State) => { state.expedition.items.push({ ...state.expedition.items[0], id: 'owned-loot', location: 'loot' }); }],
  ['owned cargo without a physical carrier', (state: State) => { const original = state.expedition.items[0]; state.expedition.items.push({ ...original, id: 'orphan-cargo', location: 'cargo', carrierShipId: null }); }],
  ['two physical system items occupying one installation', (state: State) => { const original = state.expedition.items.find(item => item.kind === 'system' && item.location === 'installed')!; assert(original); state.expedition.items.push({ ...original, id: 'duplicate-installed-system' }); }],
  ['installed system with only half a target pair', (state: State) => { const system = state.simulation.ships[0].systems.find(item => item.id === 'scanner')!; system.targetShipId = state.simulation.ships[1].id; system.targetRoomId = null; }],
  ['installed system with a nonexistent target room', (state: State) => { const system = state.simulation.ships[0].systems.find(item => item.id === 'scanner')!; system.targetShipId = state.simulation.ships[1].id; system.targetRoomId = 'missing-room'; system.activeUntilMs = 1000; }],
] as const) test(`malformed save rejects ${name} before loading`, () => {
  const live = battleFixture(1, 1), before = structuredClone(live), raw = rules.exportSave!(live) as State;
  mutate(raw);
  assert.throws(() => rules.loadSave!(context(1), raw, live.settings));
  assert.deepEqual(live, before);
});

for (const status of ['dead', 'captured'] as const) test(`a nonterminal save with only ${status} owned crew cannot enter assignment`, () => {
  const state = battleFixture(1, 1), raw = rules.exportSave!(state) as State;
  for (const crew of raw.simulation.crew.filter(crew => crew.ownerCaptainId !== null)) { crew.status = status; if (status === 'dead') crew.hp = 0; }
  assert.throws(() => rules.loadSave!(context(1), raw, state.settings), /captain with living crew/);
  raw.result = 'suspended';
  assert.throws(() => rules.loadSave!(context(1), raw, state.settings), /captain with living crew/);
});

test('terminal defeat remains exportable and valid even without survivors, but cannot resume', () => {
  const state = battleFixture(1, 1);
  for (const crew of state.simulation.crew.filter(crew => crew.ownerCaptainId !== null)) crew.hp = 0;
  rules.tick(state, new Map(), .01, 0);
  assert.equal(state.result, 'defeat');
  const raw = saved(state);
  assert.equal(raw.result, 'defeat');
  assert.throws(() => rules.loadSave!(context(1), raw, state.settings), /has ended/);
});

test('combat save retains accepted orders and projectiles while clearing tactical drafts and held control', () => {
  const state = battleFixture(2, 1), shipId = state.simulation.ships[0].id, enemyId = state.simulation.ships[2].id;
  const weaponId = state.simulation.ships[0].weapons[0].itemId, firstRoom = state.simulation.ships[2].rooms[0].id, laterRoom = state.simulation.ships[2].rooms[1].id;
  act(state, 'targetWeapon', { weaponId, targetShipId: enemyId, roomId: firstRoom });
  for (let tick = 0; tick < 200 && !state.simulation.projectiles.length; tick++) rules.tick(state, new Map(), .05, tick * 50);
  assert(state.simulation.projectiles.length > 0);
  act(state, 'pause');
  act(state, 'targetWeapon', { weaponId, targetShipId: enemyId, roomId: laterRoom });
  const crewId = state.simulation.crew[0].id;
  act(state, 'controlCrew', { crewId });
  state.inspections[state.captains[0].id] = { shipId: enemyId, requestId: 5 };
  const before = structuredClone(state), raw = saved(state);
  assert.deepEqual(state, before, 'Export must not clear the live tactical draft.');
  assert.deepEqual(raw.queue, []); assert.deepEqual(raw.controlledCrew, {}); assert.deepEqual(raw.inspections, {});
  const restored = rules.loadSave!(context(2), raw, state.settings).state;
  assert.deepEqual(restored.simulation.projectiles, raw.simulation.projectiles);
  assert.equal(restored.simulation.ships.find(ship => ship.id === shipId)!.weapons[0].order?.roomId, firstRoom);
  assert.equal(restored.phase, 'assignment'); assert.equal(restored.resumePhase, 'combat'); assert.equal(restored.paused, true);
  assert(restored.simulation.crew.find(crew => crew.id === crewId)!.controlEpoch > before.simulation.crew.find(crew => crew.id === crewId)!.controlEpoch);
  const frozen = restored.simulation.timeMs; rules.tick(restored, new Map(), 10, 10000); assert.equal(restored.simulation.timeMs, frozen);
  assert.doesNotThrow(() => saved(restored));
});

test('unresolved and resolved event saves preserve the instance and cannot reroll or duplicate its reward', () => {
  const state = fixture(1); installEvent(state, 'silent-orchard');
  const unready = rules.loadSave!(context(1), saved(state), state.settings).state;
  assert.equal(unready.expedition.event!.resolved, false); assert.equal(unready.expedition.event!.id, 'audit:silent-orchard');
  act(state, 'continue');
  const earned = state.captains[0].wallet, itemIds = state.expedition.items.map(item => item.id);
  const restored = rules.loadSave!(context(1), saved(state), state.settings).state;
  act(restored, 'claimCaptain', { captainId: restored.captains[0].id }, 'restored-0'); act(restored, 'ready', {}, 'restored-0');
  assert.equal(restored.phase, 'event'); assert.equal(restored.expedition.event!.resolved, true);
  act(restored, 'continue', {}, 'restored-0');
  assert.equal(restored.captains[0].wallet, earned); assert.deepEqual(restored.expedition.items.map(item => item.id), itemIds);
  assert.doesNotThrow(() => saved(restored));
});

test('multiple replacement hulls retain original survivor ownership and historical destroyed ships', () => {
  const state = battleFixture(2, 1), actorId = state.captains[0].id, originalHull = state.captains[0].currentOwnedShipId!, allyId = state.captains[1].currentOwnedShipId!;
  const survivorId = state.simulation.crew.find(crew => crew.ownerCaptainId === actorId)!.id;
  placeCrew(state, survivorId, allyId); state.captains[0].wallet = 1000;
  const records = [originalHull];
  for (let cycle = 0; cycle < 2; cycle++) {
    state.simulation.ships.find(ship => ship.id === state.captains[0].currentOwnedShipId)!.hull = 0;
    rules.tick(state, new Map(), .01, 0);
    assert.equal(state.captains[0].currentOwnedShipId, null);
    installEvent(state, 'captain-without-hull');
    act(state, 'contribute', { choiceId: 'purchase' }); act(state, 'commitChoice', { choiceId: 'purchase' });
    records.push(state.captains[0].currentOwnedShipId!); assert.equal(new Set(records).size, records.length);
    assert.doesNotThrow(() => saved(state));
  }
  const restored = rules.loadSave!(context(2), saved(state), state.settings).state;
  assert(records.every(id => restored.simulation.ships.some(ship => ship.id === id)));
  const survivor = restored.simulation.crew.find(crew => crew.id === survivorId)!;
  assert.equal(survivor.ownerCaptainId, actorId); assert.equal(survivor.homeShipId, originalHull); assert.equal(survivor.currentShipId, allyId);
  assert.equal(restored.captains[0].currentOwnedShipId, records.at(-1));
  assert.equal(restored.simulation.ships.filter(ship => ship.ownerCaptainId === actorId && ship.status === 'destroyed').length, 2);
});

test('captured historical crew references survive a completed encounter without phantom ownership', () => {
  const state = battleFixture(2, 1), enemyId = state.simulation.ships[2].id, actorId = state.captains[0].id;
  const guestId = state.simulation.crew.find(crew => crew.ownerCaptainId === actorId)!.id;
  placeCrew(state, guestId, enemyId); state.phase = 'rewards'; act(state, 'abandonCrew');
  act(state, 'ready'); act(state, 'ready', {}, 'player-2');
  assert.equal(state.phase, 'store'); act(state, 'abandonCrew');
  readyThroughDock(state, ['player-1', 'player-2']);
  assert.equal(state.phase, 'route'); assert(!state.simulation.ships.some(ship => ship.id === enemyId));
  const historical = saved(state).simulation.crew.find(crew => crew.id === guestId)!;
  assert.equal(historical.status, 'captured'); assert.equal(historical.currentShipId, enemyId); assert.equal(historical.ownerCaptainId, actorId);
  assert.doesNotThrow(() => rules.loadSave!(context(2), saved(state), state.settings));
});

test('inspection requests cannot replace a newer selected ship with an older response context', () => {
  const state = battleFixture(2, 2), latest = state.simulation.ships[3].id, stale = state.simulation.ships[2].id;
  act(state, 'inspectShip', { shipId: latest, requestId: 12 }); const before = structuredClone(state);
  assert.throws(() => act(state, 'inspectShip', { shipId: stale, requestId: 11 }), /newer|inspection/); assert.deepEqual(state, before);
  const view = rules.playerView(state, 'player-1', { nowMs: 0, phase: 'playing' });
  assert.equal(view.inspectedShipId, latest); assert.equal(view.viewRequestId, 12);
});

test('paused door edits retain the latest order for each different room', () => {
  const state = battleFixture(1, 1), [first, second] = state.simulation.ships[0].rooms.map(room => room.id);
  act(state, 'pause'); act(state, 'setDoor', { roomId: first, locked: true }); act(state, 'setDoor', { roomId: second, locked: true });
  act(state, 'resume', { force: false });
  assert.equal(state.simulation.ships[0].rooms.find(room => room.id === first)!.locked, true);
  assert.equal(state.simulation.ships[0].rooms.find(room => room.id === second)!.locked, true);
});

test('reconnect invalidates old held input while preserving captain ownership and standing targets', () => {
  const state = battleFixture(2, 1), actorId = state.captains[0].id, crewId = state.simulation.crew[0].id, enemyId = state.simulation.ships[2].id;
  act(state, 'targetWeapon', { weaponId: state.simulation.ships[0].weapons[0].itemId, targetShipId: enemyId, roomId: state.simulation.ships[2].rooms[0].id });
  act(state, 'controlCrew', { crewId });
  const oldEpoch = state.simulation.crew.find(crew => crew.id === crewId)!.controlEpoch;
  rules.onPresenceChange(state, 'player-1', false, 0); rules.onPresenceChange(state, 'player-1', true, 0);
  assert.equal(state.captains[0].id, actorId); assert.equal(state.captains[0].connected, true); assert.equal(state.paused, true);
  assert.equal(state.controlledCrew[actorId], undefined); assert.equal(state.simulation.ships[0].weapons[0].order?.shipId, enemyId);
  act(state, 'resume', { force: true }, state.captains.find(captain => captain.id === state.leaderCaptainId)!.playerId!); const before = structuredClone(state.simulation.crew.find(crew => crew.id === crewId)!);
  rules.tick(state, new Map([['player-1', { crewId, controlEpoch: oldEpoch, x: 1, y: 0, action: 'none' as const }]]), .01, 0);
  const after = state.simulation.crew.find(crew => crew.id === crewId)!;
  assert(after.controlEpoch > oldEpoch); assert.equal(after.x, before.x); assert.equal(after.y, before.y);
  assert.doesNotThrow(() => saved(state));
});

function emptyHullFixture() {
  const state = battleFixture(2, 1);
  for (const crew of state.simulation.crew.filter(crew => crew.ownerCaptainId === state.captains[0].id)) crew.hp = 0;
  rules.tick(state, new Map(), .01, 0); state.phase = 'rewards'; return state;
}
test('an uncrewed intact allied ship cannot silently depart with the fleet', () => {
  const state = emptyHullFixture(); act(state, 'ready', {}, 'player-2'); assert.equal(state.phase, 'store');
  const before = structuredClone(state);
  assert.throws(() => act(state, 'ready', {}, 'player-2'), /crew|empty|uncrewed/i);
  assert.deepEqual(state, before);
});
test('friendly guest crew can operate an intact eliminated captains ship without taking ownership', () => {
  const state = emptyHullFixture(), emptyHull = state.captains[0].currentOwnedShipId!;
  const guestId = state.simulation.crew.find(crew => crew.ownerCaptainId === state.captains[1].id)!.id;
  placeCrew(state, guestId, emptyHull); readyThroughDock(state, ['player-2']);
  assert.equal(state.phase, 'route'); assert.equal(state.simulation.ships.find(ship => ship.id === emptyHull)!.ownerCaptainId, state.captains[0].id);
  assert.equal(rules.playerView(state, 'player-1', { nowMs: 0, phase: 'playing' }).captain?.status, 'spectator');
  assert.doesNotThrow(() => saved(state));
});

test('explicit leader abandonment preserves identity, loses physical cargo, and permits departure and save', () => {
  const state = emptyHullFixture(), ownerId = state.captains[0].id, shipId = state.captains[0].currentOwnedShipId!, wallet = state.captains[0].wallet;
  const physicalIds = state.expedition.items.filter(item => item.carrierShipId === shipId).map(item => item.id);
  assert(physicalIds.length > 0);
  assert.throws(() => act(state, 'abandonShip', { shipId }, 'player-1'), /spectating|leader/);
  act(state, 'abandonShip', { shipId }, 'player-2');
  const abandoned = state.simulation.ships.find(ship => ship.id === shipId)!;
  assert.equal(abandoned.status, 'abandoned'); assert.equal(abandoned.ownerCaptainId, ownerId);
  assert.equal(state.captains[0].id, ownerId); assert.equal(state.captains[0].wallet, wallet); assert.equal(state.captains[0].currentOwnedShipId, null);
  assert(state.expedition.items.filter(item => physicalIds.includes(item.id)).every(item => item.location === 'destroyed' && item.ownerCaptainId === ownerId));
  assert(state.simulation.crew.filter(crew => crew.ownerCaptainId === ownerId).every(crew => crew.status === 'dead' && crew.homeShipId === shipId));
  readyThroughDock(state, ['player-2']); assert.equal(state.phase, 'route');
  const restored = rules.loadSave!(context(2), saved(state), state.settings).state;
  assert.equal(restored.captains[0].wallet, wallet); assert.equal(restored.simulation.ships.find(ship => ship.id === shipId)!.status, 'abandoned');
  assert(restored.expedition.items.filter(item => physicalIds.includes(item.id)).every(item => item.location === 'destroyed'));
});

test('saved shipless and eliminated captains rebind separately without transferring guests or personal cargo', () => {
  const state = battleFixture(3, 1), home = state.captains[0].currentOwnedShipId!, ally = state.captains[1].currentOwnedShipId!;
  const survivorId = state.simulation.crew.find(crew => crew.ownerCaptainId === state.captains[0].id)!.id;
  placeCrew(state, survivorId, ally); state.simulation.ships.find(ship => ship.id === home)!.hull = 0;
  for (const crew of state.simulation.crew.filter(crew => crew.ownerCaptainId === state.captains[2].id)) crew.hp = 0;
  rules.tick(state, new Map(), .01, 0);
  // A physical claimed item belonging to the shipless captain is carried on its ally.
  const original = state.expedition.items.find(item => item.ownerCaptainId === state.captains[1].id)!;
  state.expedition.items.push({ ...original, id: 'survivor-owned-cargo', ownerCaptainId: state.captains[0].id, carrierShipId: ally, location: 'cargo' });
  const restored = rules.loadSave!(context(3), saved(state), state.settings).state;
  for (let i = 0; i < 3; i++) act(restored, 'claimCaptain', { captainId: restored.captains[i].id }, `restored-${i}`);
  act(restored, 'ready', {}, 'restored-0'); act(restored, 'ready', {}, 'restored-1');
  assert.equal(restored.phase, 'combat'); assert.equal(restored.paused, true);
  const view = (playerId: string) => rules.playerView(restored, playerId, { nowMs: 0, phase: 'playing' });
  assert.equal(view('restored-0').captain?.status, 'shipless'); assert.equal(view('restored-0').canAct, true);
  assert.equal(view('restored-2').captain?.status, 'spectator'); assert.equal(view('restored-2').canAct, false);
  assert.equal(view('restored-0').crew.find(crew => crew.id === survivorId)?.homeShipId, home);
  assert.equal(view('restored-0').crew.find(crew => crew.id === survivorId)?.currentShipId, ally);
  assert.equal(view('restored-0').inventory.find(item => item.id === 'survivor-owned-cargo')?.carrierShipId, ally);
  assert(!view('restored-1').inventory.some(item => item.id === 'survivor-owned-cargo')); assert.equal(view('player-1').captain, null);
  assert.doesNotThrow(() => saved(restored));
});
