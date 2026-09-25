/** Sparse card math for CPU planning (model `Cards`; a missing key is zero). */
import { GOODS, type Cards, type Good } from '../model';

export const count = (c: Cards, g: Good) => c[g] ?? 0;
export const total = (c: Cards) => GOODS.reduce((n, g) => n + count(c, g), 0);
export const has = (c: Cards, need: Cards) => GOODS.every(g => count(c, g) >= count(need, g));

/** Drops zero entries so actions stay small and serializable. */
export const clean = (c: Cards): Cards =>
  Object.fromEntries(GOODS.filter(g => count(c, g) > 0).map(g => [g, count(c, g)]));

export const add = (a: Cards, b: Cards, sign = 1): Cards =>
  clean(Object.fromEntries(GOODS.map(g => [g, Math.max(0, count(a, g) + sign * count(b, g))])));

/** What `hand` still lacks to pay `cost`. */
export const missing = (hand: Cards, cost: Cards): Cards =>
  clean(Object.fromEntries(GOODS.map(g => [g, Math.max(0, count(cost, g) - count(hand, g))])));

export const key = (c: Cards) => GOODS.filter(g => count(c, g)).map(g => `${g}${count(c, g)}`).join('');
