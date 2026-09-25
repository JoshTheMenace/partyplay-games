/** Expansion foundation (DESIGN.md): ids, blocks, shapes, placement, buckets, armor clicks, recipes, protocol and save v9. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import {
  B, BLOCK_LIST, blockOf, cellId, cellState, CHEST_LOOT, chestLoot, DOOR_UPPER, faceTexture, isFullCube, isOpaque, makeCell, PISTON_EXTENDED, PORTAL_Z, TEXTURE_KEYS,
} from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource, type World } from '../src/shared/chunk';
import { inNether, NETHER } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { I } from '../src/shared/ids';
import { applyClick, emptyInventory, emptySlots, equipArmor, FUEL, FUEL_REMAINDER, SMELTING, type Containers } from '../src/shared/inventory';
import { armorOf, armorPoints, durabilityOf, ITEM_LIST, itemOf, type Slot } from '../src/shared/items';
import { breakTime, canHarvest, drops } from '../src/shared/mining';
import { newBody, stepBody, type MoveIntent } from '../src/shared/physics';
import { bucketTarget, bucketUse, canSurvive, fenceState, placementFor, usesBlock } from '../src/shared/placement';
import { IF, MOB, MOB_TYPES, parseCmd, parseInput, PF, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { craftFromInventory, matchGrid, RECIPES, type Ingredient, type Recipe } from '../src/shared/recipes';
import { collisionBoxes, selectionBoxes } from '../src/shared/shapes';
import { generateChunk } from '../src/shared/worldgen';
import { tickFurnaces } from '../src/sim/containers';
import { createState, saveSource, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { exportSave, OLD_SAVE_MESSAGE, parseSave } from '../src/sim/save';
import type { Player, State } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';

// Helpers ------------------------------------------------------------------------------------------------------------

/** Stone below y = 64, air above, plus overrides keyed "x,y,z". */
const world = (overrides: Record<string, number> = {}): World => ({ getCell: (x, y, z) => overrides[`${x},${y},${z}`] ?? (y < 64 ? B.stone : B.air) });
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048;
function game(spawn: [number, number, number] = [X, 64, Z]): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11 }), { source: flat, spawn });
  state.players[0]!.protectedUntil = 0;
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const send = (state: State, cmds: CmdBody[]) => tickState(state, new Map([['p0', hold(state.players[0]!, cmds)]]), 0.05);
const containers = (extra: Partial<Containers> = {}): Containers => ({ inv: emptyInventory(), cursor: null, grid: emptySlots(4), out: null, screen: null, screenKind: null, armor: emptySlots(4), ...extra });
const noCraft = () => null;

// Ids -----------------------------------------------------------------------------------------------------------------

test('ids: existing ids unchanged, new ids fixed and unique', () => {
  assert.deepEqual([B.air, B.stone, B.chest, B.water, B.bed, B.obsidian, B.barrier], [0, 1, 19, 21, 51, 77, 255]);
  assert.deepEqual([I.stick, I.water_bucket, I.oak_door, I.diamond_sword], [256, 298, 301, 321]);
  const blocks = ['netherrack', 'soul_sand', 'glowstone', 'nether_quartz_ore', 'nether_gold_ore', 'lava', 'magma_block', 'nether_bricks', 'quartz_block', 'nether_portal',
    'fire', 'red_mushroom', 'brown_mushroom', 'cobweb', 'oak_fence', 'monster_spawner', 'emerald_ore', 'emerald_block', 'chiseled_sandstone', 'cut_sandstone',
    'sandstone_stairs', 'sandstone_slab', 'dirt_path', 'cracked_stone_bricks', 'mossy_stone_bricks', 'redstone_ore', 'redstone_wire', 'redstone_torch', 'redstone_torch_off', 'lever',
    'stone_button', 'oak_button', 'stone_pressure_plate', 'oak_pressure_plate', 'redstone_lamp', 'redstone_lamp_lit', 'repeater', 'piston', 'sticky_piston', 'piston_head',
    'iron_door', 'tnt', 'redstone_block'] as const;
  blocks.forEach((name, i) => assert.equal(B[name], 78 + i, name));
  const items = ['glowstone_dust', 'quartz', 'gold_nugget', 'nether_brick', 'emerald', 'flint_and_steel', 'lava_bucket', 'redstone', 'repeater', 'iron_door',
    ...['leather', 'golden', 'iron', 'diamond'].flatMap(m => ['helmet', 'chestplate', 'leggings', 'boots'].map(p => `${m}_${p}`))] as (keyof typeof I)[];
  items.forEach((name, i) => assert.equal(I[name], 322 + i, name));
  assert.equal(new Set(Object.values(B)).size, Object.keys(B).length);
  assert.equal(new Set(Object.values(I)).size, Object.keys(I).length);
  assert.deepEqual(MOB_TYPES.slice(8).map(m => [m.key, MOB[m.key]]), [['villager', 8], ['zombified_piglin', 9], ['ghast', 10], ['tnt', 11]]);
});

