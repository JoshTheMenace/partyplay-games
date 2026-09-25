import { B, BLOCK_LIST, type ToolKind } from './blocks';
import { I, type ItemName } from './ids';
export { B, I, type ItemName };

export type ToolStats = { kind: ToolKind; tier: number; speed: number; durability: number; damage: number };
export type Food = { hunger: number; saturation: number };
export type ItemCategory = 'building' | 'decoration' | 'nature' | 'tools' | 'combat' | 'food' | 'materials' | 'redstone' | 'nether';
/** Armor slots: 0 head, 1 chest, 2 legs, 3 feet (the PrivateView `armor` order and the 'armor' click target index). */
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
export const ARMOR_MATERIALS = ['leather', 'golden', 'iron', 'diamond'] as const;
export type ArmorStats = { slot: 0 | 1 | 2 | 3; material: typeof ARMOR_MATERIALS[number]; points: number; toughness: number };
export type ItemDef = {
  id: number;
  /** Snake-case identifier (block name for block items). */
  key: string;
  /** Display name, e.g. "Stone Pickaxe". */
  name: string;
  /** Max stack size: 64, 16 or 1. */
  stack: number;
  /** Art atlas icon key (block items: the block name; art renders an isometric cube). */
  icon: string;
  category: ItemCategory;
  /** Block this item places (block items place themselves; seeds place wheat...). */
  places?: number;
  tool?: ToolStats;
  /** Wearable armor (durability lives in `durability`). */
  armor?: ArmorStats;
  /** Durability of non-tool damageable items (bow, flint and steel, armor). */
  durability?: number;
  food?: Food;
  /** Furnace burn time in seconds. */
  fuel?: number;
  /** Not shown in the creative palette or recipe book (technical block items like wheat crops). */
  hidden?: boolean;
};

/** Item id for a slot. Empty slots are `null`. `d` is damage used (tools/bow). */
export type Slot = { id: number; n: number; d?: number };

const table: ItemDef[] = [];
const title = (key: string) => key.split('_').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ');
function add(key: ItemName, category: ItemCategory, props: Partial<Omit<ItemDef, 'id' | 'key'>> = {}) {
  const id = I[key];
  table[id] = { id, key, name: title(key), stack: 64, icon: key, category, ...props };
}

// Block items 1..255 share their block id.
const HIDDEN = new Set<number>([B.water, B.furnace_lit, B.wheat, B.carrots, B.potatoes, B.farmland, B.bed, B.oak_door, B.sugar_cane,
  B.lava, B.nether_portal, B.fire, B.redstone_wire, B.redstone_torch_off, B.redstone_lamp_lit, B.repeater, B.piston_head, B.iron_door]);
const NATURE = new Set<number>([B.grass_block, B.dirt, B.sand, B.gravel, B.stone, B.oak_log, B.birch_log, B.spruce_log, B.oak_leaves, B.birch_leaves, B.spruce_leaves,
  B.coal_ore, B.iron_ore, B.gold_ore, B.diamond_ore, B.snow_block, B.snowy_grass, B.ice, B.cactus, B.clay, B.short_grass, B.fern, B.dandelion, B.poppy, B.cornflower,
  B.dead_bush, B.oak_sapling, B.birch_sapling, B.spruce_sapling, B.pumpkin, B.melon, B.bedrock, B.obsidian, B.red_mushroom, B.brown_mushroom, B.emerald_ore, B.redstone_ore, B.dirt_path]);
const DECORATION = new Set<number>([B.crafting_table, B.furnace, B.chest, B.torch, B.ladder, B.lantern, B.bookshelf, B.jack_o_lantern, B.oak_fence, B.cobweb, B.monster_spawner]);
const NETHER_BLOCKS = new Set<number>([B.netherrack, B.soul_sand, B.glowstone, B.nether_quartz_ore, B.nether_gold_ore, B.magma_block, B.nether_bricks, B.quartz_block]);
const REDSTONE_BLOCKS = new Set<number>([B.redstone_torch, B.lever, B.stone_button, B.oak_button, B.stone_pressure_plate, B.oak_pressure_plate, B.redstone_lamp,
  B.piston, B.sticky_piston, B.tnt, B.redstone_block]);
