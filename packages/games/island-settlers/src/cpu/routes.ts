/** Expansion planning: the best open spot within reach and the route edge that heads toward it. */
import type { EdgeId, VertexId } from '../model';
import { isLandVertex, modeDistances, network, openSpot, type Mode } from './board';
import type { Ctx } from './context';
import { spotValue } from './value';

/** A planned corner; `piece` is the route kind all the way there (kinds switch only at our buildings). */
export type Plan = { spot: VertexId; steps: number; value: number; piece: Mode };

/** Ship routes exist (Seafarers); Explorers ships are units, not routes. */
const sea = (c: Ctx) => c.pub.modules.includes('seafarers');
/** Seafarers islands can lie far out; the planner's cost estimate weighs the long voyage. */
const REACH = 10;

/** Opponents' network vertices, for spotting contested corners (Sharp blocking). */
function rivals(c: Ctx) {
  const near = new Set<VertexId>();
  for (const s of c.pub.seats.filter(x => x.id !== c.seat)) {
    for (const v of network(c.ix, c.pub.pieces, s.id)) near.add(v);
  }
  return near;
}

/**
 * Best open corner reachable in 1..max steps from `from` (default: our network), scored by spot
 * value with a distance discount. Sharp adds urgency where an opponent is one step away.
 */
export function planSpot(
  c: Ctx, from = network(c.ix, c.pub.pieces, c.seat), max = sea(c) ? REACH : 4, variety = 1.2,
): Plan | null {
  const contested = c.k.blocking ? rivals(c) : null, values = new Map<VertexId, number>();
  const dist = modeDistances(c.ix, c.pub.pieces, c.seat, from, sea(c), max);
  let best: Plan | null = null, bestScore = -Infinity;
  for (const piece of ['road', 'ship'] as const) for (const [v, d] of dist[piece]) {
    const vertex = c.ix.vertex.get(v);
    const open = !!vertex && openSpot(c.ix, c.pub.pieces, v) && isLandVertex(c.ix, c.pub.pieces, vertex);
    if (d === 0 || !open) continue;
    const claim = contested && (c.ix.links.get(v) ?? []).some(l => contested.has(l.to)) ? 1.5 : 0;
    const value = values.get(v) ?? spotValue(c, v, c.prod, variety) + claim;
    values.set(v, value);
    const score = c.jitter(value / (1 + 0.45 * Math.max(0, d - 1)));
    if (score > bestScore) { bestScore = score; best = { spot: v, steps: d, value, piece }; }
  }
  return best;
}

/** Route target (road or ship) whose far end gets closest to `spot` by its own kind; null when none helps. */
export function routeToward<T extends { at: EdgeId; piece: string }>(
  c: Ctx, targets: T[], spot: VertexId,
): T | null {
  const dist = modeDistances(c.ix, c.pub.pieces, c.seat, [spot], sea(c), REACH);
  let best: T | null = null, bestD = Infinity;
  for (const t of targets) {
    const e = c.ix.edge.get(t.at), m = dist[t.piece === 'ship' ? 'ship' : 'road'];
    const d = e ? Math.min(m.get(e.a) ?? Infinity, m.get(e.b) ?? Infinity) : Infinity;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}
