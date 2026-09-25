/** Structures (DESIGN.md): placement, seamless painting, villages, temples, mineshafts, dungeons, loot and spawners. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { B, BED_HEAD, blockOf, cellId, cellState, CHEST_LOOT, chestLoot, DOOR_UPPER, isSolid, makeCell } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { CHEST_SIZE, NETHER, WORLD } from '../src/shared/constants';
import { cellIndex, cellXYZ, localIndex } from '../src/shared/coords';
import { maxStack } from '../src/shared/items';
import { LOOT, lootName, lootSeed, rollLoot, type LootName } from '../src/shared/loot';
import { IF, MOB, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { plannedCells, structuresNear, villagesNear, type StructureInfo } from '../src/shared/structures/index';
import { createRng } from '../src/shared/noise';
import { generateChunk, growTree, treesNear, type TreeSpot } from '../src/shared/worldgen';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import type { State } from '../src/sim/state';
import { openLootChest } from '../src/sim/structures';
import { blockLight, breakBlock, writeCell } from '../src/sim/world';

const SEEDS = [260923, 11, 4242];
const SEED = 11;

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
const all = (seed: number) => structuresNear(seed, WORLD / 2, WORLD / 2, WORLD / 2);
const nearest = (seed: number, kind: StructureInfo['kind']) =>
  all(seed).filter(s => s.kind === kind).sort((a, b) => Math.hypot(a.center[0] - 2048, a.center[2] - 2048) - Math.hypot(b.center[0] - 2048, b.center[2] - 2048))[0]!;
const inside = (b: readonly number[], x: number, y: number, z: number) => x >= b[0]! && x <= b[3]! && y >= b[1]! && y <= b[4]! && z >= b[2]! && z <= b[5]!;
const cellsIn = (get: ReturnType<typeof worldOf>, b: readonly number[], test: (cell: number) => boolean) => {
  const found: [number, number, number][] = [];
  for (let y = b[1]!; y <= b[4]!; y++) for (let z = b[2]!; z <= b[5]!; z++) for (let x = b[0]!; x <= b[3]!; x++) if (test(get(x, y, z))) found.push([x, y, z]);
  return found;
};

// Pure worldgen ------------------------------------------------------------------------------------------------------

test('structures only use engine-exact math', () => {
  const dir = new URL('../src/shared/structures/', import.meta.url);
  const files = [...readdirSync(dir).map(name => new URL(name, dir)), new URL('../src/shared/loot.ts', import.meta.url)];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /Math\.(sin|cos|tan|atan2?|exp|pow|log\w*|random|hypot|cbrt|round|fround)\b/, file.pathname);
    assert.doesNotMatch(source, /[\w)\]] ?\*\* ?[\w(]/, `${file.pathname} uses **`);
    assert.doesNotMatch(source, /\.sort\(\s*\(\)\s*=>/, `${file.pathname} sorts with a random comparator`);
  }
});

test('any structures module can load first without tripping the import cycle with worldgen', () => {
  const dir = new URL('../src/shared/structures/', import.meta.url), index = new URL('index.ts', dir).href;
  for (const name of readdirSync(dir)) {
    const script = `await import(${JSON.stringify(new URL(name, dir).href)}); const s = await import(${JSON.stringify(index)}); s.structuresNear(11, 2048, 2048, 64);`;
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: 'pipe' });
  }
});

test('structure placement is deterministic and seed-dependent', () => {
  const first = all(SEED);
  for (const seed of [1, 2, 3, 4, 5]) all(seed); // churn the per-seed caches
  assert.deepEqual(all(SEED), first);
  assert.notDeepEqual(all(SEED + 1), first);
  const chunk = nearest(SEED, 'village').center;
  assert.deepEqual(generateChunk(SEED, chunk[0] >> 4, chunk[2] >> 4), generateChunk(SEED, chunk[0] >> 4, chunk[2] >> 4));
});

test('every seed gets villages and mineshafts at sane rates, clear of the rim, the Nether and each other', () => {
  let temples = 0;
  for (const seed of SEEDS) {
    const list = all(seed), count = (kind: string) => list.filter(s => s.kind === kind).length;
    assert(count('village') >= 8 && count('village') <= 64, `seed ${seed}: ${count('village')} villages`);
    // About one mineshaft per 250 chunks of land (the world has 65536 chunks, a third of them ocean).
    assert(count('mineshaft') >= 120 && count('mineshaft') <= 400, `seed ${seed}: ${count('mineshaft')} mineshafts`);
    temples += count('desert_temple');
    for (const s of list) {
      const [x0, , z0, x1, , z1] = s.bounds;
      assert(x0 >= 16 && z0 >= 16 && x1 < WORLD - 16 && z1 < WORLD - 16, `${s.kind} at the rim`);
      assert(!(x1 >= NETHER.x0 && z0 < NETHER.z0 + NETHER.size), `${s.kind} in the Nether`);
      assert(inside(s.bounds, s.center[0], s.center[1], s.center[2]), `${s.kind} centre outside its bounds`);
    }
    const surface = list.filter(s => s.kind !== 'mineshaft');
    for (const a of surface) for (const b of surface) if (a !== b) {
      assert(a.bounds[0] > b.bounds[3] || b.bounds[0] > a.bounds[3] || a.bounds[2] > b.bounds[5] || b.bounds[2] > a.bounds[5], `${a.kind} overlaps ${b.kind}`);
    }
  }
  assert(temples >= 3, `only ${temples} desert temples over ${SEEDS.length} seeds`);
});

test('structures cross chunk borders seamlessly: every planned cell is in the generated world', () => {
  for (const kind of ['village', 'desert_temple', 'mineshaft'] as const) {
    const info = nearest(SEED, kind), get = worldOf(SEED), planned = plannedCells(SEED, info);
    const chunks = new Set([...planned.keys()].map(i => { const [x, , z] = cellXYZ(i); return (x >> 4) * 4096 + (z >> 4); }));
    assert(chunks.size >= 4, `${kind} spans ${chunks.size} chunks`);
    let wrong = 0;
    for (const [index, cell] of planned) {
      const [x, y, z] = cellXYZ(index);
      const actual = get(x, y, z);
      if (cell === B.oak_fence ? cellId(actual) !== B.oak_fence : actual !== cell) wrong++;
    }
    // Surface structures paint last and match exactly; a mineshaft may lose a few cells to a village or temple above it.
    assert(kind === 'mineshaft' ? wrong <= planned.size * 0.01 : wrong === 0, `${kind}: ${wrong} of ${planned.size} planned cells differ`);
  }
});

test('villages: levelled buildings with doors and beds, lamp posts, farms and paths', () => {
  const info = nearest(SEED, 'village'), get = worldOf(SEED), [cx, , cz] = info.center;
  const village = villagesNear(SEED, cx >> 4, cz >> 4)[0]!;
  assert.deepEqual(village.center, info.center);
  assert(village.houses.length >= 3, `${village.houses.length} beds`);
  for (const { bed: [x, y, z], bounds } of village.houses) {
    assert(inside(bounds, x, y, z), 'bed outside its house');
    const foot = get(x, y, z);
    assert.equal(cellId(foot), B.bed);
    assert.equal(cellState(foot) & BED_HEAD, 0, 'bed cell is the foot');
    assert(isSolid(get(x, y - 1, z)), 'bed on a floor');
    // The house is levelled: its floor has a foundation under it and nothing but the house above it.
    const [x0, fy, z0, x1, , z1] = bounds;
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      assert(isSolid(get(bx, fy, bz)) || cellId(get(bx, fy, bz)) === B.water, `hole in the floor at ${bx},${fy},${bz}`);
      assert(isSolid(get(bx, fy - 1, bz)), `floating floor at ${bx},${fy},${bz}`);
      for (let by = fy + 1; by <= fy + 12; by++) assert(![B.oak_leaves, B.spruce_leaves, B.birch_leaves].includes(cellId(get(bx, by, bz)) as never), 'leaves in a house');
    }
  }
  const doors = cellsIn(get, info.bounds, cell => cellId(cell) === B.oak_door && !(cellState(cell) & DOOR_UPPER));
  assert(doors.length >= 4, `${doors.length} doors`);
  for (const [x, y, z] of doors) assert.equal(cellId(get(x, y + 1, z)), B.oak_door);
  const count = (id: number) => cellsIn(get, info.bounds, cell => cellId(cell) === id).length;
  assert(count(B.dirt_path) > 100, 'paths');
  assert(count(B.wheat) + count(B.carrots) + count(B.potatoes) >= 20, 'farms');
  assert(cellsIn(get, info.bounds, cell => cellId(cell) === B.wheat || cellId(cell) === B.carrots || cellId(cell) === B.potatoes).every(([x, y, z]) => cellId(get(x, y - 1, z)) === B.farmland));
  assert(count(B.oak_fence) >= 8, 'lamp posts and the well');
  assert.equal(count(B.cactus), 0, 'cacti cleared');
  assert(count(B.chest) >= 1 && cellsIn(get, info.bounds, cell => cellId(cell) === B.chest).every(([x, y, z]) => chestLoot(cellState(get(x, y, z))) > 0));
});

test('trees rooted in surface structures are removed whole, even where their canopy crosses into a chunk the structure misses', () => {
  const get = worldOf(SEED), surface = all(SEED).filter(s => s.kind !== 'mineshaft' && Math.hypot(s.center[0] - 2048, s.center[2] - 2048) < 1400);
  let checked = 0;
  for (const info of surface) {
    const [x0, , z0, x1, , z1] = info.bounds, erased = new Map<string, TreeSpot>();
    for (let cz = (z0 >> 4) - 1; cz <= (z1 >> 4) + 1; cz++) for (let cx = (x0 >> 4) - 1; cx <= (x1 >> 4) + 1; cx++) for (const tree of treesNear(SEED, cx, cz)) {
      if (tree.x >= x0 - 1 && tree.x <= x1 + 1 && tree.z >= z0 - 1 && tree.z <= z1 + 1) erased.set(`${tree.x},${tree.z}`, tree);
    }
    for (const tree of erased.values()) growTree(tree.kind, tree.x, tree.y, tree.z, createRng(tree.seed), (x, y, z, cell) => {
      checked++;
      // Village pillars reuse logs, so only leaves are checked.
      if (blockOf(cell).name.endsWith('_leaves')) assert.notEqual(get(x, y, z), cell, `${info.kind} left a leaf of the tree at ${tree.x},${tree.z}`);
    });
  }
  assert(checked > 5000, `${checked} tree cells checked`);
});

test('desert temple: towers, four loot chests and the pressure-plate TNT trap wired for the redstone model', () => {
  const info = nearest(SEED, 'desert_temple'), get = worldOf(SEED);
  const plates = cellsIn(get, info.bounds, cell => cellId(cell) === B.stone_pressure_plate);
  assert.equal(plates.length, 1);
  const [x, y, z] = plates[0]!;
  // Plate → the sturdy block it sits on (strongly powered when pressed) → TNT touching that block, and 8 more around it.
  assert.equal(cellId(get(x, y - 1, z)), B.sandstone);
  assert.equal(cellId(get(x, y - 2, z)), B.tnt);
  assert.equal(cellsIn(get, [x - 1, y - 2, z - 1, x + 1, y - 2, z + 1], cell => cellId(cell) === B.tnt).length, 9);
  // The shaft from the hall floor drops straight onto the plate.
  let top = y + 1;
  while (get(x, top, z) === B.air) top++;
  assert(top - y >= 10, `shaft only ${top - y} tall`);
  assert.equal(cellId(get(x, top, z)), B.terracotta);
  const chests = cellsIn(get, info.bounds, cell => cellId(cell) === B.chest);
  assert.equal(chests.length, 4);
  for (const [cx, cy, cz] of chests) assert.equal(chestLoot(cellState(get(cx, cy, cz))), CHEST_LOOT.desert_temple);
  assert(cellsIn(get, info.bounds, cell => cellId(cell) === B.terracotta).length >= 30, 'terracotta patterns');
  assert(cellsIn(get, info.bounds, cell => cellId(cell) === B.sandstone_stairs).length >= 16, 'tower crowns');
  // Every doorway in the hall's outer wall (10 blocks from its centre) opens onto a landing level with its threshold.
  const [hx, hy, hz] = info.center, open = (x: number, z: number) => get(x, hy, z) === B.air && get(x, hy + 1, z) === B.air;
  let doors = 0;
  for (let d = -9; d <= 9; d++) for (const [dx, dz] of [[d, -10], [d, 10], [-10, d], [10, d]] as const) {
    if (!open(hx + dx, hz + dz)) continue;
    const ox = hx + dx + (Math.abs(dx) === 10 ? Math.sign(dx) : 0), oz = hz + dz + (Math.abs(dz) === 10 ? Math.sign(dz) : 0);
    assert(open(ox, oz) && isSolid(get(ox, hy - 1, oz)), `landing outside the doorway at ${hx + dx},${hz + dz}`);
    doors++;
  }
  assert.equal(doors, 5, 'a 3-wide entrance and two side doors');
});

test('mineshaft: corridors with supports, plank floors over caves, cobwebs and chests, all underground', () => {
  const info = nearest(SEED, 'mineshaft'), get = worldOf(SEED), planned = plannedCells(SEED, info);
  let beams = 0, webs = 0, chests = 0, air = 0;
  const fences = cellsIn(get, info.bounds, cell => cellId(cell) === B.oak_fence).length;
  for (const [index, cell] of planned) {
    const [, y] = cellXYZ(index), id = cellId(cell);
    if (id === B.oak_planks) beams++;
    if (id === B.cobweb) webs++;
    if (id === B.air) air++;
    if (id === B.chest) { chests++; assert.equal(chestLoot(cellState(cell)), CHEST_LOOT.mineshaft); }
    assert(y >= 8 && y <= 60, `mineshaft cell at y ${y}`);
  }
  assert(air > 1500, `${air} carved cells`);
  assert(beams > 40 && fences > 20, `beams ${beams}, fences ${fences}`);
  assert(webs > 5, `${webs} cobwebs`);
  // Over several mineshafts, chests show up regularly.
  const total = all(SEED).filter(s => s.kind === 'mineshaft').slice(0, 20).reduce((sum, s) => sum + [...plannedCells(SEED, s).values()].filter(c => cellId(c) === B.chest).length, 0);
  assert(chests + total >= 10, `${total} chests in 20 mineshafts`);
});

test('dungeons: about one chunk in twenty keeps one, always touching a cave, with a spawner and loot', () => {
  let rooms = 0, chests = 0;
  const seen: number[] = [];
  for (let i = 0; i < 400; i++) {
    const cx = 100 + (i % 20), cz = 100 + Math.floor(i / 20), cells = generateChunk(SEED, cx, cz);
    for (let at = 0; at < CHUNK_CELLS; at++) {
      if ((cells[at]! & 255) !== B.monster_spawner) continue;
      const lx = at & 15, lz = at >> 4 & 15, y = at >> 8, below = cells[localIndex(lx, y - 1, lz)]! & 255;
      if (below !== B.cobblestone && below !== B.mossy_cobblestone) continue;
      rooms++;
      seen.push(cellState(cells[at]!));
      // The room: air around the spawner, and chests with dungeon loot.
      assert.equal(cells[localIndex(lx, y + 1, lz)], B.air);
      for (let c = 0; c < CHUNK_CELLS; c++) if ((cells[c]! & 255) === B.chest && chestLoot(cells[c]! >> 8) === CHEST_LOOT.dungeon) chests++;
    }
  }
  assert(rooms >= 8 && rooms <= 60, `${rooms} dungeons in 400 chunks`);
  assert(chests >= rooms, `${chests} chests for ${rooms} dungeons`);
  assert(seen.every(t => [MOB.zombie, MOB.skeleton, MOB.spider].includes(t)), `spawner mobs ${seen}`);
});

test('generateChunk stays within its 6 ms median inside structures', () => {
  const chunks: [number, number][] = [];
  for (const kind of ['village', 'desert_temple', 'mineshaft'] as const) {
    const [x0, , z0, x1, , z1] = nearest(SEED, kind).bounds;
    for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) chunks.push([cx, cz]);
  }
  for (const [cx, cz] of chunks.slice(0, 10)) generateChunk(SEED, cx, cz);
  const times = chunks.map(([cx, cz]) => {
    const start = performance.now();
    generateChunk(SEED, cx, cz);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  console.log(`structure chunks: median ${median.toFixed(2)} ms over ${times.length}`);
  assert(median <= 6, `median ${median} ms`);
});

// Loot ---------------------------------------------------------------------------------------------------------------

test('loot rolls are deterministic, within their tables and scattered through the chest', () => {
  for (const name of Object.keys(LOOT) as LootName[]) {
    assert.equal(lootName(CHEST_LOOT[name]), name);
    const table = LOOT[name], items = new Set(table.entries.map(e => e.item));
    let differs = 0;
    for (let s = 0; s < 50; s++) {
      const seed = lootSeed(SEED, 1000 + s), slots = rollLoot(name, seed);
      assert.equal(slots.length, CHEST_SIZE);
      assert.deepEqual(rollLoot(name, seed), slots);
      assert.deepEqual(rollLoot(CHEST_LOOT[name], seed), slots);
      const stacks = slots.filter(slot => slot !== null);
      assert(stacks.length >= 1 && stacks.length <= table.rolls[1], `${name}: ${stacks.length} stacks`);
      for (const stack of stacks) assert(items.has(stack.id) && stack.n >= 1 && stack.n <= maxStack(stack.id), `${name}: ${JSON.stringify(stack)}`);
      if (JSON.stringify(slots) !== JSON.stringify(rollLoot(name, lootSeed(SEED, 2000 + s)))) differs++;
    }
    assert(differs > 45, `${name} rolls barely vary`);
  }
  assert.equal(lootName(0), undefined);
  assert(rollLoot(0, 1).every(slot => slot === null));
});

// Server ---------------------------------------------------------------------------------------------------------------

const X = 2048, Z = 2048, SAND_SEED = 11;
function flatWith(extra: Record<string, number>): ChunkSource {
  const base = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) base[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return (cx, cz) => {
    const chunk = base.slice();
    for (const [key, cell] of Object.entries(extra)) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      if (x >> 4 === cx && z >> 4 === cz) chunk[localIndex(x & 15, y, z & 15)] = cell;
    }
    return chunk;
  };
}
function game(extra: Record<string, number>, difficulty: 'normal' | 'peaceful' = 'normal'): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: SAND_SEED, difficulty }), { source: flatWith(extra), spawn: [X, 64, Z] });
  state.players[0]!.protectedUntil = 0;
  return state;
}
const hold = (state: State, cmds: CmdBody[]): Input => {
  const p = state.players[0]!;
  return { p: [p.x, p.y, p.z], v: [0, 0, 0], yaw: p.yaw, pitch: p.pitch, f: IF.ON_GROUND, slot: p.slot, mine: null, tpAck: p.tp.n, cmds: cmds.map((c, i) => ({ n: p.ack + 1 + i, ...c }) as Input['cmds'][number]) };
};
const send = (state: State, cmds: CmdBody[] = []) => tickState(state, new Map([['p0', hold(state, cmds)]]), 0.05);
const LOOT_CHEST = makeCell(B.chest, 2 | CHEST_LOOT.dungeon << 2);

test('a loot chest rolls once, on first open, and remembers what was taken', () => {
  const state = game({ [`${X + 2},64,${Z}`]: LOOT_CHEST }), index = cellIndex(X + 2, 64, Z);
  send(state);
  send(state, [{ t: 'use', x: X + 2, y: 64, z: Z, face: 3 }]);
  assert.equal(state.players[0]!.screen?.kind, 'chest');
  assert.equal(state.get(X + 2, 64, Z), makeCell(B.chest, 2), 'loot bits cleared, facing kept');
  assert.equal(state.world.edits.get(index), makeCell(B.chest, 2), 'the clear is a saved edit');
  assert.deepEqual(state.chests.get(index), rollLoot('dungeon', lootSeed(SAND_SEED, index)));
  state.chests.get(index)!.fill(null);
  send(state, [{ t: 'close' }, { t: 'use', x: X + 2, y: 64, z: Z, face: 3 }]);
  assert(state.chests.get(index)!.every(slot => slot === null), 'never rolled twice');
});

test('breaking a sealed loot chest spills its loot; past the chest cap loot spills on top instead', () => {
  const state = game({ [`${X + 2},64,${Z}`]: LOOT_CHEST, [`${X - 2},64,${Z}`]: LOOT_CHEST });
  send(state);
  const expected = rollLoot('dungeon', lootSeed(SAND_SEED, cellIndex(X + 2, 64, Z))).filter(Boolean).length;
  breakBlock(state, X + 2, 64, Z, []);
  assert.equal(state.items.length, expected);
  assert.equal(state.get(X + 2, 64, Z), B.air);
  state.items = [];
  for (let i = 0; i < 64; i++) state.chests.set(i, []);
  openLootChest(state, X - 2, 64, Z);
  assert.equal(state.chests.size, 64);
  assert.equal(state.items.length, rollLoot('dungeon', lootSeed(SAND_SEED, cellIndex(X - 2, 64, Z))).filter(Boolean).length);
  assert.equal(chestLoot(cellState(state.get(X - 2, 64, Z))), 0);
});

test('spawners: wake near a player, spawn 1–4 of their mob within 4 blocks, hold off at 6, stop when broken', () => {
  const at = `${X + 3},64,${Z}`, state = game({ [at]: makeCell(B.monster_spawner, MOB.skeleton) }), index = cellIndex(X + 3, 64, Z);
  send(state);
  assert(state.structures.spawners.has(index), 'registered as its chunk generated');
  const skeletons = () => state.mobs.filter(m => m.t === MOB.skeleton);
  for (let i = 0; i < 40 && !skeletons().length; i++) send(state);
  const first = skeletons();
  assert(first.length >= 1 && first.length <= 4, `${first.length} skeletons`);
  for (const mob of first) assert(Math.abs(mob.x - (X + 3.5)) <= 4.5 && Math.abs(mob.z - (Z + 0.5)) <= 4.5 && mob.y === 64);
  assert(state.fx.some(entry => entry.fx.k === 'spawner'));
  assert(state.structures.spawners.get(index)! >= state.clock + 9, 'next attempt after 10–40 s');

  // Crowded: six skeletons nearby keep it from adding more.
  state.mobs = Array.from({ length: 6 }, () => newMob(state, MOB.skeleton, X + 1.5, 64, Z + 1.5));
  state.structures.spawners.set(index, state.clock);
  send(state);
  assert.equal(skeletons().length, 6);

  // Nobody near: it stays asleep and checks again shortly.
  state.mobs = state.mobs.filter(m => m.t !== MOB.skeleton);
  Object.assign(state.players[0]!, { x: X + 40, tp: { n: 1, x: X + 40, y: 64, z: Z } });
  state.structures.spawners.set(index, state.clock);
  send(state);
  assert.equal(skeletons().length, 0);
  assert(state.structures.spawners.get(index)! <= state.clock + 1.01);

  // Broken: forgotten.
  writeCell(state, X + 3, 64, Z, B.air);
  state.structures.spawners.set(index, state.clock);
  send(state);
  assert(!state.structures.spawners.has(index));
});

test('spawners stay dark and in view: torches shut one down, walls keep its mobs inside the room', () => {
  const sx = X + 3, cage = { [`${sx},64,${Z}`]: makeCell(B.monster_spawner, MOB.zombie) }, zombies = (state: State) => state.mobs.filter(m => m.t === MOB.zombie);
  const lit = game({ ...cage, [`${sx},65,${Z}`]: B.torch, ...Object.fromEntries([[3, 3], [3, -3], [-3, 3], [-3, -3]].map(([dx, dz]) => [`${sx + dx},64,${Z + dz}`, B.torch])) });
  for (let i = 0; i < 60; i++) send(lit);
  assert.equal(zombies(lit).length, 0, 'torchlit');
  // A 3 × 3 room walled in stone three blocks high: every zombie appears inside it, never beyond the walls.
  const walls: Record<string, number> = {};
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let y = 64; y <= 66; y++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) walls[`${sx + dx},${y},${Z + dz}`] = B.stone;
  const room = game({ ...cage, ...walls });
  for (let i = 0; i < 60 && !zombies(room).length; i++) send(room);
  assert(zombies(room).length > 0, 'the room fills');
  for (const mob of zombies(room)) assert(Math.abs(mob.x - sx - 0.5) <= 1 && Math.abs(mob.z - Z - 0.5) <= 1, `inside the room (${mob.x}, ${mob.z})`);
});

test('spawners sleep in peaceful and for protected players', () => {
  const at = `${X + 3},64,${Z}`;
  for (const [difficulty, protect] of [['peaceful', false], ['normal', true]] as const) {
    const state = game({ [at]: makeCell(B.monster_spawner, MOB.zombie) }, difficulty);
    if (protect) state.players[0]!.protectedUntil = Infinity;
    for (let i = 0; i < 60; i++) send(state);
    assert.equal(state.mobs.filter(m => m.t === MOB.zombie).length, 0, difficulty);
  }
  assert(blockOf(B.monster_spawner).drops(0).length === 0);
});

test('structure torches count as light for spawning until a player removes them', () => {
  const state = game({ [`${X + 2},64,${Z}`]: makeCell(B.torch, 0) });
  send(state);
  assert.equal(blockLight(state, X + 2, 64, Z), 14);
  assert.equal(blockLight(state, X + 5, 64, Z), 11);
  writeCell(state, X + 2, 64, Z, B.air);
  state.world.cache.clear();
  state.get(X + 2, 64, Z);
  assert.equal(blockLight(state, X + 2, 64, Z), 0, 'a regenerated chunk does not bring back an edited-away torch');
});
