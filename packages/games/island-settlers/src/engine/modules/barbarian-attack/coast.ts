/**
 * Barbarian Attack board facts and invaders (official 2025 rules). The castle is a create-time retype
 * of the home island's central desert; invaders are `barbarian` units on coastal hexes (level = count).
 * Three invaders conquer a hex: it stops producing and nobody builds on its corners or roads on its sides.
 */
import { axialKey, distance } from '../../../geometry';
import type { Board, EdgeId, SeatId, Tile, TileId, Unit, VertexId } from '../../../model';
import { boardIndex, type BoardIndex } from '../../board/lookup';
import { centroid } from '../../board/islands';
import { numberFits } from '../../board/numbers';
import type { BoardDraft } from '../../board/types';
import { emit } from '../../events';
import { face, isLandTile } from '../../legal';
import { placeUnit, removeUnit, updateUnit } from '../../pieces';
import { int } from '../../rng';
import { random, type State } from '../../state';
import type { Purse } from '../deliveries/gold';

export type DefenseCard = 'knighthood' | 'swift-knight' | 'capture' | 'treason';

export type BaExt = Purse & {
  prisoners: Record<SeatId, number>;
  deck: DefenseCard[]; discard: DefenseCard[];
  /** Guards moved / promoted in the current opportunity. */
  moved: string[]; promoted: string[];
  /** C&K: improvements already answered with a landing roll, per seat. */
  improvements: Record<SeatId, number>;
};

export const ba = (s: State) => s.ext['barbarian-attack'] as BaExt;
/** Cities & Knights combination: knight strengths and activation, 3 prisoners per VP, no supply limit. */
export const ck = (s: State) => s.modules.includes('cities-knights');

const home = (tiles: readonly Tile[]) => tiles.filter(t => t.island === 0 && t.terrain !== 'sea');
const shore = (ix: BoardIndex, t: Tile) =>
  (ix.tileNeighbors.get(t.id) ?? []).filter(n => n.terrain !== 'sea').length < 6;
const LANDINGS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

/**
 * Create time: the desert nearest the home island's centre (else its central hex) becomes the castle.
 * Then every landing number goes on the coast (official: distinct coastal numbers): a number found only
 * inland swaps with a coastal duplicate, preferring swaps that keep the number-placement rules.
 */
export function decorateCastle(draft: BoardDraft) {
  const land = home(draft.tiles), mid = centroid(land);
  const byCentre = (list: Tile[]) => [...list].sort((a, b) => distance(a, mid) - distance(b, mid));
  const castle = byCentre(land.filter(t => t.terrain === 'desert'))[0] ?? byCentre(land)[0];
  if (castle) Object.assign(castle, { terrain: 'castle', number: 0 });
  const numbered = land.filter(t => t.number > 0), coast = numbered.filter(t => shore(draft.index, t));
  const numbers = new Map(draft.tiles.filter(t => t.number).map(t => [axialKey(t), t.number]));
  const fits = (t: Tile, n: number) => numberFits({ q: t.q, r: t.r, gold: false }, n, numbers);
  for (const n of LANDINGS.filter(n => !coast.some(t => t.number === n))) {
    const from = numbered.find(t => t.number === n && !coast.includes(t));
    const spare = coast.filter(t => coast.filter(x => x.number === t.number).length > 1);
    const to = from && (spare.find(t => fits(t, n) && fits(from, t.number)) ?? spare[0]);
    if (!from || !to) continue;
    [from.number, to.number] = [to.number, from.number];
    numbers.set(axialKey(from), from.number).set(axialKey(to), n);
  }
}

type Facts = { castle: TileId | null; coast: TileId[]; castleEdges: EdgeId[]; walk: Set<EdgeId> };
const cache = new WeakMap<Board, Facts>();

