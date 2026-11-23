/** Rooms for the league tests: every seat is played by the CPU brain through the real wire format. */
import { assertSerializable } from '../../../../party-contract/src/serializable';
import { decide, type Brain } from '../../src/cpu/index';
import type { Action, Settings } from '../../src/model';
import { rules, type League } from '../../src/server';
import { resetWire, seatView, type RoomView, type SeatView } from '../../src/wire';
import { seeded } from '../fixtures/board';

export const START = 1000;
export const ctx = (now: number) => ({ nowMs: now, phase: 'playing' as const });

export function room(count: number, settings: Partial<Settings> = {}, seed = 4242): League {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`, name: `Player ${i}`.padEnd(16, '.'), color: `#${i}`,
  }));
  resetWire();
  const valid = rules.validateSettings({ tableSize: Math.min(10, Math.max(3, count)), ...settings });
  return rules.create({ roomId: 'test', roundId: `round-${seed}-${count}`, seed, nowMs: START, players }, valid);
}

export const humans = (l: League) => Object.keys(l.home).filter(id => !l.islands[l.home[id]].seats[id].cpu);
export const tick = (l: League, now: number) => rules.tick(l, new Map(), 0.1, now);
export const act = (l: League, id: string, a: Action, now: number) => rules.applyAction(l, id, rules.parseAction(a), now);
export const shared = (l: League, now: number) => rules.publicView(l, ctx(now)) as RoomView;

export type Watch = (l: League, now: number, view: RoomView, seats: Map<string, SeatView>) => void;

/**
 * Plays the room to its end in simulated time: every human seat reads its own snapshot each 100 ms (as a
 * phone does), asks for `sync` when it is behind and moves about every `paceMs`. Returns the final time,
 * what was refused (`rejected` on a current view, `late` on one the island had moved past) and the largest
 * single message any phone would have been sent.
 */
export function play(l: League, o: { seed?: number; paceMs?: number; maxMs?: number; watch?: Watch; every?: number } = {}) {
  const ids = humans(l), random = seeded((o.seed ?? 7) * 7919), pace = o.paceMs ?? 900, round = 'test-round';
  const brains = new Map<string, Brain>(ids.map((id, i) => [id, {
    level: 'normal' as const, persona: ['trader', 'roads', 'knights', 'cities'][i % 4], memory: null, random,
  }]));
  const nextAt = new Map(ids.map(id => [id, START + random() * pace]));
  const rejected: string[] = [], late: string[] = [], size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
  let now = START, frames = 0, rev = -1, largest = 0;
  while (!rules.outcome(l).complete && now < START + (o.maxMs ?? 3 * 3600_000)) {
    now += 100; frames++;
    tick(l, now);
    const view = shared(l, now), raw = new Map<string, SeatView>(), out = rules.outcome(l);
    // One phone's message: the shared view when it changed, its own view, and the outcome on the results frame.
    const common = 120 + (view.rev === rev ? 12 : size(view)) + (out.complete ? size(out) : 0);
    rev = view.rev;
    // As the platform does it: one snapshot pass for every seat, then the moves that arrive before the next.
    for (const id of ids) raw.set(id, rules.playerView(l, id, ctx(now)));
    for (const id of ids) {
      const mine = raw.get(id)!;
      largest = Math.max(largest, common + size(mine));
      const { view: seat, stale } = seatView(round, id, view, mine);
      if (stale || !seat) { act(l, id, { type: 'sync', turnId: 0 }, now); continue; }
      if (now < nextAt.get(id)! || seat.pub.turn.stage === 'finale' || seat.pub.turn.stage === 'ended') continue;
      const d = decide(seat.pub, seat.me, brains.get(id)!);
      brains.get(id)!.memory = d.memory;
      nextAt.set(id, now + pace * (0.5 + random()));
      if (!d.action || d.action.type === 'intent') continue;
      // A move chosen on a view the island has moved past (another seat was quicker in this frame, or the full
      // view was a snapshot behind) may be refused, as on a real phone; refused on a current view, it is a defect.
      const current = mine.rev === l.revs[l.home[id]];
      try { act(l, id, d.action, now); } catch (e) { (current ? rejected : late).push(`${d.action.type}: ${(e as Error).message}`); }
    }
    if (frames % (o.every ?? 20) === 0) {
      assertSerializable(view);
      o.watch?.(l, now, view, raw);
    }
  }
  return { now, rejected, late, largest };
}
