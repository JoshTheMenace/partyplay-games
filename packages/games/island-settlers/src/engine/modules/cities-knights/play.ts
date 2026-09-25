/**
 * Playing progress cards through commands (group `progress`), the Commercial Harbor offers, and the
 * prompts cards open for other seats: keep (hand limit), give, take, spy, deserter and its placement.
 */
import {
  COMMODITIES, GOODS, RESOURCES, type Cards, type Command, type Field, type Good, type ProgressCard,
  type ProgressKind, type SeatId, type Why,
} from '../../../model';
import { toCards, total, transfer } from '../../cards';
import { cardsField, choice, command, pickField } from '../../commands';
import { emit, inbox } from '../../events';
import { role } from '../../flow';
import { why } from '../../legal';
import { removeUnit } from '../../pieces';
import { largestFirst, openPrompt, seatPrompts, tablePromptOpen } from '../../prompts';
import { seatName, type State } from '../../state';
import type { Answer, PromptSpec } from '../registry';
import { POLITICS } from './cards-politics';
import { SCIENCE } from './cards-science';
import { TRADE } from './cards-trade';
import { onBoard, recruit, recruitSites } from './knights';
import { checkLimit, discardCard } from './progress';
import { acting, ck, HAND_LIMIT, knightsOf, LABELS, note, PER_LEVEL, sx, type Held } from './state';

export type Play = {
  kind: ProgressKind;
  /** One-line effect for the command sheet. */
  text: string;
  /** Fields when the card can be played now, else why not. */
  fields(s: State, seat: SeatId): Field[] | Why;
  apply(s: State, seat: SeatId, a: Answer): void;
  hint(s: State, seat: SeatId): number;
  cost?(s: State, seat: SeatId): Cards | null;
  /** Alchemist: only before rolling. */
  preRoll?: true;
};

const PLAYS = new Map<ProgressKind, Play>([...SCIENCE, ...TRADE, ...POLITICS].map(p => [p.kind, p]));
const spec = (kind: ProgressKind) => PLAYS.get(kind)!;

/** Fields to play `card` now, or why it cannot be played. */
function playable(s: State, seat: SeatId, card: Held): Field[] | Why {
  const p = spec(card.kind);
  if (p.preRoll) {
    const free = !tablePromptOpen(s) && !seatPrompts(s, seat).length;
    if (role(s, seat) !== 'roll' || !free) return why('stage', 'Play before you roll');
  } else if (!acting(s, seat)) return why('not-your-turn', 'Play on your turn, after rolling');
  return p.fields(s, seat);
}

export function progressView(s: State, seat: SeatId): ProgressCard[] {
  return sx(s, seat).progress.map(c => {
    const f = playable(s, seat, c), ok = Array.isArray(f);
    return { id: c.id, kind: c.kind, track: c.track, playable: ok, why: ok ? null : f };
  });
}

export function progressCommands(s: State, seat: SeatId): Command[] {
  const seen = new Set<ProgressKind>(), out: Command[] = [];
  for (const card of sx(s, seat).progress) {
    const f = seen.has(card.kind) ? null : playable(s, seat, card);
    seen.add(card.kind);
    if (!Array.isArray(f)) continue;
    const p = spec(card.kind);
    out.push(command({
      id: `ck:play:${card.id}`, module: 'cities-knights', group: 'progress', label: `Play ${LABELS[card.kind]}`,
      detail: p.text, cost: p.cost?.(s, seat) ?? null, hint: p.hint(s, seat), fields: f,
    }));
  }
  const offered = sx(s, seat).harbor, hand = s.seats[seat].hand;
  if (offered && acting(s, seat) && RESOURCES.some(g => hand[g])) {
    for (const id of s.order.filter(id => id !== seat && !offered.includes(id))) out.push(command({
      id: `ck:harbor:${id}`, module: 'cities-knights', group: 'trade', label: `Commercial Harbor: ${seatName(s, id)}`,
      detail: 'They must give you 1 commodity of their choice', hint: 0.7,
      fields: [cardsField('give', 'Resource to offer', 'hand', hand, 1, 1, RESOURCES)],
    }));
  }
  return out;
}

export function applyProgress(s: State, seat: SeatId, id: string, a: Answer) {
  const [, what, arg] = id.split(':');
  if (what === 'harbor') return harbor(s, seat, arg, a.cards.give);
  const card = discardCard(s, seat, arg);
  note(s, 'progress', seat, card.kind, `${seatName(s, seat)} played ${LABELS[card.kind]}`);
  spec(card.kind).apply(s, seat, a);
}

