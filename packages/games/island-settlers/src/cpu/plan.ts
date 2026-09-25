/**
 * Goal planner: scores city, settlement, expansion (roads toward a planned spot), Longest Road,
 * development cards and paid module commands by value over estimated turns to afford, with a
 * win-now boost near the target.
 */
import { COSTS, GOODS, type BuildOption, type Cards, type Command, type Purchase, type VertexId }
  from '../model';
import { worth } from './advice/index';
import { isLandVertex, network, openSpot } from './board';
import { add, count, has, missing, total } from './cards';
import type { Ctx } from './context';
import type { Goal } from './personas';
import { planSpot } from './routes';
import { overflow } from './trade';
import { pipsAt, spotValue } from './value';

/** One goal: `cost` is the whole plan (kept cards), `next` the purchase (or module command) to make now. */
export type Target = {
  goal: Goal; score: number; cost: Cards;
  next: { piece: Purchase | null; cost: Cards; at: string | null; command?: Command };
  /** Planned settlement corner for expansion goals. */
  spot: VertexId | null;
};

export const option = (c: Ctx, piece: Purchase): BuildOption | undefined =>
  c.me.build.find(o => o.piece === piece);

/** An option we may buy right now at `at` (free placements count as affordable). */
export const buildable = (o: BuildOption | undefined, at: string | null) =>
  !!o && (o.why === null || o.free > 0) && (o.piece === 'development' || (!!at && o.targets.includes(at)));

const times = (cost: Cards, n: number): Cards =>
  Object.fromEntries(Object.entries(cost).map(([g, v]) => [g, (v ?? 0) * n]));

/** Rough opportunities until `cost` is in hand: missing cards over income, less bank-able surplus. */
function eta(c: Ctx, cost: Cards) {
  const hand = c.me.hand, need = missing(hand, cost);
  const rolls = c.pub.settings.mode === 'connect' ? 1 : c.pub.seats.length;
  let turns = 0, lots = 0;
  for (const g of GOODS) {
    turns += count(need, g) / (c.prod[g] * rolls / 36 + 0.25);
    lots += Math.floor(Math.max(0, count(hand, g) - count(cost, g)) / (c.me.rates[g] ?? 4));
  }
  return Math.max(0, turns - lots * 1.5);
}

/** Road to extend for Longest Road: a target touching one of our route ends, when the race is close. */
function longestRoad(c: Ctx, targets: string[]) {
  const off = c.pub.modules.some(m => m === 'explorers' || m === 'deliveries');
  if (off || c.pub.awards['longest-road'] === c.seat) return null;
  const mine = c.pub.seats.find(s => s.id === c.seat)?.longestRoute ?? 0;
  const best = Math.max(4, ...c.pub.seats.filter(s => s.id !== c.seat).map(s => s.longestRoute));
  if (mine < best - 2) return null;
  const degree = new Map<string, number>();
  for (const r of Object.values(c.pub.pieces.routes)) {
    const e = r.seat === c.seat ? c.ix.edge.get(r.edge) : undefined;
    for (const v of e ? [e.a, e.b] : []) degree.set(v, (degree.get(v) ?? 0) + 1);
  }
  const end = (v: string) => degree.get(v) === 1;
  const at = targets.find(id => { const e = c.ix.edge.get(id); return !!e && (end(e.a) || end(e.b)); });
  return at ? { at, need: best + 1 - mine } : null;
}

/** Multiplier for a purchase worth `vp`: huge when it wins now, a little more when it gets close. */
export function winBoost(c: Ctx, vp: number) {
  const left = c.me.target - c.me.vp;
  return vp >= left ? 25 : vp >= left - 1 ? 1.5 : 1;
}

