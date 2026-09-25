/** Seat piece colours (EXPERIENCE §1.6). Index = PublicSeat.seat, which the engine keeps unique 0–9. */
import type { PublicSeat, PublicView, SeatId } from '../../model';
import { EMBLEMS, EMBLEM_NAMES, type EmblemId } from './emblems';

export type SeatStyle = { body: string; dark: string; band: 'dark' | 'mid' | 'light'; emblem: EmblemId };

const row = (body: string, dark: string, band: SeatStyle['band'], i: number): SeatStyle =>
  ({ body, dark, band, emblem: EMBLEMS[i] });

export const SEATS: readonly SeatStyle[] = [
  row('#d8352e', '#a3231e', 'dark', 0), row('#2563d9', '#1a47a0', 'dark', 1),
  row('#3fae47', '#2c7f33', 'mid', 2), row('#8a4fe0', '#6334aa', 'dark', 3),
  row('#ffd23a', '#c9a01c', 'light', 4), row('#ff7ac2', '#d04f93', 'light', 5),
  row('#1fc0ad', '#12887a', 'mid', 6), row('#ff8a1f', '#c96410', 'mid', 7),
  row('#e6ecff', '#aab6d9', 'light', 8), row('#c6dc2c', '#93a61a', 'light', 9),
];

/** Text on any filled seat colour is ink. */
export const SEAT_INK = '#05071a';

export const seatOf = (pub: PublicView, id: SeatId | null | undefined): PublicSeat | undefined =>
  pub.seats.find(seat => seat.id === id);

/** Unknown ids fall back to seat 0 so callers never crash on a stale id. */
export const seatStyle = (pub: PublicView, id: SeatId): SeatStyle =>
  SEATS[(seatOf(pub, id)?.seat ?? 0) % SEATS.length];

export const nameOf = (pub: PublicView, id: SeatId | null | undefined) => seatOf(pub, id)?.name ?? 'Someone';

/** Accessible seat name including the non-colour cue, e.g. "Ana (Triangle)". */
export const seatLabel = (pub: PublicView, id: SeatId) =>
  `${nameOf(pub, id)} (${EMBLEM_NAMES[seatStyle(pub, id).emblem]})`;
