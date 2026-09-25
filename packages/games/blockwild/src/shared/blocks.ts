import { FACING_FACE } from './coords';
import { B, I, type BlockName } from './ids';
export { B, I, type BlockName };

export type Shape = 'air' | 'cube' | 'cross' | 'crop' | 'torch' | 'slab' | 'stairs' | 'ladder' | 'door' | 'bed' | 'cactus' | 'lantern' | 'farmland' | 'liquid'
  | 'portal' | 'fire' | 'fence' | 'cage' | 'wire' | 'lever' | 'button' | 'plate' | 'repeater' | 'piston' | 'piston_head';
/** 'none' is never drawn (air, barrier); 'cutout' has alpha-tested holes; 'translucent' is blended and sorted. */
export type RenderMode = 'none' | 'opaque' | 'cutout' | 'translucent';
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'sword';
export type SoundGroup = 'stone' | 'wood' | 'grass' | 'gravel' | 'sand' | 'glass' | 'wool' | 'snow' | 'metal';
/**
 * How block states are interpreted. 'axis': 0 Y, 1 X, 2 Z. 'facing': bits 0–1 = 0..3 N,E,S,W (front faces that way).
 * 'face': bits 0–2 = a face 0..5 (pistons and heads). 'custom': a per-block bit layout (see the state helpers below).
 */
export type StateKind = 'none' | 'axis' | 'facing' | 'face' | 'custom';
/** Texture keys per face; `front` replaces `side` on the facing face. */
export type Faces = { top: string; bottom: string; side: string; front?: string };
/** One possible drop: `min..max` of `item` (uniform) with probability `chance`. */
export type Drop = { item: number; min: number; max: number; chance: number };

export type BlockDef = {
  id: number; name: BlockName; label: string; shape: Shape; state: StateKind;
  /** Full opaque cube: hides neighbour faces and blocks light. */
  opaque: boolean;
  /** Has collision boxes. */
  solid: boolean;
  render: RenderMode;
  /** Light emission 0..15. */
  light: number;
  /** Extra light attenuation when light passes through (15 = blocks light). */
  filter: number;
  /** MC hardness; break seconds = hardness * 1.5 / speed (harvestable) or * 5 / speed. -1 = unbreakable. */
  hardness: number;
  tool: ToolKind | null;
  /** Tool tier required for drops: 0 none, 1 wood, 2 stone, 3 iron, 4 diamond. */
  tier: number;
  /** Drops for a state when harvested correctly (see mining.ts for tools/shears). */
  drops(state: number): readonly Drop[];
  sound: SoundGroup;
  tex: Faces;
  /** Placing a block into this cell replaces it (tall grass, water). */
  replaceable: boolean;
  /** Reserved; fire is not simulated. */
  flammable: boolean;
  /** Can be hit by the crosshair. */
  targetable: boolean;
  climbable: boolean;
  /** Ground friction; 0.6 normal, 0.98 ice. */
  friction: number;
  /** Movement multiplier while a body overlaps the cell: soul sand 0.4 (walking), cobweb 0.15 and lava 0.5 (also vertical). */
  slow: number;
};

export const drop = (item: number, min = 1, max = min, chance = 1): Drop => ({ item, min, max, chance });
const NONE: readonly Drop[] = [];
const tex = (side: string, top = side, bottom = top, front?: string): Faces => front ? { top, bottom, side, front } : { top, bottom, side };
const title = (name: string) => name.split('_').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ');

type Props = Partial<Omit<BlockDef, 'id' | 'name' | 'drops'>> & { drops?: BlockDef['drops'] | readonly Drop[] };
const table: BlockDef[] = [];
function def(name: BlockName, props: Props = {}) {
  const id = B[name], shape = props.shape ?? 'cube', cube = shape === 'cube';
  const opaque = props.opaque ?? (cube && (props.render ?? 'opaque') === 'opaque');
  const own = [drop(id)], given = props.drops;
  const drops = typeof given === 'function' ? given : given ? () => given : () => own;
  table[id] = {
    id, name, label: title(name), shape, state: 'none', opaque, solid: true, render: 'opaque', light: 0, filter: opaque ? 15 : 0,
    hardness: 1, tool: null, tier: 0, sound: 'stone', tex: tex(name), replaceable: false, flammable: false, targetable: true, climbable: false, friction: 0.6, slow: 1,
    ...props, drops,
  };
}
const plant = (name: BlockName, props: Props = {}) => def(name, { shape: 'cross', solid: false, render: 'cutout', hardness: 0, sound: 'grass', ...props });
const log = (name: BlockName) => def(name, { state: 'axis', hardness: 2, tool: 'axe', sound: 'wood', flammable: true, tex: tex(name, `${name}_top`) });
const leaves = (name: BlockName, sapling: number, extra: readonly Drop[] = NONE) =>
  def(name, { render: 'cutout', opaque: false, filter: 1, hardness: 0.2, tool: 'shears', sound: 'grass', flammable: true, drops: [drop(sapling, 1, 1, 0.05), ...extra] });
