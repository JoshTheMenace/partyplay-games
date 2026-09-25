/**
 * Pure inventory/container operations shared by the server (authoritative) and the client (prediction).
 * Every function mutates the arrays it is given, so the client can replay a command over a local copy.
 */
import { B } from './blocks';
import { HOTBAR_SIZE, INVENTORY_SIZE } from './constants';
import { armorOf, I, itemOf, maxStack, type Slot } from './items';
import type { ClickTarget, ScreenKind } from './protocol';

/** Furnace recipes: input item → output item (one per SMELT_SECONDS). */
export const SMELTING: ReadonlyMap<number, number> = new Map<number, number>([
  [B.iron_ore, I.iron_ingot], [B.gold_ore, I.gold_ingot], [B.sand, B.glass], [B.cobblestone, B.stone], [I.clay_ball, I.brick], [B.clay, B.terracotta],
  [B.oak_log, I.charcoal], [B.birch_log, I.charcoal], [B.spruce_log, I.charcoal], [I.beef, I.cooked_beef], [I.porkchop, I.cooked_porkchop],
  [I.chicken, I.cooked_chicken], [I.mutton, I.cooked_mutton], [I.potato, I.baked_potato], [B.diamond_ore, I.diamond], [B.coal_ore, I.coal],
  [B.nether_quartz_ore, I.quartz], [B.nether_gold_ore, I.gold_ingot], [B.netherrack, I.nether_brick], [B.stone_bricks, B.cracked_stone_bricks],
  [B.redstone_ore, I.redstone], [B.emerald_ore, I.emerald],
]);
export const SMELT_SECONDS = 10;
/** Furnace burn seconds for an item (0 = not a fuel). */
export const FUEL = (id: number) => itemOf(id)?.fuel ?? 0;
/** What a burnt fuel leaves in the fuel slot (a lava bucket leaves its bucket). */
export const FUEL_REMAINDER: ReadonlyMap<number, number> = new Map([[I.lava_bucket, I.bucket]]);
/** Furnace screen slot indices. */
export const FURNACE_INPUT = 0, FURNACE_FUEL = 1, FURNACE_OUTPUT = 2;

export const emptySlots = (n: number): (Slot | null)[] => Array<Slot | null>(n).fill(null);
export const emptyInventory = () => emptySlots(INVENTORY_SIZE);
/** Two slots can merge when they hold the same undamaged, stackable item. */
export const canStack = (a: Slot, b: Slot) => a.id === b.id && !a.d && !b.d && maxStack(a.id) > 1;
export const countItem = (slots: readonly (Slot | null)[], id: number) => slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.n : 0), 0);
const copy = (slot: Slot, n = slot.n): Slot => slot.d ? { id: slot.id, n, d: slot.d } : { id: slot.id, n };

/** Merge `stack` into `slots` at `order` (existing stacks first, then empties). Mutates stack.n; returns the leftover count. */
function insert(slots: (Slot | null)[], order: readonly number[], stack: Slot): number {
  const limit = maxStack(stack.id);
  for (const i of order) {
    const slot = slots[i];
    if (stack.n <= 0) break;
    if (slot && canStack(slot, stack) && slot.n < limit) {
      const moved = Math.min(limit - slot.n, stack.n);
      slot.n += moved;
      stack.n -= moved;
    }
  }
  for (const i of order) {
    if (stack.n <= 0) break;
    if (!slots[i]) {
      const moved = Math.min(limit, stack.n);
      slots[i] = copy(stack, moved);
      stack.n -= moved;
    }
  }
  return stack.n;
}
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const HOTBAR = range(0, HOTBAR_SIZE), MAIN = range(HOTBAR_SIZE, INVENTORY_SIZE), ALL = [...HOTBAR, ...MAIN];

