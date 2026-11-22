/* Simulation cost per 60 Hz tick at several field sizes: node --import tsx tools/bench.ts [track] [seconds]
 * Every racer is driven by the CPU driver (the worst case: a seat whose phone dropped is autopiloted too), and the
 * figures include the snapshot projection the server builds 30 times a second. Run it on an idle machine. */
import { performance } from 'node:perf_hooks';
import { rules } from '../src/server';
import { botInput } from '../src/sim/ai';
import type { Input, TrackId } from '../src/sim/types';

const track = (process.argv[2] ?? 'palm-bay') as TrackId, seconds = Number(process.argv[3] ?? 60);
for (const [humans, cpus] of [[1, 9], [10, 0], [32, 0], [64, 0], [1, 31], [1, 63]]) {
  const players = Array.from({ length: humans }, (_, i) => ({ id: `0f3c2a4e-7b1d-4c8e-9a6f-2d5b8e1c7a${String(i).padStart(2, '0')}`, name: `Racer ${i + 1}`, color: '#f5a' }));
  const race = rules.create({ roomId: 'bench', roundId: 'bench', players, seed: 7, nowMs: 0 }, rules.validateSettings({ track, laps: 5, gridSize: humans + cpus }));
  const ticks: number[] = [], inputs = new Map<string, Input>();
  let ai = 0, snap = 0, bytes = 0, snaps = 0, own = 0;
  for (let i = 0; i < seconds * 60 && race.phase !== 'results'; i++) {
    const t0 = performance.now();
    for (const r of race.racers) if (!r.bot && r.finishTime === null) inputs.set(r.id, { ...botInput(race, r), seq: i + 1 });
    const t1 = performance.now();
    rules.tick(race, inputs, 1 / 60, i * 1000 / 60);
    const t2 = performance.now();
    ai += t1 - t0; ticks.push(t2 - t1);
    if (i % 2 === 0) {
      const { base: _base, players: _players, final: _final, ...sent } = rules.publicView(race, { nowMs: 0, phase: 'playing' }); void _base; void _players; void _final;   // the cached parts go out once per socket
      const json = JSON.stringify(sent), mine = JSON.stringify(rules.playerView(race, players[0].id, { nowMs: 0, phase: 'playing' }));
      snap += performance.now() - t2; if (race.phase === 'racing') { bytes += json.length; own += mine.length; snaps++; }
    }
  }
  ticks.sort((a, b) => a - b);
  const mean = ticks.reduce((s, t) => s + t, 0) / ticks.length, at = (q: number) => ticks[Math.floor((ticks.length - 1) * q)];
  console.log(`${String(humans).padStart(2)} humans + ${String(cpus).padStart(2)} CPUs: tick mean ${mean.toFixed(3)} ms, p50 ${at(.5).toFixed(3)}, p99 ${at(.99).toFixed(3)}, max ${at(1).toFixed(2)}`
    + ` | human steering (not server work) ${(ai / ticks.length).toFixed(3)} ms/tick | snapshot ${(snap / (ticks.length / 2)).toFixed(3)} ms, ${Math.round(bytes / snaps)} B public + ${Math.round(own / snaps)} B private`);
}
