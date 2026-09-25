import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type Settings } from '../../src/model';
import { maxTarget, modulesFor, restrictions, suggestedTarget, validateSettings } from '../../src/settings';

const v = (raw: Partial<Settings>) => validateSettings(raw);

test('validateSettings({}) equals DEFAULT_SETTINGS', () => {
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(modulesFor(DEFAULT_SETTINGS), []);
});

test('every ENGINE §14.4 restriction rejects with its reason', () => {
  const cases: [Partial<Settings>, RegExp][] = [
    ...(['rivers', 'caravans', 'barbarian-attack', 'deliveries'] as const).flatMap(k => [
      [{ map: 'explorers', scenarios: [k] }, /only Fishing/],
      [{ map: 'seafarers', seafarers: 'four-islands', scenarios: [k] }, /no home island/],
    ] as [Partial<Settings>, RegExp][]),
    [{ map: 'explorers', variants: ['friendly-robber'] }, /no land robber/],
    [{ map: 'explorers', variants: ['harbormaster'] }, /replaces ports/],
    [{ scenarios: ['barbarian-attack'], variants: ['friendly-robber'] }, /replaces the land robber/],
    [{ scenarios: ['deliveries'], variants: ['friendly-robber'] }, /replaces the land robber/],
  ];
  for (const [raw, reason] of cases) {
    assert.throws(() => v(raw), reason, JSON.stringify(raw));
    const key = [...(raw.scenarios ?? []), ...(raw.variants ?? [])].at(-1)!;
    assert.match(restrictions(raw)[key]!, reason);
  }
});

test('allowed combinations validate', () => {
  for (const map of ['base', 'seafarers', 'explorers'] as const) assert.equal(v({ map, citiesKnights: true }).map, map);
  assert.deepEqual(v({ map: 'explorers', scenarios: ['fishing'], missions: [] }).missions, []);
  const fog = v({ map: 'seafarers', seafarers: 'fog-islands', scenarios: ['rivers', 'caravans'] });
  assert.deepEqual(fog.scenarios, ['rivers', 'caravans']);
  assert.deepEqual(v({ scenarios: ['deliveries', 'fishing'] }).scenarios, ['fishing', 'deliveries'], 'canonical order');
  assert.deepEqual(modulesFor(v({ map: 'seafarers', citiesKnights: true, variants: ['harbormaster'] })),
    ['seafarers', 'cities-knights', 'harbormaster']);
});

test('suggested targets follow the table', () => {
  const table: [Partial<Settings>, number][] = [
    [{}, 10], [{ citiesKnights: true }, 13],
    [{ map: 'seafarers', seafarers: 'new-shores' }, 14], [{ map: 'seafarers', seafarers: 'four-islands' }, 13],
    [{ map: 'seafarers', seafarers: 'fog-islands' }, 12], [{ map: 'seafarers', citiesKnights: true }, 16],
    [{ map: 'explorers' }, 17], [{ map: 'explorers', missions: [] }, 8], [{ map: 'explorers', missions: ['fish'] }, 11],
    [{ map: 'explorers', missions: ['lairs'] }, 12], [{ map: 'explorers', missions: ['lairs', 'fish'] }, 15],
    [{ map: 'explorers', citiesKnights: true }, 22],
    [{ scenarios: ['fishing'] }, 10], [{ scenarios: ['rivers'] }, 10], [{ scenarios: ['caravans'] }, 12],
    [{ scenarios: ['barbarian-attack'] }, 12], [{ scenarios: ['deliveries'] }, 13],
    [{ scenarios: ['rivers', 'deliveries'] }, 13], [{ variants: ['harbormaster'] }, 11],
    [{ map: 'explorers', missions: [], scenarios: ['fishing'] }, 10],
    // Official combination sheets.
    [{ scenarios: ['barbarian-attack', 'deliveries'] }, 14], [{ scenarios: ['caravans', 'deliveries'] }, 15],
    [{ scenarios: ['fishing', 'deliveries'] }, 12], [{ scenarios: ['fishing', 'rivers'] }, 10],
    ...([['deliveries', 15], ['caravans', 15], ['barbarian-attack', 13]] as const)
      .map(([k, n]): [Partial<Settings>, number] => [{ citiesKnights: true, scenarios: [k] }, n]),
    ...([['deliveries', 17], ['caravans', 16], ['barbarian-attack', 14], ['rivers', 14]] as const)
      .map(([k, n]): [Partial<Settings>, number] => [{ map: 'seafarers', scenarios: [k] }, n]),
    [{ map: 'seafarers', seafarers: 'fog-islands', scenarios: ['deliveries'] }, 15],
  ];
  for (const [raw, target] of table) {
    assert.equal(suggestedTarget(raw), target, JSON.stringify(raw));
    assert.equal(v(raw).targetPoints, target, JSON.stringify(raw));
  }
});

test('targets, table size and enums are bounded', () => {
  assert.equal(v({ targetPoints: 22 }).targetPoints, 22);
  assert.throws(() => v({ targetPoints: 23 }), /from 8 to 22/);
  assert.throws(() => v({ targetPoints: 7 }), /victory target/);
  assert.equal(maxTarget({ citiesKnights: true }), 30);
  assert.equal(maxTarget({ map: 'explorers', missions: [] }), 13);
  for (const tableSize of [2, 11, 3.5]) assert.throws(() => v({ tableSize }), /table size/);
  assert.throws(() => v({ mode: 'solo' as never }), /mode/);
  assert.throws(() => v({ scenarios: ['fishing', 'fishing'] }), /distinct/);
  assert.throws(() => v({ roundSeconds: 75 as never }), /round length/);
  assert.throws(() => validateSettings(null), /object/);
});
