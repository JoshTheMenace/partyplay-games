import { axialToPoint, distance, type Axial } from '../../geometry';
import { angleAround, centroid, distances, fromKey } from './islands';
import { BASE_MIX, BASE_SHAPES, island, rows } from './layouts';
import { fogMix } from './seafarers';
import type { CellPlan, GenContext } from './types';
import { shuffled } from './util';

const HIDDEN = [36, 48, 60];

/**
 * ENGINE §8.5: the base island without its deserts (the farthest cells go), one visible sea
 * ring, a hidden band of 36 / 48 / 60 hexes, then two sea rings. Mission faces (lairs, spice,
 * shoals, council) are added by the explorers module's decorator.
 */
export function explorersPlan(ctx: GenContext): CellPlan {
  const base = BASE_MIX[ctx.tier], deserts = base.filter(t => t === 'desert').length;
  const shape = rows(...BASE_SHAPES[ctx.tier]), mid = centroid(shape);
  const spread = (a: Axial) => distance(axialToPoint(a), mid);
  const home = shuffled(shape, ctx.random).sort((a, b) => spread(a) - spread(b))
    .slice(0, shape.length - deserts);
  const around = distances(home, 6);
  const band = (d: number) => [...around].filter(([, n]) => n === d).map(([k]) => fromKey(k));
  const hidden: Axial[] = [];
  for (let d = 2; hidden.length < HIDDEN[ctx.tier]; d++) {
    const cells = band(d), extra = HIDDEN[ctx.tier] - hidden.length;
    if (cells.length <= extra) { hidden.push(...cells); continue; }
    const centre = centroid(home), rotation = ctx.random();
    cells.sort((a, b) => angleAround(centre, a) - angleAround(centre, b));
    for (let i = 0; i < extra; i++) hidden.push(cells[Math.floor(((i + rotation) * cells.length) / extra)]);
  }
  return {
    regions: [
      { cells: island(home, 0), mix: base.filter(t => t !== 'desert') },
      { cells: island(hidden, -1), mix: fogMix(hidden.length, ctx.random), hidden: true },
    ],
    sea: band(1),
    frame: 2,
    ports: 'none',
  };
}
