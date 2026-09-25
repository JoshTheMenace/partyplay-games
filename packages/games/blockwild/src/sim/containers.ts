/** Crafting grids, open screens (table, furnace, chest), container clicks and furnace smelting. */
import { B, cellId, cellState, makeCell } from '../shared/blocks';
import { CHEST_SIZE } from '../shared/constants';
import { cellIndex } from '../shared/coords';
import {
  applyClick, countItem, emptySlots, FUEL, FUEL_REMAINDER, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, returnToInventory, SMELT_SECONDS, SMELTING, takeOne,
  type Containers,
} from '../shared/inventory';
import { I, maxStack, type Slot } from '../shared/items';
import type { ClickTarget, ScreenKind } from '../shared/protocol';
import { craftResult } from '../shared/recipes';
import { spawnItem } from './entities';
import { addFx, toast, type Furnace, type Player, type State } from './state';
import { writeCell } from './world';

/** Save-size caps (see tests/save.test.ts): placing more is refused with a toast. */
export const MAX_CHESTS = 64, MAX_FURNACES = 32;
const SCREEN_RANGE = 8;

export const gridCraft = (grid: readonly (Slot | null)[]) => craftResult(grid, grid.length === 9 ? 3 : 2);
export function chestSlots(state: State, index: number): (Slot | null)[] {
  let slots = state.chests.get(index);
  if (!slots) state.chests.set(index, slots = emptySlots(CHEST_SIZE));
  return slots;
}
export function furnaceAt(state: State, index: number): Furnace {
  let furnace = state.furnaces.get(index);
  if (!furnace) state.furnaces.set(index, furnace = { slots: emptySlots(3), burn: 0, burnMax: 0, cook: 0 });
  return furnace;
}
/** Slots shown in the player's open screen (chest 27, furnace 3), or null for none / crafting table / a broken block. */
export function screenSlots(state: State, player: Player): (Slot | null)[] | null {
  const screen = player.screen;
  if (!screen || screen.kind === 'table' || screen.kind === 'trade') return null;
  const index = cellIndex(screen.x, screen.y, screen.z);
  return (screen.kind === 'chest' ? state.chests.get(index) : state.furnaces.get(index)?.slots) ?? null;
}
export const containersOf = (state: State, player: Player): Containers =>
  ({ inv: player.inv, cursor: player.cursor, grid: player.grid, out: player.out, screen: screenSlots(state, player), screenKind: player.screen?.kind ?? null, armor: player.armor });

/** Open a screen at a block (closing any other); trade screens pass the villager's mob id. */
export function openScreen(state: State, player: Player, kind: ScreenKind, x: number, y: number, z: number, villager?: number) {
  // Worldgen chests and furnaces gain their state when first opened; past the save caps they stay shut.
  const index = cellIndex(x, y, z);
  const full = kind === 'chest' ? !state.chests.has(index) && state.chests.size >= MAX_CHESTS
    : kind === 'furnace' && !state.furnaces.has(index) && state.furnaces.size >= MAX_FURNACES;
  if (full) return toast(player, `This world has too many ${kind}s.`);
  closeScreen(state, player);
  player.screen = villager === undefined ? { kind, x, y, z } : { kind, x, y, z, villager };
  if (kind === 'table') player.grid = emptySlots(9);
  if (kind === 'chest') {
    chestSlots(state, index);
    addFx(state, 'chest', x + 0.5, y + 0.5, z + 0.5, 1);
  }
  if (kind === 'furnace') furnaceAt(state, index);
}
/** Close any screen (or the inventory): grid and cursor return to the inventory; overflow is dropped at the player's feet. */
export function closeScreen(state: State, player: Player) {
  const containers = containersOf(state, player);
  for (const stack of returnToInventory(containers)) spawnItem(state, player.x, player.y + 1.2, player.z, stack, { delay: 1.5, owner: player.id });
  if (player.screen?.kind === 'chest') addFx(state, 'chest', player.screen.x + 0.5, player.screen.y + 0.5, player.screen.z + 0.5, 0);
  player.cursor = null;
  player.out = null;
  player.grid = emptySlots(4);
  player.screen = null;
}

