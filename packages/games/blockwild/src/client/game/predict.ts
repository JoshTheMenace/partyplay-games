/**
 * Predicted containers and the command API the UI calls. Every container change is predicted by replaying the
 * still-unacknowledged commands over the latest private view with the same pure functions the server runs, so
 * clicks feel instant and a rejected command simply disappears from the replay.
 */
import { applyClick, emptySlots, equipArmor, returnToInventory, type Containers } from '../../shared/inventory';
import { maxStack, type Slot } from '../../shared/items';
import type { ClickTarget, Cmd, CmdBody, PrivateView, Screen } from '../../shared/protocol';
import { craftFromInventory, craftResult } from '../../shared/recipes';
import { enqueue, store } from '../store';
import { hud } from './hud';

export type Predicted = { inv: (Slot | null)[]; cursor: Slot | null; grid: (Slot | null)[]; out: Slot | null; screen: Screen | null; armor: (Slot | null)[] };
const copy = (slot: Slot | null | undefined): Slot | null => slot ? { ...slot } : null;

/** Replay pending commands over a private view (pure). */
export function replay(pv: PrivateView, cmds: readonly Cmd[], nearTable: boolean): Predicted {
  const c: Containers = {
    inv: pv.inv.map(copy), cursor: copy(pv.cursor), grid: pv.grid.map(copy), out: copy(pv.out),
    screen: pv.screen ? pv.screen.slots.map(copy) : null, screenKind: pv.screen?.kind ?? null, armor: (pv.armor ?? []).map(copy),
  };
  const craft = (grid: readonly (Slot | null)[]) => craftResult(grid, grid.length === 9 ? 3 : 2);
  for (const cmd of cmds) switch (cmd.t) {
    case 'click': applyClick(c, cmd.w, cmd.i, cmd.b, craft); break;
    case 'craft': craftFromInventory(c.inv, cmd.r, nearTable || c.screenKind === 'table', cmd.max === true); break;
    case 'close':
      returnToInventory(c);
      c.grid = emptySlots(4);
      c.screen = null;
      c.screenKind = null;
      break;
    case 'drop': {
      const slot = c.inv[cmd.slot];
      if (!slot) break;
      const n = cmd.all ? slot.n : 1;
      c.inv[cmd.slot] = slot.n > n ? { ...slot, n: slot.n - n } : null;
      break;
    }
    case 'creative': if (pv.mode === 'creative') c.inv[cmd.slot] = { id: cmd.id, n: maxStack(cmd.id) }; break;
    case 'place': {
      const slot = c.inv[cmd.slot];
      if (pv.mode === 'survival' && slot) c.inv[cmd.slot] = slot.n > 1 ? { ...slot, n: slot.n - 1 } : null;
      break;
    }
    // Using armor in hand puts it on (swapping with what was worn); other held uses change nothing predictable.
    case 'useItem': if (c.armor) equipArmor(c.inv, c.armor, cmd.slot); break;
  }
  const screen = pv.screen && c.screen ? { ...pv.screen, slots: c.screen } : null;
  return { inv: c.inv, cursor: c.cursor, grid: c.grid, out: c.out, screen, armor: c.armor ?? [] };
}

let base: PrivateView | null = null, signature = '', screenKey = '';
let nearTableTest: () => boolean = () => false;
let wake: () => void = () => {};

/** Scene wiring: how to test for a nearby crafting table and how to flush input promptly after a command. */
export function configurePrediction(options: { nearTable(): boolean; wake(): void } | null) {
  nearTableTest = options?.nearTable ?? (() => false);
  wake = options?.wake ?? (() => {});
  base = null;
  signature = screenKey = '';
}

const releasePointer = () => { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock(); };
const closing = () => store.get().queue.some(cmd => cmd.t === 'close');

/** Recompute the predicted containers (after a private view or a new command); only publishes real changes. */
export function repredict() {
  if (!base) return;
  const predicted = replay(base, store.get().queue, nearTableTest());
  const next = JSON.stringify(predicted);
  if (next === signature) return;
  signature = next;
  store.set({ inv: predicted.inv, cursor: predicted.cursor, grid: predicted.grid, out: predicted.out });
  hud.set({ screen: predicted.screen, armor: predicted.armor });
}

/** Apply a private view after its ack was processed. Opens/closes container screens the server opened/closed. */
export function setServerView(pv: PrivateView) {
  base = pv;
  const key = pv.screen ? `${pv.screen.kind}:${pv.screen.x},${pv.screen.y},${pv.screen.z}` : '';
  if (key !== screenKey && !closing()) {
    screenKey = key;
    const open = store.get().screen;
    if (pv.screen) {
      store.set({ screen: pv.screen.kind });
      releasePointer();
    } else if (open === 'table' || open === 'furnace' || open === 'chest' || open === 'trade') store.set({ screen: null });
  }
  repredict();
}

/** Queue any gameplay command; returns its sequence number. */
export function sendCommand(cmd: CmdBody): number {
  const n = enqueue(cmd);
  repredict();
  wake();
  return n;
}

// UI API ----------------------------------------------------------------------------------------------------------
/** MC container click. b: 0 left, 1 right (split / one), 2 shift (quick move). */
export const clickSlot = (w: ClickTarget, i: number, b: 0 | 1 | 2) => sendCommand({ t: 'click', w, i, b });
/** Recipe-book craft straight into the inventory (max = craft as many as possible). */
export const craftRecipe = (recipe: string, max = false) => sendCommand(max ? { t: 'craft', r: recipe, max: true } : { t: 'craft', r: recipe });
export const dropSlot = (slot: number, all = false) => sendCommand(all ? { t: 'drop', slot, all: true } : { t: 'drop', slot });
export const creativePick = (id: number, slot: number) => sendCommand({ t: 'creative', id, slot });
export const respawn = () => sendCommand({ t: 'respawn' });
export const selectSlot = (slot: number) => store.set({ selected: (slot % 9 + 9) % 9 });
/** True if a crafting table is within reach for 3×3 recipe-book crafts. */
export const nearCraftingTable = () => nearTableTest() || base?.screen?.kind === 'table';
/** Open the player's own inventory (creative palette in creative mode) and release the pointer. */
export function openInventory() {
  store.set({ screen: base?.mode === 'creative' ? 'creative' : 'inventory' });
  releasePointer();
}
/**
 * Close whatever screen is open; grid and cursor items return to the inventory on the server. The server's next open is
 * always new, even of the same container (closed and reopened before the server replied).
 */
export function closeScreen() {
  const open = store.get().screen;
  if (!open) return;
  store.set({ screen: null });
  if (open === 'pause') return;
  screenKey = '';
  sendCommand({ t: 'close' });
}
