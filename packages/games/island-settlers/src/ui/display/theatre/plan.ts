/**
 * The theatre's one animation queue (EXPERIENCE §3.6–3.7), as pure data. Each animated event becomes
 * a Beat with a start time; beats play one after another in event-id order, like acts in a play.
 * Everything is in server ms so a paused or jumped clock freezes or scrubs every animation.
 */
import { pips } from '../../../geometry';
import {
  GOODS, type GameEvent, type Good, type Grant, type PublicView, type SeatId, type TileId,
} from '../../../model';
import { BACKLOG_MS, ROLL_MS } from '../../shared/timeline';

/** Fly-out tuning (EXPERIENCE §3.7 and §6). */
export const FLY = { ms: 480, stagger: 40, cap: 14, lift: 80 } as const;
/** "+n" seat chip: in, hold, out. */
export const GAIN = { in: 160, hold: 1600, out: 240 } as const;
export const STEAL_MS = 600;
export const PING_MS = 500;
/** Robber hop length on the scene; the landing ping starts after it. */
export const HOP_MS = 520;

export type Origin = { tile: TileId } | { bank: true } | { seat: SeatId };
export type Flight = {
  key: string; seat: SeatId; goods: { good: Good; amount: number }[]; from: Origin;
  /** ms after the beat start. */
  delay: number; ms: number; faceDown?: true;
};
export type Beat = {
  /** start is Infinity until the queue places it. */
  event: GameEvent; start: number;
  /** Time the beat holds the queue. */
  ms: number;
  /** Time until its last visual (chips, pings) is gone. */
  life: number;
  flights: Flight[];
};

const ANIMATED = new Set<GameEvent['kind']>(['roll', 'payout', 'take', 'steal', 'robber']);
export const animated = (e: GameEvent) => ANIMATED.has(e.kind);

type Pair = { seat: SeatId; good: Good; amount: number; tile: TileId | null; pips: number };
type Group = { seat: SeatId; goods: { good: Good; amount: number }[]; best: Pair };

/** Groups pairs by key, summing amounts per good and keeping the highest-pip hex as the origin. */
function group(list: Pair[], key: (p: Pair) => string): Group[] {
  const out = new Map<string, Group>();
  for (const p of list) {
    const g = out.get(key(p)) ?? out.set(key(p), { seat: p.seat, goods: [], best: p }).get(key(p))!;
    const same = g.goods.find(x => x.good === p.good);
    if (same) same.amount += p.amount;
    else g.goods.push({ good: p.good, amount: p.amount });
    if (p.pips > g.best.pips) g.best = p;
  }
  return [...out.values()];
}

/**
 * One flight per (seat, good) from its highest-pip hex; past the cap, one merged flight per seat.
 * The stagger shrinks so the last card still lands inside `window` (≤ 1.5 s from the roll).
 */
export function batch(pairs: Pair[], order: SeatId[], start: number, window: number): Flight[] {
  const rank = (s: SeatId) => (order.includes(s) ? order.indexOf(s) : order.length);
  const list = pairs.filter(p => p.amount > 0)
    .sort((a, b) => rank(a.seat) - rank(b.seat) || GOODS.indexOf(a.good) - GOODS.indexOf(b.good));
  let groups = group(list, p => `${p.seat}:${p.good}`);
  if (groups.length > FLY.cap) groups = group(list, p => p.seat);
  const stagger = groups.length > 1 ? Math.min(FLY.stagger, window / (groups.length - 1)) : 0;
  return groups.map((g, i) => ({
    key: `${g.seat}:${g.goods.map(x => x.good).join('+')}`, seat: g.seat, goods: g.goods,
    from: g.best.tile ? { tile: g.best.tile } : { bank: true }, delay: start + i * stagger, ms: FLY.ms,
  }));
}

const tilePips = (pub: PublicView, id: TileId) =>
  pips(pub.pieces.reveals[id]?.number ?? pub.board.tiles.find(t => t.id === id)?.number ?? 0);
const pairs = (pub: PublicView, grants: Grant[]): Pair[] =>
  grants.map(g => ({ ...g, pips: tilePips(pub, g.tile) }));

const flightsOf = (e: GameEvent, pub: PublicView): Flight[] => {
  const order = pub.seats.map(s => s.id);
  const room = ROLL_MS.settle - ROLL_MS.flyStart - FLY.ms;
  switch (e.kind) {
    case 'roll': return batch(pairs(pub, e.grants), order, ROLL_MS.flyStart, room);
    case 'payout': return batch(pairs(pub, e.grants), order, 0, room);
    case 'take': return batch(GOODS.filter(g => (e.cards[g] ?? 0) > 0)
      .map(good => ({ seat: e.seat, good, amount: e.cards[good] ?? 0, tile: null, pips: 0 })), order, 0, room);
    case 'steal': return [{
      key: `steal:${e.id}`, seat: e.seat, goods: [], from: { seat: e.victim }, delay: 0, ms: STEAL_MS,
      faceDown: true,
    }];
    default: return [];
  }
};

/** Landing time of the last flight, relative to the beat start. */
const landed = (flights: Flight[]) => Math.max(0, ...flights.map(f => f.delay + f.ms));

export function toBeat(event: GameEvent, pub: PublicView): Beat {
  const flights = flightsOf(event, pub), chips = GAIN.in + GAIN.hold + GAIN.out;
  if (event.kind === 'roll') {
    const life = Math.max(ROLL_MS.settle, landed(flights) + chips);
    return { event, start: Infinity, ms: ROLL_MS.settle, life, flights };
  }
  if (event.kind === 'robber') return { event, start: Infinity, ms: HOP_MS, life: HOP_MS + PING_MS, flights };
  const ms = Math.max(landed(flights), 1);
  return { event, start: Infinity, ms, life: ms + (event.kind === 'steal' ? 0 : chips), flights };
}

/**
 * Adds fresh events to the queue at `now`. Beats already finished keep playing their tails. If the
 * unplayed work would exceed BACKLOG_MS, the oldest beats jump to their end state (their start moves
 * back so they read as finished) and the rest play in order from now.
 */
export function enqueue(beats: Beat[], fresh: GameEvent[], pub: PublicView, now: number): Beat[] {
  const done = beats.filter(b => b.start + b.ms <= now);
  const added = fresh.filter(animated).map(e => toBeat(e, pub));
  const queue = [...beats.filter(b => b.start + b.ms > now), ...added];
  const left = (b: Beat) => (b.start <= now ? b.start + b.ms - now : b.ms);
  while (queue.length > 1 && queue.reduce((sum, b) => sum + left(b), 0) > BACKLOG_MS) {
    const oldest = queue.shift()!;
    done.push({ ...oldest, start: now - oldest.ms });
  }
  let cursor = now;
  return [...done, ...queue.map(b => {
    const start = b.start <= now ? b.start : cursor;
    cursor = start + b.ms;
    return start === b.start ? b : { ...b, start };
  })];
}

/** Drops beats whose last visual is over. Returns the same array when nothing changed. */
export function prune(beats: Beat[], now: number): Beat[] {
  const kept = beats.filter(b => now < b.start + b.life);
  return kept.length === beats.length ? beats : kept;
}

/** The newest roll beat, if any. */
export const lastRollBeat = (beats: Beat[]) =>
  beats.filter(b => b.event.kind === 'roll').sort((a, b) => b.event.id - a.event.id)[0] ?? null;
