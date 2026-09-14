import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { definitions as defs } from '../src/definitions/server';
import { validateSave } from '../src/save';
import { battleFixture, fixture } from './fixtures';
const context = (count: number) => ({ roomId: 'new-room', roundId: 'restored-round', seed: 19, nowMs: 500000, players: Array.from({ length: count }, (_, i) => ({ id: `new-${i}`, name: `New ${i}`, color: '#28c6e7' })) });
test('save restores in captain assignment with fresh room identities and frozen simulation', () => {
  const state = battleFixture(4, 6); state.simulation.timeMs = 123456;
  const saved = rules.exportSave!(state);
  assert.ok(new TextEncoder().encode(JSON.stringify(saved)).length < 256 * 1024);
  const { state: loaded } = rules.loadSave!(context(4), saved, state.settings);
  assert.equal(loaded.phase, 'assignment'); assert.equal(loaded.simulation.timeMs, 123456);
  assert.ok(loaded.captains.every(captain => captain.playerId === null));
  for (let i = 0; i < 4; i++) rules.applyAction(loaded, `new-${i}`, { type: 'claimCaptain', captainId: `captain-${i + 1}`, epoch: loaded.epoch }, 0);
  for (let i = 0; i < 4; i++) rules.applyAction(loaded, `new-${i}`, { type: 'ready', epoch: loaded.epoch }, 0);
  assert.equal(loaded.phase, 'combat'); assert.equal(loaded.paused, true);
  assert.equal(loaded.captains[0].playerId, 'new-0');
});
test('invalid saves fail before modifying a live state', () => {
  const state = fixture(); const before = structuredClone(state);
  const saved = rules.exportSave!(state) as typeof state;
  for (const mutate of [(s: typeof state) => { s.captains[0].wallet = -1; }, (s: typeof state) => { s.simulation.crew[0].ownerCaptainId = 'intruder'; }, (s: typeof state) => { s.simulation.ships[0].rooms[0].tier = 99; }, (s: typeof state) => { s.captains[0].currentOwnedShipId = s.captains[1].currentOwnedShipId; }]) { const bad = structuredClone(saved); mutate(bad); assert.throws(() => validateSave(bad, defs)); }
  assert.throws(() => rules.loadSave!(context(1), saved, state.settings), /4 player seats/);
  assert.deepEqual(state, before);
});
test('finish suspends campaign without pretending victory, preserving phase for resume', () => {
  const state = battleFixture(1, 1); rules.finish!(state, 0);
  assert.equal(state.result, 'suspended'); assert.deepEqual(rules.outcome(state).winners, []);
  const loaded = rules.loadSave!(context(1), rules.exportSave!(state), state.settings).state;
  assert.equal(loaded.resumePhase, 'combat'); assert.equal(loaded.result, null);
});
