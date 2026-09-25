/**
 * Full CPU games on the live engine (skipped until WP-core + WP-rules + WP-trade play a game).
 * CPU_SWEEP=n plays n seeds per (mode, seat count) in the legality sweep (13 → 208 games).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enginePlays, runMatch } from './match';

const skip = enginePlays() ? false : 'engine does not play a full game yet';
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('CPU-only games finish by target at 3, 4, 6 and 10 seats, paced per seat', { skip }, () => {
  for (const seats of [3, 4, 6, 10]) {
    const r = runMatch({ seats, seed: 11 + seats });
    assert.deepEqual(r.rejected.slice(0, 3), [], `${seats} seats`);
    assert.equal(r.reason, 'target', `${seats} seats ended ${r.reason} after ${r.rounds} rounds`);
    assert.ok(r.minGap >= 400, `pacing: ${r.minGap} ms between one seat's actions`);
    assert.equal(r.autos, 0, `${seats} seats: ${r.autos} auto-played steps`);
    assert.ok(r.p95 < 5, `${seats} seats: decide p95 ${r.p95.toFixed(2)} ms`);
  }
});

test('legality sweep: Standard and Connect, 3-10 seats, zero rejected actions', { skip }, () => {
  const seeds = Number(process.env.CPU_SWEEP ?? 1);
  for (const mode of ['standard', 'connect'] as const) for (let seats = 3; seats <= 10; seats++) {
    for (let k = 0; k < seeds; k++) {
      const r = runMatch({ seats, seed: 1000 + seats * 10 + k, settings: { mode } });
      assert.deepEqual(r.rejected.slice(0, 3), [], `${mode} ${seats} seats seed ${k}`);
      assert.equal(r.reason, 'target', `${mode} ${seats} seats seed ${k}: ${r.reason}`);
    }
  }
});

test('4 Normal CPUs on Base at 10 VP: median <= 70 opportunities over 20 seeds; CPUs trade', { skip }, () => {
  const runs = Array.from({ length: 20 }, (_, i) => runMatch({ seats: 4, seed: 100 + i }));
  const opp = runs.map(r => r.opportunities), offers = runs.reduce((n, r) => n + r.offers, 0);
  assert.ok(median(opp) <= 70, `median ${median(opp)} opportunities (${opp.join(', ')})`);
  assert.ok(offers * 8 >= runs.reduce((n, r) => n + r.opportunities, 0), `${offers} offers`);
  assert.ok(runs.every(r => r.trades > 0), 'CPU-to-CPU trades complete in every game');
});

test('Sharp beats Easy: 1 Sharp vs 2 Easy wins >= 60% over 40 seeds', { skip }, () => {
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    const r = runMatch({ seats: 3, seed: 500 + i, levels: ['sharp', 'easy', 'easy'] });
    if (r.winners.includes(r.s.order[0])) wins++;
  }
  assert.ok(wins >= 24, `${wins}/40`);
});
