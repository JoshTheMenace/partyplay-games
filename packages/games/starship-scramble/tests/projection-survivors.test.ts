import assert from 'node:assert/strict';
import test from 'node:test';
import { rules } from '../src/server';
import { definitions as defs } from '../src/definitions/server';
import { battleFixture } from './fixtures';
const context = { nowMs: 0, phase: 'playing' as const };

test('a shipless guest can inspect and command survivors without inheriting carrier controls', () => {
  const state = battleFixture(2, 1); const guest = state.simulation.crew[0], ally = state.simulation.ships[1];
  const room = defs.hulls.find(hull => hull.id === ally.hullId)!.rooms.find(room => room.system === 'shields')!;
  guest.currentShipId = ally.id; guest.roomId = room.id; guest.x = room.x + .75; guest.y = room.y + .75; guest.order = { kind: 'hold', roomId: room.id }; guest.skill = 'engineer';
  state.simulation.ships[0].hull = 0; rules.tick(state, new Map(), .1, 0);
  rules.applyAction(state, 'player-1', { type: 'inspectShip', shipId: ally.id, requestId: 1, epoch: state.epoch }, 0);
  const view = rules.playerView(state, 'player-1', context);
  assert.equal(view.captain?.status, 'shipless'); assert.equal(view.canAct, true); assert.equal(view.ownShip, null);
  assert.equal(view.inspectedShip?.ship.id, ally.id); assert.equal(view.inspectedShip?.weapons.length, 0); assert.equal(view.inspectedShip?.systems.length, 0);
  assert.equal(view.inspectedShip?.rooms.find(candidate => candidate.id === room.id)?.mannedBy, guest.id);
  assert.throws(() => rules.applyAction(state, 'player-2', { type: 'orderCrew', crewId: guest.id, roomId: room.id, order: 'hold', epoch: state.epoch }, 0), /only your own/);
  rules.applyAction(state, 'player-1', { type: 'orderCrew', crewId: guest.id, roomId: ally.rooms[0].id, order: 'move', epoch: state.epoch }, 0);
  assert.notEqual(rules.playerView(state, 'player-2', context).ownShip?.rooms.find(candidate => candidate.id === room.id)?.mannedBy, guest.id);
});

test('eliminated captain keeps identity and inventory privacy while its intact hull stays owned', () => {
  const state = battleFixture(2, 1); const originalId = state.captains[0].currentOwnedShipId;
  for (const crew of state.simulation.crew.filter(crew => crew.ownerCaptainId === 'captain-1')) crew.hp = 0;
  rules.tick(state, new Map(), .1, 0);
  const spectator = rules.playerView(state, 'player-1', context);
  assert.equal(spectator.captain?.status, 'spectator'); assert.equal(spectator.canAct, false);
  assert.equal(spectator.ownShip?.ship.id, originalId); assert.equal(spectator.ownShip?.ship.ownerCaptainId, 'captain-1');
  assert.throws(() => rules.applyAction(state, 'player-1', { type: 'pause', epoch: state.epoch }, 0), /spectating/);
  assert.ok(rules.playerView(state, 'player-2', context).inventory.every(item => item.ownerCaptainId === 'captain-2'));
});

test('surrender preserves owned crew and does not expose hidden rooms without a visitor', () => {
  const state = battleFixture(2, 1), enemy = state.simulation.ships[2]; enemy.status = 'surrendered';
  rules.applyAction(state, 'player-1', { type: 'inspectShip', shipId: enemy.id, requestId: 3, epoch: state.epoch }, 0);
  const view = rules.playerView(state, 'player-1', context);
  assert.equal(view.inspectedShip?.ship.status, 'surrendered'); assert.ok(view.inspectedShip?.rooms.every(room => !room.known));
  assert.equal(view.inspectedShip?.crew.length, 0); assert.equal(view.inspectedShip?.weapons.length, 0);
});
