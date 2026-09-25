/**
 * Mission tracks (E&P rulebook "Missions"): each step moves your marker; the points shown next to
 * it count, and the seat furthest along holds the bonus tile (+1 VP, a tie keeps the holder).
 * Pirate lairs fall to the third crew: every involved seat gets 2 gold and a step, then the hero
 * of the battle (die + own crews, ties to more crews, then a reroll) gets one more step and sends
 * one crew home. The gold field then produces and may be built on.
 */
import type { HudItem, Mission, ScorePart, SeatId, TileId } from '../../../model';
import { emit } from '../../events';
import { int } from '../../rng';
import { random, seatName, type State } from '../../state';
import { addCoins, crewCount, ext, lairAt, type Lair } from './state';

/** Points per track position (legacy tracks: 7 steps for lairs and fish, 6 for spices). */
const TRACK: Record<Mission, number[]> = {
  lairs: [0, 1, 1, 2, 2, 2, 3, 3], fish: [0, 1, 1, 2, 2, 2, 3, 3], spices: [0, 1, 1, 2, 2, 3, 3],
};
export const NAMES: Record<Mission, string> =
  { lairs: 'Pirate lairs', fish: 'Fish for Catan', spices: 'Spices for Catan' };
const BONUS: Record<Mission, string> = {
  lairs: 'Greatest Pirate Scourge', fish: 'Best Fisher', spices: 'Greatest Spice Merchant',
};

export const progress = (s: State, seat: SeatId, m: Mission) => ext(s).missions[seat]?.[m] ?? 0;
export const trackLength = (m: Mission) => TRACK[m].length - 1;

/** More steps on this track would still score. */
export const useful = (s: State, seat: SeatId, m: Mission) =>
  s.settings.missions.includes(m) && progress(s, seat, m) < trackLength(m);

export function advance(s: State, seat: SeatId, m: Mission, steps = 1) {
  if (steps <= 0 || !s.settings.missions.includes(m)) return;
  const x = ext(s), mine = (x.missions[seat] ??= {});
  mine[m] = Math.min(trackLength(m), (mine[m] ?? 0) + steps);
  const holder = x.leaders[m];
  if (!holder || mine[m]! > progress(s, holder, m)) x.leaders[m] = seat;
}

export function missionParts(s: State, seat: SeatId): ScorePart[] {
  return s.settings.missions.flatMap(m => {
    const n = progress(s, seat, m), lead = ext(s).leaders[m] === seat;
    const parts: ScorePart[] = [];
    if (n) parts.push({ key: `mission-${m}`, label: NAMES[m], points: TRACK[m][n], count: n });
    if (lead) parts.push({ key: `bonus-${m}`, label: BONUS[m], points: 1, count: 1 });
    return parts;
  });
}

/** Seats clockwise from `first`. */
const clockwise = (s: State, first: SeatId) => {
  const i = Math.max(0, s.order.indexOf(first));
  return [...s.order.slice(i), ...s.order.slice(0, i)];
};

function hero(s: State, lair: Lair, involved: SeatId[]): SeatId {
  const die = random(s, 'dice');
  let tied = involved;
  for (let guard = 0; tied.length > 1 && guard < 50; guard++) {
    const rolls = tied.map(id => ({ id, crews: lair.crews[id], sum: 1 + int(die, 6) + lair.crews[id] }));
    const top = Math.max(...rolls.map(r => r.sum)), best = rolls.filter(r => r.sum === top);
    const most = Math.max(...best.map(r => r.crews));
    tied = best.filter(r => r.crews === most).map(r => r.id);
  }
  return tied[0];
}

/** The third crew landed on `tile`: resolve the capture. */
export function capture(s: State, tile: TileId, active: SeatId) {
  const lair = lairAt(s, tile);
  if (!lair || lair.captured || crewCount(lair) < 3) return;
  const involved = clockwise(s, active).filter(id => (lair.crews[id] ?? 0) > 0);
  for (const id of involved) { addCoins(s, id, 2); advance(s, id, 'lairs'); }
  const top = hero(s, lair, involved);
  advance(s, top, 'lairs');
  lair.crews[top]--;
  Object.assign(lair, { captured: top, at: s.turn.id });
  const face = s.pieces.reveals[tile];
  // The lair token flips to its number disc: the only in-place reveal edit, so mark the map dirty.
  s.pieces.reveals = { ...s.pieces.reveals, [tile]: { ...face, number: s.hidden[tile]?.number ?? 0 } };
  s.mapDirty = true;
  const text = `${involved.map(id => seatName(s, id)).join(', ')} took a lair; ${seatName(s, top)} led it`;
  emit(s, { kind: 'module', module: 'explorers', name: 'lair', seat: top, target: tile, text });
}

/** TV widgets: mission tracks per seat, the pirate ship's owner, fog left. */
export function hudItems(s: State): HudItem[] {
  const x = ext(s), items: HudItem[] = [];
  if (s.settings.missions.length) {
    items.push({ kind: 'table', key: 'missions', label: 'Missions', rows: s.settings.missions.map(m => ({
      label: NAMES[m], max: trackLength(m),
      values: Object.fromEntries(s.order.map(id => [id, progress(s, id, m)])),
    })) });
    for (const m of s.settings.missions) {
      items.push({ kind: 'holder', key: `bonus-${m}`, label: BONUS[m], seat: x.leaders[m] ?? null, icon: m });
    }
  }
  if (s.pieces.pirate) {
    items.push({ kind: 'holder', key: 'pirate', label: 'Pirate ship', seat: x.pirate, icon: 'pirate' });
  }
  const fog = Object.keys(s.hidden).length;
  const found = Object.keys(s.pieces.reveals).filter(t => s.hidden[t]).length;
  if (fog) {
    items.push({ kind: 'track', key: 'fog', label: 'Fog explored', value: found, max: fog, alert: false,
      icon: 'eye' });
  }
  return items;
}