const wood = (name: BlockName, props: Props = {}) => def(name, { hardness: 2, tool: 'axe', sound: 'wood', flammable: true, ...props });
const rock = (name: BlockName, hardness: number, props: Props = {}) => def(name, { hardness, tool: 'pickaxe', tier: 1, ...props });
const soil = (name: BlockName, hardness: number, props: Props = {}) => def(name, { hardness, tool: 'shovel', sound: 'gravel', ...props });
const faces = (texture: string | Faces) => typeof texture === 'string' ? tex(texture) : texture;
const slab = (name: BlockName, texture: string | Faces, base: Props) =>
  def(name, { ...base, shape: 'slab', tex: faces(texture), drops: state => (state & 3) === 2 ? [drop(B[name], 2)] : [drop(B[name])] });
const stairs = (name: BlockName, texture: string | Faces, base: Props) => def(name, { ...base, shape: 'stairs', state: 'facing', tex: faces(texture) });
const crop = (name: BlockName, ripe: readonly Drop[], young: readonly Drop[]) =>
  def(name, { shape: 'crop', solid: false, render: 'cutout', hardness: 0, sound: 'grass', drops: state => state >= 7 ? ripe : young });
const wool = (name: BlockName) => def(name, { hardness: 0.8, tool: 'shears', sound: 'wool', flammable: true });
const metal = (name: BlockName, tier: number) => rock(name, 5, { tier, sound: 'metal' });

