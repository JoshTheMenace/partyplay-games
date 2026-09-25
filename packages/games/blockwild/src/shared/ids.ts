/** Block ids (also the item id of the matching block item). Fixed forever: saves store them. */
export const B = {
  air: 0, stone: 1, grass_block: 2, dirt: 3, cobblestone: 4, oak_planks: 5, bedrock: 6, sand: 7, gravel: 8, oak_log: 9,
  oak_leaves: 10, glass: 11, coal_ore: 12, iron_ore: 13, gold_ore: 14, diamond_ore: 15, crafting_table: 16, furnace: 17, furnace_lit: 18, chest: 19,
  torch: 20, water: 21, sandstone: 22, birch_log: 23, birch_leaves: 24, birch_planks: 25, spruce_log: 26, spruce_leaves: 27, spruce_planks: 28, snow_block: 29,
  snowy_grass: 30, ice: 31, cactus: 32, clay: 33, bricks: 34, stone_bricks: 35, mossy_cobblestone: 36, short_grass: 37, fern: 38, dandelion: 39,
  poppy: 40, cornflower: 41, dead_bush: 42, sugar_cane: 43, oak_sapling: 44, birch_sapling: 45, spruce_sapling: 46, wheat: 47, carrots: 48, potatoes: 49,
  farmland: 50, bed: 51, ladder: 52, oak_door: 53, oak_slab: 54, cobblestone_slab: 55, stone_brick_slab: 56, oak_stairs: 57, cobblestone_stairs: 58, stone_brick_stairs: 59,
  lantern: 60, white_wool: 61, red_wool: 62, yellow_wool: 63, blue_wool: 64, green_wool: 65, black_wool: 66, bookshelf: 67, pumpkin: 68, jack_o_lantern: 69,
  melon: 70, hay_bale: 71, iron_block: 72, gold_block: 73, diamond_block: 74, coal_block: 75, terracotta: 76, obsidian: 77,
  // Expansion: the Nether, structures and redstone.
  netherrack: 78, soul_sand: 79, glowstone: 80, nether_quartz_ore: 81, nether_gold_ore: 82, lava: 83, magma_block: 84, nether_bricks: 85, quartz_block: 86, nether_portal: 87,
  fire: 88, red_mushroom: 89, brown_mushroom: 90, cobweb: 91, oak_fence: 92, monster_spawner: 93, emerald_ore: 94, emerald_block: 95, chiseled_sandstone: 96, cut_sandstone: 97,
  sandstone_stairs: 98, sandstone_slab: 99, dirt_path: 100, cracked_stone_bricks: 101, mossy_stone_bricks: 102, redstone_ore: 103, redstone_wire: 104, redstone_torch: 105, redstone_torch_off: 106, lever: 107,
  stone_button: 108, oak_button: 109, stone_pressure_plate: 110, oak_pressure_plate: 111, redstone_lamp: 112, redstone_lamp_lit: 113, repeater: 114, piston: 115, sticky_piston: 116, piston_head: 117,
  iron_door: 118, tnt: 119, redstone_block: 120,
  /** Invisible solid wall returned outside the world's horizontal bounds. Never stored. */
  barrier: 255,
} as const;
export type BlockName = keyof typeof B;

/** Non-block item ids (256+). Block items use their block id from `B`. */
export const I = {
  stick: 256, coal: 257, charcoal: 258, iron_ingot: 259, gold_ingot: 260, iron_nugget: 261, diamond: 262, clay_ball: 263, brick: 264, flint: 265,
  wheat_seeds: 266, wheat: 267, bread: 268, apple: 269, golden_apple: 270, carrot: 271, potato: 272, baked_potato: 273, sugar_cane: 274, sugar: 275,
  paper: 276, book: 277, melon_slice: 278, beef: 279, cooked_beef: 280, porkchop: 281, cooked_porkchop: 282, chicken: 283, cooked_chicken: 284, mutton: 285,
  cooked_mutton: 286, rotten_flesh: 287, bone: 288, bone_meal: 289, string: 290, feather: 291, gunpowder: 292, leather: 293, egg: 294, arrow: 295,
  bow: 296, bucket: 297, water_bucket: 298, shears: 299, bed: 300, oak_door: 301,
  wooden_pickaxe: 302, wooden_axe: 303, wooden_shovel: 304, wooden_hoe: 305, wooden_sword: 306,
  stone_pickaxe: 307, stone_axe: 308, stone_shovel: 309, stone_hoe: 310, stone_sword: 311,
  iron_pickaxe: 312, iron_axe: 313, iron_shovel: 314, iron_hoe: 315, iron_sword: 316,
  diamond_pickaxe: 317, diamond_axe: 318, diamond_shovel: 319, diamond_hoe: 320, diamond_sword: 321,
  // Expansion.
  glowstone_dust: 322, quartz: 323, gold_nugget: 324, nether_brick: 325, emerald: 326, flint_and_steel: 327, lava_bucket: 328, redstone: 329, repeater: 330, iron_door: 331,
  leather_helmet: 332, leather_chestplate: 333, leather_leggings: 334, leather_boots: 335,
  golden_helmet: 336, golden_chestplate: 337, golden_leggings: 338, golden_boots: 339,
  iron_helmet: 340, iron_chestplate: 341, iron_leggings: 342, iron_boots: 343,
  diamond_helmet: 344, diamond_chestplate: 345, diamond_leggings: 346, diamond_boots: 347,
} as const;
export type ItemName = keyof typeof I;
