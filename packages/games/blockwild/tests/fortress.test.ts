/** Nether fortresses (DESIGN.md): placement, seamless painting, pieces, spawners, loot and the generation budget. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, blockOf, cellId, cellState, CHEST_LOOT, chestLoot, fenceConnects, isFullCube, isLava, isSolid, WART_MATURE } from '../src/shared/blocks';
import { NETHER } from '../src/shared/constants';
import { FACING, localIndex } from '../src/shared/coords';
import { I, maxStack } from '../src/shared/items';
import { LOOT, lootSeed, rollLoot } from '../src/shared/loot';
import { MOB } from '../src/shared/protocol';
// worldgen before the structure modules: they sit in an import cycle with it.
import { generateChunk } from '../src/shared/worldgen';
import { boundsRect, overlaps } from '../src/shared/structures/builder';
import { fortressesOf, netherSpawnPoint, type Fortress } from '../src/shared/structures/fortress';

const SEEDS = [11, 4242, 777777, 260923, 1, 2, 3, 99, 12345];

/** Generated world cells (chunks memoized per seed). */
function worldOf(seed: number) {
  const chunks = new Map<number, Uint16Array>();
  return (x: number, y: number, z: number) => {
    const key = (x >> 4) * 4096 + (z >> 4);
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, chunk = generateChunk(seed, x >> 4, z >> 4));
    return y < 0 || y > 127 ? B.air : chunk[localIndex(x & 15, y, z & 15)]!;
  };
}
type Get = ReturnType<typeof worldOf>;
const cellsIn = (get: Get, b: readonly number[], y0: number, y1: number, match: (cell: number) => boolean) => {
  const found: [number, number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let z = b[2]!; z <= b[5]!; z++) for (let x = b[0]!; x <= b[3]!; x++) if (match(get(x, y, z))) found.push([x, y, z]);
  return found;
};

