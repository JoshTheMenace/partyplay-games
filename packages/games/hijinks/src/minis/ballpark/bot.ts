/* Ballpark bot (tests and QA only): answers the survey at random, turns the dial in steps toward a hunch, bets, ticks and picks. */
import type { MiniBot } from '../../core/contract';
import { BETS, WANTED_PICKS, WANTED_SIZE, possible, type BallparkPrivate, type BallparkPublic } from './types';

/** Human-ish pauses (server ms into the phase) so live QA screenshots catch mid-phase states; the harness skips time anyway. */
const THINK = { survey: 5000, dial: 1000, lock: 10000, bet: 5000, tick: 10000, pick: 8000 } as const;
/** A stable 12–88 hunch per question, so a stateless bot keeps steering toward the same number. */
const hunch = (seed: string) => 12 + [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1009, 7) % 77;

export const bot: MiniBot<BallparkPublic, BallparkPrivate> = ({ view, me, playerId, now, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const t = now - view.at, turn = view.turn, q = view.q;
  if (view.phase === 'survey' && !me.answer && t >= THINK.survey) return { turn, k: 'answer', yes: random() < .5 };
  if (view.phase === 'guess' && q && me.role === 'agent' && !q.locked && t >= THINK.dial) {
    const target = hunch(turn + playerId), travel = Math.min(1, (t - THINK.dial) / (THINK.lock - THINK.dial - 1000));
    if (t >= THINK.lock) return { turn, k: 'lock', value: target };
    // Sweep from 50 toward the hunch about three times a second (the server ignores faster updates).
    const value = Math.round(50 + (target - 50) * travel);
    return value !== q.dial && Math.floor(t / 100) % 3 === 0 ? { turn, k: 'aim', value } : null;
  }
  if (view.phase === 'bet' && q && me.role === 'bettor' && !me.bet && t >= THINK.bet) {
    const options = BETS.filter(b => possible(b, q.dial ?? 50) && (view.round > 1 || !b.startsWith('much')));
    const long = options.filter(b => b.startsWith('much')), plain = options.filter(b => !b.startsWith('much'));
    const pool = long.length && random() < .3 ? long : plain;
    return { turn, k: 'bet', bet: pool[Math.floor(random() * pool.length)]! };
  }
  if (view.phase === 'tick' && !me.ticks && t >= THINK.tick) return { turn, k: 'ticks', ticks: Array.from({ length: WANTED_SIZE }, (_, i) => i).filter(() => random() < .45) };
  if (view.phase === 'pick' && !me.picks && t >= THINK.pick) {
    const all = Array.from({ length: WANTED_SIZE }, (_, i) => i);
    return { turn, k: 'picks', picks: Array.from({ length: WANTED_PICKS }, () => all.splice(Math.floor(random() * all.length), 1)[0]!) };
  }
  return null;
};
export default bot;