const blockCategory = (id: number): ItemCategory =>
  NATURE.has(id) ? 'nature' : DECORATION.has(id) ? 'decoration' : NETHER_BLOCKS.has(id) ? 'nether' : REDSTONE_BLOCKS.has(id) ? 'redstone' : 'building';
/** Furnace burn seconds for block items (MC values). */
const BLOCK_FUEL = new Map<number, number>([
  ...[B.oak_planks, B.birch_planks, B.spruce_planks, B.oak_log, B.birch_log, B.spruce_log, B.crafting_table, B.chest, B.bookshelf, B.ladder, B.oak_stairs].map(id => [id, 15] as const),
  ...[B.oak_sapling, B.birch_sapling, B.spruce_sapling, B.white_wool, B.red_wool, B.yellow_wool, B.blue_wool, B.green_wool, B.black_wool].map(id => [id, 5] as const),
  [B.oak_slab, 7.5], [B.coal_block, 800], [B.oak_fence, 15], [B.oak_pressure_plate, 15], [B.oak_button, 5],
]);
for (const block of BLOCK_LIST) {
  if (block.id === B.air) continue;
  const fuel = BLOCK_FUEL.get(block.id);
  table[block.id] = {
    id: block.id, key: block.name, name: block.label, stack: 64, icon: block.name, places: block.id,
    category: blockCategory(block.id),
    ...(fuel ? { fuel } : {}), ...(HIDDEN.has(block.id) ? { hidden: true } : {}),
  };
}

for (const key of ['stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'iron_nugget', 'diamond', 'clay_ball', 'brick', 'flint', 'wheat', 'sugar', 'paper', 'book',
  'bone', 'bone_meal', 'string', 'feather', 'gunpowder', 'leather'] as const) add(key, 'materials');
table[I.stick]!.fuel = 5;
table[I.coal]!.fuel = 80;
table[I.charcoal]!.fuel = 80;
add('wheat_seeds', 'nature', { places: B.wheat });
add('sugar_cane', 'nature', { places: B.sugar_cane });
add('egg', 'materials', { stack: 16 });
add('arrow', 'combat');
add('bow', 'combat', { stack: 1, durability: 384, fuel: 15 });
add('bucket', 'tools', { stack: 16 });
add('water_bucket', 'tools', { stack: 1 });
add('shears', 'tools', { stack: 1, tool: { kind: 'shears', tier: 0, speed: 5, durability: 238, damage: 1 } });
add('bed', 'decoration', { stack: 1, places: B.bed });
add('oak_door', 'building', { places: B.oak_door, fuel: 10 });
for (const key of ['glowstone_dust', 'quartz', 'gold_nugget', 'nether_brick', 'emerald'] as const) add(key, 'materials');
add('flint_and_steel', 'tools', { stack: 1, durability: 64, name: 'Flint and Steel' });
add('lava_bucket', 'tools', { stack: 1, fuel: 1000 });
add('redstone', 'redstone', { places: B.redstone_wire });
add('repeater', 'redstone', { places: B.repeater, name: 'Redstone Repeater' });
add('iron_door', 'redstone', { places: B.iron_door });

const FOODS: [ItemName, number, number][] = [
  ['bread', 5, 6], ['apple', 4, 2.4], ['golden_apple', 4, 9.6], ['carrot', 3, 3.6], ['potato', 1, 0.6], ['baked_potato', 5, 6], ['melon_slice', 2, 1.2],
  ['beef', 3, 1.8], ['cooked_beef', 8, 12.8], ['porkchop', 3, 1.8], ['cooked_porkchop', 8, 12.8], ['chicken', 2, 1.2], ['cooked_chicken', 6, 7.2],
  ['mutton', 2, 1.2], ['cooked_mutton', 6, 9.6], ['rotten_flesh', 4, 0.8],
];
for (const [key, hunger, saturation] of FOODS) add(key, 'food', { food: { hunger, saturation } });
table[I.carrot]!.places = B.carrots;
table[I.potato]!.places = B.potatoes;

