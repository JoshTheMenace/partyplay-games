/**
 * Crafting recipes (MC-style shaped with mirroring, and shapeless) plus grid matching and recipe-book crafting.
 * Shared by the server (authoritative) and the client (recipe book, prediction). Furnace data lives in inventory.ts.
 */
import { B } from './blocks';
import { addItem, countItem, removeItem, spaceFor } from './inventory';
import { ARMOR_MATERIALS, ARMOR_PIECES, I, itemOf, type ItemCategory, type Slot } from './items';
export { FUEL, SMELT_SECONDS, SMELTING } from './inventory';

/** One item id or a set of interchangeable ids (e.g. any planks). */
export type Ingredient = number | readonly number[];
export type Recipe = {
  id: string; out: Slot; category: ItemCategory;
  /** Needs the 3×3 crafting table grid. */
  table: boolean;
  /** Shaped: rows of key characters (' ' = empty); matched anywhere in the grid, mirrored too. */
  shape?: readonly string[]; key?: Readonly<Record<string, Ingredient>>;
  /** Shapeless ingredient list. */
  items?: readonly Ingredient[];
};

const PLANKS = [B.oak_planks, B.birch_planks, B.spruce_planks] as const;
const WOOL = [B.white_wool, B.red_wool, B.yellow_wool, B.blue_wool, B.green_wool, B.black_wool] as const;
const list: Recipe[] = [];
const categoryOf = (id: number): ItemCategory => itemOf(id)?.category ?? 'materials';
const keyOf = (id: number) => itemOf(id)?.key ?? String(id);
function shaped(out: number, n: number, shape: readonly string[], key: Record<string, Ingredient>, id = keyOf(out)) {
  list.push({ id, out: { id: out, n }, category: categoryOf(out), table: shape.length > 2 || shape.some(row => row.length > 2), shape, key });
}
function shapeless(out: number, n: number, items: readonly Ingredient[], id = keyOf(out)) {
  list.push({ id, out: { id: out, n }, category: categoryOf(out), table: items.length > 4, items });
}

