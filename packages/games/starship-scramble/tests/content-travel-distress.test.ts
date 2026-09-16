import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { travelEvents } from '../src/definitions/server/events/travel';
import { distressEvents } from '../src/definitions/server/events/distress';
import { definitions } from '../src/definitions/server';
import { contentInventory, validateDefinitions } from '../src/expedition/validate';
import { availableChoices, resolveEvent } from '../src/expedition';
import { createShip } from '../src/simulation';
import { rules } from '../src/server';

const events = [...travelEvents, ...distressEvents];
const defs = { ...definitions, events };
const inventory = contentInventory(defs);

test('travel and distress deliver 106 distinct supported roots with edited prose and restrained options', () => {
  assert.equal(travelEvents.length, 58); assert.equal(distressEvents.length, 48);
  assert.equal(new Set(events.map(event => event.id)).size, 106);
  assert.deepEqual(validateDefinitions(defs), []);
  assertSerializable(events);
  assert(inventory.reduce((sum, row) => sum + row.words, 0) >= 7400);
  for (const pack of [travelEvents, distressEvents]) {
    const special = pack.filter(event => event.choices.some(choice => choice.requirement)).length / pack.length;
    const noChoice = pack.filter(event => !event.choices.length).length / pack.length;
    assert(special >= .15 && special <= .25); assert(noChoice >= .05 && noChoice <= .25);
    for (const event of pack) {
      assert(event.id.startsWith(`${event.category}-`)); assert.equal(event.category, pack === travelEvents ? 'travel' : 'distress');
      const row = inventory.find(item => item.id === event.id)!;
      assert(row.words >= 70 && row.words <= 180, `${event.id}: ${row.words} words`);
      assert(row.ordinaryChoices <= 3 && row.specialChoices <= 2, event.id);
      assert(!event.requiresFlag && !event.minReputation && !event.repeatable && !event.sectors.length, event.id);
      if (row.specialChoices) assert(event.choices.some(choice => !choice.requirement && !choice.cost && !choice.effects.some(effect => effect.kind === 'replacement' || effect.kind === 'damage' || effect.kind === 'crew-health' && effect.amount < 0 || effect.kind === 'ammo' && effect.amount < 0 || effect.kind === 'hazard' && (effect.hazard === 'oxygen' ? effect.amount < 0 : effect.amount > 0))), `${event.id}: missing ordinary safe route`);
    }
  }
  const premises = events.map(event => {
    const words = event.text.toLowerCase().match(/[a-z]+/g)!;
    return new Set(words.slice(0, -3).map((_, i) => words.slice(i, i + 4).join(' ')));
  });
  for (let a = 0; a < premises.length; a++) for (let b = a + 1; b < premises.length; b++) {
    const overlap = [...premises[a]].filter(phrase => premises[b].has(phrase)).length;
    assert(overlap / Math.min(premises[a].size, premises[b].size) < .5, `${events[a].id} and ${events[b].id}: repeated premise`);
  }
});

test('every root has an ordinary solo route for each starter hull, resolves, and cannot replay rewards', () => {
  for (const hull of definitions.hulls) {
    const state = rules.create({ roomId: 'content-test', roundId: 'content-test', nowMs: 0, seed: 18, players: [{ id: 'player', name: 'Captain', color: '#28c6e7' }] }, { difficulty: 'standard', expedition: 'standard' });
    const actor = state.captains[0], fleet = createShip(defs, { id: 'test-ship', hullId: hull.id, ownerCaptainId: actor.id, name: 'Test ship', color: '#28c6e7', formation: 0, faction: 'allied' });
    state.simulation.ships = [fleet.ship]; state.simulation.crew = fleet.crew; actor.currentOwnedShipId = fleet.ship.id; actor.wallet = 0; state.phase = 'event';
    for (const event of events) {
      state.expedition.event = { id: event.id, definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
      const ordinary = availableChoices(state, defs).find(choice => !choice.special && choice.available && choice.cost === 0);
      if (event.choices.length) assert(ordinary, `${hull.id}/${event.id}: no ordinary zero-wallet route`);
      const effects = resolveEvent(state, ordinary?.id ?? null, defs); assertSerializable(effects);
      assert.equal(state.expedition.event.resolved, true);
      assert.deepEqual(resolveEvent(state, ordinary?.id ?? null, defs), [], `${hull.id}/${event.id}: replay produced effects`);
    }
  }
});