def('air', { shape: 'air', solid: false, render: 'none', hardness: -1, targetable: false, replaceable: true, drops: NONE });
rock('stone', 1.5, { drops: [drop(B.cobblestone)] });
soil('grass_block', 0.6, { sound: 'grass', tex: tex('grass_block_side', 'grass_block_top', 'dirt'), drops: [drop(B.dirt)] });
soil('dirt', 0.5);
rock('cobblestone', 2);
wood('oak_planks');
def('bedrock', { hardness: -1, drops: NONE });
soil('sand', 0.5, { sound: 'sand' });
soil('gravel', 0.6);
log('oak_log');
leaves('oak_leaves', B.oak_sapling, [drop(I.apple, 1, 1, 0.005), drop(I.stick, 1, 2, 0.02)]);
def('glass', { render: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drops: NONE });
rock('coal_ore', 3, { drops: [drop(I.coal)] });
rock('iron_ore', 3, { tier: 2 });
rock('gold_ore', 3, { tier: 3 });
rock('diamond_ore', 3, { tier: 3, drops: [drop(I.diamond)] });
wood('crafting_table', { hardness: 2.5, tex: tex('crafting_table_side', 'crafting_table_top', 'oak_planks', 'crafting_table_front') });
rock('furnace', 3.5, { state: 'facing', tex: tex('furnace_side', 'furnace_top', 'furnace_top', 'furnace_front') });
rock('furnace_lit', 3.5, { state: 'facing', light: 13, tex: tex('furnace_side', 'furnace_top', 'furnace_top', 'furnace_front_on'), drops: [drop(B.furnace)] });
wood('chest', { hardness: 2.5, state: 'facing', tex: tex('chest_side', 'chest_top', 'chest_top', 'chest_front') });
def('torch', { shape: 'torch', solid: false, render: 'cutout', light: 14, hardness: 0, sound: 'wood' });
def('water', { shape: 'liquid', solid: false, render: 'translucent', filter: 2, hardness: -1, targetable: false, replaceable: true, drops: NONE, tex: tex('water') });
rock('sandstone', 0.8, { tex: tex('sandstone', 'sandstone_top', 'sandstone_bottom') });
log('birch_log');
leaves('birch_leaves', B.birch_sapling);
wood('birch_planks');
log('spruce_log');
leaves('spruce_leaves', B.spruce_sapling);
wood('spruce_planks');
soil('snow_block', 0.2, { sound: 'snow', tex: tex('snow') });
soil('snowy_grass', 0.6, { sound: 'snow', tex: tex('snowy_grass_side', 'snow', 'dirt'), drops: [drop(B.dirt)] });
rock('ice', 0.5, { tier: 0, render: 'translucent', opaque: false, filter: 2, sound: 'glass', friction: 0.98, drops: NONE });
def('cactus', { shape: 'cactus', render: 'cutout', hardness: 0.4, sound: 'wool', tex: tex('cactus_side', 'cactus_top', 'cactus_bottom') });
soil('clay', 0.6, { drops: [drop(I.clay_ball, 4)] });
rock('bricks', 2);
rock('stone_bricks', 1.5);
rock('mossy_cobblestone', 2);
plant('short_grass', { replaceable: true, drops: [drop(I.wheat_seeds, 1, 1, 0.125)] });
plant('fern', { replaceable: true, drops: NONE });
plant('dandelion');
plant('poppy');
plant('cornflower');
plant('dead_bush', { replaceable: true, drops: [drop(I.stick, 0, 2)] });
plant('sugar_cane', { drops: [drop(I.sugar_cane)] });
plant('oak_sapling');
plant('birch_sapling');
plant('spruce_sapling');
crop('wheat', [drop(I.wheat), drop(I.wheat_seeds, 1, 3)], [drop(I.wheat_seeds)]);
crop('carrots', [drop(I.carrot, 2, 5)], [drop(I.carrot)]);
crop('potatoes', [drop(I.potato, 2, 5)], [drop(I.potato)]);
soil('farmland', 0.6, { shape: 'farmland', opaque: false, tex: tex('dirt', 'farmland'), drops: [drop(B.dirt)] });
wood('bed', { shape: 'bed', hardness: 0.2, tool: null, render: 'cutout', tex: tex('bed_foot_side', 'bed_foot_top', 'oak_planks'), drops: [drop(I.bed)] });
wood('ladder', { shape: 'ladder', state: 'facing', render: 'cutout', hardness: 0.4, climbable: true });
wood('oak_door', { shape: 'door', render: 'cutout', hardness: 3, tex: tex('oak_door_bottom', 'oak_door_top'), drops: [drop(I.oak_door)] });
const oak: Props = { hardness: 2, tool: 'axe', sound: 'wood', flammable: true }, cobble: Props = { hardness: 2, tool: 'pickaxe', tier: 1 }, brick: Props = { hardness: 1.5, tool: 'pickaxe', tier: 1 };
slab('oak_slab', 'oak_planks', oak);
slab('cobblestone_slab', 'cobblestone', cobble);
slab('stone_brick_slab', 'stone_bricks', brick);
stairs('oak_stairs', 'oak_planks', oak);
stairs('cobblestone_stairs', 'cobblestone', cobble);
stairs('stone_brick_stairs', 'stone_bricks', brick);
rock('lantern', 3.5, { shape: 'lantern', render: 'cutout', light: 15, sound: 'metal' });
wool('white_wool');
wool('red_wool');
wool('yellow_wool');
wool('blue_wool');
wool('green_wool');
wool('black_wool');
wood('bookshelf', { hardness: 1.5, tex: tex('bookshelf', 'oak_planks'), drops: [drop(I.book, 3)] });
wood('pumpkin', { hardness: 1, state: 'facing', flammable: false, tex: tex('pumpkin_side', 'pumpkin_top', 'pumpkin_top', 'carved_pumpkin') });
wood('jack_o_lantern', { hardness: 1, state: 'facing', light: 15, flammable: false, tex: tex('pumpkin_side', 'pumpkin_top', 'pumpkin_top', 'jack_o_lantern') });
wood('melon', { hardness: 1, flammable: false, tex: tex('melon_side', 'melon_top'), drops: [drop(I.melon_slice, 3, 7)] });
def('hay_bale', { state: 'axis', hardness: 0.5, tool: 'hoe', sound: 'grass', flammable: true, tex: tex('hay_bale_side', 'hay_bale_top') });
metal('iron_block', 2);
metal('gold_block', 3);
metal('diamond_block', 3);
rock('coal_block', 5);
rock('terracotta', 1.25);
rock('obsidian', 50, { tier: 4 });
// Expansion: the Nether.
rock('netherrack', 0.4);
soil('soul_sand', 0.5, { sound: 'sand', slow: 0.4 });
def('glowstone', { hardness: 0.3, light: 15, sound: 'glass', drops: [drop(I.glowstone_dust, 2, 4)] });
rock('nether_quartz_ore', 3, { drops: [drop(I.quartz)] });
rock('nether_gold_ore', 3, { drops: [drop(I.gold_nugget, 2, 6)] });
def('lava', { shape: 'liquid', solid: false, filter: 1, light: 15, hardness: -1, targetable: false, replaceable: true, slow: 0.5, drops: NONE });
rock('magma_block', 0.5, { light: 3 });
rock('nether_bricks', 2);
rock('quartz_block', 0.8, { tex: tex('quartz_block_side', 'quartz_block_top') });
def('nether_portal', { shape: 'portal', state: 'custom', solid: false, render: 'translucent', light: 11, hardness: -1, targetable: false, sound: 'glass', drops: NONE });
def('fire', { shape: 'fire', solid: false, render: 'cutout', light: 15, hardness: 0, replaceable: true, sound: 'wool', drops: NONE });
plant('red_mushroom');
plant('brown_mushroom', { light: 1 });
plant('cobweb', { hardness: 4, tool: 'sword', sound: 'wool', slow: 0.15, drops: [drop(I.string)] });
// Structures.
wood('oak_fence', { shape: 'fence', state: 'custom', tex: tex('oak_planks') });
rock('monster_spawner', 5, { shape: 'cage', state: 'custom', render: 'cutout', opaque: false, sound: 'metal', drops: NONE });
rock('emerald_ore', 3, { tier: 3, drops: [drop(I.emerald)] });
metal('emerald_block', 3);
rock('chiseled_sandstone', 0.8, { tex: tex('chiseled_sandstone', 'sandstone_top') });
rock('cut_sandstone', 0.8, { tex: tex('cut_sandstone', 'sandstone_top') });
const sandstone: Props = { hardness: 0.8, tool: 'pickaxe', tier: 1 }, sandstoneFaces = tex('sandstone', 'sandstone_top', 'sandstone_bottom');
stairs('sandstone_stairs', sandstoneFaces, sandstone);
slab('sandstone_slab', sandstoneFaces, sandstone);
soil('dirt_path', 0.65, { shape: 'farmland', opaque: false, sound: 'grass', tex: tex('dirt_path_side', 'dirt_path_top', 'dirt'), drops: [drop(B.dirt)] });
rock('cracked_stone_bricks', 1.5);
rock('mossy_stone_bricks', 1.5);
// Redstone.
rock('redstone_ore', 3, { tier: 3, drops: [drop(I.redstone, 4, 5)] });
const component: Props = { state: 'custom', solid: false, render: 'cutout', hardness: 0 };
def('redstone_wire', { ...component, shape: 'wire', tex: tex('redstone_dust_line', 'redstone_dust_dot', 'redstone_dust_line'), drops: [drop(I.redstone)] });
def('redstone_torch', { shape: 'torch', solid: false, render: 'cutout', light: 7, hardness: 0, sound: 'wood' });
def('redstone_torch_off', { shape: 'torch', solid: false, render: 'cutout', hardness: 0, sound: 'wood', drops: [drop(B.redstone_torch)] });
def('lever', { ...component, shape: 'lever', hardness: 0.5, sound: 'wood', tex: tex('cobblestone', 'lever', 'cobblestone') });
def('stone_button', { ...component, shape: 'button', hardness: 0.5, tool: 'pickaxe', tex: tex('stone') });
def('oak_button', { ...component, shape: 'button', hardness: 0.5, tool: 'axe', sound: 'wood', tex: tex('oak_planks') });
def('stone_pressure_plate', { ...component, shape: 'plate', hardness: 0.5, tool: 'pickaxe', tier: 1, tex: tex('stone') });
def('oak_pressure_plate', { ...component, shape: 'plate', hardness: 0.5, tool: 'axe', sound: 'wood', tex: tex('oak_planks') });
def('redstone_lamp', { hardness: 0.3, sound: 'glass' });
def('redstone_lamp_lit', { hardness: 0.3, sound: 'glass', light: 15, tex: tex('redstone_lamp_on'), drops: [drop(B.redstone_lamp)] });
def('repeater', { ...component, shape: 'repeater', solid: true, sound: 'wood', tex: tex('stone', 'repeater', 'stone'), drops: [drop(I.repeater)] });
const piston: Props = { shape: 'piston', state: 'face', opaque: false, hardness: 1.5, tool: 'pickaxe' };
def('piston', { ...piston, tex: tex('piston_side', 'piston_top', 'piston_bottom', 'piston_top') });
def('sticky_piston', { ...piston, tex: tex('piston_side', 'piston_top_sticky', 'piston_bottom', 'piston_top_sticky') });
def('piston_head', { ...piston, shape: 'piston_head', tex: tex('piston_side', 'piston_top'), drops: NONE });
rock('iron_door', 5, { shape: 'door', render: 'cutout', sound: 'metal', tex: tex('iron_door_bottom', 'iron_door_top'), drops: [drop(I.iron_door)] });
def('tnt', { hardness: 0, sound: 'grass', flammable: true, tex: tex('tnt_side', 'tnt_top', 'tnt_bottom') });
rock('redstone_block', 5, { sound: 'metal' });
def('barrier', { render: 'none', opaque: false, hardness: -1, targetable: false, drops: NONE });
const LABELS: [number, string][] = [[B.jack_o_lantern, "Jack o'Lantern"], [B.tnt, 'TNT'], [B.redstone_wire, 'Redstone Dust'], [B.redstone_torch_off, 'Redstone Torch'],
  [B.redstone_lamp_lit, 'Redstone Lamp'], [B.repeater, 'Redstone Repeater']];
