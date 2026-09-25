/**
 * Trading (ENGINE §9): player offers with counters and changeable answers, bank and port trades,
 * and the post-commit housekeeping (invalidation, expiry). Humans and CPUs share every rule.
 */
import {
  GOODS, RESOURCES, VIEW_LIMITS, type Action, type Cards, type Good, type OfferState, type SeatId, type Why,
} from '../model';
import { boardIndex } from './board/lookup';
import { cardsText, has, missing, toCards, total, transfer } from './cards';
import { baseDeadline } from './clock';
import { emit } from './events';
import { concurrent, role } from './flow';
import { hooks } from './modules/registry';
import { need } from './need';
import { seatPrompts, tablePromptOpen } from './prompts';
import { bump, gained } from './stats';
import { nextId, seatName, type OpenOffer, type State } from './state';

type Act<T extends Action['type']> = Extract<Action, { type: T }>;
type Change = 'withdrawn' | 'expired' | 'invalid';

const why = (code: Why['code'], text: string): Why => ({ code, text });
const CLOSED = 'That offer is no longer open.';
const ROLL_FIRST = why('roll-first', 'Roll first.');
const CHANGE_TEXT: Record<Change, string> = {
  withdrawn: 'withdrawn', expired: 'expired', invalid: 'withdrawn',
};

const moving = (s: State, id: SeatId) => s.profile.movementLocksBuilding && s.seats[id].moved;

/** Connect: in the action window and online. */
const inWindow = (s: State, id: SeatId) => role(s, id) === 'round' && s.seats[id].connected;

/**
 * May an offer from `from` to `to` be answered and completed now? Standard: during Player 1's main
 * step, with Player 1 on one side and never the concurrent 7–10 partner. Connect: the proposer is
 * still in the window (a recipient who pressed done may still answer).
 */
function pairOk(s: State, from: SeatId, to: SeatId): boolean {
  if (from === to || moving(s, from) || moving(s, to)) return false;
  const t = s.turn;
  if (t.stage === 'round') return role(s, from) === 'round';
  if (t.stage !== 'main' || !t.active || role(s, t.active) !== 'main') return false;
  const side = concurrent(s) ? t.partner : null;
  return (from === t.active || to === t.active) && from !== side && to !== side;
}

/** Seats this seat may send an offer to right now (ENGINE §9.1). */
export function partners(s: State, id: SeatId): SeatId[] {
  const connect = s.turn.stage === 'round';
  if (connect && !inWindow(s, id)) return [];
  return s.order.filter(o => pairOk(s, id, o) && (!connect || inWindow(s, o)));
}

/** Prompts and movement stop any trading by this seat. */
function gate(s: State, id: SeatId): Why | null {
  if (seatPrompts(s, id).length) return why('prompt', 'Finish your open decision first.');
  if (tablePromptOpen(s)) return why('prompt', 'Waiting for other players to decide.');
  return moving(s, id) ? why('moved', 'You started moving.') : null;
}

/** Why proposing or bank trading is unavailable now (null = allowed). */
export function tradeWhy(s: State, id: SeatId): { propose: Why | null; bank: Why | null } {
  const r = role(s, id), stage = s.turn.stage;
  if (r === 'roll') return { propose: ROLL_FIRST, bank: ROLL_FIRST };
  if (stage === 'setup' || stage === 'finale' || stage === 'ended') {
    const closed = why('stage', stage === 'setup' ? 'Trading opens after setup.' : 'The game is over.');
    return { propose: closed, bank: closed };
  }
  const g = gate(s, id);
  const building = r === 'main' || r === 'paired' || r === 'round';
  const bank = g ?? (building ? null : why(stage === 'round' ? 'stage' : 'not-your-turn',
    stage === 'round' ? 'You are done this round.' : 'Bank trades happen on your turn.'));
  if (g || partners(s, id).length) return { propose: g, bank };
  const bankOnly = r === 'paired' || stage === 'paired';
  const propose = bankOnly ? why('rule', 'Build turns trade with the bank only.')
    : why('stage', stage === 'round' ? 'You are done this round.' : 'Nobody can trade with you right now.');
  return { propose, bank };
}

/** Both sides non-empty, no gifts, only goods this game uses. */
function checkSides(s: State, give: Cards, get: Cards) {
  need(total(give) > 0 && total(get) > 0, 'Choose cards on both sides.');
  need(GOODS.every(g => !give[g] || !get[g]), 'The same card cannot be on both sides.');
  const used: readonly string[] = s.profile.commodities ? GOODS : RESOURCES;
  const known = (c: Cards) => Object.keys(c).every(g => used.includes(g));
  need(known(give) && known(get), 'Those cards are not in this game.');
}

