/** Resource values, production estimates and spot scores (pips, variety, ports, scarcity). */
import { pips } from '../geometry';
import {
  GOODS, RESOURCES, type Good, type PublicView, type Resource, type SeatId, type VertexId,
} from '../model';
import { spotBonus } from './advice/index';
import { face, type Index } from './board';
import type { Ctx } from './context';

const isResource = (t: string): t is Resource => (RESOURCES as readonly string[]).includes(t);
const zero = () => Object.fromEntries(RESOURCES.map(r => [r, 0])) as Record<Resource, number>;

/** Pips per resource a vertex touches (gold counts a fifth toward every resource). */
export function yieldOf(pub: PublicView, ix: Index, v: VertexId, blockRobber = true) {
  const out = zero();
  for (const id of ix.vertex.get(v)?.tiles ?? []) {
    const t = ix.tile.get(id);
    if (!t || (blockRobber && pub.pieces.robber === id)) continue;
    const f = face(pub.pieces, t), p = pips(f.number);
    if (isResource(f.terrain)) out[f.terrain] += p;
    else if (f.terrain === 'gold') for (const r of RESOURCES) out[r] += p / 5;
  }
  return out;
}

/** C&K cities take a commodity in place of their second forest, pasture or mountains card. */
const SPLIT: Partial<Record<Resource, Good>> = { wood: 'paper', wool: 'cloth', ore: 'coin' };

/** This seat's expected pips per good (cities count double, robbed hexes do not count). */
export function production(pub: PublicView, ix: Index, seat: SeatId): Record<Good, number> {
  const out = Object.fromEntries(GOODS.map(g => [g, 0])) as Record<Good, number>;
  const split = pub.modules.includes('cities-knights');
  for (const b of Object.values(pub.pieces.buildings)) {
    if (b.seat !== seat) continue;
    const y = yieldOf(pub, ix, b.vertex), city = b.kind === 'city';
    for (const r of RESOURCES) {
      const good = split && city ? SPLIT[r] : undefined;
      out[r] += y[r] * (city && !good ? 2 : 1);
      if (good) out[good] += y[r];
    }
  }
  return out;
}

/** Rarer resources on this board are worth more (0.75 to 1.35). */
export function scarcity(pub: PublicView): Record<Resource, number> {
  const out = zero();
  for (const t of pub.board.tiles) {
    const f = face(pub.pieces, t);
    if (isResource(f.terrain)) out[f.terrain] += pips(f.number);
  }
  const mean = RESOURCES.reduce((n, r) => n + out[r], 0) / RESOURCES.length || 1;
  for (const r of RESOURCES) out[r] = Math.min(1.35, Math.max(0.75, mean / Math.max(1, out[r])));
  return out;
}

const early$ = new WeakMap<Ctx, boolean>();

/** Early game wants wood and brick; later ore and grain. */
function phaseWeight(c: Ctx, r: Resource) {
  let early = early$.get(c);
  if (early === undefined) {
    early = Object.values(c.pub.pieces.buildings).filter(b => b.seat === c.seat).length < 4;
    early$.set(c, early);
  }
  if (r === 'wood' || r === 'brick') return early ? 1.15 : 0.95;
  return r === 'ore' || r === 'grain' ? (early ? 1 : 1.15) : 1;
}

/** Spot-value points per module bonus VP (a good corner is worth about 10). */
const BONUS = 10;

/**
 * Value of settling `v` for this seat: weighted pips, new resource types over `base` production,
 * port fit and module bonuses (island VP, river gold...). `variety` is the bonus per new type.
 */
export function spotValue(c: Ctx, v: VertexId, base: Partial<Record<Good, number>> = c.prod, variety = 1.2) {
  const y = yieldOf(c.pub, c.ix, v, false);
  let value = 0, fresh = 0;
  for (const r of RESOURCES) {
    if (!y[r]) continue;
    value += y[r] * (c.persona.likes[r] ?? 1) * c.scarce[r] * phaseWeight(c, r);
    if (!base[r]) fresh++;
  }
  const robbed = (c.ix.vertex.get(v)?.tiles ?? []).includes(c.pub.pieces.robber ?? '') ? 0.9 : 1;
  const port = c.ix.port.get(v);
  const portValue = !port ? 0 : port.good === 'any' ? 1.2
    : 0.6 + 0.3 * ((base[port.good] ?? 0) + y[port.good]);
  return value * robbed + fresh * variety + portValue * c.persona.ports + BONUS * spotBonus(c, v);
}

/** Sum of weighted pips alone (for comparing cities). */
export const pipsAt = (c: Ctx, v: VertexId) => {
  const y = yieldOf(c.pub, c.ix, v);
  return RESOURCES.reduce((n, r) => n + y[r] * c.scarce[r], 0);
};
