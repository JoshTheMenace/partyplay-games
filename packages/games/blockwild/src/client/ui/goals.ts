/** "Next goal" helper for newcomers: the survival progression from punching trees to the Ender Dragon, derived from the inventory and position. */
import { DAY_TICKS } from '../../shared/constants';
import type { Vec3 } from '../../shared/coords';
import { armorOf, B, I, type Slot } from '../../shared/items';
import type { Fortress } from '../../shared/structures/fortress';

/**
 * nether/end: in that dimension now; portal: a Nether portal just lit nearby or standing in one; village: a villager is close
 * by; fortress/stronghold: at a fortress or a stronghold's portal room; endPortal: an End portal just opened nearby;
 * crystals: the boss bar shows no crystals left; victory: this world's dragon is dead.
 */
export type GoalContext = {
  inv: readonly (Slot | null)[]; day: number; time: number; placed: number; armor: readonly (Slot | null)[];
  nether: boolean; portal: boolean; village: boolean; end: boolean; fortress: boolean; stronghold: boolean; endPortal: boolean; crystals: boolean; victory: boolean;
};
/** `soft` goals (time-based or optional side goals) never imply the earlier steps; they are simply skipped once done. */
export type Goal = { id: string; title: string; hint: string; icon: number; soft?: boolean; done(ctx: GoalContext): boolean };

const has = (ctx: GoalContext, ...ids: number[]) => ctx.inv.some(slot => !!slot && ids.includes(slot.id));
const count = (ctx: GoalContext, ...ids: number[]) => ctx.inv.reduce((sum, slot) => sum + (slot && ids.includes(slot.id) ? slot.n : 0), 0);
const LOGS = [B.oak_log, B.birch_log, B.spruce_log], PLANKS = [B.oak_planks, B.birch_planks, B.spruce_planks];
const ironOrBetter = (slot: Slot | null | undefined) => ['iron', 'diamond'].includes(armorOf(slot?.id ?? 0)?.material ?? '');