// Blocks and shapes -------------------------------------------------------------------------------------------------

test('every new block has properties, texture keys and in-range shapes for all 32 states', () => {
  for (const block of BLOCK_LIST.filter(b => b.id >= 78)) {
    assert.ok(block.label && block.hardness !== undefined && block.slow > 0 && block.slow <= 1, block.name);
    for (const d of block.drops(0)) assert.ok(itemOf(d.item), `${block.name} drops ${d.item}`);
    for (let state = 0; state < 32; state++) {
      const cell = makeCell(block.id, state);
      for (let face = 0; face < 6; face++) assert.ok(TEXTURE_KEYS.includes(faceTexture(cell, face)), `${block.name}:${state}:${face}`);
      for (const box of [...collisionBoxes(cell), ...selectionBoxes(cell)]) {
        for (let axis = 0; axis < 3; axis++) assert.ok(box[axis]! >= 0 && box[axis]! < box[axis + 3]! && box[axis + 3]! <= (axis === 1 && block.shape === 'fence' ? 1.5 : 1), `${block.name}:${state}`);
      }
    }
  }
  for (const id of [B.redstone_wire, B.stone_pressure_plate, B.stone_button, B.lever, B.fire, B.nether_portal, B.cobweb, B.lava]) assert.equal(collisionBoxes(id).length, 0, blockOf(id).name);
  assert.deepEqual(collisionBoxes(B.soul_sand), [[0, 0, 0, 1, 14 / 16, 1]]);
  assert.deepEqual(selectionBoxes(B.soul_sand), [[0, 0, 0, 1, 1, 1]]);
  assert.deepEqual(selectionBoxes(B.nether_portal), [[0, 0, 6 / 16, 1, 1, 10 / 16]], 'axis 0 spans X');
  assert.deepEqual(selectionBoxes(makeCell(B.nether_portal, PORTAL_Z)), [[6 / 16, 0, 0, 10 / 16, 1, 1]]);
  assert.deepEqual(collisionBoxes(makeCell(B.piston, 3 | PISTON_EXTENDED)), [[0, 0, 0, 1, 12 / 16, 1]], 'an extended base is 12/16 deep');
  assert.deepEqual(collisionBoxes(makeCell(B.piston_head, 3))[0], [0, 12 / 16, 0, 1, 1, 1], 'the head plate sits on its facing side');
  assert.equal(selectionBoxes(makeCell(B.lever, 3))[0]![1], 0, 'a floor lever sits on the floor');
  assert.equal(selectionBoxes(makeCell(B.stone_button, 2))[0]![4], 1, 'a ceiling button hangs from the ceiling');
  assert.equal(selectionBoxes(makeCell(B.stone_button, 1))[0]![0], 0, 'a button on the +X face of its support hugs the -X side');
  assert.ok(selectionBoxes(makeCell(B.stone_button, 1 | 8))[0]![3] < selectionBoxes(makeCell(B.stone_button, 1))[0]![3], 'pressed buttons sink');
  assert.ok(isOpaque(B.piston) && !isOpaque(makeCell(B.piston, PISTON_EXTENDED)) && isFullCube(B.monster_spawner) && !isOpaque(B.monster_spawner));
  assert.equal(faceTexture(makeCell(B.piston, 3), 3), 'piston_top');
  assert.equal(faceTexture(makeCell(B.sticky_piston, 3), 3), 'piston_top_sticky');
  assert.equal(faceTexture(makeCell(B.piston, 3 | PISTON_EXTENDED), 3), 'piston_inner');
  assert.equal(faceTexture(makeCell(B.piston, 3), 2), 'piston_bottom');
  assert.equal(faceTexture(makeCell(B.repeater, 16), 3), 'repeater_on');
  assert.equal(faceTexture(makeCell(B.iron_door, DOOR_UPPER), 4), 'iron_door_top');
  assert.equal(chestLoot(CHEST_LOOT.dungeon << 2 | 3), CHEST_LOOT.dungeon);
  assert.equal(blockOf(B.redstone_lamp_lit).drops(0)[0]!.item, B.redstone_lamp);
});

test('fence collision follows its connections and cannot be jumped', () => {
  assert.equal(collisionBoxes(B.oak_fence).length, 1);
  assert.equal(collisionBoxes(makeCell(B.oak_fence, 0b0101)).length, 3, 'post + north + south arms');
  assert.ok(collisionBoxes(B.oak_fence).every(box => box[4] === 1.5) && selectionBoxes(B.oak_fence).every(box => box[4] === 1));
  // A fence row along X at z = 5 (connected east-west); a player north of it runs south and jumps the whole time.
  const fences: Record<string, number> = {};
  for (let x = -3; x <= 3; x++) fences[`${x},64,5`] = makeCell(B.oak_fence, 0b1010);
  const get = world(fences).getCell, body = newBody(0.2, 64, 3.5);
  const intent: MoveIntent = { forward: 1, strafe: 0, jump: true, sneak: false, sprint: true, flyDown: false, yaw: Math.PI };
  for (let i = 0; i < 180; i++) stepBody(body, intent, 1 / 60, get, 'survival');
  assert.ok(body.z < 5 + 6 / 16, `stopped by the arm, z = ${body.z}`);
  assert.equal(fenceState(world(fences), 0, 64, 5), 0b1010);
});

