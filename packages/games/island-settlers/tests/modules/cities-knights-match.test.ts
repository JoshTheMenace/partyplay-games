/**
 * Full CPU-only Cities & Knights matches at the suggested target (13; Seafarers 15, E&P 19): every
 * game ends by target, no CPU action is ever rejected, goods (commodities included) are conserved
 * at every step, views stay serializable, progress cards stay private and no prompt outlives its
 * deadline by more than a tick.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mode, Settings } from '../../src/model';
import { decide, type Brain } from '../../src/cpu/index';
import { sx } from '../../src/engine/modules/cities-knights/state';
import type { State } from '../../src/engine/state';
import { seeded } from '../fixtures/board';
import { act, game, inventory, pub, serializable, tick, view } from '../helpers';

/** Progress cards (by id) appear only in their owner's view (and to a Spy looking at them). */
function private_(s: State) {
  const held = s.order.map(id => sx(s, id).progress.map(c => c.id));
  assert.equal(held.flat().some(id => JSON.stringify(pub(s)).includes(`"${id}"`)), false, 'public view');
  s.order.forEach((seat, i) => {
    const mine = JSON.stringify(view(s, seat)), spied = Object.values(s.prompts)
      .filter(p => p.seat === seat && p.kind === 'cities-knights/spy').map(p => (p.data as { from: string }).from);
    const others = held.flatMap((ids, j) => (j !== i && !spied.includes(s.order[j]) ? ids : []));
    assert.equal(others.find(id => mine.includes(`"${id}"`)), undefined, seat);
  });
}

const PERSONAS = ['trader', 'roads', 'knights', 'cities', 'farmer', 'miner', 'sailor', 'banker', 'scout'];

function match(seats: number, seed: number, settings: Partial<Settings>) {
  const s = game(seats, { citiesKnights: true, timer: 'relaxed', ...settings }, seed), pace = seeded(seed * 7919);
  const brains: Record<string, Brain> = {}, nextAt: Record<string, number> = {}, rejected: string[] = [];
  s.order.forEach((id, i) => {
    brains[id] = { level: 'normal', persona: PERSONAS[i % 9], memory: null, random: seeded(seed * 131 + i) };
    nextAt[id] = s.now + 600;
  });
  const stock = JSON.stringify(inventory(s));
  let now = s.now, late = 0;
  for (let step = 0; s.turn.stage !== 'finale' && s.turn.stage !== 'ended'; step++) {
    for (const id of s.order) {
      if (nextAt[id] > now) continue;
      const d = decide(pub(s), view(s, id), brains[id]);
      brains[id].memory = d.memory;
      nextAt[id] = now + 600 + Math.floor(pace() * 600);
      if (!d.action) continue;
      try { act(s, id, d.action, now); } catch (e) { rejected.push(`${id} ${d.action.type}: ${(e as Error).message}`); }
    }
    now += 100;
    tick(s, now);
    assert.equal(JSON.stringify(inventory(s)), stock, `goods conserved at step ${step}`);
    late += Object.values(s.prompts).filter(p => p.deadline !== null && p.deadline < now - 100).length;
    if (step % 100 === 0) { serializable(s); private_(s); }
  }
  return { s, rejected, late };
}

// Round bounds: 10-seat Connect games spread widely by seed (67–160 rounds seen for seeds 1–4).
const runs: [number, Mode, Partial<Settings>, number][] = [
  [4, 'standard', {}, 60], [10, 'standard', {}, 40], [4, 'connect', {}, 140], [10, 'connect', {}, 170],
];

for (const [seats, mode, extra, rounds] of runs) {
  test(`${seats} seats, ${mode}: CPU games finish by target`, () => {
    for (const seed of seats === 4 ? [1, 2] : [1]) {
      const { s, rejected, late } = match(seats, seed, { mode, ...extra });
      assert.deepEqual(rejected.slice(0, 3), [], `seed ${seed}`);
      assert.equal(s.results?.reason, 'target', `seed ${seed} ended ${s.results?.reason} in round ${s.turn.round}`);
      assert.ok(s.turn.round <= rounds, `seed ${seed}: ${s.turn.round} rounds`);
      assert.equal(late, 0, 'no prompt past its deadline');
      assert.ok(s.results!.standings[0].vp >= s.settings.targetPoints);
    }
  });
}

for (const [label, extra] of [
  ['Seafarers', { map: 'seafarers' }], ['Explorers & Pirates', { map: 'explorers' }],
  ['Barbarian Attack', { scenarios: ['barbarian-attack'] }],
] as [string, Partial<Settings>][]) {
  test(`with ${label}: a 4-seat CPU game finishes by target`, () => {
    const { s, rejected, late } = match(4, 1, { mode: 'standard', ...extra });
    assert.deepEqual(rejected.slice(0, 3), []);
    assert.equal(s.results?.reason, 'target');
    assert.equal(late, 0);
  });
}
