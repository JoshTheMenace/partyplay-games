/** Thin GameRules adapter over engine/, plus the CPU scheduler (ENGINE §15, §18). */
import type { GameRules } from '../../../party-contract/src/index';
// Load the expansion modules first: they import core helpers (legal.ts `why`, …) at module level, and core
// reaches them only via registry → modules/index, so this order initialises core before any module body.
import './engine/modules/index';
import type { Action, PrivateView, PublicView, SeatId, Settings } from './model';
import { decide as cpuDecide, type Brain, type Decision } from './cpu/index';
import { validateSettings } from './settings';
import {
  applyAction, commit, createGame, dropViews, outcome, parseAction, presence, privateView, publicView, tick,
} from './engine/index';
import { cpuDelay, cpuDuty, fallback } from './engine/auto';
import { role } from './engine/flow';
import { seatPrompts } from './engine/prompts';
import { sfc32 } from './engine/rng';
import type { State } from './engine/state';

import {
  createLeague, leagueAct, leagueOutcome, leaguePresence, leagueTick, type League,
} from './league/index';
import { roomView, seatView, sync } from './league/views';
import type { RoomView, SeatView } from './wire';

export type { State } from './engine/state';
export type { League } from './league/index';

export type { Brain, Decision } from './cpu/index';
export type Decide = (pub: PublicView, me: PrivateView, brain: Brain) => Decision;

/** CPUs think with WP-cpu's `decide`; `null` (tests) makes them play the engine's auto-actions. */
const brain: Decide | null = cpuDecide;

const MAX_CPU_PER_TICK = 3;

/** Apply the always-legal fallback; if even that fails, mark the seat away so timeouts take over. */
function settle(s: State, id: SeatId, now: number, reason: 'error' | null) {
  if (!seatPrompts(s, id).length && !role(s, id)) return;
  try {
    commit(s, now, next => { fallback(next, id, reason); });
  } catch {
    commit(s, now, next => { next.seats[id].away = true; });
  }
}

function runCpu(s: State, id: SeatId, now: number, decide: Decide | null) {
  const cpu = s.seats[id].cpu!;
  cpu.nextAt = now + cpuDelay(s, cpu.level, 'think');
  if (!decide || cpu.budget <= 0) return settle(s, id, now, null);
  const words = [...s.rng.cpu];
  try {
    const brain = { level: cpu.level, persona: cpu.persona, memory: cpu.memory, random: () => sfc32(words) };
    const d = decide(publicView(s), privateView(s, id), brain);
    s.rng.cpu = words;
    Object.assign(cpu, { memory: d.memory, nextAt: now + cpuDelay(s, cpu.level, d.pace) });
    if (!d.action) return ++cpu.idle >= 3 ? settle(s, id, now, null) : undefined;
    applyAction(s, id, parseAction(d.action), now);
    const after = s.seats[id].cpu!;
    Object.assign(after, { budget: after.budget - 1, idle: 0 });
  } catch {
    settle(s, id, now, 'error');
  }
}

/** Due CPUs (a duty and nextAt reached), earliest first, at most three per tick. */
export function cpuStep(s: State, now: number, decide = brain) {
  const due = s.order.filter(id => {
    const cpu = s.seats[id].cpu;
    return cpu && cpu.nextAt <= now && cpuDuty(s, id);
  }).sort((a, b) => s.seats[a].cpu!.nextAt - s.seats[b].cpu!.nextAt);
  for (const id of due.slice(0, MAX_CPU_PER_TICK)) {
    if (s.turn.stage === 'finale' || s.turn.stage === 'ended') return;
    if (cpuDuty(s, id)) runCpu(s, id, now, decide);
  }
}

/** One island: the engine as GameRules. The league below wraps it; tests and tools drive it directly. */
export const island: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings,
  parseInput(raw) {
    if (raw !== null) throw new Error('This game uses discrete actions.');
    return null;
  },
  neutralInput: () => null,
  parseAction,
  create: (ctx, settings) => createGame(ctx, settings),
  applyAction,
  tick(s, _inputs, _dt, now) { step(s, now); },
  onPresenceChange: presence,
  publicView: s => publicView(s),
  playerView: (s, id) => privateView(s, id),
  outcome,
  dispose: dropViews,
};

function step(s: State, now: number) {
  tick(s, now);
  cpuStep(s, now);
}

/** The room: one island, or an archipelago of them (league/index.ts), in the wire format of wire.ts. */
export const rules: GameRules<League, null, Action, Settings, RoomView, SeatView> = {
  validateSettings, parseInput: island.parseInput, neutralInput: () => null, parseAction,
  create(ctx, settings) {
    const l = createLeague(ctx, settings);
    sync(l, ctx.nowMs);
    return l;
  },
  applyAction(l, id, a, now) {
    try { leagueAct(l, id, a, now); } finally { sync(l, now); }
  },
  tick(l, _inputs, _dt, now) {
    leagueTick(l, now, step);
    sync(l, now);
  },
  onPresenceChange(l, id, connected, now) {
    leaguePresence(l, id, connected, now);
    sync(l, now);
  },
  publicView: roomView,
  playerView: (l, id) => seatView(l, id),
  outcome: leagueOutcome,
  dispose(l) { for (const s of l.islands) dropViews(s); },
};

export default rules;
