/**
 * Prompt answers and the generic Command filler shared with module commands: card fields shed
 * the least useful cards or gather the most needed ones; pick fields choose by their target kind.
 */
import {
  GOODS, type Action, type CardPicks, type Cards, type CardsField, type Command, type Good, type PickField,
  type Picks,
} from '../model';
import { advisedAnswer } from './advice/index';
import { count, total } from './cards';
import { act, type Ctx } from './context';
import { toward } from './modules';
import { bestVictim, robberPicks } from './robber';
import type { Needs } from './trade';

const want = (c: Ctx, g: Good, n: Needs, extra: Cards) =>
  count(n.a, g) + count(n.b, g) - count(c.me.hand, g) - count(extra, g);

/** Give up `k` cards, most surplus first (ties: bigger pile). */
export function shed(f: CardsField, k: number, n: Needs): Cards {
  const left: Cards = { ...f.available }, out: Cards = {};
  const surplus = (g: Good) => count(left, g) - count(n.a, g) - count(n.b, g);
  for (let i = 0; i < k; i++) {
    const open = f.allowed.filter(g => count(left, g) > 0);
    if (!open.length) break;
    const rank = (g: Good) => surplus(g) * 100 + count(left, g);
    const g = open.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    left[g] = count(left, g) - 1;
    out[g] = count(out, g) + 1;
  }
  return out;
}

/** Take `k` cards, what the goals lack first, then what we hold and produce least. */
export function gather(c: Ctx, f: CardsField, k: number, n: Needs): Cards {
  const out: Cards = {};
  const prod = (g: Good) => (c.prod as Partial<Record<Good, number>>)[g] ?? 0;
  const score = (g: Good) => want(c, g, n, out) * 10 - count(c.me.hand, g) - count(out, g) - prod(g) / 10;
  for (let i = 0; i < k; i++) {
    const open = f.allowed.filter(g => count(f.available, g) > count(out, g));
    if (!open.length) break;
    const g = open.reduce((a, b) => (score(b) > score(a) ? b : a));
    out[g] = count(out, g) + 1;
  }
  return out;
}

function choose(c: Ctx, f: PickField, n: Needs, explorer: boolean) {
  const values = f.options.map(o => o.value);
  const pick = (v: string | null | undefined) => f.options.find(o => o.value === v) ?? f.options[0];
  if (f.target === 'seat') return pick(bestVictim(c, values.filter(v => v !== c.seat)));
  if (f.target === 'good') {
    const goods = values.filter((v): v is Good => (GOODS as readonly string[]).includes(v));
    const need = (g: Good) => want(c, g, n, {});
    return pick(goods.reduce<Good | null>((a, b) => (a === null || need(b) > need(a) ? b : a), null));
  }
  // Engines list map options best first; only Explorers ships steer toward mission sights.
  return explorer && f.target !== 'track' ? pick(toward(c, values)) : f.options[0];
}

/** Picks and cards for any command (its module's advisor first), or null when a field has no legal choice. */
export function fill(c: Ctx, cmd: Command, n: Needs): { picks: Picks; cards: CardPicks } | null {
  const advised = advisedAnswer(c, cmd, n);
  if (advised !== undefined) return advised;
  const picks: Picks = {}, cards: CardPicks = {}, queue = [...cmd.fields];
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    if (f.kind === 'cards') {
      const chosen = f.source === 'hand' ? shed(f, f.min, n) : gather(c, f, f.max, n);
      if (total(chosen) < f.min) return null;
      cards[f.key] = chosen;
      continue;
    }
    if (f.optional) continue;
    if (!f.options.length) return null;
    const o = choose(c, f, n, cmd.module === 'explorers' && !!f.target);
    picks[f.key] = o.value;
    if (o.then) queue.push(...o.then);
  }
  return { picks, cards };
}

/** Answer our most urgent prompt that has a legal answer (an empty pick waits for its timeout). */
export function promptAction(c: Ctx, n: Needs): Action | null {
  const first = c.me.prompts.find(x => x.id === c.me.task.prompt);
  for (const p of first ? [first, ...c.me.prompts.filter(x => x !== first)] : c.me.prompts) {
    const robber = p.kind === 'robber' ? robberPicks(c, p.command) : null;
    const answer = robber ? { picks: robber, cards: {} } : fill(c, p.command, n);
    if (answer) return act(c, { type: 'answer', prompt: p.id, ...answer });
  }
  return null;
}