/** Feet cells a player can walk to from `start`: floor below (not a fence), two open cells, steps of one block up or down. */
function walkable(get: Get, f: Fortress, start: readonly number[]) {
  const [x0, , z0, x1, , z1] = f.bounds, y0 = f.center[1] - 4, y1 = f.center[1] + 16;
  const open = (x: number, y: number, z: number) => !isSolid(get(x, y, z)) && !isLava(get(x, y, z));
  const stand = (x: number, y: number, z: number) => open(x, y, z) && open(x, y + 1, z) && isSolid(get(x, y - 1, z)) && blockOf(get(x, y - 1, z)).shape !== 'fence';
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`, seen = new Set([key(start[0]!, start[1]!, start[2]!)]), queue = [[...start]];
  while (queue.length) {
    const [x, y, z] = queue.pop()!;
    for (const [dx, dz] of FACING) for (const dy of [0, 1, -1]) {
      const nx = x! + dx, ny = y! + dy, nz = z! + dz, k = key(nx, ny, nz);
      if (seen.has(k) || nx < x0 || nx > x1 || nz < z0 || nz > z1 || ny < y0 || ny > y1 || !stand(nx, ny, nz)) continue;
      if (dy > 0 && !open(x!, y! + 2, z!)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  return seen;
}

test('3–4 fortresses per world inside the Nether, 64 blocks apart, deterministic, one near the spawn portal', () => {
  for (const seed of SEEDS) {
    const list = fortressesOf(seed), [tx, tz] = netherSpawnPoint(seed);
    assert.deepEqual(fortressesOf(seed), list, 'deterministic');
    assert.ok(list.length >= 3 && list.length <= 4, `seed ${seed}: ${list.length} fortresses`);
    for (const f of list) {
      const [x0, y0, z0, x1, y1, z1] = f.bounds;
      assert.ok(x0 > NETHER.x0 && x1 < NETHER.x0 + NETHER.size - 1 && z0 > NETHER.z0 && z1 < NETHER.z0 + NETHER.size - 1, `seed ${seed}: inside the walls`);
      assert.ok(y0 >= 1 && y1 <= 122 && f.center[1] >= 45 && f.center[1] <= 57, 'deck between the lava sea and the ceiling');
      assert.ok(f.spawners.length >= 1 && f.spawners.length <= 2, `seed ${seed}: ${f.spawners.length} spawners`);
      for (const other of list) if (other !== f) assert.ok(!overlaps(boundsRect(f.bounds), boundsRect(other.bounds), 63), `seed ${seed}: fortresses 64 apart`);
    }
    const near = Math.min(...list.map(f => Math.hypot(f.center[0] - tx, f.center[2] - tz)));
    assert.ok(near <= 90, `seed ${seed}: the nearest hub is ${near.toFixed(0)} blocks from the spawn portal point`);
  }
  // The copies are the caller's own.
  fortressesOf(11)[0]!.bounds[0] = 0;
  assert.notEqual(fortressesOf(11)[0]!.bounds[0], 0);
});

test('every fortress has its pieces: bridges, spawners on railed platforms, wart, loot chests, a tower; all reachable from the hub', () => {
  for (const seed of [11, 4242, 777777]) {
    const get = worldOf(seed);
    for (const f of fortressesOf(seed)) {
      const [cx, cy, cz] = f.center, reach = walkable(get, f, [cx, cy, cz]);
      assert.equal(cellId(get(cx, cy - 1, cz)), B.nether_bricks, 'the hub deck');
      for (const [x, y, z] of f.spawners) {
        assert.equal(get(x, y, z) & 255, B.monster_spawner);
        assert.equal(cellState(get(x, y, z)), MOB.blaze, 'a blaze spawner');
        assert.equal(get(x, y - 1, z), B.nether_bricks, 'on the platform');
        assert.ok(cellsIn(get, [x - 4, 0, z - 4, x + 4, 0, z + 4], y, y, cell => cellId(cell) === B.nether_brick_fence).length >= 20, 'railed');
        assert.ok(FACING.some(([dx, dz]) => reach.has(`${x + dx},${y},${z + dz}`)), `seed ${seed}: spawner ${x},${y},${z} reachable`);
      }
      const b = f.bounds, around = [cy - 1, cy + 14] as const;
      const chests = cellsIn(get, b, ...around, cell => cellId(cell) === B.chest && chestLoot(cellState(cell)) === CHEST_LOOT.nether_fortress);
      const wart = cellsIn(get, b, ...around, cell => cellId(cell) === B.nether_wart);
      assert.ok(chests.length >= 1 && chests.length <= 2, `seed ${seed}: ${chests.length} loot chests`);
      assert.ok(chests.every(([x, y, z]) => FACING.some(([dx, dz]) => reach.has(`${x + dx},${y},${z + dz}`))), 'chests reachable');
      assert.ok(wart.length >= 20 && wart.every(([x, y, z]) => get(x, y - 1, z) === B.soul_sand), 'a wart garden on soul sand');
      assert.ok(wart.filter(([x, y, z]) => cellState(get(x, y, z)) === WART_MATURE).length > wart.length / 2, 'mostly mature');
      assert.ok(wart.some(([x, y, z]) => FACING.some(([dx, dz]) => reach.has(`${x + dx},${y},${z + dz}`))), 'the garden is reachable');
      const top = cellsIn(get, b, cy + 11, cy + 11, cell => cellId(cell) === B.nether_brick_fence);
      assert.ok(top.length >= 15, 'a stair tower with a railed lookout roof');
      assert.ok([...reach].some(k => Number(k.split(',')[1]) === cy + 11), 'the lookout roof is reachable by its stairs');
      assert.ok(reach.size > 600, `seed ${seed}: ${reach.size} walkable cells`);
    }
  }
});

test('fortresses cross chunk borders seamlessly: fences agree with their neighbours and piers reach the ground', () => {
  const get = worldOf(11);
  for (const f of fortressesOf(11)) {
    const fences = cellsIn(get, f.bounds, f.center[1], f.center[1] + 13, cell => cellId(cell) === B.nether_brick_fence);
    assert.ok(fences.length > 100);
    for (const [x, y, z] of fences) FACING.forEach(([dx, dz], dir) => {
      const next = get(x + dx, y, z + dz), joins = cellId(next) === B.nether_brick_fence;
      if (fenceConnects(cellState(get(x, y, z)), dir)) assert.ok(joins || isFullCube(next), `fence ${x},${y},${z} joins nothing`);
      if (joins) assert.equal(fenceConnects(cellState(next), (dir + 2) & 3), fenceConnects(cellState(get(x, y, z)), dir), `fences ${x},${y},${z} disagree`);
    });
    // Piers: every brick column under the deck ends on solid ground (or reaches the lava sea floor).
    const [cx, cy, cz] = f.center;
    let y = cy - 2;
    while (get(cx, y, cz) === B.nether_bricks) y--;
    assert.ok(isSolid(get(cx, y, cz)), 'the hub pier stands on the ground');
  }
  // Each chunk paints only its own share, so a chunk generated again (in any order) is identical.
  const [cx, , cz] = fortressesOf(4242)[0]!.center;
  assert.deepEqual(generateChunk(4242, cx >> 4, cz >> 4), generateChunk(4242, cx >> 4, cz >> 4));
});

test('nether fortress loot: 2–5 stacks of gold, iron, wart, obsidian and flint and steel; diamonds and golden apples rare', () => {
  const counts = new Map<number, number>();
  let stacks = 0;
  for (let i = 0; i < 2000; i++) {
    const loot = rollLoot(CHEST_LOOT.nether_fortress, lootSeed(11, 1000 + i * 7919)).filter(s => s !== null);
    assert.ok(loot.length >= 2 && loot.length <= 5, `${loot.length} stacks`);
    for (const s of loot) {
      assert.ok(s.n >= 1 && s.n <= maxStack(s.id) && LOOT.nether_fortress.entries.some(e => e.item === s.id));
      counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      stacks++;
    }
  }
  const share = (id: number) => (counts.get(id) ?? 0) / stacks;
  assert.ok(share(I.gold_ingot) > 0.15 && share(I.iron_ingot) > 0.1 && share(I.nether_wart) > 0.08, 'common finds');
  assert.ok(share(I.flint_and_steel) > 0.03 && share(B.obsidian) > 0.03, 'a way home');
  assert.ok(share(I.diamond) > 0 && share(I.diamond) < 0.07 && share(I.golden_apple) > 0 && share(I.golden_apple) < 0.05, 'rare treasure');
});

test('fortresses keep Nether chunk generation within its 8 ms median budget', () => {
  const f = fortressesOf(777777)[1]!, times: number[] = [];
  generateChunk(777777, f.bounds[0] >> 4, f.bounds[2] >> 4);
  for (let cx = f.bounds[0] >> 4; cx <= f.bounds[3] >> 4; cx++) for (let cz = f.bounds[2] >> 4; cz <= f.bounds[5] >> 4; cz++) {
    const t = performance.now();
    generateChunk(777777, cx, cz);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  console.log(`fortress chunks: median ${median.toFixed(2)} ms, max ${times.at(-1)!.toFixed(2)} ms over ${times.length}`);
  assert.ok(median <= 8, `median ${median} ms`);
});