/** Add n of an item (hotbar first). Returns how many did not fit. */
export function addItem(inv: (Slot | null)[], id: number, n: number, d?: number): number {
  return insert(inv, ALL, d ? { id, n, d } : { id, n });
}
/** Remove n of an item if the inventory holds at least n (all or nothing). Takes from the back so the hotbar keeps its stacks. */
export function removeItem(inv: (Slot | null)[], id: number, n: number): boolean {
  if (countItem(inv, id) < n) return false;
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
    const slot = inv[i];
    if (slot?.id !== id) continue;
    const taken = Math.min(slot.n, n);
    slot.n -= taken;
    n -= taken;
    if (slot.n <= 0) inv[i] = null;
  }
  return true;
}
/** How many of an item fit into the inventory. */
export function spaceFor(inv: readonly (Slot | null)[], id: number): number {
  const limit = maxStack(id);
  return inv.reduce((sum, slot) => sum + (!slot ? limit : slot.id === id && !slot.d && limit > 1 ? Math.max(0, limit - slot.n) : 0), 0);
}
/** Remove one item from a slot (placing, eating); returns the new slot value. */
export const takeOne = (slot: Slot | null): Slot | null => !slot || slot.n <= 1 ? null : copy(slot, slot.n - 1);

/**
 * Everything a click can touch. `screen` holds chest (27) or furnace (input, fuel, output) slots. `armor` (head, chest,
 * legs, feet) enables the 'armor' target and shift-click equipping; without it armor clicks change nothing.
 */
export type Containers = {
  inv: (Slot | null)[]; cursor: Slot | null; grid: (Slot | null)[]; out: Slot | null; screen: (Slot | null)[] | null; screenKind: ScreenKind | null;
  armor?: (Slot | null)[];
};
/** Computes the crafting output for a grid (recipes.craftResult bound to the grid width). */
export type CraftFn = (grid: readonly (Slot | null)[]) => Slot | null;

/** Furnace output never accepts items; the fuel slot only takes fuel; armor slots only take their own piece. */
function accepts(c: Containers, w: ClickTarget, i: number, stack: Slot): boolean {
  if (w === 'screen' && c.screenKind === 'furnace') return i === FURNACE_FUEL ? FUEL(stack.id) > 0 : i !== FURNACE_OUTPUT;
  if (w === 'armor') return armorOf(stack.id)?.slot === i;
  return true;
}
function slotsOf(c: Containers, w: ClickTarget): (Slot | null)[] | null {
  return w === 'inv' ? c.inv : w === 'grid' ? c.grid : w === 'screen' ? c.screen : w === 'armor' ? c.armor ?? null : null;
}
/** Take the crafting output once: consume one item from every grid slot and recompute the output. */
function takeOutput(c: Containers, craft: CraftFn): Slot {
  const out = c.out!;
  for (let i = 0; i < c.grid.length; i++) {
    const slot = c.grid[i];
    if (slot && --slot.n <= 0) c.grid[i] = null;
  }
  c.out = craft(c.grid);
  return copy(out);
}
/** Shift-click destinations for a slot, in order. */
function quickTargets(c: Containers, w: ClickTarget, i: number, stack: Slot): [ClickTarget, number[]][] {
  if (w === 'armor') return [['inv', [...MAIN, ...HOTBAR]]];
  if (w !== 'inv') return [['inv', w === 'out' ? [...MAIN, ...HOTBAR].reverse() : [...HOTBAR, ...MAIN]]];
  const swap: [ClickTarget, number[]] = ['inv', i < HOTBAR_SIZE ? MAIN : HOTBAR], piece = armorOf(stack.id)?.slot;
  // In the plain inventory, shift-clicking armor puts it on when that slot is free.
  if (c.screenKind === null && c.armor && piece !== undefined && !c.armor[piece]) return [['armor', [piece]]];
  if (c.screenKind === 'chest' && c.screen) return [['screen', range(0, c.screen.length)]];
  if (c.screenKind === 'furnace') {
    if (SMELTING.has(stack.id)) return [['screen', [FURNACE_INPUT]]];
    if (FUEL(stack.id) > 0) return [['screen', [FURNACE_FUEL]]];
  }
  return [swap];
}

