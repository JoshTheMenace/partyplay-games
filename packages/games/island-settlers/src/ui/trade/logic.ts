/** Pure trade helpers: draft edits, bank lots, quick offers and the words every trade screen prints. */
import {
  COMMODITIES, RESOURCES, type Cards, type Good, type Offer, type OfferResponse, type PrivateView, type PublicView,
  type SeatId,
} from '../../model';
import { canAfford, cardTotal, cardsText, count, goodText, goodsIn, listText } from '../shared/format';
import { nameOf } from '../shared/seats';
import type { Draft } from './draft';

/** Goods on the trade screens: the five resources, plus commodities in Cities & Knights. */
export const tradeGoods = (pub: PublicView): Good[] =>
  pub.modules.includes('cities-knights') ? [...RESOURCES, ...COMMODITIES] : [...RESOURCES];

/** Drops zero counts so actions stay sparse. */
export const clean = (cards: Cards): Cards => Object.fromEntries(goodsIn(cards).map(g => [g, count(cards, g)]));
export const bump = (cards: Cards, good: Good, by: number): Cards =>
  clean({ ...cards, [good]: Math.max(0, count(cards, good) + by) });
const without = (cards: Cards, good: Good) => bump(cards, good, -count(cards, good));

// ---------------------------------------------------------------- player offers

export type Sides = { give: Cards; want: Cards };

/** Adds one card to a side. A good sits on one side only, and Give never exceeds the hand. */
export function tapSide(d: Sides, side: keyof Sides, good: Good, hand: Cards): Sides {
  if (side === 'give' && count(d.give, good) >= count(hand, good)) return d;
  const other = side === 'give' ? 'want' : 'give';
  return { ...d, [side]: bump(d[side], good, 1), [other]: without(d[other], good) } as Sides;
}

/** Up to 3 "1 wool for 1 ore" fills from your largest piles, when Get holds one good and Give is empty. */
export function quickOffers(hand: Cards, d: Sides, goods: Good[]): Cards[] {
  const [good, ...more] = goodsIn(d.want);
  if (!good || more.length || cardTotal(d.give)) return [];
  const n = count(d.want, good);
  return goods.filter(g => g !== good && count(hand, g) >= n)
    .sort((a, b) => count(hand, b) - count(hand, a)).slice(0, 3).map(g => ({ [g]: n }));
}

export const EMPTY_OFFER = 'Pick cards to build an offer';

/** Why the composer can't post yet, or null. counter: the OfferState of the offer being countered. */
export function offerProblem(me: PrivateView, d: Sides, counter: boolean | null): string | null {
  if (counter === false) return "You can't counter this offer";
  if (counter === null && !me.can.propose) return me.why.propose?.text ?? "You can't offer trades right now";
  if (counter === null && !me.partners.length) return 'Nobody can trade with you right now';
  if (!cardTotal(d.give) && !cardTotal(d.want)) return EMPTY_OFFER;
  if (!cardTotal(d.give)) return 'Choose what you give';
  if (!cardTotal(d.want)) return 'Choose what you want';
  if (!canAfford(me.hand, d.give)) return 'You no longer have those cards';
  return null;
}

/** "You give 2 wool, you get 1 ore"; a missing side is left out ("You get 1 ore"). */
/** The composer mirrored and prefilled for a counter: give what they wanted, as far as the hand goes. */
export const counterDraft = (offer: Offer, hand: Cards): Partial<Draft> => ({
  seg: 'players', to: [offer.from], counterTo: offer.id, want: offer.give,
  give: clean(Object.fromEntries(goodsIn(offer.want)
    .map(g => [g, Math.min(count(offer.want, g), count(hand, g))]))),
});

export const summaryText = (d: Sides) => [cardTotal(d.give) && `you give ${cardsText(d.give)}`,
  cardTotal(d.want) && `you get ${cardsText(d.want)}`].filter(Boolean).join(', ').replace(/^y/, 'Y');

// ---------------------------------------------------------------- bank and harbours

export const rateOf = (rates: Cards, good: Good) => rates[good] || 4;

