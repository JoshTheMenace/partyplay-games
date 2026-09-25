/**
 * Seeded randomness. Each stream is an sfc32 generator whose four words live in state, so a clone
 * of the state carries its RNG and replays deterministically. Seeds come from splitmix32.
 */
export const STREAMS = ['dice', 'cards', 'auto', 'cpu'] as const;
export type StreamName = (typeof STREAMS)[number] | 'board';
export type Streams = Record<(typeof STREAMS)[number], number[]>;

function hash(text: string, seed: number) {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

function splitmix32(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedWords(seed: number, name: StreamName): number[] {
  const next = splitmix32(hash(name, seed));
  return [next(), next(), next(), next()];
}

/** One sfc32 step on the four words (mutated in place); returns a float in [0, 1). */
export function sfc32(w: number[]): number {
  const t = (((w[0] + w[1]) >>> 0) + w[3]) >>> 0;
  w[3] = (w[3] + 1) >>> 0;
  w[0] = w[1] ^ (w[1] >>> 9);
  w[1] = (w[2] + (w[2] << 3)) >>> 0;
  w[2] = ((w[2] << 21) | (w[2] >>> 11)) >>> 0;
  w[2] = (w[2] + t) >>> 0;
  return t / 4294967296;
}

export const seedStreams = (seed: number): Streams =>
  Object.fromEntries(STREAMS.map(name => [name, seedWords(seed, name)])) as Streams;

/** A throwaway generator (board generation). */
export function generator(seed: number, name: StreamName): () => number {
  const words = seedWords(seed, name);
  return () => sfc32(words);
}

export const int = (random: () => number, n: number) => Math.floor(random() * n);

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(random, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const pick = <T>(items: readonly T[], random: () => number): T => items[int(random, items.length)];

const ALL_PAIRS = Array.from({ length: 36 }, (_, i): [number, number] => [1 + (i % 6), 1 + Math.floor(i / 6)]);

/**
 * Plain dice, or the balanced deck (ENGINE §7): all 36 pairs, reshuffled when 6 remain; a repeat of
 * the previous total is put back and redrawn once with probability 0.3.
 */
export function rollDice(
  random: () => number, deck: [number, number][] | null, last: number | null,
): { dice: [number, number]; deck: [number, number][] | null } {
  if (!deck) return { dice: [1 + int(random, 6), 1 + int(random, 6)], deck: null };
  let cards = [...deck];
  let dice = cards.pop()!;
  if (dice[0] + dice[1] === last && random() < 0.3) {
    cards.splice(int(random, cards.length + 1), 0, dice);
    dice = cards.pop()!;
  }
  if (cards.length <= 6) cards = shuffle(ALL_PAIRS, random);
  return { dice: [dice[0], dice[1]], deck: cards };
}

export const freshDiceDeck = (random: () => number) => shuffle(ALL_PAIRS, random);
