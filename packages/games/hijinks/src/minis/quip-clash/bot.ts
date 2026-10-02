/* Quip Clash bot (tests and QA only): writes silly word salad, sometimes grabs a safety quip, votes at random. */
import type { MiniBot } from '../../core/contract';
import { FINAL_VOTES, MAX_ANSWER, type QuipPrivate, type QuipPublic } from './types';

const WORDS = ['banana', 'spatula', 'wizard', 'pickle', 'noodle', 'trombone', 'goose', 'pudding', 'kazoo', 'llama', 'sock', 'waffle', 'yodel', 'cactus', 'moustache', 'jelly'];

export const bot: MiniBot<QuipPublic, QuipPrivate> = ({ view, me, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const word = () => WORDS[Math.floor(random() * WORDS.length)]!;
  const open = me.prompts.find(p => p.answer === undefined);
  if (open) {
    if (random() < .1) return { turn: view.turn, k: 'safety', slot: open.slot };
    // A quarter of answers run long (up to the 80-character limit) so QA screenshots show maximum-length text.
    const long = [`A ${word()} that ${word()}s every ${word()}`, ` while yelling about ${word()}s`, ` at the ${word()} festival`, `, twice`, ` on Tuesdays`]
      .reduce((text, part) => text.length + part.length <= MAX_ANSWER ? text + part : text);
    const text = random() < .25 ? long : `The ${word()} ${word()} of ${word()}s`;
    return { turn: view.turn, k: 'answer', slot: open.slot, text };
  }
  if (view.phase === 'vote' && me.role === 'voter' && me.side === undefined) return { turn: view.turn, k: 'vote', side: random() < .5 ? 0 : 1 };
  const others = view.final?.entries.filter(e => e.id !== me.mine) ?? [];
  if (view.phase === 'final-vote' && !me.picks && others.length)
    return { turn: view.turn, k: 'picks', picks: Array.from({ length: FINAL_VOTES }, () => others[Math.floor(random() * others.length)]!.id) };
  return null;
};
export default bot;