const allowed = (w: Why | null) => need(!w, w?.text ?? '');

export function offer(s: State, id: SeatId, a: Act<'offer'>) {
  allowed(tradeWhy(s, id).propose);
  const give = toCards(a.give), want = toCards(a.want);
  checkSides(s, give, want);
  need(has(s.seats[id].hand, give), 'You do not have those cards.');
  const parent = a.counterTo === null ? null : s.offers[a.counterTo];
  need(a.counterTo === null || parent?.to.includes(id), CLOSED);
  const eligible = partners(s, id);
  const to = parent ? [parent.from] : a.to.length ? [...new Set(a.to)] : eligible;
  need(a.to.every(x => to.includes(x)), 'A counter-offer goes back to whoever made the offer.');
  need(to.length && to.every(x => eligible.includes(x)), 'You cannot trade with that player now.');
  // One live offer per seat, one live counter per seat per parent: the new one replaces the old.
  for (const o of Object.values(s.offers)) {
    if (o.from === id && o.counterTo === a.counterTo) drop(s, o.id, 'withdrawn');
  }
  need(Object.keys(s.offers).length < VIEW_LIMITS.openOffers, 'Too many open offers. Try again in a moment.');
  const o: OpenOffer = {
    id: nextId(s, 'o'), at: s.now, from: id, to, broadcast: !parent && !a.to.length, give, want,
    counterTo: a.counterTo, responses: Object.fromEntries(to.map(x => [x, 'pending'])), reasons: {},
    expires: baseDeadline(s, 'offer'),
  };
  s.offers[o.id] = o;
  if (parent) parent.responses[id] = 'counter';
  const text = `${seatName(s, id)} offers ${cardsText(give)} for ${cardsText(want)}`;
  emit(s, { kind: 'offer', offer: o.id, seat: id, change: 'posted', text });
}

/** "You have 1 wool" for the goods this seat is short of. */
function shortText(s: State, id: SeatId, want: Cards): string | null {
  const hand = s.seats[id].hand, short = missing(hand, want);
  const have = GOODS.filter(g => short[g]).map(g => `${hand[g]} ${g}`);
  return have.length ? `You have ${have.join(', ')}.` : null;
}

export function respond(s: State, id: SeatId, a: Act<'respond'>) {
  const o = s.offers[a.offer];
  need(o?.to.includes(id), CLOSED);
  if (a.reason) o.reasons[id] = a.reason; else delete o.reasons[id];
  // Declining moves no cards, so it stays open to a seat that can no longer trade (it started moving).
  if (a.answer === 'decline') { o.responses[id] = 'decline'; return; }
  need(pairOk(s, o.from, id), 'You cannot trade with them now.');
  const short = shortText(s, id, o.want);
  need(!short, short ?? '');
  o.responses[id] = 'accept';
  // A single recipient accepting is full consent from both sides: no confirm step.
  if (o.to.length === 1) complete(s, o, id);
}

export function confirmTrade(s: State, id: SeatId, a: Act<'confirm-trade'>) {
  const o = s.offers[a.offer];
  need(o?.from === id, CLOSED);
  need(o.responses[a.partner] === 'accept', 'Choose a player who accepted.');
  need(pairOk(s, id, a.partner), 'You cannot trade with them now.');
  complete(s, o, a.partner);
}

/** The atomic exchange; other offers are re-validated by `invalidateOffers` after the commit. */
function complete(s: State, o: OpenOffer, partner: SeatId) {
  need(!tablePromptOpen(s), 'Waiting for other players to decide.');
  const mine = s.seats[o.from].hand, theirs = s.seats[partner].hand;
  need(has(mine, o.give) && has(theirs, o.want), 'One of the hands changed. Make a new offer.');
  transfer(mine, theirs, o.give);
  transfer(theirs, mine, o.want);
  bump(s, o.from, 'trades');
  bump(s, partner, 'trades');
  drop(s, o.id, null);
  const who = `${seatName(s, o.from)} gave ${cardsText(o.give)} to ${seatName(s, partner)}`;
  const text = `${who} for ${cardsText(o.want)}`;
  emit(s, { kind: 'trade', offer: o.id, seat: o.from, partner, give: o.give, get: o.want, text });
}

/**
 * Remove an offer and, with it, its counters. A closed counter puts its author's answer on the
 * parent back to pending. `change` null: the offer completed (the `trade` event says so).
 */