export function goals(c: Ctx): Target[] {
  const out: Target[] = [], left = c.me.target - c.me.vp, bias = (g: Goal) => c.persona.goals[g] ?? 1;
  const win = (vp: number) => winBoost(c, vp);
  type Spot = VertexId | null;
  const push = (goal: Goal, value: number, cost: Cards, piece: Purchase, at: string | null, spot: Spot) =>
    out.push({ goal, cost, next: { piece, cost: COSTS[piece], at }, spot,
      score: c.jitter((value * bias(goal)) / (1 + eta(c, cost))) });
  const mine = Object.values(c.pub.pieces.buildings).filter(b => b.seat === c.seat);

  const city = option(c, 'city');
  const cities = city?.targets.length ? city.targets
    : mine.filter(b => b.kind === 'settlement').map(b => b.vertex);
  if (city && city.left !== 0 && cities.length) {
    const at = cities.reduce((a, b) => (pipsAt(c, b) > pipsAt(c, a) ? b : a));
    push('city', (1.3 + 0.1 * pipsAt(c, at)) * win(1), COSTS.city, 'city', at, null);
  }
  const settle = option(c, 'settlement'), road = option(c, 'road') ?? option(c, 'ship');
  if (settle && settle.left !== 0) {
    const here = settle.targets.length ? settle.targets : network(c.ix, c.pub.pieces, c.seat)
      .filter(v => openSpot(c.ix, c.pub.pieces, v) && isLandVertex(c.ix, c.pub.pieces, c.ix.vertex.get(v)!));
    if (here.length) {
      const at = here.reduce((a, b) => (spotValue(c, b) > spotValue(c, a) ? b : a));
      push('settlement', (1.1 + 0.1 * spotValue(c, at)) * win(1), COSTS.settlement, 'settlement', at, null);
    }
    const plan = road && road.left !== 0 && !here.length ? planSpot(c) : null;
    const kind = plan && option(c, plan.piece);
    if (plan && kind && kind.left !== 0) {
      const cost = add(COSTS.settlement, times(COSTS[plan.piece], plan.steps));
      push('road', 1 + 0.1 * plan.value, cost, plan.piece, null, plan.spot);
    }
  }
  // Idle: no city, settlement or expansion left to plan (a full board), so cheaper module goals count.
  const idle = !out.length;
  const lr = road && road.left !== 0 && !settle?.targets.length && longestRoad(c, road.targets);
  if (lr && road && lr.need <= 2) {
    push('road', (1.2 / Math.max(1, lr.need)) * win(2), COSTS.road, road.piece, lr.at, null);
  }

  const dev = option(c, 'development');
  if (dev && c.pub.devDeck > 0 && dev.why?.code !== 'deck-empty' && dev.why?.code !== 'no-pieces') {
    const knights = c.pub.seats.find(s => s.id === c.seat)?.knights ?? 0;
    const top = Math.max(2, ...c.pub.seats.filter(s => s.id !== c.seat).map(s => s.knights));
    const army = c.pub.awards['largest-army'] !== c.seat && knights >= top - 1 ? 0.35 : 0;
    push('dev', (0.4 + army) * (left <= 2 ? 1.4 : 1), COSTS.development, 'development', null, null);
  }
  for (const command of c.me.commands) {
    // Below 0.9 (a hint of 0.45) a cheap command would outrank real goals just by costing little,
    // unless we are idle or the hand is over the 7 limit and would otherwise be lost.
    const value = command.cost && total(command.cost) ? worth(c, command) : 0;
    if (value < (idle || overflow(c) ? 0.3 : 0.9)) continue;
    const cost = command.cost!;
    out.push({ goal: 'module', cost, next: { piece: null, cost, at: null, command }, spot: null,
      score: c.jitter((value * bias('module')) / (1 + eta(c, cost))) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** A point now is always fine; other buys may not set back the top goal's next purchase. */
export function compatible(c: Ctx, g: Target, top: Target) {
  if (g === top || g.goal === 'city' || g.goal === 'settlement') return true;
  const after = add(c.me.hand, g.next.cost, -1);
  return total(missing(after, top.next.cost)) <= total(missing(c.me.hand, top.next.cost));
}

export type Pick = { piece: Purchase; at: string | null } | { command: Command };

/** The best goal purchase we can make now without setting back the top goal, or null. */
export function affordable(c: Ctx, list: Target[], pick: (t: Target) => Pick | null): Pick | null {
  for (const g of list) {
    const p = pick(g);
    if (!p || !compatible(c, g, list[0])) continue;
    if ('command' in p) {
      if (has(c.me.hand, p.command.cost ?? {})) return p;
      continue;
    }
    const o = option(c, p.piece);
    if (o && buildable(o, p.at) && (o.free > 0 || has(c.me.hand, o.cost))) return p;
  }
  return null;
}
