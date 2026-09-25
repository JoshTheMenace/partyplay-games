/** Board and turn helpers for the rules tests. Every change goes through the engine's commit path. */
import assert from 'node:assert/strict';
import { GOODS, type BuildingKind, type Cards, type GameEvent, type RouteKind } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { transfer } from '../../src/engine/cards';
import { isLandTile } from '../../src/engine/legal';
import { placeBuilding, placeRoute, removeBuilding, removeRoute } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { act, edit, grant, pastSetup, rig } from '../helpers';

export const ix = (s: State) => boardIndex(s.board);

/** The latest public event of `kind`. */
export const last = <K extends GameEvent['kind']>(s: State, kind: K) =>
  [...s.events].reverse().find((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);

/** Dice showing `total`. */
export const dice = (total: number): [number, number] => (total <= 7 ? [1, total - 1] : [total - 6, 6]);

/** Past setup, every piece removed and every hand returned to the bank, at the first roll. */
export function blank(s: State) {
  pastSetup(s);
  edit(s, n => {
    for (const v of Object.keys(n.pieces.buildings)) removeBuilding(n, v);
    for (const e of Object.keys(n.pieces.routes)) removeRoute(n, e);
    for (const id of n.order) transfer(n.seats[id].hand, n.bank, { ...n.seats[id].hand });
  });
  return s;
}

/** Roll `total` (not 7) as the active seat and stand in its main step (Connect: the round window). */
export function toMain(s: State, total = 3) {
  rig(s, dice(total));
  act(s, s.turn.active!, { type: 'roll' });
  assert.equal(s.turn.stage, s.settings.mode === 'connect' ? 'round' : 'main');
}

export const settle = (s: State, seat: string, vertex: string, kind: BuildingKind = 'settlement') =>
  edit(s, n => placeBuilding(n, { vertex, seat, kind }));

export const lay = (s: State, seat: string, edges: string[], kind: RouteKind = 'road') =>
  edit(s, n => { for (const edge of edges) placeRoute(n, { edge, seat, kind }); });

export const give = (s: State, seat: string, cards: Cards) => grant(s, seat, cards);

/** Every card of `seat` back to the bank. */
export const clear = (s: State, seat: string) =>
  edit(s, n => transfer(n.seats[seat].hand, n.bank, { ...n.seats[seat].hand }));

export const hand = (s: State, seat: string): Cards =>
  Object.fromEntries(GOODS.filter(g => s.seats[seat].hand[g]).map(g => [g, s.seats[seat].hand[g]]));

/** Vertices where all three hexes are land. */
export const inland = (s: State) =>
  s.board.vertices.filter(v => v.tiles.length === 3 && v.tiles.every(t => isLandTile(s, t))).map(v => v.id);

/**
 * A simple path of `n` inland edges (no repeated corner), avoiding `avoid` corners and their
 * neighbours so separate paths never touch. Returns the corners (n + 1) and the edges (n).
 */
export function trail(s: State, n: number, avoid = new Set<string>()) {
  const index = ix(s), land = new Set(inland(s));
  const near = (v: string) => avoid.has(v) || (index.vertexNeighbors.get(v) ?? []).some(x => avoid.has(x));
  const walk = (path: string[]): string[] | null => {
    if (path.length === n + 1) return path;
    for (const next of index.vertexNeighbors.get(path.at(-1)!) ?? []) {
      if (!land.has(next) || path.includes(next) || near(next)) continue;
      const found = walk([...path, next]);
      if (found) return found;
    }
    return null;
  };
  for (const start of land) {
    if (near(start)) continue;
    const vertices = walk([start]);
    if (vertices) {
      for (const v of vertices) avoid.add(v);
      const edges = vertices.slice(1).map((v, i) => index.edgeBetween.get(`${vertices[i]} ${v}`)!);
      return { vertices, edges };
    }
  }
  throw new Error(`no trail of ${n}`);
}

/** A simple path of `n` edges from `start` through corners not in `used` (which it extends). */
export function walk(s: State, start: string, n: number, used: Set<string> = new Set()) {
  const index = ix(s);
  const go = (path: string[]): string[] | null => {
    if (path.length === n + 1) return path;
    for (const next of index.vertexNeighbors.get(path.at(-1)!) ?? []) {
      const found = used.has(next) || path.includes(next) ? null : go([...path, next]);
      if (found) return found;
    }
    return null;
  };
  const vertices = go([start]);
  assert.ok(vertices, `no walk of ${n} from ${start}`);
  for (const v of vertices) used.add(v);
  return { vertices, edges: vertices.slice(1).map((v, i) => index.edgeBetween.get(`${vertices[i]} ${v}`)!) };
}
