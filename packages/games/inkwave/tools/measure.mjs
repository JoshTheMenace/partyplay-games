// Server cost and traffic probe: node --import tsx packages/games/inkwave/tools/measure.mjs [players=8,32,64] [map] [seconds] [mode] [cpu]
// Seats send scripted run-aim-fire input (pass `cpu` as the fifth argument to hand every seat to a CPU brain instead).
// Prints server tick time, snapshot build time and the bytes one phone and the TV would receive per second.
import { rules } from '../src/server.ts';
const sizes = (process.argv[2] || '8,32,64').split(',').map(Number), map = process.argv[3] || 'tidewater', seconds = Number(process.argv[4] || 20), mode = process.argv[5] || 'turf', cpu = process.argv[6] === 'cpu';
const q = (list, p) => [...list].sort((x, y) => x - y)[Math.min(list.length - 1, Math.floor(list.length * p))], avg = list => list.reduce((s, v) => s + v, 0) / list.length;
for (const count of sizes) {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${String(i).padStart(10, '0')}`, color: '#ff5748', lobbyChoice: {} }));
  const built = performance.now(), state = rules.create({ roomId: 'measure', roundId: 'measure', players, seed: 7, nowMs: 0 }, rules.validateSettings({ map, mode, duration: 180 })), createMs = performance.now() - built;
  if (cpu) for (const player of players) rules.onPresenceChange(state, player.id, false, 0);
  const ticks = [], views = [], publics = [], privates = [], inks = []; let now = 0, revision = -1, largest = 0, privateInk = 0, joining = 0;
  for (let step = 0; step < (seconds + 5) * 60; step++) {
    const t = step / 60, inputs = new Map(cpu ? [] : players.map((p, i) => [p.id, { ...rules.neutralInput(), hasAim: true, yaw: (i % 2 ? Math.PI : 0) + Math.sin(t * .7 + i) * 1.2, pitch: -.25, moveX: Math.sin(t * .5 + i) * .7, moveY: i % 2 ? -.7 : .7, fire: Math.sin(t * 1.3 + i) > -.6, squid: Math.sin(t * .9 + i * 2) > .8, jump: step % 90 === i, sub: step % 400 === i * 7, special: step % 600 === 0 }]));
    now += 1000 / 60; const a = performance.now(); rules.tick(state, inputs, 1 / 60, now); const b = performance.now();
    if (step >= 300) ticks.push(b - a);
    if (step % 3) continue;
    const c = performance.now(), view = rules.publicView(state, { nowMs: now, phase: 'playing' }), own = players.map(p => rules.playerView(state, p.id, { nowMs: now, phase: 'playing' })), d = performance.now();
    if (step < 300) { revision = view.revision; continue; }
    // What the transport sends: cached fields only when the revision moves; a seat's private view every snapshot.
    const { ink, inkSequence, roster, settings, colors, teams, ...rest } = view, body = JSON.stringify(rest).length, cached = view.revision === revision ? 0 : JSON.stringify({ ink, inkSequence, roster, settings, colors, teams }).length; revision = view.revision; joining = Math.max(joining, body + JSON.stringify({ ink, inkSequence, roster, settings, colors, teams }).length + (own[0] ? JSON.stringify(own[0]).length : 4) + 120);
    const mine = own[0] ? JSON.stringify(own[0]).length : 4; if (own[0]?.ink) privateInk += own[0].ink.length;
    views.push(d - c); publics.push(body + cached); privates.push(mine); inks.push(ink.length); largest = Math.max(largest, body + cached + mine + 120);
  }
  const perSecond = list => Math.round(avg(list) * 20 / 102.4) / 10, view = rules.publicView(state, { nowMs: now, phase: 'playing' });
  console.log(JSON.stringify({ map, mode, players: count, arenas: view.arenas.length, seats: cpu ? 'cpu' : 'human', createMs: Math.round(createMs), tickMeanMs: +avg(ticks).toFixed(2), tickP95Ms: +q(ticks, .95).toFixed(2), tickMaxMs: +q(ticks, 1).toFixed(1), viewsMeanMs: +avg(views).toFixed(2), tvKiBs: perSecond(publics), phoneKiBs: perSecond(publics.map((size, i) => size + privates[i])), largestMessage: largest, largestOnJoin: joining, inkBaseline: Math.round(avg(inks)), inkBaselineMax: Math.max(...inks), rosterBytes: JSON.stringify(view.roster).length, coverage: view.arenas.map(arena => arena.coverage) }));
  rules.dispose(state);
}
