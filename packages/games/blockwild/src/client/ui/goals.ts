/** "Next goal" helper for newcomers: the survival progression from punching trees to the Nether, derived from the inventory. */
import { DAY_TICKS } from '../../shared/constants';
import { armorOf, B, I, type Slot } from '../../shared/items';

/** nether: in the Nether now; portal: a portal just lit nearby or standing in one; village: a villager is close by. */
export type GoalContext = {
  inv: readonly (Slot | null)[]; day: number; time: number; placed: number;
  armor: readonly (Slot | null)[]; nether: boolean; portal: boolean; village: boolean;
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
  // Side goals: optional, shown once the chain is done, and skipped whenever they were reached earlier.
  { id: 'village', title: 'Find a village', hint: 'Villages sit on plains, in forests, taiga and deserts. Follow the dirt paths.', icon: B.dirt_path, soft: true, done: ctx => ctx.village },
  { id: 'trade', title: 'Trade with a villager', hint: 'Use a villager to see its offers. Emeralds buy the best goods.', icon: I.emerald, soft: true,
    done: () => false /* latched by the trade screen (reachGoal) */ },
  { id: 'iron_armor', title: 'Wear full iron armor', hint: 'Craft all four pieces from 24 iron ingots, then put them on.', icon: I.iron_chestplate, soft: true,
    done: ctx => [0, 1, 2, 3].every(i => ironOrBetter(ctx.armor[i])) },
  { id: 'lamp', title: 'Build a redstone lamp', hint: 'Four redstone around glowstone. Put a lever next to it and flip it.', icon: B.redstone_lamp, soft: true,
    done: ctx => has(ctx, B.redstone_lamp) },
];

const SHELTER = GOALS.find(goal => goal.id === 'shelter')!;
/** From dusk until dawn of the first night, a player without shelter progress sees the shelter goal whatever else is next. */
export const shelterDue = (ctx: GoalContext) => ctx.time % DAY_TICKS >= 11000 && ctx.time % DAY_TICKS < 23000 && !SHELTER.done(ctx);

/**
 * Next goal. `reached` latches ids already completed (the caller persists it per world), so spending
 * ingredients never steps the helper backwards. Newly completed ids are added to `reached`. Null = all done.
 */
export function nextGoal(ctx: GoalContext, reached: Set<string>): Goal | null {
  let latest = -1, next: Goal | null = null;
  GOALS.forEach((goal, index) => { if (!goal.soft && (reached.has(goal.id) || goal.done(ctx))) latest = index; });
  for (const [index, goal] of GOALS.entries()) {
    if (index <= latest || reached.has(goal.id) || goal.done(ctx)) reached.add(goal.id);
    else next ??= goal;
  }
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
