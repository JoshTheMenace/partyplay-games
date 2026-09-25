/**
 * Fishing on Catan board: coastal fishing grounds and the lake (see fishing.ts for the tokens).
 */
import { axialKey, distance } from '../../../geometry';
import { RESOURCES, type Resource, type Tile, type TileId, type VertexId } from '../../../model';
import { centroid } from '../../board/islands';
import { numberFits } from '../../board/numbers';
import type { BoardDraft, GenContext } from '../../board/types';
import { isLand, shuffled } from '../../board/util';

/** Coastal ground numbers per size class: 6 official, 8 / 10 on the bigger islands (adaptation). */
const GROUND_NUMBERS = [
  [4, 5, 6, 8, 9, 10], [4, 5, 6, 8, 9, 10, 5, 9], [4, 5, 6, 8, 9, 10, 4, 5, 9, 10],
];
export const LAKE_NUMBERS = [2, 3, 11, 12];

/**
 * Grounds sit on coastal sea hexes touching the island at 3 corners (the frame's "V"s), spread
 * evenly along the coasts, clear of each other and preferably of the planned ports (a corner may
 * serve both, as on the printed frame); the preferences relax when the coast is short. The lake
 * replaces the central desert (with Caravans: a forest beside the oasis; none with Rivers, Barbarian
 * Attack, Traders & Barbarians or Fog Islands, per the official combination sheets).
 */
export function decorateFishing(d: BoardDraft, ctx: GenContext) {
  const { index } = d, land = (id: TileId) => isLand(index.tile.get(id)!.terrain);
  const near = new Set(d.portSlots.flatMap(id => {
    const e = index.edge.get(id)!;
    return [e.a, e.b].flatMap(v => [v, ...index.vertexNeighbors.get(v)!]);
  }));
  const seen = new Set<TileId>(), cands: { tile: TileId; vertices: VertexId[] }[] = [];
  for (const [, cycle] of [...index.coasts].sort(([a], [b]) => a - b)) for (const e of cycle) {
    const sea = index.edge.get(e)!.tiles.find(t => !land(t));
    if (!sea || seen.has(sea)) continue;
    seen.add(sea);
    const vertices = index.tileVertices.get(sea)!.filter(v => index.vertex.get(v)!.tiles.some(land));
    if (vertices.length >= 2) cands.push({ tile: sea, vertices });
  }
  const numbers = shuffled(GROUND_NUMBERS[ctx.tier], ctx.random), used = new Set<VertexId>();
  const chosen: typeof cands = [], offset = Math.floor(ctx.random() * cands.length);
  const fits = (c: (typeof cands)[number], pass: number) => !chosen.includes(c)
    && c.vertices.every(v => !used.has(v)) && (pass > 0 || c.vertices.every(v => !near.has(v)))
    && (pass > 1 || c.vertices.length === 3);
  const n = numbers.length;
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n && chosen.length < n; i++) {
    const start = offset + Math.floor((i * cands.length) / n);
    const c = cands.map((_, k) => cands[(start + k) % cands.length]).find(x => fits(x, pass));
    if (c) { chosen.push(c); c.vertices.forEach(v => used.add(v)); }
  }
  chosen.forEach(({ tile, vertices }, i) =>
    d.features.push({ kind: 'fishing-ground', id: `fish-${i}`, tile, vertices, numbers: [numbers[i]] }));
  const lake = lakeTile(d, ctx);
  if (!lake) return;
  Object.assign(lake, { terrain: 'lake', number: 0 });
  const vertices = index.tileVertices.get(lake.id)!;
  d.features.push({ kind: 'fishing-ground', id: 'lake', tile: lake.id, vertices, numbers: LAKE_NUMBERS });
}

/** The lake hex. A coastal desert first swaps faces with an inner resource hex (numbers permitting). */
function lakeTile(d: BoardDraft, ctx: GenContext): Tile | undefined {
  const { scenarios, map, seafarers } = ctx.settings;
  const none = scenarios.some(k => k === 'rivers' || k === 'barbarian-attack' || k === 'deliveries');
  if (none || (map === 'seafarers' && seafarers === 'fog-islands')) return undefined;
  const around = (t: Tile) => d.index.tileNeighbors.get(t.id)!;
  const inner = (t: Tile) => around(t).length === 6 && around(t).every(n => isLand(n.terrain));
  const land = d.tiles.filter(t => isLand(t.terrain)), home = land.filter(t => t.island === 0);
  const mid = centroid(home.length ? home : land);
  const byMid = (a: Tile, b: Tile) => distance(a, mid) - distance(b, mid);
  const oasis = d.tiles.find(t => t.terrain === 'oasis');
  if (oasis) return around(oasis).filter(t => t.terrain === 'wood').sort(byMid)[0];
  const desert = d.tiles.filter(t => t.terrain === 'desert')
    .sort((a, b) => +inner(b) - +inner(a) || byMid(a, b))[0];
  if (!desert || inner(desert)) return desert;
  const numbers = new Map(d.tiles.filter(t => t.number).map(t => [axialKey(t), t.number]));
  const swap = land.filter(t => inner(t) && RESOURCES.includes(t.terrain as Resource)).sort(byMid).find(t => {
    const rest = new Map(numbers);
    rest.delete(axialKey(t));
    return numberFits({ q: desert.q, r: desert.r, gold: false }, t.number, rest);
  });
  if (!swap) return map === 'seafarers' ? undefined : desert;
  Object.assign(desert, { terrain: swap.terrain, number: swap.number });
  return swap;
}