// Wood basics.
shapeless(B.oak_planks, 4, [B.oak_log]);
shapeless(B.birch_planks, 4, [B.birch_log]);
shapeless(B.spruce_planks, 4, [B.spruce_log]);
shaped(I.stick, 4, ['P', 'P'], { P: PLANKS });
shaped(B.crafting_table, 1, ['PP', 'PP'], { P: PLANKS });
shaped(I.wooden_pickaxe, 1, ['XXX', ' # ', ' # '], { X: PLANKS, '#': I.stick });
shaped(I.wooden_axe, 1, ['XX', 'X#', ' #'], { X: PLANKS, '#': I.stick });
shaped(I.wooden_shovel, 1, ['X', '#', '#'], { X: PLANKS, '#': I.stick });
shaped(I.wooden_hoe, 1, ['XX', ' #', ' #'], { X: PLANKS, '#': I.stick });
shaped(I.wooden_sword, 1, ['X', 'X', '#'], { X: PLANKS, '#': I.stick });
for (const [material, ingredient] of [['stone', B.cobblestone], ['iron', I.iron_ingot], ['diamond', I.diamond]] as const) {
  shaped(I[`${material}_pickaxe`], 1, ['XXX', ' # ', ' # '], { X: ingredient, '#': I.stick });
  shaped(I[`${material}_axe`], 1, ['XX', 'X#', ' #'], { X: ingredient, '#': I.stick });
  shaped(I[`${material}_shovel`], 1, ['X', '#', '#'], { X: ingredient, '#': I.stick });
  shaped(I[`${material}_hoe`], 1, ['XX', ' #', ' #'], { X: ingredient, '#': I.stick });
  shaped(I[`${material}_sword`], 1, ['X', 'X', '#'], { X: ingredient, '#': I.stick });
}
// Stations and furniture.
shaped(B.furnace, 1, ['XXX', 'X X', 'XXX'], { X: B.cobblestone });
shaped(B.chest, 1, ['XXX', 'X X', 'XXX'], { X: PLANKS });
shaped(B.torch, 4, ['C', '#'], { C: [I.coal, I.charcoal], '#': I.stick });
shaped(B.ladder, 3, ['# #', '###', '# #'], { '#': I.stick });
shaped(I.oak_door, 3, ['XX', 'XX', 'XX'], { X: PLANKS });
shaped(I.bed, 1, ['WWW', 'PPP'], { W: WOOL, P: PLANKS });
shaped(B.bookshelf, 1, ['PPP', 'BBB', 'PPP'], { P: PLANKS, B: I.book });
shaped(B.jack_o_lantern, 1, ['P', 'T'], { P: B.pumpkin, T: B.torch });
shaped(B.lantern, 1, ['NNN', 'NTN', 'NNN'], { N: I.iron_nugget, T: B.torch });
// Building blocks.
shaped(B.oak_slab, 6, ['XXX'], { X: PLANKS });
shaped(B.cobblestone_slab, 6, ['XXX'], { X: B.cobblestone });
shaped(B.stone_brick_slab, 6, ['XXX'], { X: B.stone_bricks });
shaped(B.oak_stairs, 4, ['X  ', 'XX ', 'XXX'], { X: PLANKS });
shaped(B.cobblestone_stairs, 4, ['X  ', 'XX ', 'XXX'], { X: B.cobblestone });
shaped(B.stone_brick_stairs, 4, ['X  ', 'XX ', 'XXX'], { X: B.stone_bricks });
shaped(B.stone_bricks, 4, ['XX', 'XX'], { X: B.stone });
shaped(B.bricks, 1, ['XX', 'XX'], { X: I.brick });
shaped(B.sandstone, 1, ['XX', 'XX'], { X: B.sand });
shaped(B.clay, 1, ['XX', 'XX'], { X: I.clay_ball });
shapeless(B.mossy_cobblestone, 1, [B.cobblestone, B.short_grass]);
shaped(B.white_wool, 1, ['SS', 'SS'], { S: I.string });
shapeless(B.red_wool, 1, [B.white_wool, B.poppy]);
shapeless(B.yellow_wool, 1, [B.white_wool, B.dandelion]);
shapeless(B.blue_wool, 1, [B.white_wool, B.cornflower]);
shapeless(B.green_wool, 1, [B.white_wool, B.cactus]);
shapeless(B.black_wool, 1, [B.white_wool, [I.coal, I.charcoal]]);
// Storage blocks.
for (const [block, item] of [[B.iron_block, I.iron_ingot], [B.gold_block, I.gold_ingot], [B.diamond_block, I.diamond], [B.coal_block, I.coal], [B.hay_bale, I.wheat], [B.melon, I.melon_slice],
  [B.emerald_block, I.emerald], [B.redstone_block, I.redstone]] as const) {
  shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: item });
  if (block !== B.melon) shapeless(item, 9, [block], `${keyOf(item)}_from_${keyOf(block)}`);
}
shapeless(I.iron_nugget, 9, [I.iron_ingot]);
shaped(I.iron_ingot, 1, ['NNN', 'NNN', 'NNN'], { N: I.iron_nugget }, 'iron_ingot_from_nuggets');
shapeless(I.gold_nugget, 9, [I.gold_ingot]);
shaped(I.gold_ingot, 1, ['NNN', 'NNN', 'NNN'], { N: I.gold_nugget }, 'gold_ingot_from_nuggets');
// Nether and structure blocks.
shaped(B.nether_bricks, 1, ['XX', 'XX'], { X: I.nether_brick });
shaped(B.quartz_block, 1, ['XX', 'XX'], { X: I.quartz });
shaped(B.glowstone, 1, ['XX', 'XX'], { X: I.glowstone_dust });
shaped(B.cut_sandstone, 4, ['XX', 'XX'], { X: B.sandstone });
shaped(B.chiseled_sandstone, 1, ['X', 'X'], { X: B.sandstone_slab });
shaped(B.sandstone_stairs, 4, ['X  ', 'XX ', 'XXX'], { X: B.sandstone });
shaped(B.sandstone_slab, 6, ['XXX'], { X: B.sandstone });
shapeless(B.mossy_stone_bricks, 1, [B.stone_bricks, B.short_grass]);
shaped(B.oak_fence, 3, ['P#P', 'P#P'], { P: PLANKS, '#': I.stick });
// Armor and combat.
ARMOR_MATERIALS.forEach((material, m) => {
  const X = [I.leather, I.gold_ingot, I.iron_ingot, I.diamond][m]!;
  const shapes = [['XXX', 'X X'], ['X X', 'XXX', 'XXX'], ['XXX', 'X X', 'X X'], ['X X', 'X X']];
  ARMOR_PIECES.forEach((piece, slot) => shaped(I[`${material}_${piece}`], 1, shapes[slot]!, { X }));
});
shapeless(I.flint_and_steel, 1, [I.iron_ingot, I.flint]);
shaped(B.tnt, 1, ['GSG', 'SGS', 'GSG'], { G: I.gunpowder, S: B.sand });
// Redstone.
shaped(B.redstone_torch, 1, ['R', '#'], { R: I.redstone, '#': I.stick });
shaped(B.lever, 1, ['#', 'C'], { '#': I.stick, C: B.cobblestone });
shapeless(B.stone_button, 1, [B.stone]);
shapeless(B.oak_button, 1, [PLANKS]);
shaped(B.stone_pressure_plate, 1, ['XX'], { X: B.stone });
shaped(B.oak_pressure_plate, 1, ['XX'], { X: PLANKS });
shaped(I.repeater, 1, ['TRT', 'SSS'], { T: B.redstone_torch, R: I.redstone, S: B.stone });
shaped(B.redstone_lamp, 1, [' R ', 'RGR', ' R '], { R: I.redstone, G: B.glowstone });
shaped(B.piston, 1, ['PPP', 'CIC', 'CRC'], { P: PLANKS, C: B.cobblestone, I: I.iron_ingot, R: I.redstone });
shapeless(B.sticky_piston, 1, [B.piston, I.string, I.string]);
shaped(I.iron_door, 3, ['XX', 'XX', 'XX'], { X: I.iron_ingot });
// Items and food.
shaped(I.bucket, 1, ['I I', ' I '], { I: I.iron_ingot });
shaped(I.shears, 1, [' I', 'I '], { I: I.iron_ingot });
shaped(I.bow, 1, [' #S', '# S', ' #S'], { '#': I.stick, S: I.string });
shaped(I.arrow, 4, ['F', '#', 'E'], { F: I.flint, '#': I.stick, E: I.feather });
shaped(I.paper, 3, ['SSS'], { S: I.sugar_cane });
shapeless(I.book, 1, [I.paper, I.paper, I.paper, I.leather]);
shapeless(I.sugar, 1, [I.sugar_cane]);
shapeless(I.bone_meal, 3, [I.bone]);
shaped(I.bread, 1, ['WWW'], { W: I.wheat });
shaped(I.golden_apple, 1, ['GGG', 'GAG', 'GGG'], { G: I.gold_ingot, A: I.apple });

