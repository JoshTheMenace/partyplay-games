/* Sketch Bluff bot (tests and QA only): scribbles shapes (sometimes at the full ink limit), forges titles, guesses and likes at random. */
import { DRAWING_COLORS, DRAWING_LIMITS, type Drawing, type DrawingStroke } from '../../../../../party-contract/src/index';
import type { MiniBot } from '../../core/contract';
import { MAX_LIKES, MAX_TITLE, type SketchPrivate, type SketchPublic } from './types';

const ADJ = ['suspicious', 'wobbly', 'majestic', 'soggy', 'furious', 'sleepy', 'fancy', 'nervous', 'haunted', 'tiny', 'glamorous', 'confused'];
// One noun per seat, so two bots never forge the same title.
const NOUN = ['aardvark', 'trombone', 'noodle', 'kazoo', 'tuba', 'pudding', 'wombat', 'teacup', 'spatula', 'yodeller', 'gherkin', 'blimp'];
const DOING = ['eating soup', 'on holiday', 'at the opera', 'doing taxes', 'in a hurry', 'on a unicycle', 'in love', 'at midnight'];
const MORE = [' at midnight', ' again', ' in the rain', ', sadly', ' twice'];

/** A doodle of loops, squiggles and zigzags; `max` fills every stroke and point the shared limits allow. */
export function doodle(random: () => number, max = false): Drawing {
  const strokes: DrawingStroke[] = [], count = max ? DRAWING_LIMITS.strokes : 3 + Math.floor(random() * 6);
  const per = max ? Math.floor(DRAWING_LIMITS.points / count) : 0;
  const clamp = (v: number) => Math.round(Math.min(.97, Math.max(.03, v)) * 1000) / 1000;
  for (let i = 0; i < count; i++) {
    const n = per || 8 + Math.floor(random() * 22), cx = .2 + random() * .6, cy = .2 + random() * .6, r = .06 + random() * .22, kind = Math.floor(random() * 3);
    const points = Array.from({ length: n }, (_, k) => {
      const f = k / (n - 1);
      if (kind === 0) return { x: clamp(cx + r * Math.cos(f * Math.PI * 2)), y: clamp(cy + r * .8 * Math.sin(f * Math.PI * 2)) };
      if (kind === 1) return { x: clamp(cx - r + 2 * r * f), y: clamp(cy + r * .5 * Math.sin(f * Math.PI * 6)) };
      return { x: clamp(cx - r + 2 * r * f), y: clamp(cy + (k % 2 ? r : -r) * .4) };
    });
    strokes.push({ color: DRAWING_COLORS[i % DRAWING_COLORS.length]!, width: [.008, .012, .02, .03][Math.floor(random() * 4)]!, points });
  }
  return { strokes };
}

export const bot: MiniBot<SketchPublic, SketchPrivate> = ({ view, me, playerId, players, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const turn = view.turn, pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  if (view.phase === 'draw') return me.drawn ? null : { turn, k: 'draw', drawing: doodle(random, random() < .25) };
  if (view.phase === 'title' && !me.artist && me.title === undefined) {
    if (me.suggestions?.length && random() < .15) return { turn, k: 'title', text: pick(me.suggestions) };
    const seat = Math.max(0, players.findIndex(p => p.id === playerId)), base = `a ${pick(ADJ)} ${NOUN[seat % NOUN.length]} ${pick(DOING)}`;
    // A quarter of titles run to the 40-character limit so QA screenshots show the worst case.
    const text = random() < .25 ? MORE.reduce((t, part) => t.length + part.length <= MAX_TITLE ? t + part : t, base) : base;
    return { turn, k: 'title', text };
  }
  if (view.phase !== 'guess') return null;
  const others = (view.options ?? []).filter(o => o.id !== me.mine);
  if (!others.length) return null;
  if (!me.artist && !me.pick) return { turn, k: 'guess', option: pick(others).id };
  const liked = me.likes ?? [], fresh = others.filter(o => !liked.includes(o.id));
  if (fresh.length && liked.length < MAX_LIKES && random() < (liked.length ? .02 : .12)) return { turn, k: 'like', option: pick(fresh).id, on: true };
  return null;
};
export default bot;
