/** Public event ring buffer and the private inbox. Ids come from `serial`, so they only go up. */
import { VIEW_LIMITS, type GameEvent, type PrivateEvent, type SeatId } from '../model';
import type { State } from './state';

/** Omit that distributes over the GameEvent union. */
export type EventInput = GameEvent extends infer E ? E extends GameEvent ? Omit<E, 'id' | 'at'> : never : never;

export function emit(s: State, event: EventInput): GameEvent {
  const full = { ...event, id: ++s.serial, at: s.now } as GameEvent;
  s.events.push(full);
  if (s.events.length > VIEW_LIMITS.events) s.events.splice(0, s.events.length - VIEW_LIMITS.events);
  return full;
}

export function inbox(s: State, seat: SeatId, event: Omit<PrivateEvent, 'id' | 'at'>) {
  const list = s.seats[seat].inbox;
  list.push({ ...event, id: ++s.serial, at: s.now });
  if (list.length > VIEW_LIMITS.inbox) list.splice(0, list.length - VIEW_LIMITS.inbox);
}
