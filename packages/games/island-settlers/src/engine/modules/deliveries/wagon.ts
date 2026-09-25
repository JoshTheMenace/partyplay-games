/**
 * Wagons (one `wagon` unit per seat, level 1–5). After building, a seat drives corner to corner:
 * 2 MP per edge, 1 MP on its own road, 1 MP + 1 gold (to the owner) on another seat's road, +2 MP
 * where a road barbarian stands. Entering a depot ends the move: deliver a wanted cargo (1 VP, gold
 * by level), then pick up the depot's next token if the wagon is empty.
 */
import type { CargoKind, EdgeId, SeatId, Unit, VertexId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { emit } from '../../events';
import { need } from '../../need';
import { updateUnit } from '../../pieces';
import { seatName, type State } from '../../state';
import { invaded, invaders } from '../barbarian-attack/coast';
import { depots, dl, PAY, WANTS } from './depots';

export const wagon = (s: State, seat: SeatId): Unit | undefined => s.pieces.units[`w-${seat}`];

/** Edges holding a road barbarian → its unit id, or (with Barbarian Attack) the coastal hex it is from. */
export function raiders(s: State): Map<EdgeId, string> {
  const out = new Map<EdgeId, string>();
  if (!s.modules.includes('barbarian-attack')) {
    for (const u of Object.values(s.pieces.units)) if (u.kind === 'raider') out.set(u.at, u.id);
    return out;
  }
  for (const t of invaded(s)) {
    let k = invaders(s, t);
    for (const e of boardIndex(s.board).tileEdges.get(t)!) if (k > 0 && !out.has(e)) { out.set(e, t); k--; }
  }
  return out;
}

/** MP and toll for this seat's wagon to cross `e` (null: wagons stay on land edges). */
export function edgeCost(s: State, seat: SeatId, e: EdgeId, blocked = raiders(s)) {
  const edge = boardIndex(s.board).edge.get(e), r = s.pieces.routes[e];
  if (!edge?.land) return null;
  return { mp: (r ? 1 : 2) + (blocked.has(e) ? 2 : 0), owner: r && r.seat !== seat ? r.seat : null };
}

export type Step = { edge: EdgeId; to: VertexId };
export type Trip = { mp: number; gold: number; path: Step[] };

/**
 * Cheapest trips from the wagon within `budget` MP and the seat's gold; depots end a trip. With
 * `tolls` false, other seats' roads are avoided (a short purse can still reach everything by land).
 */
function search(s: State, seat: SeatId, budget: number, tolls: boolean): Map<VertexId, Trip> {
  const w = wagon(s, seat), ix = boardIndex(s.board), blocked = raiders(s), stops = depots(s);
  const purse = dl(s).gold[seat], best = new Map<VertexId, Trip>(), done = new Set<VertexId>();
  if (!w) return best;
  best.set(w.at, { mp: 0, gold: 0, path: [] });
  for (;;) {
    let v: VertexId | null = null;
    for (const [k, t] of best) if (!done.has(k) && (v === null || t.mp < best.get(v)!.mp)) v = k;
    if (v === null) return best;
    done.add(v);
    if (v !== w.at && stops.has(v)) continue;
    const from = best.get(v)!;
    for (const e of ix.vertex.get(v)!.edges) {
      const c = edgeCost(s, seat, e, blocked), edge = ix.edge.get(e)!, to = edge.a === v ? edge.b : edge.a;
      if (!c || (c.owner && !tolls)) continue;
      const mp = from.mp + c.mp, gold = from.gold + (c.owner ? 1 : 0), old = best.get(to);
      const worse = old && (old.mp < mp || (old.mp === mp && old.gold <= gold));
      if (mp > budget || gold > purse || worse) continue;
      best.set(to, { mp, gold, path: [...from.path, { edge: e, to }] });
    }
  }
}

/**
 * Trips paying tolls where the purse allows, else around other seats' roads. Memoised on the commit's
 * own module state (cloned every commit), keyed by what can change inside one action: wagon and gold.
 */
const memo = new WeakMap<object, Map<string, Map<VertexId, Trip>>>();
export function trips(s: State, seat: SeatId, budget: number): Map<VertexId, Trip> {
  const x = dl(s), key = `${seat} ${budget} ${wagon(s, seat)?.at} ${x.gold[seat]}`;
  const known = memo.get(x) ?? new Map<string, Map<VertexId, Trip>>();
  memo.set(x, known);
  const hit = known.get(key);
  if (hit) return hit;
  const paid = search(s, seat, budget, true);
  for (const [v, trip] of search(s, seat, budget, false)) if (!paid.has(v)) paid.set(v, trip);
  known.set(key, paid);
  return paid;
}

/** The depot the wagon should head for: where its cargo is wanted, else the nearest one with cargo. */
export function goal(s: State, seat: SeatId): VertexId | null {
  const w = wagon(s, seat), map = w ? trips(s, seat, Infinity) : new Map<VertexId, Trip>();
  const cargo = w?.cargo[0] as CargoKind | undefined;
  const fits = ([v, d]: [VertexId, keyof typeof WANTS]) =>
    v !== w?.at && map.has(v) && (cargo ? WANTS[d].includes(cargo) : dl(s).decks[d].length > 0);
  const nearest = (a: VertexId, b: VertexId) => map.get(a)!.mp - map.get(b)!.mp;
  return [...depots(s)].filter(fits).map(([v]) => v).sort(nearest)[0] ?? null;
}

/** The part of the road to the goal this turn's MP (plus `extra`) covers. */
export function leg(s: State, seat: SeatId, extra = 0) {
  const target = goal(s, seat), path = target ? trips(s, seat, Infinity).get(target)!.path : [];
  const out: typeof path = [], blocked = raiders(s);
  let left = dl(s).mp[seat] + extra, gold = dl(s).gold[seat];
  for (const step of path) {
    const c = edgeCost(s, seat, step.edge, blocked)!;
    if (c.mp > left || (c.owner && gold < 1)) break;
    left -= c.mp;
    if (c.owner) gold--;
    out.push(step);
  }
  return { steps: out, arrives: !!target && out.at(-1)?.to === target };
}

/** Drive along `steps`, paying MP and tolls edge by edge (one `move` event each). */
export function drive(s: State, seat: SeatId, steps: Step[]) {
  const x = dl(s), w = wagon(s, seat)!, blocked = raiders(s);
  need(steps.length, 'Your wagon cannot move there.');
  for (const { edge, to } of steps) {
    const c = edgeCost(s, seat, edge, blocked), from = w.at;
    need(c && c.mp <= x.mp[seat] && (!c.owner || x.gold[seat] >= 1), 'Not enough movement or gold for that.');
    x.mp[seat] -= c.mp;
    if (c.owner) { x.gold[seat]--; x.gold[c.owner]++; }
    updateUnit(s, w.id, { at: to });
    const text = `${seatName(s, seat)} drove a wagon`;
    emit(s, { kind: 'move', seat, piece: 'wagon', unit: w.id, from, to, text });
  }
  s.seats[seat].moved = true;
  const depot = depots(s).get(w.at);
  if (depot) arrive(s, seat, w, depot);
}

function arrive(s: State, seat: SeatId, w: Unit, depot: keyof typeof WANTS) {
  const x = dl(s), cargo = w.cargo[0] as CargoKind | undefined, name = seatName(s, seat);
  x.mp[seat] = 0;
  let load = w.cargo;
  if (cargo && WANTS[depot].includes(cargo)) {
    x.delivered[seat]++;
    x.gold[seat] += PAY[w.level - 1];
    load = [];
    const text = `${name} delivered ${cargo} to the ${depot} (+${PAY[w.level - 1]} gold)`;
    emit(s, { kind: 'module', module: 'deliveries', name: 'deliver', seat, target: w.at, text });
  }
  if (!load.length && x.decks[depot].length) load = [x.decks[depot].pop()!];
  updateUnit(s, w.id, { cargo: load });
}
