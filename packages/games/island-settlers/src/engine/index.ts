/** Public engine API used by server.ts: create, act, tick, presence, views, outcome. */
import type { RoundContext } from '../../../../party-contract/src/index';
import { RESOURCES, SEAT_COLORS, TABLE_SIZE, type Good, type SeatId, type Settings } from '../model';
import { PERSONAS } from '../cpu/personas';
import { modulesFor } from '../settings';
import { commit } from './actions';
import { dueAt, expireDue, wakeCpus } from './auto';
import { makeBoard } from './board/index';
import { emptyHand } from './cards';
import { setConnected } from './clock';
import { devDeck } from './dev';
import { emit } from './events';
import { beginSetupStep, CPU_BUDGET, makeSetupPlan } from './flow';
import { activeModules } from './modules/registry';
import { need } from './need';
import { buildProfile } from './profile';
import { freshDiceDeck, generator, seedStreams, shuffle } from './rng';
import { emptyStats } from './stats';
import { random, type Seat, type State } from './state';
import { closeOffers } from './trade';

export { applyAction, commit } from './actions';
export { parseAction } from './parse';
export { dropViews, privateView, publicView } from './project';
export { outcome } from './stats';

const BANK = (n: number) => (n <= 4 ? 19 : n <= 6 ? 24 : n <= 8 ? 30 : 35);

function newSeat(id: SeatId, name: string, seat: number, cpu: Seat['cpu']): Seat {
  return {
    id, name, color: SEAT_COLORS[seat], seat, cpu, connected: true, away: false, autoStreak: 0, autoTurn: -1,
    hand: emptyHand(), dev: [], devPlayedAt: -1, opportunity: 0, knights: 0, longestRoute: 0, freeRoutes: 0,
    moved: false, shipsBuilt: [], ready: false, emoteAt: Number.MIN_SAFE_INTEGER, inbox: [],
  };
}

/** Humans keep their room colour when free; CPUs fill up to tableSize with the unused palette slots. */
function seatTable(ctx: RoundContext, settings: Settings): Seat[] {
  const used = new Set<number>(), free = () => SEAT_COLORS.findIndex((_, i) => !used.has(i));
  const take = (i: number) => { used.add(i); return i; };
  const seats = ctx.players.map(p => {
    const wanted = SEAT_COLORS.indexOf(p.color as (typeof SEAT_COLORS)[number]);
    return newSeat(p.id, p.name, take(wanted >= 0 && !used.has(wanted) ? wanted : free()), null);
  });
  const size = Math.max(settings.tableSize, seats.length, TABLE_SIZE.min);
  for (let i = 1; seats.length < size; i++) {
    const id = `cpu-${i}`, persona = PERSONAS[(i - 1) % PERSONAS.length];
    if (seats.some(x => x.id === id)) continue;
    const cpu = {
      level: settings.cpuLevel, persona: persona.id, label: persona.label,
      nextAt: 0, memory: null, budget: CPU_BUDGET, duty: '', idle: 0,
    };
    seats.push(newSeat(id, persona.name, take(free()), cpu));
  }
  return seats;
}

export function createGame(ctx: RoundContext, settings: Settings): State {
  need(ctx.players.length >= 1 && ctx.players.length <= TABLE_SIZE.max, 'Island Settlers needs 1–10 players.');
  const modules = modulesFor(settings), mods = activeModules(modules), profile = buildProfile(settings, mods);
  const table = seatTable(ctx, settings), n = table.length;
  const decorators = mods.flatMap(m => (m.board?.decorate ? [{ id: m.id, decorate: m.board.decorate }] : []));
  const made = makeBoard({ seatCount: n, settings, random: generator(ctx.seed, 'board'), decorators });
  const s: State = {
    board: made.board, settings, modules, profile, hidden: made.hidden,
    now: ctx.nowMs, rev: 0, mapRev: 0, mapDirty: false, serial: 0, rng: seedStreams(ctx.seed),
    diceDeck: null, lastTotal: null, order: [], seats: Object.fromEntries(table.map(x => [x.id, x])),
    bank: { ...emptyHand(), ...Object.fromEntries(RESOURCES.map(g => [g, BANK(n)])) } as Record<Good, number>,
    devDeck: [],
    pieces: {
      buildings: {}, routes: {}, units: {}, robber: profile.robber ? made.robber : null,
      pirate: profile.pirate ? made.pirate : null, merchant: null, reveals: {},
    },
    turn: {
      id: 0, stage: 'setup', round: 0, active: null, partner: null, next: null, setup: null,
      setupPlan: [], setupIndex: 0, anchor: null, captain: 0, openedAt: ctx.nowMs,
      activeDone: false, partnerDone: false, opportunities: 0,
    },
    timers: {}, queue: [], prompts: {}, offers: {}, awards: {}, events: [], lastRoll: null,
    stats: emptyStats(table.map(x => x.id)), results: null, intent: null, startedAt: ctx.nowMs, ext: {},
  };
  s.order = shuffle(table.map(x => x.id), random(s, 'cards'));
  const deck = mods.find(m => m.devDeck)?.devDeck?.(n) ?? devDeck(n);
  if (profile.devCards) s.devDeck = shuffle(deck, random(s, 'cards'));
  if (settings.balancedDice) s.diceDeck = freshDiceDeck(random(s, 'dice'));
  for (const m of mods) if (m.init) s.ext[m.id] = m.init(s);
  s.turn.setupPlan = mods.reduce((plan, m) => m.setupPlan?.(plan, s) ?? plan, makeSetupPlan(s.order, profile));
  const text = 'Place starting pieces; round 2 goes in reverse order';
  emit(s, { kind: 'turn', seat: null, stage: 'setup', round: 0, text });
  beginSetupStep(s);
  wakeCpus(s);
  return s;
}

/**
 * Expire deadlines, close windows, finish the finale. Quiet ticks change nothing (no `rev` bump).
 * A throwing sweep must not end the room: it is logged and retried once with the due seats' owed
 * free routes dropped, so the stuck step is forced forward.
 */
export function tick(s: State, now: number) {
  if (dueAt(s) > now) return;
  try { commit(s, now, expireDue); } catch (error) {
    console.error('Island Settlers: tick failed, forcing due steps', error);
    commit(s, now, next => {
      const due = Object.entries(next.timers).filter(([, t]) => t.deadline !== null && t.deadline <= now);
      for (const [id] of due) next.seats[id].freeRoutes = 0;
      expireDue(next);
    });
  }
}

/** Only seats that owe a decision are ever waited on (ENGINE §6). */
export function presence(s: State, id: SeatId, connected: boolean, now: number) {
  const seat = s.seats[id];
  if (!seat || seat.cpu || seat.connected === connected || s.turn.stage === 'ended') return;
  commit(s, now, next => {
    setConnected(next, id, connected);
    if (!connected) closeOffers(next, id, 'withdrawn');
    const text = `${seat.name} ${connected ? 'reconnected' : 'disconnected'}`;
    emit(next, { kind: 'presence', seat: id, connected, text });
  });
}
