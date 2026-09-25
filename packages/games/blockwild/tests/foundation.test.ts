import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { manifest } from '../src/manifest';
import { rules } from '../src/server';
import { B, BLOCK_LIST, BLOCKS, faceTexture, isFullCube, isOpaque, makeCell, TEXTURE_KEYS } from '../src/shared/blocks';
import { ChunkCache, CHUNK_CELLS, VoxelWorld, type CellReader } from '../src/shared/chunk';
import { EDIT_LIMIT, HEIGHT, JUMP_VELOCITY, WORLD } from '../src/shared/constants';
import { cellIndex, cellXYZ, chunkFromKey, chunkKey, facingFromYaw, FACES, localIndex, lookVector } from '../src/shared/coords';
import { I, ITEM_LIST, ITEMS, itemOf } from '../src/shared/items';
import { newBody, stepBody, type Body, type MoveIntent } from '../src/shared/physics';
import { IF, MOB_TYPES, neutralInput, parseInput, validateSettings } from '../src/shared/protocol';
import { raycastBlocks, rayAabb } from '../src/shared/raycast';
import { collisionBoxes, selectionBoxes } from '../src/shared/shapes';
import { addItem, applyClick, emptyInventory, emptySlots, type Containers } from '../src/shared/inventory';
import { craftFromInventory, craftResult, matchGrid } from '../src/shared/recipes';
import { placementFor } from '../src/shared/placement';
import { breakTime, canHarvest } from '../src/shared/mining';

/** Test world: stone up to y=63 (ground surface at y=64), plus explicit cells. */
function flat(cells: [number, number, number, number][] = [], ground = 64): CellReader {
  const extra = new Map(cells.map(([x, y, z, v]) => [`${x},${y},${z}`, v]));
  return (x, y, z) => extra.get(`${x},${y},${z}`) ?? (y < ground ? B.stone : B.air);
}
const idle: MoveIntent = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 };
const run = (body: Body, intent: Partial<MoveIntent>, seconds: number, getCell: CellReader, each?: (body: Body) => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) { stepBody(body, { ...idle, ...intent }, 1 / 60, getCell, 'survival'); each?.(body); }
};
const EAST = -Math.PI / 2;

test('index math round-trips', () => {
  for (const [x, y, z] of [[0, 0, 0], [4095, 127, 4095], [2048, 64, 17], [1, 2, 3]] as const) {
    assert.deepEqual(cellXYZ(cellIndex(x, y, z)), [x, y, z]);
  }
  assert(cellIndex(WORLD - 1, HEIGHT - 1, WORLD - 1) < 2 ** 31);
  assert.equal(localIndex(15, 127, 15), CHUNK_CELLS - 1);
  assert.deepEqual(chunkFromKey(chunkKey(12, 200)), [12, 200]);
  assert.deepEqual(FACES.map((_, face) => FACES[face ^ 1]!.map(v => -v + 0)), FACES.map(f => [...f]));
  assert.deepEqual([0, EAST, Math.PI, Math.PI / 2].map(facingFromYaw), [0, 1, 2, 3]);
  assert.deepEqual(lookVector(0, 0).map(v => Math.round(v) + 0), [0, 0, -1]);
});

test('block table is complete and consistent', () => {
  assert.equal(BLOCK_LIST.length, 121);
  assert.equal(new Set(BLOCK_LIST.map(b => b.name)).size, BLOCK_LIST.length);
  for (const block of BLOCK_LIST) {
    assert.equal(BLOCKS[block.id], block);
    assert(block.light >= 0 && block.light <= 15 && block.tier >= 0 && block.tier <= 4, block.name);
    for (const face of [0, 1, 2, 3, 4, 5]) if (block.render !== 'none') assert(TEXTURE_KEYS.includes(faceTexture(block.id, face)), block.name);
    for (const d of block.drops(0)) assert(itemOf(d.item), `${block.name} drops unknown item ${d.item}`);
  }
  assert.equal(BLOCKS[B.torch]!.light, 14);
  assert(isOpaque(B.stone) && !isOpaque(B.glass) && !isOpaque(B.oak_slab) && isOpaque(makeCell(B.oak_slab, 2)));
  assert(isFullCube(B.oak_leaves) && !isFullCube(B.torch));
  assert.equal(faceTexture(makeCell(B.oak_log, 1), 0), 'oak_log_top');
  assert.equal(faceTexture(makeCell(B.furnace, 2), 5), 'furnace_front');
});

