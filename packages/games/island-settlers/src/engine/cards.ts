/** Card math on full hands (every good present). Views use sparse `Cards` via `toCards`. */
import { GOODS, RESOURCES, type Cards, type Good } from '../model';
import { need } from './need';

export type Hand = Record<Good, number>;

export const emptyHand = (): Hand => Object.fromEntries(GOODS.map(g => [g, 0])) as Hand;

export const total = (cards: Cards) => GOODS.reduce((n, g) => n + (cards[g] ?? 0), 0);

export const resourceTotal = (cards: Cards) => RESOURCES.reduce((n, g) => n + (cards[g] ?? 0), 0);

export const has = (hand: Cards, cards: Cards) => GOODS.every(g => (hand[g] ?? 0) >= (cards[g] ?? 0));

/** Adds (or with sign -1 removes) cards in place. */
export function add(hand: Hand, cards: Cards, sign: 1 | -1 = 1) {
  for (const g of GOODS) if (cards[g]) hand[g] += sign * cards[g]!;
}

/** Atomic move: either every card moves or the action is rejected. */
export function transfer(from: Hand, to: Hand, cards: Cards, reason = 'Those cards are no longer available.') {
  need(has(from, cards), reason);
  add(from, cards, -1);
  add(to, cards);
}

/** Sparse copy: zero counts omitted. */
export const toCards = (hand: Cards): Cards =>
  Object.fromEntries(GOODS.filter(g => (hand[g] ?? 0) > 0).map(g => [g, hand[g]])) as Cards;

/** Cards missing from `hand` to pay `cost`. */
export const missing = (hand: Cards, cost: Cards): Cards =>
  toCards(Object.fromEntries(GOODS.map(g => [g, Math.max(0, (cost[g] ?? 0) - (hand[g] ?? 0))])) as Cards);

/** "2 wool, 1 ore" */
export const cardsText = (cards: Cards) =>
  GOODS.filter(g => cards[g]).map(g => `${cards[g]} ${g}`).join(', ') || 'nothing';
