/**
 * Dungeons: a cobblestone and mossy cobblestone room with a monster spawner (zombie, skeleton or spider) and one or two
 * dungeon loot chests, kept only where the room breaks into a cave. A dungeon always fits inside one chunk and is tested
 * against that chunk's own terrain, so it needs no cross-chunk plan.
 */
import { B, CHEST_LOOT, isLiquid, isSolid, makeCell } from '../blocks';
import { CHUNK } from '../constants';
import { FACING, localIndex, type Vec3 } from '../coords';
import { createRng, hash3, rngInt } from '../noise';
import { MOB } from '../protocol';

/** Room heights: floor at y, three blocks of air, ceiling at y + 4; floors between MIN_Y and MAX_Y. */
const ROOM_H = 4, MIN_Y = 10, MAX_Y = 50;

/** Paint a dungeon into chunk (cx, cz) if this chunk rolls one and a spot touches a cave. Returns its spawner cell or null. */
export function paintDungeon(seed: number, cx: number, cz: number, cells: Uint16Array): Vec3 | null {
  const h = hash3(seed, cx, cz, 0xd06e0);
  if (h % 4) return null;
  const rng = createRng(h);
  for (let attempt = 0; attempt < 12; attempt++) {
    const long = rng() < 0.5 ? 9 : 7, alongX = rng() < 0.5, w = alongX ? long : 7, d = alongX ? 7 : long;
    // Find a cave floor in a random column, then set the room beside it so that one wall runs through the cave.
    const ax = rngInt(rng, 0, CHUNK - 1), az = rngInt(rng, 0, CHUNK - 1), floors: number[] = [];
    for (let y = MIN_Y; y <= MAX_Y; y++) if (cells[localIndex(ax, y + 1, az)] === B.air && isSolid(cells[localIndex(ax, y, az)]!)) floors.push(y);
    if (!floors.length) continue;
    const y = floors[Math.floor(rng() * floors.length)]!, alongWall = rng() < 0.5;
    const x0 = alongWall ? Math.min(CHUNK - w, Math.max(0, ax - (w >> 1))) : ax < CHUNK / 2 ? ax : ax - w + 1;
    const z0 = !alongWall ? Math.min(CHUNK - d, Math.max(0, az - (d >> 1))) : az < CHUNK / 2 ? az : az - d + 1;
    if (x0 < 0 || z0 < 0 || x0 + w > CHUNK || z0 + d > CHUNK || !fits(cells, x0, y, z0, w, d)) continue;
    const at = (x: number, yy: number, z: number) => localIndex(x0 + x, yy, z0 + z);
    const stone = () => rng() < 0.3 ? B.mossy_cobblestone : B.cobblestone;
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const wall = x === 0 || z === 0 || x === w - 1 || z === d - 1;
      cells[at(x, y, z)] = rng() < 0.55 ? B.mossy_cobblestone : B.cobblestone;
      cells[at(x, y + ROOM_H, z)] = B.cobblestone;
      // Walls keep their cave openings: only rock turns into cobblestone.
      for (let yy = y + 1; yy < y + ROOM_H; yy++) {
        const i = at(x, yy, z);
        if (!wall) cells[i] = B.air;
        else if (isSolid(cells[i]!)) cells[i] = stone();
      }
    }
    const kinds = [MOB.zombie, MOB.zombie, MOB.skeleton, MOB.spider], sx = w >> 1, sz = d >> 1;
    cells[at(sx, y + 1, sz)] = makeCell(B.monster_spawner, kinds[Math.floor(rng() * kinds.length)]!);
    for (let chests = rngInt(rng, 1, 2), tries = 0; chests > 0 && tries < 12; tries++) {
      // A chest against a wall, facing into the room.
      const dir = Math.floor(rng() * 4), [dx, dz] = FACING[dir]!;
      const x = dx ? dx > 0 ? w - 2 : 1 : rngInt(rng, 1, w - 2), z = dz ? dz > 0 ? d - 2 : 1 : rngInt(rng, 1, d - 2);
      if (cells[at(x, y + 1, z)] !== B.air || !isSolid(cells[at(x + dx, y + 1, z + dz)]!) || Math.abs(x - sx) + Math.abs(z - sz) < 2) continue;
      cells[at(x, y + 1, z)] = makeCell(B.chest, ((dir + 2) & 3) | CHEST_LOOT.dungeon << 2);
      chests--;
    }
    return [cx * CHUNK + x0 + sx, y + 1, cz * CHUNK + z0 + sz];
  }
  return null;
}

/**
 * MC's rule, a little looser for Blockwild's slimmer caves: no liquid inside, 1–6 wall openings into air at floor level,
 * and a floor and ceiling that are solid except for a few holes (the room paves them, so it never opens onto a pit).
 */
function fits(cells: Uint16Array, x0: number, y: number, z0: number, w: number, d: number): boolean {
  let openings = 0, floorHoles = 0, roofHoles = 0;
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const at = (yy: number) => cells[localIndex(x0 + x, yy, z0 + z)]!;
    if (!isSolid(at(y))) floorHoles++;
    if (!isSolid(at(y + ROOM_H))) roofHoles++;
    for (let yy = y + 1; yy < y + ROOM_H; yy++) if (isLiquid(at(yy))) return false;
    const wall = x === 0 || z === 0 || x === w - 1 || z === d - 1, corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
    if (wall && !corner && at(y + 1) === B.air && at(y + 2) === B.air) openings++;
  }
  return openings >= 1 && openings <= 6 && floorHoles <= 12 && roofHoles <= 3;
}