/** Tool tiers: wooden 1, stone 2, iron 3, diamond 4. */
export const TOOL_TIERS = [['wooden', 2, 59], ['stone', 4, 131], ['iron', 6, 250], ['diamond', 8, 1561]] as const;
const TOOL_DAMAGE: Record<'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword', number> = { pickaxe: 2, axe: 3, shovel: 2, hoe: 1, sword: 4 };
TOOL_TIERS.forEach(([material, speed, durability], index) => {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const) {
    const damage = kind === 'hoe' ? 1 : TOOL_DAMAGE[kind] + index;
    add(`${material}_${kind}`, kind === 'sword' ? 'combat' : 'tools', { stack: 1, tool: { kind, tier: index + 1, speed, durability, damage }, ...(material === 'wooden' ? { fuel: 10 } : {}) });
  }
});

/** Armor (MC values): points per piece, diamond toughness 2, durability = material multiplier × piece base. */
const ARMOR_POINTS = [[1, 3, 2, 1], [2, 5, 3, 1], [2, 6, 5, 2], [3, 8, 6, 3]] as const, ARMOR_MULTIPLIER = [5, 7, 15, 33] as const, ARMOR_BASE = [11, 16, 15, 13] as const;
ARMOR_MATERIALS.forEach((material, m) => ARMOR_PIECES.forEach((piece, slot) => add(`${material}_${piece}`, 'combat', {
  stack: 1, durability: ARMOR_MULTIPLIER[m] * ARMOR_BASE[slot],
  armor: { slot: slot as ArmorStats['slot'], material, points: ARMOR_POINTS[m][slot], toughness: material === 'diamond' ? 2 : 0 },
})));

/** Item definitions indexed by id (holes for unused ids). Prefer `itemOf`. */
export const ITEMS: readonly (ItemDef | undefined)[] = table;
/** Every item in id order (blocks first, then 256+). */
export const ITEM_LIST: readonly ItemDef[] = table.filter((item): item is ItemDef => !!item);
export const isItem = (id: number) => Number.isInteger(id) && !!table[id];
export const itemOf = (id: number): ItemDef | undefined => table[id];
export const itemName = (id: number) => table[id]?.name ?? 'Unknown';
export const maxStack = (id: number) => table[id]?.stack ?? 64;
/** Block placed by an item, 0 if none. */
export const placesBlock = (id: number) => table[id]?.places ?? 0;
/** Damage dealt by a held item (hand = 1). */
export const attackDamage = (id: number) => table[id]?.tool?.damage ?? 1;
/** Armor stats of an item, if it is wearable. */
export const armorOf = (id: number) => table[id]?.armor;
/** Total armor points of worn pieces (0..20; each point is half a chestplate icon). */
export const armorPoints = (armor: readonly (Slot | null)[]) => armor.reduce((sum, slot) => sum + (slot ? table[slot.id]?.armor?.points ?? 0 : 0), 0);
/** Total armor toughness of worn pieces. */
export const armorToughness = (armor: readonly (Slot | null)[]) => armor.reduce((sum, slot) => sum + (slot ? table[slot.id]?.armor?.toughness ?? 0 : 0), 0);
/** Max durability, 0 if the item never wears out. */
export const durabilityOf = (id: number) => table[id]?.tool?.durability ?? table[id]?.durability ?? 0;
/** Item shown for a block in the creative pick / break particles (crops → seeds, bed → bed item, water → water bucket). */
export function itemForBlock(blockId: number): number {
  switch (blockId) {
    case B.wheat: return I.wheat_seeds;
    case B.carrots: return I.carrot;
    case B.potatoes: return I.potato;
    case B.bed: return I.bed;
    case B.oak_door: return I.oak_door;
    case B.sugar_cane: return I.sugar_cane;
    case B.water: return I.water_bucket;
    case B.furnace_lit: return B.furnace;
    case B.farmland: return B.dirt;
    case B.lava: return I.lava_bucket;
    case B.fire: return I.flint_and_steel;
    case B.redstone_wire: return I.redstone;
    case B.redstone_torch_off: return B.redstone_torch;
    case B.redstone_lamp_lit: return B.redstone_lamp;
    case B.repeater: return I.repeater;
    case B.piston_head: return B.piston;
    case B.iron_door: return I.iron_door;
    default: return blockId;
  }
}
