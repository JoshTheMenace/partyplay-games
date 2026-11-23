/**
 * Offline pacing check: plays whole games against the room rules in simulated time with human-paced seats,
 * through the real wire format (short and full seat views, the `sync` request), and reports game length,
 * how long a phone has nothing to do, and what the 10 Hz snapshots cost. No server, no sockets.
 *
 *   node --import tsx packages/games/island-settlers/tools/sim.ts 4 10 12 32 64 [--mode connect] [--target 10]
 *     [--think 2500,7000] [--sleepy 0.1] [--seeds 2] [--set '{"quickStart":true}']
 *
 * A seat thinks `--think` ms before each move (the CPU brain picks the move from that seat's own views).
 * `--sleepy` is the share of seats that never tap Done, so their rounds end on the horn or the clock.
 */
import { parseArgs } from 'node:util';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { decide, type Brain } from '../src/cpu/index';
import type { Action, Settings } from '../src/model';
import { rules } from '../src/server';
import { resetWire, seatView, type RoomView } from '../src/wire';

const { values: arg, positionals } = parseArgs({ allowPositionals: true, options: {
  think: { type: 'string' }, target: { type: 'string' }, mode: { type: 'string' }, seeds: { type: 'string' },
  sleepy: { type: 'string' }, set: { type: 'string' }, round: { type: 'string' }, timer: { type: 'string' },
} });
const [thinkMin, thinkMax] = (arg.think ?? '2500,7000').split(',').map(Number);
const seeds = Number(arg.seeds ?? 1), sleepy = Number(arg.sleepy ?? 0.1);
const q = (list: number[], p: number) => (list.length
  ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))] : 0);
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const sec = (ms: number) => (ms / 1000).toFixed(0);

