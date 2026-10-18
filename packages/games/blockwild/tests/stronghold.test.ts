/** Strongholds (DESIGN.md): placement, the maze and its rooms, the portal room ring, seams and budgets. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachedFace, B, BUTTON_PRESSED, cellId, cellState, CHEST_LOOT, chestLoot, FRAME_EYE, frameFacing, isFullCube } from '../src/shared/blocks';
import { END, NETHER, SEA_LEVEL, SPAWN_X, SPAWN_Z } from '../src/shared/constants';
import { cellIndex, cellXYZ, FACES, FACING, localIndex } from '../src/shared/coords';
import { MOB } from '../src/shared/protocol';
import { boxesTouch } from '../src/shared/structures/builder';
import { planStronghold, STRONGHOLD_REACH, strongholdSites, strongholdsOf } from '../src/shared/structures/stronghold';
import { generateChunk, surfaceHeight } from '../src/shared/worldgen';
import { findPortalRing } from '../src/sim/ender-eyes';

const SEEDS = [11, 4242, 777777, 260923, 1, 2, 3, 99, 12345, 31337];

/** Generated world cells (chunks memoized). */
function worldOf(seed: number) {
  const chunks = new Map<number, Uint16Array>();
  return (x: number, y: number, z: number) => {
    const key = (x >> 4) * 4096 + (z >> 4);
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, chunk = generateChunk(seed, x >> 4, z >> 4));
    return y < 0 || y > 127 ? B.air : chunk[localIndex(x & 15, y, z & 15)]!;
  };
}
const planReader = (cells: Map<number, number>) => (x: number, y: number, z: number) => cells.get(cellIndex(x, y, z)) ?? B.stone;
/** The 12 ring cells around a portal centre with the facing each must have (towards the centre). */
const ringCells = ([cx, y, cz]: readonly number[]) => FACING.flatMap(([dx, dz], side) => {
  const [px, pz] = FACING[(side + 1) & 3]!;
  return [-1, 0, 1].map(k => ({ x: cx! + dx * 2 + px * k, y: y!, z: cz! + dz * 2 + pz * k, facing: (side + 2) & 3 }));
});

test('three strongholds per world, 640–1152 blocks from spawn about 120° apart, underground, under land and clear of the sealed corners', () => {
  for (const seed of SEEDS) {
    const rooms = strongholdsOf(seed);
    assert.equal(rooms.length, 3);
    const angles = rooms.map(([x, y, z]) => {
      const d = Math.hypot(x - SPAWN_X, z - SPAWN_Z);
      assert.ok(d >= 640 && d <= 1152, `seed ${seed}: ${d.toFixed(0)} blocks`);
      assert.ok(y - 4 >= 16 && y - 4 <= 40, `seed ${seed}: portal room floor at ${y - 4}`);
      // The Nether and End corners (and their deep-ocean rims) stay at least 300 blocks away.
      for (const region of [NETHER, END]) {
        const gx = Math.max(region.x0 - x, 0, x - region.x0 - region.size), gz = Math.max(region.z0 - z, 0, z - region.z0 - region.size);
        assert.ok(Math.hypot(gx, gz) > 300, `seed ${seed}: too close to a sealed corner`);
      }
      // A site under the sea re-rolls (playtest: rooms under 30 blocks of water): at worst a shallow shore.
      assert.ok(surfaceHeight(seed, x, z) >= SEA_LEVEL - 8, `seed ${seed}: stronghold under deep water`);
      return Math.atan2(z - SPAWN_Z, x - SPAWN_X);
    });
    assert.ok(rooms.filter(([x, , z]) => surfaceHeight(seed, x, z) <= SEA_LEVEL).length <= 1, `seed ${seed}: strongholds under water`);
    const sorted = angles.sort((p, q) => p - q);
    const gaps = sorted.map((a, k) => ((sorted[(k + 1) % 3]! - a + 2 * Math.PI) % (2 * Math.PI)) * 180 / Math.PI);
    assert.ok(gaps.every(gap => gap >= 60 && gap <= 180), `seed ${seed}: gaps ${gaps.map(g => g.toFixed(0))}°`);
  }
});

test('placement and plans are deterministic and seed-dependent', () => {
  const first = strongholdsOf(11).map(v => [...v]);
  for (const seed of [1, 2, 3, 4, 5]) strongholdsOf(seed);
  assert.deepEqual(strongholdsOf(11).map(v => [...v]), first);
  assert.notDeepEqual(strongholdsOf(12).map(v => [...v]), first);
  const a = planStronghold(11, 0), b = planStronghold(11, 0);
  assert.deepEqual(a.pieces, b.pieces);
  assert.deepEqual([...a.cells], [...b.cells]);
});

