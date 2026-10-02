/** Seeded LCG shared by the pack and minigames (replayable from the round seed). */
export type Seeded = { seed: number };

/** Scrambles nearby room seeds so their first draws differ (murmur3 finaliser). */
export function mix(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function random(state: Seeded): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

export function shuffle<T>(state: Seeded, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function pick<T>(state: Seeded, items: readonly T[], count: number): T[] {
  return shuffle(state, items).slice(0, Math.max(0, Math.floor(count)));
}