test('shapes produce ordered boxes inside the unit cell for every state', () => {
  for (const block of BLOCK_LIST) for (let state = 0; state < 16; state++) {
    const cell = makeCell(block.id, state);
    for (const box of [...collisionBoxes(cell), ...selectionBoxes(cell)]) {
      // Fence collision is 1.5 tall (you cannot jump over it); everything else stays inside the cell.
      for (let axis = 0; axis < 3; axis++) assert(box[axis]! >= 0 && box[axis + 3]! <= (axis === 1 && block.shape === 'fence' ? 1.5 : 1) && box[axis]! < box[axis + 3]!, `${block.name}:${state}`);
    }
    if (block.solid) assert(collisionBoxes(cell).length, block.name);
    else assert.equal(collisionBoxes(cell).length, 0, block.name);
  }
  assert.equal(selectionBoxes(B.water).length, 0);
  assert.notDeepEqual(collisionBoxes(makeCell(B.oak_door, 0)), collisionBoxes(makeCell(B.oak_door, 4)));
});

test('items: block items, tools and foods', () => {
  for (const block of BLOCK_LIST) if (block.id) assert(ITEMS[block.id], block.name);
  assert.equal(new Set(ITEM_LIST.map(item => item.id)).size, ITEM_LIST.length);
  assert.deepEqual(itemOf(I.diamond_pickaxe)!.tool, { kind: 'pickaxe', tier: 4, speed: 8, durability: 1561, damage: 5 });
  assert.equal(itemOf(I.stone_sword)!.tool!.damage, 5);
  assert.equal(itemOf(I.wheat_seeds)!.places, B.wheat);
  assert(itemOf(I.bread)!.food && itemOf(I.coal)!.fuel === 80 && itemOf(I.bow)!.stack === 1);
});

test('chunk cache is LRU and the world journal drops edits written back to terrain', () => {
  let generated = 0;
  const cache = new ChunkCache(() => { generated++; return new Uint16Array(CHUNK_CELLS); }, 2);
  cache.get(0, 0); cache.get(1, 0); cache.get(0, 0); cache.get(2, 0);
  assert(cache.has(0, 0) && !cache.has(1, 0) && generated === 3);
  const world = new VoxelWorld(() => new Uint16Array(CHUNK_CELLS).fill(B.stone));
  assert(world.setCell(5, 70, 5, B.dirt));
  assert.equal(world.getCell(5.7, 70.2, 5.1), B.dirt);
  assert(world.setCell(5, 70, 5, B.stone));
  assert.equal(world.edits.size, 0);
  assert.equal(world.getCell(-1, 70, 5), B.barrier);
  assert.equal(world.getCell(5, -1, 5), B.bedrock);
  assert.equal(world.getCell(5, HEIGHT, 5), B.air);
  for (let i = 0; i < EDIT_LIMIT; i++) world.edits.set(i, 1);
  assert(!world.setCell(9, 90, 9, B.dirt));
});

test('physics: falling lands on the ground', () => {
  const body = newBody(0.5, 80, 0.5);
  run(body, {}, 3, flat());
  assert(body.onGround);
  assert(Math.abs(body.y - 64) < 1e-6, String(body.y));
});

test('physics: terminal-velocity falls never tunnel through a one-block floor', () => {
  const floor = (x: number, y: number) => y === 10 || x < -50 ? B.stone : B.air;
  const body = { ...newBody(0.5, 126, 0.5), vy: -78 };
  run(body, {}, 2, floor);
  assert(Math.abs(body.y - 11) < 1e-6, String(body.y));
});

test('physics: walls stop walking and full blocks need a jump, slabs step up', () => {
  const wall = flat([[5, 64, 0, B.stone], [5, 65, 0, B.stone]]);
  const body = newBody(0.5, 64, 0.5);
  run(body, { forward: 1, yaw: EAST }, 3, wall);
  assert(Math.abs(body.x - 4.7) < 1e-6, String(body.x));
  const step = newBody(0.5, 64, 0.5);
  run(step, { forward: 1, yaw: EAST }, 2, flat([[3, 64, 0, B.stone]]));
  assert(step.x < 2.71 && step.y === 64, 'full blocks are not auto-climbed');
  const slab = newBody(0.5, 64, 0.5);
  run(slab, { forward: 1, yaw: EAST }, 2, (x, y, z) => y === 64 && x >= 3 ? B.oak_slab : flat()(x, y, z));
  assert(slab.x > 3 && Math.abs(slab.y - 64.5) < 1e-6, `slab step ${slab.x},${slab.y}`);
});

test('physics: jump height is about 1.25 blocks and clears one block', () => {
  const body = newBody(0.5, 64, 0.5);
  run(body, {}, 0.2, flat());
  let peak = 0;
  run(body, { jump: true }, 0.4, flat(), b => { peak = Math.max(peak, b.y - 64); });
  assert(peak > 1.15 && peak < 1.3, String(peak));
  assert(JUMP_VELOCITY ** 2 / 64 > 1.2);
  const climb = newBody(0.5, 64, 0.5);
  run(climb, { forward: 1, jump: true, yaw: EAST }, 2, (x, y, z) => y === 64 && x >= 2 ? B.stone : flat()(x, y, z));
  assert(climb.x > 2 && climb.y >= 65, `jumped onto the block ${climb.x},${climb.y}`);
});