test('soul sand, cobwebs and lava slow movement', () => {
  const walk = (floor: number, inside: number = B.air, seconds = 1) => {
    const cells: Record<string, number> = {};
    for (let z = -40; z <= 1; z++) { cells[`0,63,${z}`] = floor; cells[`0,64,${z}`] = inside; }
    const body = newBody(0.5, floor === B.soul_sand ? 63 + 14 / 16 : 64, 0.5), get = world(cells).getCell;
    const intent: MoveIntent = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 };
    for (let i = 0; i < seconds * 60; i++) stepBody(body, intent, 1 / 60, get, 'survival');
    return 0.5 - body.z;
  };
  const normal = walk(B.stone), sand = walk(B.soul_sand), web = walk(B.stone, B.cobweb), lava = walk(B.stone, B.lava);
  assert.ok(Math.abs(sand / normal - 0.4) < 0.05, `soul sand ${sand} vs ${normal}`);
  assert.ok(web < normal * 0.2 && lava < normal * 0.4, `web ${web}, lava ${lava}`);
  // Falling into a cobweb nearly stops the fall.
  const body = newBody(0.5, 70, 0.5);
  body.vy = -20;
  stepBody(body, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 }, 0.2, world({ '0,70,0': B.cobweb, '0,69,0': B.cobweb }).getCell, 'survival');
  assert.ok(body.y > 69.5, `web holds the fall, y = ${body.y}`);
});

// Placement ---------------------------------------------------------------------------------------------------------