for (const [id, label] of LABELS) table[id]!.label = label;

/** Block definitions indexed by id (holes for unused ids). Use `blockOf(cell)` for safe access. */
export const BLOCKS: readonly (BlockDef | undefined)[] = table;
/** Every defined block, in id order (excluding barrier). */
export const BLOCK_LIST: readonly BlockDef[] = table.filter((block): block is BlockDef => !!block && block.id !== B.barrier);

/** Cell value = id | state << 8. */
export const cellId = (cell: number) => cell & 255;
export const cellState = (cell: number) => cell >> 8;
export const makeCell = (id: number, state = 0) => id | (state << 8);
export const blockOf = (cell: number): BlockDef => table[cell & 255] ?? table[0]!;
/** Has collision boxes (bottom slabs, ladders, cactus, beds... not plants/water/torches). */
export const isSolid = (cell: number) => blockOf(cell).solid;
/** Full opaque cube (includes double slabs and retracted pistons): hides neighbour faces, casts AO, blocks light. */
export const isOpaque = (cell: number) => {
  const block = blockOf(cell), state = cell >> 8;
  return block.opaque || block.shape === 'slab' && (state & 3) === 2 || block.shape === 'piston' && !(state & PISTON_EXTENDED);
};
/** Full-size collision cube (supports torches, doors, beds): opaque cubes, glass, leaves, ice, spawners, double slabs, retracted pistons. */
export const isFullCube = (cell: number) => {
  const block = blockOf(cell), state = cell >> 8;
  return block.solid && (block.shape === 'cube' || block.shape === 'cage') || block.shape === 'slab' && (state & 3) === 2 || block.shape === 'piston' && !(state & PISTON_EXTENDED);
};
export const lightOf = (cell: number) => blockOf(cell).light;
export const lightFilter = (cell: number) => isOpaque(cell) ? 15 : blockOf(cell).filter;
export const isWater = (cell: number) => (cell & 255) === B.water;
export const isLava = (cell: number) => (cell & 255) === B.lava;
/** Water or lava (both static sources). */
export const isLiquid = (cell: number) => blockOf(cell).shape === 'liquid';
export const isAir = (cell: number) => (cell & 255) === B.air;
export const isReplaceable = (cell: number) => blockOf(cell).replaceable;

