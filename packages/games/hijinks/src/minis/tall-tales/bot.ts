/* Tall Tales bot (tests and QA only): picks a story, writes silly lies (a quarter at the 45-character limit), sometimes asks the
   paper for help, picks a random answer that isn't its own and likes a couple of others. */
import type { MiniBot } from '../../core/contract';
import { LIKES, MAX_LIE, type TallPrivate, type TallPublic } from './types';

const THINGS = ['rubber ducks', 'old bathtubs', 'cheese wheels', 'soup spoons', 'garden gnomes', 'bowling pins', 'pickle jars', 'toy trumpets', 'wet socks', 'llama wool', 'bubble wrap', 'tin foil'];
const ODD = ['a very angry goose', 'the mayor', 'a haunted kazoo', 'Tuesday', 'his own moustache', 'a sleepy walrus'];

export const bot: MiniBot<TallPublic, TallPrivate> = ({ view, me, random }) => {
  if (!me || me.turn !== view.turn) return null;
  const any = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!, turn = view.turn;
  if (view.phase === 'pick' && me.chooser && view.picked === undefined) return { turn, k: 'pick', index: Math.floor(random() * (view.cats?.length ?? 1)) };
  if (view.phase === 'write' && me.lie === undefined) {
    if (me.offers) return { turn, k: 'house', index: random() < .5 ? 0 : 1 };
    if (random() < .12) return { turn, k: 'help' };
    // A quarter of lies run to the 45-character limit so QA screenshots show worst-case text.
    const long = [`${any(THINGS)} borrowed from`, ` ${any(ODD)}`, ' and twelve more', ' on a Sunday', ' twice'].reduce((text, part) => text.length + part.length <= MAX_LIE ? text + part : text);
    return { turn, k: 'lie', text: random() < .25 ? long : any(THINGS) };
  }
  if (view.phase !== 'choose') return null;
  const others = (view.options ?? []).filter(o => !me.mine?.includes(o.id));
  if (!me.choice && others.length) return { turn, k: 'choose', option: any(others).id };
  const likable = others.filter(o => !me.likes?.includes(o.id));
  if ((me.likes?.length ?? 0) < LIKES && likable.length && random() < .08) return { turn, k: 'like', option: any(likable).id, on: true };
  return null;
};
export default bot;
