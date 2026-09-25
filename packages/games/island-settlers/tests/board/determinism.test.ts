import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardIndex, coastCycle } from '../../src/engine/board';
import { generate, label, MAPS, TIER_SEATS } from './check';

for (const settings of MAPS) {
  test(`${label(settings)}: same seed, same board; new seed, new board`, () => {
    for (const seats of TIER_SEATS) for (const seed of [1, 77, 4242]) {
      const a = generate(seats[0], settings, seed), b = generate(seats.at(-1)!, settings, seed);
      assert.deepEqual(a, b, 'deterministic, and seats within a size tier share the layout');
      assert.notDeepEqual(generate(seats[0], settings, seed + 1).board.tiles, a.board.tiles);
    }
  });
}

test('boards survive a JSON round trip and re-index identically', () => {
  for (const settings of MAPS) {
    const { board } = generate(7, settings, 9);
    const copy = JSON.parse(JSON.stringify(board));
    assert.deepEqual(copy, board);
    const [a, b] = [boardIndex(board), boardIndex(copy)];
    assert.deepEqual([...b.coasts], [...a.coasts]);
    assert.deepEqual([...b.tileVertices], [...a.tileVertices]);
    assert.deepEqual([...b.tileEdges], [...a.tileEdges]);
    assert.equal(boardIndex(board), a, 'the index is cached per board');
    assert.deepEqual(coastCycle(a), a.coasts.get(0) ?? []);
  }
});