function drop(s: State, id: string, change: Change | null) {
  const o = s.offers[id];
  if (!o) return;
  delete s.offers[id];
  const parent = o.counterTo ? s.offers[o.counterTo] : undefined;
  if (parent?.responses[o.from] === 'counter') parent.responses[o.from] = 'pending';
  if (change) {
    const text = `${seatName(s, o.from)}'s offer ${CHANGE_TEXT[change]}`;
    emit(s, { kind: 'offer', offer: id, seat: o.from, change, text });
  }
  for (const c of Object.values(s.offers)) if (c.counterTo === id) drop(s, c.id, change ?? 'expired');
}

export function withdraw(s: State, id: SeatId, offerId: string) {
  need(s.offers[offerId]?.from === id, CLOSED);
  drop(s, offerId, 'withdrawn');
}

/** Any number of lots at once (ENGINE §9.3). */
export function bank(s: State, id: SeatId, give: Cards, get: Cards) {
  allowed(tradeWhy(s, id).bank);
  checkSides(s, give, get);
  const r = rates(s, id);
  need(GOODS.every(g => (give[g] ?? 0) % r[g] === 0), 'Give each card in lots of its trade rate.');
  const lots = GOODS.reduce((n, g) => n + (give[g] ?? 0) / r[g], 0);
  need(lots === total(get), `That pays for ${lots} ${lots === 1 ? 'card' : 'cards'}.`);
  need(has(s.bank, get), 'The bank does not have those cards.');
  const hand = s.seats[id].hand;
  transfer(hand, s.bank, give, 'You do not have those cards.');
  transfer(s.bank, hand, get);
  bump(s, id, 'bankTrades');
  gained(s, id, get);
  const text = `${seatName(s, id)} traded ${cardsText(give)} with the bank for ${cardsText(get)}`;
  emit(s, { kind: 'bank', seat: id, give: toCards(give), get: toCards(get), text });
}

/**
 * After every commit: drop offers the proposer cannot pay or nobody may take, and revert accepts
 * that could no longer complete (the seat cannot pay, or may not trade now, e.g. it started moving).
 */
export function invalidateOffers(s: State) {
  for (const o of Object.values(s.offers)) {
    if (!s.offers[o.id]) continue;
    if (!has(s.seats[o.from].hand, o.give)) drop(s, o.id, 'invalid');
    else if (!o.to.some(x => pairOk(s, o.from, x))) drop(s, o.id, 'expired');
    else for (const x of o.to) {
      const stale = !has(s.seats[x].hand, o.want) || !pairOk(s, o.from, x);
      if (o.responses[x] === 'accept' && stale) o.responses[x] = 'pending';
    }
  }
}

/** Close `seat`'s offers (every offer when null), e.g. at opportunity end or on disconnect. */
export function closeOffers(s: State, seat: SeatId | null, change: 'withdrawn' | 'expired') {
  for (const o of Object.values(s.offers)) if (seat === null || o.from === seat) drop(s, o.id, change);
}

/** Remove offers whose `expires` is at or before `s.now` (`offer` expired events). */
export function expireOffers(s: State) {
  for (const o of Object.values(s.offers)) {
    if (o.expires !== null && o.expires <= s.now) drop(s, o.id, 'expired');
  }
}

/** Best bank ratio per good (profile.bankRate, ports, module `rates` hooks). */
export function rates(s: State, id: SeatId): Record<Good, number> {
  const r = Object.fromEntries(GOODS.map(g => [g, s.profile.bankRate])) as Record<Good, number>;
  const { portAt } = boardIndex(s.board), mine = Object.values(s.pieces.buildings).filter(b => b.seat === id);
  for (const p of s.profile.ports ? mine.flatMap(b => portAt.get(b.vertex) ?? []) : []) {
    for (const g of GOODS) if (p.good === 'any' || p.good === g) r[g] = Math.min(r[g], p.ratio);
  }
  for (const m of hooks(s, 'rates')) m.rates(s, id, r);
  return r;
}

/** Offers sent to this seat, in post order, with whether it can accept or counter them now. */
export function offerState(s: State, id: SeatId): OfferState[] {
  const counterable = tradeWhy(s, id).propose ? [] : partners(s, id);
  return Object.values(s.offers).filter(o => o.to.includes(id)).map(o => {
    const short = shortText(s, id, o.want);
    const w = !pairOk(s, o.from, id) ? why('stage', 'You cannot trade with them now.')
      : o.to.length === 1 && tablePromptOpen(s) ? why('prompt', 'Waiting for other players to decide.')
      : short ? why('cost', short) : null;
    return { id: o.id, canAccept: !w, canCounter: counterable.includes(o.from), why: w };
  });
}
