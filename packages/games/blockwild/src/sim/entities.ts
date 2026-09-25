/** Item entities: spawning, physics, magnet pickup, merging and despawn. */
import { B, isWater } from '../shared/blocks';
import { addItem } from '../shared/inventory';
import { maxStack, type Slot } from '../shared/items';
import { moveBody } from './motion';
import { addFx, nextId, type ItemEntity, type State } from './state';

export const MAX_ITEMS = 128;
const DESPAWN_SECONDS = 600, MAGNET = 1.5, PICKUP = 0.9, ITEM_SIZE = 0.25;

export type SpawnItemOptions = { vx?: number; vy?: number; vz?: number; scatter?: boolean; delay?: number; owner?: string };
/** Spawn an item entity (oldest items are removed beyond MAX_ITEMS). */
export function spawnItem(state: State, x: number, y: number, z: number, stack: Slot, options: SpawnItemOptions = {}): ItemEntity | null {
  if (stack.n <= 0) return null;
  const r = state.rand, scatter = options.scatter ? 1 : 0;
  const item: ItemEntity = {
    id: nextId(state), item: stack.id, n: stack.n, x, y, z,
    vx: options.vx ?? (r() - 0.5) * 2 * scatter, vy: options.vy ?? (2 + r() * 2) * scatter, vz: options.vz ?? (r() - 0.5) * 2 * scatter,
    age: 0, pickupAt: state.clock + (options.delay ?? 0.5), owner: options.owner ?? null, ownerAt: state.clock + 1.5, onGround: false, resting: false,
  };
  if (stack.d) item.d = stack.d;
  state.items.push(item);
  if (state.items.length > MAX_ITEMS) state.items.splice(0, state.items.length - MAX_ITEMS);
  return item;
}

function tryPickup(state: State, item: ItemEntity, dt: number): boolean {
  if (state.clock < item.pickupAt) return false;
  for (const player of state.players) {
    if (!player.connected || player.dead) continue;
    if (item.owner === player.id && state.clock < item.ownerAt) continue;
    const dx = player.x - item.x, dy = player.y + 0.7 - item.y, dz = player.z - item.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > MAGNET * MAGNET) continue;
    if (d2 < PICKUP * PICKUP) {
      const left = addItem(player.inv, item.item, item.n, item.d);
      if (left === item.n) continue;
      addFx(state, 'pickup', item.x, item.y, item.z, item.item);
      item.n = left;
      return left === 0;
    }
    // Magnet: fly straight at the player (ignoring collision) so pickup feels snappy.
    const d = Math.sqrt(d2), speed = 9;
    item.x += dx / d * speed * dt;
    item.y += dy / d * speed * dt;
    item.z += dz / d * speed * dt;
    item.vx = item.vy = item.vz = 0;
    item.resting = false;
    return false;
  }
  return false;
}

export function tickItems(state: State, dt: number) {
  const get = state.getLoaded;
  let removed = false;
  for (const item of state.items) {
    item.age += dt;
    if (item.age > DESPAWN_SECONDS || tryPickup(state, item, dt)) { item.n = 0; removed = true; continue; }
    if (item.resting && state.ticks % 20 !== item.id % 20) continue;
    if (get(item.x, item.y, item.z) === B.barrier) continue;
    const inWater = isWater(get(item.x, item.y + 0.1, item.z));
    if (inWater) item.vy += (1.2 - item.vy) * Math.min(1, dt * 4);
    else item.vy = Math.max(item.vy - 16 * dt, -40);
    moveBody(get, item, ITEM_SIZE, ITEM_SIZE, dt);
    const drag = Math.pow(item.onGround ? 0.55 : 0.98, dt * 20);
    item.vx *= drag;
    item.vz *= drag;
    item.resting = item.onGround && !inWater && Math.abs(item.vx) + Math.abs(item.vz) < 0.05;
    if (item.resting) item.vx = item.vz = 0;
  }
  if (state.ticks % 10 === 0) mergeItems(state);
  if (removed || state.items.some(item => item.n <= 0)) state.items = state.items.filter(item => item.n > 0);
}

/** Merge identical undamaged stacks lying within a block of each other. */
function mergeItems(state: State) {
  const items = state.items;
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!, limit = maxStack(a.item);
    if (a.n <= 0 || a.d || a.n >= limit) continue;
    for (let j = i + 1; j < items.length && a.n < limit; j++) {
      const b = items[j]!;
      if (b.n <= 0 || b.item !== a.item || b.d || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 0.6 || Math.abs(a.z - b.z) > 1) continue;
      const moved = Math.min(limit - a.n, b.n);
      a.n += moved;
      b.n -= moved;
      a.age = Math.min(a.age, b.age);
    }
  }
}
