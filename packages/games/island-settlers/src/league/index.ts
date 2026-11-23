/**
 * The room as a league of islands (server-only). One island for up to ten seats is the engine untouched.
 * A bigger room (or a host who picks it) is dealt onto four-seat islands that play at the same time:
 *
 *   setup on every island ──▶ one roll for the whole room ──▶ every island trades and builds ──▶ the
 *   round closes for everyone ──▶ … until somebody in the room reaches the target at a round's end.
 *
 * Each island is a complete engine State in Connect rounds with its own board, bank and robber. The
 * league only supplies the dice, decides when a round is over for the room, and compares the islands.
 */
import type { Outcome, RoundContext } from '../../../../party-contract/src/index';
import { MAX_ROOM_PLAYERS } from '../../../../party-contract/src/index';
import {
  CONNECT_MIN_OPEN_SECONDS, type Action, type EndReason, type SeatId, type Settings,
} from '../model';
import { ISLAND_NAMES, ISLAND_SEATS, islandCount, islandSettings, islandSizes, type LeagueResults } from '../wire';
import { applyAction, commit, createGame, outcome as islandOutcome, presence } from '../engine/index';
import { total } from '../engine/cards';
import { allReady, end, finish, HORN, hurry, nextRound, roundLimit, sharedRoll } from '../engine/flow';
import { shipMoves } from '../engine/legal';
import { noExtremes } from '../engine/modules/deliveries';
import { hooks } from '../engine/modules/registry';
import { need } from '../engine/need';
import { freshDiceDeck, rollDice, seedWords, sfc32, shuffle } from '../engine/rng';
import { scoreParts, winCheck } from '../engine/score';
import { vpOf } from '../engine/stats';
import { queueEffect, type State } from '../engine/state';
import { awards } from './awards';
import { direct, newDirector, type Director } from './director';

/** Rolls in a round. Every island gets the same dice, one roll at a time, then its window opens. */
export const ROLLS_PER_ROUND = 3;
/** Time between two rolls of a round on one island: long enough to watch each one pay out. */
export const ROLL_GAP_MS = 2400;
/** Pause between a round's end and the next shared roll, so the TV and phones can show both. */
export const ROLL_BEAT_MS = 2600;
/** The first roll waits a little longer: every island has just finished placing. */
export const FIRST_ROLL_MS = 4000;
/** The horn: the share of the room that must be done, and how soon every open window then closes. */
export const HORN_SHARE = HORN.share, HORN_MS = HORN.seconds * 1000;
/** An island whose window opens after the horn (it was resolving a 7) still gets this long. */
export const LATE_WINDOW_MS = 20_000;
/** The league finale: the champion's island stays on the TV this long before results. */
export const LEAGUE_FINALE_MS = 11_000;

export type League = {
  settings: Settings;
  islands: State[];
  names: string[];
  /** Island index of every seat, CPUs included. */
  home: Record<SeatId, number>;
  shared: boolean;
  /** sfc32 words and the balanced deck for the shared roll. */
  rng: number[];
  diceDeck: [number, number][] | null;
  lastTotal: number | null;
  rollAt: number | null;
  /** This round's dice, and per island how many it has rolled and when its next roll may land. */
  dice: { at: number; round: number; rolls: [number, number][] } | null;
  rolled: number[]; rollNext: number[];
  hornAt: number | null;
  /** `standings` (every seat by total points, equal totals sharing a rank) stays on the server. */
  results: (LeagueResults & { standings: Standing[] }) | null;
  startedAt: number;
  director: Director;
  /** Wire bookkeeping (wire.ts): shared revision, per-island change stamps, per-seat sync requests. */
  rev: number; sig: string; view: unknown; cardsAt: number; cards: unknown;
  /** Per island: its seat-view revision and the key that revision stands for. */
  revs: number[]; keys: string[];
  /** Per seat (views.ts `seatView`): the revision being sent in full and how many times so far, the revision
   *  the page last got whole, the shared revision of its last snapshot, snapshots a full view has waited, and
   *  the size of the last private view it was sent. */
  sent: Record<SeatId, { rev: number; times: number; whole: number | null; shared: number; held: number; mine: number }>;
  /** Per island: the engine revision at which idle seats were last looked for. */
  checked: number[];
};

