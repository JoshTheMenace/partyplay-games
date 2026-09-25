/** Development cards (ENGINE §10): deck, buying, timing rules and the four playable effects. */
import { COSTS, DEV_KINDS, RESOURCES, type DevCard, type DevKind, type Resource, type SeatId, type Why }
  from '../model';
import { resourceTotal, transfer } from './cards';
import { emit, inbox } from './events';
import { role } from './flow';
import { purchaseWhy, why } from './legal';
import { hooks } from './modules/registry';
import { need } from './need';
import { openRobber, seatPrompts, tablePromptOpen } from './prompts';
import { bump, gained } from './stats';
import { nextId, seat as seatOf, seatName, type DevCardState, type State } from './state';

export const DEV_LABELS: Record<DevKind, string> = {
  knight: 'Knight', 'road-building': 'Road Building', plenty: 'Year of Plenty', monopoly: 'Monopoly',
  victory: 'Victory Point',
};

/** The unshuffled deck per table size: [knights, victory points, each other kind] (ENGINE §8.1). */
export function devDeck(seatCount: number): DevKind[] {
  const [knight, victory, rest] = seatCount <= 4 ? [14, 5, 2] : seatCount <= 6 ? [20, 5, 3]
    : seatCount <= 8 ? [24, 6, 3] : [28, 7, 4];
  const count = (k: DevKind) => (k === 'knight' ? knight : k === 'victory' ? victory : rest);
  return DEV_KINDS.flatMap(k => Array<DevKind>(count(k)).fill(k));
}

export function buyDev(s: State, seat: SeatId) {
  const p = seatOf(s, seat), blocked = purchaseWhy(s, seat, 'development');
  need(!blocked, blocked?.text ?? '');
  transfer(p.hand, s.bank, COSTS.development, 'You cannot afford that.');
  const kind = s.devDeck.pop()!;
  p.dev.push({ id: nextId(s, 'd'), kind, boughtAt: p.opportunity });
  bump(s, seat, 'devBought');
  emit(s, { kind: 'dev-buy', seat, text: `${seatName(s, seat)} bought a dev card` });
  inbox(s, seat, { text: `You drew ${DEV_LABELS[kind]}`, cards: {}, tone: 'gain', other: null });
}

/** Why this card cannot be played now (one non-VP card per opportunity, never the one just bought). */
function playWhy(s: State, seat: SeatId, card: DevCardState): Why | null {
  const p = s.seats[seat], r = role(s, seat);
  if (card.kind === 'victory') return why('rule', 'Victory point: counts at the end (hidden)');
  if (!r || r === 'setup') return why('not-your-turn', 'Play cards on your turn');
  const busy = tablePromptOpen(s) || seatPrompts(s, seat).length > 0;
  if (busy) return why('prompt', 'Finish the open decision first');
  if (card.boughtAt === p.opportunity) return why('bought-this-turn', 'Bought this turn: play next turn');
  if (p.devPlayedAt === p.opportunity) return why('one-per-turn', 'You already played a card this turn');
  if (card.kind === 'plenty' && !resourceTotal(s.bank)) return why('rule', 'The bank has no resources');
  return null;
}

/** Knight opens a self-scoped robber prompt; Road Building owes 2 free routes; goods for Plenty/Monopoly. */
export function playDev(s: State, seat: SeatId, cardId: string, goods: Resource[]) {
  const p = seatOf(s, seat), card = p.dev.find(c => c.id === cardId);
  need(card, 'That card is not in your hand.');
  const blocked = playWhy(s, seat, card);
  need(!blocked, blocked?.text ?? '');
  const taken: Record<SeatId, number> = {};
  let count = 0;
  if (card.kind === 'plenty') {
    const cards = Object.fromEntries(RESOURCES.map(g => [g, goods.filter(x => x === g).length]));
    need(goods.length === Math.min(2, resourceTotal(s.bank)), 'Choose two resources from the bank.');
    transfer(s.bank, p.hand, cards, 'The bank does not have those resources.');
    gained(s, seat, cards);
    count = goods.length;
  } else if (card.kind === 'monopoly') {
    need(goods.length === 1, 'Choose one resource.');
    const good = goods[0];
    for (const id of s.order.filter(id => id !== seat && s.seats[id].hand[good] > 0)) {
      taken[id] = s.seats[id].hand[good];
      transfer(s.seats[id].hand, p.hand, { [good]: taken[id] });
      count += taken[id];
      const text = `${p.name} took your ${taken[id]} ${good} (Monopoly)`;
      inbox(s, id, { text, cards: { [good]: taken[id] }, tone: 'loss', other: seat });
    }
  } else need(!goods.length, 'This card takes no resources.');
  p.dev = p.dev.filter(c => c !== card);
  p.devPlayedAt = p.opportunity;
  const text = `${p.name} played ${DEV_LABELS[card.kind]}`;
  emit(s, { kind: 'dev-play', seat, card: card.kind, goods, count, taken, text });
  if (card.kind === 'road-building') p.freeRoutes += 2;
  if (card.kind === 'knight') {
    p.knights++;
    bump(s, seat, 'knights');
    openRobber(s, seat, 'self');
  }
  for (const m of hooks(s, 'onDevPlay')) m.onDevPlay(s, seat, card.kind);
}

/** PrivateView.dev with playable/why. */
export function devCards(s: State, seat: SeatId): DevCard[] {
  return s.seats[seat].dev.map(c => {
    const blocked = playWhy(s, seat, c);
    return { id: c.id, kind: c.kind, playable: !blocked, why: blocked };
  });
}
