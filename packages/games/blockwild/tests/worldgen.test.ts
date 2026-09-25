import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { B, cellId, isSolid } from '../src/shared/blocks';
import { VoxelWorld } from '../src/shared/chunk';
import { CHUNK, HEIGHT, SEA_LEVEL, SPAWN_X, SPAWN_Z } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { createRng } from '../src/shared/noise';
import { growTree, saplingTree, TREE_RADIUS, treeCanReplace, type TreeKind } from '../src/shared/trees';
import { BIOME_NAMES, biomeAt, findSpawn, generateChunk, surfaceHeight, treesNear } from '../src/shared/worldgen';

const SEED = 260923;
const SC = SPAWN_X >> 4, SZ = SPAWN_Z >> 4;
const TREE_BLOCKS = new Set<number>([B.oak_log, B.oak_leaves, B.birch_log, B.birch_leaves, B.spruce_log, B.spruce_leaves]);
const idAt = (cells: Uint16Array, lx: number, y: number, lz: number) => cellId(cells[localIndex(lx, y, lz)]!);

test('worldgen only uses engine-exact math', () => {
  for (const file of ['noise', 'worldgen', 'trees']) {
    const source = readFileSync(new URL(`../src/shared/${file}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Math\.(sin|cos|tan|atan2?|exp|pow|log\w*|random|hypot|cbrt|round|fround)\b/, file);
    assert.doesNotMatch(source, /[\w)\]] ?\*\* ?[\w(]/, `${file} uses **`);
  }
});

test('generation is deterministic and seed-dependent', () => {
  const coords = [[SC, SZ], [SC + 3, SZ - 2], [SC - 20, SZ + 17], [0, 0], [255, 255]] as const;
  const first = coords.map(([cx, cz]) => generateChunk(SEED, cx, cz));
  for (let i = 0; i < 40; i++) generateChunk(SEED, SC + 40 + i, SZ - 40); // churn the internal caches
  generateChunk(4242, SC, SZ);
  coords.slice().reverse().forEach(([cx, cz], i) => assert.deepEqual(generateChunk(SEED, cx, cz), first[coords.length - 1 - i], `chunk ${cx},${cz}`));
  assert.notDeepEqual(generateChunk(SEED + 1, SC, SZ), first[0]);
  assert.equal(surfaceHeight(SEED, 2100, 1990), surfaceHeight(SEED, 2100, 1990));
});

test('bedrock floor is solid at y=0 and ragged only up to y=3', () => {
  for (const [cx, cz] of [[SC, SZ], [SC + 7, SZ + 9], [10, 200]]) {
    const cells = generateChunk(SEED, cx!, cz!);
    let ragged = 0;
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      assert.equal(idAt(cells, lx, 0, lz), B.bedrock);
      for (let y = 1; y < HEIGHT; y++) {
        if (idAt(cells, lx, y, lz) !== B.bedrock) continue;
        assert(y <= 3, `bedrock at y=${y}`);
        ragged++;
      }
    }
    assert(ragged > 100 && ragged < 3 * 256, `ragged layer ${ragged}`);
  }
});

test('biomes vary across a 2048 × 2048 sample around spawn', () => {
  const seen = new Map<string, number>();
  for (let z = SPAWN_Z - 1024; z < SPAWN_Z + 1024; z += 16) for (let x = SPAWN_X - 1024; x < SPAWN_X + 1024; x += 16) {
    const biome = biomeAt(SEED, x, z);
    seen.set(biome, (seen.get(biome) ?? 0) + 1);
  }
  for (const biome of BIOME_NAMES) assert(seen.has(biome), `missing ${biome}`);
  const total = 128 * 128, largest = Math.max(...seen.values());
  assert(largest / total < 0.35, `one biome dominates: ${largest / total}`);
});

test('ores respect their depth ranges', () => {
  const ranges = new Map<number, number[]>([[B.coal_ore, [5, 110]], [B.iron_ore, [5, 64]], [B.gold_ore, [5, 32]], [B.diamond_ore, [5, 16]]]);
  const found = new Map<number, number>();
  for (let i = 0; i < 64; i++) {
    const cells = generateChunk(SEED, SC - 8 + (i & 7), SZ - 8 + (i >> 3));
    for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const id = idAt(cells, lx, y, lz), range = ranges.get(id);
      if (!range) continue;
      assert(y >= range[0]! && y <= range[1]!, `ore ${id} at y=${y}`);
      found.set(id, (found.get(id) ?? 0) + 1);
    }
  }
  for (const id of ranges.keys()) assert((found.get(id) ?? 0) > 0, `no ore ${id}`);
  assert(found.get(B.coal_ore)! > found.get(B.iron_ore)! && found.get(B.iron_ore)! > found.get(B.diamond_ore)!);
});

test('trees stand on the ground and are identical from both sides of a chunk border', () => {
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz));
  let crossing = 0, checked = 0, foreign = 0, exact = 0;
  for (let cz = SZ - 6; cz <= SZ + 6; cz++) for (let cx = SC - 6; cx <= SC + 6; cx++) {
    for (const tree of treesNear(SEED, cx, cz)) {
      if (tree.x >> 4 !== cx || tree.z >> 4 !== cz) continue; // each root once
      checked++;
      assert(isSolid(world.getCell(tree.x, tree.y - 1, tree.z)), `floating ${tree.kind} at ${tree.x},${tree.y},${tree.z}`);
      const cells: [number, number, number, number][] = [];
      growTree(tree.kind, tree.x, tree.y, tree.z, createRng(tree.seed), (x, y, z, cell) => cells.push([x, y, z, cell]));
      const other = cells.filter(([x, , z]) => x >> 4 !== cx || z >> 4 !== cz);
      if (other.length) crossing++;
      // Canopy cells in neighbouring chunks exist there: this tree's block, an overlapping tree's, or terrain.
      for (const [x, y, z, cell] of other) {
        const got = world.getCell(x, y, z);
        assert(got === cell || TREE_BLOCKS.has(cellId(got)) || isSolid(got), `hole in ${tree.kind} canopy at ${x},${y},${z}`);
        foreign++;
        if (got === cell) exact++;
      }
    }
  }
  assert(checked > 100, `only ${checked} trees near spawn`);
  assert(crossing >= 20, `only ${crossing} border-crossing trees`);
  assert(exact / foreign > 0.8, `only ${exact}/${foreign} border cells match exactly`);
});

test('water never touches cave air (no floating water walls)', () => {
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz));
  let water = 0;
  for (let cz = SZ - 20; cz < SZ + 20; cz += 5) for (let cx = SC - 20; cx < SC + 20; cx += 5) {
    const cells = world.cache.get(cx, cz);
    for (let y = 1; y <= SEA_LEVEL; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      if (idAt(cells, lx, y, lz) !== B.water) continue;
      water++;
      const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        assert.notEqual(cellId(world.getCell(x + dx!, y + dy!, z + dz!)), B.air, `water at ${x},${y},${z} leaks`);
      }
    }
  }
  assert(water > 1000);
});

test('spawn is on dry, open land near the world centre', () => {
  for (const seed of [SEED, 1, 777, 424242, 999999]) {
    const [x, y, z] = findSpawn(seed), cells = generateChunk(seed, x >> 4, z >> 4);
    const at = (dy: number) => idAt(cells, x & 15, y + dy, z & 15);
    assert(y > SEA_LEVEL + 1, `seed ${seed}: spawn y ${y}`);
    assert([B.grass_block, B.sand, B.snowy_grass].includes(at(-1) as never), `seed ${seed}: ground ${at(-1)}`);
    assert(!isSolid(at(0)) && at(0) !== B.water && at(1) === B.air, `seed ${seed}: blocked spawn`);
    assert(Math.abs(x - SPAWN_X) < 700 && Math.abs(z - SPAWN_Z) < 700, `seed ${seed}: far spawn ${x},${z}`);
  }
});

test('random-world spawns have wood nearby and no water or cactus within 3 blocks', () => {
  const rng = createRng(20260923);
  for (let i = 0; i < 20; i++) {
    const seed = 1 + Math.floor(rng() * 999999), [x, y, z] = findSpawn(seed), chunks = new Map<number, Uint16Array>();
    const at = (wx: number, wy: number, wz: number) => {
      const key = (wx >> 4) * 256 + (wz >> 4);
      if (!chunks.has(key)) chunks.set(key, generateChunk(seed, wx >> 4, wz >> 4));
      return idAt(chunks.get(key)!, wx & 15, wy, wz & 15);
    };
    let wood = false;
    for (let dz = -24; dz <= 24 && !wood; dz++) for (let dx = -24; dx <= 24 && !wood; dx++) {
      if (dx * dx + dz * dz > 576) continue;
      for (let dy = -8; dy <= 12 && !wood; dy++) wood = [B.oak_log, B.birch_log, B.spruce_log].includes(at(x + dx, y + dy, z + dz) as never);
    }
    assert(wood, `seed ${seed}: no tree within 24 blocks of ${x},${y},${z}`);
    for (let dy = -2; dy <= 1; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      assert(![B.water, B.cactus].includes(at(x + dx, y + dy, z + dz) as never), `seed ${seed}: hazard beside spawn`);
    }
  }
});

test('surfaceHeight matches generated terrain', () => {
  const cells = generateChunk(SEED, SC, SZ);
  let intact = 0;
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const h = surfaceHeight(SEED, SC * CHUNK + lx, SZ * CHUNK + lz), top = idAt(cells, lx, h, lz), above = idAt(cells, lx, h + 1, lz);
    assert(![B.stone, B.dirt, B.sand, B.grass_block, B.snowy_grass, B.gravel, B.snow_block].includes(above as never), `terrain above surface at ${lx},${lz}`);
    if (top !== B.air) intact++;
  }
  assert(intact > 240);
});

test('trees grow deterministically and saplings pick matching kinds', () => {
  const kinds: TreeKind[] = ['oak', 'fancy_oak', 'birch', 'tall_birch', 'spruce', 'pine', 'bush'];
  for (const kind of kinds) {
    const a: number[][] = [], b: number[][] = [];
    growTree(kind, 100, 70, 100, createRng(9), (...c) => a.push(c));
    growTree(kind, 100, 70, 100, createRng(9), (...c) => b.push(c));
    assert.deepEqual(a, b);
    assert(a.some(c => [B.oak_log, B.birch_log, B.spruce_log].includes(cellId(c[3]!) as never)), `${kind} has no log`);
    assert(a.filter(c => [B.oak_leaves, B.birch_leaves, B.spruce_leaves].includes(cellId(c[3]!) as never)).length > 10, `${kind} is bald`);
    let reach = 0;
    for (let s = 0; s < 500; s++) growTree(kind, 0, 70, 0, createRng(s), (x, _y, z) => { reach = Math.max(reach, Math.abs(x), Math.abs(z)); });
    assert(reach <= TREE_RADIUS, `${kind} reaches ${reach}, beyond TREE_RADIUS`);
  }
  const rng = createRng(1);
  assert(['spruce', 'pine'].includes(saplingTree(B.spruce_sapling, rng)));
  assert(['birch', 'tall_birch'].includes(saplingTree(B.birch_sapling, rng)));
  assert(treeCanReplace(B.oak_sapling, B.oak_log) && treeCanReplace(B.air, B.oak_leaves) && treeCanReplace(B.oak_leaves, B.oak_log));
  assert(!treeCanReplace(B.stone, B.oak_log) && !treeCanReplace(B.water, B.oak_leaves) && !treeCanReplace(B.oak_log, B.oak_leaves));
});

test('generateChunk stays within the 6 ms median budget', () => {
  for (let i = 0; i < 10; i++) generateChunk(SEED, SC + 100 + i, SZ + 100);
  const times: number[] = [];
  for (let i = 0; i < 80; i++) {
    const start = performance.now();
    generateChunk(SEED, SC - 60 + (i % 10) * 3, SZ + 60 + Math.floor(i / 10) * 3);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  console.log(`generateChunk median ${median.toFixed(2)} ms, p90 ${times[Math.floor(times.length * 0.9)]!.toFixed(2)} ms`);
  assert(median <= 6, `median ${median} ms`);
});
