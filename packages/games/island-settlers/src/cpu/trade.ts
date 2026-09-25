/**
 * Trading by hand utility. The same `judge` answers offers and vets our own proposals, so a CPU
 * never offers what it would not accept, and humans and CPUs are judged identically.
 */
import {
  GOODS, RESOURCES, type Action, type Cards, type Good, type Offer, type Resource, type SeatId,
} from '../model';
import { add, count, has, key, missing, total } from './cards';
import { act, nearWin, type Ctx } from './context';
import type { Target } from './plan';
import { yieldOf } from './value';

export type Needs = { a: Cards; b: Cards; next: Cards };

export const needsOf = (top?: Target, second?: Target): Needs =>
  ({ a: top?.cost ?? {}, b: second?.cost ?? {}, next: top?.next.cost ?? {} });

const isResource = (g: Good) => (RESOURCES as readonly string[]).includes(g);

/** Cards toward the top goal count double, the second goal once, the rest by rarity for us. */
export function utility(c: Ctx, hand: Cards, n: Needs) {
  let u = has(hand, n.next) && total(n.next) ? 1.5 : 0;
  for (const g of GOODS) {
    const h = count(hand, g), a = Math.min(h, count(n.a, g)), b = Math.min(h - a, count(n.b, g));
    const made = (c.prod as Partial<Record<Good, number>>)[g] ?? 0;
    const base = isResource(g) ? 0.35 + 0.3 * (1 - Math.min(1, made / 8)) : 0.5;
    u += a * 2 + b + (h - a - b) * base;
  }
  const limit = c.pub.seats.find(s => s.id === c.seat)?.discardLimit ?? 7;
  return u - 0.15 * Math.max(0, total(hand) - limit);
}

/**
 * Would we swap `give` for `get` with `from`? Returns a one-line reason when not. `strict` (our own
 * proposals) must pass even at the worst noise, so we never offer what we would refuse.
 */
export function judge(c: Ctx, give: Cards, get: Cards, from: SeatId | null, n: Needs, strict = false) {
  if (from && c.k.embargo && nearWin(c, from)) return `Not while you're at ${c.vp.get(from)} VP`;
  if (!has(c.me.hand, give)) return "I don't have those cards";
  if (total(give) > 3 || total(get) > 3) return 'Too big a trade for me';
  const gain = utility(c, add(add(c.me.hand, give, -1), get), n) - utility(c, c.me.hand, n);
  return (strict ? gain * (1 - c.k.noise) : c.jitter(gain)) > c.k.greed ? null : 'Not a good deal for me';
}

/** Answer (or, on Sharp, counter) the first offer waiting on us. */
export function respondAction(c: Ctx, n: Needs): Action | null {
  const offer = c.pub.offers.find(o => o.from !== c.seat && o.responses[c.seat] === 'pending'
    && c.me.offers.some(s => s.id === o.id));
  if (!offer) return null;
  const state = c.me.offers.find(s => s.id === offer.id)!;
  const reason = state.canAccept ? judge(c, offer.want, offer.give, offer.from, n) : 'Not this time';
  if (!reason) return act(c, { type: 'respond', offer: offer.id, answer: 'accept' });
  const counter = state.canCounter && c.k.counters && !reason.startsWith('Not while') && counterOf(c, offer, n);
  if (counter) {
    c.mem.countered.push(offer.id);
    return act(c, { type: 'offer', ...counter, to: [offer.from], counterTo: offer.id });
  }
  return act(c, { type: 'respond', offer: offer.id, answer: 'decline', reason });
}

/** Sharp counters: ask for the same cards but pay one fewer, or pay with a spare good instead. */
function counterOf(c: Ctx, o: Offer, n: Needs) {
  if (c.mem.countered.includes(o.id) || c.pub.offers.some(x => x.from === c.seat)) return null;
  const biggest = GOODS.reduce((a, b) => (count(o.want, b) > count(o.want, a) ? b : a));
  const options: Cards[] = total(o.want) > 1 ? [add(o.want, { [biggest]: 1 }, -1)] : [];
  for (const g of spare(c, n)) if (!count(o.give, g)) options.push({ [g]: 1 });
  const give = options.find(g => total(g) && !judge(c, g, o.give, o.from, n, true));
  return give ? { give, want: o.give } : null;
}

/** Goods we hold beyond both goals, most spare first. */
function spare(c: Ctx, n: Needs): Good[] {
  const extra = (g: Good) => count(c.me.hand, g) - count(n.a, g) - count(n.b, g);
  return GOODS.filter(g => extra(g) > 0).sort((a, b) => extra(b) - extra(a));
}