test('placement rules for every new block', () => {
  const pillar = world({ '0,64,0': B.stone, '0,66,5': B.stone }), top = (x: number, z: number) => ({ x, y: 63, z, face: 3 });
  const place = (w: World, item: number, hit: { x: number; y: number; z: number; face: number }, yaw = 0, pitch = 0) => placementFor(w, item, hit, yaw, pitch);
  // Levers and buttons sit on the clicked face of a full block; floor levers remember the look direction.
  assert.deepEqual(place(pillar, B.lever, { x: 0, y: 64, z: 0, face: 1 }), [[1, 64, 0, makeCell(B.lever, 1)]]);
  assert.deepEqual(place(pillar, B.lever, top(3, 3), -Math.PI / 2), [[3, 64, 3, makeCell(B.lever, 3 | 1 << 4)]]);
  assert.deepEqual(place(pillar, B.stone_button, { x: 0, y: 66, z: 5, face: 2 }), [[0, 65, 5, makeCell(B.stone_button, 2)]]);
  assert.equal(place(world({ '0,64,0': makeCell(B.oak_fence) }), B.lever, { x: 0, y: 64, z: 0, face: 1 }), null, 'fences are not full faces');
  // Plates, wire and repeaters need a sturdy top below; torches work as before.
  assert.equal(place(pillar, B.stone_pressure_plate, { x: 0, y: 66, z: 5, face: 1 }), null);
  assert.equal(place(pillar, I.redstone, { x: 0, y: 66, z: 5, face: 1 }), null);
  assert.deepEqual(place(pillar, I.redstone, top(2, 2)), [[2, 64, 2, B.redstone_wire]]);
  assert.deepEqual(place(pillar, B.oak_pressure_plate, top(2, 2)), [[2, 64, 2, B.oak_pressure_plate]]);
  assert.deepEqual(place(pillar, I.repeater, top(2, 2), -Math.PI / 2), [[2, 64, 2, makeCell(B.repeater, 1)]], 'output points away from the player (east)');
  assert.deepEqual(place(pillar, B.redstone_torch, { x: 0, y: 64, z: 0, face: 5 }), [[0, 64, 1, makeCell(B.redstone_torch, 3)]]);
  // Pistons face the player in six directions.
  assert.equal(place(pillar, B.piston, top(2, 2))![0]![3], makeCell(B.piston, 5), 'looking north: the head points south, at the player');
  assert.equal(place(pillar, B.sticky_piston, top(2, 2), 0, -1)![0]![3], makeCell(B.sticky_piston, 3), 'looking down: up');
  assert.equal(place(pillar, B.piston, top(2, 2), 0, 1)![0]![3], makeCell(B.piston, 2), 'looking up: down');
  // Fences connect and update their neighbours.
  const fenced = world({ '0,64,0': makeCell(B.oak_fence), '2,64,1': B.stone });
  assert.deepEqual(place(fenced, B.oak_fence, top(1, 0)), [[1, 64, 0, makeCell(B.oak_fence, 0b1000)], [0, 64, 0, makeCell(B.oak_fence, 0b0010)]]);
  assert.deepEqual(place(fenced, B.oak_fence, top(2, 0)), [[2, 64, 0, makeCell(B.oak_fence, 0b0100)]], 'joins the stone to the south');
  assert.deepEqual(place(world({ '1,64,0': makeCell(B.oak_fence) }), B.cobblestone, top(0, 0)), [[0, 64, 0, B.cobblestone], [1, 64, 0, makeCell(B.oak_fence, 0b1000)]], 'a block beside a fence connects it');
  // Two-block iron doors; blocks no item may place.
  assert.deepEqual(place(pillar, I.iron_door, top(2, 2)), [[2, 64, 2, makeCell(B.iron_door, 0)], [2, 65, 2, makeCell(B.iron_door, DOOR_UPPER)]]);
  for (const id of [B.nether_portal, B.fire, B.lava, B.piston_head]) assert.equal(place(pillar, id, top(2, 2)), null, blockOf(id).name);
  // Plants: mushrooms need a full block, cobwebs hang anywhere; nothing non-solid goes into lava.
  assert.deepEqual(place(pillar, B.red_mushroom, top(2, 2)), [[2, 64, 2, B.red_mushroom]]);
  assert.equal(place(world({ '2,63,2': B.oak_slab }), B.red_mushroom, { x: 2, y: 63, z: 2, face: 3 }), null);
  assert.deepEqual(place(pillar, B.cobweb, { x: 0, y: 66, z: 5, face: 1 }), [[1, 66, 5, B.cobweb]]);
  assert.equal(place(world({ '2,64,2': B.lava }), B.redstone_torch, top(2, 2)), null);
  assert.deepEqual(place(world({ '2,64,2': B.lava }), B.cobblestone, top(2, 2)), [[2, 64, 2, B.cobblestone]]);
  assert.deepEqual(place(world({ '2,64,2': B.sandstone_slab }), B.sandstone_slab, { x: 2, y: 64, z: 2, face: 3 }), [[2, 64, 2, makeCell(B.sandstone_slab, 2)]]);
  assert.deepEqual(place(pillar, B.monster_spawner, top(2, 2)), [[2, 64, 2, B.monster_spawner]]);
  // Support rules the server re-checks after neighbours change.
  assert.ok(!canSurvive(world(), 1, 64, 0, makeCell(B.lever, 1)) && !canSurvive(world(), 1, 70, 0, B.fire) && canSurvive(world(), 1, 64, 0, B.fire));
  // Right-click classification.
  assert.ok(usesBlock(B.lever, 0, false) && usesBlock(B.oak_button, B.dirt, false) && usesBlock(B.repeater, 0, false));
  assert.ok(!usesBlock(B.iron_door, 0, false), 'iron doors only open by redstone');
  assert.ok(usesBlock(B.stone, I.flint_and_steel, false) && usesBlock(B.grass_block, I.iron_shovel, false) && usesBlock(B.stone, I.lava_bucket, false));
});

test('buckets: lava, obsidian where water meets lava, no water in the Nether', () => {
  const w = world({ '0,64,0': B.lava, '5,64,0': B.water, '6,64,0': B.water, '7,64,0': B.water, '0,64,3': B.water });
  assert.deepEqual(bucketUse(w, I.bucket, 0, 64, 0), { writes: [[0, 64, 0, B.air]], item: I.lava_bucket, fx: 'splash' });
  assert.deepEqual(bucketUse(w, I.bucket, 6, 64, 0), { writes: [], item: I.water_bucket, fx: 'splash' }, 'infinite water');
  assert.deepEqual(bucketUse(w, I.water_bucket, 0, 64, 0)!.writes, [[0, 64, 0, B.obsidian]], 'water onto lava');
  assert.deepEqual(bucketUse(w, I.lava_bucket, 0, 64, 3)!.writes, [[0, 64, 3, B.obsidian]], 'lava onto water');
  assert.deepEqual(bucketUse(w, I.water_bucket, 1, 64, 0), { writes: [[1, 64, 0, B.water], [0, 64, 0, B.obsidian]], item: I.bucket, fx: 'fizz' }, 'water beside lava hardens it');
  assert.deepEqual(bucketUse(w, I.lava_bucket, 1, 64, 3)!.writes, [[1, 64, 3, B.obsidian]], 'lava beside water hardens');
  assert.deepEqual(bucketUse(w, I.lava_bucket, 3, 64, 3), { writes: [[3, 64, 3, B.lava]], item: I.bucket, fx: 'splash' });
  assert.deepEqual(bucketUse(w, I.water_bucket, NETHER.x0 + 40, 64, 40), { writes: [], item: I.bucket, fx: 'fizz' });
  assert.equal(bucketUse(w, I.water_bucket, 5, 64, 0), null, 'no water onto water');
  assert.deepEqual(bucketTarget(world({ '2,64,2': B.short_grass }), I.water_bucket, { x: 2, y: 64, z: 2, face: 1 }), [2, 64, 2], 'pours into grass');
  assert.deepEqual(bucketTarget(w, I.bucket, { x: 0, y: 63, z: 0, face: 3 }), [0, 64, 0]);
});

