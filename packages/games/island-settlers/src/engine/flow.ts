/**
 * The stage machine (ENGINE §3): setup snake, Standard turns with paired partners, Connect rounds,
 * the round-limit safety net and the finale. Effects (effects.ts) call into these transitions.
 */
import { FINALE_MS, type EndReason, type SeatId, type TimedStep } from '../model';
import { startTimer, stopTimer } from './clock';
import { emit } from './events';
import { hooks } from './modules/registry';
import { need } from './need';
import type { Profile } from './profile';
import { targets } from './legal';
import { winCheck } from './score';
import { buildResults, bump, leaders, recordRound } from './stats';
import { queueEffect, seat, seatName, type SetupStep, type State } from './state';
import { closeOffers } from './trade';

/** What a seat may do in the current stage, if anything. */
export type Role = 'setup' | 'roll' | 'main' | 'paired' | 'round';

/**
 * Safety-net rounds per victory point (× profile.roundLimitScale): 150 rounds at 10 VP Standard. Connect
 * rolls once per round, and CPU-only games there need up to ~8 rounds per point (~11 with C&K).
 */
export const ROUNDS_PER_POINT = { standard: 15, connect: 12 } as const;
export const roundLimit = (s: State) =>
  ROUNDS_PER_POINT[s.settings.mode] * s.settings.targetPoints * s.profile.roundLimitScale;
export const CPU_BUDGET = 40;
const STEP: Record<Role, TimedStep> = {
  setup: 'setup', roll: 'roll', main: 'main', paired: 'paired', round: 'main',
};
export const stepOf = (role: Role) => STEP[role];

/** 7–10 seats: the partner's paired opportunity runs alongside Player 1's main step. */
export const concurrent = (s: State) => s.settings.mode === 'standard' && s.order.length >= 7;

export function role(s: State, id: SeatId): Role | null {
  const t = s.turn;
  switch (t.stage) {
    case 'setup': return t.active === id ? 'setup' : null;
    case 'roll': return t.active === id ? 'roll' : null;
    case 'main':
      if (t.active === id) return t.activeDone ? null : 'main';
      return t.partner === id && concurrent(s) && !t.partnerDone ? 'paired' : null;
    case 'paired': return t.partner === id ? 'paired' : null;
    case 'round': return s.seats[id]?.ready ? null : 'round';
    default: return null;
  }
}

/**
 * Official 2025 CATAN 5–6 rule: Player 2 is the third player to the left of Player 1 (5 and 6
 * seats alike). Adaptation for 7–10: half the table ahead.
 */
export function partnerOf(s: State, captain: number): SeatId | null {
  const n = s.order.length;
  if (s.settings.mode !== 'standard' || n < 5) return null;
  return s.order[(captain + (n <= 6 ? 3 : Math.floor(n / 2))) % n];
}

// ---------------------------------------------------------------- setup

export function makeSetupPlan(order: SeatId[], profile: Profile): SetupStep[] {
  return [order, [...order].reverse()].flatMap((seats, i) => seats.flatMap(id => [
    { seat: id, piece: profile.setupPieces[i], round: i + 1, anchorRequired: false },
    { seat: id, piece: profile.routeKinds[0], round: i + 1, anchorRequired: true },
  ]));
}

export function beginSetupStep(s: State) {
  const t = s.turn, step = t.setupPlan[t.setupIndex];
  if (!step) return beginPlay(s);
  t.id++;
  t.active = step.seat;
  t.next = t.setupPlan[t.setupIndex + 1]?.seat ?? s.order[0];
  const { seat: id, piece, round } = step;
  t.setup = { seat: id, piece, round, index: t.setupIndex, total: t.setupPlan.length };
  if (!step.anchorRequired) t.anchor = null;
  s.intent = null;
  startTimer(s, step.seat, 'setup');
  emit(s, { kind: 'turn', seat: id, stage: 'setup', round: 0, text: `${seatName(s, id)} places a ${piece}` });
}

