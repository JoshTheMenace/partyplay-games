/** Nether terrain (DESIGN.md) and the overworld's lava, emeralds and deep-ocean corner. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { B, cellId, isFullCube } from '../src/shared/blocks';
import { VoxelWorld } from '../src/shared/chunk';
import { CHUNK, HEIGHT, NETHER, SEA_LEVEL } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { generateNetherChunk, isNetherChunk, LAVA_SEA } from '../src/shared/nether';
import { biomeAt, generateChunk, surfaceHeight } from '../src/shared/worldgen';

const SEED = 260923;
const CX = NETHER.x0 / CHUNK, WALL_Z = NETHER.z0 + NETHER.size - 1;
const idAt = (cells: Uint16Array, lx: number, y: number, lz: number) => cellId(cells[localIndex(lx, y, lz)]!);
/** Every chunk of a square of the region, as (cx, cz, cells). */
function* region(from: number, count: number) {
  for (let i = 0; i < count * count; i++) {
    const cx = CX + from + i % count, cz = from + Math.floor(i / count);
    yield [cx, cz, generateNetherChunk(SEED, cx, cz)] as const;
  }
}

test('nether.ts only uses engine-exact math', () => {
  const source = readFileSync(new URL('../src/shared/nether.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.(sin|cos|tan|atan2?|exp|pow|log\w*|random|hypot|cbrt|round|fround)\b/);
  assert.doesNotMatch(source, /[\w)\]] ?\*\* ?[\w(]/, 'uses **');
});

test('nether chunks are deterministic, seed-dependent and dispatched by generateChunk', () => {
  const coords = [[CX, 0], [CX + 7, 12], [CX + 31, 31], [CX + 15, 3]] as const;
  const first = coords.map(([cx, cz]) => generateNetherChunk(SEED, cx, cz));
  for (let i = 0; i < 12; i++) generateNetherChunk(SEED + i, CX + i, 9);
  coords.forEach(([cx, cz], i) => {
    assert.deepEqual(generateNetherChunk(SEED, cx, cz), first[i]);
    assert.deepEqual(generateChunk(SEED, cx, cz), first[i], 'generateChunk dispatches the region');
  });
  assert.notDeepEqual(generateNetherChunk(SEED + 1, CX + 7, 12), first[1]);
  assert.ok(isNetherChunk(CX, 31) && !isNetherChunk(CX - 1, 0) && !isNetherChunk(CX, 32));
});

test('the region is sealed: bedrock walls on its inside faces, a ragged floor and ceiling', () => {
  for (let i = 0; i < 32; i++) {
    const west = generateNetherChunk(SEED, CX, i), south = generateNetherChunk(SEED, CX + i, 31);
    for (let y = 0; y < HEIGHT; y++) for (let l = 0; l < CHUNK; l++) {
      assert.equal(idAt(west, 0, y, l), B.bedrock, `x = ${NETHER.x0} wall at y ${y}`);
      assert.equal(idAt(south, l, y, 15), B.bedrock, `z = ${WALL_Z} wall at y ${y}`);
    }
  }
  let raggedFloor = 0, raggedCeiling = 0;
  for (const [, , cells] of region(10, 3)) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    assert.equal(idAt(cells, lx, 0, lz), B.bedrock);
    assert.equal(idAt(cells, lx, 127, lz), B.bedrock);
    for (let y = 1; y <= 4; y++) if (idAt(cells, lx, y, lz) !== B.bedrock) { raggedFloor++; assert.equal(idAt(cells, lx, y, lz), B.netherrack); }
    for (let y = 123; y <= 126; y++) if (idAt(cells, lx, y, lz) !== B.bedrock) { raggedCeiling++; assert.equal(idAt(cells, lx, y, lz), B.netherrack); }
    for (let y = 5; y <= 122; y++) assert.notEqual(idAt(cells, lx, y, lz), B.bedrock, 'no bedrock inside the region');
  }
  assert.ok(raggedFloor > 500 && raggedCeiling > 500, 'floor and ceiling are ragged');
  assert.notEqual(idAt(generateChunk(SEED, CX - 1, 20), 15, 90, 7), B.bedrock, 'the overworld next door is not walled');
});

test('the Nether is varied: vast caverns, a lava sea, valleys, glowstone, ores, magma, fire and mushrooms', () => {
  const counts = new Map<number, number>();
  let cells = 0, openMid = 0, dryFloor = 0, seaTop = 0;
  for (const [, , chunk] of region(6, 8)) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    for (let y = 0; y < HEIGHT; y++) {
      const id = idAt(chunk, lx, y, lz);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      cells++;
      if (id === B.lava) assert.notEqual(idAt(chunk, lx, y - 1, lz), B.air, 'no lava hangs over air');
    }
    if (idAt(chunk, lx, 64, lz) === B.air) openMid++;
    if (idAt(chunk, lx, LAVA_SEA, lz) === B.lava && idAt(chunk, lx, LAVA_SEA + 1, lz) === B.air) seaTop++;
    for (let y = LAVA_SEA + 1; y < 60; y++) if (idAt(chunk, lx, y, lz) === B.air && isFullCube(chunk[localIndex(lx, y - 1, lz)]!)) { dryFloor++; break; }
  }
  const share = (id: number) => (counts.get(id) ?? 0) / cells, columns = 64 * 256;
  assert.ok(share(B.air) > 0.25 && share(B.netherrack) > 0.4, `air ${share(B.air)}, netherrack ${share(B.netherrack)}`);
  assert.ok(openMid / columns > 0.4, `caverns: ${openMid / columns} open at y 64`);
  assert.ok(seaTop / columns > 0.05 && dryFloor / columns > 0.3, `lava sea ${seaTop / columns}, dry floor ${dryFloor / columns}`);
  for (const id of [B.soul_sand, B.glowstone, B.nether_quartz_ore, B.nether_gold_ore, B.magma_block, B.fire, B.gravel, B.red_mushroom, B.brown_mushroom]) {
    assert.ok((counts.get(id) ?? 0) > 0, `no ${id}`);
  }
  assert.ok(share(B.nether_quartz_ore) > share(B.nether_gold_ore));
});