/** In order. A goal also counts as done when any later item goal is done (placing the crafting table must not reopen that step). */
export const GOALS: readonly Goal[] = [
  { id: 'wood', title: 'Punch a tree', hint: 'Hold Mine on a log to collect wood.', icon: B.oak_log, done: ctx => has(ctx, ...LOGS) },
  { id: 'planks', title: 'Make planks', hint: 'Open your inventory and craft planks from logs.', icon: B.oak_planks, done: ctx => has(ctx, ...PLANKS) },
  { id: 'table', title: 'Craft a crafting table', hint: 'Four planks make a crafting table.', icon: B.crafting_table, done: ctx => has(ctx, B.crafting_table) },
  { id: 'pickaxe', title: 'Craft a wooden pickaxe', hint: 'Place the table, use it, then craft sticks and a pickaxe.', icon: I.wooden_pickaxe, done: ctx => has(ctx, I.wooden_pickaxe) },
  { id: 'shelter', title: 'Build a shelter', hint: 'Night is coming and monsters roam in the dark. Wall yourself in.', icon: B.oak_door, soft: true,
    done: ctx => ctx.day > 0 || ctx.placed >= 24 },
  { id: 'stone', title: 'Mine stone', hint: 'Dig down or find a cliff. Stone drops cobblestone.', icon: B.cobblestone, done: ctx => count(ctx, B.cobblestone) >= 3 },
  { id: 'stone_tools', title: 'Upgrade to stone tools', hint: 'Stone tools are faster and last longer.', icon: I.stone_pickaxe, done: ctx => has(ctx, I.stone_pickaxe) },
  { id: 'furnace', title: 'Build a furnace', hint: 'Eight cobblestone at a crafting table.', icon: B.furnace, done: ctx => has(ctx, B.furnace) },
  { id: 'torches', title: 'Light it up with torches', hint: 'Mine coal ore, then craft torches from coal and sticks.', icon: B.torch, done: ctx => has(ctx, B.torch) },
  { id: 'iron', title: 'Smelt iron', hint: 'Mine iron ore with a stone pickaxe and smelt it in a furnace.', icon: I.iron_ingot, done: ctx => has(ctx, I.iron_ingot, B.iron_block) },
  { id: 'iron_pickaxe', title: 'Craft an iron pickaxe', hint: 'Three iron ingots and two sticks.', icon: I.iron_pickaxe, done: ctx => has(ctx, I.iron_pickaxe, I.diamond_pickaxe) },
  { id: 'diamonds', title: 'Find diamonds', hint: 'Dig deep, below y 16. Bring torches.', icon: I.diamond, done: ctx => has(ctx, I.diamond, B.diamond_block, I.diamond_pickaxe) },
  { id: 'diamond_pickaxe', title: 'Craft a diamond pickaxe', hint: 'The best pickaxe there is. It can mine obsidian.', icon: I.diamond_pickaxe, done: ctx => has(ctx, I.diamond_pickaxe) },
  { id: 'portal', title: 'Build a Nether portal', hint: 'Pour water onto lava to make obsidian, frame it 4×5, light it with flint and steel.', icon: B.obsidian,
    done: ctx => ctx.portal || ctx.nether },
  { id: 'nether', title: 'Enter the Nether', hint: 'Stand in the purple portal for a few seconds. Bring a sword and blocks.', icon: B.netherrack, done: ctx => ctx.nether },
  { id: 'quartz', title: 'Mine nether quartz', hint: 'White-flecked ore in the netherrack. Watch out for ghasts.', icon: B.nether_quartz_ore,
    done: ctx => has(ctx, I.quartz, B.nether_quartz_ore, B.quartz_block) },
  // Gearing up before the fortress is optional: finding the fortress first skips it.
  { id: 'iron_armor', title: 'Wear full iron armor', hint: 'Blazes hit hard. Craft all four pieces from 24 iron ingots, then put them on.', icon: I.iron_chestplate, soft: true,
    done: ctx => [0, 1, 2, 3].every(i => ironOrBetter(ctx.armor[i])) },
  { id: 'fortress', title: 'Find a Nether fortress', hint: 'Follow long bridges across the lava sea. The first is near where the spawn portal leads.', icon: B.nether_bricks,
    done: ctx => ctx.fortress },
  { id: 'blaze_rods', title: 'Get blaze rods', hint: 'Blazes spawn around fortress spawners. Bring a bow and armor.', icon: I.blaze_rod, done: ctx => has(ctx, I.blaze_rod, I.blaze_powder) },
  { id: 'pearls', title: 'Hunt endermen for ender pearls', hint: "Don't look them in the eye. They're common in the dark and in the End.", icon: I.ender_pearl,
    done: ctx => has(ctx, I.ender_pearl) },
  { id: 'eyes', title: 'Craft eyes of ender', hint: 'Blaze powder and an ender pearl make one eye. The portal needs up to 12.', icon: I.ender_eye, done: ctx => has(ctx, I.ender_eye) },
  { id: 'stronghold', title: 'Find the stronghold', hint: 'Throw an eye and follow it. Dig down where it drops and find the portal room.', icon: B.stone_bricks,
    done: ctx => ctx.stronghold },
  { id: 'end_portal', title: 'Open the End portal', hint: 'Place eyes in all 12 frames around the lava pool.', icon: B.end_portal_frame, done: ctx => ctx.endPortal },
  { id: 'end', title: 'Enter the End', hint: 'Jump into the portal ready to fight. The only way home is to beat the dragon, or to die.', icon: B.end_stone,
    done: ctx => ctx.end },
  { id: 'crystals', title: 'Destroy the end crystals', hint: 'They heal the dragon from the pillar tops. Shoot them or pillar up.', icon: I.end_crystal, done: ctx => ctx.crystals },
  { id: 'dragon', title: 'Defeat the Ender Dragon', hint: 'Hit its head for extra damage. It lands on the portal in the middle.', icon: B.dragon_egg, done: ctx => ctx.victory },
  // Side goals: optional, suggested once the dragon is beaten, and skipped whenever they were reached earlier.
  { id: 'village', title: 'Find a village', hint: 'Villages sit on plains, in forests, taiga and deserts. Follow the dirt paths.', icon: B.dirt_path, soft: true, done: ctx => ctx.village },
  { id: 'trade', title: 'Trade with a villager', hint: 'Use a villager to see its offers. Emeralds buy the best goods.', icon: I.emerald, soft: true,
    done: () => false /* latched by the trade screen (reachGoal) */ },
  { id: 'lamp', title: 'Build a redstone lamp', hint: 'Four redstone around glowstone. Put a lever next to it and flip it.', icon: B.redstone_lamp, soft: true,
    done: ctx => has(ctx, B.redstone_lamp) },
  { id: 'quartz_build', title: 'Build with quartz', hint: 'Quartz blocks, pillars, stairs and bricks make bright, clean builds.', icon: B.quartz_pillar, soft: true,
    done: ctx => has(ctx, B.quartz_pillar, B.chiseled_quartz_block, B.quartz_stairs, B.quartz_slab, B.smooth_quartz, B.quartz_bricks) },
  { id: 'observer_clock', title: 'Build an observer clock', hint: 'Two observers facing each other pulse forever. Lay dust from the back of one and watch it flicker.', icon: B.observer, soft: true,
    done: ctx => count(ctx, B.observer) >= 2 },
];
/** Once the dragon is dead the chip celebrates, suggesting any side goal still open. */
const VICTORY: Goal = { id: 'victory', title: 'You beat Blockwild! Keep building.', hint: 'The world is yours now.', icon: B.dragon_egg, soft: true, done: () => false };