/** Door state bits: facing 0..3, +4 open, +8 upper half. Bed: facing 0..3, +4 head. Stairs: facing, +4 upside-down. */
export const DOOR_OPEN = 4, DOOR_UPPER = 8, BED_HEAD = 4, STAIRS_TOP = 4;
/** Slab states. */
export const SLAB_BOTTOM = 0, SLAB_TOP = 1, SLAB_DOUBLE = 2;
/** Torch states: 0 floor, 1..4 on a wall pointing N,E,S,W (attached to the block on the opposite side). Redstone torches too. */
export const TORCH_FLOOR = 0;

/** Chest bits 2–4: the generated loot table to roll on first open/break (0 = none). Only worldgen writes nonzero loot. */
export const CHEST_LOOT = { none: 0, village_house: 1, village_smith: 2, desert_temple: 3, mineshaft: 4, dungeon: 5 } as const;
export const chestLoot = (state: number) => state >> 2 & 7;
/** Fence bits 0–3: connected towards N, E, S, W (FACING order, 1 << dir). */
export const fenceConnects = (state: number, dir: number) => (state >> dir & 1) === 1;
/**
 * Levers and buttons: bits 0–2 = the face of the supporting block they sit on (0..5; 3 = on top of the block below),
 * so the support is at `position − FACES[face]`. Bit 3 = on / pressed. Lever bits 4–5: facing 0..3 of floor/ceiling levers.
 */
