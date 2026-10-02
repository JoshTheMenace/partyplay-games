/* Airlock bot (tests and QA only): answers after a beat (sometimes at the full length), aliens hack now and then, a few bots push
   the button, crew vote AIRLOCK more often than not and aliens protect each other. */
import { DRAWING_COLORS, DRAWING_LIMITS, type Drawing } from '../../../../../party-contract/src/index';
import type { MiniBot } from '../../core/contract';
import { MAX_ANSWER, RATING_MAX, type AirPrivate, type AirPublic } from './types';

/** Human-ish pauses (server ms into the phase) so live QA screenshots catch mid-phase states; the test harness skips time anyway. */
const THINK = { test: 8000, discuss: 9000, push: 6000, vote: 2500 } as const;
const WORDS = ['toast', 'pancakes', 'spaghetti', 'a waffle', 'cereal', 'soup', 'a banana', 'porridge', 'curry', 'beans'];
const MORE = [' with extra syrup', ' and a side of beans', ' on a Tuesday', ' in space', ', obviously'];
/** Stable 0–999 per string, so a bot's one-off decisions don't flip from tick to tick. */
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1000, 7);

/** A doodle of loops and zigzags; `max` fills every stroke and point the shared limits allow. */
export function doodle(random: () => number, max = false): Drawing {
  const count = max ? DRAWING_LIMITS.strokes : 3 + Math.floor(random() * 5), per = max ? Math.floor(DRAWING_LIMITS.points / count) : 0;
  const clamp = (v: number) => Math.round(Math.min(.97, Math.max(.03, v)) * 1000) / 1000;
  return { strokes: Array.from({ length: count }, (_, i) => {
    const n = per || 8 + Math.floor(random() * 18), cx = .2 + random() * .6, cy = .2 + random() * .6, r = .08 + random() * .2, loop = random() < .5;
    const points = Array.from({ length: n }, (_, k) => {
      const f = k / (n - 1);
      return loop ? { x: clamp(cx + r * Math.cos(f * Math.PI * 2)), y: clamp(cy + r * Math.sin(f * Math.PI * 2)) } : { x: clamp(cx - r + 2 * r * f), y: clamp(cy + (k % 2 ? r : -r) * .4) };
    });
    return { color: DRAWING_COLORS[i % DRAWING_COLORS.length]!, width: [.008, .014, .022][Math.floor(random() * 3)]!, points };
  }) };
}

export const bot: MiniBot<AirPublic, AirPrivate> = ({ view, me, playerId, players, now, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const turn = view.turn, waited = (ms: number) => now - view.at >= ms, one = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const others = players.filter(p => p.id !== playerId).map(p => p.id), kind = view.kinds.at(-1);
  if (view.phase === 'test' && me.answer === undefined && waited(THINK.test)) {
    if (me.role === 'alien' && me.scan && random() < .2) return { turn, k: 'scan' };
    if (kind === 'draw') return { turn, k: 'draw', drawing: doodle(random, random() < .2) };
    if (kind === 'answer') {
      // A quarter of answers run to the 40-character limit so QA screenshots show the worst case.
      const text = random() < .25 ? MORE.reduce((t, part) => t.length + part.length <= MAX_ANSWER ? t + part : t, `${one(WORDS)} and ${one(WORDS)}`) : one(WORDS);
      return { turn, k: 'answer', value: text };
    }
    const value = kind === 'rating' ? 1 + Math.floor(random() * RATING_MAX) : kind === 'pick' ? one(players.map(p => p.id)) : Math.floor(random() * 4);
    return { turn, k: 'answer', value };
  }
  if (view.phase === 'discuss' && !me.ready) {
    // From the fourth test, about one bot in twenty-five pushes the button in a given discussion (aliens only frame humans).
    const pushes = view.pushes[playerId] ?? 0, suspects = others.filter(id => !me.allies.includes(id));
    if (view.test > 3 && pushes > 0 && hash(`${turn}:${playerId}`) < 40 && suspects.length >= view.aliens && waited(THINK.push))
      return { turn, k: 'push', suspects: [...suspects].sort(() => random() - .5).slice(0, view.aliens) };
    return waited(THINK.discuss) ? { turn, k: 'ready' } : null;
  }
  if (view.phase === 'vote' && view.ballot && !me.vote && !view.ballot.suspects.includes(playerId) && waited(THINK.vote)) {
    const protect = me.role === 'alien' && view.ballot.suspects.some(id => me.allies.includes(id));
    return { turn, k: 'vote', vote: protect || (me.role === 'crew' && random() < .25) ? 'abort' : 'airlock' };
  }
  return null;
};
export default bot;
