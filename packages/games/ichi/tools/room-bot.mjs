// Socket-bot policy for the platform's scripts/qa/room-bots.ts (--hook): each bot plays legal Ichi at a human pace through
// nothing but its own snapshots, and the module records pacing (match length, the wait between a bot's turns, rejections).
//   ICHI_BOT_THINK=2500,7000   think time per turn in ms        ICHI_BOT_STATS=path.json   where the pacing record is written
// Untyped on purpose: the games repository cannot import platform scripts.
import { writeFileSync } from 'node:fs';

const [thinkMin, thinkMax] = (process.env.ICHI_BOT_THINK ?? '2500,7000').split(',').map(Number);
const plans = new Map(), seats = new Map(), stats = { began: 0, ended: 0, think: [thinkMin, thinkMax], bots: 0, turns: 0, waitsMs: [], sent: {}, rejected: {}, rounds: [], hands: {} };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; }, value = c => c.value === 'wild' || c.value === 'wild4' ? 50 : /^\d$/.test(c.value) ? Number(c.value) : 20;
const think = () => thinkMin + Math.random() * (thinkMax - thinkMin) * (Math.random() < .12 ? 2 : 1);
/** True once the delay chosen when this decision first came up has passed. */
const due = (key, delay) => { if (!plans.has(key)) plans.set(key, Date.now() + delay()); return Date.now() >= plans.get(key); };
function save() {
  if (!process.env.ICHI_BOT_STATS) return;
  const w = [...stats.waitsMs].sort((a, b) => a - b), q = f => w.length ? w[Math.min(w.length - 1, Math.floor(w.length * f))] : null;
  writeFileSync(process.env.ICHI_BOT_STATS, JSON.stringify({ ...stats, waitsMs: undefined, matchMs: stats.ended ? stats.ended - stats.began : null, turnWait: { n: w.length, medianMs: q(.5), p90Ms: q(.9), maxMs: q(1) } }, null, 2));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, save);

function pick(t, hand, me, roster) {
  const room = t.seats.filter(o => o.p !== me && o.count < 30).sort((a, b) => a.count - b.count);
  const card = hand.filter(c => c.playable && (c.value !== 'gift' || hand.length === 1 || room.length)).sort((a, b) => (a.color === 'wild') - (b.color === 'wild') || value(b) - value(a))[0];
  if (!card) return null;
  const tally = {}; for (const c of hand) if (c.color !== 'wild' && c.id !== card.id) tally[c.color] = (tally[c.color] ?? 0) + 1;
  const give = hand.filter(c => c.id !== card.id).sort((a, b) => value(b) - value(a))[0], other = room[0] ?? t.seats.find(o => o.p !== me);
  return { kind: 'play', turnId: t.turnId, cardId: card.id, ...(card.color === 'wild' ? { color: Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] ?? 'coral' } : {}),
    ...(card.value === 'gift' && give && room.length ? { give: give.id, target: roster[room[0].p].id } : card.value === '7' ? { target: roster[other.p].id } : {}) };
}

export default {
  snapshot(bot, snapshot) {
    const v = snapshot.publicView, own = snapshot.privateView;
    if (!v?.match || !own) return;
    if (!seats.has(bot)) { seats.set(bot, { busy: false, onTurn: false, left: 0 }); stats.bots++; }
    const seat = seats.get(bot), me = v.roster.findIndex(p => p.id === bot.playerId), now = Date.now();
    stats.began ||= now;
    if (v.match.phase === 'complete') { if (!stats.ended) { stats.ended = now; save(); } return; }
    if (me < 0 || seat.busy) return;
    const send = payload => { seat.busy = true; bump(stats.sent, payload.kind); void bot.act(payload).then(ack => { seat.busy = false; if (!ack.accepted) bump(stats.rejected, `${payload.kind}: ${ack.reason}`); }); };
    if (v.match.phase === 'seating') {
      if (!stats.rounds[v.match.round]) { stats.rounds[v.match.round] = now - stats.began; save(); }
      if (!v.match.ready.includes(me) && due(`${bot.index}:seat${v.match.round}`, () => Math.random() < .6 ? 2500 + Math.random() * 9000 : 1e9)) send({ kind: 'next', turnId: `r${v.match.round}` });
      return;
    }
    const t = own.table ?? v.feature;
    if (!t) return;
    if (t.handResult && !plans.has(`done${t.handId}`)) { plans.set(`done${t.handId}`, 0); bump(stats.hands, /bell/i.test(t.handResult.reason) ? 'bell' : /Turn limit/.test(t.handResult.reason) ? 'cap' : 'out'); }
    const mine = t.phase === 'playing' && t.current === me;
    if (mine && !seat.onTurn) { seat.onTurn = true; if (seat.left) stats.waitsMs.push(now - seat.left); }
    if (!mine && seat.onTurn) { seat.onTurn = false; seat.left = t.phase === 'playing' ? now : 0; stats.turns++; }
    if (t.phase === 'intermission') { if (!t.ready.includes(me) && due(`${bot.index}:next${t.handId}`, () => 1500 + Math.random() * 5000)) send({ kind: 'next', turnId: t.handId }); return; }
    if (t.phase !== 'playing') return;
    const w = t.ichiWindow;
    if (w && own.canCall && due(`${bot.index}:call${w.id}`, () => Math.random() < .75 ? 700 + Math.random() * 2200 : 1e9)) return send({ kind: 'ichi', turnId: w.id });
    if (w && own.canCatch && due(`${bot.index}:catch${w.id}`, () => Math.random() < .3 ? 1500 + Math.random() * 3000 : 1e9)) return send({ kind: 'catch', turnId: w.id });
    const key = `${bot.index}:turn${t.turnId}`;
    if (!mine) { const jump = own.hand.find(c => c.jumpable), move = jump && due(`${key}:jump`, () => 500 + Math.random() * 1500) && pick(t, own.hand.map(c => ({ ...c, playable: c.id === jump.id })), me, v.roster); if (move) send(move); return; }
    // The bell's short turns and an obvious move both make people quicker.
    if (!due(key, () => t.drawn ? 900 + Math.random() * 1500 : Math.min(think(), t.lap === null ? 1e9 : 3000 + Math.random() * 5000))) return;
    send(own.canChallenge && Math.random() < .25 ? { kind: 'challenge', turnId: t.turnId } : pick(t, own.hand, me, v.roster) ?? { kind: own.drawnId ? 'keep' : 'draw', turnId: t.turnId });
  },
};
