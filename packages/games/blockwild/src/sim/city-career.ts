/**
 * A seat's standing in Caper City: passport stamps, reputation with the city's three crowds and what both are worth.
 * Everything here is a handful of saved integers per player (sim/city-state.ts packs them); nothing is stored for the world.
 */
import { shopPrice } from '../shared/city/economy';
import { hasStamp, STAMP, stampCount, STAMPS, titleFor } from '../shared/city/passport';
import type { Career } from '../shared/protocol';
import { news, packBiz, packLook, packRep, seatOf, type CityPlayer } from './city-state';
import { addFx, toast, type Player, type State } from './state';

/** Stamp a seat's passport (once): a few coins, a toast, and a line in the news when it earns a new title. */
export function stamp(state: State, player: Player, key: string): boolean {
  const cp = seatOf(state, player), id = STAMP[key];
  if (id === undefined || hasStamp(cp.stamps, id)) return false;
  const before = titleFor(stampCount(cp.stamps)), entry = STAMPS[id]!;
  cp.stamps[id >> 4]! |= 1 << (id & 15);
  cp.coins += entry.coins;
  cp.stats.earned += entry.coins;
  const count = stampCount(cp.stamps), title = titleFor(count);
  // A stamp earned by something that has just said its own piece ("Resprayed red.") is a second line of that message, not a replacement for it.
  const said = player.toast && player.toast.n > cp.toastN ? player.toast.text.split('\n').slice(-2) : [];
  toast(player, [...said, `Passport stamp: ${entry.title} (+${entry.coins} coins)`].join('\n'));
  addFx(state, 'stamp', player.x, player.y + 1.4, player.z);
  if (title !== before) news(state, `${player.name} is now a ${title} of Caper City (${count} stamps)`);
  return true;
}
/** Move a seat's standing with one of the city's crowds (0..100). */
export function repAdd(cp: CityPlayer, who: number, by: number) { cp.rep[who] = Math.max(0, Math.min(100, cp.rep[who]! + by)); }
/** What the townsfolk charge this seat: less for a friend of the town, more while shopkeepers are wary. */
export const priceFor = (state: State, cp: CityPlayer, price: number) => shopPrice(price, cp.rep[0]!, state.clock < cp.waryUntil);
/** The career as the screens are sent it (in the bag: only when it changes). */
export const careerOf = (cp: CityPlayer): Career => ({ st: [...cp.stamps], fe: [...cp.feathers], story: cp.story, rep: packRep(cp.rep), look: packLook(cp.hat, cp.paint, cp.tuned), biz: packBiz(cp.biz) });
