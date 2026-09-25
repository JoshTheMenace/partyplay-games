/** Traders & Barbarians number discs: Barbarian Attack coast numbers and landings (official sheets). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facts, invade, invaders } from '../../src/engine/modules/barbarian-attack/coast';
import type { State } from '../../src/engine/state';
import { edit, game } from '../helpers';
import { ix } from '../rules/helpers';

const LANDINGS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const coastNumbers = (s: State) => facts(s).coast.map(t => ix(s).tile.get(t)!.number);

test('Barbarian Attack: every landing number is on the coast, so 2 and 12 always start invaded', () => {
  for (const seats of [4, 6, 8]) for (const seed of [1, 2, 3, 4, 5]) {
    const s = game(seats, { scenarios: ['barbarian-attack'] }, seed), nums = coastNumbers(s);
    assert.deepEqual(LANDINGS.filter(n => !nums.includes(n)), [], `${seats} seats seed ${seed}`);
    const starts = facts(s).coast.filter(t => [2, 12].includes(ix(s).tile.get(t)!.number));
    assert.ok(starts.every(t => invaders(s, t) === 1));
  }
});

test('Barbarian Attack: a number shared by two coastal hexes lands a barbarian on each', () => {
  const s = game(6, { scenarios: ['barbarian-attack'] }, 2), nums = coastNumbers(s);
  const n = LANDINGS.find(x => x !== 2 && x !== 12 && nums.filter(y => y === x).length > 1)!;
  const hexes = facts(s).coast.filter(t => ix(s).tile.get(t)!.number === n);
  edit(s, x => invade(x, 1, 'test', n));
  assert.ok(hexes.every(t => invaders(s, t) === 1), `every ${n} hex`);
});