/** Bank lots in give, or -1 when a good is not a whole multiple of its rate. */
export function lots(give: Cards, rates: Cards) {
  const goods = goodsIn(give);
  if (goods.some(g => count(give, g) % rateOf(rates, g))) return -1;
  return goods.reduce((sum, g) => sum + count(give, g) / rateOf(rates, g), 0);
}

/** Mirrors ENGINE §9.3: whole lots, lots = cards got, no good on both sides, bank holds get. */
export function bankProblem(give: Cards, get: Cards, rates: Cards, hand: Cards, bank: Cards): string | null {
  const n = lots(give, rates), m = cardTotal(get);
  if (n < 0) return 'Give whole lots at your rates';
  if (!n) return 'Pick a card to give';
  if (goodsIn(give).some(g => count(get, g))) return 'Get a different good than you give';
  if (!canAfford(hand, give)) return 'You no longer have those cards';
  const short = goodsIn(get).find(g => count(bank, g) < count(get, g));
  if (short) return `The bank has only ${goodText(count(bank, short), short)}`;
  if (m < n) return `Pick ${n - m} more to get`;
  if (m > n) return `Give ${m - n} more ${m - n === 1 ? 'lot' : 'lots'}`;
  return null;
}

/** "3:1", or "4:1 + 2:1" for a mix. */
export const ratioText = (give: Cards, rates: Cards) =>
  [...new Set(goodsIn(give).map(g => rateOf(rates, g)))].sort().map(r => `${r}:1`).join(' + ');

/** Bank Give tap: one more lot of this good if the hand covers it. */
export function tapBankGive(d: { bankGive: Cards; bankGet: Cards }, good: Good, hand: Cards, rates: Cards) {
  const rate = rateOf(rates, good);
  if (count(hand, good) < count(d.bankGive, good) + rate) return d;
  return { bankGive: bump(d.bankGive, good, rate), bankGet: without(d.bankGet, good) };
}

/**
 * Bank Get tap: fills an open lot, else adds another lot of a give good the hand covers, else (nothing
 * given yet) auto-fills Give with your best rate.
 */
export function tapBankGet(
  d: { bankGive: Cards; bankGet: Cards }, good: Good, hand: Cards, rates: Cards, bank: Cards, goods: Good[],
) {
  if (count(d.bankGive, good) || count(bank, good) <= count(d.bankGet, good)) return d;
  const bankGet = bump(d.bankGet, good, 1);
  if (cardTotal(d.bankGet) < lots(d.bankGive, rates)) return { ...d, bankGet };
  const more = goodsIn(d.bankGive).find(g => count(hand, g) >= count(d.bankGive, g) + rateOf(rates, g));
  if (more) return { bankGive: bump(d.bankGive, more, rateOf(rates, more)), bankGet };
  const fill = cardTotal(d.bankGive) ? null : bankFill(hand, { [good]: 1 }, rates, bank, goods);
  return fill ? { bankGive: fill, bankGet } : d;
}

/** A bank fill for the one good in Get, e.g. { wool: 3 } for 1 ore at 3:1; null when unaffordable. */
export function bankFill(hand: Cards, want: Cards, rates: Cards, bank: Cards, goods: Good[]): Cards | null {
  const [good, ...more] = goodsIn(want);
  if (!good || more.length || count(bank, good) < count(want, good)) return null;
  const n = count(want, good);
  const best = goods.filter(g => g !== good && count(hand, g) >= rateOf(rates, g) * n)
    .sort((a, b) => rateOf(rates, a) - rateOf(rates, b) || count(hand, b) - count(hand, a))[0];
  return best ? { [best]: rateOf(rates, best) * n } : null;
}

/** "You need 4 of one resource (or a harbour)", "You need 2 wool or 4 of any other resource". */
export function lotNeedText(rates: Cards, goods: Good[]) {
  const top = Math.max(...goods.map(g => rateOf(rates, g))), better = goods.filter(g => rateOf(rates, g) < top);
  if (!better.length) return `You need ${top} of one resource${top >= 4 ? ' (or a harbour)' : ''}`;
  return `You need ${better.map(g => goodText(rateOf(rates, g), g)).join(', ')} or ${top} of any other resource`;
}

