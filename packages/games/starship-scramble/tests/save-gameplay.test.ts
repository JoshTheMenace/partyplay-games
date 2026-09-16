import assert from 'node:assert/strict';
import test from 'node:test';
import { rules } from '../src/server';
import { validateSave } from '../src/save';
import { definitions as defs } from '../src/definitions/server';
import { battleFixture, fixture } from './fixtures';
import type { Action, State } from '../src/contracts';

const act = (state: State, type: Action['type'], fields = {}, playerId = 'player-1') => rules.applyAction(state, playerId, rules.parseAction({ type, epoch: state.epoch, ...fields }), 0);
const saved = (state: State) => validateSave(rules.exportSave!(state), defs);
function store() {
  const state = fixture(1);
  act(state, 'ready'); act(state, 'vote', { choiceId: state.expedition.beacons[0].id });
  assert.equal(state.phase, 'store'); return state;
}

test('legal room upgrade, purchase and installation remain loadable', () => {
  const upgraded = store();
  act(upgraded, 'upgradeRoom', { roomId: upgraded.simulation.ships[0].rooms.find(room => room.system === 'weaponry')!.id });
  assert.equal(saved(upgraded).simulation.ships[0].rooms.find(room => room.system === 'weaponry')!.tier, 3);
  const state = store();
  const item = state.expedition.items.find(item => item.location === 'store' && item.price <= state.captains[0].wallet && item.kind === 'augment');
  assert.ok(item, 'The fixture stock must include affordable equipment.');
  act(state, 'purchaseItem', { itemId: item.id, version: item.version });
  act(state, 'installItem', { itemId: item.id, replaceItemId: null });
  const restored = saved(state);
  assert.equal(restored.expedition.items.find(candidate => candidate.id === item.id)?.location, 'installed');
});

test('every tick of a legal multi-room crew move remains loadable', () => {
  const state = fixture(1); act(state, 'ready');
  const crewId = state.simulation.crew[0].id;
  const destination = state.simulation.ships[0].rooms.find(room => room.system === 'shields')!.id;
  act(state, 'orderCrew', { crewId, roomId: destination, order: 'move' });
  for (let tick = 0; tick < 80; tick++) {
    rules.tick(state, new Map(), .1, tick * 100);
    assert.doesNotThrow(() => saved(state), `Save rejected during movement tick ${tick}`);
  }
  assert.equal(state.simulation.crew.find(crew => crew.id === crewId)!.roomId, destination);
});

test('offset room layouts preserve legal locations while crossing decks and traversing the hull', () => {
  for (const hull of defs.hulls) {
    const state = fixture(1);
    act(state, 'chooseHull', { hullId: hull.id, name: 'Transit test', color: '#28c6e7' }); act(state, 'ready');
    const crewId = state.simulation.crew[0].id;
    for (const roomId of [hull.rooms[5].id, hull.rooms[hull.rooms.length - 1].id]) {
      act(state, 'orderCrew', { crewId, roomId, order: 'move' });
      for (let tick = 0; tick < 200 && state.simulation.crew[0].roomId !== roomId; tick++) { rules.tick(state, new Map(), .1, tick * 100); saved(state); }
      assert.equal(state.simulation.crew[0].roomId, roomId, `${hull.id} transit to ${roomId}`);
    }
  }
});

test('repairing fractional combat hull damage preserves the integer wallet save contract', () => {
  const state = store();
  // A combat-damaged snapshot is a rule fixture, not an injected campaign run.
  state.simulation.ships[0].hull -= .375;
  saved(state);
  act(state, 'repairHull');
  assert.doesNotThrow(() => saved(state));
  assert.equal(state.simulation.ships[0].hull, state.simulation.ships[0].maxHull);
});

test('saved installed equipment must still have exactly one matching owned physical item', () => {
  const state = fixture(1); const raw = rules.exportSave!(state) as State;
  raw.expedition.items = raw.expedition.items.filter(item => item.id !== raw.simulation.ships[0].weapons[0].itemId);
  assert.throws(() => validateSave(raw, defs), /equipment|item|weapon/i);
});

test('captain identity and guest location survive destruction followed by save', () => {
  const state = battleFixture(2, 1);
  // Explicit rule fixture places an already deployed survivor on an allied ship.
  const guest = state.simulation.crew[0], ally = state.simulation.ships[1];
  const room = defs.hulls.find(hull => hull.id === ally.hullId)!.rooms[5];
  guest.currentShipId = ally.id; guest.roomId = room.id; guest.x = room.x + .75; guest.y = room.y + .75; guest.order = { kind: 'hold', roomId: room.id };
  state.simulation.ships[0].hull = 0;
  rules.tick(state, new Map(), .1, 100);
  const restored = saved(state), survivor = restored.simulation.crew.find(crew => crew.id === guest.id)!;
  assert.equal(survivor.ownerCaptainId, 'captain-1'); assert.equal(survivor.homeShipId, 'ship-captain-1'); assert.equal(survivor.currentShipId, ally.id);
  assert.equal(restored.captains[0].currentOwnedShipId, null);
});

test('an in-flight projectile remains a valid save after its firing vessel explodes', () => {
  const state = battleFixture(2, 1); const ship = state.simulation.ships[0], enemy = state.simulation.ships[2];
  act(state, 'targetWeapon', { weaponId: ship.weapons[0].itemId, targetShipId: enemy.id, roomId: enemy.rooms[0].id });
  while (!state.simulation.projectiles.length && state.simulation.timeMs < 10000) rules.tick(state, new Map(), .1, 0);
  assert.ok(state.simulation.projectiles.length);
  state.simulation.ships[0].hull = 0;
  rules.tick(state, new Map(), .1, 0);
  assert.doesNotThrow(() => saved(state));
});

test('retreat and leaving the encounter clear obsolete weapon and system target references', () => {
  const state = battleFixture(2, 1), ship = state.simulation.ships[0], enemy = state.simulation.ships[2];
  act(state, 'targetWeapon', { weaponId: ship.weapons[0].itemId, targetShipId: enemy.id, roomId: enemy.rooms[0].id });
  act(state, 'activateSystem', { systemId: 'scanner', targetShipId: enemy.id, roomId: enemy.rooms[0].id });
  act(state, 'retreat');
  for (let tick = 0; tick < 100 && state.phase === 'combat'; tick++) rules.tick(state, new Map(), .25, tick * 250);
  assert.equal(state.phase, 'rewards');
  assert.equal(state.expedition.items.filter(item => item.location === 'loot').length, 0);
  act(state, 'ready'); act(state, 'ready', {}, 'player-2');
  assert.equal(state.phase, 'route');
  assert.equal(state.simulation.ships.some(ship => ship.id === enemy.id), false);
  assert.doesNotThrow(() => saved(state));
});
