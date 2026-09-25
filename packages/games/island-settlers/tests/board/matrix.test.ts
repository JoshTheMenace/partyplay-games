import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axialKey, hexDistance } from '../../src/geometry';
import type { Board, Settings, Tile } from '../../src/model';
import { boardIndex, type BoardResult } from '../../src/engine/board';
import {
  assertFair, assertGraph, assertPorts, count, generate, label, MAPS, SEEDS, TIER_SEATS,
} from './check';

const TERRAIN = [
  { wood: 4, wool: 4, grain: 4, brick: 3, ore: 3, desert: 1 },
  { wood: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 },
  { wood: 8, wool: 7, grain: 7, brick: 6, ore: 6, desert: 3 },
];
const TOKENS = [
  { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 },
  { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 },
  { 2: 2, 3: 3, 4: 4, 5: 4, 6: 4, 8: 4, 9: 4, 10: 4, 11: 3, 12: 2 },
];
const PORTS = [
  { any: 4, wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 },
  { any: 5, wood: 1, brick: 1, wool: 2, grain: 1, ore: 1 },
  { any: 6, wood: 2, brick: 1, wool: 2, grain: 1, ore: 1 },
];
const HOME = [16, 24, 30];

const sorted = (m: Map<unknown, number>) =>
  Object.fromEntries([...m].map(([k, v]) => [String(k), v] as const).sort(([a], [b]) => a.localeCompare(b)));
const land = (b: Board) => b.tiles.filter(t => t.terrain !== 'sea' && t.terrain !== 'fog');
const islandOf = (b: Board, i: number) => b.tiles.filter(t => t.island === i);
const gap = (a: readonly Tile[], b: readonly Tile[]) =>
  Math.min(...a.flatMap(x => b.map(y => hexDistance(x, y))));
const islands = (b: Board) => [...new Set(land(b).map(t => t.island))].sort((x, y) => x - y);

function checkBase({ board, robber }: BoardResult, tier: number) {
  const tiles = land(board);
  assert.deepEqual(sorted(count(tiles.map(t => t.terrain))), sorted(new Map(Object.entries(TERRAIN[tier]))));
  const tokens = count(tiles.filter(t => t.number).map(t => String(t.number)));
  assert.deepEqual(sorted(tokens), sorted(new Map(Object.entries(TOKENS[tier]))));
  assert.deepEqual(sorted(count(board.ports.map(p => p.good))), sorted(new Map(Object.entries(PORTS[tier]))));
  assert.equal(board.tiles.length - tiles.length, [18, 22, 24][tier], 'one sea ring');
  const centres = [...new Set(tiles.map(t => t.r))].map(r => {
    const row = tiles.filter(t => t.r === r);
    return row.reduce((s, t) => s + t.x, 0) / row.length;
  });
  for (const c of centres) assert.ok(Math.abs(c - centres[0]) < 1e-9, 'row centres line up');
  assert.equal(boardIndex(board).tile.get(robber!)!.terrain, 'desert');
}

function checkShores(r: BoardResult, tier: number, shores: boolean) {
  const { board, hidden, pirate } = r, home = islandOf(board, 0);
  assert.equal(home.length, HOME[tier]);
  const index = boardIndex(board);
  assert.ok(pirate && index.tileNeighbors.get(pirate)!.every(t => t.terrain === 'sea'), 'pirate out at sea');
  const onHome = (p: { edge: string }) =>
    index.edge.get(p.edge)!.tiles.some(t => index.tile.get(t)!.island === 0);
  assert.ok(board.ports.every(onHome), 'ports sit on the home coast');
  assert.equal(board.ports.length, Math.min([9, 11, 13][tier], Math.floor(index.coasts.get(0)!.length / 3)));
  if (shores) {
    const outer = land(board).filter(t => t.island > 0);
    assert.equal(outer.length, [10, 14, 20][tier]);
    assert.equal(islands(board).length - 1, [4, 5, 7][tier]);
    assert.equal(outer.filter(t => t.terrain === 'gold').length, [2, 3, 4][tier]);
    assert.ok(gap(home, outer) >= 3, 'two sea hexes between home and outer islands');
    for (const i of islands(board).slice(1)) {
      assert.ok(gap(islandOf(board, i), outer.filter(t => t.island !== i)) >= 2, 'outer islands never touch');
    }
  } else {
    const fog = board.tiles.filter(t => t.terrain === 'fog');
    assert.equal(fog.length, [12, 18, 24][tier]);
    assert.deepEqual(Object.keys(hidden).sort(), fog.map(t => t.id).sort());
    assert.ok(fog.every(t => t.number === 0 && t.island === -1));
    assert.ok(gap(home, fog) >= 2, 'a visible sea ring before the fog');
    assert.equal(islands(board).join(), '0');
  }
}

function checkFour({ board }: BoardResult, tier: number) {
  const ids = islands(board);
  assert.equal(ids.length, [4, 6, 8][tier]);
  assert.ok(!ids.includes(0), 'no home island');
  for (const i of ids) {
    const own = islandOf(board, i);
    assert.ok(own.length >= 5 && own.length <= 7, `island ${i} has ${own.length} hexes`);
    assert.ok(gap(own, land(board).filter(t => t.island !== i)) >= 2, 'islands never touch');
  }
  assert.equal(board.ports.length, [9, 11, 13][tier]);
}

function checkExplorers({ board, hidden, robber, pirate }: BoardResult, tier: number) {
  assert.equal(islandOf(board, 0).length, [18, 28, 34][tier]);
  assert.equal(Object.keys(hidden).length, [36, 48, 60][tier]);
  assert.equal(board.ports.length, 0);
  assert.equal(land(board).filter(t => t.terrain === 'desert').length, 0);
  assert.equal(robber, null);
  assert.equal(pirate, null);
  const fog = board.tiles.filter(t => t.terrain === 'fog');
  assert.ok(gap(islandOf(board, 0), fog) >= 2);
  const index = boardIndex(board);
  const outer = board.tiles.filter(t => t.terrain === 'sea' && index.tileNeighbors.get(t.id)!.length < 6);
  assert.ok(outer.every(t => gap([t], fog) >= 2), 'two sea rings frame the fog');
}

const CHECKS: Record<string, (r: BoardResult, tier: number) => void> = {
  base: checkBase,
  'new-shores': (r, t) => checkShores(r, t, true),
  'fog-islands': (r, t) => checkShores(r, t, false),
  'four-islands': checkFour,
  explorers: checkExplorers,
};

// Generation time is this thread's CPU time, so a loaded machine or busy workers cannot fail the budget.
for (const settings of MAPS) for (const [tier, seats] of TIER_SEATS.entries()) {
  test(`${label(settings)} ${seats[0]}–${seats.at(-1)} seats: ${SEEDS} seeds hold every rule`, () => {
    const times: number[] = [];
    for (let seed = 0; seed < SEEDS; seed++) {
      const start = process.threadCpuUsage();
      const result = generate(seats[seed % seats.length], settings as Partial<Settings>, seed);
      const { user, system } = process.threadCpuUsage(start);
      times.push((user + system) / 1000);
      const { board, hidden } = result;
      try {
        assertFair(board, hidden, tier === 2 ? 3 : 2);
        assertGraph(board);
        assertPorts(board);
        CHECKS[label(settings)](result, tier);
        assert.ok(board.tiles.every(t => t.id === axialKey(t)));
      } catch (error) {
        throw new Error(`seed ${seed}: ${(error as Error).message}`);
      }
    }
    const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
    assert.ok(p95 < 30, `generation p95 ${p95.toFixed(1)} ms of CPU time`);
  });
}
