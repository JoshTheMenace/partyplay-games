/** Shared test harness (BUILD-PLAN §4.1). Every mutation goes through the engine's commit path. */
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import {
  GOODS, SEAT_COLORS, type Action, type CardPicks, type Cards, type Good, type Picks, type PromptKind, type Settings,
} from '../src/model';
import { rules } from '../src/server';
import { commit } from '../src/engine/actions';
import { dueAt } from '../src/engine/auto';
import { transfer } from '../src/engine/cards';
import type { State } from '../src/engine/state';

export const START = 1000;
type Loose<A> = A extends Action ? Omit<A, 'turnId'> & { turnId?: number } : never;

/** 16-character names, ids p0…; the table defaults to exactly `seats` seats (at least 3). */
export function game(seats: number, settings: Partial<Settings> = {}, seed = 1234, now = START): State {
  const players = Array.from({ length: seats }, (_, i) => ({
    id: `p${i}`, name: `Player ${i}`.padEnd(16, '.'), color: SEAT_COLORS[i],
  }));
  const valid = rules.validateSettings({ tableSize: Math.max(3, seats), ...settings });
  return rules.create({ roomId: 'test', roundId: 'round', seed, nowMs: now, players }, valid);
}

/** parseAction + applyAction with the current turn id (override with `turnId`). */
export function act(s: State, seat: string, action: Loose<Action>, now = s.now) {
  rules.applyAction(s, seat, rules.parseAction({ turnId: s.turn.id, ...action }), now);
}

export const view = (s: State, seat: string) => rules.playerView(s, seat, { nowMs: s.now, phase: 'playing' });
export const pub = (s: State) => rules.publicView(s, { nowMs: s.now, phase: 'playing' });

/** Move cards from the bank to a seat (conservation-safe). */
export const grant = (s: State, seat: string, cards: Cards) =>
  commit(s, s.now, n => transfer(n.bank, n.seats[seat].hand, cards));

/** Run `fn` inside a commit (open prompts, set flags) exactly like engine code would. */
export const edit = (s: State, fn: (n: State) => void, now = s.now) => commit(s, now, fn);

export function answer(s: State, seat: string, kind: PromptKind, picks: Picks = {}, cards: CardPicks = {}) {
  const p = view(s, seat).prompts.find(q => q.kind === kind);
  assert.ok(p, `${seat} has no ${kind} prompt`);
  act(s, seat, { type: 'answer', prompt: p.id, picks, cards });
}

/** Answer `seat`'s robber prompt with its first legal hex (and first victim when a pick is needed). */
export function rob(s: State, seat: string): string {
  const choice = pub(s).robberChoices.find(c => c.seat === seat)!, { tile, victims } = choice.tiles[0];
  const multi = pub(s).robberChoices.filter(c => c.seat === seat).length > 1;
  const picks = { ...(multi ? { piece: choice.piece } : {}), tile, ...(victims.length > 1 ? { victim: victims[0] } : {}) };
  answer(s, seat, 'robber', picks);
  return tile;
}

export const command = (s: State, seat: string, id: string, picks: Picks = {}, cards: CardPicks = {}) =>
  act(s, seat, { type: 'command', command: id, picks, cards });

/** `fn` must throw and leave the state deep-equal. */
export function unchanged(s: State, fn: () => void, message?: RegExp) {
  const before = structuredClone(s);
  if (message) assert.throws(fn, message); else assert.throws(fn);
  assert.deepEqual(s, before);
}

/** Bank + hands per good (module stores join when modules add goods). */
export function inventory(s: State): Record<Good, number> {
  const held = (g: Good) => s.order.reduce((n, id) => n + s.seats[id].hand[g], 0);
  return Object.fromEntries(GOODS.map(g => [g, s.bank[g] + held(g)])) as Record<Good, number>;
}

export function serializable(s: State) {
  assertSerializable(pub(s));
  for (const id of s.order) assertSerializable(view(s, id));
}

export const tick = (s: State, now: number) => rules.tick(s, new Map(), 0.1, now);

/** An injectable clock that tests advance explicitly. */
export function clock(start = START) {
  return { now: start, advance(ms: number) { return (this.now += ms); } };
}

/** Jump from deadline to deadline until `done` holds (timeouts drive the game). */
export function fastForward(s: State, done: (s: State) => boolean, max = 5000) {
  for (let i = 0; i < max && !done(s); i++) {
    const at = dueAt(s);
    assert.ok(Number.isFinite(at), `stalled in ${s.turn.stage}`);
    tick(s, Math.max(at, s.now));
  }
  assert.ok(done(s), 'fastForward gave up');
}

/** Leave setup (auto-placements or skips) and stand at the first roll. */
export const pastSetup = (s: State) => fastForward(s, x => x.turn.stage !== 'setup');

/** The next roll shows `dice`. */
export const rig = (s: State, dice: [number, number]) => edit(s, n => {
  n.diceDeck = [...Array.from({ length: 8 }, () => [1, 2] as [number, number]), dice];
  n.lastTotal = null;
});
