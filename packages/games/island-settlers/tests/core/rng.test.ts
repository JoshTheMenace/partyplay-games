import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDiceDeck, generator, rollDice, seedStreams, sfc32, shuffle } from '../../src/engine/rng';
import { game, pastSetup, pub } from '../helpers';

test('streams are seeded, independent and deterministic', () => {
  const a = seedStreams(42), b = seedStreams(42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.dice, a.cards);
  const draws = Array.from({ length: 1000 }, () => sfc32(a.dice));
  assert.ok(draws.every(x => x >= 0 && x < 1));
  assert.ok(Math.abs(draws.reduce((n, x) => n + x, 0) / 1000 - 0.5) < 0.05);
  const r = generator(7, 'board');
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], r).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(pub(game(4, {}, 99)), pub(game(4, {}, 99)), 'same seed, same game');
});

test('balanced dice: every pair once per deck, reshuffled when six remain', () => {
  const random = generator(3, 'dice');
  let deck: [number, number][] | null = freshDiceDeck(random), last: number | null = null;
  const totals = Array(13).fill(0);
  for (let i = 0; i < 3600; i++) {
    const out = rollDice(random, deck, last);
    deck = out.deck;
    last = out.dice[0] + out.dice[1];
    totals[last]++;
    assert.ok(deck!.length > 6);
  }
  assert.ok(Math.abs(totals[7] / 3600 - 6 / 36) < 0.03, `sevens ${totals[7]}`);
  assert.equal(totals[0] + totals[1], 0);
});

test('balanced dice setting uses the deck; plain dice do not keep one', () => {
  const plain = game(3), balanced = game(3, { balancedDice: true });
  pastSetup(balanced);
  assert.equal(plain.diceDeck, null);
  assert.ok(balanced.diceDeck && balanced.diceDeck.length > 6);
});