/** Castle, numbered coastal hexes clockwise from the north, and the edges guards walk (home island). */
export function facts(s: State): Facts {
  const known = cache.get(s.board);
  if (known) return known;
  const ix = boardIndex(s.board), land = home(s.board.tiles), ids = new Set(land.map(t => t.id));
  const mid = centroid(land), castle = land.find(t => t.terrain === 'castle')?.id ?? null;
  const clock = (t: Tile) => (Math.atan2(t.y - mid.y, t.x - mid.x) + 2.5 * Math.PI) % (2 * Math.PI);
  const coast = land.filter(t => t.number > 0 && shore(ix, t)).sort((a, b) => clock(a) - clock(b))
    .map(t => t.id);
  const walk = new Set(s.board.edges.filter(e => e.tiles.some(t => ids.has(t))).map(e => e.id));
  const f = { castle, coast, castleEdges: castle ? ix.tileEdges.get(castle)! : [], walk };
  cache.set(s.board, f);
  return f;
}

const invaderId = (tile: TileId) => `inv-${tile}`;
export const invaders = (s: State, tile: TileId) => s.pieces.units[invaderId(tile)]?.level ?? 0;
export const conquered = (s: State, tile: TileId) => invaders(s, tile) >= 3;
export const onBoard = (s: State) => facts(s).coast.reduce((n, t) => n + invaders(s, t), 0);
export const invaded = (s: State) => facts(s).coast.filter(t => invaders(s, t) > 0);

export function setInvaders(s: State, tile: TileId, count: number) {
  const id = invaderId(tile);
  if (count <= 0) return removeUnit(s, id);
  const unit: Unit = { id, kind: 'barbarian', seat: null, at: tile, level: count, active: true, cargo: [] };
  if (s.pieces.units[id]) updateUnit(s, id, { level: count }); else placeUnit(s, unit);
}

const SUPPLY = [36, 48, 60];
/** Barbarians left to land (unlimited with C&K, where prisoners return to the supply in threes). */
export function supply(s: State): number {
  if (ck(s)) return Infinity;
  const n = s.order.length, prisoners = Object.values(ba(s).prisoners).reduce((a, b) => a + b, 0);
  return Math.max(0, SUPPLY[n <= 4 ? 0 : n <= 6 ? 1 : 2] - onBoard(s) - prisoners);
}

/**
 * Official landing: per barbarian roll 2d6, rerolling 7s and numbers already rolled; one barbarian goes
 * to each unconquered coastal hex with that number (two hexes share it on bigger boards, as 5 and 9 do
 * in the 5–6 rules). `fixed` lands on a known number.
 */
export function invade(s: State, rolls: number, why: string, fixed = 0) {
  const rnd = random(s, 'cards'), used = new Set<number>(), notes: string[] = [];
  for (let i = 0; i < rolls && supply(s) > 0; i++) {
    let n = fixed;
    while (!n || n === 7 || used.has(n)) n = 2 + int(rnd, 6) + int(rnd, 6);
    used.add(n);
    const open = facts(s).coast.filter(t => face(s, t).number === n && !conquered(s, t));
    if (!open.length) notes.push(`${n} missed`);
    for (const tile of open) {
      if (supply(s) <= 0) break;
      const count = invaders(s, tile) + 1;
      setInvaders(s, tile, count);
      notes.push(count >= 3 ? `${n} conquered!` : `${n}`);
    }
  }
  if (!notes.length) return;
  const text = `Barbarians landed (${why}): ${notes.join(', ')}`;
  emit(s, { kind: 'module', module: 'barbarian-attack', name: 'invade', seat: null, target: null, text });
}

/** A building whose land hexes are all conquered (C&K metropolises never are). */
export function conqueredAt(s: State, v: VertexId): boolean {
  if (s.pieces.buildings[v]?.metropolis) return false;
  const land = (boardIndex(s.board).vertex.get(v)?.tiles ?? []).filter(t => isLandTile(s, t));
  return land.length > 0 && land.every(t => conquered(s, t));
}

export const touchesConquered = (s: State, tiles: readonly TileId[]) => tiles.some(t => conquered(s, t));

/** Buildings of `seat` on the corners of `tile`, weighted like production (city 2). */
export function stake(s: State, seat: SeatId, tile: TileId): number {
  return (boardIndex(s.board).tileVertices.get(tile) ?? []).reduce((n, v) => {
    const b = s.pieces.buildings[v];
    return n + (b?.seat === seat ? (b.kind === 'city' ? 2 : 1) : 0);
  }, 0);
}
