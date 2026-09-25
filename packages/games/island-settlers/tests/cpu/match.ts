/**
 * CPU match loop: every seat is driven by decide() with its own brain and a per-seat think delay
 * (the same pace ranges the scheduler uses), so tests measure CPU quality, legality and pacing.
 */
import type { Action, CpuLevel, GameEvent, PrivateView, SeatId, Settings } from '../../src/model';
import { decide, decideStrict, type Brain, type Pace } from '../../src/cpu/index';
import type { State } from '../../src/engine/state';
import { seeded } from '../fixtures/board';
import { act, game, pastSetup, pub, tick, view } from '../helpers';
import { cpuMs } from './helpers';

const PACE: Record<Pace, [number, number]> = { think: [600, 1200], forced: [400, 800], respond: [800, 1600] };

export type MatchResult = {
  s: State; ended: boolean; reason: string | null; winners: SeatId[]; rounds: number; opportunities: number;
  rejected: string[]; actions: Record<SeatId, number>; offers: number; trades: number; autos: number;
  /** decide() calls that threw inside planning and fell back to the safety net. */
  errors: string[];
  /** Module commands run, by command id without its unit/card suffix. */
  commands: Record<string, number>;
  /** Smallest gap between two actions of the same seat (ms). */
  minGap: number;
  /** 95th percentile decide() CPU time (ms). */
  p95: number;
};

export function runMatch(o: {
  seats: number; seed: number; levels?: CpuLevel[]; settings?: Partial<Settings>; maxMs?: number;
  trace?: (id: SeatId, action: Action, me: PrivateView) => void;
  onEvent?: (e: GameEvent) => void;
  /** Another decide() for some seats (A/B comparisons against an older CPU). */
  decider?: (seat: number) => typeof decide | undefined;
}): MatchResult {
  const s = game(o.seats, { timer: 'relaxed', ...o.settings }, o.seed), random = seeded(o.seed * 7919);
  const brains: Record<SeatId, Brain> = {}, nextAt: Record<SeatId, number> = {};
  const last: Record<SeatId, number> = {};
  const personas = ['trader', 'roads', 'knights', 'cities', 'farmer', 'miner', 'sailor', 'banker', 'scout'];
  s.order.forEach((id, i) => {
    brains[id] = { level: o.levels?.[i % o.levels.length] ?? 'normal', persona: personas[i % 9], memory: null,
      random: seeded(o.seed * 131 + i) };
    nextAt[id] = s.now + 600;
  });
  const rejected: string[] = [], errors: string[] = [], actions: Record<SeatId, number> = {};
  const commands: Record<string, number> = {};
  const choose = (p: ReturnType<typeof pub>, me: PrivateView, b: Brain) => {
    try { return decideStrict(p, me, b); } catch (e) {
      errors.push(`${me.seat} ${me.task.kind}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`);
      return decide(p, me, b);
    }
  };
  let offers = 0, trades = 0, autos = 0, minGap = Infinity, now = s.now;
  const seen = new Set<number>(), times: number[] = [];
  const end = s.now + (o.maxMs ?? 6 * 3600_000);
  while (s.turn.stage !== 'ended' && s.turn.stage !== 'finale' && now < end) {
    for (const id of s.order) {
      if (nextAt[id] > now) continue;
      const me = view(s, id), p = pub(s), t = cpuMs();
      const other = o.decider?.(s.order.indexOf(id));
      const d = other ? other(p, me, brains[id]) : choose(p, me, brains[id]);
      times.push(cpuMs() - t);
      brains[id].memory = d.memory;
      const [lo, hi] = PACE[d.pace];
      nextAt[id] = now + lo + Math.floor(random() * (hi - lo)) + (brains[id].level === 'easy' ? 300 : 0);
      if (!d.action) continue;
      o.trace?.(id, d.action, me);
      try {
        act(s, id, d.action, now);
        actions[id] = (actions[id] ?? 0) + 1;
        if (d.action.type === 'command') {
          const key = d.action.command.split(':').filter(x => !/\d/.test(x)).join(':');
          commands[key] = (commands[key] ?? 0) + 1;
        }
        if (last[id] !== undefined) minGap = Math.min(minGap, now - last[id]);
        last[id] = now;
      } catch (e) {
        rejected.push(`${id} ${JSON.stringify(d.action)}: ${(e as Error).message}`);
      }
    }
    now += 100;
    tick(s, now);
    for (const e of s.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      o.onEvent?.(e);
      if (e.kind === 'offer' && e.change === 'posted') offers++;
      if (e.kind === 'trade') trades++;
      if (e.kind === 'auto') autos++;
    }
  }
  const r = s.results;
  return {
    s, ended: !!r, reason: r?.reason ?? null, winners: r?.winners ?? [], rounds: s.turn.round,
    opportunities: s.turn.opportunities, rejected, errors, commands, actions, offers, trades, autos, minGap,
    p95: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)] ?? 0,
  };
}

/** True once WP-core, WP-rules and WP-trade play: setup places pieces and trading is not a stub. */
export function enginePlays(): boolean {
  try {
    const s = game(3);
    pastSetup(s);
    const stubbed = /not available yet/.test(JSON.stringify(view(s, s.order[0]).why));
    return Object.keys(s.pieces.buildings).length > 0 && !stubbed;
  } catch {
    return false;
  }
}
