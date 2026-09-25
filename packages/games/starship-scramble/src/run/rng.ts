/** Seeded mulberry32 over a stored integer, so every roll survives save/load. */
export type Rng = { rng: number };
export function random(s: Rng) {
  let t = s.rng = (s.rng + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const int = (s: Rng, lo: number, hi: number) => lo + Math.floor(random(s) * (hi - lo + 1));
export const pick = <T>(s: Rng, list: readonly T[]) => list[Math.floor(random(s) * list.length)];
export function weighted<T>(s: Rng, list: readonly T[], weight: (item: T) => number): T {
  let roll = random(s) * list.reduce((sum, item) => sum + weight(item), 0);
  return list.find(item => (roll -= weight(item)) < 0) ?? list[list.length - 1];
}
