/**
 * Structures on the server: generated loot chests and monster spawners. Worldgen paints the
 * structures themselves (shared/structures).
 */
import { B, cellId, cellState, chestLoot, isSolid, makeCell } from '../shared/blocks';
import { CHUNK } from '../shared/constants';
import { cellIndex, cellXYZ } from '../shared/coords';
import { lootSeed, rollLoot } from '../shared/loot';
import { MOB_TYPES } from '../shared/protocol';
import { chestSlots, MAX_CHESTS } from './containers';
import { spawnItem } from './entities';
import { lineOfSight, newMob, roomFor } from './mobs';
import { activePlayers, addFx, dist2, isProtected, type State } from './state';
import { blockLight, indexCell, isLoaded, writeCell } from './world';

/** Structure server state, created with the world and not saved (spawners are found again as their chunks generate). */
export type StructureState = {
  /** Spawner cell index → sim time of its next spawn attempt. */
  spawners: Map<number, number>;
};
export const newStructureState = (): StructureState => ({ spawners: new Map() });

/**
 * Spawners wake for a player within 16 blocks, spawn 1–4 mobs within 4 blocks every 10–40 s, and hold off at 6 nearby.
 * A spawn cell must be in view of the cage (never behind the dungeon walls) and darker than block light 8, so torches
 * around a spawner shut it down, as in MC.
 */
const RANGE = 16, SPREAD = 4, CROWD = 6, CROWD_RANGE = 9, MIN_DELAY = 10, MAX_DELAY = 40, MAX_LIGHT = 7;
/** Seconds between checks while no player is near, and a safety cap on all mobs. */
const IDLE = 1, MOB_LIMIT = 160;

/**
 * Called each time the server generates a chunk's terrain (again after LRU eviction, so it is idempotent): register the
 * chunk's worldgen spawners, and index structure torches as light sources (so monsters don't spawn in lit village
 * houses) unless an edit has since replaced them. Never writes cells.
 */
export function onChunkGenerated(state: State, cx: number, cz: number, cells: Uint16Array): void {
  for (let i = 0; i < cells.length; i++) {
    const id = cells[i]! & 255;
    if (id !== B.monster_spawner && id !== B.torch && id !== B.furnace_lit) continue;
    const x = cx * CHUNK + (i & 15), z = cz * CHUNK + (i >> 4 & 15), index = cellIndex(x, i >> 8, z);
    if (id !== B.monster_spawner) {
      if (!state.world.edits.has(index)) indexCell(state, index, x, z, cells[i]!);
    } else if (!state.structures.spawners.has(index)) state.structures.spawners.set(index, state.clock + IDLE);
  }
}

/**
 * Called just before a chest with loot bits is opened or broken: clear the bits with an edit, then roll the table once
 * (deterministic in the world seed and the chest's cell) into the chest. If the edit limit refuses the edit, nothing is
 * rolled and the chest stays sealed. Past the saved-chest cap the loot spills out on top of the chest instead.
 */
export function openLootChest(state: State, x: number, y: number, z: number): void {
  const cell = state.get(x, y, z), table = chestLoot(cellState(cell)), index = cellIndex(x, y, z);
  if (cellId(cell) !== B.chest || !table || !writeCell(state, x, y, z, makeCell(B.chest, cellState(cell) & 3))) return;
  const loot = rollLoot(table, lootSeed(state.settings.seed, index));
  if (!state.chests.has(index) && state.chests.size >= MAX_CHESTS) {
    for (const stack of loot) if (stack) spawnItem(state, x + 0.5, y + 1.1, z + 0.5, stack, { scatter: true });
    return;
  }
  const slots = chestSlots(state, index);
  loot.forEach((stack, i) => { if (stack && !slots[i]) slots[i] = stack; });
}

/** Every tick (after tickFireBlocks, before tickMobs): run the spawners that are due. */
export function tickSpawners(state: State, _dt: number): void {
  const spawners = state.structures.spawners;
  for (const [index, due] of spawners) {
    if (state.clock < due) continue;
    const [x, y, z] = cellXYZ(index), cell = state.get(x, y, z);
    // Evicted chunks re-register when they generate again; broken spawners are gone for good.
    if (!isLoaded(state, x, z) || cellId(cell) !== B.monster_spawner) {
      spawners.delete(index);
      continue;
    }
    const ran = runSpawner(state, x, y, z, cellState(cell));
    spawners.set(index, state.clock + (ran ? MIN_DELAY + state.rand() * (MAX_DELAY - MIN_DELAY) : IDLE));
  }
}

/**
 * One spawn cycle of the spawner at (x, y, z) for mob type `t`. Dungeon mobs ignore daylight and the first-day safe
 * zone, but a spawner only wakes for a player who is not under spawn protection. False when it stayed asleep.
 */
function runSpawner(state: State, x: number, y: number, z: number, t: number): boolean {
  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  if (state.settings.difficulty === 'peaceful' || MOB_TYPES[t]?.kind !== 'monster' || state.mobs.length >= MOB_LIMIT) return false;
  if (!activePlayers(state).some(p => !isProtected(state, p) && dist2(p.x, p.y, p.z, cx, cy, cz) <= RANGE * RANGE)) return false;
  let crowd = state.mobs.filter(mob => mob.t === t && mob.health > 0 && dist2(mob.x, mob.y, mob.z, cx, cy, cz) <= CROWD_RANGE * CROWD_RANGE).length;
  const count = 1 + Math.floor(state.rand() * 4);
  let spawned = 0;
  for (let attempt = 0; attempt < count * 4 && spawned < count && crowd < CROWD; attempt++) {
    const sx = x + Math.floor(state.rand() * (2 * SPREAD + 1)) - SPREAD, sy = y + Math.floor(state.rand() * 3) - 1, sz = z + Math.floor(state.rand() * (2 * SPREAD + 1)) - SPREAD;
    if (!isSolid(state.get(sx, sy - 1, sz)) || !roomFor(state, t, sx + 0.5, sy, sz + 0.5) || blockLight(state, sx, sy, sz) > MAX_LIGHT) continue;
    if (!lineOfSight(state, cx, cy, cz, sx + 0.5, sy + 0.5, sz + 0.5)) continue;
    state.mobs.push(newMob(state, t, sx + 0.5, sy, sz + 0.5));
    spawned++;
    crowd++;
  }
  if (spawned) addFx(state, 'spawner', cx, cy, cz, t);
  return true;
}
