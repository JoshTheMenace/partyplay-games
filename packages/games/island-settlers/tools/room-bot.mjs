// Socket-bot policy for the platform's scripts/qa/room-bots.ts (--hook): each bot plays legal Island Settlers at a
// human pace from nothing but its own snapshots (the CPU brain picks the move from that seat's views), and the
// module records pacing: game length, rounds, how long a bot has nothing to do, rejections.
//   SETTLERS_BOT_THINK=2500,7000   think time per move in ms     SETTLERS_BOT_SLEEPY=0.1   share that never taps Done
//   SETTLERS_BOT_STATS=path.json   where the pacing record is written
// Untyped on purpose: the games repository cannot import platform scripts. Run under tsx (the brain is TypeScript).
import { writeFileSync } from 'node:fs';
import { decide } from '../src/cpu/index.ts';
import { seatView } from '../src/wire.ts';

const [thinkMin, thinkMax] = (process.env.SETTLERS_BOT_THINK ?? '2500,7000').split(',').map(Number);
const sleepy = Number(process.env.SETTLERS_BOT_SLEEPY ?? 0.1);
const seats = new Map();
const stats = { began: 0, ended: 0, think: [thinkMin, thinkMax], bots: 0, rounds: 0, islands: 0, sent: {}, rejected: {},
  waitsMs: [], setupWaitsMs: [], syncs: 0, setupMs: 0 };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const think = () => (thinkMin + Math.random() * (thinkMax - thinkMin)) * (Math.random() < 0.12 ? 2 : 1);

function save() {
  if (!process.env.SETTLERS_BOT_STATS) return;
  const q = (list, f) => { const w = [...list].sort((a, b) => a - b); return w.length ? w[Math.min(w.length - 1, Math.floor(w.length * f))] : null; };
  const wait = list => ({ n: list.length, medianMs: q(list, 0.5), p90Ms: q(list, 0.9), maxMs: q(list, 1) });
  writeFileSync(process.env.SETTLERS_BOT_STATS, JSON.stringify({ ...stats, waitsMs: undefined, setupWaitsMs: undefined,
    gameMs: stats.ended ? stats.ended - stats.began : null, waits: wait(stats.waitsMs), setupWaits: wait(stats.setupWaitsMs) }, null, 2));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, save);

export default {
  snapshot(bot, snapshot) {
    const room = snapshot.publicView, now = Date.now();
    if (!room?.league || !snapshot.privateView) return;
    if (!seats.has(bot)) {
      seats.set(bot, { busy: false, nextAt: now + think() * Math.random(), waitFrom: null, synced: 0, dozy: Math.random() < sleepy,
        brain: { level: 'normal', persona: ['trader', 'roads', 'knights', 'cities'][bot.index % 4], memory: null, random: Math.random } });
      stats.bots++;
    }
    const seat = seats.get(bot), league = room.league;
    stats.began ||= now;
    stats.rounds = league.round; stats.islands = league.islands.length;
    if (league.phase === 'setup') stats.setupMs = now - stats.began;
    if (league.phase === 'ended' || snapshot.outcome?.complete) { if (!stats.ended) { stats.ended = now; save(); } return; }
    const { view, stale } = seatView(snapshot.roundId, bot.playerId, room, snapshot.privateView);
    if (stale || !view) {
      if (now - seat.synced > 1500) { seat.synced = now; stats.syncs++; void bot.act({ type: 'sync', turnId: 0 }); }
      if (!view) return;
    }
    const { pub, me } = view, idle = me.task.kind === 'wait';
    if (idle && seat.waitFrom === null) seat.waitFrom = now;
    if (!idle && seat.waitFrom !== null) {
      (pub.turn.stage === 'setup' ? stats.setupWaitsMs : stats.waitsMs).push(now - seat.waitFrom);
      seat.waitFrom = null;
    }
    if (seat.busy || now < seat.nextAt || pub.turn.stage === 'finale' || pub.turn.stage === 'ended') return;
    const d = decide(pub, me, seat.brain);
    seat.brain.memory = d.memory;
    seat.nextAt = now + think() * (d.pace === 'think' ? 1 : 0.6);
    if (!d.action || d.action.type === 'intent') return;
    if (d.action.type === 'end' && pub.turn.stage === 'round' && seat.dozy) return;
    seat.busy = true;
    bump(stats.sent, d.action.type);
    void bot.act(d.action).then(ack => { seat.busy = false; if (!ack.accepted) bump(stats.rejected, `${d.action.type}: ${ack.reason}`); });
  },
};
