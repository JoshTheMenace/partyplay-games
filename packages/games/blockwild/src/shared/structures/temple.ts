/**
 * Desert temples: a 21 × 21 sandstone hall under a stepped pyramid, two patterned towers flanking the entrance, and a
 * hidden treasure chamber 14 blocks under the terracotta floor star. The chamber keeps four desert_temple loot chests in
 * wall alcoves and the classic trap: a stone pressure plate in the middle of its floor, TNT under the floor block beneath
 * it (a pressed plate strongly powers the block it sits on, which primes the TNT touching it; the blast chains the rest).
 */
import { B, CHEST_LOOT, makeCell, SLAB_BOTTOM } from '../blocks';
import { SEA_LEVEL } from '../constants';
import type { Vec3 } from '../coords';
import { hash3 } from '../noise';
import { biomeAt, surfaceHeight } from '../worldgen';
import { Blueprint, footprint, Frame, heights, OP } from './builder';

export type TemplePlan = { center: Vec3; bp: Blueprint; trap: Vec3 };
/** Local depth of the chamber floor below the temple floor, and the body's offset behind the front plaza. */
const CHAMBER = 14, BODY = 2, W = 21, D = 23;
/** Rows a doorway's approach may run out to (the planner accepts at most 9 blocks of relief). */
export const APPROACH = 9;

export function planTemple(seed: number, x: number, z: number): TemplePlan | null {
  const r = hash3(seed, x, z, 0x7e3b1e) & 3, [fw, fd] = footprint(W, D, r), x0 = x - (fw >> 1), z0 = z - (fd >> 1);
  // Desert under the middle and at least three corners; dunes are fine (the base fills them in).
  const corners = [[x0, z0], [x0 + fw - 1, z0], [x0, z0 + fd - 1], [x0 + fw - 1, z0 + fd - 1]] as const;
  if (biomeAt(seed, x, z) !== 'desert' || corners.filter(([cx, cz]) => biomeAt(seed, cx, cz) !== 'desert').length > 1) return null;
  const h = heights(seed, x0, z0, x0 + fw - 1, z0 + fd - 1, 3);
  if (h.min <= SEA_LEVEL || h.max - h.min > 9) return null;
  // Stand proud of the dunes: the sandstone base shows on the low side rather than sand burying the walls.
  const bp = new Blueprint(), f = new Frame(bp, x0, Math.max(Math.floor(h.mean + 0.5), h.max - 2), z0, W, D, r);
  const trap = temple(f, seed);
  return { center: f.at(10, 1, BODY + 10), bp, trap };
}

