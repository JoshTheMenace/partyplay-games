/** Room awards at the end of an archipelago game (the league's own titles; they score nothing). */
import type { SeatId, SeatStats } from '../model';
import type { LeagueAward } from '../wire';
import type { League } from './index';

const TITLES: { key: string; title: string; pick: (s: SeatStats) => number; unit: [string, string] }[] = [
  { key: 'harvest', title: 'Harvest Monarch', pick: s => s.produced, unit: ['card from rolls', 'cards from rolls'] },
  { key: 'market', title: 'Market Maven', pick: s => s.trades, unit: ['trade with players', 'trades with players'] },
  { key: 'warden', title: 'Road Warden', pick: s => s.longestRoute, unit: ['piece in one route', 'pieces in one route'] },
  { key: 'fingers', title: 'Light Fingers', pick: s => s.stole, unit: ['card stolen', 'cards stolen'] },
  { key: 'magnet', title: "Robber's Favourite", pick: s => s.robbed, unit: ['card lost to thieves', 'cards lost to thieves'] },
];

/** One line per title that somebody earned; up to three seats share a tie. */
export function awards(l: League): LeagueAward[] {
  const seats = l.islands.flatMap(s => s.order.map(id => ({ id, stats: s.stats.seats[id] })));
  return TITLES.flatMap(({ key, title, pick, unit }) => {
    const best = Math.max(0, ...seats.map(x => pick(x.stats)));
    const top: SeatId[] = seats.filter(x => pick(x.stats) === best).map(x => x.id);
    return best > 0 && top.length <= 3 ? [{ key, title, text: `${best} ${unit[best === 1 ? 0 : 1]}`, seats: top }] : [];
  });
}
