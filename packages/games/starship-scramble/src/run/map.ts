import type { MapNode, NodeKind, SectorMap } from '../contracts';
import type { SectorDef } from '../content/types';
import { int, pick, random, type Rng } from './rng';

/** Columns per sector map; a short run's single sector is longer so the fleet can afford upgrades before the Flagship. */
export const COLUMNS = 7, SHORT_COLUMNS = 9;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Seeded sector map: a single start and exit, 2–4 beacons per middle column. Node i of a column links to every node of the next column
 * whose share of the height overlaps its own, so links never cross and every beacon is reachable and reaches the exit.
 * The final sector funnels into a single trading post right before the Flagship.
 */
export function generateMap(r: Rng, def: SectorDef, final: boolean, columns = COLUMNS): SectorMap {
  const cols = Array.from({ length: columns }, (_, col) => { const edge = col === 0 || col === columns - 1 || final && col === columns - 2, rows = edge ? 1 : int(r, 2, 4);
    return Array.from({ length: rows }, (_, row): MapNode => ({ id: `n${col}-${row}`, col, row, kind: 'unknown', links: [], visited: col === 0, hazard: 'none',
      x: r3(.06 + col / (columns - 1) * .88 + (edge ? 0 : (random(r) - .5) * .05)), y: r3(rows === 1 ? .5 : .14 + (row + .5) / rows * .72 + (random(r) - .5) * .08) })); });
  for (let c = 0; c < columns - 1; c++) {
    const a = cols[c], b = cols[c + 1], n = a.length, m = b.length;
    a.forEach((node, i) => {
      const hi = Math.ceil((i + 1) * m / n) - 1;
      for (let j = Math.floor(i * m / n); j <= hi; j++) node.links.push(b[j].id);
      // A diagonal to the next row stays planar only when the column boundaries line up.
      if (hi + 1 < m && (i + 1) * m % n === 0 && random(r) < .4) node.links.push(b[hi + 1].id);
    });
  }
  const depot = final ? cols[columns - 2][0] : null, middle = cols.slice(1, -1).flat().filter(n => n !== depot), mid = cols.slice(2, 5).flat(), hazards = def.hazards.filter(h => h !== 'nebula');
  const stores = new Set<MapNode>(); for (let k = int(r, 1, 2); stores.size < k;) stores.add(pick(r, mid));
  for (const node of middle) {
    const roll = random(r);
    node.kind = stores.has(node) ? 'store' : roll < .4 ? 'hostile' : roll < .6 ? 'distress' : def.hazards.includes('nebula') && roll < .8 ? 'nebula' : 'unknown';
    node.hazard = node.kind === 'nebula' ? 'nebula' : node.kind !== 'store' && hazards.length && random(r) < .2 ? pick(r, hazards) : 'none';
  }
  if (def.hazards.includes('nebula') && !middle.some(n => n.kind === 'nebula')) Object.assign(pick(r, middle.filter(n => n.kind !== 'store')), { kind: 'nebula', hazard: 'nebula' });
  cols[0][0].kind = 'start'; cols[columns - 1][0].kind = final ? 'boss' : 'exit';
  if (depot) depot.kind = 'store';
  return { sectorId: def.id, name: def.name, theme: def.theme, nodes: cols.flat(), currentId: cols[0][0].id, armadaCol: -1, columns };
}

/** Nebulae hide the kinds of neighboring beacons until the fleet visits them or an event reveals the sector. */
export function mapView(map: SectorMap, revealed: boolean): SectorMap {
  if (revealed) return map;
  const fog = new Set(map.nodes.filter(n => n.kind === 'nebula').flatMap(n => [...n.links, ...map.nodes.filter(o => o.links.includes(n.id)).map(o => o.id)]));
  const shown = (kind: NodeKind) => kind === 'start' || kind === 'exit' || kind === 'boss' || kind === 'nebula';
  return { ...map, nodes: map.nodes.map(n => fog.has(n.id) && !n.visited && !shown(n.kind) ? { ...n, kind: 'unknown', hazard: 'none' } : n) };
}