test('physics: sneaking never walks off an edge; walking does', () => {
  const ledge: CellReader = (x, y) => y < 64 && x < 5 ? B.stone : y < 60 ? B.stone : B.air;
  const body = newBody(2.5, 64, 0.5);
  run(body, { forward: 1, sneak: true, yaw: EAST }, 6, ledge);
  assert(body.onGround && body.y === 64 && body.x > 5 && body.x < 5.31, String(body.x));
  const walker = newBody(2.5, 64, 0.5);
  run(walker, { forward: 1, yaw: EAST }, 3, ledge);
  assert(walker.y < 64);
});

test('physics: ladders climb and water slows sinking', () => {
  const ladder = flat([[1, 64, 0, makeCell(B.ladder, 3)], [1, 65, 0, makeCell(B.ladder, 3)], [1, 66, 0, makeCell(B.ladder, 3)], [2, 64, 0, B.stone], [2, 65, 0, B.stone], [2, 66, 0, B.stone]]);
  const climber = newBody(1.5, 64, 0.5);
  run(climber, { forward: 1, yaw: EAST }, 1, ladder);
  assert(climber.y > 65.5, String(climber.y));
  const pool: CellReader = (_x, y) => y < 50 ? B.stone : y < 64 ? B.water : B.air;
  const swimmer = newBody(0.5, 63, 0.5);
  run(swimmer, {}, 1, pool);
  assert(swimmer.inWater && swimmer.y > 60, String(swimmer.y));
  const up = newBody(0.5, 58, 0.5);
  run(up, { jump: true }, 1, pool);
  assert(up.y > 59.5, String(up.y));
});

test('raycast hits the correct cell and face, honouring partial shapes', () => {
  const world = flat([[0, 65, -3, B.stone], [3, 64, 0, B.oak_slab]]);
  const down = raycastBlocks(world, [0.5, 65.62, 0.5], [0, -1, 0], 5)!;
  assert.deepEqual([down.x, down.y, down.z, down.face], [0, 63, 0, 3]);
  const north = raycastBlocks(world, [0.5, 65.5, 0.5], lookVector(0, 0), 5)!;
  assert.deepEqual([north.x, north.y, north.z, north.face], [0, 65, -3, 5]);
  assert(Math.abs(north.point[2] + 2) < 1e-9);
  const overSlab = raycastBlocks(world, [0.5, 64.75, 0.5], [1, 0, 0], 5);
  assert.equal(overSlab, null);
  const intoSlab = raycastBlocks(world, [0.5, 64.25, 0.5], [1, 0, 0], 5)!;
  assert.deepEqual([intoSlab.x, intoSlab.face], [3, 0]);
  assert.equal(raycastBlocks(world, [0.5, 70, 0.5], [0, 1, 0], 5), null);
  assert.deepEqual(rayAabb([0, 0, 0], [1, 0, 0], [2, -1, -1, 3, 1, 1]), { distance: 2, face: 0 });
  assert.equal(rayAabb([0, 5, 0], [1, 0, 0], [2, -1, -1, 3, 1, 1]), null);
});

test('parseInput survives garbage and sanitises every field', () => {
  for (const raw of [null, undefined, 3, 'x', [], { x: 1, y: 0 }, { p: 'no' }, { cmds: 'lots' }, { p: [NaN, 1, 2] }]) {
    const input = parseInput(raw);
    assert(input.f & IF.NO_POS);
    assert.deepEqual(input.cmds, []);
    assertSerializable(input);
  }
  const input = parseInput({ p: [10, 70, 1e9], v: [1, 2, 3], yaw: 7, pitch: 9, f: 3, slot: 12, mine: [1.5, 2, 3], tpAck: -1,
    cmds: [{ n: 3, t: 'break', x: 1, y: 2, z: 3 }, { n: 2, t: 'place', x: 1, y: 2, z: 3, face: 3, slot: 0, hy: 4 }, { n: 3, t: 'close' }, { n: 4, t: 'nope' }, null, { n: -1, t: 'close' }] });
  assert.deepEqual(input.p, [10, 70, WORLD]);
  assert(input.yaw >= -Math.PI && input.yaw < Math.PI && input.pitch === Math.PI / 2);
  assert.equal(input.f, 3);
  assert.equal(input.slot, 0);
  assert.equal(input.mine, null);
  assert.deepEqual(input.cmds, [{ n: 2, t: 'place', x: 1, y: 2, z: 3, face: 3, slot: 0, hy: 1 }, { n: 3, t: 'break', x: 1, y: 2, z: 3 }]);
  assert(parseInput({ cmds: Array.from({ length: 100 }, (_, i) => ({ n: i + 1, t: 'close' })) }).cmds.length <= 32);
});

