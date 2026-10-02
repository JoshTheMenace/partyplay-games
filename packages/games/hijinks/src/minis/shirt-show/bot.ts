/* Shirt Show bot (tests and QA only): doodles 1–4 designs (sometimes at the full ink limit), writes slogans (sometimes 40
   characters), builds shirts from its hand with the odd reroll, and votes at random. */
import { DRAWING_COLORS, DRAWING_LIMITS, type Drawing, type DrawingStroke } from '../../../../../party-contract/src/index';
import type { MiniBot } from '../../core/contract';
import { MAX_DESIGNS, MAX_SLOGAN, MAX_SLOGANS, SHIRT_COLORS, type ShirtPrivate, type ShirtPublic } from './types';

const WORDS = ['Goose', 'Pickle', 'Waffle', 'Wizard', 'Noodle', 'Kazoo', 'Llama', 'Pudding', 'Cactus', 'Disco', 'Trombone', 'Spatula'];
const MORE = [' Forever', ' and Proud', ' on Tuesdays', ' Club', ', Probably', ' Champion'];

/** Loops, zigzags and starbursts; `max` uses every stroke and point the shared limits allow. */
export function doodle(random: () => number, max = false): Drawing {
  const strokes: DrawingStroke[] = [], count = max ? DRAWING_LIMITS.strokes : 2 + Math.floor(random() * 6), per = max ? Math.floor(DRAWING_LIMITS.points / count) : 0;
  const clamp = (v: number) => Math.round(Math.min(.97, Math.max(.03, v)) * 1000) / 1000;
  for (let i = 0; i < count; i++) {
    const n = per || 10 + Math.floor(random() * 24), cx = .25 + random() * .5, cy = .25 + random() * .5, r = .08 + random() * .2, kind = Math.floor(random() * 3);
    strokes.push({ color: DRAWING_COLORS[(i + Math.floor(random() * 6)) % DRAWING_COLORS.length]!, width: [.012, .02, .03, .04][Math.floor(random() * 4)]!, points: Array.from({ length: n }, (_, k) => {
      const f = k / (n - 1), a = f * Math.PI * 2;
      if (kind === 0) return { x: clamp(cx + r * Math.cos(a)), y: clamp(cy + r * Math.sin(a)) };
      if (kind === 1) return { x: clamp(cx - r + 2 * r * f), y: clamp(cy + (k % 2 ? r : -r) * .45) };
      return { x: clamp(cx + r * (k % 2 ? .4 : 1) * Math.cos(a)), y: clamp(cy + r * (k % 2 ? .4 : 1) * Math.sin(a)) };
    }) });
  }
  return { strokes };
}

export const bot: MiniBot<ShirtPublic, ShirtPrivate> = ({ view, me, playerId, players, now, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const turn = view.turn, seat = Math.max(0, players.findIndex(p => p.id === playerId)), pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  // Each seat aims for its own quota (1–4 designs, 1–6 slogans) so rooms see sparse and full racks.
  if (view.phase === 'draw' && !me.finished) return (me.designs ?? 0) < 1 + (seat + view.round) % MAX_DESIGNS
    ? { turn, k: 'design', drawing: doodle(random, random() < .2) } : { turn, k: 'done' };
  if (view.phase === 'write' && !me.finished) {
    if ((me.slogans?.length ?? 0) >= 1 + (seat * 2 + view.round) % MAX_SLOGANS) return { turn, k: 'done' };
    const base = `${WORDS[(seat * 3 + (me.slogans?.length ?? 0)) % WORDS.length]} ${pick(WORDS)}`; // the first word never repeats for one seat
    // A quarter of slogans run to the 40-character limit so QA screenshots show the worst case.
    return { turn, k: 'slogan', text: random() < .25 ? MORE.reduce((t, part) => t.length + part.length <= MAX_SLOGAN ? t + part : t, `World’s Greatest ${base}`) : base };
  }
  if (view.phase === 'make' && me.hand) {
    const { hand } = me;
    if (hand.reroll.design && random() < .1) return { turn, k: 'reroll', what: 'design' };
    if (hand.reroll.slogan && random() < .1) return { turn, k: 'reroll', what: 'slogan' };
    return { turn, k: 'shirt', design: pick(hand.designs), slogan: pick(hand.slogans).id, color: Math.floor(random() * SHIRT_COLORS.length), pos: random() < .5 ? 'top' : 'bottom' };
  }
  // Voters look at the shirts for a staggered beat first, so QA sees the live vote state.
  if ((view.phase === 'vote' || view.phase === 'final-vote') && !me.mine && me.vote === undefined && now - view.at >= 1500 + seat * 350) return { turn, k: 'vote', side: random() < .5 ? 0 : 1 };
  return null;
};
export default bot;
