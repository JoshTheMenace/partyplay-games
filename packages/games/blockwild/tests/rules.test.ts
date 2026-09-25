import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awards } from '../src/shared/awards';
import { B, BED_HEAD, DOOR_UPPER, makeCell, SLAB_BOTTOM, SLAB_DOUBLE, SLAB_TOP, STAIRS_TOP } from '../src/shared/blocks';
import type { World } from '../src/shared/chunk';
import { addItem, applyClick, countItem, emptyInventory, emptySlots, FUEL, removeItem, SMELTING, type Containers } from '../src/shared/inventory';
import { I, isItem, ITEM_LIST, type Slot } from '../src/shared/items';
import { breakTime, canHarvest, crackStage, drops } from '../src/shared/mining';
import { canSurvive, isHeldUse, placementFor, usesBlock, type PlaceHit } from '../src/shared/placement';
import { craftFromInventory, craftResult, ingredientsOf, matchGrid, RECIPES, recipeById, type Ingredient, type Recipe } from '../src/shared/recipes';

const first = (ingredient: Ingredient) => typeof ingredient === 'number' ? ingredient : ingredient[0]!;
const last = (ingredient: Ingredient) => typeof ingredient === 'number' ? ingredient : ingredient[ingredient.length - 1]!;
/** Lay a recipe out in a grid of `width`, offset by (ox, oy), optionally mirrored, picking ingredient options with `pick`. */
function layout(recipe: Recipe, width: 2 | 3, ox = 0, oy = 0, mirror = false, pick = first): (Slot | null)[] {
  const grid = emptySlots(width * width);
  if (recipe.items) recipe.items.forEach((ingredient, i) => { grid[i] = { id: pick(ingredient), n: 1 }; });
  else recipe.shape!.forEach((row, y) => [...row].forEach((char, x) => {
    const column = mirror ? row.length - 1 - x : x;
    if (char !== ' ') grid[(oy + y) * width + ox + column] = { id: pick(recipe.key![char]!), n: 1 };
  }));
  return grid;
}

test('every recipe crafts from its exact ingredients: grid, mirrored, offset and recipe book', () => {
  assert.equal(new Set(RECIPES.map(r => r.id)).size, RECIPES.length, 'recipe ids are unique');
  for (const recipe of RECIPES) {
    assert.ok(isItem(recipe.out.id), recipe.id);
    const width = recipe.table ? 3 : 2;
    for (const [grid, label] of [[layout(recipe, width), 'plain'], [layout(recipe, width, 0, 0, true), 'mirrored'], [layout(recipe, width, 0, 0, false, last), 'alternative']] as const) {
      assert.equal(matchGrid(grid, width)?.id, recipe.id, `${recipe.id} (${label})`);
      assert.deepEqual(craftResult(grid, width), recipe.out);
    }
    if (!recipe.table) assert.equal(matchGrid(layout(recipe, 3, 1, 1), 3)?.id, recipe.id, `${recipe.id} fits anywhere in 3×3`);
    // Recipe book: exactly the ingredients in, exactly the output out.
    const inv = emptyInventory();
    for (const ingredient of ingredientsOf(recipe)) addItem(inv, first(ingredient), 1);
    if (recipe.table) assert.equal(craftFromInventory(inv.map(s => s && { ...s }), recipe.id, false), 0, `${recipe.id} needs a table`);
    assert.equal(craftFromInventory(inv, recipe.id, true), 1, recipe.id);
    assert.deepEqual(inv.filter(Boolean), [recipe.out], recipe.id);
  }
});