function harbor(s: State, seat: SeatId, other: SeatId, give: Cards) {
  sx(s, seat).harbor!.push(other);
  if (!COMMODITIES.some(g => s.seats[other].hand[g])) {
    return note(s, 'harbor', seat, null, `${seatName(s, other)} had no commodity to trade`);
  }
  transfer(s.seats[seat].hand, s.seats[other].hand, give);
  inbox(s, other, { text: `${seatName(s, seat)} gave you a resource`, cards: give, tone: 'gain', other: seat });
  const data = { to: seat, count: 1, why: 'Commercial Harbor', goods: 'commodities' };
  openPrompt(s, { seat: other, kind: 'cities-knights/give', scope: 'table', data });
}

// ---------------------------------------------------------------- prompts

const hintOf = (s: State, seat: SeatId, c: Held) => spec(c.kind).hint(s, seat);

export const keepPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Discards your weakest card', label: 'Discarding a progress card',
  command(s, p) {
    const hand = [...sx(s, p.seat).progress].sort((a, b) => hintOf(s, p.seat, a) - hintOf(s, p.seat, b));
    return command({
      id: p.id, module: 'cities-knights', group: 'progress', label: 'Discard a progress card', hint: 1,
      detail: `You may hold ${HAND_LIMIT} progress cards`,
      fields: [pickField('card', 'Discard', hand.map(c => choice(c.id, LABELS[c.kind])))],
    });
  },
  apply(s, p, a) {
    discardCard(s, p.seat, a.picks.card);
    checkLimit(s, p.seat, true);
  },
  auto: (s, p) => ({ picks: { card: [...sx(s, p.seat).progress]
    .sort((a, b) => hintOf(s, p.seat, a) - hintOf(s, p.seat, b))[0]?.id }, cards: {} }),
};

type Give = { to: SeatId | null; count: number; why: string; goods?: 'commodities' };
const giveGoods = (d: Give): readonly Good[] => (d.goods ? COMMODITIES : GOODS);
const giveCount = (s: State, seat: SeatId, d: Give) =>
  Math.min(d.count, total(toCards(Object.fromEntries(giveGoods(d).map(g => [g, s.seats[seat].hand[g]])))));

export const givePrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Gives your biggest piles', label: 'Giving cards',
  command(s, p) {
    const d = p.data as Give, n = giveCount(s, p.seat, d);
    const where = d.to ? `to ${seatName(s, d.to)}` : 'to the bank';
    return command({
      id: p.id, module: 'cities-knights', group: 'cards', label: `${d.why}: give ${n} ${where}`, hint: 1,
      detail: d.goods ? 'Pick a commodity' : 'Pick the cards',
      fields: [cardsField('cards', 'Give', 'hand', s.seats[p.seat].hand, n, n, giveGoods(d))],
    });
  },
  apply(s, p, a) {
    const d = p.data as Give, cards = a.cards.cards, n = total(cards);
    transfer(s.seats[p.seat].hand, d.to ? s.seats[d.to].hand : s.bank, cards);
    if (d.to) inbox(s, d.to, { text: `${seatName(s, p.seat)} gave you cards`, cards, tone: 'gain', other: p.seat });
    const text = `${seatName(s, p.seat)} gave ${n} ${d.to ? `to ${seatName(s, d.to)}` : 'to the bank'} (${d.why})`;
    if (d.to) emit(s, { kind: 'module', module: 'cities-knights', name: 'give', seat: p.seat, target: d.to, text });
    else emit(s, { kind: 'discard', seat: p.seat, count: n, text });
  },
  auto(s, p) {
    const d = p.data as Give, hand = s.seats[p.seat].hand;
    const allowed = toCards(Object.fromEntries(giveGoods(d).map(g => [g, hand[g]])));
    return { picks: {}, cards: { cards: largestFirst(allowed, giveCount(s, p.seat, d)) } };
  },
};

type From = { from: SeatId };

