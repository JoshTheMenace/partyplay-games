import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axialKey, axialToPoint, hexDistance, spiral } from '../../src/geometry';
import type { ModuleId } from '../../src/model';
import {
  boardIndex, growIsland, placeIslands, placeNumbers, spacedSlots, tokenSet, type Decorator,
} from '../../src/engine/board';
import { rows } from '../../src/engine/board/layouts';
import { generate, seeded } from './check';

test('tokenSet reproduces the printed token sets', () => {
  assert.deepEqual(tokenSet(18), [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
  assert.deepEqual(tokenSet(28), [2, 2, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap(n => [n, n, n]), 12, 12]);
  const fours = [4, 5, 6, 8, 9, 10].flatMap(n => [n, n, n, n]);
  assert.deepEqual(tokenSet(34), [2, 2, 3, 3, 3, ...fours, 11, 11, 11, 12, 12]);
  for (let n = 1; n < 70; n++) assert.equal(tokenSet(n).length, n);
});

test('spacedSlots splits a coast into near-equal gaps', () => {
  const cycle = Array.from({ length: 30 }, (_, i) => i);
  const slots = spacedSlots(cycle, 9, 5);
  assert.deepEqual(slots.map((s, i) => (slots[(i + 1) % 9] - s + 30) % 30), [3, 3, 4, 3, 3, 4, 3, 3, 4]);
});

test('rows keeps every row centred on one axis', () => {
  const shapes = [[[3, 4, 5, 6, 5, 4, 3], -3], [[3, 4, 5, 4], -2], [[4, 5, 6, 7, 6, 5, 4], -3]] as const;
  for (const [widths, top] of shapes) {
    const cells = rows(widths, top);
    assert.equal(cells.length, widths.reduce((a, b) => a + b, 0));
    const centres = widths.map((_, i) => {
      const row = cells.filter(c => c.r === top + i).map(axialToPoint);
      return row.reduce((s, p) => s + p.x, 0) / row.length;
    });
    for (const c of centres) assert.ok(Math.abs(c - centres[0]) < 1e-9);
  }
});

test('growIsland grows connected blobs and respects blocked cells', () => {
  const random = seeded(3);
  const cells = growIsland({ q: 0, r: 0 }, 7, random, a => hexDistance(a, { q: 0, r: 0 }) > 3)!;
  assert.equal(new Set(cells.map(axialKey)).size, 7);
  assert.equal(growIsland({ q: 0, r: 0 }, 8, random, a => hexDistance(a, { q: 0, r: 0 }) > 1), null);
  const home = spiral({ q: 0, r: 0 }, 2);
  const islands = placeIslands({ around: home, sizes: [3, 3, 3], near: 3, far: 5, touch: false }, random)!;
  for (const c of islands.flat()) assert.ok(Math.min(...home.map(h => hexDistance(h, c))) >= 3);
});

test('placeNumbers fails cleanly when the rules cannot hold', () => {
  const numbers = new Map<string, number>();
  const cells = [{ q: 0, r: 0, gold: false }, { q: 1, r: 0, gold: false }];
  assert.equal(placeNumbers(cells, [6, 8], seeded(1), numbers), false);
  assert.equal(placeNumbers([{ q: 0, r: 0, gold: true }], [6], seeded(1), numbers), false);
  assert.equal(numbers.size, 0);
});

test('decorators run in desert priority order and shape the ports', () => {
  const calls: ModuleId[] = [];
  let blocked = '';
  const fishing: Decorator = {
    id: 'fishing',
    decorate(draft) {
      calls.push('fishing');
      draft.tiles.find(t => t.terrain === 'desert')!.terrain = 'lake';
      const edge = draft.index.edge.get(draft.portSlots[0])!;
      blocked = edge.a;
      draft.noPorts.add(blocked);
      const sea = edge.tiles.find(t => draft.index.tile.get(t)!.terrain === 'sea')!;
      const vertices = [edge.a, edge.b];
      draft.features.push({ kind: 'fishing-ground', id: 'fish-0', tile: sea, vertices, numbers: [4] });
    },
  };
  const castle: Decorator = { id: 'barbarian-attack', decorate: () => void calls.push('barbarian-attack') };
  const { board, robber } = generate(4, { map: 'base' }, 11, { decorators: [fishing, castle] });
  assert.deepEqual(calls, ['barbarian-attack', 'fishing']);
  assert.equal(robber, null, 'the only desert became the lake');
  assert.equal(board.features.length, 1);
  const lake = board.tiles.find(t => t.terrain === 'lake')!;
  const reserved = new Set([blocked, ...boardIndex(board).tileVertices.get(lake.id)!]);
  assert.ok(board.ports.every(p => p.vertices.every(v => !reserved.has(v))), 'ports avoid reserved vertices');
  assert.ok(board.ports.length >= 8);
  assert.ok(Object.isFrozen(board.tiles[0]) && Object.isFrozen(board.features[0]), 'the board is frozen');
});

