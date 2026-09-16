import assert from 'node:assert/strict';
import test from 'node:test';
import type { State } from '../src/contracts';
import { definitions as defs } from '../src/definitions/server';
import { createShip } from '../src/simulation';
import { applyEconomyCommand, availableChoices, awardRewards, createExpedition, enterBeacon, openStore, resolveEvent, suppliesCapability } from '../src/expedition';

function fixture(count = 4): State {
  const captains: State['captains'] = Array.from({ length: count }, (_, i) => ({ id: `c${i}`, playerId: `p${i}`, name: `Captain ${i}`, color: '#abc', currentOwnedShipId: `s${i}`, connected: true, wallet: 100, cargoShipId: `s${i}`, ready: false, vote: null, contribution: null, stats: { damage: 0, repairs: 0, kills: 0, collected: 0 }, abandonedCrew: false }));
  const fleet = captains.map(actor => createShip(defs, { id: actor.currentOwnedShipId!, hullId: 'wayfarer', ownerCaptainId: actor.id, name: actor.name, color: actor.color, formation: Number(actor.id.slice(1)), faction: 'allied' }));
  return { schemaVersion: 1, contentVersion: 1, expeditionId: 'test', seed: 7, settings: { difficulty: 'standard', expedition: 'standard' }, phase: 'rewards', resumePhase: null, epoch: 0, captains, leaderCaptainId: 'c0', simulation: { timeMs: 0, rng: 13, nextId: 1, ships: fleet.map(({ ship }) => ship), crew: fleet.flatMap(({ crew }) => crew), projectiles: [], drones: [], effects: [], objective: null }, expedition: createExpedition(7, { difficulty: 'standard', expedition: 'standard' }, count, defs), paused: false, pausedBy: null, queue: [], inspections: {}, controlledCrew: {}, result: null, message: '', revision: 0 };
}
test('fixed-roster scrap split carries integer remainder and preserves disconnected shares', () => {
  const state = fixture();
  state.captains[1]!.connected = false;
  awardRewards(state, 7, 0, defs);
  assert.deepEqual(state.captains.map(actor => actor.wallet), [101, 101, 101, 101]);
  assert.equal(state.expedition.rewardRemainder, 3);
  awardRewards(state, 1, 0, defs);
  assert.deepEqual(state.captains.map(actor => actor.wallet), [102, 102, 102, 102]);
  assert.equal(state.expedition.rewardRemainder, 0);
});
test('salvage augments add a documented integer bonus before the equal split', () => {
  const state = fixture();
  state.simulation.ships[0]!.augments = ['augment-scrap-1'];
  awardRewards(state, 101, 0, defs);
  assert.equal(state.captains.reduce((sum, actor) => sum + actor.wallet - 100, 0) + state.expedition.rewardRemainder, 104);
  assert.ok(state.captains.every(actor => Number.isInteger(actor.wallet)));
});
test('one captain can collect an entire pile; contested duplicate cannot create ownership twice', () => {
  const state = fixture();
  awardRewards(state, 0, 20, defs);
  const first = state.expedition.items[0]!;
  const version = first.version;
  for (const item of state.expedition.items) applyEconomyCommand(state, 'c0', { type: 'collectItem', itemId: item.id, version: item.version }, defs);
  const before = structuredClone(state);
  assert.throws(() => applyEconomyCommand(state, 'c1', { type: 'collectItem', itemId: first.id, version }, defs), /Collected by Captain 0/);
  assert.deepEqual(state, before);
  assert.equal(state.expedition.items.filter(item => item.ownerCaptainId === 'c0').length, 20);
});
test('shipless survivor receives cargo on a living ally without surrendering ownership', () => {
  const state = fixture();
  state.simulation.crew[0]!.currentShipId = 's1';
  state.simulation.ships[0]!.status = 'destroyed';
  state.captains[0]!.currentOwnedShipId = null;
  awardRewards(state, 0, 1, defs);
  const item = state.expedition.items[0]!;
  applyEconomyCommand(state, 'c0', { type: 'collectItem', itemId: item.id, version: item.version }, defs);
  assert.equal(item.carrierShipId, 's1');
  assert.equal(item.ownerCaptainId, 'c0');
  assert.throws(() => applyEconomyCommand(state, 'c1', { type: 'transferCargo', itemId: item.id, shipId: 's2' }, defs), /your own/);
});
test('store stock persists and purchase validation is atomic', () => {
  const state = fixture(); state.phase = 'store';
  openStore(state, defs);
  const stock = structuredClone(state.expedition);
  openStore(state, defs);
  assert.deepEqual(state.expedition, stock);
  const item = state.expedition.items.find(item => item.stockCaptainId === 'c0')!;
  state.captains[0]!.wallet = 0;
  const before = structuredClone(state);
  assert.throws(() => applyEconomyCommand(state, 'c0', { type: 'purchaseItem', itemId: item.id, version: item.version }, defs), /scrap/);
  assert.deepEqual(state, before);
  assert.throws(() => applyEconomyCommand(state, 'c1', { type: 'purchaseItem', itemId: item.id, version: item.version }, defs), /available/);
});
test('tagged loot honors the authored equipment family', () => {
  const state = fixture(); awardRewards(state, 0, 12, defs, ['missile']);
  assert.ok(state.expedition.items.every(item => item.definitionId.startsWith('missile-')));
  const before = structuredClone(state);
  assert.throws(() => awardRewards(state, 20, 1, defs, ['nonexistent']), /matches/);
  assert.deepEqual(state, before);
});
test('event generation stays on its independent seed and resolves only once', () => {
  const state = fixture(); const second = fixture(); second.simulation.rng = 98989;
  const beacon = state.expedition.beacons[0]!;
  enterBeacon(state, beacon.id, defs); enterBeacon(second, beacon.id, defs);
  assert.deepEqual(state.expedition, second.expedition);
  const event = defs.events.find(event => event.id === state.expedition.event!.definitionId)!;
  const choice = event.choices.find(choice => choice.cost === 0 && !choice.requirement);
  resolveEvent(state, choice?.id ?? null, defs);
  const resolved = structuredClone(state.expedition);
  assert.deepEqual(resolveEvent(state, choice?.id ?? null, defs), []);
  assert.deepEqual(state.expedition, resolved);
  assert.throws(() => enterBeacon(state, beacon.id, defs), /unvisited/);
});
test('special capability requires owner consent and is rechecked after damage', () => {
  const state = fixture(); const event = defs.events.find(event => event.id === 'glasswake')!;
  state.expedition.event = { id: 'test-event', definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
  assert.equal(availableChoices(state, defs).find(choice => choice.id === 'scan')!.available, true);
  assert.throws(() => resolveEvent(state, 'scan', defs), /contribute/);
  state.captains[0]!.contribution = 'scan';
  state.simulation.ships[0]!.rooms.find(room => room.system === 'scanner')!.damage = 10;
  assert.throws(() => resolveEvent(state, 'scan', defs), /contribute/);
  state.simulation.ships[0]!.rooms.find(room => room.system === 'scanner')!.damage = 0;
  assert.deepEqual(resolveEvent(state, 'scan', defs), [{ kind: 'items', count: 2 }]);
});
test('recruit replacement cannot dismiss a guest or exceed eight owned crew', () => {
  const state = fixture(); state.phase = 'store';
  const guest = state.simulation.crew.find(crew => crew.ownerCaptainId === 'c1')!;
  guest.currentShipId = 's0';
  assert.throws(() => applyEconomyCommand(state, 'c0', { type: 'recruitCrew', replaceCrewId: guest.id, skill: 'medic' }, defs), /your own/);
  assert.equal(guest.status, 'alive');
});
test('fixed ammunition barter requires every surviving allied ship to afford it at commit', () => {
  const state = fixture();
  const event = defs.events.find(event => event.id === 'secondhand-air')!;
  state.expedition.event = { id: event.id, definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
  state.captains.forEach(actor => { actor.wallet = 0; });
  const barter = () => availableChoices(state, defs).find(choice => choice.id === 'barter')!;
  assert.equal(barter().available, true);
  assert.equal(barter().special, false);
  assert.match(barter().requirement, /3 ammunition on each surviving allied ship/);
  state.simulation.ships[3]!.ammo = 2;
  const before = structuredClone(state);
  assert.equal(barter().available, false);
  assert.throws(() => resolveEvent(state, 'barter', defs), /3 ammunition/);
  assert.deepEqual(state, before);
  assert.ok(availableChoices(state, defs).some(choice => choice.available && !choice.special && choice.cost === 0));
  state.simulation.ships[3]!.ammo = 3;
  assert.equal(resolveEvent(state, 'barter', defs)[0]!.kind, 'ammo');
});
test('random ammunition loss remains a risk rather than an upfront payment', () => {
  const state = fixture(1);
  state.simulation.ships[0]!.ammo = 0;
  const event = { ...defs.events.find(event => event.id === 'bulkhead-echo')!, effects: [{ kind: 'ammo' as const, amount: -2 }], choices: [{ id: 'risk', label: 'Risk the survey', text: 'The hazard may destroy ammunition.', requirement: null, cost: 0, effects: [], outcomes: [{ weight: 1, text: 'The hazard hits the magazine.', effects: [{ kind: 'ammo' as const, amount: -3 }] }] }] };
  const definitions = { ...defs, events: [event] };
  state.expedition.event = { id: event.id, definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: ['risk'] };
  assert.equal(availableChoices(state, definitions)[0]!.available, true);
  assert.deepEqual(resolveEvent(state, 'risk', definitions), [{ kind: 'ammo', amount: -2 }, { kind: 'ammo', amount: -3 }]);
});
test('weapon capability requires an enabled slot and operational weapon tier', () => {
  const state = fixture(1), ship = state.simulation.ships[0]!, room = ship.rooms.find(room => room.system === 'weaponry')!;
  const hasLaser = () => suppliesCapability(state, 'c0', { kind: 'weapon-family', id: 'laser' }, defs);
  assert.equal(hasLaser(), true);
  room.damage = 50; assert.equal(hasLaser(), false);
  room.damage = 0; room.disruptedUntilMs = 1; assert.equal(hasLaser(), false);
  room.disruptedUntilMs = 0;
  ship.weapons[0]!.definitionId = 'beam-thread';
  room.tier = 1; assert.equal(hasLaser(), false);
  room.tier = 2; assert.equal(hasLaser(), true);
  ship.weapons[0]!.definitionId = 'laser-suture'; ship.weapons.pop(); room.tier = 1;
  assert.equal(hasLaser(), false);
});
