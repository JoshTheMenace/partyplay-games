import type { Axial } from '../../geometry';
import type { Terrain } from '../../model';
import { placeIslands, type IslandSpec } from './islands';
import { HOME_MIX, HOME_SHAPES, island, mix, resourceMix, rows, split } from './layouts';
import type { CellPlan, GenContext, Region } from './types';

/** ENGINE §8.4 generated scenarios, per size tier (3–4 / 5–6 / 7–10). */
const SHORES = { islands: [4, 5, 7], hexes: [10, 14, 20], gold: [2, 3, 4] };
const FOUR = { islands: [4, 6, 8], near: [2, 3, 4] };
const FOG = { blobs: [2, 3, 4], size: 6 };

function islands(spec: IslandSpec, random: () => number): Axial[][] {
  const result = placeIslands(spec, random);
  if (!result) throw new Error('Island Settlers could not fit the Seafarers islands.');
  return result;
}

const home = (ctx: GenContext): Region =>
  ({ cells: island(rows(...HOME_SHAPES[ctx.tier]), 0), mix: HOME_MIX[ctx.tier] });

/** Hidden faces: a third sea, one gold per 12 (at least one), the rest resources. */
export function fogMix(count: number, random: () => number): Terrain[] {
  const sea = Math.round(count / 3), gold = Math.max(1, Math.round(count / 12));
  return [...mix({ sea, gold }), ...resourceMix(count - sea - gold, random)];
}

function newShores(ctx: GenContext): CellPlan {
  const main = home(ctx), t = ctx.tier;
  const sizes = split(SHORES.hexes[t], SHORES.islands[t]);
  const outer = islands({ around: main.cells, sizes, near: 3, far: 4, touch: false }, ctx.random);
  const cells = outer.flatMap((c, i) => island(c, i + 1));
  const gold = SHORES.gold[t];
  const regions = [main, { cells, mix: [...mix({ gold }), ...resourceMix(cells.length - gold, ctx.random)] }];
  return { regions, sea: [], frame: 1, ports: 'home' };
}

function fourIslands(ctx: GenContext): CellPlan {
  const t = ctx.tier, count = FOUR.islands[t];
  const sizes = Array.from({ length: count }, () => 5 + Math.floor(ctx.random() * 3));
  const near = FOUR.near[t];
  const cells = islands({ around: [{ q: 0, r: 0 }], sizes, near, far: near + 4, touch: false }, ctx.random)
    .flatMap((c, i) => island(c, i + 1));
  const desert = Math.ceil(count / 4);
  const terrain = [...mix({ desert }), ...resourceMix(cells.length - desert, ctx.random)];
  return { regions: [{ cells, mix: terrain }], sea: [], frame: 2, ports: 'islands' };
}

function fogIslands(ctx: GenContext): CellPlan {
  const main = home(ctx);
  const sizes = Array<number>(FOG.blobs[ctx.tier]).fill(FOG.size);
  const cells = islands({ around: main.cells, sizes, near: 2, far: 3, touch: true }, ctx.random)
    .flatMap(c => island(c, -1));
  const fog: Region = { cells, mix: fogMix(cells.length, ctx.random), hidden: true };
  return { regions: [main, fog], sea: [], frame: 1, ports: 'home' };
}

export function seafarersPlan(ctx: GenContext): CellPlan {
  const scenario = ctx.settings.seafarers;
  if (scenario === 'four-islands') return fourIslands(ctx);
  return scenario === 'fog-islands' ? fogIslands(ctx) : newShores(ctx);
}
