/** Robber strength and fairness: hits the leader, never itself, blind to human/CPU flags. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fixture } from '../fixtures/index';
import { loadFixture } from '../fixtures/index';
import { think, brain } from './helpers';

const touches = (f: Fixture, tile: string, seat: string) =>
  f.pub.board.vertices.some(v => v.tiles.includes(tile) && f.pub.pieces.buildings[v.id]?.seat === seat);

/** The 7 fixture with `leader` far ahead on public VP. */
function withLeader(leader: string, cpu: (i: number) => boolean) {
  const f = loadFixture('seven-robber-4');
  f.pub.seats.forEach((s, i) => Object.assign(s, { vp: s.id === leader ? 8 : 3 + (i % 2), cpu: cpu(i) }));
  return f;
}

const pickTile = (f: Fixture, level: 'normal' | 'sharp', seed: number) => {
  const d = think(f.pub, f.views.p0, brain(level, seed));
  assert.ok(d.action?.type === 'answer');
  return d.action.picks;
};

test('hits the leader at least 80% of the time when the leader can be hit', () => {
  let hits = 0, tries = 0;
  for (const leader of ['p1', 'p2', 'p3']) for (const level of ['normal', 'sharp'] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      const f = withLeader(leader, () => false), picks = pickTile(f, level, seed);
      const reachable = f.pub.robberChoices[0].tiles
        .some(t => touches(f, t.tile, leader) && !touches(f, t.tile, 'p0'));
      if (!reachable) continue;
      tries++;
      if (touches(f, picks.tile, leader)) hits++;
      assert.ok(!touches(f, picks.tile, 'p0'), 'never robs itself');
    }
  }
  assert.ok(tries > 0 && hits / tries >= 0.8, `${hits}/${tries}`);
});

test('the victim is the leader whenever the leader is on the hex', () => {
  const f = withLeader('p2', () => false);
  const tile = f.pub.robberChoices[0].tiles.find(t => t.victims.length > 1 && t.victims.includes('p2'));
  if (!tile) return;
  f.pub.robberChoices[0].tiles = [tile];
  const prompt = f.views.p0.prompts[0];
  const field = prompt.command.fields[0];
  if (field.kind === 'pick') field.options = field.options.filter(o => o.value === tile.tile);
  assert.equal(pickTile(f, 'normal', 1).victim, 'p2');
});

test('swapping human and CPU flags never changes the choice', () => {
  for (const leader of ['p1', 'p2', 'p3']) for (let seed = 1; seed <= 5; seed++) {
    const a = pickTile(withLeader(leader, i => i % 2 === 0), 'sharp', seed);
    const b = pickTile(withLeader(leader, i => i % 2 === 1), 'sharp', seed);
    assert.deepEqual(a, b);
  }
});