test('the recipe set covers the whole progression and every craftable block', () => {
  const outputs = new Set(RECIPES.map(r => r.out.id));
  const expected = [
    B.oak_planks, B.birch_planks, B.spruce_planks, I.stick, B.crafting_table, B.furnace, B.chest, B.torch, B.ladder, I.oak_door, I.bed, B.bookshelf,
    B.jack_o_lantern, B.lantern, B.oak_slab, B.cobblestone_slab, B.stone_brick_slab, B.oak_stairs, B.cobblestone_stairs, B.stone_brick_stairs,
    B.stone_bricks, B.bricks, B.sandstone, B.clay, B.mossy_cobblestone, B.white_wool, B.red_wool, B.yellow_wool, B.blue_wool, B.green_wool, B.black_wool,
    B.iron_block, B.gold_block, B.diamond_block, B.coal_block, B.hay_bale, B.melon, I.iron_nugget, I.iron_ingot, I.gold_ingot, I.diamond, I.coal, I.wheat,
    I.bucket, I.shears, I.bow, I.arrow, I.paper, I.book, I.sugar, I.bone_meal, I.bread, I.golden_apple,
    ...ITEM_LIST.filter(item => item.tool && item.tool.kind !== 'shears').map(item => item.id),
  ];
  for (const id of expected) assert.ok(outputs.has(id), `craftable: ${id}`);
  // Crafting with the wrong layout or extra items fails.
  const planks = recipeById('crafting_table')!;
  const grid = layout(planks, 3);
  grid[8] = { id: B.dirt, n: 1 };
  assert.equal(matchGrid(grid, 3), null);
  // Mixed plank types still count as "any planks".
  assert.deepEqual(craftResult([{ id: B.oak_planks, n: 1 }, { id: B.birch_planks, n: 1 }, { id: B.spruce_planks, n: 1 }, { id: B.oak_planks, n: 1 }], 2), { id: B.crafting_table, n: 1 });
  // Recipe book "craft all" stops at the ingredients.
  const inv = emptyInventory();
  addItem(inv, B.oak_log, 5);
  assert.equal(craftFromInventory(inv, 'oak_planks', false, true), 5);
  assert.equal(countItem(inv, B.oak_planks), 20);
});

test('smelting and fuel follow MC', () => {
  assert.equal(SMELTING.get(B.iron_ore), I.iron_ingot);
  assert.equal(SMELTING.get(B.sand), B.glass);
  assert.equal(SMELTING.get(B.cobblestone), B.stone);
  assert.equal(SMELTING.get(B.oak_log), I.charcoal);
  assert.equal(SMELTING.get(I.beef), I.cooked_beef);
  assert.equal(FUEL(I.coal), 80);
  assert.equal(FUEL(B.oak_planks), 15);
  assert.equal(FUEL(I.stick), 5);
  assert.equal(FUEL(I.wooden_pickaxe), 10);
  assert.equal(FUEL(B.coal_block), 800);
  assert.equal(FUEL(B.cobblestone), 0);
});

const craft2 = (grid: readonly (Slot | null)[]) => craftResult(grid, grid.length === 9 ? 3 : 2);
function containers(extra: Partial<Containers> = {}): Containers {
  return { inv: emptyInventory(), cursor: null, grid: emptySlots(4), out: null, screen: null, screenKind: null, ...extra };
}

test('container clicks follow MC semantics', () => {
  const c = containers();
  c.inv[0] = { id: B.dirt, n: 10 };
  c.inv[1] = { id: B.stone, n: 5 };
  // Right-click picks up half (rounded up), left-click places all, right-click places one.
  assert.ok(applyClick(c, 'inv', 0, 1, craft2));
  assert.deepEqual([c.cursor, c.inv[0]], [{ id: B.dirt, n: 5 }, { id: B.dirt, n: 5 }]);
  applyClick(c, 'inv', 9, 1, craft2);
  assert.deepEqual([c.cursor, c.inv[9]], [{ id: B.dirt, n: 4 }, { id: B.dirt, n: 1 }]);
  applyClick(c, 'inv', 0, 0, craft2);
  assert.deepEqual([c.cursor, c.inv[0]], [null, { id: B.dirt, n: 9 }]);
  // Left-click on a different item swaps with the cursor.
  applyClick(c, 'inv', 0, 0, craft2);
  applyClick(c, 'inv', 1, 0, craft2);
  assert.deepEqual([c.cursor, c.inv[1]], [{ id: B.stone, n: 5 }, { id: B.dirt, n: 9 }]);
  applyClick(c, 'inv', 0, 0, craft2);
  // Stacks cap at 64; the rest stays on the cursor.
  c.inv[2] = { id: B.sand, n: 60 };
  c.cursor = { id: B.sand, n: 10 };
  applyClick(c, 'inv', 2, 0, craft2);
  assert.deepEqual([c.cursor, c.inv[2]], [{ id: B.sand, n: 6 }, { id: B.sand, n: 64 }]);
  c.cursor = null;
  // Shift-click moves hotbar ↔ main inventory, merging first.
  c.inv[20] = { id: B.sand, n: 10 };
  applyClick(c, 'inv', 2, 2, craft2);
  assert.equal(c.inv[2], null);
  assert.deepEqual(c.inv[20], { id: B.sand, n: 64 });
  assert.deepEqual(c.inv[9 + 0] ?? c.inv[10], { id: B.dirt, n: 1 });
  // Tools never stack.
  c.inv[3] = { id: I.stone_pickaxe, n: 1, d: 4 };
  c.cursor = { id: I.stone_pickaxe, n: 1 };
  applyClick(c, 'inv', 3, 0, craft2);
  assert.deepEqual([c.cursor, c.inv[3]], [{ id: I.stone_pickaxe, n: 1, d: 4 }, { id: I.stone_pickaxe, n: 1 }]);
});

