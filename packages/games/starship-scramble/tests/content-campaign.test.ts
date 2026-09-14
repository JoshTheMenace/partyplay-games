import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { definitions as defs, scenarioRoots } from '../src/definitions/server';
import { advanceSector, availableChoices, createExpedition, enterBeacon, openStore, resolveEvent } from '../src/expedition';
import { createShip } from '../src/simulation';
import { fixture } from './fixtures';

test('all 300 roots and 30 followups have an ordinary route with no scrap, ammunition or operational weapons', () => {
  for (const hull of defs.hulls) {
    const state = fixture(1);
    const actor = state.captains[0]!;
    const created = createShip(defs, { id: 'content-ship', hullId: hull.id, ownerCaptainId: actor.id, name: hull.name, color: hull.color, formation: 0, faction: 'allied' });
    state.simulation.ships = [created.ship]; state.simulation.crew = created.crew;
    created.ship.ammo = 0;
    created.ship.rooms.find(room => room.system === 'weaponry')!.damage = 50;
    actor.currentOwnedShipId = created.ship.id; actor.cargoShipId = created.ship.id; actor.wallet = 0;
    for (const event of defs.events) {
      state.expedition.event = { id: event.id, definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
      const ordinary = availableChoices(state, defs).find(choice => !choice.special && choice.available && choice.cost === 0);
      if (event.choices.length) assert.ok(ordinary, `${hull.id}/${event.id}: no affordable ordinary route`);
      assertSerializable(resolveEvent(state, ordinary?.id ?? null, defs));
      assert.deepEqual(resolveEvent(state, ordinary?.id ?? null, defs), []);
    }
  }
});

test('seeded routes finish 30 connected beacons without repeating roots across roster and difficulty', () => {
  const seen = new Set<string>();
  for (const count of [1, 2, 3, 4]) for (const difficulty of ['relaxed', 'standard'] as const) for (let seed = 1; seed <= 64; seed++) {
    const state = fixture(count, seed);
    state.settings = { difficulty, expedition: 'standard' };
    state.expedition = createExpedition(seed, state.settings, count, defs);
    assert.equal(state.expedition.sectorIds[0], 'lantern-reach');
    assert.equal(state.expedition.sectorIds[4], 'relay-crown');
    for (let visit = 0; visit < 30; visit++) {
      const current = state.expedition.beacons.find(beacon => beacon.id === state.expedition.currentBeaconId);
      const options = state.expedition.beacons.filter(beacon => current ? current.next.includes(beacon.id) : beacon.column === 0);
      const beacon = options[(seed + visit) % options.length]!;
      enterBeacon(state, beacon.id, defs);
      if (state.expedition.event) {
        const event = defs.events.find(event => event.id === state.expedition.event!.definitionId)!;
        const choice = availableChoices(state, defs).find(choice => !choice.special && choice.available && choice.cost === 0)!;
        const effects = resolveEvent(state, event.choices.length ? choice.id : null, defs);
        for (const effect of effects) {
          if (effect.kind === 'flag') state.expedition.flags[effect.id] = effect.value;
          if (effect.kind === 'followup') state.expedition.flags[`followup:${effect.eventId}`] = true;
          if (effect.kind === 'reputation') state.expedition.reputation[effect.faction] = (state.expedition.reputation[effect.faction] ?? 0) + effect.amount;
        }
      }
      if (beacon.kind === 'exit' && visit < 29) advanceSector(state, defs);
    }
    assert.equal(state.expedition.completedBeacons, 30);
    assert.equal(state.expedition.event!.definitionId, 'last-mirror');
    assert.equal(new Set(state.expedition.seenRoots).size, state.expedition.seenRoots.length);
    for (const id of state.expedition.seenRoots) seen.add(id);
    assert.ok(!Object.keys(state.expedition.flags).some(flag => flag.startsWith('followup:') && state.expedition.flags[flag]), 'A quest was promised without a reachable final delivery.');
  }
  assert.ok(scenarioRoots.filter(root => seen.has(root.id)).length >= 230);
});

test('each personal store includes a real offensive weapon after the opening capacity upgrade', () => {
  for (let seed = 0; seed < 32; seed++) {
    const state = fixture(4, seed);
    openStore(state, defs);
    for (const actor of state.captains) assert.ok(state.expedition.items.some(item => item.stockCaptainId === actor.id && item.location === 'store' && item.price <= 50 && item.kind === 'weapon' && defs.weapons.some(weapon => weapon.id === item.definitionId && weapon.target === 'enemy' && weapon.damage > 0)));
  }
});