test('decorations sit where they belong: fire on netherrack, mushrooms on blocks, glowstone hangs connected', () => {
  let glow = 0;
  for (const [, , cells] of region(12, 4)) for (let y = 6; y < 122; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const id = idAt(cells, lx, y, lz), below = cells[localIndex(lx, y - 1, lz)]!;
    if (id === B.fire) assert.equal(cellId(below), B.netherrack, 'eternal fire only on netherrack');
    if (id === B.red_mushroom || id === B.brown_mushroom) assert.ok(isFullCube(below));
    if (id !== B.glowstone) continue;
    glow++;
    const around = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].filter(([dx, dy, dz]) => {
      const x = lx + dx!, z = lz + dz!;
      return x >= 0 && x < 16 && z >= 0 && z < 16 && idAt(cells, x, y + dy!, z) !== B.air;
    });
    assert.ok(around.length > 0, 'glowstone never floats');
  }
  assert.ok(glow > 50, `only ${glow} glowstone`);
});

test('generateNetherChunk stays within the 8 ms median budget', () => {
  for (let i = 0; i < 8; i++) generateNetherChunk(SEED, CX + i, 20);
  const times: number[] = [];
  for (let i = 0; i < 64; i++) {
    const start = performance.now();
    generateNetherChunk(SEED, CX + (i % 8) * 3 + 1, 1 + Math.floor(i / 8) * 3);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  console.log(`generateNetherChunk median ${median.toFixed(2)} ms, p90 ${times[Math.floor(times.length * 0.9)]!.toFixed(2)} ms`);
  assert.ok(median <= 8, `median ${median} ms`);
});

// Overworld -----------------------------------------------------------------------------------------------------------

test('the overworld around the Nether corner is deep ocean', () => {
  for (const seed of [SEED, 1, 777]) for (let d = 0; d <= 120; d += 8) for (let t = 0; t < 512; t += 32) {
    assert.ok(surfaceHeight(seed, NETHER.x0 - 1 - d, t) < SEA_LEVEL - 8, `seed ${seed}: land west of the wall at ${NETHER.x0 - 1 - d},${t}`);
    assert.ok(surfaceHeight(seed, NETHER.x0 + t, WALL_Z + 1 + d) < SEA_LEVEL - 8, `seed ${seed}: land south of the wall at ${NETHER.x0 + t},${WALL_Z + 1 + d}`);
  }
  assert.equal(biomeAt(SEED, NETHER.x0 - 40, 300), 'deep_ocean');
});

test('deep caves hold lava pools (and some water) that never spill into air', () => {
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz));
  let lava = 0, water = 0;
  for (let cz = 110; cz < 150; cz += 5) for (let cx = 110; cx < 150; cx += 5) {
    const cells = world.cache.get(cx, cz);
    for (let y = 1; y <= 10; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const id = idAt(cells, lx, y, lz);
      if (id === B.water) water++;
      if (id !== B.lava) continue;
      lava++;
      const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) assert.notEqual(cellId(world.getCell(x + dx!, y + dy!, z + dz!)), B.air, `lava at ${x},${y},${z} leaks`);
    }
  }
  assert.ok(lava > 2000 && lava > water, `lava ${lava}, water ${water}`);
});

test('emerald ore appears only in mountain stone between y 5 and 100; lava lakes are sealed basins', () => {
  let emeralds = 0, lakes = 0;
  for (let cz = 40; cz < 216; cz += 5) for (let cx = 40; cx < 216; cx += 5) {
    const cells = generateChunk(SEED, cx, cz);
    let lake = false;
    for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const id = idAt(cells, lx, y, lz), x = cx * CHUNK + lx, z = cz * CHUNK + lz;
      if (id === B.emerald_ore) {
        emeralds++;
        assert.ok(y >= 5 && y <= 100 && ['mountains', 'snowy_peaks'].includes(biomeAt(SEED, x, z)), `emerald at ${x},${y},${z}`);
      }
      if (id !== B.lava || y <= 20) continue;
      lake = true;
      // Lakes lie inside their chunk.
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const next = idAt(cells, lx + dx!, y + dy!, lz + dz!);
        assert.ok(next !== B.air && next !== B.water, `lake at ${x},${y},${z} leaks`);
      }
    }
    if (lake) lakes++;
  }
  assert.ok(emeralds > 20, `only ${emeralds} emeralds`);
  assert.ok(lakes > 0, 'no lava lake');
});