test('every stronghold is a maze with the MC rooms: one portal room, a prison, a fountain, 1–2 libraries and 2+ store rooms', () => {
  for (const seed of SEEDS) for (let i = 0; i < 3; i++) {
    const plan = planStronghold(seed, i), count = (kind: string) => plan.pieces.filter(p => p.kind === kind).length;
    const label = `seed ${seed} #${i}`;
    assert.equal(count('portal_room'), 1, label);
    assert.equal(count('prison'), 1, label);
    assert.equal(count('fountain'), 1, label);
    assert.ok(count('library') >= 1 && count('library') <= 2, label);
    assert.ok(count('store_room') >= 2, label);
    assert.ok(count('corridor') + count('stairs') + count('turn') + count('crossing') >= 6, `${label}: ${plan.pieces.length} pieces`);
    const [cx, , cz] = plan.site.center, b = plan.bounds;
    assert.ok(Math.max(cx - b[0], b[3] - cx, cz - b[2], b[5] - cz) <= STRONGHOLD_REACH, label);
    assert.ok(b[1] >= 4, `${label}: above the bedrock`);
    // Pieces may share walls but never each other's insides.
    for (const [j, p] of plan.pieces.entries()) for (const q of plan.pieces.slice(j + 1)) {
      const inner = [p.bounds[0] + 1, p.bounds[1] + 1, p.bounds[2] + 1, p.bounds[3] - 1, p.bounds[4] - 1, p.bounds[5] - 1] as const;
      assert.ok(!boxesTouch([...inner], q.bounds), `${label}: ${p.kind} overlaps ${q.kind}`);
    }
  }
});

test('rooms are furnished: libraries, store rooms, the prison, iron doors with a button on each side, infested bricks', () => {
  for (const seed of SEEDS.slice(0, 5)) for (let i = 0; i < 3; i++) {
    const plan = planStronghold(seed, i), label = `seed ${seed} #${i}`, cells = [...plan.cells];
    const ids = (id: number) => cells.filter(([, cell]) => cellId(cell) === id);
    const inPiece = (kind: string, index: number) => {
      const [x, y, z] = cellXYZ(index);
      return plan.pieces.some(p => p.kind === kind && x >= p.bounds[0] && x <= p.bounds[3] && y >= p.bounds[1] && y <= p.bounds[4] && z >= p.bounds[2] && z <= p.bounds[5]);
    };
    const chests = ids(B.chest);
    assert.ok(chests.some(([index, cell]) => inPiece('library', index) && chestLoot(cellState(cell)) === CHEST_LOOT.stronghold_library), `${label}: library chest`);
    assert.ok(chests.filter(([index, cell]) => inPiece('store_room', index) && chestLoot(cellState(cell)) === CHEST_LOOT.stronghold_corridor).length >= 2, `${label}: store chests`);
    assert.ok(ids(B.bookshelf).length > 150 && ids(B.ladder).length >= 6, `${label}: two-storey shelves and ladders`);
    assert.ok(ids(B.iron_bars).filter(([index]) => inPiece('prison', index)).length >= 20, `${label}: prison bars`);
    assert.ok(ids(B.silverfish_stone).length > 20, `${label}: infested bricks`);
    assert.equal(ids(B.monster_spawner).length, 1);
    assert.equal(cellState(ids(B.monster_spawner)[0]![1]), MOB.silverfish);
    // Each button sits on a planned wall block right beside an iron door's upper half; the doors with buttons have one on each side.
    const buttons = ids(B.stone_button).map(([index, cell]) => {
      const [x, y, z] = cellXYZ(index), [fx, fy, fz] = FACES[attachedFace(cellState(cell))]!, wall = [x - fx, y - fy, z - fz] as const;
      assert.ok(isFullCube(plan.cells.get(cellIndex(...wall)) ?? B.air) && !(cellState(cell) & BUTTON_PRESSED), `${label}: button support`);
      const door = FACING.map(([dx, dz]) => [wall[0] + dx, wall[1], wall[2] + dz] as const).find(c => cellId(plan.cells.get(cellIndex(...c)) ?? 0) === B.iron_door);
      assert.ok(door, `${label}: a button beside no iron door`);
      return { door: cellIndex(...door), side: Math.sign((x - door[0]) * FACING[cellState(plan.cells.get(cellIndex(...door))!) & 3]![0] + (z - door[2]) * FACING[cellState(plan.cells.get(cellIndex(...door))!) & 3]![1]) };
    });
    assert.ok(buttons.length >= 2, `${label}: buttons`);
    for (const door of new Set(buttons.map(b => b.door))) assert.deepEqual(new Set(buttons.filter(b => b.door === door).map(b => b.side)), new Set([-1, 1]), `${label}: buttons on both sides`);
  }
});