const mix = (seed: number, i: number) => (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;

export function createLeague(ctx: RoundContext, settings: Settings): League {
  const humans = ctx.players.length;
  need(humans >= 1 && humans <= MAX_ROOM_PLAYERS, `Island Settlers seats 1–${MAX_ROOM_PLAYERS} players.`);
  const count = islandCount(humans, settings), shared = count > 1, rng = seedWords(ctx.seed, 'dice');
  need(count <= ISLAND_NAMES.length, 'Too many islands.');
  let islands: State[];
  if (shared) {
    // Dealt by lot, so people who joined together are mixed across the islands.
    const lot = seedWords(ctx.seed, 'cards'), players = shuffle(ctx.players, () => sfc32(lot));
    const sizes = islandSizes(humans, count), rules = islandSettings(settings, true);
    let from = 0;
    islands = sizes.map((n, i) => {
      const seated = players.slice(from, from += n);
      return createGame({ ...ctx, seed: mix(ctx.seed, i), players: seated }, rules, i);
    });
  } else islands = [createGame(ctx, settings)];
  const home: Record<SeatId, number> = {};
  islands.forEach((s, i) => { for (const id of s.order) home[id] = i; });
  return {
    settings, islands, names: islands.map((_, i) => ISLAND_NAMES[i]), home, shared, rng,
    diceDeck: shared && settings.balancedDice ? freshDiceDeck(() => sfc32(rng)) : null, lastTotal: null,
    rollAt: null, dice: null, rolled: islands.map(() => 0), rollNext: islands.map(() => 0), hornAt: null,
    results: null, startedAt: ctx.nowMs,
    director: newDirector(islands.length, ctx.nowMs),
    rev: 0, sig: '', view: null, cardsAt: -Infinity, cards: null,
    revs: islands.map(() => 0), keys: islands.map(() => ''), sent: {},
    checked: islands.map(() => -1),
  };
}

export const islandOfSeat = (l: League, id: SeatId): State => {
  const s = l.islands[l.home[id]];
  need(s, 'This seat is not in the game.');
  return s;
};

export function leagueAct(l: League, id: SeatId, a: Action, now: number) {
  const s = islandOfSeat(l, id);
  if (a.type === 'sync') { delete l.sent[id]; return; }
  applyAction(s, id, a, now);
}

export function leaguePresence(l: League, id: SeatId, connected: boolean, now: number) {
  if (l.home[id] === undefined) return;
  if (connected) delete l.sent[id];
  presence(l.islands[l.home[id]], id, connected, now);
}

// ---------------------------------------------------------------- the round, for the whole room

const over = (s: State) => s.turn.stage === 'finale' || s.turn.stage === 'ended';
const open = (s: State) => s.turn.stage === 'round' && !s.turn.closed;
const waitingForDice = (s: State) => s.turn.stage === 'roll' && !s.queue.length && !Object.keys(s.prompts).length;
const totalVp = (s: State, id: SeatId) => vpOf(scoreParts(s, id), true);

/** Nothing this seat could do in the window: no cards to spend or trade, no card to play, no free command. */
function idle(s: State, id: SeatId) {
  const p = s.seats[id];
  return !total(p.hand) && !p.dev.some(c => c.kind !== 'victory') && !p.freeRoutes && !shipMoves(s, id).length
    && !hooks(s, 'commands').some(m => m.commands(s, id).length);
}

export type Runner = { id: SeatId; vp: number; past: number[] };
const runner = (s: State, id: SeatId): Runner => ({ id, vp: totalVp(s, id), past: s.stats.vpByRound[id] });

/**
 * The best of `field`: the highest total, then whoever led at the end of the round before (and the one
 * before that, back to the start). Seats level all the way share the win.
 */
export function best(field: Runner[]): SeatId[] {
  let top = field.filter(r => r.vp === Math.max(...field.map(x => x.vp)));
  for (let back = 1; top.length > 1 && back <= top[0].past.length; back++) {
    const at = (r: Runner) => r.past[r.past.length - back] ?? 0, lead = Math.max(...top.map(at));
    top = top.filter(r => at(r) === lead);
  }
  return top.map(r => r.id);
}

/** Everybody at or above their target at the end of a round, on any island. */
const champions = (l: League): SeatId[] => best(l.islands.flatMap(s => winCheck(s, s.order).map(id => runner(s, id))));

const leaders = (l: League): SeatId[] => best(l.islands.flatMap(s => s.order.map(id => runner(s, id))));

export const seatName = (l: League, id: SeatId) => l.islands[l.home[id]].seats[id].name;

type Standing = { seat: SeatId; island: number; rank: number; islandRank: number; vp: number };

function standings(l: League): Standing[] {
  const rows = l.islands.flatMap((s, island) => s.order.map(seat =>
    ({ seat, island, rank: 0, islandRank: 0, vp: totalVp(s, seat) })));
  for (const row of rows) {
    row.rank = 1 + rows.filter(o => o.vp > row.vp).length;
    row.islandRank = 1 + rows.filter(o => o.island === row.island && o.vp > row.vp).length;
  }
  return rows.sort((a, b) => a.rank - b.rank || a.island - b.island);
}

function finishAll(l: League, winners: SeatId[], reason: EndReason, now: number) {
  const names = winners.map(id => seatName(l, id)), list = names.length > 2
    ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
  const text = `${list} ${winners.length > 1 ? 'win' : 'wins'} the archipelago!`;
  for (const s of l.islands) {
    commit(s, now, next => finish(next, winners.filter(id => next.seats[id]), reason, text, LEAGUE_FINALE_MS));
  }
  const first = l.islands[0];
  l.results = {
    winners, reason, rounds: first.turn.round, durationMs: now - l.startedAt, finaleAt: now,
    completeAt: now + LEAGUE_FINALE_MS, standings: standings(l), awards: awards(l),
  };
  Object.assign(l, { rollAt: null, hornAt: null });
}

/** The round's dice for the whole room; each island then rolls them one at a time (`deal`). */
function rollAll(l: League, now: number) {
  const rolls: [number, number][] = [], first = l.islands[0];
  // Deliveries rerolls a 2 or 12 on small tables; the room does it once, so every island still sees the same dice.
  const skip = first.modules.includes('deliveries') && noExtremes(first.order.length, first.settings.scenarios);
  while (rolls.length < ROLLS_PER_ROUND) {
    const { dice, deck } = rollDice(() => sfc32(l.rng), l.diceDeck, l.lastTotal), total = dice[0] + dice[1];
    l.diceDeck = deck;
    if (skip && (total === 2 || total === 12)) continue;
    l.lastTotal = total;
    rolls.push(dice);
  }
  Object.assign(l, { rollAt: null, hornAt: null, rolled: l.islands.map(() => 0), rollNext: l.islands.map(() => now) });
  l.dice = { at: now, round: l.islands[0].turn.round, rolls };
}

/** Hand each island its next roll once the last one (and any 7) has resolved there. */
function deal(l: League, now: number) {
  const rolls = l.dice?.round === l.islands[0].turn.round ? l.dice.rolls : [];
  l.islands.forEach((s, i) => {
    const k = l.rolled[i];
    if (k >= rolls.length || !waitingForDice(s) || now < l.rollNext[i]) return;
    commit(s, now, next => sharedRoll(next, rolls[k], k === rolls.length - 1));
    l.rolled[i]++;
    l.rollNext[i] = now + ROLL_GAP_MS;
  });
}

/** The room is between a round's first roll and its last island's window opening. */
export const rolling = (l: League) => l.dice?.round === l.islands[0].turn.round
  && l.islands.some((s, i) => l.rolled[i] < l.dice!.rolls.length || s.turn.stage === 'roll');

/** Seats that are finished with this round, out of everyone in the room. */
function doneShare(l: League) {
  let done = 0, all = 0;
  for (const s of l.islands) for (const id of s.order) {
    all++;
    if (s.turn.closed || (s.turn.stage === 'round' && (s.seats[id].ready || !s.seats[id].connected))) done++;
  }
  return done / all;
}

/** Runs once a tick, after every island has ticked. */
export function conduct(l: League, now: number) {
  if (!l.shared || l.islands.some(over)) return;
  for (const [i, s] of l.islands.entries()) {
    if (!open(s)) continue;
    // A seat with nothing it could possibly do is done at once, so the room is not waiting on a tap.
    if (l.checked[i] !== s.rev && !Object.keys(s.prompts).length) {
      const spare = s.order.filter(id => !s.seats[id].ready && idle(s, id));
      if (spare.length) commit(s, now, next => { for (const id of spare) end(next, id); });
      l.checked[i] = s.rev;
    }
    if (allReady(s) && now >= s.turn.openedAt + CONNECT_MIN_OPEN_SECONDS * 1000) {
      commit(s, now, next => queueEffect(next, { type: 'end-round' }));
    }
  }
  if (l.islands.every(s => s.turn.closed)) {
    const winners = champions(l), first = l.islands[0];
    if (winners.length) return finishAll(l, winners, 'target', now);
    if (first.turn.round >= roundLimit(first)) return finishAll(l, leaders(l), 'round-limit', now);
    for (const s of l.islands) commit(s, now, nextRound);
    Object.assign(l, { rollAt: now + ROLL_BEAT_MS, hornAt: null });
    return;
  }
  if (l.dice?.round !== l.islands[0].turn.round) {
    if (!l.islands.every(waitingForDice)) return;
    l.rollAt ??= now + FIRST_ROLL_MS;
    if (now >= l.rollAt) rollAll(l, now);
  }
  deal(l, now);
  if (l.hornAt === null && doneShare(l) >= HORN_SHARE) l.hornAt = now;
  if (l.hornAt === null) return;
  for (const s of l.islands) {
    if (!open(s)) continue;
    const limit = s.turn.openedAt > l.hornAt ? s.turn.openedAt + LATE_WINDOW_MS : l.hornAt + HORN_MS;
    if (!Object.values(s.timers).some(t => t.deadline === null || t.deadline > limit)) continue;
    commit(s, now, next => { next.turn.hornAt = l.hornAt; hurry(next, limit); });
  }
}

/** `step` ticks one island (deadlines and its CPUs). */
export function leagueTick(l: League, now: number, step: (s: State, now: number) => void) {
  for (const s of l.islands) step(s, now);
  conduct(l, now);
  direct(l, now);
}

// ---------------------------------------------------------------- outcome

export function leagueOutcome(l: League): Outcome {
  if (!l.shared) return islandOutcome(l.islands[0]);
  const rows = l.results?.standings ?? standings(l);
  return {
    complete: l.islands.every(s => s.turn.stage === 'ended'),
    winners: l.results?.winners ?? [],
    rows: rows.map(r => {
      const cpu = l.islands[r.island].seats[r.seat].cpu;
      const place = `${l.names[r.island]} · #${r.islandRank} on the island`;
      return { playerId: r.seat, score: r.vp, rank: r.rank, label: cpu ? `CPU · ${place}` : place };
    }),
  };
}

export { ISLAND_SEATS };