test('settings defaults are deterministic and views are serializable', () => {
  assert.deepEqual(validateSettings({}), validateSettings({}));
  assert.deepEqual(validateSettings({}), { mode: 'survival', seed: 0, difficulty: 'normal', keepInventory: true }, 'seed 0 = random world');
  assert.deepEqual(validateSettings({ mode: 'creative', seed: 5, difficulty: 'easy', keepInventory: false }), { mode: 'creative', seed: 5, difficulty: 'easy', keepInventory: false });
  assert.equal(validateSettings({ seed: 1.5 }).seed, 0);
  assert.equal(validateSettings({ seed: 1000000 }).seed, 0);
  assertSerializable(manifest);
  assertSerializable(neutralInput());
  assert.equal(MOB_TYPES.map(m => m.key).join(), 'zombie,skeleton,spider,creeper,cow,pig,sheep,chicken,villager,zombified_piglin,ghast,tnt');
  for (const count of [1, 10]) {
    const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff' }));
    const state = rules.create({ roomId: 'r', roundId: 'x', seed: 1, nowMs: 0, players }, validateSettings({}));
    rules.tick(state, new Map([['p0', parseInput({ x: 1, y: 0 })]]), 0.05, 50);
    const view = rules.publicView(state, { nowMs: 0, phase: 'playing' });
    assert.ok(view.seed >= 1 && view.seed <= 999999 && view.worldId.startsWith(`${view.seed}-`), 'a random world reports its real seed');
    assertSerializable(view);
    for (const p of players) assertSerializable(rules.playerView(state, p.id, { nowMs: 0, phase: 'playing' }));
    assertSerializable(rules.exportSave!(state));
    rules.finish!(state, 0);
    assert(rules.outcome(state).complete);
  }
  assert.throws(() => rules.loadSave!({ roomId: 'r', roundId: 'x', seed: 1, nowMs: 0, players: [] }, { format: 'blockwild', version: 7 }, validateSettings({})), /previous version/);
});

test('starter crafting, clicks, placement and mining agree with the tables', () => {
  assert.equal(matchGrid([null, { id: B.oak_log, n: 1 }, null, null], 2)?.id, 'oak_planks');
  const planks = { id: B.birch_planks, n: 1 }, stick = { id: I.stick, n: 1 };
  assert.deepEqual(craftResult([planks, planks, planks, null, stick, null, null, stick, null], 3), { id: I.wooden_pickaxe, n: 1 });
  const inv = emptyInventory();
  addItem(inv, B.oak_log, 2);
  assert.equal(craftFromInventory(inv, 'oak_planks', false, true), 2);
  assert.equal(inv.reduce((n, s) => n + (s?.id === B.oak_planks ? s.n : 0), 0), 8);
  const c: Containers = { inv, cursor: null, grid: emptySlots(4), out: null, screen: null, screenKind: null };
  const craft = (grid: readonly (typeof c.cursor)[]) => craftResult(grid, 2);
  assert(applyClick(c, 'inv', inv.findIndex(s => s?.id === B.oak_planks), 0, craft) && c.cursor?.n === 8);
  for (const i of [0, 1, 2, 3]) applyClick(c, 'grid', i, 1, craft);
  assert.deepEqual(c.out, { id: B.crafting_table, n: 1 });
  assert(!applyClick(c, 'out', 0, 0, craft), 'a different item on the cursor blocks taking the output');
  assert(applyClick(c, 'inv', 20, 0, craft) && !c.cursor);
  const cursor = () => c.cursor;
  assert(applyClick(c, 'out', 0, 0, craft) && cursor()?.id === B.crafting_table && c.grid.every(slot => !slot) && !c.out);
  const world = { getCell: flat([[0, 64, -1, B.stone]]) };
  assert.deepEqual(placementFor(world, B.torch, { x: 0, y: 64, z: -1, face: 5 }, 0), [[0, 64, 0, makeCell(B.torch, 3)]]);
  assert.deepEqual(placementFor(world, B.oak_log, { x: 0, y: 63, z: 0, face: 3 }, 0), [[0, 64, 0, B.oak_log]]);
  assert.equal(placementFor(world, I.oak_door, { x: 0, y: 63, z: 0, face: 3 }, 0)?.length, 2);
  assert(!canHarvest(B.stone, 0) && canHarvest(B.stone, I.wooden_pickaxe) && !canHarvest(B.iron_ore, I.wooden_pickaxe));
  assert(breakTime(B.stone, I.stone_pickaxe, true, false) < breakTime(B.stone, 0, true, false));
  assert.equal(breakTime(B.bedrock, I.diamond_pickaxe, true, false), Infinity);
});