/** Inside a fortress's bounds or within 8 blocks of them. */
export const atFortress = (fortresses: readonly Fortress[], x: number, z: number) =>
  fortresses.some(({ bounds: [x0, , z0, x1, , z1] }) => x >= x0 - 8 && x <= x1 + 8 && z >= z0 - 8 && z <= z1 + 8);
/** Within 24 blocks (and 16 up or down) of a stronghold's portal room. */
export const atStronghold = (rooms: readonly Vec3[], x: number, y: number, z: number) =>
  rooms.some(([rx, ry, rz]) => Math.hypot(rx - x, rz - z) < 24 && Math.abs(ry - y) < 16);

const SHELTER = GOALS.find(goal => goal.id === 'shelter')!;
/** From dusk until dawn of the first night, a player without shelter progress sees the shelter goal whatever else is next. */
export const shelterDue = (ctx: GoalContext) => ctx.time % DAY_TICKS >= 11000 && ctx.time % DAY_TICKS < 23000 && !SHELTER.done(ctx);

/**
 * Next goal. `reached` latches ids already completed (the caller persists it per world), so spending
 * ingredients never steps the helper backwards. Newly completed ids are added to `reached`. Null = all done (before victory).
 */
export function nextGoal(ctx: GoalContext, reached: Set<string>): Goal | null {
  let latest = -1, next: Goal | null = null;
  GOALS.forEach((goal, index) => { if (!goal.soft && (reached.has(goal.id) || goal.done(ctx))) latest = index; });
  for (const [index, goal] of GOALS.entries()) {
    if (index <= latest || reached.has(goal.id) || goal.done(ctx)) reached.add(goal.id);
    else next ??= goal;
  }
  if (ctx.victory) return next ? { ...VICTORY, hint: `Next idea: ${next.title.toLowerCase()}.` } : VICTORY;
  return shelterDue(ctx) ? SHELTER : next;
}

/** Reached goals persist under one key for the current world only, so a fresh world starts the helper over. */
export const GOALS_KEY = 'blockwild.goals';
export function parseReached(raw: string | null, worldId: string): Set<string> {
  try {
    const saved = JSON.parse(raw ?? 'null') as { world?: unknown; reached?: unknown } | null;
    return new Set(saved?.world === worldId && Array.isArray(saved.reached) ? saved.reached.filter(id => typeof id === 'string') : []);
  } catch { return new Set(); }
}
export const serializeReached = (worldId: string, reached: ReadonlySet<string>) => JSON.stringify({ world: worldId, reached: [...reached] });
