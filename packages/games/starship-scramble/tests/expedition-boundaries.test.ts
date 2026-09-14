import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { definitions as defs } from '../src/definitions/server';
import { awardRewards } from '../src/expedition';
import { exportSave, validateSave } from '../src/save';
import { fixture } from './fixtures';
import type { EventDefinition, State } from '../src/contracts';
const act = (state: State, type: string, fields = {}, player = 'player-1') => rules.applyAction(state, player, rules.parseAction({ type, epoch: state.epoch, ...fields }), 0);
function event(state: State, definition: EventDefinition, run: () => void) {
  defs.events.push(definition);
  state.phase = 'event';
  state.expedition.event = { id: definition.id, definitionId: definition.id, resolved: false, choiceId: null, text: definition.text, result: '', optionIds: definition.choices.map(choice => choice.id) };
  try { run(); } finally { defs.events.splice(defs.events.indexOf(definition), 1); }
}
const encounter = (fields: Partial<EventDefinition>): EventDefinition => ({ id: 'boundary-fixture', category: 'travel', title: 'Boundary fixture', text: 'Controlled encounter boundary.', tags: [], weight: 1, sectors: [], choices: [], effects: [], repeatable: false, ...fields });
test('lethal encounter damage resolves defeat before a later reward can roll it back', () => {
  const state = fixture(1), wallet = state.captains[0].wallet;
  event(state, encounter({ effects: [{ kind: 'damage', amount: 1000 }, { kind: 'items', count: 1, tags: [] }, { kind: 'scrap', amount: 50 }] }), () => {
    act(state, 'continue');
    assert.equal(state.result, 'defeat');
    assert.equal(state.simulation.ships[0].status, 'destroyed');
    assert.equal(state.captains[0].wallet, wallet);
    assert.equal(state.expedition.items.filter(item => item.location === 'loot').length, 0);
  });
});
test('a replacement uses the eligible consenting supplier rather than an earlier stale contributor', () => {
  const state = fixture(2), first = state.captains[0], second = state.captains[1];
  state.simulation.crew.filter(crew => crew.ownerCaptainId === second.id).forEach(crew => { crew.currentShipId = first.currentOwnedShipId!; crew.roomId = 'r5'; crew.order.roomId = 'r5'; });
  state.simulation.ships.find(ship => ship.id === second.currentOwnedShipId)!.hull = 0;
  state.phase = 'route'; rules.tick(state, new Map(), .033, 33);
  first.contribution = second.contribution = 'replace';
  event(state, encounter({ choices: [{ id: 'replace', label: 'Accept a hull', text: 'A new hull joins the fleet.', requirement: null, cost: 0, effects: [{ kind: 'replacement', hullId: 'wayfarer', cost: 60 }] }] }), () => {
    act(state, 'commitChoice', { choiceId: 'replace' });
    assert.equal(state.captains[0].wallet, 100); assert.equal(state.captains[1].wallet, 40);
    assert.match(state.captains[1].currentOwnedShipId!, /^replacement-/);
  });
});
test('unclaimed loot is discarded on departure while claimed items remain personal cargo', () => {
  const state = fixture(2); state.phase = 'rewards';
  awardRewards(state, 0, 2, defs);
  const [unclaimed, personal] = state.expedition.items.filter(item => item.location === 'loot');
  act(state, 'collectItem', { itemId: personal.id, version: personal.version });
  act(state, 'ready'); act(state, 'ready', {}, 'player-2');
  assert.equal(state.phase, 'route');
  assert.ok(!state.expedition.items.some(item => item.id === unclaimed.id));
  const claimed = state.expedition.items.find(item => item.id === personal.id)!;
  assert.equal(claimed.ownerCaptainId, 'captain-1');
  assert.equal(claimed.location, 'cargo');
  assert.equal(claimed.carrierShipId, 'ship-captain-1');
  validateSave(exportSave(state), defs);
});
test('a spectator can pay for explicit store recruitment without gaining unrelated actions', () => {
  const state = fixture(2); state.phase = 'store';
  for (const crew of state.simulation.crew.filter(crew => crew.ownerCaptainId === 'captain-1')) { crew.status = 'dead'; crew.hp = 0; }
  assert.throws(() => act(state, 'buyAmmo'), /spectating/);
  act(state, 'recruitCrew', { replaceCrewId: null, skill: 'pilot' });
  assert.equal(state.captains[0].wallet, 40);
  assert.equal(rules.playerView(state, 'player-1', { phase: 'playing', nowMs: 0 }).canAct, true);
  assert.equal(state.simulation.crew.filter(crew => crew.ownerCaptainId === 'captain-1' && crew.status === 'alive').length, 1);
  validateSave(exportSave(state), defs);
});

test('equipment earned before an event battle remains claimable after the ambush', () => {
  const state = fixture(1);
  event(state, encounter({ effects: [{ kind: 'items', count: 1 }, { kind: 'combat', objective: 'destroy', threat: 1 }] }), () => {
    act(state, 'continue');
    assert.equal(state.phase, 'combat');
    const loot = state.expedition.items.filter(item => item.location === 'loot');
    assert.equal(loot.length, 1);
    assert.equal(loot[0].carrierShipId, 'ship-captain-1');
    validateSave(exportSave(state), defs);
  });
});
