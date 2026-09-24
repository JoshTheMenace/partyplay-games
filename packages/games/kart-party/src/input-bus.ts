/* In-page channel from the controller (which sends held input to the room) to the scene (which
 * predicts the local kart from exactly the same inputs). Browser-only; one page = one player. */
import type { Input } from './sim/types';
type Listener = (input: Input, atMs: number) => void;
const listeners = new Set<Listener>();
let last: Input | null = null;
export const inputBus = {
  /** Call with every complete input passed to setInput (and the neutral input on release). */
  publish(input: Input, atMs = performance.now()) { last = input; for (const listener of listeners) listener(input, atMs); },
  subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  last: () => last,
};
