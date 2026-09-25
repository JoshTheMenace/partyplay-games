/**
 * Deadlines: timer presets, disconnect grace and away handling (ENGINE §5–6). Views carry absolute
 * deadlines only, so time passing never changes a view. `base` is the preset deadline; `deadline`
 * is what applies after the disconnect cap.
 */
import { GRACE_SECONDS, TIMERS, type SeatId, type TimedStep } from '../model';
import type { OpenPrompt, State, Timer } from './state';

/** Preset deadline for `step` from now, or null with the Off preset. */
export function baseDeadline(s: State, step: TimedStep): number | null {
  const seconds = TIMERS[s.settings.timer][step];
  return seconds === null ? null : s.now + seconds * 1000;
}

/** A disconnected seat that owes a decision gets at most the grace period (5 s once away). */
export function capped(s: State, id: SeatId, base: number | null): number | null {
  const seat = s.seats[id];
  if (!seat || seat.connected) return base;
  const grace = s.now + 1000 * (seat.away ? GRACE_SECONDS.away : GRACE_SECONDS.disconnected);
  return base === null ? grace : Math.min(base, grace);
}

export function startTimer(s: State, id: SeatId, step: TimedStep, base = baseDeadline(s, step)) {
  s.timers[id] = { step, startedAt: s.now, base, deadline: capped(s, id, base) };
}

export const stopTimer = (s: State, id: SeatId) => { delete s.timers[id]; };

/** Everything with a deadline that `id` owes now. */
const owed = (s: State, id: SeatId): (Timer | OpenPrompt)[] =>
  [...(s.timers[id] ? [s.timers[id]] : []), ...Object.values(s.prompts).filter(p => p.seat === id)];

/** Presence change inside a commit: cap deadlines on disconnect, restore them on reconnect. */
export function setConnected(s: State, id: SeatId, connected: boolean) {
  const seat = s.seats[id];
  seat.connected = connected;
  if (connected) { seat.away = false; seat.autoStreak = 0; }
  for (const item of owed(s, id)) {
    item.deadline = connected
      ? item.base === null ? null : Math.max(item.base, s.now + GRACE_SECONDS.reconnect * 1000)
      : capped(s, id, item.base);
  }
}

/** Earliest deadline this seat must meet now (step or prompt). */
export function seatDeadline(s: State, id: SeatId): number | null {
  const times = owed(s, id).flatMap(item => (item.deadline === null ? [] : [item.deadline]));
  return times.length ? Math.min(...times) : null;
}
