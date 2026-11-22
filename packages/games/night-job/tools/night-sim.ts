/* Headless nights: the real rules at 30 Hz with a crew bot on every seat, each playing from the snapshots its phone would get.
 * Prints how many crews got away and when, the simulation cost per tick and the bytes a phone and the TV receive.
 *   node --import tsx packages/games/night-job/tools/night-sim.ts --players 32 --mission velvet --runs 3 [--relaxed] [--minutes 10] */
import { parseArgs } from 'node:util';
import { rules } from '../src/server';
import { CREWS, crewOfSeat, crewStarts, type Input, type MissionId } from '../src/model';
import { decode, ownView } from '../src/wire';
import { botChoice, crewBot } from './bot';

const { values } = parseArgs({ options: { players: { type: 'string', default: '4' }, mission: { type: 'string', default: 'velvet' }, runs: { type: 'string', default: '3' }, relaxed: { type: 'boolean', default: false }, minutes: { type: 'string', default: '11' }, seed: { type: 'string', default: '1' }, verbose: { type: 'boolean', default: false } } });
const STEP = 1 / 30, count = Number(values.players), ctxOf = (wall: number) => ({ nowMs: wall, phase: 'playing' as const });
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export function night(players: number, mission: MissionId, seed: number, relaxed: boolean, minutes: number) {
  const settings = rules.validateSettings({ mission, difficulty: relaxed ? 'relaxed' : 'normal' });
  const roster = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Thief Number ${String(i + 1).padStart(3, '0')}`, color: `hsl(${i * 47 % 360} 80% 65%)`, lobbyChoice: botChoice(i - crewStarts(players)[crewOfSeat(players, i)]) }));
  let wall = 1000;
  const state = rules.create({ roomId: 'sim', roundId: 'night', seed, nowMs: wall, players: roster }, settings), bots = roster.map(p => crewBot(p.id)), held = new Map<string, Input>();
  let ticks = 0, spent = 0, worst = 0, snapshots = 0, publicBytes = 0, privateBytes = 0, biggest = 0, projected = 0;
  while (!rules.outcome(state).complete && wall < minutes * 60000) {
    if (ticks % 3 === 0) {   // snapshots at 10 Hz here: bots think on them (a phone gets 20 Hz)
      // `base` and `final` ride once per socket (manifest snapshotCache), so they are not part of a snapshot's repeated bytes.
      const at = performance.now(), wire = rules.publicView(state, ctxOf(wall)), bytes = size({ ...wire, base: undefined, final: undefined }); snapshots++; publicBytes += bytes; biggest = Math.max(biggest, bytes);
      for (const [i, p] of roster.entries()) {
        const own = rules.playerView(state, p.id, ctxOf(wall)); privateBytes += size(own) / players;
        const view = ownView(wire, own, p.id)!, move = bots[i](view); held.set(p.id, rules.parseInput(move.input));
        if (move.tool) try { rules.applyAction(state, p.id, { type: 'tool', heistId: view.heistId }, wall); } catch { /* refused: no charge or nothing to do */ }
      }
      projected += performance.now() - at;
    }
    wall += 1000 * STEP; const at = performance.now(); rules.tick(state, held, STEP, wall); const took = performance.now() - at; spent += took; worst = Math.max(worst, took); ticks++;
  }
  const lines = decode(rules.publicView(state, ctxOf(wall))).lines;
  return { lines, seconds: (wall - 1000) / 1000, tick: spent / ticks, worst, publicBytes: publicBytes / snapshots, privateBytes: privateBytes / snapshots, biggest, complete: rules.outcome(state).complete };
}

if (process.argv[1]?.endsWith('night-sim.ts')) for (let run = 0; run < Number(values.runs); run++) {
  const r = night(count, values.mission as MissionId, Number(values.seed) + run * 101, values.relaxed, Number(values.minutes)), away = r.lines.filter(l => l.phase === 'clear');
  console.log(`${values.mission} ${count}p seed ${Number(values.seed) + run * 101}: ${away.length}/${r.lines.length} crews away${away.length ? ` (first ${Math.min(...away.map(l => l.seconds))}s, last ${Math.max(...away.map(l => l.seconds))}s)` : ''}, night ${Math.round(r.seconds)}s${r.complete ? '' : ' (cut off)'}, bails ${r.lines.reduce((n, l) => n + l.bails, 0)}, loot ${r.lines.reduce((n, l) => n + l.collected, 0)} | tick ${r.tick.toFixed(2)} ms avg ${r.worst.toFixed(1)} max | public ${Math.round(r.publicBytes)} B avg ${r.biggest} max, private ${Math.round(r.privateBytes)} B avg → ${((r.publicBytes + r.privateBytes) * 20 / 1024).toFixed(0)} KiB/s a phone at 20 Hz`);
  if (values.verbose) for (const l of [...r.lines].sort((a, b) => a.place - b.place)) console.log(`   ${l.place}. ${CREWS[l.crew].name.padEnd(8)} ${l.phase.padEnd(10)} ${String(l.seconds).padStart(4)}s loot ${String(l.collected).padStart(3)} bails ${l.bails}${l.taken ? ' goods' : ''}`);
}