// Inventory, recipes, mining --------------------------------------------------------------------------------------

test('armor: stats, slot clicks, shift-click and equip', () => {
  assert.deepEqual(armorOf(I.diamond_chestplate), { slot: 1, material: 'diamond', points: 8, toughness: 2 });
  assert.deepEqual([durabilityOf(I.leather_boots), durabilityOf(I.golden_helmet), durabilityOf(I.iron_leggings), durabilityOf(I.diamond_helmet)], [65, 77, 225, 363]);
  const full = (m: string) => ['helmet', 'chestplate', 'leggings', 'boots'].map(p => ({ id: I[`${m}_${p}` as keyof typeof I], n: 1 }));
  assert.deepEqual(['leather', 'golden', 'iron', 'diamond'].map(m => armorPoints(full(m))), [7, 11, 15, 20]);
  assert.ok(ITEM_LIST.filter(item => item.armor).every(item => item.stack === 1 && item.category === 'combat'));

  const helmet: Slot = { id: I.iron_helmet, n: 1 }, c = containers({ cursor: helmet });
  assert.ok(!applyClick(c, 'armor', 1, 0, noCraft), 'a helmet does not fit the chest slot');
  assert.ok(applyClick(c, 'armor', 0, 0, noCraft) && c.armor![0]?.id === I.iron_helmet && !c.cursor);
  c.cursor = { id: I.diamond_helmet, n: 1 };
  assert.ok(applyClick(c, 'armor', 0, 1, noCraft));
  assert.deepEqual([c.armor![0]!.id, c.cursor!.id], [I.diamond_helmet, I.iron_helmet], 'swap');
  assert.ok(!applyClick(containers({ cursor: { id: B.dirt, n: 5 } }), 'armor', 0, 0, noCraft), 'dirt is not armor');
  // Shift-click: inventory → free armor slot (plain inventory only), armor → main inventory first.
  const s = containers();
  s.inv[3] = { id: I.golden_boots, n: 1 };
  assert.ok(applyClick(s, 'inv', 3, 2, noCraft) && s.armor![3]!.id === I.golden_boots && !s.inv[3]);
  s.inv[3] = { id: I.leather_boots, n: 1 };
  assert.ok(applyClick(s, 'inv', 3, 2, noCraft) && s.inv[9]!.id === I.leather_boots, 'occupied slot: hotbar → main as before');
  assert.ok(applyClick(s, 'armor', 3, 2, noCraft) && !s.armor![3] && s.inv[10]!.id === I.golden_boots);
  const chest = containers({ screen: emptySlots(27), screenKind: 'chest' });
  chest.inv[0] = { id: I.iron_chestplate, n: 1 };
  assert.ok(applyClick(chest, 'inv', 0, 2, noCraft) && chest.screen![0]!.id === I.iron_chestplate, 'with a chest open, shift-click stores it');
  assert.ok(!applyClick({ ...containers(), armor: undefined, cursor: helmet }, 'armor', 0, 0, noCraft), 'no armor array: armor clicks do nothing');
  // Equip from the hotbar swaps with the worn piece.
  const inv = emptyInventory(), armor = emptySlots(4);
  inv[2] = { id: I.iron_chestplate, n: 1 };
  armor[1] = { id: I.leather_chestplate, n: 1, d: 3 };
  assert.ok(equipArmor(inv, armor, 2) && armor[1]!.id === I.iron_chestplate && inv[2]!.id === I.leather_chestplate && inv[2]!.d === 3);
  assert.ok(!equipArmor(inv, armor, 5));
});

/** A crafting grid holding one choice of every ingredient of a recipe (3×3 for table recipes). */
function gridFor(recipe: Recipe): [(Slot | null)[], 2 | 3] {
  const width = recipe.table ? 3 : 2, grid = emptySlots(width * width), first = (i: Ingredient) => typeof i === 'number' ? i : i[0]!;
  if (recipe.shape) recipe.shape.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') grid[y * width + x] = { id: first(recipe.key![ch]!), n: 1 }; }));
  else recipe.items!.forEach((ingredient, i) => { grid[i] = { id: first(ingredient), n: 1 }; });
  return [grid, width];
}

