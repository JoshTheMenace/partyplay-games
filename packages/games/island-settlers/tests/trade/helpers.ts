/** Trade test helpers: reach a trading stage and deal exact hands (conservation-safe). */
import assert from 'node:assert/strict';
import type { Cards, GameEvent, Settings } from '../../src/model';
import { transfer } from '../../src/engine/cards';
import type { State } from '../../src/engine/state';
import { act, edit, game, inventory, pastSetup, rig } from '../helpers';

/** Past setup, rolled a 5: Standard main step (or the Connect window). */
export function trading(seats: number, settings: Partial<Settings> = {}) {
  const s = game(seats, settings);
  pastSetup(s);
  rig(s, [2, 3]);
  act(s, s.turn.active!, { type: 'roll' });
  assert.equal(s.turn.stage, settings.mode === 'connect' ? 'round' : 'main');
  return s;
}

/** Every hand back to the bank, then these hands from the bank. */
export const deal = (s: State, hands: Record<string, Cards>) => edit(s, n => {
  for (const id of n.order) transfer(n.seats[id].hand, n.bank, { ...n.seats[id].hand });
  for (const [id, cards] of Object.entries(hands)) transfer(n.bank, n.seats[id].hand, cards);
});

/** Active seat first, then the rest in seating order. */
export const seats = (s: State) => {
  const i = s.order.indexOf(s.turn.active!);
  return [...s.order.slice(i), ...s.order.slice(0, i)];
};

export const hand = (s: State, id: string) =>
  Object.fromEntries(Object.entries(s.seats[id].hand).filter(([, n]) => n > 0));

export const eventsOf = <K extends GameEvent['kind']>(s: State, kind: K) =>
  s.events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);

/** Runs `fn` and asserts bank + hands hold the same cards afterwards. */
export function conserved(s: State, fn: () => void) {
  const before = inventory(s);
  fn();
  assert.deepEqual(inventory(s), before, 'goods are conserved');
}
