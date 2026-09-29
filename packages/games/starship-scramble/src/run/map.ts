import type { MapNode, NodeKind, SectorMap } from '../contracts';
import type { SectorDef } from '../content/types';
import { int, pick, random, weighted, type Rng } from './rng';

/** Columns per sector map; a short run's single sector is a little shorter than a standard or long run's. */
export const COLUMNS = 11, SHORT_COLUMNS = 10;
export type MapPlan = { final: boolean; columns: number; exits: readonly SectorDef[] };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Ordinary beacon kinds a sector's weights choose between. */
const ORDINARY = ['hostile', 'distress', 'unknown', 'nebula', 'derelict'] as const;

/**
 * Seeded sector map: one start, 2–5 beacons per middle column (per sector) and one exit per next-sector option (or the Flagship). Node i of a
 * column links to every node of the next column whose share of the height overlaps its own, so links never cross and every beacon is reachable
 * and reaches an exit. Each sector holds trading posts, elite fights, a drydock and wormholes: beacons with an extra link two columns ahead.
 * The final sector funnels into a single trading post right before the Flagship.
 */
export function generateMap(r: Rng, def: SectorDef, { final, columns, exits }: MapPlan): SectorMap {
  const last = columns - 1, narrow = (col: number) => col === 1 || col === last - 1;
  const cols = Array.from({ length: columns }, (_, col) => {
    const rows = col === 0 || final && col >= last - 1 ? 1 : col === last ? Math.max(1, exits.length) : narrow(col) ? int(r, 2, 3) : int(r, ...def.rows), edge = rows === 1 || col === last;
    return Array.from({ length: rows }, (_, row): MapNode => ({ id: `n${col}-${row}`, col, row, kind: 'unknown', links: [], visited: col === 0, hazard: 'none',
      x: r3(.06 + col / last * .88 + (edge ? 0 : (random(r) - .5) * .024)), y: r3(rows === 1 ? .5 : .14 + (row + .5) / rows * .72 + (random(r) - .5) * Math.min(.08, .25 / rows)) }));
  });
  for (let c = 0; c < last; c++) {
    const a = cols[c], b = cols[c + 1], n = a.length, m = b.length;
    a.forEach((node, i) => {
      const hi = Math.ceil((i + 1) * m / n) - 1;
      for (let j = Math.floor(i * m / n); j <= hi; j++) node.links.push(b[j].id);
      // A diagonal to the next row stays planar only when the column boundaries line up.
      if (hi + 1 < m && (i + 1) * m % n === 0 && random(r) < .4) node.links.push(b[hi + 1].id);
    });
  }
  const depot = final ? cols[last - 1][0] : null, free = new Set(cols.slice(1, -1).flat().filter(n => n !== depot));
  /** Place `count` beacons of a kind in distinct columns within [lo, hi], never in a column that already has one of `avoid`. */
  const place = (kind: NodeKind, count: number, lo: number, hi: number, avoid: NodeKind[] = []) => {
    for (let k = 0; k < count; k++) {
      const taken = new Set(cols.flat().filter(n => n.kind === kind || avoid.includes(n.kind)).map(n => n.col)), options = [...free].filter(n => n.col >= lo && n.col <= hi && !taken.has(n.col));
      if (!options.length) return;
      const node = pick(r, options); node.kind = kind; free.delete(node);
    }
  };
  place('store', columns >= COLUMNS ? 2 : int(r, 1, 2), 2, last - 2);
  place('elite', columns >= COLUMNS ? 2 : 1, 3, last - 1, ['store']);
  place('drydock', 1, Math.ceil(last * .4), last - 1, ['store']);
  // Wormholes: an extra link two columns ahead, to the beacon nearest in height. Skipping a column gains a beacon of lead on the Armada.
  for (let k = int(r, 1, 2); k > 0; k--) {
    const options = [...free].filter(n => n.col >= 2 && n.col + 2 <= last - 1 && !cols[n.col].some(o => o.kind === 'wormhole'));
    if (!options.length) break;
    const node = pick(r, options), ahead = cols[node.col + 2].reduce((a, b) => Math.abs(b.y - node.y) < Math.abs(a.y - node.y) ? b : a);
    node.kind = 'wormhole'; node.links.push(ahead.id); free.delete(node);
  }
  const kinds = ORDINARY.filter(k => (def.weights[k] ?? 0) > 0 && (k !== 'nebula' || def.hazards.includes('nebula'))), hazards = def.hazards.filter(h => h !== 'nebula');
  for (const node of free) node.kind = weighted(r, kinds, k => def.weights[k]!);
  if (def.hazards.includes('nebula') && !cols.flat().some(n => n.kind === 'nebula')) pick(r, [...free]).kind = 'nebula';
  cols[0][0].kind = 'start';
  if (final) cols[last][0].kind = 'boss';
  else cols[last].forEach((node, i) => { node.kind = 'exit'; const to = exits[i]; if (to) node.dest = { id: to.id, name: to.name, blurb: to.blurb }; });
  if (depot) depot.kind = 'store';
  for (const node of cols.flat()) node.hazard = node.kind === 'nebula' ? 'nebula' : ['hostile', 'elite', 'unknown', 'distress', 'derelict'].includes(node.kind) && hazards.length && random(r) < .2 ? pick(r, hazards) : 'none';
  return { sectorId: def.id, name: def.name, theme: def.theme, nodes: cols.flat(), currentId: cols[0][0].id, armadaCol: -1, columns };
}

/** Nebulae hide the kinds of neighboring beacons until the fleet visits them or an event reveals the sector. */
export function mapView(map: SectorMap, revealed: boolean): SectorMap {
  if (revealed) return map;
  const fog = new Set(map.nodes.filter(n => n.kind === 'nebula').flatMap(n => [...n.links, ...map.nodes.filter(o => o.links.includes(n.id)).map(o => o.id)]));
  const shown = (kind: NodeKind) => kind === 'start' || kind === 'exit' || kind === 'boss' || kind === 'nebula' || kind === 'wormhole';
  return { ...map, nodes: map.nodes.map(n => fog.has(n.id) && !n.visited && !shown(n.kind) ? { ...n, kind: 'unknown', hazard: 'none' } : n) };
}
