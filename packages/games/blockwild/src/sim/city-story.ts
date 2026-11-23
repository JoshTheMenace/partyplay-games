/**
 * Errands and the funfair. A character is spoken to like anybody else (`interact` with their id); what they say is
 * the client's to show (shared/city/story.ts holds every line), so the server only keeps who is being talked to, the
 * errand in hand and the count it started from. The stalls pay in tickets; the prize booth swaps tickets for prizes.
 */
import { HATS, ownedValue } from '../shared/city/economy';
import { STAMP, hasStamp, stampCount } from '../shared/city/passport';
import { CHARACTERS, standings, stepOf, withStep, type Count } from '../shared/city/story';
import { addItem, countItem } from '../shared/inventory';
import { I, itemName } from '../shared/items';
import { repAdd, stamp } from './city-career';
import { bizValue } from './city-jobs';
import { news, seatOf, type CityPlayer } from './city-state';
import { earn } from './city-watch';
import { addFx, toast, type Player, type State } from './state';

const TALK_REACH = 7;
const featherCount = (feathers: readonly number[]) => { let n = 0; for (const half of feathers) for (let bits = half; bits; bits &= bits - 1) n++; return n; };
/** What an errand's count stands at for a seat right now. */
function tally(state: State, cp: CityPlayer, count: Count): number {
  if ('stamp' in count) return hasStamp(cp.stamps, STAMP[count.stamp] ?? -1) ? 1 : 0;
  switch (count.stat) {
    case 'feathers': return featherCount(cp.feathers);
    case 'worth': return cp.coins + ownedValue(cp.own, cp.flat, cp.plot, bizValue(state, cp));
    case 'biz': return cp.biz.length;
    case 'stamps': return stampCount(cp.stamps);
    default: return Math.floor(cp.stats[count.stat]);
  }
}
/** Counts that are what they are whenever the errand was taken: a best, a total, something owned. */
const absolute = (count: Count) => 'stamp' in count || count.stat === 'feathers' || count.stat === 'worth' || count.stat === 'biz' || count.stat === 'stamps' || 'total' in count && !!count.total;
/** How far along the errand in hand is: [done, needed], capped at needed. */
export function errandProgress(state: State, cp: CityPlayer): [number, number] | null {
  const errand = cp.errand && CHARACTERS[cp.errand.who]?.errands[cp.errand.step];
  if (!errand || !cp.errand) return null;
  return [Math.max(0, Math.min(errand.n, tally(state, cp, errand.count) - cp.errand.base)), errand.n];
}
/** Walk up to a character and speak: their sheet opens on the player's screen. */
export function talkTo(state: State, player: Player, who: number): boolean {
  const at = standings(state.settings.seed)[who], cp = seatOf(state, player);
  if (!at || !CHARACTERS[who] || cp.ride || Math.hypot(at.x - player.x, at.z - player.z) > TALK_REACH) return false;
  cp.talk = who;
  return true;
}
/** Answer the character being talked to: 0 takes the errand on (or hands a finished one in), anything else ends the talk. */
export function say(state: State, player: Player, answer: number): boolean {
  const cp = seatOf(state, player), who = cp.talk, character = CHARACTERS[who];
  cp.talk = -1;
  if (!character || answer !== 0) return true;
  const step = stepOf(cp.story, who), errand = character.errands[step];
  if (!errand) return true;
  if (cp.errand?.who === who && cp.errand.step === step) {
    const progress = errandProgress(state, cp)!;
    if (progress[0] < progress[1]) return false;
    // Done: paid, in their good books, and on to the next.
    cp.errand = null;
    cp.story = withStep(cp.story, who, step + 1);
    earn(state, player, errand.pay);
    repAdd(cp, character.group, 5);
    addFx(state, 'fanfare', player.x, player.y + 1, player.z);
    toast(player, `${character.name}: ${errand.pay} coins for "${errand.goal}".`);
    if (step + 1 >= character.errands.length) { stamp(state, player, 'story'); news(state, `${player.name} has seen ${character.name}'s errands through`); }
    return true;
  }
  if (cp.errand) { toast(player, `You are on an errand for ${CHARACTERS[cp.errand.who]!.name}. One at a time.`); return false; }
  cp.errand = { who, step, base: absolute(errand.count) ? 0 : tally(state, cp, errand.count) };
  toast(player, `Errand for ${character.name}: ${errand.goal}.`);
  return true;
}
/** Walk off and the talk is over (checked a few times a second). */
export function tickStory(state: State) {
  if (state.ticks % 10) return;
  const at = standings(state.settings.seed);
  for (const player of state.players) {
    const cp = state.city!.players[player.seat]!, who = at[cp.talk];
    if (who && Math.hypot(who.x - player.x, who.z - player.z) > TALK_REACH + 4) cp.talk = -1;
  }
}

