/**
 * Deliveries depots and wagon tables. The castle, quarry and glassworks are create-time `depot`
 * features on existing inland corners of the home island, 120° apart (the castle depot sits on the
 * Barbarian Attack castle when both are on). Each depot hands out two cargo kinds and wants others.
 */
import { distance } from '../../../geometry';
import type { Board, CargoKind, DepotKind, SeatId, Tile, Vertex, VertexId } from '../../../model';
import { centroid } from '../../board/islands';
import type { BoardDraft, GenContext } from '../../board/types';
import { shuffle } from '../../rng';
import { random, type State } from '../../state';
import type { Purse } from './gold';

export const DEPOTS: readonly DepotKind[] = ['castle', 'quarry', 'glassworks'];
export const PROVIDES: Record<DepotKind, CargoKind[]> = {
  castle: ['tools', 'sand'], quarry: ['sand', 'marble'], glassworks: ['glass', 'tools'],
};
export const WANTS: Record<DepotKind, CargoKind[]> = {
  castle: ['marble', 'glass'], quarry: ['tools'], glassworks: ['sand'],
};

/** Wagon board by level 1–5: movement points, lowest die that drives a barbarian off, gold per delivery. */
export const MP = [4, 5, 6, 7, 7], DRIVE = [7, 6, 5, 4, 3], PAY = [1, 2, 3, 4, 5];
export const upgradeCost = (level: number) => ({ wood: level <= 2 ? 1 : 2, wool: 1, ore: 1 });

export type DlExt = Purse & {
  delivered: Record<SeatId, number>;
  /** Face-down cargo stacks (never projected). */
  decks: Record<DepotKind, CargoKind[]>;
  /** Movement points left this opportunity; grain boost used; drive-off attempts (`seat edge`). */
  mp: Record<SeatId, number>; boosted: SeatId[]; tried: string[];
};
export const dl = (s: State) => s.ext.deliveries as DlExt;

export function decorateDepots(draft: BoardDraft, ctx: GenContext) {
  const home = draft.tiles.filter(t => t.island === 0 && t.terrain !== 'sea');
  const ids = new Set(home.map(t => t.id));
  const mid = centroid(home), castle = home.find(t => t.terrain === 'castle');
  const inland = draft.vertices.filter(v => v.tiles.length === 3 && v.tiles.every(t => ids.has(t)));
  const reach = Math.max(...inland.map(v => distance(v, mid))) * 0.75, turn = ctx.random() * 2 * Math.PI;
  const taken = new Set<VertexId>();
  DEPOTS.forEach((depot, i) => {
    const a = turn + (i * 2 * Math.PI) / 3;
    const goal = { x: mid.x + Math.cos(a) * reach, y: mid.y + Math.sin(a) * reach };
    const onCastle = (v: Vertex) => depot !== 'castle' || !castle || v.tiles.includes(castle.id);
    const pool = inland.filter(v => !taken.has(v.id) && onCastle(v));
    const v = pool.sort((p, q) => distance(p, goal) - distance(q, goal))[0];
    if (!v) return;
    const byCentre = (p: Tile, q: Tile) => distance(p, mid) - distance(q, mid);
    const own = v.tiles.map(t => draft.index.tile.get(t)!).sort(byCentre)[0];
    const tile = depot === 'castle' && castle ? castle.id : own.id;
    for (const n of [v.id, ...(draft.index.vertexNeighbors.get(v.id) ?? [])]) taken.add(n);
    draft.noPorts.add(v.id);
    draft.features.push({ kind: 'depot', id: `depot-${depot}`, tile, vertex: v.id, depot });
  });
}

const cache = new WeakMap<Board, Map<VertexId, DepotKind>>();
/** Depot vertex → kind. */
export function depots(s: State): Map<VertexId, DepotKind> {
  let map = cache.get(s.board);
  if (!map) {
    map = new Map(s.board.features.flatMap(f => (f.kind === 'depot' ? [[f.vertex, f.depot] as const] : [])));
    cache.set(s.board, map);
  }
  return map;
}

/** 12 / 16 / 20 tokens per depot (3–4 / 5–6 / 7–10 seats), its two kinds alternating, shuffled. */
export function cargoDecks(s: State): Record<DepotKind, CargoKind[]> {
  const n = s.order.length, size = n <= 4 ? 12 : n <= 6 ? 16 : 20;
  const deck = (d: DepotKind) =>
    shuffle(Array.from({ length: size }, (_, i) => PROVIDES[d][i % 2]), random(s, 'cards'));
  return Object.fromEntries(DEPOTS.map(d => [d, deck(d)])) as Record<DepotKind, CargoKind[]>;
}