/** Progression crafts celebrated once per player: [item, message]. The index is the milestone bit. */
const MILESTONES: readonly [number, string][] = [
  [B.crafting_table, 'Crafting table made! Place it to craft tools.'],
  [I.wooden_pickaxe, 'First pickaxe! Stone is waiting below.'],
  [I.stone_pickaxe, 'Stone tools! Iron ore needs one of these.'],
  [B.furnace, 'Furnace built: smelt ores and cook food.'],
  [B.torch, 'Torches keep monsters away at night.'],
  [I.iron_pickaxe, 'Iron pickaxe! Go find diamonds.'],
  [I.diamond_pickaxe, 'Diamond pickaxe! Nothing can stop you now.'],
];
/** Toast and sparkle the first time a player crafts a progression item. */
export function celebrate(state: State, player: Player, item: number) {
  const index = MILESTONES.findIndex(([id]) => id === item);
  if (index < 0 || player.milestones & (1 << index)) return;
  player.milestones |= 1 << index;
  toast(player, MILESTONES[index]![1]);
  addFx(state, 'levelup', player.x, player.y + 1, player.z);
}

/** One container click; returns false when nothing changed. Taking crafted output counts towards stats. */
export function click(state: State, player: Player, w: ClickTarget, i: number, b: 0 | 1 | 2): boolean {
  if (w === 'screen' && !screenSlots(state, player)) return false;
  const containers = containersOf(state, player), made = player.out;
  const before = made ? countItem(player.inv, made.id) : 0;
  const changed = applyClick(containers, w, i, b, gridCraft);
  player.cursor = containers.cursor;
  player.out = containers.out;
  if (changed && w === 'out' && made) {
    const times = b === 2 ? Math.round((countItem(player.inv, made.id) - before) / made.n) : 1;
    player.stats.crafted += times;
    state.stats.crafted += times;
    addFx(state, 'craft', player.x, player.y + 1, player.z, made.id);
    celebrate(state, player, made.id);
  }
  return changed;
}

const matchesScreen = (kind: ScreenKind, id: number) =>
  kind === 'table' ? id === B.crafting_table : kind === 'chest' ? id === B.chest : id === B.furnace || id === B.furnace_lit;
/** Close screens whose block (or villager) vanished or whose player walked away or died. */
export function validateScreens(state: State) {
  for (const player of state.players) {
    const screen = player.screen;
    if (!screen) continue;
    const villager = screen.kind === 'trade' ? state.mobs.find(mob => mob.id === screen.villager && mob.health > 0) : undefined;
    const [x, y, z] = villager ? [villager.x - 0.5, villager.y, villager.z - 0.5] : [screen.x, screen.y, screen.z];
    const far = Math.hypot(player.x - x - 0.5, player.y - y, player.z - z - 0.5) > SCREEN_RANGE;
    const gone = screen.kind === 'trade' ? !villager : !matchesScreen(screen.kind, cellId(state.get(screen.x, screen.y, screen.z)));
    if (far || player.dead || gone) closeScreen(state, player);
  }
}

/** Advance every furnace (loaded or not): burn fuel, cook, and swap the lit block state. */
export function tickFurnaces(state: State, dt: number) {
  for (const [index, furnace] of state.furnaces) {
    const slots = furnace.slots, input = slots[FURNACE_INPUT], out = slots[FURNACE_OUTPUT];
    const result = input ? SMELTING.get(input.id) : undefined;
    const canSmelt = result !== undefined && (!out || out.id === result && out.n < maxStack(result));
    const fuel = slots[FURNACE_FUEL];
    if (furnace.burn <= 0 && canSmelt && fuel && FUEL(fuel.id) > 0) {
      furnace.burn = furnace.burnMax = FUEL(fuel.id);
      const remainder = FUEL_REMAINDER.get(fuel.id);
      slots[FURNACE_FUEL] = remainder ? { id: remainder, n: 1 } : takeOne(fuel);
    }
    if (furnace.burn > 0) {
      furnace.burn = Math.max(0, furnace.burn - dt);
      if (canSmelt) {
        furnace.cook += dt;
        if (furnace.cook >= SMELT_SECONDS) {
          furnace.cook = 0;
          slots[FURNACE_INPUT] = takeOne(input);
          slots[FURNACE_OUTPUT] = out ? { id: out.id, n: out.n + 1 } : { id: result, n: 1 };
        }
      } else furnace.cook = 0;
    } else furnace.cook = Math.max(0, furnace.cook - dt * 2);
    const x = index % 4096, rest = (index - x) / 4096, z = rest % 4096, y = (rest - z) / 4096;
    const cell = state.getLoaded(x, y, z), id = cellId(cell), lit = furnace.burn > 0;
    if (id === B.furnace && lit || id === B.furnace_lit && !lit) {
      writeCell(state, x, y, z, makeCell(lit ? B.furnace_lit : B.furnace, cellState(cell)));
      if (lit) addFx(state, 'furnace', x + 0.5, y + 0.5, z + 0.5);
    }
  }
}