test('recipes: every recipe matches its own grid unambiguously; every new craftable has one', () => {
  assert.equal(new Set(RECIPES.map(r => r.id)).size, RECIPES.length);
  for (const recipe of RECIPES) assert.equal(matchGrid(...gridFor(recipe))?.id, recipe.id, recipe.id);
  const outputs = new Set(RECIPES.map(r => r.out.id));
  const craftable = [I.flint_and_steel, I.iron_door, I.gold_nugget, I.gold_ingot, I.emerald, I.redstone, I.repeater, B.oak_fence, B.nether_bricks, B.quartz_block, B.glowstone,
    B.emerald_block, B.redstone_block, B.redstone_torch, B.lever, B.stone_button, B.oak_button, B.stone_pressure_plate, B.oak_pressure_plate, B.redstone_lamp, B.piston,
    B.sticky_piston, B.tnt, B.cut_sandstone, B.chiseled_sandstone, B.sandstone_stairs, B.sandstone_slab, B.mossy_stone_bricks, ...ITEM_LIST.filter(i => i.armor).map(i => i.id)];
  for (const id of craftable) assert.ok(outputs.has(id), itemOf(id)!.key);
  assert.equal(RECIPES.find(r => r.out.id === I.diamond_boots)!.category, 'combat');
  assert.equal(RECIPES.find(r => r.out.id === B.piston)!.category, 'redstone');
  // Recipe-book crafting of a redstone lamp from raw materials.
  const inv = emptyInventory();
  inv[0] = { id: I.redstone, n: 4 };
  inv[1] = { id: B.glowstone, n: 1 };
  assert.equal(craftFromInventory(inv, 'redstone_lamp', true), 1);
  assert.equal(inv.find(s => s?.id === B.redstone_lamp)?.n, 1);
  // Smelting and fuel.
  assert.deepEqual([B.nether_quartz_ore, B.nether_gold_ore, B.netherrack, B.stone_bricks, B.redstone_ore, B.emerald_ore].map(id => SMELTING.get(id)),
    [I.quartz, I.gold_ingot, I.nether_brick, B.cracked_stone_bricks, I.redstone, I.emerald]);
  assert.equal(FUEL(I.lava_bucket), 1000);
  assert.equal(FUEL_REMAINDER.get(I.lava_bucket), I.bucket);
});

test('mining: cobwebs, glowstone, redstone ore, spawners', () => {
  assert.equal(breakTime(B.cobweb, 0, true, false), 20);
  assert.ok(breakTime(B.cobweb, I.iron_sword, true, false) < 0.5 && breakTime(B.cobweb, I.shears, true, false) < 0.5);
  assert.deepEqual(drops(B.cobweb, I.wooden_sword, () => 0), [{ id: I.string, n: 1 }]);
  assert.deepEqual(drops(B.cobweb, 0, () => 0), []);
  assert.deepEqual(drops(B.glowstone, 0, () => 0.99), [{ id: I.glowstone_dust, n: 4 }]);
  assert.ok(!canHarvest(B.redstone_ore, I.stone_pickaxe) && canHarvest(B.redstone_ore, I.iron_pickaxe));
  assert.deepEqual(drops(B.monster_spawner, I.diamond_pickaxe, () => 0), []);
  assert.ok(!canHarvest(B.netherrack, 0) && canHarvest(B.netherrack, I.wooden_pickaxe));
  assert.equal(breakTime(B.nether_portal, 0, true, false), Infinity);
});

// Protocol --------------------------------------------------------------------------------------------------------

test('parseInput accepts the new commands and survives garbage', () => {
  assert.deepEqual(parseCmd({ n: 3, t: 'trade', i: 2, max: true }), { n: 3, t: 'trade', i: 2, max: true });
  assert.deepEqual(parseCmd({ n: 4, t: 'trade', i: 0, max: 'yes' }), { n: 4, t: 'trade', i: 0 });
  assert.deepEqual(parseCmd({ n: 5, t: 'click', w: 'armor', i: 3, b: 2 }), { n: 5, t: 'click', w: 'armor', i: 3, b: 2 });
  for (const bad of [{ n: 1, t: 'trade' }, { n: 1, t: 'trade', i: 16 }, { n: 1, t: 'trade', i: -1 }, { n: 1, t: 'trade', i: '2' }, { n: 1, t: 'click', w: 'boots', i: 0, b: 0 }]) assert.equal(parseCmd(bad), null);
  const input = parseInput({ x: 1, y: 0, cmds: [null, 7, { t: 'trade', i: 1 }, { n: 2, t: 'trade', i: 1 }, { n: 1, t: 'place', x: 1 }, [], { n: 9, t: 'armor' }] });
  assert.deepEqual(input.cmds, [{ n: 2, t: 'trade', i: 1 }]);
  assert.ok(input.f & IF.NO_POS);
  for (const garbage of [undefined, 'x', [1, 2], { cmds: 'nope' }, { cmds: [{ n: Infinity, t: 'trade', i: 1 }] }]) assert.doesNotThrow(() => parseInput(garbage));
});

// Server integration ---------------------------------------------------------------------------------------------

