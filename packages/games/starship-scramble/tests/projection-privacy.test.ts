import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { battleFixture } from './fixtures';
test('max fleet projections serialize and never include future content or hidden defenders', () => {
  const state = battleFixture();
  const ctx = { nowMs: 0, phase: 'playing' as const };
  const publicView = rules.publicView(state, ctx); assert.equal(publicView.ships.length, 10); assertSerializable(publicView);
  const enemy = state.simulation.ships.find(ship => ship.faction === 'enemy')!;
  rules.applyAction(state, 'player-1', { type: 'inspectShip', shipId: enemy.id, requestId: 7, epoch: state.epoch }, 0);
  const privateView = rules.playerView(state, 'player-1', ctx); assertSerializable(privateView);
  assert.equal(privateView.viewRequestId, 7); assert.equal(privateView.inspectedShip?.crew.length, 0); assert.equal(privateView.inspectedShip?.weapons.length, 0);
  assert.ok(privateView.inspectedShip?.rooms.every(room => !room.known));
  for (const forbidden of ['rng', 'seenRoots', 'effectsTable', 'outcomes', 'ai']) assert.ok(!Object.hasOwn(publicView, forbidden));
});