/** Body cell (a across, b front→back within the 21 × 21 hall) to frame coordinates. */
function temple(f: Frame, seed: number): Vec3 {
  const set = (a: number, y: number, b: number, cell: number) => f.set(a, y, BODY + b, cell);
  const box = (a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, cell: number) => f.box(a0, y0, BODY + b0, a1, y1, BODY + b1, cell);
  const ring = (a0: number, y: number, b0: number, a1: number, b1: number, cell: number) => f.ring(a0, y, BODY + b0, a1, BODY + b1, cell);

  // Ground: a sandstone base under the whole footprint, a cut-sandstone walk across the plaza to the door.
  for (let v = 0; v < D; v++) for (let u = 0; u < W; u++) {
    f.op(OP.foundation, u, -1, v, B.sandstone);
    f.set(u, 0, v, v < BODY ? Math.abs(u - 10) <= 1 ? B.cut_sandstone : B.sand : B.sandstone);
    f.op(OP.clear, u, 1, v);
  }
  // Hall walls, the flat roof, and the stepped pyramid rising over the hall (hollow inside, so the hall is a tall dome).
  for (let y = 1; y <= 5; y++) ring(0, y, 0, 20, 20, y === 3 ? B.cut_sandstone : B.sandstone);
  box(0, 6, 0, 20, 6, 20, B.sandstone);
  box(5, 6, 5, 15, 6, 15, B.air);
  for (let i = 5; i <= 9; i++) ring(i, 2 + i, i, 20 - i, 20 - i, i % 2 ? B.sandstone : B.cut_sandstone);
  set(10, 11, 10, B.cut_sandstone);
  set(10, 12, 10, B.chiseled_sandstone);
  ring(0, 7, 0, 20, 20, makeCell(B.sandstone_slab, SLAB_BOTTOM));
  // Pillars holding the pyramid and an orange-star floor over the hidden shaft.
  for (const [a, b] of [[6, 6], [14, 6], [6, 14], [14, 14]] as const) {
    box(a, 1, b, a, 5, b, B.cut_sandstone);
    set(a, 3, b, B.chiseled_sandstone);
  }
  for (let b = 5; b <= 15; b++) for (let a = 5; a <= 15; a++) {
    const da = Math.abs(a - 10), db = Math.abs(b - 10), star = da + db;
    if (star === 4 || da === db && da <= 2 || star === 0) set(a, 0, b, B.terracotta);
    else if (Math.max(da, db) === 5) set(a, 0, b, B.cut_sandstone);
  }

  // Towers flanking the entrance: 5 × 5, taller than the roof, with terracotta crosses, slit windows and stair crowns.
  for (const a0 of [0, 16]) {
    for (let y = 1; y <= 10; y++) ring(a0, y, 0, a0 + 4, 4, y === 3 || y === 9 ? B.cut_sandstone : B.sandstone);
    box(a0 + 1, 1, 1, a0 + 3, 9, 3, B.air);
    box(a0, 10, 0, a0 + 4, 10, 4, B.sandstone);
    for (const [a, b, front] of [[a0 + 2, 0, true], [a0 + (a0 ? 4 : 0), 2, false]] as const) {
      for (let y = 5; y <= 7; y++) set(a, y, b, B.terracotta);
      if (front) { set(a - 1, 6, b, B.terracotta); set(a + 1, 6, b, B.terracotta); }
      else { set(a, 6, b - 1, B.terracotta); set(a, 6, b + 1, B.terracotta); }
      set(a, 8, b, B.air);
    }
    for (let a = a0; a <= a0 + 4; a++) { f.stairs(B.sandstone_stairs, a, 11, BODY, 2); f.stairs(B.sandstone_stairs, a, 11, BODY + 4, 0); }
    for (let b = 1; b <= 3; b++) { f.stairs(B.sandstone_stairs, a0, 11, BODY + b, 1); f.stairs(B.sandstone_stairs, a0 + 4, 11, BODY + b, 3); }
    box(a0 + 1, 11, 1, a0 + 3, 11, 3, B.cut_sandstone);
    set(a0 + 2, 12, 2, B.chiseled_sandstone);
    box(a0 + (a0 ? 0 : 4), 1, 2, a0 + (a0 ? 0 : 4), 2, 2, B.air);
  }
  // The entrance: a 3-wide doorway under a chiseled lintel, a terracotta frieze, and side doors into the hall.
  box(9, 1, 0, 11, 3, 0, B.air);
  for (let a = 8; a <= 12; a++) set(a, 4, 0, a === 10 ? B.chiseled_sandstone : B.cut_sandstone);
  for (let a = 5; a <= 15; a += 2) set(a, 5, 0, B.terracotta);
  for (const a of [0, 20]) box(a, 1, 10, a, 2, 10, B.air);
  // Approaches: from each doorway a walk runs outwards (along du, dv; half-width `half`): a landing level with the
  // threshold, then a block up or down per row until it meets the dunes, so no door is buried in sand or stranded.
  const approach = (u0: number, v0: number, du: number, dv: number, half: number) => {
    for (let i = 1, level = 0; i <= APPROACH; i++) {
      const u = u0 + du * i, v = v0 + dv * i, ground = surfaceHeight(seed, f.x(u, v), f.z(u, v)) - f.y0;
      if (i > 1 && ground === level) break;
      if (i > 1) level += Math.sign(ground - level);
      for (let s = -half; s <= half; s++) {
        f.op(OP.foundation, u + dv * s, level - 1, v + du * s, B.sandstone);
        f.set(u + dv * s, level, v + du * s, B.sand);
        f.op(OP.clear, u + dv * s, level + 1, v + du * s);
      }
    }
  };
  approach(10, 0, 0, -1, 2);
  approach(0, BODY + 10, -1, 0, 1);
  approach(20, BODY + 10, 1, 0, 1);
  for (const [a, b] of [[8, 1], [12, 1]] as const) f.torch(a, 2, BODY + b, 2);

  // The hidden chamber: a sealed sandstone vault, the shaft up to the star, four chests and the plate-and-TNT trap.
  const y = -CHAMBER;
  box(6, y - 2, 6, 14, y + 4, 14, B.sandstone);
  box(7, y + 1, 7, 13, y + 3, 13, B.air);
  box(8, y + 4, 8, 12, -1, 12, B.sandstone);
  box(9, y + 4, 9, 11, -1, 11, B.air);
  for (let b = 7; b <= 13; b++) for (let a = 7; a <= 13; a++) if ((a + b) % 2 === 0 && Math.max(Math.abs(a - 10), Math.abs(b - 10)) === 3) set(a, y, b, B.terracotta);
  for (const [a, b] of [[7, 7], [13, 7], [7, 13], [13, 13]] as const) box(a, y + 1, b, a, y + 3, b, B.cut_sandstone);
  for (const [a, b, facing] of [[10, 6, 2], [10, 14, 0], [6, 10, 1], [14, 10, 3]] as const) {
    f.facing(B.chest, a, y + 1, BODY + b, facing, CHEST_LOOT.desert_temple << 2);
    set(a, y + 2, b, B.chiseled_sandstone);
  }
  box(9, y - 1, 9, 11, y - 1, 11, B.tnt);
  set(10, y, 10, B.sandstone);
  set(10, y + 1, 10, B.stone_pressure_plate);
  return f.at(10, y + 1, BODY + 10);
}
