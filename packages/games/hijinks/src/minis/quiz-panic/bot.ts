/* Quiz Panic bot (tests and QA only): a half-decent quizzer that knows the banks, so games mix right and wrong answers, deaths and escapes. */
import type { MiniBot } from '../../core/contract';
import { CATEGORIES, TRIVIA, WORDS } from './content.server';
import { OPTIONS, ROOMS, SEQUENCE, SYMBOLS, type QuizPrivate, type QuizPublic, type Sum } from './types';

/** What each bot saw during a memory flash (keyed by seat and question), so it can try to repeat it during recall. */
const seen = new Map<string, number[]>();
const solve = ({ a, op, b }: Sum) => op === '+' ? a + b : op === '−' ? a - b : a * b;
const sorted = (s: string) => [...s].sort().join('');
/** QA only (QP_QA_DOOMED=1): the VIP seat, i.e. the QA driver's phone, answers every question wrong and aces the skill challenges, so live runs reach the phone's task screens. */
const qaDoomed = typeof process !== 'undefined' && process.env.QP_QA_DOOMED === '1';

export const bot: MiniBot<QuizPublic, QuizPrivate> = ({ view, me, playerId, players, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const turn = view.turn, any = (n: number) => Math.floor(random() * n), p = view.panic, doomed = qaDoomed && players[0]?.id === playerId;
  if (view.phase === 'question' && view.question && me.pick === undefined) {
    const known = TRIVIA.find(t => t.text === view.question!.text), right = known ? view.question.options.indexOf(known.answer) : -1;
    return { turn, k: 'answer', option: doomed ? (Math.max(right, 0) + 1) % OPTIONS : right >= 0 && random() < .55 ? right : any(OPTIONS) };
  }
  if (view.phase === 'panic' && p) {
    if (p.sequence) seen.set(`${playerId}:${view.q}`, p.sequence);
    switch (me.task) {
      case 'poison': case 'drink': return me.cup === undefined ? { turn, k: 'cup', cup: any(p.cups ?? 1) } : null;
      case 'hide': return me.room === undefined ? { turn, k: 'room', room: any(ROOMS) } : null;
      case 'math': return me.sums && !me.answers ? { turn, k: 'math', answers: me.sums.map(sum => solve(sum) + (!doomed && random() < .12 ? 1 : 0)) } : null;
      case 'memory': {
        if (p.stage !== 'recall' || me.memory) return null;
        const memory = seen.get(`${playerId}:${view.q}`);
        return { turn, k: 'memory', seq: memory && (doomed || random() < .7) ? memory : Array.from({ length: SEQUENCE }, () => any(SYMBOLS)) };
      }
      case 'scramble': {
        if (!me.letters || me.solved || (me.misses ?? 0) >= 3) return null;
        const word = WORDS.find(w => sorted(w) === sorted(me.letters!.join('')));
        return { turn, k: 'word', text: word && (doomed || random() < .6) ? word : me.letters.join('') };
      }
      case 'coin': {
        const decided = p.safe?.includes(playerId) || p.out?.includes(playerId);
        return p.stage === 'call' && !decided && me.calls?.length === (p.flips?.length ?? 0) ? { turn, k: 'call', side: random() < .5 ? 'H' : 'T' } : null;
      }
      default: return null;
    }
  }
  if (view.phase === 'final-question' && view.final && !me.items) {
    const cat = CATEGORIES.find(c => c.name === view.final!.category);
    const picks = view.final.items.flatMap((item, i) => (cat?.yes.includes(item) ? random() < .8 : random() < .15) ? [i] : []);
    return { turn, k: 'items', picks };
  }
  return null;
};
export default bot;
