/** Balance sweeps (SS_BALANCE=1, a few minutes): 30-seed scripted-captain win rates and battle lengths against the README "Balance" targets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Settings } from '../src/contracts';
import { PLAYER_HULLS } from '../src/defs/hulls';
import { campaign } from './run-bot';

const SEEDS = 30, skip = !process.env.SS_BALANCE && 'set SS_BALANCE=1 to run the balance sweeps';
const cadet: Settings = { difficulty: 'cadet', length: 'short' }, captain: Settings = { difficulty: 'captain', length: 'standard' };
/** [label, captains, settings, min win rate, max win rate, hulls] */
const ROWS: [string, number, Settings, number, number, string[]?][] = [
  ...[1, 2, 4].map(n => [`cadet/short ${n}p`, n, cadet, .7, 1] as [string, number, Settings, number, number]),
  ...PLAYER_HULLS.map(h => [`cadet/short solo ${h.id}`, 1, cadet, .45, 1, [h.id]] as [string, number, Settings, number, number, string[]]),
  ['captain/standard 1p', 1, captain, .15, .35], ['captain/standard 4p', 4, captain, .3, .5],
];
for (const [label, n, settings, lo, hi, hulls] of ROWS) test(label, { skip }, () => {
  const r = campaign(n, settings, SEEDS, hulls), rate = r.wins / SEEDS;
  console.log(`${label}: ${Math.round(rate * 100)}% · ${r.median.toFixed(1)} min · fights median ${Math.round(r.fightMedian)} s, p90 ${Math.round(r.fightP90)} s, max ${Math.round(r.longestFight)} s`);
  assert(rate >= lo && rate <= hi, `${label} wins ${r.wins}/${SEEDS}, want ${lo * 100}–${hi * 100}%`);
  assert(r.fightP90 <= 240, `${label} fight p90 ${r.fightP90} s`);
});