/** After a setup placement at `at` (null: the step was skipped because no spot was legal). */
export function afterPlacement(s: State, id: SeatId, at: string | null) {
  const t = s.turn, step = t.setupPlan[t.setupIndex];
  need(t.stage === 'setup' && step?.seat === id, 'It is not your placement.');
  stopTimer(s, id);
  if (!step.anchorRequired) t.anchor = at;
  t.setupIndex++;
  beginSetupStep(s);
}

function beginPlay(s: State) {
  Object.assign(s.turn, { setup: null, anchor: null, round: 1, captain: 0 });
  if (s.settings.mode === 'connect') beginRound(s); else beginTurn(s);
}

// ---------------------------------------------------------------- opportunities

export function startOpportunity(s: State, id: SeatId) {
  const p = seat(s, id);
  p.opportunity++;
  Object.assign(p, { freeRoutes: 0, moved: false, shipsBuilt: [] });
  if (p.cpu) p.cpu.budget = CPU_BUDGET;
  s.turn.opportunities++;
  bump(s, id, 'opportunities');
  for (const m of hooks(s, 'onOpportunityStart')) m.onOpportunityStart(s, id);
}

export function endOpportunity(s: State, id: SeatId) {
  const p = seat(s, id);
  stopTimer(s, id);
  closeOffers(s, id, 'expired');
  p.freeRoutes = 0;
  p.moved = false;
  if (s.intent?.seat === id) s.intent = null;
  for (const m of hooks(s, 'onOpportunityEnd')) m.onOpportunityEnd(s, id);
}

function beginTurn(s: State) {
  const t = s.turn, n = s.order.length, active = s.order[t.captain];
  const next = s.order[(t.captain + 1) % n];
  Object.assign(t, { id: t.id + 1, stage: 'roll', active, partner: partnerOf(s, t.captain), next });
  Object.assign(t, { activeDone: false, partnerDone: false });
  s.intent = null;
  startOpportunity(s, active);
  startTimer(s, active, 'roll');
  emit(s, { kind: 'turn', seat: active, stage: 'roll', round: t.round, text: `${seatName(s, active)}'s turn` });
}

function beginRound(s: State) {
  const t = s.turn, n = s.order.length, captain = s.order[t.captain];
  const next = s.order[(t.captain + 1) % n];
  Object.assign(t, { id: t.id + 1, stage: 'roll', active: captain, partner: null, next });
  s.intent = null;
  for (const id of s.order) { s.seats[id].ready = false; startOpportunity(s, id); }
  startTimer(s, captain, 'roll');
  emit(s, { kind: 'turn', seat: captain, stage: 'roll', round: t.round, text: `Round ${t.round}` });
}

/** The `roll` action (and its auto): the roll resolves through the effect queue. */
export function roll(s: State, id: SeatId) {
  need(role(s, id) === 'roll', 'You cannot roll now.');
  const owed = seat(s, id).freeRoutes > 0 && s.profile.routeKinds.some(k => targets(s, id, k).length);
  need(!owed, 'Place your free roads before rolling.');
  stopTimer(s, id);
  queueEffect(s, { type: 'roll', seat: id });
  queueEffect(s, { type: 'main' });
}

/** Roll resolved: open the main step (Standard) or the Connect window. */
export function openMain(s: State) {
  const t = s.turn;
  t.openedAt = s.now;
  if (s.settings.mode === 'connect') {
    t.stage = 'round';
    for (const id of s.order) startTimer(s, id, 'main', s.now + s.settings.roundSeconds * 1000);
    return;
  }
  t.stage = 'main';
  startTimer(s, t.active!, 'main');
  if (!concurrent(s) || !t.partner) return;
  const partner = seat(s, t.partner);
  if (partner.ready) { partner.ready = false; t.partnerDone = true; return; }
  startOpportunity(s, partner.id);
  startTimer(s, partner.id, 'paired');
}

