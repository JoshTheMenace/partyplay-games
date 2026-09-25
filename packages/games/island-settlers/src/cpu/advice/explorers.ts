/**
 * Explorers & Pirates: the engine lists Sail headings most useful first; a settler aboard heads for
 * the goal edge beside the landing corner we value most (our own spot value, not just pips).
 */
import type { Command } from '../../model';
import type { Ctx } from '../context';
import { spotValue } from '../value';
import type { Advisor } from './index';

function answer(c: Ctx, cmd: Command) {
  const heading = cmd.fields[0], h = heading?.kind === 'pick' ? heading.options[0] : undefined;
  const edges = h?.value === 'settle' ? h.then?.[0] : undefined;
  const sail = cmd.id.startsWith('explorers/sail:');
  if (!sail || edges?.kind !== 'pick' || !edges.options.length) return undefined;
  const score = (id: string) => {
    const e = c.ix.edge.get(id);
    return e ? Math.max(spotValue(c, e.a), spotValue(c, e.b)) : 0;
  };
  const best = edges.options.reduce((a, b) => (score(b.value) > score(a.value) ? b : a));
  return { picks: { [heading.key]: h!.value, [edges.key]: best.value }, cards: {} };
}

export const explorers: Advisor = { answer };
