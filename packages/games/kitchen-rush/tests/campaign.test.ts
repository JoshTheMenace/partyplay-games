import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_KEY, COOK_KEY, bestFor, readCampaign, recordCampaign, rememberCook, rememberedCook, totalStars } from '../src/campaign';
import { LEVELS } from '../src/levels';

const storage = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };

test('best stars and scores persist per level id and never regress', () => {
  const store = storage(), [first, last] = [LEVELS[0].id, LEVELS.at(-1)!.id];
  assert.equal(CAMPAIGN_KEY, 'party.kitchen-rush.campaign.v2');
  assert.deepEqual(bestFor(readCampaign(store), first), { stars: 0, score: 0 });
  recordCampaign(last, 3, 800, store); recordCampaign(last, 1, 900, store); recordCampaign(last, 0, 40, store);
  assert.deepEqual(bestFor(readCampaign(store), last), { stars: 3, score: 900 });
  recordCampaign(first, 1, 280, store);
  assert.equal(totalStars(readCampaign(store)), LEVELS.length > 1 ? 4 : 3);
  assert.equal(JSON.parse(store.data.get(CAMPAIGN_KEY)!).version, 2);
});

test('corrupted or hostile data is recoverable and sanitized', () => {
  const store = storage();
  store.setItem(CAMPAIGN_KEY, '{bad'); assert.deepEqual(readCampaign(store).levels, {});
  store.setItem(CAMPAIGN_KEY, JSON.stringify({ version: 1, stars: [3] })); assert.deepEqual(readCampaign(store).levels, {});
  store.setItem(CAMPAIGN_KEY, '{"version":2,"levels":{"a":{"stars":5,"score":-3},"b":{"stars":"2","score":41.6},"__proto__":{"stars":3},"Bad Id!":{"stars":3,"score":1}}}');
  const levels = readCampaign(store).levels;
  assert.deepEqual(levels.a, { stars: 3, score: 0 }); assert.deepEqual(levels.b, { stars: 0, score: 42 });
  assert.deepEqual(Object.keys(levels).sort(), ['a', 'b']);
  assert.deepEqual(recordCampaign('a', 7, 10, store).levels.a, { stars: 3, score: 0 }, 'invalid stars are ignored');
});

test('blocked storage reports unsaved progress without throwing', () => {
  const store = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readCampaign(store).saved, false);
  const result = recordCampaign(LEVELS[0].id, 2, 550, store);
  assert.equal(result.saved, false); assert.deepEqual(bestFor(result, LEVELS[0].id), { stars: 2, score: 550 });
});

test('the phone remembers its chef and ignores junk or blocked storage', () => {
  const store = storage();
  assert.equal(rememberedCook(store), null);
  rememberCook('axolotl', store);
  assert.equal(store.data.get(COOK_KEY), 'axolotl'); assert.equal(COOK_KEY, 'party.kitchen-rush.cook');
  assert.equal(rememberedCook(store), 'axolotl');
  store.data.set(COOK_KEY, 'dragon'); assert.equal(rememberedCook(store), null);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(rememberedCook(blocked), null); assert.doesNotThrow(() => rememberCook('cat', blocked));
});
