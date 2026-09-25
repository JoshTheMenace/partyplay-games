/**
 * CPU entry (BUILD-PLAN WP-cpu): a pure function of the public view, this seat's private view and
 * its own memory. Order of duties: prompts, trade answers, then the seat's own step. Never throws.
 */
import type { Action, CardPicks, Command, CpuLevel, Picks, PrivateView, PublicView } from '../model';
import { context, recall, type Ctx } from './context';
import { goals } from './plan';
import { promptAction } from './prompts';
import { setupAction } from './setup';
import { needsOf, respondAction } from './trade';
import { mainStep, rollStep } from './turn';

export { PERSONAS } from './personas';

export type Brain = { level: CpuLevel; persona: string; memory: unknown; random: () => number };
export type Pace = 'think' | 'forced' | 'respond';
export type Decision = { action: Action | null; memory: unknown; pace: Pace };

type Thought = { action: Action | null; pace: Pace };

function think(c: Ctx): Thought {
  const { stage } = c.pub.turn, kind = c.me.task.kind;
  if (stage === 'finale' || stage === 'ended') return { action: null, pace: 'think' };
  if (kind === 'setup' && !c.me.prompts.length) return { action: setupAction(c), pace: 'think' };
  const list = goals(c), n = needsOf(list[0], list[1]);
  if (c.me.prompts.length) {
    const forced = c.me.prompts.every(p => p.kind === 'discard' || p.kind === 'gold');
    return { action: promptAction(c, n), pace: forced ? 'forced' : 'think' };
  }
  const reply = respondAction(c, n);
  if (reply) return { action: reply, pace: 'respond' };
  if (kind === 'roll') return { action: rollStep(c, list).action, pace: 'think' };
  if (kind === 'main' || kind === 'paired' || kind === 'round') {
    const step = mainStep(c, n, list);
    return { action: step.action, pace: step.wait ? 'respond' : 'think' };
  }
  return { action: null, pace: 'respond' };
}

/** First legal-looking answer for any command (used only when planning failed). */
function plainFill(cmd: Command): { picks: Picks; cards: CardPicks } {
  const picks: Picks = {}, cards: CardPicks = {}, queue = [...cmd.fields];
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    if (f.kind === 'pick') {
      if (f.optional || !f.options.length) continue;
      picks[f.key] = f.options[0].value;
      queue.push(...(f.options[0].then ?? []));
      continue;
    }
    const out: Record<string, number> = {};
    let k = f.source === 'hand' ? f.min : f.max;
    for (const g of f.allowed) {
      const take = Math.min(k, f.available[g] ?? 0);
      if (take > 0) { out[g] = take; k -= take; }
    }
    cards[f.key] = out;
  }
  return { picks, cards };
}

/** Safe fallback: answer the prompt plainly, else roll, else end, else nothing. */
function safe(pub: PublicView, me: PrivateView): Action | null {
  try {
    const turnId = pub.turn.id, p = me.prompts[0];
    if (p) return { type: 'answer', turnId, prompt: p.id, ...plainFill(p.command) };
    if (me.can.roll) return { type: 'roll', turnId };
    return me.can.end ? { type: 'end', turnId } : null;
  } catch {
    return null;
  }
}

/** decide() without the safety net, for tests that must see planning errors. */
export function decideStrict(pub: PublicView, me: PrivateView, brain: Brain): Decision {
  const c = context(pub, me, brain.level, brain.persona, brain.random, recall(brain.memory, pub.turn.id));
  const t = think(c);
  return { action: t.action, memory: c.mem, pace: t.pace };
}

export function decide(pub: PublicView, me: PrivateView, brain: Brain): Decision {
  try {
    return decideStrict(pub, me, brain);
  } catch {
    return { action: safe(pub, me), memory: recall(brain.memory, pub?.turn?.id ?? 0), pace: 'think' };
  }
}
