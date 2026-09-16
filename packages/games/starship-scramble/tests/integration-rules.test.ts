import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { definitions as defs } from '../src/definitions/server';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { battleFixture, fixture } from './fixtures';
import type { State } from '../src/contracts';
const action = (state: State, type: string, fields = {}, playerId = 'player-1') => rules.applyAction(state, playerId, rules.parseAction({ type, epoch: state.epoch, ...fields }), 0);
test('one to four captains traverse hangar, route, personal store and persistent event', () => {
  for (const count of [1, 2, 4]) {
    const state = fixture(count);
    for (let i = 1; i <= count; i++) action(state, 'ready', {}, `player-${i}`);
    assert.equal(state.phase, 'route');
    const beacon = state.expedition.beacons[0].id;
    for (let i = 1; i <= count; i++) action(state, 'vote', { choiceId: beacon }, `player-${i}`);
    assert.equal(state.phase, 'store');
    assert.equal(state.expedition.items.filter(item => item.location === 'store').length, count * 12);
    for (let i = 1; i <= count; i++) action(state, 'ready', {}, `player-${i}`);
    assert.equal(state.phase, 'route');
    const next = state.expedition.beacons.find(item => item.id === state.expedition.currentBeaconId)!.next[0];
    action(state, 'commitChoice', { choiceId: next });
    assert.ok(['event', 'store', 'combat'].includes(state.phase));
    assert.ok(state.expedition.event);
    const instance = structuredClone(state.expedition.event);
    assertSerializable(rules.publicView(state, { nowMs: 0, phase: 'playing' }));
    assert.equal(state.expedition.event?.id, instance?.id);
  }
});
test('rejected stale/foreign commands do not mutate any part of the expedition', () => {
  const state = battleFixture(); const before = structuredClone(state);
  assert.throws(() => rules.applyAction(state, 'player-1', { type: 'pause', epoch: -1 }, 0));
  assert.deepEqual(state, before);
  const guest = state.simulation.crew.find(crew => crew.ownerCaptainId === 'captain-2')!;
  assert.throws(() => action(state, 'orderCrew', { crewId: guest.id, roomId: guest.roomId, order: 'move' }));
  assert.deepEqual(state, before);
});
test('pause freezes all simulation time; queued target validates and applies at explicit quorum', () => {
  const state = battleFixture(2, 1);
  action(state, 'pause'); const time = state.simulation.timeMs;
  const ship = state.simulation.ships[0], enemy = state.simulation.ships.find(ship => ship.faction === 'enemy')!;
  action(state, 'targetWeapon', { weaponId: ship.weapons[0].itemId, targetShipId: enemy.id, roomId: enemy.rooms[0].id });
  assert.equal(state.queue.length, 1);
  rules.tick(state, new Map(), 200, 200000); assert.equal(state.simulation.timeMs, time);
  action(state, 'resume', { force: false }); assert.equal(state.paused, true);
  action(state, 'resume', { force: false }, 'player-2'); assert.equal(state.paused, false);
  assert.equal(state.simulation.ships[0].weapons[0].order?.shipId, enemy.id);
});
test('a same-step fleet loss precedes rewards and spectators do not hold quorum', () => {
  const state = battleFixture(2, 1);
  for (const ship of state.simulation.ships) ship.hull = 0;
  rules.tick(state, new Map(), .033, 33);
  assert.equal(state.result, 'defeat'); assert.equal(state.expedition.items.filter(item => item.location === 'loot').length, 0);
  assert.equal(rules.outcome(state).complete, true);
});
test('all action variants reject malformed fields before mutation', () => {
  for (const raw of [{ type: 'teleportCrew', epoch: 1, crewIds: ['a', 'a'] }, { type: 'resume', epoch: 1 }, { type: 'collectItem', epoch: 1, itemId: 'a', version: -1 }, { type: '__proto__', epoch: 1 }]) assert.throws(() => rules.parseAction(raw));
  assert.equal(defs.hulls.length, 8);
});