test('crafting grid output: take once, shift-click crafts as many as fit', () => {
  const c = containers();
  c.inv[0] = { id: B.oak_log, n: 3 };
  applyClick(c, 'inv', 0, 0, craft2);
  applyClick(c, 'grid', 0, 0, craft2);
  assert.deepEqual(c.out, { id: B.oak_planks, n: 4 });
  assert.ok(applyClick(c, 'out', 0, 0, craft2));
  assert.deepEqual(c.cursor, { id: B.oak_planks, n: 4 });
  assert.deepEqual(c.grid[0], { id: B.oak_log, n: 2 });
  // Clicking the output again stacks onto the matching cursor.
  applyClick(c, 'out', 0, 0, craft2);
  assert.deepEqual(c.cursor, { id: B.oak_planks, n: 8 });
  applyClick(c, 'inv', 5, 0, craft2);
  assert.ok(applyClick(c, 'out', 0, 2, craft2));
  assert.equal(c.grid[0], null);
  assert.equal(c.out, null);
  assert.equal(countItem(c.inv, B.oak_planks), 12);
  // A mismatching cursor cannot take the output.
  c.grid[0] = { id: B.oak_log, n: 1 };
  c.out = craft2(c.grid);
  c.cursor = { id: B.dirt, n: 1 };
  assert.equal(applyClick(c, 'out', 0, 0, craft2), false);
});

test('furnace and chest screens: fuel slot takes only fuel, output only gives, shift-click routes', () => {
  const furnace = containers({ screen: emptySlots(3), screenKind: 'furnace' });
  furnace.inv[0] = { id: B.iron_ore, n: 4 };
  furnace.inv[1] = { id: I.coal, n: 2 };
  furnace.inv[2] = { id: B.dirt, n: 2 };
  applyClick(furnace, 'inv', 0, 2, craft2);
  applyClick(furnace, 'inv', 1, 2, craft2);
  assert.deepEqual([...furnace.screen!], [{ id: B.iron_ore, n: 4 }, { id: I.coal, n: 2 }, null]);
  applyClick(furnace, 'inv', 2, 0, craft2);
  assert.equal(applyClick(furnace, 'screen', 1, 0, craft2), false, 'dirt is not fuel');
  assert.deepEqual(furnace.screen![1], { id: I.coal, n: 2 });
  furnace.cursor = { id: I.iron_ingot, n: 1 };
  furnace.screen![2] = { id: I.iron_ingot, n: 3 };
  applyClick(furnace, 'screen', 2, 0, craft2);
  assert.deepEqual([furnace.cursor, furnace.screen![2]], [{ id: I.iron_ingot, n: 4 }, null], 'output collects onto a matching cursor');
  const chest = containers({ screen: emptySlots(27), screenKind: 'chest' });
  chest.inv[4] = { id: B.cobblestone, n: 64 };
  applyClick(chest, 'inv', 4, 2, craft2);
  assert.deepEqual(chest.screen![0], { id: B.cobblestone, n: 64 });
  applyClick(chest, 'screen', 0, 2, craft2);
  assert.deepEqual(chest.inv[0], { id: B.cobblestone, n: 64 });
});

test('inventory helpers are all-or-nothing and hotbar-first', () => {
  const inv = emptyInventory();
  assert.equal(addItem(inv, B.dirt, 100), 0);
  assert.deepEqual([inv[0], inv[1]], [{ id: B.dirt, n: 64 }, { id: B.dirt, n: 36 }]);
  assert.equal(removeItem(inv, B.dirt, 101), false);
  assert.equal(countItem(inv, B.dirt), 100);
  assert.equal(removeItem(inv, B.dirt, 40), true);
  assert.deepEqual(inv[0], { id: B.dirt, n: 60 });
  for (let i = 0; i < 36; i++) inv[i] = { id: I.bow, n: 1 };
  assert.equal(addItem(inv, B.dirt, 5), 5);
});

