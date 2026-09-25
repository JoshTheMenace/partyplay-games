/** Score parts, longest route, awards with tie logic and win checks (ENGINE §11). */
import type { AwardId, BuildingKind, RouteKind, ScorePart, SeatId, VertexId } from '../model';
import { boardIndex } from './board/lookup';
import { emit } from './events';
import { blocks } from './legal';
import { hooks } from './modules/registry';
import { seatName, type State } from './state';

const part = (key: string, label: string, count: number, each: number): ScorePart =>
  ({ key, label, points: count * each, count });

/** Full breakdown including hidden parts (VP cards) and module `score` hooks. */
export function scoreParts(s: State, seat: SeatId): ScorePart[] {
  const mine = Object.values(s.pieces.buildings).filter(b => b.seat === seat);
  const n = (kind: BuildingKind) => mine.filter(b => b.kind === kind).length;
  const parts = [part('settlements', 'Settlements', n('settlement'), 1), part('cities', 'Cities', n('city'), 2)];
  if (n('harbor')) parts.push(part('harbors', 'Harbor settlements', n('harbor'), 2));
  if (s.awards['longest-road'] === seat) parts.push(part('longest-road', 'Longest Road', 1, 2));
  if (s.awards['largest-army'] === seat) parts.push(part('largest-army', 'Largest Army', 1, 2));
  const vp = s.seats[seat].dev.filter(c => c.kind === 'victory').length;
  if (vp) parts.push({ ...part('vp-cards', 'Victory point cards', vp, 1), hidden: true });
  for (const m of hooks(s, 'score')) parts.push(...m.score(s, seat));
  return parts;
}

/** settings.targetPoints plus module `target` hooks. */
export function target(s: State, seat: SeatId): number {
  return hooks(s, 'target').reduce((n, m) => n + m.target(s, seat), s.settings.targetPoints);
}

/**
 * Port of legacy `longestRoute`: depth-first walk over the seat's routes, each used once. An
 * opponent building (or module blocker) ends the walk at that corner; switching between road and
 * ship needs the seat's own building at the joint. Module `routeWeight` hooks multiply edge values.
 */
export function longestRoute(s: State, seat: SeatId): number {
  const ix = boardIndex(s.board), mine = Object.values(s.pieces.routes).filter(r => r.seat === seat);
  const steps = new Map<VertexId, { i: number; to: VertexId; kind: RouteKind; weight: number }[]>();
  const weigh = (e: string) => hooks(s, 'routeWeight').reduce((w, m) => w * m.routeWeight(s, e), 1);
  mine.forEach((r, i) => {
    const e = ix.edge.get(r.edge), weight = weigh(r.edge);
    for (const [a, b] of e ? [[e.a, e.b], [e.b, e.a]] : []) {
      steps.set(a, [...(steps.get(a) ?? []), { i, to: b, kind: r.kind, weight }]);
    }
  });
  const used = mine.map(() => false);
  const walk = (v: VertexId, came: RouteKind | null): number => {
    if (came && blocks(s, seat, v)) return 0;
    const joint = s.pieces.buildings[v]?.seat === seat;
    let best = 0;
    for (const step of steps.get(v) ?? []) {
      if (used[step.i] || (came && came !== step.kind && !joint)) continue;
      used[step.i] = true;
      best = Math.max(best, step.weight + walk(step.to, step.kind));
      used[step.i] = false;
    }
    return best;
  };
  return Math.max(0, ...[...steps.keys()].map(v => walk(v, null)));
}

/** Legacy `awards` tie logic: a tie with the holder keeps the holder; a leaderless tie leaves nobody. */
function holder(s: State, incumbent: SeatId | null, minimum: number, value: (id: SeatId) => number) {
  const best = Math.max(0, ...s.order.map(value));
  if (best < minimum) return null;
  const top = s.order.filter(id => value(id) === best);
  return incumbent && top.includes(incumbent) ? incumbent : top.length === 1 ? top[0] : null;
}

function award(s: State, id: AwardId, label: string, minimum: number, value: (seat: SeatId) => number) {
  const from = s.awards[id] ?? null, next = holder(s, from, minimum, value);
  if (id in s.awards && next === from) return;
  s.awards[id] = next;
  if (next === from) return;
  const text = next ? `${seatName(s, next)} takes ${label}` : `${label} is unclaimed`;
  emit(s, { kind: 'award', award: id, seat: next, from, text });
}

/** After a commit: recompute longest routes when pieces moved, then both awards and module awards. */
export function updateAwards(s: State) {
  if (s.mapDirty) for (const id of s.order) s.seats[id].longestRoute = longestRoute(s, id);
  if (s.profile.longestRoad) award(s, 'longest-road', 'Longest Road', 5, id => s.seats[id].longestRoute);
  if (s.profile.largestArmy) award(s, 'largest-army', 'Largest Army', 3, id => s.seats[id].knights);
  for (const m of hooks(s, 'awards')) m.awards(s);
}

/** Winners among `candidates`: at or above their target; the highest total wins, ties share. */
export function winCheck(s: State, candidates: SeatId[]): SeatId[] {
  const vp = (id: SeatId) => scoreParts(s, id).reduce((n, p) => n + p.points, 0);
  const qualified = candidates.filter(id => vp(id) >= target(s, id));
  const best = Math.max(...qualified.map(vp));
  return qualified.filter(id => vp(id) === best);
}
