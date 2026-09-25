/** Results-journal awards, shared by the server outcome rows and the results view. */
import type { JournalEntry } from './protocol';

export type AwardKey = keyof Omit<JournalEntry, 'id'> | 'survivor';
export type Award = { key: AwardKey; title: string; ids: string[] };

/** [stat, minimum to earn it, group title (best player), solo title]. */
const AWARDS: readonly [keyof Omit<JournalEntry, 'id' | 'deaths'>, number, string, string][] = [
  ['mined', 25, 'Top miner', 'Miner'],
  ['placed', 20, 'Master builder', 'Builder'],
  ['crafted', 10, 'Chief crafter', 'Crafter'],
  ['mobs', 3, 'Monster hunter', 'Monster hunter'],
  ['distance', 500, 'Trailblazer', 'Explorer'],
];
const SURVIVOR = 'Never fell';

/**
 * Groups: the best value at or above each award's minimum wins it (ties share), and everyone with no deaths is a
 * survivor. Solo: at most two personal highlights (the stats furthest past their minimum, then surviving).
 */
export function awards(journal: readonly JournalEntry[]): Award[] {
  if (journal.length === 1) {
    const [entry] = journal as [JournalEntry];
    const earned = AWARDS.filter(([key, min]) => entry[key] >= min).sort((a, b) => entry[b[0]] / b[1] - entry[a[0]] / a[1]);
    const highlights: Award[] = earned.map(([key, , , title]) => ({ key, title, ids: [entry.id] }));
    if (!entry.deaths) highlights.push({ key: 'survivor', title: SURVIVOR, ids: [entry.id] });
    return highlights.slice(0, 2);
  }
  const result: Award[] = [];
  for (const [key, min, title] of AWARDS) {
    const best = Math.max(0, ...journal.map(entry => entry[key]));
    if (best >= min) result.push({ key, title, ids: journal.filter(entry => entry[key] === best).map(entry => entry.id) });
  }
  const survivors = journal.filter(entry => entry.deaths === 0).map(entry => entry.id);
  if (survivors.length) result.push({ key: 'survivor', title: SURVIVOR, ids: survivors });
  return result;
}
