/* Big-room sampling: personal ballots, so 40 answers never have to fit one screen. Server only. */
import type { MiniApi } from '../contract';

/**
 * Deals every voter `size` entries they did not write, so that each entry lands on about the same number of ballots
 * (least-seen entries first, ties by lot). Order inside a ballot is shuffled. Randomness comes from `api` (seeded).
 */
export function dealBallots<T>(api: MiniApi, voters: readonly string[], entries: readonly T[], size: number, wrote: (entry: T, voter: string) => boolean): Record<string, T[]> {
  const seen = new Map(entries.map(e => [e, 0])), out: Record<string, T[]> = {};
  for (const voter of api.shuffle(voters)) {
    const hand = api.shuffle(entries.filter(e => !wrote(e, voter))).sort((a, b) => seen.get(a)! - seen.get(b)!).slice(0, size);
    for (const e of hand) seen.set(e, seen.get(e)! + 1);
    out[voter] = api.shuffle(hand);
  }
  return out;
}