/** The `end` action: end the opportunity, finish the paired turn, or mark ready in a Connect round. */
export function end(s: State, id: SeatId) {
  const r = role(s, id), t = s.turn;
  need(r === 'main' || r === 'paired' || r === 'round', 'Your turn is not active.');
  if (r === 'round') {
    stopTimer(s, id);
    closeOffers(s, id, 'withdrawn');
    Object.assign(seat(s, id), { ready: true, freeRoutes: 0 });
    return;
  }
  endOpportunity(s, id);
  if (r === 'main') t.activeDone = true; else if (t.stage === 'main') t.partnerDone = true;
  const waiting = t.stage === 'main' && concurrent(s) && !!t.partner && !(t.activeDone && t.partnerDone);
  if (!waiting) queueEffect(s, { type: 'end-opportunity' });
}

/** Pre-commit (or undo) skipping your upcoming paired build turn. */
export function skipPaired(s: State, id: SeatId, skip: boolean) {
  const t = s.turn;
  const upcoming = t.partner === id && (t.stage === 'roll' || (t.stage === 'main' && !concurrent(s)));
  need(upcoming, 'There is no build turn to skip.');
  seat(s, id).ready = skip;
}

/** `end-opportunity` effect: the 5–6 paired turn, then the next Player 1. */
export function nextOpportunity(s: State) {
  const t = s.turn;
  if (t.stage === 'main' && t.partner && !concurrent(s)) {
    const partner = seat(s, t.partner);
    if (!partner.ready) {
      Object.assign(t, { id: t.id + 1, stage: 'paired' });
      startOpportunity(s, partner.id);
      startTimer(s, partner.id, 'paired');
      const text = `${partner.name}'s build turn`;
      emit(s, { kind: 'turn', seat: partner.id, stage: 'paired', round: t.round, text });
      return;
    }
  }
  if (t.partner) seat(s, t.partner).ready = false;
  t.captain = (t.captain + 1) % s.order.length;
  if (t.captain === 0 && !closeRound(s)) return;
  beginTurn(s);
}

/** Round bookkeeping; false when the game ended. */
function closeRound(s: State): boolean {
  recordRound(s);
  s.turn.round++;
  if (s.turn.round <= roundLimit(s)) return true;
  s.turn.round--;
  finish(s, leaders(s), 'round-limit');
  return false;
}

/** `end-round` effect (Connect): round hooks, victory for all seats, next captain. */
export function endRound(s: State) {
  for (const id of s.order) endOpportunity(s, id);
  const winners = winCheck(s, s.order);
  if (winners.length) return finish(s, winners, 'target');
  if (!closeRound(s)) return;
  s.turn.captain = (s.turn.captain + 1) % s.order.length;
  beginRound(s);
}

/** Connect window: closes when everyone is ready (offline counts) after the minimum, or at the deadline. */
export const allReady = (s: State) => s.turn.stage === 'round' && !s.queue.length
  && s.order.every(id => s.seats[id].ready || !s.seats[id].connected);

export const windowClosable = (s: State, minOpenMs: number) => allReady(s) && s.now >= s.turn.openedAt + minOpenMs;

/** Standard: seats in their own opportunity win the moment they reach their target. */
export function checkWin(s: State) {
  if (s.settings.mode !== 'standard' || !['roll', 'main', 'paired'].includes(s.turn.stage)) return;
  const candidates = [s.turn.active, s.turn.partner].filter((id): id is SeatId => !!id && role(s, id) !== null);
  const winners = candidates.length ? winCheck(s, candidates) : [];
  if (winners.length) finish(s, winners, 'target');
}

/** Enter the finale: everything pending is cleared; results become public for FINALE_MS. */
export function finish(s: State, winners: SeatId[], reason: EndReason) {
  const t = s.turn;
  Object.assign(t, { id: t.id + 1, stage: 'finale', partner: null, next: null, setup: null });
  Object.assign(s, { prompts: {}, offers: {}, queue: [], timers: {}, intent: null });
  const names = winners.map(id => seatName(s, id)).join(' and ');
  emit(s, { kind: 'win', seats: winners, reason, text: `${names} ${winners.length > 1 ? 'win' : 'wins'}!` });
  s.results = buildResults(s, winners, reason, FINALE_MS);
}