/** Map-backed world: grass up to y = 63, air above, plus overrides. Tests work around (100, 100) to stay inside the world. */
const O = 100;
function world(cells: [number, number, number, number][] = []): World {
  const map = new Map(cells.map(([x, y, z, v]) => [`${x + O},${y},${z + O}`, v]));
  return { getCell: (x, y, z) => map.get(`${x},${y},${z}`) ?? (y <= 63 ? B.grass_block : B.air) };
}
/** Placement relative to the origin (O, O): translates the hit in and the writes back out. */
function place(w: World, item: number, hit: PlaceHit, yaw = 0) {
  const writes = placementFor(w, item, { ...hit, x: hit.x + O, z: hit.z + O }, yaw);
  return writes && writes.map(([x, y, z, v]) => [x - O, y, z - O, v]);
}
const top = (x = 0, z = 0): PlaceHit => ({ x, y: 63, z, face: 3 });

test('placement: slabs merge, stairs and slabs pick halves, facing blocks face the player', () => {
  const w = world([[0, 64, 0, B.stone]]);
  assert.deepEqual(place(w, B.oak_slab, top(3, 3)), [[3, 64, 3, makeCell(B.oak_slab, SLAB_BOTTOM)]]);
  assert.deepEqual(place(w, B.oak_slab, { x: 0, y: 64, z: 0, face: 1, hy: 0.8 }), [[1, 64, 0, makeCell(B.oak_slab, SLAB_TOP)]], 'upper half of a side face');
  assert.deepEqual(place(w, B.oak_slab, { x: 0, y: 64, z: 0, face: 2 }), null, 'below is the ground');
  const slabbed = world([[0, 64, 0, makeCell(B.oak_slab, SLAB_BOTTOM)], [2, 64, 0, makeCell(B.oak_slab, SLAB_TOP)]]);
  assert.deepEqual(place(slabbed, B.oak_slab, { x: 0, y: 64, z: 0, face: 3 }), [[0, 64, 0, makeCell(B.oak_slab, SLAB_DOUBLE)]]);
  assert.deepEqual(place(slabbed, B.oak_slab, top(2, 0)), [[2, 64, 0, makeCell(B.oak_slab, SLAB_DOUBLE)]], 'placing into a half slab fills it');
  assert.deepEqual(place(slabbed, B.cobblestone_slab, { x: 0, y: 64, z: 0, face: 3 }), [[0, 65, 0, B.cobblestone_slab]], 'different slabs never merge');
  assert.deepEqual(place(w, B.oak_stairs, top(3, 3), Math.PI / 2), [[3, 64, 3, makeCell(B.oak_stairs, 3)]], 'looking west');
  assert.deepEqual(place(w, B.oak_stairs, { x: 0, y: 64, z: 0, face: 5, hy: 0.9 }), [[0, 64, 1, makeCell(B.oak_stairs, STAIRS_TOP)]], 'upside down');
  assert.deepEqual(place(w, B.furnace, top(3, 3)), [[3, 64, 3, makeCell(B.furnace, 2)]], 'front faces back at a north-looking player');
  assert.deepEqual(place(w, B.oak_log, { x: 0, y: 64, z: 0, face: 4 }), [[0, 64, -1, makeCell(B.oak_log, 2)]], 'log along Z');
  assert.deepEqual(place(w, B.oak_log, { x: 0, y: 64, z: 0, face: 3 }), [[0, 65, 0, B.oak_log]], 'upright log');
  assert.equal(place(w, B.stone, { x: 0, y: 127, z: 0, face: 3 }), null, 'above the world');
  assert.equal(place(w, I.stick, top()), null, 'sticks place nothing');
});

