import type { EdgeId, Port, VertexId } from '../../model';
import { PORT_GOODS } from './layouts';
import type { BoardIndex } from './lookup';
import type { CellPlan, Tier } from './types';
import { shuffled } from './util';

/** `n` items of a cycle with near-equal gaps (30 / 9 → 3,3,4,…), starting at `offset`. */
export const spacedSlots = <T>(cycle: readonly T[], n: number, offset: number): T[] =>
  Array.from({ length: n }, (_, i) => cycle[(offset + Math.floor((i * cycle.length) / n)) % cycle.length]);

/** Largest-remainder split of `n` across `weights`. */
function allocate(n: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0), quota = weights.map(w => (n * w) / total);
  const counts = quota.map(Math.floor);
  const order = quota.map((_, i) => i).sort((a, b) => (quota[b] % 1) - (quota[a] % 1));
  for (let i = 0, left = n - counts.reduce((a, b) => a + b, 0); left > 0; left--, i++) counts[order[i]]++;
  return counts;
}

/**
 * ENGINE §8.3 steps 1–2: evenly spaced port edges on the home coast, or on every island by coast
 * length. Each cycle holds at most one port per 3 edges, so gaps are always ≥ 3.
 */
export function portSlots(
  index: BoardIndex, mode: CellPlan['ports'], tier: Tier, random: () => number,
): EdgeId[] {
  if (mode === 'none') return [];
  const coasts = mode === 'home'
    ? [index.coasts.get(0) ?? []]
    : [...index.coasts].filter(([island]) => island > 0).map(([, c]) => c);
  const caps = coasts.map(c => Math.floor(c.length / 3));
  const counts = allocate(PORT_GOODS[tier].length, coasts.map(c => c.length))
    .map((n, i) => Math.min(n, caps[i]));
  for (let left = PORT_GOODS[tier].length - counts.reduce((a, b) => a + b, 0); left > 0; left--) {
    const i = caps.findIndex((cap, j) => cap > counts[j]);
    if (i < 0) break;
    counts[i]++;
  }
  return coasts.flatMap((c, i) => spacedSlots(c, counts[i], Math.floor(random() * c.length)));
}

/**
 * A shuffle of the size's goods (3:1 dropped first when short) where no two ports that follow
 * each other on a coast (`pairs`) share a 2:1 good.
 */
function portGoods(n: number, pairs: readonly [number, number][], tier: Tier, random: () => number) {
  const all = PORT_GOODS[tier], drop = all.length - n;
  const goods = all.filter((g, i) => g !== 'any' || i >= drop).slice(-n);
  let best = goods;
  for (let tries = 0; tries < 50; tries++) {
    best = shuffled(goods, random);
    if (pairs.every(([a, b]) => best[a] === 'any' || best[a] !== best[b])) break;
  }
  return best;
}

/**
 * ENGINE §8.3 steps 3–4. A slot touching `noPorts` (or a port on another coast) slides up to two
 * edges along its coast; a port never shares or neighbours another port's vertex.
 */
export function placePorts(
  index: BoardIndex, slots: readonly EdgeId[], noPorts: ReadonlySet<VertexId>, tier: Tier,
  random: () => number,
): Port[] {
  const taken = new Set<VertexId>();
  const cycleOf = new Map([...index.coasts.values()].flatMap(c => c.map((e, i) => [e, { c, i }] as const)));
  const free = (id: EdgeId) => {
    const e = index.edge.get(id)!;
    return [e.a, e.b].every(v => !noPorts.has(v) && !taken.has(v));
  };
  const chosen: { id: EdgeId; cycle: EdgeId[] }[] = [], missed: EdgeId[][] = [];
  const place = (id: EdgeId, cycle: EdgeId[]) => {
    chosen.push({ id, cycle });
    const e = index.edge.get(id)!;
    for (const v of [e.a, e.b]) for (const n of [v, ...index.vertexNeighbors.get(v)!]) taken.add(n);
  };
  for (const slot of slots) {
    const { c, i } = cycleOf.get(slot)!;
    const id = [0, 1, -1, 2, -2].map(d => c[(i + d + c.length) % c.length]).find(free);
    if (id) place(id, c); else missed.push(c);
  }
  // A blocked slot takes the free edge of its coast farthest from that coast's other ports.
  for (const c of missed) {
    const own = chosen.filter(p => p.cycle === c).map(p => c.indexOf(p.id));
    const apart = (i: number, j: number) => Math.min(Math.abs(i - j), c.length - Math.abs(i - j));
    const spread = (i: number) => Math.min(...own.map(j => apart(i, j)));
    const best = c.map((id, i) => ({ id, i })).filter(x => free(x.id))
      .sort((a, b) => spread(b.i) - spread(a.i))[0];
    if (best) place(best.id, c);
  }
  // Each port's successor is the next port along the same coast.
  const pairs = chosen.map((p, i): [number, number] => {
    const same = chosen.map((_, j) => j).filter(j => chosen[j].cycle === p.cycle)
      .sort((a, b) => p.cycle.indexOf(chosen[a].id) - p.cycle.indexOf(chosen[b].id));
    return [i, same[(same.indexOf(i) + 1) % same.length]];
  }).filter(([a, b]) => a !== b);
  const goods = portGoods(chosen.length, pairs, tier, random);
  return chosen.map(({ id }, i) => {
    const e = index.edge.get(id)!, good = goods[i];
    const tile = e.tiles.find(t => index.tile.get(t)!.terrain === 'sea')!;
    return { id: `port-${i}`, edge: id, vertices: [e.a, e.b], good, ratio: good === 'any' ? 3 : 2, tile };
  });
}