test('server: views carry armor, burning, portal and dimension; hooks run end to end', () => {
  const state = game(), player = state.players[0]!;
  player.armor[0] = { id: I.iron_helmet, n: 1, d: 5 };
  player.fire = 10;
  state.mobs.push(Object.assign(newMob(state, MOB.villager, X + 3, 64, Z), { p: 3 }), newMob(state, MOB.tnt, X - 3, 64, Z));
  for (let i = 0; i < 40; i++) send(state, []);
  const view = publicView(state), me = view.players[0]!, pv = playerView(state, 'p0');
  assert.deepEqual(me.armor, [I.iron_helmet, 0, 0, 0]);
  assert.ok(me.flags & PF.BURNING);
  assert.equal(view.mobs.find(m => m.t === MOB.villager)?.p, 3);
  assert.deepEqual([pv.armor[0]?.id, pv.armorPoints, pv.portal, pv.dimension], [I.iron_helmet, 2, undefined, 'overworld']);
  assert.ok(pv.burning! > 0 && pv.armor[0]!.d! > 5, 'fire and the TNT blast burn and wear the helmet');
  assertSerializable(view);
  assertSerializable(pv);
  Object.assign(player, { x: NETHER.x0 + 100, z: 100 });
  assert.equal(playerView(state, 'p0').dimension, 'nether');
  assert.ok(inNether(NETHER.x0, 0) && !inNether(NETHER.x0 - 1, 0) && !inNether(NETHER.x0, NETHER.size));
});

test('server: shovel paths, flint and steel, lava buckets, iron doors, armor equip, trades and fences', () => {
  const state = game(), player = state.players[0]!, get = state.get, gy = 63;
  const use = (dx: number, dz: number, face = 3, y = gy) => send(state, [{ t: 'use', x: X + dx, y, z: Z + dz, face }]);
  player.inv[0] = { id: I.iron_shovel, n: 1 };
  use(1, 0);
  assert.equal(get(X + 1, gy, Z), B.dirt_path);
  assert.equal(player.inv[0]!.d, 1);
  player.inv[0] = { id: I.flint_and_steel, n: 1 };
  use(2, 0);
  assert.equal(get(X + 2, gy + 1, Z), B.fire);
  assert.equal(player.inv[0]!.d, 1);
  writeCell(state, X - 2, gy, Z, B.lava);
  player.inv[0] = { id: I.bucket, n: 1 };
  send(state, [{ t: 'use', x: X - 2, y: gy - 1, z: Z, face: 3 }]);
  assert.deepEqual([get(X - 2, gy, Z), player.inv[0]!.id], [B.air, I.lava_bucket]);
  writeCell(state, X, gy, Z + 2, B.water);
  send(state, [{ t: 'use', x: X, y: gy - 1, z: Z + 2, face: 3 }]);
  assert.deepEqual([get(X, gy, Z + 2), player.inv[0]!.id], [B.obsidian, I.bucket], 'lava poured onto water');
  // Iron doors ignore hands.
  writeCell(state, X - 1, gy + 1, Z - 1, makeCell(B.iron_door, 0));
  writeCell(state, X - 1, gy + 2, Z - 1, makeCell(B.iron_door, DOOR_UPPER));
  player.inv[0] = null;
  use(-1, -1, 3, gy + 1);
  assert.equal(cellState(get(X - 1, gy + 1, Z - 1)), 0);
  // Armor: useItem equips; the trade command needs an open trade screen.
  player.inv[1] = { id: I.diamond_boots, n: 1 };
  send(state, [{ t: 'useItem', slot: 1 }]);
  assert.deepEqual([player.armor[3]?.id, player.inv[1]], [I.diamond_boots, null]);
  const ack = player.ack;
  send(state, [{ t: 'trade', i: 0 }, { t: 'attack', id: 999999 }, { t: 'click', w: 'armor', i: 3, b: 2 }]);
  assert.equal(player.ack, ack + 3);
  assert.equal(player.inv[9]?.id, I.diamond_boots, 'shift-click unequips into the main inventory');
  // Breaking a block beside a fence re-connects the fence through the one write path.
  writeCell(state, X + 4, gy + 1, Z, B.stone);
  writeCell(state, X + 5, gy + 1, Z, makeCell(B.oak_fence, 0));
  assert.equal(cellState(get(X + 5, gy + 1, Z)), 0, 'writeCell does not rewrite the written fence');
  writeCell(state, X + 4, gy + 1, Z, B.air);
  writeCell(state, X + 4, gy + 1, Z, B.cobblestone);
  assert.equal(cellState(get(X + 5, gy + 1, Z)), 0b1000, 'the fence joined the new block to its west');
  writeCell(state, X + 4, gy + 1, Z, B.air);
  assert.equal(cellState(get(X + 5, gy + 1, Z)), 0);
});

