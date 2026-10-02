/* Bracket Brawl bot (tests and QA only): writes silly answers (some at the 50-character limit), picks a champion, votes at random. */
import type { MiniBot } from '../../core/contract';
import { MAX_ANSWER, showBeats, type BrawlPrivate, type BrawlPublic } from './types';

const THINGS = ['A goose', 'My nan', 'Soup', 'A haunted kettle', 'Three llamas', 'A tiny wizard', 'Cold beans', 'Uncle Derek', 'A wet sock', 'Bagpipes', 'Glitter', 'A sad trombone'];
const TAILS = [' with a grudge', ' in a tuxedo', ' on rollerskates', ' at 3 a.m.', ', but louder', ' from the future', ' that knows too much', ' in a hot tub'];
/** Worst cases: realistic text at or near the 50-character limit. */
const LONG = [
  'My nan’s haunted kettle that screams every Tuesday', 'Seventeen raccoons running a very small hair salon', 'A goose in a tuxedo who knows too much about tax',
  'Uncle Derek’s karaoke version of the shipping news', 'A wizard who only does birthday parties for cats', 'Forty soggy croissants and a strongly worded note',
];
/** Human-ish pauses (server ms into the phase) so live QA screenshots catch mid-phase states; the harness skips time anyway. */
const THINK = { write: 4000, second: 2500, predict: 2500, vote: 700 } as const;
/** A stable per-seat, per-phase delay (0 to max ms), so bots finish at different moments like people do. */
const stagger = (key: string, max: number) => [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) % max;

export const bot: MiniBot<BrawlPublic, BrawlPrivate> = ({ view, me, playerId, now, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const t = now - view.at, turn = view.turn, wait = (max: number) => stagger(playerId + turn, max), seat = stagger(playerId, 997);
  // Offset by seat so QA bots sharing a random seed still write different answers.
  const pick = <T,>(list: readonly T[]) => list[(Math.floor(random() * list.length) + seat) % list.length]!;
  const open = view.phase === 'write' ? me.answers.find(a => a.text === undefined) : undefined;
  if (open && t >= THINK.write + wait(9000) + open.slot * THINK.second) {
    // A third of answers run to the 50-character limit so QA screenshots show worst-case text.
    const text = random() < .33 ? pick(LONG) : `${pick(THINGS)}${pick(TAILS)}`;
    return { turn, k: 'answer', slot: open.slot, text: me.answers.some(a => a.text === text) ? `${text.slice(0, MAX_ANSWER - 6)} redux` : text };
  }
  if (view.phase === 'predict' && !me.pick && view.entries.length && t >= THINK.predict + wait(6000)) return { turn, k: 'predict', entry: pick(view.entries).id };
  if (view.phase === 'vote' && me.role === 'voter' && me.vote === undefined && view.match) {
    const [a, b] = view.bouts[view.round - 1]![view.match.index]!.sides.map(id => view.entries.find(e => e.id === id)?.text ?? '');
    if (t >= showBeats(a!, b!).b + THINK.vote + wait(2500)) return { turn, k: 'vote', side: random() < .5 ? 0 : 1 };
  }
  return null;
};
export default bot;
