/** Setup placements: the first settlement plans its partner; the second fills resource gaps. */
import { RESOURCES, type Action, type BuildPiece, type Resource, type VertexId } from '../model';
import type { Ctx } from './context';
import { act } from './context';
import { openSpot } from './board';
import { planSpot, routeToward } from './routes';
import { spotValue, yieldOf } from './value';

const SETUP_VARIETY = 2.5;
const none = () => Object.fromEntries(RESOURCES.map(r => [r, 0])) as Record<Resource, number>;

/** Round-2 payout: one card per producing hex, worth more when it is wood or brick. */
function payout(c: Ctx, v: VertexId) {
  const y = yieldOf(c.pub, c.ix, v, false);
  return RESOURCES.reduce((n, r) => n + (y[r] > 0 ? (r === 'wood' || r === 'brick' ? 0.5 : 0.3) : 0), 0);
}

/** Two corners that could both hold settlements (distance rule between them). */
const apart = (c: Ctx, a: VertexId, b: VertexId) =>
  a !== b && !(c.ix.links.get(a) ?? []).some(l => l.to === b);

function settlementSpot(c: Ctx, targets: VertexId[]): VertexId {
  const mine = Object.values(c.pub.pieces.buildings).some(b => b.seat === c.seat);
  const base = mine ? c.prod : none();
  const score = (v: VertexId) => c.jitter(spotValue(c, v, base, SETUP_VARIETY) + (mine ? payout(c, v) : 0));
  const ranked = targets.map(v => ({ v, s: score(v) })).sort((a, b) => b.s - a.s);
  if (mine || !c.k.lookahead) return ranked[0].v;
  // First settlement: add the best partner still open after it, discounted for the picks in between.
  const pool = ranked.slice(0, 20).filter(x => openSpot(c.ix, c.pub.pieces, x.v));
  const partner = (v: VertexId) => Math.max(0, ...pool.filter(x => apart(c, v, x.v))
    .map(x => spotValue(c, x.v, yieldOf(c.pub, c.ix, v, false), SETUP_VARIETY)));
  return ranked.slice(0, 10).map(x => ({ v: x.v, s: x.s + c.k.lookahead * partner(x.v) }))
    .sort((a, b) => b.s - a.s)[0].v;
}

export function setupAction(c: Ctx): Action | null {
  const step = c.pub.turn.setup;
  if (!step || step.seat !== c.seat) return null;
  const route = step.piece === 'road' || step.piece === 'ship';
  const kinds: BuildPiece[] = route ? ['road', 'ship']
    : step.piece === 'city' ? ['city', 'settlement'] : ['settlement', 'city'];
  const options = kinds.flatMap(k => c.me.build.filter(o => o.piece === k && o.targets.length));
  if (!options.length) return null;
  if (!route) {
    const o = options[0];
    return act(c, { type: 'build', piece: o.piece as BuildPiece, at: settlementSpot(c, o.targets) });
  }
  // The route must touch the settlement just placed: head for the best corner two steps out.
  const all = options.flatMap(o => o.targets.map(at => ({ piece: o.piece as BuildPiece, at })));
  const anchor = all.map(x => c.ix.edge.get(x.at)).flatMap(e => (e ? [e.a, e.b] : []))
    .find(v => c.pub.pieces.buildings[v]?.seat === c.seat);
  const plan = anchor ? planSpot(c, [anchor], 3, SETUP_VARIETY) : null;
  const { piece, at } = (plan && routeToward(c, all, plan.spot)) ?? all[0];
  return act(c, { type: 'build', piece, at });
}