test('placement: supports for torches, ladders, plants, cactus, doors and beds', () => {
  const w = world([[0, 64, 0, B.stone], [5, 64, 0, B.water], [0, 64, 5, makeCell(B.oak_slab, SLAB_BOTTOM)], [9, 63, 0, B.sand], [9, 63, 3, B.sand], [10, 64, 3, B.stone], [7, 63, 7, B.farmland], [3, 64, 3, B.short_grass], [5, 63, 1, B.water]]);
  assert.deepEqual(place(w, B.torch, top(3, 0)), [[3, 64, 0, B.torch]]);
  assert.deepEqual(place(w, B.torch, { x: 0, y: 64, z: 0, face: 1 }), [[1, 64, 0, makeCell(B.torch, 2)]], 'wall torch on the east face');
  assert.equal(place(w, B.torch, { x: 0, y: 64, z: 0, face: 2 }), null, 'no ceiling torches');
  assert.equal(place(w, B.torch, { x: 0, y: 64, z: 5, face: 3 }), null, 'not on a bottom slab');
  assert.equal(place(w, B.torch, { x: 5, y: 63, z: 0, face: 3 }), null, 'not into water');
  assert.deepEqual(place(w, B.stone, { x: 5, y: 63, z: 0, face: 3 }), [[5, 64, 0, B.stone]], 'solid blocks replace water');
  assert.deepEqual(place(w, B.ladder, { x: 0, y: 64, z: 0, face: 4 }), [[0, 64, -1, makeCell(B.ladder, 0)]]);
  assert.equal(place(w, B.ladder, top(3, 0)), null, 'ladders need a wall');
  assert.deepEqual(place(w, B.stone, { x: 3, y: 64, z: 3, face: 4 }), [[3, 64, 3, B.stone]], 'tall grass is replaced in place');
  assert.deepEqual(place(w, B.cactus, top(9, 0)), [[9, 64, 0, B.cactus]]);
  assert.equal(place(w, B.cactus, top(9, 3)), null, 'cactus next to a block');
  assert.equal(place(w, B.cactus, top(3, 0)), null, 'cactus needs sand');
  assert.deepEqual(place(w, I.sugar_cane, top(4, 1)), [[4, 64, 1, B.sugar_cane]], 'sugar cane on soil beside water');
  assert.equal(place(w, I.sugar_cane, top(2, 2)), null, 'sugar cane needs water');
  assert.deepEqual(place(w, I.wheat_seeds, top(7, 7)), [[7, 64, 7, B.wheat]]);
  assert.equal(place(w, I.carrot, top(3, 0)), null, 'crops need farmland');
  assert.deepEqual(place(w, B.oak_sapling, top(1, 1)), [[1, 64, 1, B.oak_sapling]]);
  assert.equal(place(w, B.oak_sapling, { x: 0, y: 64, z: 0, face: 3 }), null, 'saplings need soil');
  assert.deepEqual(place(w, I.oak_door, top(2, 0)), [[2, 64, 0, makeCell(B.oak_door, 0)], [2, 65, 0, makeCell(B.oak_door, DOOR_UPPER)]]);
  assert.equal(place(world([[2, 65, 0, B.stone]]), I.oak_door, top(2, 0)), null, 'doors need two free cells');
  assert.deepEqual(place(w, I.bed, top(2, 2), Math.PI), [[2, 64, 2, makeCell(B.bed, 2)], [2, 64, 3, makeCell(B.bed, 2 | BED_HEAD)]], 'bed head away from a south-looking player');
  assert.equal(place(w, I.bed, top(10, 4)), null, 'bed head blocked');
  // Support loss.
  assert.equal(canSurvive(world([[1, 64, 0, makeCell(B.torch, 2)]]), O + 1, 64, O), false);
  assert.equal(canSurvive(world([[0, 64, 0, B.stone], [1, 64, 0, makeCell(B.torch, 2)]]), O + 1, 64, O), true);
});

test('right-click routing and held uses', () => {
  assert.equal(usesBlock(B.crafting_table, 0, false), true);
  assert.equal(usesBlock(B.crafting_table, B.stone, true), false, 'sneak-placing against a table');
  assert.equal(usesBlock(B.grass_block, I.stone_hoe, false), true);
  assert.equal(usesBlock(B.grass_block, B.stone, false), false);
  assert.equal(usesBlock(makeCell(B.wheat, 3), I.bone_meal, false), true);
  assert.equal(usesBlock(makeCell(B.wheat, 7), I.bone_meal, false), false);
  assert.equal(isHeldUse(I.bread, 12), true);
  assert.equal(isHeldUse(I.bread, 20), false);
  assert.equal(isHeldUse(I.golden_apple, 20), true);
  assert.equal(isHeldUse(I.bow, 20), true);
});

