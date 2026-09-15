import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { COLOR_GROUPS, cardName } from './cards';
import type { Color } from './cards';
import type { Action, CardSet, Phase, PrivateView, PublicView, Settings } from './types';

export const SEATS = 4, HAND = 8;
export const delays = { draw: 1000, discard: 800 } as const;
const BOT_COLOR = '#c97f35';
const BOT_NAMES = [
  'Soupmaster General', 'Boil McBoilface', 'The Ladle', 'Broth Vader', 'Sir Simmers-a-Lot', 'Chef Hotpockets',
  'Noodlina Jolie', 'Brothy McBrothface', 'Steamy McSteamface', 'The Fondue', 'Wonton Destructo', 'Shabu Khan',
];
export type State = {
  roundId: string; seed: number; seats: { id: string | null; name: string; color: string; bot: boolean }[];
  hands: number[][]; piles: number[][]; away: Set<string>; phase: Phase; start: number; current: number;
  round: number; turn: number; turnId: string; drawn: number | null; botAt: number;
  winner: number | null; sets: CardSet[] | null; log: { n: number; text: string }[]; logCount: number;
};
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function exact(raw: Record<string, unknown>, keys: string[]) {
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected field.');
}
function finite(now: number) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid clock.');
}
const isCard = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 24;
function parseAction(raw: unknown): Action {
  const value = record(raw);
  if (typeof value.turnId !== 'string' || !value.turnId.length || value.turnId.length > 200) throw new Error('Missing turn identifier.');
  if (value.type === 'draw') {
    exact(value, ['type', 'turnId', 'from']);
    if (value.from === 'deck' || Number.isInteger(value.from) && (value.from as number) >= 0 && (value.from as number) < SEATS) return { type: 'draw', turnId: value.turnId, from: value.from as 'deck' | number };
    throw new Error('Draw from the deck or a discard pile.');
  }
  if (value.type === 'discard') {
    exact(value, ['type', 'turnId', 'card']);
    if (isCard(value.card)) return { type: 'discard', turnId: value.turnId, card: value.card };
    throw new Error('Choose a card to discard.');
  }
  throw new Error('Unknown action.');
}
function validateSettings(raw: unknown): Settings {
  exact(record(raw), []);
  return {};
}
/** Backtracking partition: the lowest remaining card must be in a triple of itself or its color set. */
export function detectSets(hand: readonly number[]): CardSet[] | null {
  if (hand.length !== 9 || !hand.every(isCard)) return null;
  const counts = Array<number>(25).fill(0);
  for (const id of hand) counts[id]++;
  function solve(sets: CardSet[]): CardSet[] | null {
    const id = counts.findIndex(count => count > 0);
    if (id < 0) return sets;
    if (counts[id] >= 3) {
      counts[id] -= 3;
      const found = solve([...sets, { type: 'triple', cardId: id, cards: [id, id, id] }]);
      counts[id] += 3;
      if (found) return found;
    }
    const [color, group] = Object.entries(COLOR_GROUPS).find(([, ids]) => (ids as readonly number[]).includes(id))!;
    if (group.every(card => counts[card] > 0)) {
      for (const card of group) counts[card]--;
      const found = solve([...sets, { type: 'color', color: color as Color, cards: [...group] }]);
      for (const card of group) counts[card]++;
      if (found) return found;
    }
    return null;
  }
  return solve([]);
}
function random(state: State) {
  let seed = state.seed;
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  state.seed = seed >>> 0;
  return state.seed / 4294967296;
}
const deal = (state: State) => 1 + Math.floor(random(state) * 24);
const automated = (state: State) => { const seat = state.seats[state.current]; return seat.bot || state.away.has(seat.id!); };
function log(state: State, text: string) {
  state.log.push({ n: ++state.logCount, text });
  if (state.log.length > 8) state.log.shift();
}
function setPhase(state: State, phase: Exclude<Phase, 'won'>, now: number) {
  state.phase = phase;
  state.turnId = `${state.roundId}:${state.turn}:${phase}`;
  state.botAt = automated(state) ? now + delays[phase] : Infinity;
}
function beginTurn(state: State, now: number) {
  state.turn++;
  state.drawn = null;
  setPhase(state, 'draw', now);
}
function draw(state: State, from: 'deck' | number, now: number) {
  const seat = state.seats[state.current];
  if (from === 'deck') {
    state.drawn = deal(state);
    log(state, `${seat.name} drew from the deck`);
  } else {
    if (!state.piles[from].length) throw new Error('That pile is empty.');
    state.drawn = state.piles[from].pop()!;
    log(state, from === state.current ? `${seat.name} took back their ${cardName(state.drawn)}` : `${seat.name} took ${state.seats[from].name}’s ${cardName(state.drawn)}`);
  }
  const hand = [...state.hands[state.current], state.drawn];
  const sets = detectSets(hand);
  if (!sets) return setPhase(state, 'discard', now);
  state.hands[state.current] = hand;
  Object.assign(state, { drawn: null, phase: 'won', winner: state.current, sets, turnId: `${state.roundId}:won`, botAt: Infinity });
  log(state, `${seat.name} wins with three sets!`);
}
function discard(state: State, card: number, now: number) {
  const hand = [...state.hands[state.current], state.drawn!];
  const index = hand.indexOf(card);
  if (index < 0) throw new Error('You do not hold that card.');
  hand.splice(index, 1);
  state.hands[state.current] = hand;
  state.piles[state.current].push(card);
  log(state, `${state.seats[state.current].name} discarded ${cardName(card)}`);
  state.current = (state.current + 1) % SEATS;
  if (state.current === state.start) state.round++;
  beginTurn(state, now);
}
function create(ctx: RoundContext, settings: Settings): State {
  finite(ctx.nowMs);
  validateSettings(settings);
  if (!Number.isInteger(ctx.seed) || !ctx.roundId || ctx.roundId.length > 128) throw new Error('Invalid round context.');
  if (ctx.players.length < 1 || ctx.players.length > SEATS || new Set(ctx.players.map(p => p.id)).size !== ctx.players.length || ctx.players.some(p => !p.id || p.id.length > 128)) throw new Error('Hotpot seats 1–4 distinct players.');
  const state: State = {
    roundId: ctx.roundId, seed: (ctx.seed >>> 0) || 0x9e3779b9, seats: ctx.players.map(({ id, name, color }) => ({ id, name, color, bot: false })),
    hands: [], piles: [], away: new Set(), phase: 'draw', start: 0, current: 0, round: 1, turn: 0, turnId: '', drawn: null, botAt: Infinity,
    winner: null, sets: null, log: [], logCount: 0,
  };
  const names = BOT_NAMES.filter(name => !ctx.players.some(p => p.name === name));
  while (state.seats.length < SEATS) state.seats.push({ id: null, name: names.splice(Math.floor(random(state) * names.length), 1)[0], color: BOT_COLOR, bot: true });
  state.hands = state.seats.map(() => Array.from({ length: HAND }, () => deal(state)));
  state.piles = state.seats.map(() => []);
  state.start = state.current = Math.floor(random(state) * SEATS);
  log(state, `${state.seats[state.start].name} goes first`);
  beginTurn(state, ctx.nowMs);
  return state;
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings, parseAction,
  parseInput(raw) { if (raw !== null) throw new Error('This game uses actions only.'); return null; },
  neutralInput: () => null, create,
  applyAction(state, playerId, raw, now) {
    finite(now);
    const action = parseAction(raw);
    const seat = state.seats.findIndex(s => s.id === playerId);
    if (seat < 0) throw new Error('Only seated players can act.');
    if (state.phase === 'won') throw new Error('The game is over.');
    if (action.turnId !== state.turnId) throw new Error('That turn has already moved on.');
    if (seat !== state.current) throw new Error('It is not your turn.');
    if (action.type !== state.phase) throw new Error(action.type === 'draw' ? 'You already drew this turn.' : 'Draw a card first.');
    if (action.type === 'draw') draw(state, action.from, now);
    else discard(state, action.card, now);
  },
  tick(state, _inputs, _dt, now) {
    finite(now);
    // A bot draw and discard are two steps; the bound only guards against a long server stall.
    for (let step = 0; step < SEATS * 2 && state.phase !== 'won' && now >= state.botAt; step++) {
      const at = state.botAt;
      if (state.phase === 'draw') draw(state, 'deck', at);
      else discard(state, [...state.hands[state.current], state.drawn!][Math.floor(random(state) * (HAND + 1))], at);
    }
  },
  onPresenceChange(state, playerId, connected, now) {
    const seat = state.seats.findIndex(s => s.id === playerId);
    if (seat < 0 || state.away.has(playerId) !== connected) return;
    if (connected) state.away.delete(playerId); else state.away.add(playerId);
    if (state.phase === 'won') return;
    log(state, connected ? `${state.seats[seat].name} is back` : `${state.seats[seat].name} left — a bot is covering`);
    if (seat === state.current) state.botAt = connected ? Infinity : now + delays[state.phase];
  },
  publicView(state) {
    return {
      turnId: state.turnId, phase: state.phase, round: state.round, current: state.current, winner: state.winner,
      sets: state.sets && state.sets.map(set => ({ ...set, cards: [...set.cards] })), log: state.log.map(entry => ({ ...entry })),
      seats: state.seats.map((seat, i) => ({
        ...seat, away: seat.id !== null && state.away.has(seat.id), handSize: state.hands[i].length, pile: [...state.piles[i]],
        ...(state.phase === 'won' ? { hand: [...state.hands[i]] } : {}),
      })),
    };
  },
  playerView(state, playerId) {
    const seat = state.seats.findIndex(s => s.id === playerId);
    if (seat < 0) return null;
    return { turnId: state.turnId, seat, hand: [...state.hands[seat]], drawn: seat === state.current ? state.drawn : null };
  },
  outcome(state) {
    const complete = state.phase === 'won';
    const winnerId = complete ? state.seats[state.winner!].id : null;
    return {
      complete, winners: winnerId ? [winnerId] : [],
      rows: state.seats.flatMap(seat => seat.id ? [{ playerId: seat.id, ...(complete ? { rank: seat.id === winnerId ? 1 : 2 } : {}) }] : []),
    };
  },
  dispose() {},
};
export default rules;
