/**
 * Module-aware CPU acceptance: CPU-only matches for every module alone and the main combinations
 * (configs.ts) at the suggested target, 4 and 10 seats, Standard and Connect. Every game must have
 * zero rejected actions and zero planning errors (decide() falling back to its safety net), and end
 * by target within the round limit. Matches run on a worker pool (CPU_POOL, default half the cores,
 * leaving room for timing-sensitive suites running beside it).
 * CPU_MODULE_SEEDS=n plays n seeds per cell (the heavy sweep); CPU_MODULES=a,b limits the configs.
 * Reproduce one game: node --import tsx <game>/tests/cpu/sweep.ts <config> <seats> <mode> <seed>.
 */
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { CONFIGS } from './configs';
import { enginePlays } from './match';
import type { Job, Outcome } from './matrix-worker';

const seeds = Number(process.env.CPU_MODULE_SEEDS ?? 1);
const only = process.env.CPU_MODULES?.split(',');
const labels = Object.keys(CONFIGS).filter(l => l !== 'base' && (!only || only.includes(l)));

/** Fixed seed per cell, so a failure reproduces with sweep.ts. */
const seedOf = (label: string, seats: number, mode: string) =>
  1 + [...`${label}${seats}${mode}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7);

const cells = labels.flatMap(label => [4, 10].flatMap(seats =>
  (['standard', 'connect'] as const).map(mode => ({ label, seats, mode }))));
const jobs: Job[] = cells.flatMap(cell => Array.from({ length: seeds }, (_, k) =>
  ({ ...cell, seed: seedOf(cell.label, cell.seats, cell.mode) + k })));

/**
 * Connect plays one roll per round and caps rounds at 100 (× 1.5 with C&K). Seafarers maps (13 VP)
 * and 10-seat C&K (a full board, 13 VP) need about that many rolls with any CPU, so a few seeds end
 * by the round limit (a cap calibration, not a stall). Default run: one retry on the next seed.
 * Heavy sweep: at least 3 in 4 seeds finish. Every other cell must always finish.
 */
const tight = (j: Job) => j.mode === 'connect'
  && (/shores|islands|seafarers/.test(j.label) || (j.seats === 10 && /^(cities-knights|ck\+)/.test(j.label)));

/** Heaviest cells first so the pool drains evenly. */
const weight = (j: Job) =>
  j.seats * (j.mode === 'connect' ? 2 : 1) * (/ck|explorers|ep|shores|islands/.test(j.label) ? 2 : 1);

function pool(list: Job[]): Promise<Outcome[]> {
  const queue = [...list].sort((a, b) => weight(b) - weight(a)), out: Outcome[] = [];
  const cores = Number(process.env.CPU_POOL ?? Math.floor(availableParallelism() / 2));
  const size = Math.max(1, Math.min(queue.length, cores));
  const retried = new Set<string>();
  return new Promise((resolve, reject) => {
    let live = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./matrix-worker.ts', import.meta.url));
      const next = () => {
        if (queue.length) return w.postMessage(queue.shift());
        void w.terminate();
        if (--live === 0) resolve(out);
      };
      w.on('message', (o: Outcome) => {
        out.push(o);
        const cell = `${o.label} ${o.seats} ${o.mode}`;
        if (seeds === 1 && tight(o) && o.reason !== 'target' && !retried.has(cell)) {
          retried.add(cell);
          queue.unshift({ label: o.label, seats: o.seats, mode: o.mode, seed: o.seed + 1 });
        }
        next();
      });
      w.on('error', reject);
      next();
    }
  });
}

const skip = enginePlays() ? false : 'engine does not play a full game yet';
const results = skip ? Promise.resolve([] as Outcome[]) : pool(jobs);

const where = (o: Outcome) => `${o.seats} ${o.mode} seed ${o.seed}`;

for (const label of labels) {
  test(`${label}: CPU games at 4 and 10 seats, Standard and Connect, finish by target`, { skip }, async () => {
    const mine = (await results).filter(x => x.label === label);
    const broken = mine.flatMap(o => [...o.rejected.map(r => `${where(o)}: rejected ${r}`),
      ...o.errors.map(e => `${where(o)}: planning error ${e}`)]);
    assert.deepEqual(broken, [], label);
    const late: string[] = [];
    for (const seats of [4, 10]) for (const mode of ['standard', 'connect'] as const) {
      const games = mine.filter(o => o.seats === seats && o.mode === mode);
      const done = games.filter(o => o.reason === 'target');
      const need = !tight(games[0]) ? games.length : seeds === 1 ? 1 : Math.ceil(0.75 * games.length);
      if (done.length < need) late.push(...games.filter(o => o.reason !== 'target')
        .map(o => `${where(o)}: ended ${o.reason} after ${o.rounds} rounds (target ${o.target})`));
    }
    assert.deepEqual(late, [], label);
  });
}
