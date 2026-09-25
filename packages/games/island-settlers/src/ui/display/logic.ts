/** Pure TV HUD rules (EXPERIENCE §3.2–§3.4, §3.10): row sizing, status words, finale, ticker. */
import type {
  GameEvent, GameEventKind, PromptChip, PublicSeat, PublicView, SeatId,
} from '../../model';
import { clockText, secondsLeft } from '../shared/format';
import { STATUS_TEXT } from '../shared/labels';
import { nameOf } from '../shared/seats';

export const RACE_U = 96, TABLE_U = 120, ROW_GAP_U = 6, GAP_U = 8;

/** More than 6 seats: two-line rows, smaller type, no Table card. */
export const dense = (seats: number) => seats > 6;

/** Row height in u: min(168, what is left of the rail after the header, gaps and Table card). */
export function rowHeight(railHeight: number, seats: number) {
  const table = dense(seats) ? 0 : TABLE_U + GAP_U;
  return Math.min(168, (railHeight - RACE_U - GAP_U - table - ROW_GAP_U * (seats - 1)) / seats);
}

/** Setup snake: round 1 forward, round 2 back, and the [row, column] being placed now. */
export function snake(pub: PublicView) {
  const ids = pub.seats.map(s => s.id), setup = pub.turn.setup, col = setup ? ids.indexOf(setup.seat) : -1;
  const at: [number, number] | null = !setup || col < 0 ? null
    : setup.round <= 1 ? [0, col] : [1, ids.length - 1 - col];
  return { rows: [ids, [...ids].reverse()], at };
}

const owed = (pub: PublicView, id: SeatId) => pub.prompts.filter(p => p.seat === id);
const offline = (seat: PublicSeat) => !seat.connected || seat.status === 'offline';

/** Line 3 / dense status words: "Discarding 4", "Offline: auto-plays in 0:42", "Thinking…". */
export function statusText(pub: PublicView, seat: PublicSeat, now: number) {
  if (offline(seat)) {
    return seat.deadline ? `Offline: auto-plays in ${clockText(secondsLeft(seat.deadline, now))}` : 'Offline';
  }
  const chips = owed(pub, seat.id);
  const words = (c: PromptChip) => (c.kind === 'discard' && c.count ? `${c.label} ${c.count}` : c.label);
  if (chips.length) return chips.map(words).join(' · ');
  // "Playing" adds nothing: the active row is filled and the banner names the step.
  if (seat.status === 'acting' || (seat.status === 'ready' && pub.turn.stage !== 'round')) return '';
  return STATUS_TEXT[seat.status];
}

export type StatusBadge = { kind: 'offline' | 'owed' | 'thinking' | 'ready'; count: number | null };

/** The 22u badge on the chip: offline plug, owed prompt (with its count), CPU dots, Connect done. */
export function statusBadge(pub: PublicView, seat: PublicSeat): StatusBadge | null {
  if (offline(seat)) return { kind: 'offline', count: null };
  const chips = owed(pub, seat.id);
  if (chips.length) return { kind: 'owed', count: chips[0].count };
  if (seat.status === 'thinking') return { kind: 'thinking', count: null };
  const done = seat.status === 'ready' || (pub.turn.stage === 'round' && seat.ready);
  if (done) return { kind: 'ready', count: null };
  return null;
}

/** Chips beside the banner title: the one or two seats the headline is about. */
export function bannerSeats(pub: PublicView): SeatId[] {
  if (pub.results) return pub.results.winners.slice(0, 2);
  if (pub.now.seats.length > 0 && pub.now.seats.length <= 2) return pub.now.seats;
  return pub.turn.stage === 'round' || !pub.turn.active ? [] : [pub.turn.active];
}

/** The deadline the banner counts down: the table clock, else the earliest open prompt. */
export function bannerDeadline(pub: PublicView): number | null {
  if (pub.turn.stage === 'finale' || pub.turn.stage === 'ended') return null;
  const prompts = pub.prompts.map(p => p.deadline).filter((d): d is number => d !== null);
  return pub.clock?.deadline ?? (prompts.length ? Math.min(...prompts) : null);
}

/** Open prompts per seat ("who are we waiting for"), in seat order. */
export function waiting(pub: PublicView) {
  return pub.seats.map(s => ({ seat: s.id, chips: owed(pub, s.id) })).filter(w => w.chips.length > 0)
    .map(w => ({ seat: w.seat, count: w.chips.reduce((sum, c) => sum + (c.count ?? 0), 0) || null,
      label: `${nameOf(pub, w.seat)}: ${w.chips.map(c => c.label).join(', ')}` }));
}

/** Finale reveal slots (EXPERIENCE §3.10); the theatre flips its cards on the same schedule. */
export const REVEAL = { start: 800, step: 500, stepDense: 300 } as const;

/**
 * Finale on the rail: each seat's total (hidden VP included) shows from the start of its slot, in seat order,
 * then the rail re-sorts by rank with rank numerals. Reduced motion shows the final state at 0.8 s.
 */
export function finale(pub: PublicView, now: number, reduced: boolean) {
  const results = pub.results;
  if (!results) return null;
  const t = now - results.finaleAt - REVEAL.start;
  const step = dense(pub.seats.length) ? REVEAL.stepDense : REVEAL.step;
  const final = new Map(results.standings.map(s => [s.seat, s]));
  const shown = (i: number) => t >= (reduced ? 0 : i * step);
  const total = (id: SeatId, vp: number) => final.get(id)?.vp ?? vp;
  const vp = Object.fromEntries(pub.seats.map((s, i) => [s.id, shown(i) ? total(s.id, s.vp) : s.vp]));
  const rank = (id: SeatId) => final.get(id)?.rank ?? pub.seats.length, sorted = shown(pub.seats.length);
  const order = pub.seats.map(s => s.id);
  if (sorted) order.sort((a, b) => rank(a) - rank(b));
  return { vp, order, ranks: sorted ? Object.fromEntries(order.map(id => [id, rank(id)])) : null };
}

/** Kinds the ticker skips: offers have the trade rail, turns the banner, move steps are too chatty. */
const QUIET = new Set<GameEventKind>(['offer', 'turn', 'move']);

export const eventSeat = (e: GameEvent): SeatId | null =>
  e.kind === 'win' ? e.seats[0] ?? null : 'seat' in e ? e.seat : null;

/** The three newest public events, newest first. */
export const tickerEvents = (events: GameEvent[]) =>
  events.filter(e => !QUIET.has(e.kind)).slice(-3).reverse();
