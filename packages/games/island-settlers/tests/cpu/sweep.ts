/**
 * Replays module CPU matches outside the test runner, one JSON line per game:
 * node --import tsx <game>/tests/cpu/sweep.ts <config|all> [seats] [mode] [seed]
 */
import { runMatch } from './match';
import { CONFIGS } from './configs';

const [name, seatsArg, modeArg, seedArg] = process.argv.slice(2);
const seatList = seatsArg ? [Number(seatsArg)] : [4, 10], modes = modeArg ? [modeArg] : ['standard', 'connect'];
for (const [label, settings] of Object.entries(CONFIGS)) {
  if (name && name !== 'all' && label !== name) continue;
  for (const seats of seatList) for (const mode of modes) {
    const t = performance.now(), seed = Number(seedArg ?? 1);
    const r = runMatch({ seats, seed, settings: { ...settings, mode: mode as 'standard' } });
    console.log(JSON.stringify({
      label, seats, mode, seed, reason: r.reason, rounds: r.rounds, target: r.s.settings.targetPoints,
      ms: Math.round(performance.now() - t), p95: +r.p95.toFixed(2), rejected: r.rejected.length,
      errors: r.errors.length, autos: r.autos, firstRej: r.rejected[0]?.slice(0, 300),
      firstErr: r.errors[0]?.slice(0, 300), commands: r.commands,
      vp: r.s.order.map(id => r.s.results?.standings.find(x => x.seat === id)?.vp),
    }));
  }
}