/** Post one player trade toward the next purchase (Normal: 1 per turn, Sharp: 2). */
export function proposeAction(c: Ctx, n: Needs): Action | null {
  const open = c.pub.offers.some(o => o.from === c.seat);
  if (!c.me.can.propose || c.mem.proposals >= c.k.proposals || open) return null;
  const partners = c.me.partners.filter(id => !(c.k.embargo && nearWin(c, id)));
  const lack = missing(c.me.hand, total(missing(c.me.hand, n.next)) ? n.next : n.a);
  const wants = GOODS.filter(g => count(lack, g) > 0).sort((a, b) => count(lack, b) - count(lack, a));
  if (!partners.length || !wants.length) return null;
  for (const w of wants.slice(0, 2)) for (const g of spare(c, n)) for (const k of [1, 2]) {
    const give = { [g]: k }, get = { [w]: 1 };
    if (c.mem.tried.includes(key(give) + key(get)) || judge(c, give, get, null, n, true)) continue;
    const producers = partners.filter(id => producesAny(c, id, w));
    const to = producers.length ? producers : partners;
    c.mem.proposals++;
    c.mem.tried.push(key(give) + key(get));
    c.mem.waits = 0;
    const everyone = to.length === c.me.partners.length;
    return act(c, { type: 'offer', give, want: get, to: everyone ? [] : to, counterTo: null });
  }
  return null;
}

/** Public information only: does this seat have a building on a hex of that resource? */
function producesAny(c: Ctx, seat: SeatId, g: Good) {
  if (!isResource(g)) return true;
  return Object.values(c.pub.pieces.buildings)
    .some(b => b.seat === seat && yieldOf(c.pub, c.ix, b.vertex)[g as Resource] > 0);
}

/**
 * Follow up our own open offer: confirm with an accepting seat, wait a little for answers
 * ('wait'), or withdraw it.
 */
export function ownOfferAction(c: Ctx, n: Needs): Action | 'wait' | null {
  const o = c.pub.offers.find(x => x.from === c.seat && !x.counterTo);
  if (!o) return null;
  const accepted = Object.entries(o.responses).filter(([, r]) => r === 'accept').map(([id]) => id);
  if (accepted.length && !judge(c, o.give, o.want, null, n)) {
    const partner = accepted.reduce((a, b) => ((c.vp.get(b) ?? 0) < (c.vp.get(a) ?? 0) ? b : a));
    return act(c, { type: 'confirm-trade', offer: o.id, partner });
  }
  const waiting = Object.values(o.responses).some(r => r === 'pending');
  if (waiting && !accepted.length && c.mem.waits < 2) { c.mem.waits++; return 'wait'; }
  return act(c, { type: 'withdraw', offer: o.id });
}

/** Hand size above the discard limit (0 when safe). */
export const overflow = (c: Ctx) =>
  Math.max(0, total(c.me.hand) - (c.pub.seats.find(s => s.id === c.seat)?.discardLimit ?? 7));

/**
 * Bank or port trade toward the next purchase once it is close, or, with too many cards for a 7,
 * toward whatever the plans (else our thinnest pile) lack.
 */
export function bankAction(c: Ctx, n: Needs): Action | null {
  if (!c.me.can.bank || c.mem.banks >= 3) return null;
  const big = overflow(c) > 0, next = missing(c.me.hand, n.next);
  let lack = total(next) && (total(next) <= 2 || big) ? next : {};
  if (big && !total(lack)) lack = missing(c.me.hand, add(n.a, n.b));
  const keep = big ? n.next : n.a;
  const gets = GOODS.filter(g => count(lack, g) > 0 && count(c.pub.bank, g) > 0);
  if (big && !gets.length) gets.push(...RESOURCES.filter(g => count(c.pub.bank, g) > 0)
    .sort((a, b) => count(c.me.hand, a) - count(c.me.hand, b)).slice(0, 1));
  let best: { give: Good; get: Good; rate: number; extra: number } | null = null;
  for (const get of gets) {
    for (const give of GOODS) {
      const rate = c.me.rates[give], extra = count(c.me.hand, give) - count(keep, give);
      if (give === get || !rate || count(lack, give) || extra < rate) continue;
      const better = !best || rate < best.rate || (rate === best.rate && extra > best.extra);
      if (better) best = { give, get, rate, extra };
    }
  }
  if (!best) return null;
  c.mem.banks++;
  return act(c, { type: 'bank', give: { [best.give]: best.rate }, get: { [best.get]: 1 } });
}
