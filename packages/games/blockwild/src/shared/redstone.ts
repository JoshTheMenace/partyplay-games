/**
 * Pure redstone helpers shared by the server simulation (sim/redstone.ts) and the client mesher: which blocks conduct,
 * how dust joins its neighbours (including one-block steps) and the dust colour by power.
 */
import { B, blockOf, cellId, cellState, isOpaque, repeaterFacing } from './blocks';
import type { CellReader } from './chunk';
import { FACING, type Vec3 } from './coords';

/** Solid opaque blocks conduct: they can be strongly or weakly powered and cut dust steps. Pistons and redstone blocks don't. */
export const conducts = (cell: number) => isOpaque(cell) && blockOf(cell).shape !== 'piston' && cellId(cell) !== B.redstone_block;
export const isDust = (cell: number) => cellId(cell) === B.redstone_wire;

/** Dust joins dust, power sources and repeaters whose axis runs along direction `dir` (0..3 N, E, S, W). */
function joins(cell: number, dir: number): boolean {
  switch (cellId(cell)) {
    case B.redstone_wire: case B.redstone_torch: case B.redstone_torch_off: case B.lever: case B.stone_button: case B.oak_button:
    case B.stone_pressure_plate: case B.oak_pressure_plate: case B.redstone_block: return true;
    case B.repeater: return (repeaterFacing(cellState(cell)) & 1) === (dir & 1);
  }
  return false;
}

/** `wireShape` bit for a side (0..3) whose dust climbs the block beside it to dust one level up. */
export const WIRE_UP = 16;
/**
 * Dust shape at (x, y, z): bits 0–3 = joined towards N, E, S, W; bit `WIRE_UP << dir` = that side climbs the block beside.
 * Dust steps up to dust on the block beside unless a conductor covers this dust; it steps down past a side block that does not conduct.
 */
export function wireShape(get: CellReader, x: number, y: number, z: number): number {
  const covered = conducts(get(x, y + 1, z));
  let shape = 0;
  for (let dir = 0; dir < 4; dir++) {
    const [dx, dz] = FACING[dir]!, side = get(x + dx, y, z + dz);
    if (joins(side, dir)) shape |= 1 << dir;
    else if (!covered && isDust(get(x + dx, y + 1, z + dz))) shape |= (1 | WIRE_UP) << dir;
    else if (!conducts(side) && isDust(get(x + dx, y - 1, z + dz))) shape |= 1 << dir;
  }
  return shape;
}

/** Sides (bit per direction) dust powers: its joined sides; a lone dot powers all four; one join also runs straight through. */
export function wirePoints(shape: number): number {
  const sides = shape & 15;
  if (!sides) return 15;
  return (sides & (sides - 1)) === 0 ? sides | (sides << 2 | sides >> 2) & 15 : sides;
}

/** Dust cells linked to the dust at (x, y, z): the same level, one up (unless covered) or one down (past a non-conductor). */
export function wireLinks(get: CellReader, x: number, y: number, z: number): Vec3[] {
  const covered = conducts(get(x, y + 1, z)), links: Vec3[] = [];
  for (const [dx, dz] of FACING) {
    const nx = x + dx, nz = z + dz;
    if (isDust(get(nx, y, nz))) links.push([nx, y, nz]);
    else {
      if (!covered && isDust(get(nx, y + 1, nz))) links.push([nx, y + 1, nz]);
      if (!conducts(get(nx, y, nz)) && isDust(get(nx, y - 1, nz))) links.push([nx, y - 1, nz]);
    }
  }
  return links;
}

/** Dust colour (linear 0..1 RGB) for power 0..15, as in MC: dark red when off, bright red-orange at 15. */
export function wireTint(power: number): Vec3 {
  const f = power / 15, clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [f * 0.6 + (power > 0 ? 0.4 : 0.3), clamp(f * f * 0.7 - 0.5), clamp(f * f * 0.6 - 0.7)];
}
