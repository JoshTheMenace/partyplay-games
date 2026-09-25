/** Plain-text formatting shared by every screen: counts, card lists, clocks. */
import { GOODS, type Cards, type Good } from '../../model';
import { GOOD_META } from './labels';

/** "1 resource", "2 resources". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const count = (cards: Cards, good: Good) => cards[good] ?? 0;
export const cardTotal = (cards: Cards) => GOODS.reduce((sum, good) => sum + count(cards, good), 0);
export const goodsIn = (cards: Cards) => GOODS.filter(good => count(cards, good) > 0);
export const canAfford = (hand: Cards, cost: Cards) => GOODS.every(g => count(hand, g) >= count(cost, g));

/** "2 wool", "3 coins". */
export const goodText = (n: number, good: Good) =>
  `${n} ${GOOD_META[good].label.toLowerCase()}${good === 'coin' && n !== 1 ? 's' : ''}`;

/** "2 wool, 1 ore"; empty is "nothing". */
export const cardsText = (cards: Cards) =>
  goodsIn(cards).map(g => goodText(count(cards, g), g)).join(', ') || 'nothing';

/** "Need 1 ore" from BuildOption.missing; null when nothing is missing. */
export const needText = (missing: Cards) => (goodsIn(missing).length ? `Need ${cardsText(missing)}` : null);

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
export const listText = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** "+2", "−1" (true minus sign), "0". */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Whole seconds left, rounded up so "0:00" only shows at the deadline. */
export const secondsLeft = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000));

/** "0:42", "2:00". */
export const clockText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Phone copy for the seated host, who uses a mouse and keys: "Tap Done" → "Click Done". */
export const tapText = (text: string, docked: boolean) =>
  (docked ? text.replace(/\b([Tt])ap\b/g, (_, t: string) => (t === 'T' ? 'Click' : 'click')) : text);

/** Timer preset cell: "60 s" or "none". */
export const secondsText = (seconds: number | null) => (seconds === null ? 'none' : `${seconds} s`);
