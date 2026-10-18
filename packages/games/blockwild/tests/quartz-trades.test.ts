import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, I } from '../src/shared/items';
import { hash3 } from '../src/shared/noise';
import { structuresNear, villagesNear, type Village } from '../src/shared/structures/index';
import { MASON, offersFor, professionAt, PROFESSIONS } from '../src/shared/trades';

const SEEDS = Array.from({ length: 400 }, (_, s) => s * 7919 + 13);
const quartzBuy = (p: number, seed: number) => offersFor(p, seed).find(o => o.buy.id === I.quartz);

test('masons are profession 5 and trade stone and quartz for emeralds at MC prices', () => {
  assert.equal(PROFESSIONS[MASON], 'Mason');
  const all = SEEDS.flatMap(seed => offersFor(MASON, seed));
  const sold = new Set(all.filter(o => o.buy.id === I.emerald).map(o => o.sell.id));
  const bought = new Set(all.filter(o => o.sell.id === I.emerald).map(o => o.buy.id));
  assert.deepEqual([...bought].sort(), [I.clay_ball, B.stone, I.quartz].sort(), 'buys clay, stone and quartz');
  for (const block of [B.bricks, B.chiseled_stone_bricks, B.stone_bricks, B.terracotta, B.quartz_block, B.quartz_pillar]) assert.ok(sold.has(block), `sells ${block}`);
  for (const o of all) {
    if (o.sell.id === I.emerald) assert.equal(o.sell.n, 1, 'every buy pays one emerald');
    else assert.equal(o.buy.id === I.emerald && o.buy.n, 1, 'building blocks cost one emerald');
    assert.ok(o.max >= 12 && o.max <= 16);
  }
  assert.ok(all.every(o => o.buy.id !== I.quartz || o.buy.n === 12), '12 quartz → 1 emerald');
});

test('clerics buy quartz too: 12 → 1 emerald, carried by a fair share of them', () => {
  const clerics = SEEDS.map(seed => quartzBuy(4, seed)).filter(o => o !== undefined);
  assert.ok(clerics.length > 40 && clerics.length < 300, `${clerics.length} of ${SEEDS.length} clerics buy quartz`);
  assert.ok(clerics.every(o => o.buy.n === 12 && o.sell.id === I.emerald && o.sell.n === 1));
  const masons = SEEDS.filter(seed => quartzBuy(MASON, seed)).length;
  assert.ok(masons > 100, `${masons} masons buy quartz`);
});

test('offers are deterministic per (profession, seed), 3–5 long, and differ between villagers', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const offers = offersFor(MASON, seed);
    assert.ok(offers.length >= 3 && offers.length <= 5);
    assert.deepEqual(offersFor(MASON, seed), JSON.parse(JSON.stringify(offers)));
  }
  const kinds = new Set(SEEDS.map(seed => JSON.stringify(offersFor(MASON, seed))));
  assert.ok(kinds.size > 50, 'masons do not all trade the same');
  // Pinned: a saved villager's `uses` count by offer index, so a mason's deals must never reshuffle.
  const pinned = offersFor(MASON, 4242).map(o => [o.buy.id, o.buy.n, o.sell.id, o.sell.n, o.max]);
  assert.deepEqual(pinned, [[I.quartz, 12, I.emerald, 1, 16], [I.emerald, 1, B.quartz_block, 1, 12], [I.emerald, 1, B.stone_bricks, 8, 16], [I.emerald, 1, B.bricks, 10, 16]]);
});

test('a village has exactly one mason when it has two or more houses; every other bed keeps its old profession', () => {
  const villages = new Map<string, Village>();
  for (const seed of [11, 4242, 777777]) for (const info of structuresNear(seed, 2048, 2048, 1500).filter(s => s.kind === 'village')) {
    for (const village of villagesNear(seed, info.center[0] >> 4, info.center[2] >> 4)) villages.set(`${seed}:${village.center}`, village);
  }
  assert.ok(villages.size >= 5, `${villages.size} villages sampled`);
  let masons = 0;
  for (const [key, village] of villages) {
    const seed = Number(key.split(':')[0]);
    const jobs = village.houses.map(({ bed }) => professionAt(seed, village, bed));
    const count = jobs.filter(p => p === MASON).length;
    assert.equal(count, village.houses.length > 1 ? 1 : 0, `village ${key}: ${jobs}`);
    village.houses.forEach(({ bed }, i) => { if (jobs[i] !== MASON) assert.equal(jobs[i], hash3(seed, bed[0], bed[1], bed[2]) % 5); });
    masons += count;
  }
  assert.ok(masons > 0);
});