test('server: lava buckets fuel furnaces and leave the bucket; beds explode in the Nether', () => {
  const state = game();
  writeCell(state, X + 3, 64, Z, B.furnace);
  const index = X + 3 + 4096 * (Z + 4096 * 64);
  state.furnaces.set(index, { slots: [{ id: B.cobblestone, n: 2 }, { id: I.lava_bucket, n: 1 }, null], burn: 0, burnMax: 0, cook: 0 });
  tickFurnaces(state, 0.05);
  assert.deepEqual([state.furnaces.get(index)!.burnMax, state.furnaces.get(index)!.slots[1]], [1000, { id: I.bucket, n: 1 }]);

  const nx = NETHER.x0 + 100, nether = game([nx, 64, 100]), player = nether.players[0]!;
  writeCell(nether, nx + 2, 64, 100, makeCell(B.bed, 1));
  writeCell(nether, nx + 3, 64, 100, makeCell(B.bed, 1 | 4));
  const health = player.health;
  nether.clock = 1;
  send(nether, [{ t: 'use', x: nx + 2, y: 64, z: 100, face: 3 }]);
  assert.notEqual(cellId(nether.get(nx + 2, 64, 100)), B.bed);
  assert.ok(player.health < health && player.bed === null);
});

test('every simulation write goes through world.writeCell', () => {
  const dir = new URL('../src/sim/', import.meta.url);
  for (const file of readdirSync(dir)) {
    if (file === 'world.ts') continue;
    // Loading a save seeds the journal directly (then notifies the hooks); nothing else may bypass writeCell.
    const text = readFileSync(new URL(file, dir), 'utf8').replace('world.edits.set(index, value);', '');
    assert.ok(!/\.setCell\(|world\.edits\.(set|delete)\(/.test(text), `${file} writes cells directly`);
  }
});

test('worldgen dispatches the sealed Nether region', () => {
  const chunk = generateChunk(5, NETHER.x0 / 16, 31), at = (lx: number, y: number, lz: number) => chunk[localIndex(lx, y, lz)]!;
  for (let y = 0; y < 128; y += 7) assert.equal(at(0, y, 15), B.bedrock, 'x = 3584 and z = 511 are walls');
  for (const lx of [3, 9]) { assert.equal(at(lx, 0, 3), B.bedrock); assert.equal(at(lx, 127, 3), B.bedrock); }
  assert.notEqual(generateChunk(5, NETHER.x0 / 16 - 1, 31)[localIndex(15, 100, 15)], B.bedrock, 'the overworld next door is not walled');
});

// Saves -----------------------------------------------------------------------------------------------------------

test('save v9 round-trips armor and villagers; v8 saves still load', () => {
  const state = game(), player = state.players[0]!;
  player.armor[2] = { id: I.golden_leggings, n: 1, d: 12 };
  const villager = Object.assign(newMob(state, MOB.villager, X + 4.5, 64, Z + 1.5), { p: 2, home: [X + 6, 64, Z] as [number, number, number], uses: [1, 0, 3], seed: 12345 });
  state.mobs.push(villager, Object.assign(newMob(state, MOB.villager, X + 1.5, 64, Z + 1.5), { p: 0, seed: 7 }), newMob(state, MOB.tnt, X, 64, Z), newMob(state, MOB.ghast, X, 80, Z));
  const save = exportSave(saveSource(state)), json = JSON.stringify(save);
  assert.equal(save.version, 9);
  assert.equal(save.animals.length, 0, 'villagers, TNT and ghasts are not animals');
  assert.deepEqual(save.villagers, [{ x: X + 4.5, y: 64, z: Z + 1.5, p: 2, uses: [1, 0, 3], seed: 12345, home: [X + 6, 64, Z] }, { x: X + 1.5, y: 64, z: Z + 1.5, p: 0, uses: [], seed: 7 }]);
  const ctx = { roomId: 'room', roundId: 'r2', seed: 7, nowMs: 0, players: [{ id: 'q', name: 'Ada', color: '#fff' }] };
  const reloaded = parseSave(JSON.parse(json)), loaded = createState(ctx, reloaded.settings, { source: flat, save: reloaded });
  assert.deepEqual(loaded.players[0]!.armor, [null, null, { id: I.golden_leggings, n: 1, d: 12 }, null]);
  const back = loaded.mobs.filter(m => m.t === MOB.villager).map(m => [m.p, m.home, m.uses, m.seed]);
  assert.deepEqual(back, [[2, [X + 6, 64, Z], [1, 0, 3], 12345], [0, null, [], 7]]);
  // A version 8 save predates the expansion terrain its edits would sit on: refused.
  assert.throws(() => parseSave({ ...JSON.parse(json), version: 8 }), { message: OLD_SAVE_MESSAGE });
  // Damaged armor data is refused.
  const wrong = JSON.parse(json) as { players: { armor: unknown }[] };
  wrong.players[0]!.armor = [[0, I.iron_boots, 1]];
  assert.throws(() => parseSave(wrong), /damaged \(armor\)/);
  const villagers = JSON.parse(json) as { villagers: { p: number }[] };
  villagers.villagers[0]!.p = 9;
  assert.throws(() => parseSave(villagers), /damaged \(villagers\)/);
});