/**
 * Apply one MC-style container click. b: 0 left (pick up all / place all / swap), 1 right (pick up half / place one),
 * 2 shift (quick move). Returns false if nothing changed. After grid changes `c.out` is recomputed with `craft`.
 */
export function applyClick(c: Containers, w: ClickTarget, i: number, b: 0 | 1 | 2, craft: CraftFn): boolean {
  if (w === 'out') {
    if (!c.out) return false;
    if (b === 2) {
      let made = 0;
      while (c.out && made < 64 && spaceFor(c.inv, c.out.id) >= c.out.n) {
        insert(c.inv, [...MAIN, ...HOTBAR].reverse(), takeOutput(c, craft));
        made++;
      }
      return made > 0;
    }
    const cursor = c.cursor;
    if (cursor && (!canStack(cursor, c.out) || cursor.n + c.out.n > maxStack(cursor.id))) return false;
    const stack = takeOutput(c, craft);
    c.cursor = cursor ? copy(cursor, cursor.n + stack.n) : stack;
    return true;
  }
  const slots = slotsOf(c, w);
  if (!slots || i < 0 || i >= slots.length) return false;
  const slot = slots[i] ?? null, cursor = c.cursor;
  let changed = false;
  if (b === 2) {
    if (!slot) return false;
    const stack = copy(slot);
    for (const [target, order] of quickTargets(c, w, i, slot)) {
      const into = slotsOf(c, target);
      if (into) insert(into, order.filter(index => index !== i || target !== w), stack);
    }
    changed = stack.n !== slot.n;
    slots[i] = stack.n > 0 ? stack : null;
  } else if (!cursor) {
    if (!slot) return false;
    const taken = b === 0 ? slot.n : Math.ceil(slot.n / 2);
    c.cursor = copy(slot, taken);
    slots[i] = slot.n - taken > 0 ? copy(slot, slot.n - taken) : null;
    changed = true;
  } else if (!accepts(c, w, i, cursor)) {
    // Output-only slots give but never take: a matching cursor collects from them.
    if (slot && canStack(slot, cursor) && cursor.n + slot.n <= maxStack(cursor.id)) {
      c.cursor = copy(cursor, cursor.n + slot.n);
      slots[i] = null;
      changed = true;
    }
  } else if (!slot || canStack(slot, cursor)) {
    const room = maxStack(cursor.id) - (slot?.n ?? 0), moved = Math.min(room, b === 0 ? cursor.n : 1);
    if (moved <= 0) return false;
    slots[i] = slot ? copy(slot, slot.n + moved) : copy(cursor, moved);
    c.cursor = cursor.n - moved > 0 ? copy(cursor, cursor.n - moved) : null;
    changed = true;
  } else {
    slots[i] = cursor;
    c.cursor = slot;
    changed = true;
  }
  if (changed && (w === 'grid' || b === 2)) c.out = craft(c.grid);
  return changed;
}

/** Put on the armor piece in inventory slot `slot`, swapping with whatever was worn there. False if it is not armor. */
export function equipArmor(inv: (Slot | null)[], armor: (Slot | null)[], slot: number): boolean {
  const stack = inv[slot], piece = stack ? armorOf(stack.id)?.slot : undefined;
  if (!stack || piece === undefined) return false;
  inv[slot] = armor[piece] ?? null;
  armor[piece] = stack;
  return true;
}

/** Return cursor and grid contents to the inventory (closing a screen). Returns items that did not fit (to drop). */
export function returnToInventory(c: Containers): Slot[] {
  const spill: Slot[] = [];
  for (const stack of [c.cursor, ...c.grid]) if (stack) {
    const left = insert(c.inv, ALL, copy(stack));
    if (left > 0) spill.push(copy(stack, left));
  }
  c.cursor = null;
  c.grid.fill(null);
  c.out = null;
  return spill;
}
