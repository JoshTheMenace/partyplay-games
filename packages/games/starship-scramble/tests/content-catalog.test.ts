import assert from 'node:assert/strict';
import test from 'node:test';
import { definitions, scenarioRoots, followupNodes } from '../src/definitions/server';
import { contentInventory, validateDefinitions } from '../src/expedition/validate';
import { createExpedition } from '../src/expedition';

test('full authored content has valid references, effects, geometry and production equipment counts', () => {
  assert.deepEqual(validateDefinitions(definitions), []);
  assert.equal(definitions.hulls.length, 8);
  assert.equal(definitions.weapons.length, 48);
  assert.equal(definitions.drones.length, 12);
  assert.equal(definitions.augments.length, 24);
  assert.equal(definitions.enemies.length, 24);
  assert.equal(definitions.systems.filter(system => system.cooldownMs > 0).length, 12);
  assert.equal(scenarioRoots.length, 300);
  assert.equal(followupNodes.length, 30);
  assert.equal(new Set(definitions.hulls.map(hull => JSON.stringify(hull.rooms.map(({ x, y, w, h, adjacent }) => ({ x, y, w, h, adjacent }))))).size, 8);
  assert.deepEqual(Object.fromEntries(['travel', 'distress', 'hostile', 'trade', 'science', 'faction', 'quest'].map(category => [category, scenarioRoots.filter(event => event.category === category).length])), { travel: 60, distress: 50, hostile: 50, trade: 40, science: 40, faction: 30, quest: 30 });
  assert.equal(new Set(definitions.weapons.map(weapon => weapon.family)).size, 8);
  const inventory = contentInventory(definitions);
  assert.ok(inventory.reduce((sum, row) => sum + row.words, 0) >= 20000);
  const specialShare = scenarioRoots.filter(event => event.choices.some(choice => choice.requirement)).length / scenarioRoots.length;
  assert.ok(specialShare >= 0.15 && specialShare <= 0.25);
  assert.ok(inventory.some(row => row.ordinaryChoices + row.specialChoices === 0));
  assert.ok(inventory.some(row => row.specialChoices > 0));
});
test('five-sector campaign route is seeded, connected, and bounded; training visits four beacons', () => {
  const settings = { difficulty: 'standard', expedition: 'standard' } as const;
  const route = createExpedition(123, settings, 4, definitions);
  assert.deepEqual(route, createExpedition(123, settings, 4, definitions));
  assert.equal(new Set(route.sectorIds).size, 5);
  assert.equal(Math.max(...route.beacons.map(beacon => beacon.column)), 6);
  for (const beacon of route.beacons) if (beacon.kind !== 'exit') assert.ok(beacon.next.every(id => route.beacons.some(next => next.id === id && next.column > beacon.column)));
  assert.equal(createExpedition(1, { ...settings, expedition: 'training' }, 1, definitions).beacons.length, 4);
});
test('invalid content fails validation rather than silently becoming a dead option', () => {
  const broken = structuredClone(definitions);
  broken.events[0]!.effects.push({ kind: 'followup', eventId: 'missing' });
  broken.hulls[0]!.rooms[0]!.adjacent.push('missing-room');
  assert.ok(validateDefinitions(broken).some(error => error.includes('missing followup')));
  assert.ok(validateDefinitions(broken).some(error => error.includes('broken room connection')));
});