export const takePrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Takes their biggest piles', label: 'Master Merchant',
  command(s, p) {
    const from = (p.data as From).from, hand = s.seats[from].hand, n = Math.min(2, total(hand));
    return command({
      id: p.id, module: 'cities-knights', group: 'progress', label: `Take ${n} from ${seatName(s, from)}`, hint: 1,
      detail: 'Master Merchant: their hand is shown', fields: [cardsField('cards', 'Take', 'bank', hand, n, n)],
    });
  },
  apply(s, p, a) {
    const from = (p.data as From).from, cards = a.cards.cards;
    transfer(s.seats[from].hand, s.seats[p.seat].hand, cards);
    inbox(s, from, { text: `${seatName(s, p.seat)} took your cards`, cards, tone: 'loss', other: p.seat });
    inbox(s, p.seat, { text: `You took ${total(cards)} from ${seatName(s, from)}`, cards, tone: 'gain', other: from });
    const text = `${seatName(s, p.seat)} took ${total(cards)} cards`;
    emit(s, { kind: 'steal', seat: p.seat, victim: from, count: total(cards), text });
  },
  auto(s, p) {
    const hand = s.seats[(p.data as From).from].hand;
    return { picks: {}, cards: { cards: largestFirst(hand, Math.min(2, total(hand))) } };
  },
};

const spyCards = (s: State, seat: SeatId, from: SeatId) =>
  [...sx(s, from).progress].sort((a, b) => hintOf(s, seat, b) - hintOf(s, seat, a));

export const spyPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Takes the best card', label: 'Spying',
  command(s, p) {
    const from = (p.data as From).from, cards = spyCards(s, p.seat, from);
    // Their hand can empty while the prompt is open (Connect): an empty pick closes it.
    return command({
      id: p.id, module: 'cities-knights', group: 'progress', label: `Take a card from ${seatName(s, from)}`, hint: 1,
      detail: cards.length ? 'Spy: their progress cards are shown' : 'They have no progress cards left',
      fields: cards.length ? [pickField('card', 'Card', cards.map(c => choice(c.id, LABELS[c.kind])))] : [],
    });
  },
  apply(s, p, a) {
    const from = (p.data as From).from, card = sx(s, from).progress.find(c => c.id === a.picks.card);
    if (!card) return note(s, 'spy', p.seat, from, `${seatName(s, from)} had no progress card left`);
    sx(s, from).progress = sx(s, from).progress.filter(c => c !== card);
    sx(s, p.seat).progress.push(card);
    const text = `${seatName(s, p.seat)} took your ${LABELS[card.kind]}`;
    inbox(s, from, { text, cards: {}, tone: 'loss', other: p.seat });
    note(s, 'spy', p.seat, from, `${seatName(s, p.seat)} took a progress card from ${seatName(s, from)}`);
    checkLimit(s, p.seat);
  },
  auto(s, p): Answer {
    const best = spyCards(s, p.seat, (p.data as From).from)[0];
    return { picks: best ? { card: best.id } : {}, cards: {} };
  },
};

const weakest = (s: State, seat: SeatId) => knightsOf(s, seat).sort((a, b) => a.level - b.level);

export const deserterPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Removes your weakest knight', label: 'Removing a knight',
  command: (s, p) => command({
    id: p.id, module: 'cities-knights', group: 'knights', label: 'Deserter: remove a knight', hint: 1,
    detail: `${seatName(s, (p.data as { by: SeatId }).by)} played Deserter`,
    fields: [pickField('knight', 'Knight', weakest(s, p.seat).map(k => choice(k.id, `Level ${k.level} knight`)))],
  }),
  apply(s, p, a) {
    const k = s.pieces.units[a.picks.knight], by = (p.data as { by: SeatId }).by;
    removeUnit(s, k.id);
    delete ck(s).knights[k.id];
    note(s, 'deserter', p.seat, k.at, `${seatName(s, p.seat)}'s knight deserted`);
    const lvl = [3, 2, 1].find(l => l <= k.level && onBoard(s, by, l) < PER_LEVEL);
    if (!lvl || !recruitSites(s, by).length) return;
    const data = { level: lvl, active: k.active };
    openPrompt(s, { seat: by, kind: 'cities-knights/deserter-place', scope: 'self', data });
  },
  auto: (s, p) => ({ picks: { knight: weakest(s, p.seat)[0]?.id }, cards: {} }),
};

type Place = { level: number; active: boolean };

export const deserterPlacePrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Places it on the first free corner', label: 'Placing a knight',
  command(s, p) {
    const d = p.data as Place;
    return command({
      id: p.id, module: 'cities-knights', group: 'knights', label: `Place a level ${d.level} knight`, hint: 1,
      detail: 'Deserter: a knight joins you', fields: [pickField('at', 'Corner',
        recruitSites(s, p.seat).map(v => choice(v, 'Free corner')), 'vertex')],
    });
  },
  apply(s, p, a) {
    const d = p.data as Place;
    recruit(s, p.seat, a.picks.at, d.level, d.active);
  },
  auto: (s, p) => ({ picks: { at: recruitSites(s, p.seat)[0] }, cards: {} }),
};
