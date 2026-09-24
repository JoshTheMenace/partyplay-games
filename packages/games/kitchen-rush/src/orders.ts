// Seeded order pacing: introduce each dish once in authored order, then draw randomly without flooding one dish.
import type { Order, RecipeId } from './model';

/** One mulberry32 step: returns [value in 0..1, next seed]. Deterministic across platforms. */
export function nextRandom(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function nextRecipe(menu: readonly RecipeId[], introduced: number, open: readonly Order[], roll: number): RecipeId {
  if (introduced < menu.length) return menu[introduced];
  const pool = menu.filter(id => open.filter(order => order.recipe === id).length < 2), list = pool.length ? pool : menu;
  return list[Math.floor(roll * list.length) % list.length];
}

/** Seconds a fresh order waits: generous for solo and duos. */
export const orderPatience = (patience: number, players: number) => patience * (players <= 1 ? 1.5 : players === 2 ? 1.25 : 1);
export const openingOrders = (players: number) => players >= 5 ? 3 : 2;
export const orderCap = (players: number) => players > 4 ? 6 : 4;