test('the portal room: 12 frames facing inward over lava, stairs, a silverfish spawner, 75% pre-filled eyes and never all 12', () => {
  let eyes = 0, frames = 0;
  for (let seed = 1; seed <= 60; seed++) for (let i = 0; i < 3; i++) {
    const plan = planStronghold(seed, i), get = planReader(plan.cells), [cx, y, cz] = plan.site.center, label = `seed ${seed} #${i}`;
    const ring = ringCells(plan.site.center);
    let filled = 0;
    for (const f of ring) {
      const cell = get(f.x, f.y, f.z);
      assert.equal(cellId(cell), B.end_portal_frame, label);
      assert.equal(frameFacing(cellState(cell)), f.facing, `${label}: frame faces its centre`);
      if (cellState(cell) & FRAME_EYE) filled++;
    }
    assert.ok(filled < 12, `${label}: all 12 eyes`);
    eyes += filled;
    frames += 12;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      assert.equal(get(cx + dx, y, cz + dz), B.air, `${label}: the portal opening is clear`);
      assert.equal(get(cx + dx, y - 1, cz + dz), B.lava, `${label}: lava below the portal`);
    }
    // With every eye in place the ring is found from any of its frames (whatever way the room faces).
    const full = new Map(plan.cells);
    for (const f of ring) full.set(cellIndex(f.x, f.y, f.z), full.get(cellIndex(f.x, f.y, f.z))! | FRAME_EYE << 8);
    for (const f of ring) assert.deepEqual(findPortalRing(planReader(full), f.x, f.y, f.z), [cx, y, cz], label);
    // The landing eyes lead to is floor inside the room, with stairs up to the ring.
    const [lx, ly, lz] = plan.site.landing;
    assert.ok(isFullCube(get(lx, ly - 1, lz)) && get(lx, ly, lz) === B.air && get(lx, ly + 1, lz) === B.air, `${label}: landing`);
    assert.ok([...plan.cells.values()].filter(cell => cellId(cell) === B.stone_brick_stairs).length >= 9);
  }
  const rate = eyes / frames;
  assert.ok(rate > 0.68 && rate < 0.82, `pre-filled eye rate ${rate.toFixed(3)}`);
});

test('generated chunks match the plan across chunk seams, and the world has the real portal room', () => {
  const seed = 11, plan = planStronghold(seed, 0), get = worldOf(seed);
  let checked = 0;
  for (const [index, cell] of plan.cells) {
    const [x, y, z] = cellXYZ(index), got = get(x, y, z);
    // Fences resolve their connections while painting; everything else is written exactly as planned.
    if (cellId(cell) === B.oak_fence) assert.equal(cellId(got), B.oak_fence);
    else assert.equal(got, cell, `cell ${x},${y},${z}`);
    checked++;
  }
  assert.ok(checked > 5000);
  assert.ok(ringCells(plan.site.center).every(f => cellId(get(f.x, f.y, f.z)) === B.end_portal_frame));
  // Chunks far from every stronghold are untouched by it.
  const [sx, , sz] = plan.site.center, far = generateChunk(seed, (sx + 200) >> 4, sz >> 4);
  assert.ok(!far.some(cell => cellId(cell) === B.end_portal_frame || cellId(cell) === B.silverfish_stone));
});

test('budgets: three plans in well under a second, and painting adds little to a chunk', () => {
  const seed = 424242, start = performance.now();
  for (let i = 0; i < 3; i++) planStronghold(seed, i);
  const planned = performance.now() - start;
  assert.ok(planned < 600, `planning took ${planned.toFixed(0)} ms`);
  const [sx, , sz] = strongholdSites(seed)[0]!.center, times: number[] = [];
  generateChunk(seed, sx >> 4, sz >> 4);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const t = performance.now();
    generateChunk(seed, (sx >> 4) + dx, (sz >> 4) + dz);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[times.length >> 1]! < 12, `median chunk with a stronghold ${times[times.length >> 1]!.toFixed(1)} ms`);
});