test('mining: MC break times, tool tiers and drops', () => {
  assert.equal(breakTime(B.stone, 0, true, false), 7.5);
  assert.equal(breakTime(B.stone, I.wooden_pickaxe, true, false), 1.125);
  assert.equal(breakTime(B.stone, I.diamond_pickaxe, true, false), 0.28125);
  assert.equal(breakTime(B.stone, I.wooden_pickaxe, false, false), 1.125 * 5, 'airborne');
  assert.equal(breakTime(B.stone, I.wooden_pickaxe, true, true), 1.125 * 5, 'underwater');
  assert.equal(breakTime(B.dirt, I.iron_shovel, true, false), 0.125);
  assert.equal(breakTime(B.oak_log, I.stone_axe, true, false), 0.75);
  assert.equal(breakTime(B.bedrock, I.diamond_pickaxe, true, false), Infinity);
  assert.equal(breakTime(B.torch, 0, true, false), 0);
  assert.ok(breakTime(B.obsidian, I.diamond_pickaxe, true, false) > 9 && breakTime(B.obsidian, I.iron_pickaxe, true, false) > 40);
  assert.ok(breakTime(B.oak_leaves, I.shears, true, false) < breakTime(B.oak_leaves, 0, true, false));
  assert.equal(canHarvest(B.iron_ore, I.wooden_pickaxe), false);
  assert.equal(canHarvest(B.iron_ore, I.stone_pickaxe), true);
  assert.equal(canHarvest(B.diamond_ore, I.stone_pickaxe), false);
  assert.equal(canHarvest(B.diamond_ore, I.iron_pickaxe), true);
  assert.equal(canHarvest(B.obsidian, I.iron_pickaxe), false);
  assert.equal(canHarvest(B.obsidian, I.diamond_pickaxe), true);
  const always = () => 0;
  assert.deepEqual(drops(B.stone, 0, always), []);
  assert.deepEqual(drops(B.stone, I.wooden_pickaxe, always), [{ id: B.cobblestone, n: 1 }]);
  assert.deepEqual(drops(B.grass_block, 0, always), [{ id: B.dirt, n: 1 }]);
  assert.deepEqual(drops(B.diamond_ore, I.iron_pickaxe, always), [{ id: I.diamond, n: 1 }]);
  assert.deepEqual(drops(B.glass, 0, always), []);
  assert.deepEqual(drops(B.oak_leaves, I.shears, always), [{ id: B.oak_leaves, n: 1 }]);
  assert.deepEqual(drops(B.short_grass, 0, () => 0.99), []);
  assert.deepEqual(drops(makeCell(B.wheat, 7), 0, always).map(d => d.id).sort(), [I.wheat, I.wheat_seeds].sort());
  assert.deepEqual(drops(makeCell(B.oak_slab, SLAB_DOUBLE), 0, always), [{ id: B.oak_slab, n: 2 }]);
  assert.deepEqual([crackStage(0), crackStage(0.55), crackStage(2)], [0, 5, 9]);
});

test('journal awards need real effort; a solo explorer gets at most two personal highlights', () => {
  const entry = (id: string, mined: number, placed: number, deaths = 0, distance = 0) => ({ id, mined, placed, crafted: 4, mobs: 1, deaths, distance });
  const group = awards([entry('a', 30, 19), entry('b', 30, 5, 1), entry('c', 2, 0)]);
  assert.deepEqual(group.map(award => [award.title, award.ids]), [['Top miner', ['a', 'b']], ['Never fell', ['a', 'c']]], 'placing 19 is not a master builder');
  assert.deepEqual(awards([entry('a', 1, 1, 2), entry('b', 0, 0, 1)]), [], 'nothing earned');
  const solo = awards([entry('me', 60, 21, 0, 900)]);
  assert.deepEqual(solo.map(award => award.title), ['Miner', 'Explorer'], 'furthest past the minimum first, capped at two');
  assert.deepEqual(awards([entry('me', 3, 0)]).map(award => award.title), ['Never fell']);
  assert.ok(!solo.some(award => /Top|Master|Chief/.test(award.title)), 'no superlatives without rivals');
});
