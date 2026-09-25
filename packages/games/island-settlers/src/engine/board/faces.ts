import { axialKey, axialToPoint, type Axial } from '../../geometry';
import type { Reveal, Terrain, Tile, TileId } from '../../model';
import { oceanAround } from './layouts';
import { balance, placeNumbers, tokenSet } from './numbers';
import { placeTerrain } from './terrain';
import type { CellPlan, GenContext } from './types';
import { NUMBERED } from './util';

/** Scored retries (ENGINE §8.2): up to 300 attempts, best of the first 6 valid layouts. */
const ATTEMPTS = 300, CANDIDATES = 6;

type Faces = { terrain: Map<string, Terrain>; numbers: Map<string, number> };

export const rowOrder = (a: Axial, b: Axial) => a.r - b.r || a.q - b.q;

/** One attempt: terrain for every region, then a token set per region. */
function tryFaces(plan: CellPlan, ctx: GenContext): Faces | null {
  const terrain = new Map<string, Terrain>(), numbers = new Map<string, number>();
  const maxCluster = ctx.tier === 2 ? 3 : 2;
  for (const { cells, mix } of plan.regions) {
    if (!placeTerrain([...cells].sort(rowOrder), mix, maxCluster, ctx.random, terrain)) return null;
  }
  for (const region of plan.regions) {
    const cells = region.cells.filter(c => NUMBERED.has(terrain.get(axialKey(c))!))
      .map(c => ({ q: c.q, r: c.r, gold: terrain.get(axialKey(c)) === 'gold' }));
    if (!placeNumbers(cells, tokenSet(cells.length), ctx.random, numbers)) return null;
  }
  return { terrain, numbers };
}

/** The fairest valid attempt by the soft score over visible faces. */
function bestFaces(plan: CellPlan, ctx: GenContext): Faces {
  const visible = plan.regions.filter(r => !r.hidden).flatMap(r => r.cells).map(axialKey);
  let best: Faces | null = null, bestScore = Infinity;
  for (let attempt = 0, found = 0; attempt < ATTEMPTS && found < CANDIDATES; attempt++) {
    const faces = tryFaces(plan, ctx);
    if (!faces) continue;
    found++;
    const face = (k: string) => ({ terrain: faces.terrain.get(k)!, number: faces.numbers.get(k) ?? 0 });
    const score = balance(visible.map(face));
    if (score < bestScore) { best = faces; bestScore = score; }
  }
  if (!best) throw new Error('Island Settlers could not generate a fair board.');
  return best;
}

/** Tiles in row order (hidden regions show `fog`) plus the sea frame, and the hidden faces. */
export function planTiles(plan: CellPlan, ctx: GenContext) {
  const faces = bestFaces(plan, ctx);
  const tiles: Tile[] = [], hidden: Record<TileId, Reveal> = {};
  const add = (c: Axial, terrain: Terrain, number = 0, island = -1) =>
    tiles.push({ id: axialKey(c), q: c.q, r: c.r, ...axialToPoint(c), terrain, number, island });
  for (const region of plan.regions) for (const c of region.cells) {
    const key = axialKey(c), terrain = faces.terrain.get(key)!, number = faces.numbers.get(key) ?? 0;
    if (!region.hidden) add(c, terrain, number, c.island);
    else { hidden[key] = { terrain, number }; add(c, 'fog'); }
  }
  for (const c of plan.sea) add(c, 'sea');
  for (const c of oceanAround([...tiles, ...plan.sea], plan.frame)) add(c, 'sea');
  return { tiles: tiles.sort(rowOrder), hidden };
}
