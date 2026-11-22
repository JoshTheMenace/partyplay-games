// Offline pacing check: plays whole matches against the rules in simulated time with human-paced seats, and reports match length,
// the wait between a player's turns, how hands end, and what the 10 Hz snapshots would cost. No server, no sockets.
//   node --import tsx packages/games/ichi/tools/sim.ts [players[:tableSize] ...] [--think 2500,7000] [--target 200] [--hand 7] [--seeds 3]
import { parseArgs } from 'node:util';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { rules } from '../src/server';
import { defaults, points, type Action, type Color, type HandCard, type Settings, type TableView } from '../src/types';

const { values: arg, positionals } = parseArgs({ allowPositionals: true, options: { think: { type: 'string' }, target: { type: 'string' }, hand: { type: 'string' }, seeds: { type: 'string' } } });
const [thinkMin, thinkMax] = (arg.think ?? '2500,7000').split(',').map(Number), seeds = Number(arg.seeds ?? 3);
const quantile = (list: number[], q: number) => list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * q))] : 0;
const seconds = (ms: number) => (ms / 1000).toFixed(0), clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function match(count: number, settings: Settings, seed: number) {
  const players = Array.from({ length: count }, (_, i) => ({ id: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`, name: `Bartholomew Ke${String(i).padStart(2, '0')}`, color: 'hsl(128 85% 66%)' }));
  const s = rules.create({ roomId: 'sim', roundId: 'sim', nowMs: 0, seed, players }, settings), ctx = () => ({ nowMs: s.now, phase: 'playing' as const });
  let r = seed * 7919 + 1; const rand = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296, think = () => thinkMin + rand() * (thinkMax - thinkMin) * (rand() < .12 ? 2 : 1);
  const waits: number[] = [], left = new Map<number, number>(), plan = new Map<string, number>(), ends = { out: 0, bell: 0, cap: 0 }, seenHand = new Set<string>();
  let now = 0, frames = 0, publicBytes = 0, privateBytes = 0, privateSamples = 0, rev = -1, changes = 0, cpuMs = 0, cpuFrames = 0, turns = 0, actions = 0;
  const when = (key: string, delay: () => number) => { if (!plan.has(key)) plan.set(key, now + delay()); return now >= plan.get(key)!; };
  const send = (i: number, a: Action) => { try { rules.applyAction(s, players[i].id, a, now); actions++; return true; } catch { return false; } };
  const pick = (t: TableView, hand: HandCard[], i: number) => {
    const able = hand.filter(c => c.playable), room = t.seats.filter(o => o.p !== i && o.count < 30).sort((a, b) => a.count - b.count);
    const c = able.filter(c => c.value !== 'gift' || hand.length === 1 || room.length).sort((a, b) => (a.color === 'wild' ? 1 : 0) - (b.color === 'wild' ? 1 : 0) || points(b) - points(a))[0];
    if (!c) return null;
    const tally = new Map<string, number>(); for (const h of hand) if (h.color !== 'wild' && h.id !== c.id) tally.set(h.color, (tally.get(h.color) ?? 0) + 1);
    const give = hand.filter(h => h.id !== c.id).sort((a, b) => points(b) - points(a))[0];
    return { kind: 'play' as const, turnId: t.turnId, cardId: c.id, ...(c.color === 'wild' ? { color: ([...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'coral') as Color } : {}),
      ...(c.value === 'gift' && give && room.length ? { give: give.id, target: players[room[0].p].id } : c.value === '7' ? { target: players[(room[0] ?? t.seats.find(o => o.p !== i)!).p].id } : {}) };
  };
  while (!rules.outcome(s).complete && now < 7200000) {
    now += 100; frames++; rules.tick(s, new Map(), .1, now);
    const v = rules.publicView(s, ctx());
    if (v.rev !== rev) { rev = v.rev; changes++; publicBytes += Buffer.byteLength(JSON.stringify(v)); } else publicBytes += 12;
    if (frames % 10 === 0) for (const p of players) { privateBytes += Buffer.byteLength(JSON.stringify(rules.playerView(s, p.id, ctx()))); privateSamples++; }
    if (frames % 50 === 0) { const began = performance.now(); const shared = rules.publicView(s, ctx()); assertSerializable(shared); JSON.stringify(shared); for (const p of players) { const own = rules.playerView(s, p.id, ctx()); assertSerializable(own); JSON.stringify(own); } rules.outcome(s); cpuMs += performance.now() - began; cpuFrames++; }
    // Count each hand as it ends, including the one that ends the match.
    for (const table of s.tables) { const id = `${s.round}:${table.id}:${table.hand}`, r = table.result; if (r && !seenHand.has(id)) { seenHand.add(id); ends[/bell/i.test(r.reason) ? 'bell' : /Turn limit/.test(r.reason) ? 'cap' : 'out']++; for (const i of table.seats) left.delete(i); } }
    if (v.match.phase === 'complete') continue;
    if (v.match.phase === 'seating') { for (let i = 0; i < count; i++) if (!v.match.ready.includes(i) && rand() < .6 && when(`seat${v.match.round}:${i}`, () => 2500 + rand() * 9000)) send(i, { kind: 'next', turnId: `r${v.match.round}` }); continue; }
    for (const table of s.tables) {
      const own = (i: number) => rules.playerView(s, players[i].id, ctx()), t = s.parlor ? own(table.seats[0]).table! : v.feature!;
      if (t.phase === 'intermission') { for (const seat of t.seats) if (!t.ready.includes(seat.p) && when(`next${t.handId}:${seat.p}`, () => 1500 + rand() * 5000)) send(seat.p, { kind: 'next', turnId: t.handId }); continue; }
      if (t.phase !== 'playing') continue;
      const w = t.ichiWindow;
      if (w) {
        if (when(`call${w.id}`, () => rand() < .75 ? 700 + rand() * 2200 : 1e9)) send(w.p, { kind: 'ichi', turnId: w.id });
        else for (const seat of t.seats) if (seat.p !== w.p && when(`catch${w.id}:${seat.p}`, () => rand() < .35 ? 1500 + rand() * 3000 : 1e9)) { send(seat.p, { kind: 'catch', turnId: w.id }); break; }
      }
      const i = t.current, key = `turn${t.turnId}`;
      if (!plan.has(key)) { const ended = left.get(i); if (ended !== undefined && !t.drawn) waits.push(now - ended); }
      // The bell's short turns and an obvious move both make people quicker.
      if (!when(key, () => t.drawn ? 900 + rand() * 1500 : Math.min(think(), t.lap === null ? 1e9 : 3000 + rand() * 5000))) continue;
      const mine = own(i), before = t.turn, move = mine.canChallenge && rand() < .25 ? { kind: 'challenge' as const, turnId: t.turnId } : pick(t, mine.hand, i) ?? { kind: mine.drawnId ? 'keep' as const : 'draw' as const, turnId: t.turnId };
      send(i, move);
      if (table.turn !== before || table.phase !== 'playing') { turns++; left.set(i, now); }
    }
  }
  const hands = ends.out + ends.bell + ends.cap;
  return { ms: now, waits, ends, hands, turns, actions, tables: s.tables.length, parlor: s.parlor, publicPerSecond: publicBytes / (now / 1000), privatePerSecond: privateBytes / privateSamples * 10, changesPerSecond: changes / (now / 1000), frameCpuMs: cpuMs / cpuFrames, top: Math.max(...s.players.map(p => p.score)), scorers: s.players.filter(p => p.score > 0).length };
}

console.log(`think ${thinkMin}–${thinkMax} ms a turn, ${seeds} seeded matches each, target ${arg.target ?? defaults.target}, ${arg.hand ?? defaults.handSize}-card hands`);
console.log('players  tables  match     hands  out/bell  turn wait median/p90/max  KiB/s a phone (shared+own)  changes/s  server ms/frame  scorers');
for (const spec of positionals.length ? positionals : ['2', '4', '6', '10', '10:4', '11', '16', '32', '64']) {
  const [count, tableSize = 0] = spec.split(':').map(Number), settings = { ...defaults, target: Number(arg.target ?? defaults.target), handSize: Number(arg.hand ?? defaults.handSize), tableSize } as Settings;
  const runs = Array.from({ length: seeds }, (_, k) => match(count, settings, 101 + k * 17 + count)), mean = (f: (run: typeof runs[0]) => number) => runs.reduce((n, run) => n + f(run), 0) / runs.length, waits = runs.flatMap(run => run.waits);
  console.log(`${String(count).padStart(7)}  ${String(runs[0].tables).padStart(6)}  ${clock(mean(run => run.ms)).padStart(6)}  ${mean(run => run.hands).toFixed(1).padStart(7)}  ${`${mean(run => run.ends.out).toFixed(1)}/${mean(run => run.ends.bell).toFixed(1)}`.padStart(8)}  ${`${seconds(quantile(waits, .5))}s / ${seconds(quantile(waits, .9))}s / ${seconds(quantile(waits, 1))}s`.padStart(28)}  ${`${(mean(run => run.publicPerSecond + run.privatePerSecond) / 1024).toFixed(1)} (${(mean(run => run.publicPerSecond) / 1024).toFixed(1)}+${(mean(run => run.privatePerSecond) / 1024).toFixed(1)})`.padStart(27)}  ${mean(run => run.changesPerSecond).toFixed(2).padStart(9)}  ${mean(run => run.frameCpuMs).toFixed(2).padStart(15)}  ${mean(run => run.scorers).toFixed(0).padStart(4)}/${count}`);
}