export const attachedFace = (state: number) => Math.min(state & 7, 5);
export const LEVER_ON = 8, BUTTON_PRESSED = 8;
export const leverFacing = (state: number) => state >> 4 & 3;
/** Pressure plates: bit 0 = pressed. */
export const PLATE_PRESSED = 1;
/** Wire: state = power 0..15. */
export const wirePower = (state: number) => state & 15;
/** Repeaters: bits 0–1 = facing 0..3 (where the output points), bits 2–3 = delay − 1 (redstone ticks), bit 4 = powered. */
export const repeaterFacing = (state: number) => state & 3;
export const repeaterDelay = (state: number) => (state >> 2 & 3) + 1;
export const REPEATER_POWERED = 16;
/** Pistons: bits 0–2 = the face 0..5 the head extends from, bit 3 = extended. Piston heads: bits 0–2 facing, bit 3 sticky. */
export const pistonFacing = (state: number) => Math.min(state & 7, 5);
export const PISTON_EXTENDED = 8, PISTON_STICKY = 8;
/** Nether portal: bit 0 = the plane spans Z (0 = spans X). */
export const PORTAL_Z = 1;

const AXIS_END_FACES = [[2, 3], [0, 1], [4, 5]] as const;
/** Texture key for a face (0..5 = -X,+X,-Y,+Y,-Z,+Z) of a cell, honouring axis/facing/age states. */
export function faceTexture(cell: number, face: number): string {
  const block = blockOf(cell), state = cell >> 8, t = block.tex;
  switch (block.id) {
    case B.wheat: return `wheat_stage${Math.min(state, 7)}`;
    case B.carrots: case B.potatoes: return `${block.name}_stage${Math.min(state, 7) >> 1}`;
    case B.farmland: return face === 3 ? (state & 1 ? 'farmland_moist' : 'farmland') : 'dirt';
    case B.oak_door: case B.iron_door: return state & DOOR_UPPER ? t.top : t.side;
    case B.repeater: return face === 3 ? (state & REPEATER_POWERED ? 'repeater_on' : 'repeater') : t.side;
    case B.piston: case B.sticky_piston: {
      const facing = pistonFacing(state);
      return face === facing ? (state & PISTON_EXTENDED ? 'piston_inner' : t.front!) : face === (facing ^ 1) ? t.bottom : t.side;
    }
    case B.piston_head: return face === pistonFacing(state) ? (state & PISTON_STICKY ? 'piston_top_sticky' : 'piston_top') : t.side;
    case B.bed: {
      const part = state & BED_HEAD ? 'head' : 'foot', end = FACING_FACE[(state & 3) ^ (state & BED_HEAD ? 0 : 2)];
      return face === 2 ? 'oak_planks' : face === 3 ? `bed_${part}_top` : face === end ? `bed_${part}_end` : `bed_${part}_side`;
    }
    case B.crafting_table: return face === 3 ? t.top : face === 2 ? t.bottom : face >= 4 ? t.front! : t.side;
  }
  if (block.state === 'axis') return (AXIS_END_FACES[state % 3] as readonly number[]).includes(face) ? t.top : t.side;
  if (face === 3) return t.top;
  if (face === 2) return t.bottom;
  if (block.state === 'facing' && t.front && face === FACING_FACE[state & 3]) return t.front;
  return t.side;
}

/** Every texture key any block face can use (states 0..31), sorted: the art atlas must paint all of them. */
export const TEXTURE_KEYS: readonly string[] = (() => {
  const keys = new Set<string>();
  for (const block of BLOCK_LIST) if (block.render !== 'none') for (let state = 0; state < 32; state++) for (let face = 0; face < 6; face++) keys.add(faceTexture(makeCell(block.id, state), face));
  return [...keys].sort();
})();