export const RECIPES: readonly Recipe[] = list;
const byId = new Map(list.map(recipe => [recipe.id, recipe]));
export const recipeById = (id: string) => byId.get(id);

const accepts = (ingredient: Ingredient, id: number) => typeof ingredient === 'number' ? ingredient === id : ingredient.includes(id);
const mirror = (shape: readonly string[]) => shape.map(row => [...row].reverse().join(''));

/** Recipe matching the crafting grid (width 2 or 3, row-major), or null. */
export function matchGrid(grid: readonly (Slot | null)[], width: 2 | 3): Recipe | null {
  let x0: number = width, y0: number = width, x1 = -1, y1 = -1;
  const ids: number[] = [];
  grid.forEach((slot, i) => {
    if (!slot) return;
    const x = i % width, y = Math.floor(i / width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    ids.push(slot.id);
  });
  if (!ids.length) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const at = (x: number, y: number) => grid[(y0 + y) * width + x0 + x]?.id ?? 0;
  const fits = (shape: readonly string[], key: Readonly<Record<string, Ingredient>>) =>
    shape.every((row, y) => [...row].every((char, x) => char === ' ' ? at(x, y) === 0 : accepts(key[char]!, at(x, y))));
  for (const recipe of list) {
    if (recipe.table && width < 3) continue;
    if (recipe.shape && recipe.key) {
      if (recipe.shape.length !== h || recipe.shape[0]!.length !== w) continue;
      if (fits(recipe.shape, recipe.key) || fits(mirror(recipe.shape), recipe.key)) return recipe;
    } else if (recipe.items && recipe.items.length === ids.length && shapelessFits(recipe.items, ids)) return recipe;
  }
  return null;
}
function shapelessFits(items: readonly Ingredient[], ids: readonly number[]): boolean {
  const left = [...ids];
  // Most specific ingredients first so alternatives do not steal their items.
  for (const ingredient of [...items].sort((a, b) => (typeof a === 'number' ? 1 : a.length) - (typeof b === 'number' ? 1 : b.length))) {
    const index = left.findIndex(id => accepts(ingredient, id));
    if (index < 0) return false;
    left.splice(index, 1);
  }
  return true;
}
/** Output stack for a grid (the `craft` callback for inventory.applyClick). */
export const craftResult = (grid: readonly (Slot | null)[], width: 2 | 3): Slot | null => {
  const recipe = matchGrid(grid, width);
  return recipe ? { ...recipe.out } : null;
};

/** Ingredient list of a recipe, one entry per consumed item. */
export const ingredientsOf = (recipe: Recipe): Ingredient[] =>
  recipe.items ? [...recipe.items] : recipe.shape!.flatMap(row => [...row].filter(char => char !== ' ').map(char => recipe.key![char]!));

/** Pick concrete item ids for each ingredient from what the inventory holds, or null if missing. */
function planCraft(inv: readonly (Slot | null)[], recipe: Recipe): Map<number, number> | null {
  const use = new Map<number, number>();
  for (const ingredient of ingredientsOf(recipe)) {
    const options = typeof ingredient === 'number' ? [ingredient] : ingredient;
    const id = options.find(option => countItem(inv, option) > (use.get(option) ?? 0));
    if (id === undefined) return null;
    use.set(id, (use.get(id) ?? 0) + 1);
  }
  return use;
}
/** True if the inventory has the ingredients (and a table is near for 3×3 recipes). */
export const canCraft = (inv: readonly (Slot | null)[], recipe: Recipe, nearTable: boolean) => (!recipe.table || nearTable) && !!planCraft(inv, recipe);

/** Recipe-book craft straight from inventory ingredients. Crafts once, or as many times as possible with `max`. Returns times crafted. */
export function craftFromInventory(inv: (Slot | null)[], recipeId: string, nearTable: boolean, max = false): number {
  const recipe = recipeById(recipeId);
  if (!recipe || recipe.table && !nearTable) return 0;
  let times = 0;
  while (times < (max ? 64 : 1)) {
    const plan = planCraft(inv, recipe);
    if (!plan) break;
    const trial = inv.map(slot => slot && { ...slot });
    for (const [id, n] of plan) removeItem(trial, id, n);
    if (spaceFor(trial, recipe.out.id) < recipe.out.n) break;
    addItem(trial, recipe.out.id, recipe.out.n);
    trial.forEach((slot, i) => { inv[i] = slot; });
    times++;
  }
  return times;
}
