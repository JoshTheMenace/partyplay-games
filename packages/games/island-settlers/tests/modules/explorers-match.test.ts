/**
 * Full CPU matches on Explorers & Pirates at the suggested target (8 + 3 per mission, +5 with C&K):
 * they must end by target (the legacy version stalled), with zero rejected actions and every good
 * accounted for. 4 and 10 seats in Standard and Connect, each mission alone, and with C&K.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Mission, Mode } from '../../src/model';
import { game, inventory, serializable } from '../helpers';
import { runMatch } from '../cpu/match';

const ALL: Mission[] = ['lairs', 'fish', 'spices'];

function play(seats: number, mode: Mode, seed: number, missions = ALL, citiesKnights = false) {
  const settings = { map: 'explorers' as const, mode, missions, citiesKnights, timer: 'relaxed' as const };
  const r = runMatch({ seats, seed, settings });
  const label = `${seats} ${mode} [${missions}]${citiesKnights ? ' +C&K' : ''} seed ${seed}`;
  assert.deepEqual(r.rejected.slice(0, 3), [], label);
  assert.equal(r.reason, 'target', `${label}: ${r.reason} after ${r.rounds} rounds`);
  assert.ok(r.rounds <= (mode === 'connect' ? 85 : 45), `${label}: ${r.rounds} rounds`);
  assert.deepEqual(inventory(r.s), inventory(game(seats, settings, seed)), `${label}: goods conserved`);
  const winner = r.s.results!.standings[0];
  assert.ok(winner.vp >= r.s.settings.targetPoints, label);
  serializable(r.s);
  return r;
}

test('4 seats, all missions: Standard and Connect finish by target', () => {
  play(4, 'standard', 1);
  play(4, 'connect', 1);
});

test('10 seats, all missions: Standard and Connect finish by target', () => {
  play(10, 'standard', 2);
  play(10, 'connect', 2);
});

test('each mission alone, and Land Ho! with none, finishes at its default target', () => {
  const alone = { lairs: 12, fish: 11, spices: 10 };
  for (const m of ALL) {
    const r = play(4, 'standard', 3, [m]);
    assert.equal(r.s.settings.targetPoints, alone[m]);
  }
  assert.equal(play(3, 'standard', 3, []).s.settings.targetPoints, 8);
});

test('with Cities & Knights (city first, harbor second) the game still finishes by target', () => {
  const r = play(4, 'standard', 2, ALL, true);
  assert.equal(r.s.settings.targetPoints, 22);
});
