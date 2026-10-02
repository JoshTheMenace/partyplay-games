/* Split Decision bot (tests and QA only): fills blanks with silly catches (a quarter run to the 60-character limit so QA sees
   worst cases), sometimes lets the machine fill one, votes and judges at random with human-ish pauses. */
import type { MiniBot } from '../../core/contract';
import { MAX_FILL, carousel, type SplitPrivate, type SplitPublic } from './types';

const CATCHES = ['you have to wear a wizard hat', 'a goose follows you home', 'you can only eat soup', 'your socks are always wet', 'you sneeze every ten minutes', 'you must yodel at dawn'];
const CATCH_MORE = [' to every single meeting', ' for the rest of your life', ', even on holiday', ' and everyone knows', ', twice'];
const ACTIONS = ['wrestle a polite bear', 'eat a spoonful of mustard', 'dance with a mop', 'live in a lighthouse', 'sing to every pigeon', 'ride a llama to work'];
const ACTION_MORE = [' every Tuesday', ' in front of your boss', ' while wearing flippers', ', twice', ' forever'];
/** Human-ish pauses (server ms into the phase) so live QA screenshots catch mid-phase states; the harness skips time anyway. */
const THINK = { write: 5000, second: 4000, vote: 3000, judge: 1600, judgeEach: 1100 } as const;

/** Whole clauses up to the limit, so long fills end cleanly. */
const grow = (base: string, parts: readonly string[]) => parts.reduce((text, part) => text.length + part.length <= MAX_FILL ? text + part : text, base);

export const bot: MiniBot<SplitPublic, SplitPrivate> = ({ view, me, now, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const t = now - view.at, turn = view.turn, any = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const slots = me.task?.slots ?? [], open = slots.findIndex(x => x.text === undefined);
  if (open >= 0 && t >= THINK.write + open * THINK.second) {
    if (random() < .1) return { turn, k: 'house', slot: open };
    const rather = me.task!.kind === 'rather', base = any(rather ? ACTIONS : CATCHES);
    const text = random() < .25 ? grow(base, rather ? ACTION_MORE : CATCH_MORE) : base;
    return { turn, k: 'fill', slot: open, text: slots.some(x => x.text?.toLowerCase() === text.toLowerCase()) ? `${text} instead` : text };
  }
  if (view.phase === 'vote' && me.role === 'voter' && me.side === undefined && t >= THINK.vote) return { turn, k: 'vote', side: random() < .5 ? 0 : 1 };
  if (view.phase === 'final-vote' && view.final) {
    const judged = me.judged ?? {}, next = carousel(view.final.entries, me.mine).find(e => !Object.hasOwn(judged, e.id));
    if (next && t >= THINK.judge + THINK.judgeEach * Object.keys(judged).length) return { turn, k: 'judge', entry: next.id, side: random() < .5 ? 0 : 1 };
  }
  return null;
};
export default bot;
