/**
 * Balance sweeps against the README "Balance" targets. SS_BALANCE=1 (15–20 minutes): 30-seed scripted-captain win rates and battle lengths for
 * one to four captains. SS_BALANCE=fleet (an hour or more): fleets of several wings, fewer seeds, with and without captains who give no orders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Settings } from '../src/contracts';
import { PLAYER_HULLS } from '../src/defs/hulls';
import { campaign } from './run-bot';

const SEEDS = 30, skip = process.env.SS_BALANCE !== '1' && 'set SS_BALANCE=1 to run the balance sweeps', skipFleet = process.env.SS_BALANCE !== 'fleet' && 'set SS_BALANCE=fleet to run the big-fleet sweeps';
const cadet: Settings = { difficulty: 'cadet', length: 'short' }, captain: Settings = { difficulty: 'captain', length: 'standard' }, long: Settings = { difficulty: 'captain', length: 'long' };
/** [label, captains, settings, min win rate, max win rate, hulls] */
const ROWS: [string, number, Settings, number, number, string[]?][] = [
  ...[1, 2, 4].map(n => [`cadet/short ${n}p`, n, cadet, .7, 1] as [string, number, Settings, number, number]),
  ...PLAYER_HULLS.map(h => [`cadet/short solo ${h.id}`, 1, cadet, .45, 1, [h.id]] as [string, number, Settings, number, number, string[]]),
  ['captain/standard 1p', 1, captain, .2, .45], ['captain/standard 4p', 4, captain, .3, .55],
  ['captain/long 1p', 1, long, .2, .5], ['captain/long 4p', 4, long, .25, .55],
];
for (const [label, n, settings, lo, hi, hulls] of ROWS) test(label, { skip }, () => {
  const r = campaign(n, settings, SEEDS, hulls), rate = r.wins / SEEDS;
  console.log(`${label}: ${Math.round(rate * 100)}% · ${r.median.toFixed(1)} min · fights median ${Math.round(r.fightMedian)} s, p90 ${Math.round(r.fightP90)} s, max ${Math.round(r.longestFight)} s`);
  assert(rate >= lo && rate <= hi, `${label} wins ${r.wins}/${SEEDS}, want ${lo * 100}–${hi * 100}%`);
  assert(r.fightP90 <= 240, `${label} fight p90 ${r.fightP90} s`);
});
/** [label, captains, settings, min wins, max wins, seeds, one captain in `orders` gives battle orders (0: nobody)] */
const FLEETS: [string, number, Settings, number, number, number, number][] = [
  ['cadet/short 8p', 8, cadet, .7, 1, 12, 1], ['captain/standard 8p', 8, captain, .4, 1, 12, 1],
  ['cadet/short 32p', 32, cadet, .7, 1, 6, 1], ['cadet/short 32p, nobody giving orders', 32, cadet, .5, 1, 4, 0],
  ['captain/standard 32p', 32, captain, .5, 1, 6, 1], ['captain/standard 32p, one in two giving orders', 32, captain, 0, .75, 4, 2], ['captain/standard 32p, nobody giving orders', 32, captain, 0, .25, 4, 0],
  ['cadet/short 64p', 64, cadet, .7, 1, 4, 1], ['cadet/short 64p, nobody giving orders', 64, cadet, .5, 1, 3, 0],
  ['captain/standard 64p', 64, captain, .5, 1, 4, 1], ['captain/standard 64p, one in two giving orders', 64, captain, 0, .75, 3, 2], ['captain/standard 64p, nobody giving orders', 64, captain, 0, .34, 3, 0],
];
for (const [label, n, settings, lo, hi, seeds, orders] of FLEETS) test(label, { skip: skipFleet }, () => {
  const r = campaign(n, settings, seeds, undefined, orders), rate = r.wins / seeds;
  console.log(`${label}: ${r.wins}/${seeds} · ${r.median.toFixed(1)} min · fights median ${Math.round(r.fightMedian)} s, p90 ${Math.round(r.fightP90)} s, max ${Math.round(r.longestFight)} s`);
  assert(rate >= lo && rate <= hi, `${label} wins ${r.wins}/${seeds}, want ${lo * 100}–${hi * 100}%`);
});