// ---------------------------------------------------------------- offers on screen

/** Seats that answer this offer, in seat order (the TV hides 'unable'). */
export const answerers = (offer: Offer) => Object.keys(offer.responses);
export const accepters = (offer: Offer) => answerers(offer).filter(id => offer.responses[id] === 'accept');

/** "to everyone", "to Bo and Cy". */
export const audienceText = (pub: PublicView, offer: Offer) =>
  offer.broadcast ? 'to everyone' : `to ${listText(offer.to.map(id => nameOf(pub, id)))}`;

/** Phone headline, from the recipient's side: "Bo offers 1 ore for your 2 wool". */
export const offerLine = (pub: PublicView, offer: Offer) =>
  `${nameOf(pub, offer.from)} ${offer.counterTo ? 'counters:' : 'offers'} ${cardsText(offer.give)} for your ${
    cardsText(offer.want)}`;

/** TV overflow row: "Bo: 1 ore for 2 wool (2 accept)". */
export function rowText(pub: PublicView, offer: Offer) {
  const n = accepters(offer).length;
  return `${nameOf(pub, offer.from)}: ${cardsText(offer.give)} for ${cardsText(offer.want)}${
    n ? ` (${n} accept${n === 1 ? 's' : ''})` : ''}`;
}

export const RESPONSE_TEXT: Record<OfferResponse, string> = {
  pending: 'Pending', accept: 'Accepts', decline: 'Declined', counter: 'Countered', unable: "Can't pay now",
};

/** "4 pending · 2 declined · 1 countered" for these seats' answers. */
export const tallyText = (offer: Offer, ids: SeatId[]) =>
  (['pending', 'accept', 'counter', 'decline', 'unable'] as const)
    .map(r => [r, ids.filter(id => offer.responses[id] === r).length] as const).filter(([, n]) => n)
    .map(([r, n]) => `${n} ${r === 'unable' ? "can't pay" : RESPONSE_TEXT[r].toLowerCase()}`).join(' · ');

/** Newest parents first, each followed by its counters (newest first). Orphan counters stand alone. */
export function railOrder(offers: Offer[]): Offer[] {
  const byAt = [...offers].sort((a, b) => b.at - a.at), ids = new Set(offers.map(o => o.id));
  return byAt.filter(o => !o.counterTo || !ids.has(o.counterTo))
    .flatMap(p => [p, ...byAt.filter(c => c.counterTo === p.id)]);
}

/** Beyond this many overflow rows the TV goes compact: emblem chip + goods (the name moves to the label). */
export const COMPACT_ROWS = 4;
/** Estimated TV heights in u: a full card, and m overflow rows (with gaps). */
const CARD_U = 220;
const rowsU = (m: number) => m * (m <= COMPACT_ROWS ? 56 : 32) + (m ? 16 : 0);

/** How many of n offers get a full TV card: up to 3, fewer when `height` (u) can't hold the rest as rows. */
export function fullCount(n: number, height?: number) {
  let k = Math.min(3, n);
  while (height !== undefined && k > 1 && k * CARD_U + rowsU(n - k) > height) k--;
  return k;
}

/** Offers this seat posted, and offers it can answer (newest first). */
export const myOffers = (pub: PublicView, seat: SeatId) =>
  pub.offers.filter(o => o.from === seat).sort((a, b) => b.at - a.at);
export const offersToMe = (pub: PublicView, seat: SeatId) =>
  pub.offers.filter(o => o.from !== seat && o.responses[seat] !== undefined).sort((a, b) => b.at - a.at);

/** Offers still waiting on this seat's answer (the Trade tab count and duty cards). */
export const waitingOnMe = (pub: PublicView, seat: SeatId) =>
  offersToMe(pub, seat).filter(o => o.responses[seat] === 'pending');

/** Remaining share of an offer's open time, 0..1; null when it never expires. */
export const expiryShare = (offer: Offer, now: number) => offer.expires === null ? null
  : Math.max(0, Math.min(1, (offer.expires - now) / Math.max(1, offer.expires - offer.at)));
