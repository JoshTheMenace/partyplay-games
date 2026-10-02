/** Night-fresh content decks on top of api.used, so replaying a minigame in one night repeats content only once a bank runs out. */
import type { MiniApi } from '../contract';

/** Every item, unused tonight first, then used ones; each group shuffled. Mark items as you deal them with `api.used.add`. */
export function freshDeck<T>(api: MiniApi, items: readonly T[], key: (item: T) => string = String): T[] {
  const used = (item: T) => api.used.has(key(item));
  return [...api.shuffle(items.filter(item => !used(item))), ...api.shuffle(items.filter(used))];
}

/** Up to `count` items from the fresh end of the deck, marked as used. */
export function dealFresh<T>(api: MiniApi, items: readonly T[], count: number, key: (item: T) => string = String): T[] {
  const hand = freshDeck(api, items, key).slice(0, Math.max(0, count));
  for (const item of hand) api.used.add(key(item));
  return hand;
}
