/* Comment Section bot (tests and QA only): answers sincerely, twists with silly context (a quarter of texts run to the limit so
   QA sees worst cases), sometimes lets the house write its twist, and votes for random posts that aren't its own twist. */
import type { MiniBot } from '../../core/contract';
import { MAX_ANSWER, MAX_TWIST, ROUNDS, type CommentPrivate, type CommentPublic } from './types';

const FEELINGS = ['I love it more every single day', 'Honestly it takes way too long', 'My whole family gets involved', 'I do it twice before breakfast', 'It is messy but worth it'];
const EXTRAS = [', and the neighbours have started to notice', ' if I’m honest with myself', ' every Tuesday', ' with a little help from Mum', ', twice'];
const THINGS = ['A haunted canoe', 'Goose wrangling lessons', 'Grandad’s secret soup', 'Bulk pickled eggs', 'A tiny sad trombone', 'Llama wedding'];
const MORE = [' for absolute beginners', ' (do not try at home)', ' in the bath', ', part two', ' again'];

/** Whole clauses up to the limit, so long texts end cleanly. */
const grow = (base: string, parts: readonly string[], max: number) => parts.reduce((text, part) => text.length + part.length <= max ? text + part : text, base);

export const bot: MiniBot<CommentPublic, CommentPrivate> = ({ view, me, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const any = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!, turn = view.turn, long = random() < .25;
  if (view.phase === 'answer' && me.question && me.answer === undefined) return { turn, k: 'answer', text: long ? grow(any(FEELINGS), EXTRAS, MAX_ANSWER) : any(FEELINGS) };
  if (view.phase === 'twist' && me.target && me.twist === undefined) {
    if (random() < .1) return { turn, k: 'auto' };
    return { turn, k: 'twist', text: long ? grow(any(THINGS), MORE, MAX_TWIST) : any(THINGS) };
  }
  if (view.phase === 'vote' && !me.votes) {
    const others = (view.posts ?? []).filter(p => p.id !== me.mine).map(p => p.id);
    if (!others.length) return null;
    const max = Math.min(ROUNDS[view.round - 1]!.votes, others.length), first = any(others), rest = others.filter(id => id !== first);
    return { turn, k: 'vote', posts: max > 1 && rest.length && random() < .8 ? [first, any(rest)] : [first] };
  }
  return null;
};
export default bot;
