/* Odd One In bot (tests and QA only): answers at random after a beat, talks it over for a few seconds, accuses someone else. */
import type { MiniBot } from '../../core/contract';
import { FACES, NUMBERS, type OddPrivate, type OddPublic } from './types';

/** Human-ish pauses (server ms into the phase) so live QA screenshots catch mid-phase states; the test harness skips time anyway. */
const THINK = { task: 2500, discuss: 6000, vote: 2000 } as const;

export const bot: MiniBot<OddPublic, OddPrivate> = ({ view, me, playerId, players, now, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const one = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!, waited = (ms: number) => now - view.at >= ms;
  if (view.phase === 'task' && me.answer === undefined && waited(THINK.task)) {
    const values = { hands: ['up', 'down'], number: NUMBERS, point: players.map(p => p.id), face: FACES.map(f => f.id) }[view.category];
    return { turn: view.turn, k: 'answer', value: one(values) };
  }
  if (view.phase === 'discuss' && !me.ready && waited(THINK.discuss)) return { turn: view.turn, k: 'ready' };
  const suspects = players.filter(p => p.id !== playerId).map(p => p.id);
  if (view.phase === 'vote' && me.vote === undefined && suspects.length && waited(THINK.vote))
    return { turn: view.turn, k: 'vote', suspect: !me.faker && random() < .6 ? oddest(view, suspects, random) : one(suspects) };
  return null;
};

/** A sleuthing bot accuses whoever answered least like the room (number: furthest from the median). */
function oddest(view: OddPublic, suspects: string[], random: () => number) {
  const answers = view.answers ?? [], values = answers.map(a => a.value), median = values.map(Number).sort((a, b) => a - b)[values.length >> 1] ?? 0;
  const odd = (id: string) => { const v = answers.find(a => a.player === id)?.value ?? ''; return view.category === 'number' ? Math.abs(Number(v) - median) : -values.filter(x => x === v).length; };
  return suspects.map(id => ({ id, score: odd(id) + random() * .5 })).sort((a, b) => b.score - a.score)[0]!.id;
}
export default bot;