// The funfair ----------------------------------------------------------------------------------------------------------
/** A go costs this. Prizes at the booth: [tickets, what]. A hat prize is worn at once. */
export const STALL_COINS = 5;
export const PRIZES: readonly (readonly [tickets: number, item: number, hat?: number])[] = [[6, I.candy_floss], [15, I.plush_gull], [40, 0, 3], [120, 0, 9]];
/**
 * A go on a stall. `timing` is where the player stopped the marker (0..1000). High Striker: the nearer the top, the more
 * tickets. Tin Can Alley: the nearer the middle. Lucky Dip takes no skill at all.
 */
export function playStall(state: State, player: Player, stall: number, timing: number): boolean {
  const cp = seatOf(state, player);
  if (stall < 0 || stall > 2) return false;
  if (cp.coins < STALL_COINS) { toast(player, `A go costs ${STALL_COINS} coins.`); return false; }
  const aim = stall === 0 ? timing / 1000 : stall === 1 ? 1 - Math.abs(timing - 500) / 500 : state.rand();
  const tickets = stall === 2 ? (state.rand() < 0.04 ? 25 : Math.floor(aim * 6)) : aim > 0.94 ? 10 : aim > 0.8 ? 6 : aim > 0.6 ? 3 : aim > 0.35 ? 1 : 0;
  const inv = player.inv.map(slot => slot && { ...slot });
  if (tickets && addItem(inv, I.fair_ticket, tickets) > 0) { toast(player, 'Your pockets are full.'); return false; }
  cp.coins -= STALL_COINS;
  player.inv.splice(0, inv.length, ...inv);
  addFx(state, tickets >= 6 ? 'fanfare' : 'ding', player.x, player.y + 1.5, player.z);
  toast(player, tickets >= 10 ? `Top marks! ${tickets} tickets.` : tickets ? `${tickets} ticket${tickets > 1 ? 's' : ''}.` : 'Nothing this time. Have another go.');
  return true;
}
/** Swap tickets for prize `index` at the booth. */
export function takePrize(state: State, player: Player, index: number): boolean {
  const cp = seatOf(state, player), prize = PRIZES[index];
  if (!prize) return false;
  const [cost, item, hat] = prize, have = countItem(player.inv, I.fair_ticket);
  if (have < cost) { toast(player, `That takes ${cost} tickets. You have ${have}.`); return false; }
  const inv = player.inv.map(slot => slot && { ...slot });
  let left = cost;
  for (let k = 0; k < inv.length && left > 0; k++) { const slot = inv[k]; if (slot?.id !== I.fair_ticket) continue; const take = Math.min(left, slot.n); left -= take; inv[k] = slot.n > take ? { ...slot, n: slot.n - take } : null; }
  if (item && addItem(inv, item, 1) > 0) { toast(player, 'Your pockets are full.'); return false; }
  player.inv.splice(0, inv.length, ...inv);
  if (hat !== undefined) cp.hat = hat;
  toast(player, hat !== undefined ? `A ${HATS[hat]!.name.toLowerCase()}, won fair and square. It is on your head.` : `A ${itemName(item)}!`);
  addFx(state, 'fanfare', player.x, player.y + 1.5, player.z);
  stamp(state, player, 'fair');
  return true;
}