function match(count: number, settings: Settings, seed: number) {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`, name: `Bartholomew Ke${String(i).padStart(2, '0')}`,
    color: 'hsl(128 85% 66%)',
  }));
  resetWire();
  const round = `sim-${count}-${seed}`;
  const l = rules.create({ roomId: 'sim', roundId: round, nowMs: 0, seed, players }, settings);
  let r = seed * 7919 + 1;
  const rand = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296;
  const think = () => (thinkMin + rand() * (thinkMax - thinkMin)) * (rand() < 0.12 ? 2 : 1);
  const brains: Brain[] = players.map((_, i) => ({
    level: 'normal', persona: ['trader', 'roads', 'knights', 'cities'][i % 4], memory: null, random: rand,
  }));
  const nextAt = players.map(() => think() * rand()), dozy = players.map(() => rand() < sleepy);
  const waitFrom = players.map((): number | null => null), waits: number[] = [], setupWaits: number[] = [];
  // Where a seat's waiting goes: the opening placements, the shared rolls (and a 7), or others still playing.
  const spent = { act: 0, setup: 0, roll: 0, others: 0 };
  let now = 0, frames = 0, pubBytes = 0, privBytes = 0, maxPub = 0, maxPriv = 0, rev = -1, syncs = 0, rejected = 0;
  let cpuMs = 0, actions = 0, setupMs = 0, fullViews = 0, maxMessage = 0;
  const reasons = new Map<string, number>();
  const send = (i: number, a: Action) => {
    try { rules.applyAction(l, players[i].id, rules.parseAction(a), now); actions++; return true; } catch (e) {
      const why = (e as Error).message;
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
      rejected++;
      return false;
    }
  };
  while (!rules.outcome(l).complete && now < 4 * 3600_000) {
    now += 100; frames++;
    const began = performance.now();
    rules.tick(l, new Map(), 0.1, now);
    const ctx = { nowMs: now, phase: 'playing' as const }, room = rules.publicView(l, ctx) as RoomView;
    const league = room.league;
    let shared = 12;
    if (room.rev !== rev) {
      rev = room.rev;
      shared = Buffer.byteLength(JSON.stringify(room));
      maxPub = Math.max(maxPub, shared);
      if (frames % 50 === 0) assertSerializable(room);
    }
    pubBytes += shared;
    // The results frame also carries the outcome.
    const done = rules.outcome(l);
    if (done.complete) shared += Buffer.byteLength(JSON.stringify(done));
    if (league.phase === 'setup') setupMs = now;
    // As the platform does it: one snapshot pass for every seat, then the moves that arrive before the next.
    const raws = players.map(p => rules.playerView(l, p.id, ctx));
    for (let i = 0; i < count; i++) {
      const raw = raws[i], bytes = Buffer.byteLength(JSON.stringify(raw));
      privBytes += bytes; maxPriv = Math.max(maxPriv, bytes); maxMessage = Math.max(maxMessage, 120 + shared + bytes);
      if (raw.me) fullViews++;
      const { view, stale } = seatView(round, players[i].id, room, raw);
      if (stale || !view) { send(i, { type: 'sync', turnId: 0 }); syncs++; continue; }
      const { pub, me } = view;
      // Nothing to do: no duty, no offer to answer, and the round is not ours to play.
      const idle = me.task.kind === 'wait';
      if (idle && waitFrom[i] === null) waitFrom[i] = now;
      if (!idle && waitFrom[i] !== null) {
        (pub.turn.stage === 'setup' ? setupWaits : waits).push(now - waitFrom[i]!);
        waitFrom[i] = null;
      }
      const stage = pub.turn.stage;
      if (stage !== 'finale' && stage !== 'ended') {
        spent[!idle ? 'act' : stage === 'setup' ? 'setup' : stage === 'roll' ? 'roll' : 'others'] += 100;
      }
      if (pub.turn.stage === 'finale' || pub.turn.stage === 'ended' || now < nextAt[i]) continue;
      const d = decide(pub, me, brains[i]);
      brains[i].memory = d.memory;
      nextAt[i] = now + think() * (d.pace === 'think' ? 1 : 0.6);
      if (!d.action || d.action.type === 'intent') continue;
      if (d.action.type === 'end' && pub.turn.stage === 'round' && dozy[i]) continue;
      send(i, d.action);
    }
    cpuMs += performance.now() - began;
  }
  const out = rules.outcome(l), seconds = now / 1000;
  return {
    ms: now, complete: out.complete, rounds: l.islands[0].turn.round, islands: l.islands.length, setupMs, waits, setupWaits,
    spent, pubPerSecond: pubBytes / seconds,
    privPerSecond: privBytes / count / seconds, maxPub, maxPriv, maxMessage, syncs, rejected, reasons, actions,
    fullShare: fullViews / (frames * count), tickMs: cpuMs / frames, winners: out.winners.length,
    topVp: Math.max(...out.rows.map(x => x.score ?? 0)),
  };
}

const base = { ...JSON.parse(arg.set ?? '{}') } as Partial<Settings>;
if (arg.mode) base.mode = arg.mode as Settings['mode'];
if (arg.target) base.targetPoints = Number(arg.target);
if (arg.round) base.roundSeconds = Number(arg.round) as Settings['roundSeconds'];
if (arg.timer) base.timer = arg.timer as Settings['timer'];
for (const spec of positionals.length ? positionals : ['4', '12', '32']) {
  const count = Number(spec);
  for (let seed = 1; seed <= seeds; seed++) {
    const settings = rules.validateSettings({ tableSize: Math.min(10, Math.max(3, count)), ...base });
    const m = match(count, settings, seed * 101);
    console.log(`${count} players · ${m.islands} island${m.islands > 1 ? 's' : ''} · ${settings.mode} · target ${settings.targetPoints} · seed ${seed}`
      + `${m.complete ? '' : ' · DID NOT FINISH'}`);
    console.log(`  game ${clock(m.ms)} (setup ${clock(m.setupMs)}) · ${m.rounds} rounds · ${(m.ms - m.setupMs) / 1000 / Math.max(1, m.rounds) | 0} s a round`
      + ` · winners ${m.winners} at ${m.topVp} VP · ${m.actions} actions, ${m.rejected} rejected`);
    const all = m.spent.act + m.spent.setup + m.spent.roll + m.spent.others, pct = (n: number) => `${(100 * n / all).toFixed(0)}%`;
    console.log(`  a phone's time: ${pct(m.spent.act)} something to do · ${pct(m.spent.roll)} watching the dice`
      + ` · ${pct(m.spent.others)} waiting on others · ${pct(m.spent.setup)} waiting in setup`);
    console.log(`  waits in play median ${sec(q(m.waits, 0.5))} s, 90th ${sec(q(m.waits, 0.9))} s, worst ${sec(Math.max(0, ...m.waits))} s`
      + ` · in setup median ${sec(q(m.setupWaits, 0.5))} s, worst ${sec(Math.max(0, ...m.setupWaits))} s`);
    console.log(`  per phone: shared ${(m.pubPerSecond / 1024).toFixed(1)} + own ${(m.privPerSecond / 1024).toFixed(1)} KiB/s`
      + ` · largest message ${m.maxMessage} B (shared ${m.maxPub} B, own ${m.maxPriv} B) · full own views ${(m.fullShare * 100).toFixed(1)}% of snapshots`
      + ` · ${m.syncs} sync requests · rules ${m.tickMs.toFixed(2)} ms a tick`);
    if (m.rejected) console.log('  rejected:', [...m.reasons].sort((a, b) => b[1] - a[1]).slice(0, 4));
  }
}
