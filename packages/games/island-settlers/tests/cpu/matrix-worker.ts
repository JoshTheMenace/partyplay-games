/** Worker for modules.test.ts: plays one CPU-only match per message and posts its summary. */
import { parentPort } from 'node:worker_threads';
import type { Mode } from '../../src/model';
import { CONFIGS } from './configs';
import { runMatch } from './match';

export type Job = { label: string; seats: number; mode: Mode; seed: number };
export type Outcome = Job & {
  reason: string | null; rounds: number; target: number; rejected: string[]; errors: string[]; autos: number;
  ms: number; p95: number;
};

parentPort?.on('message', (job: Job) => {
  const t = performance.now();
  const r = runMatch({ seats: job.seats, seed: job.seed, settings: { ...CONFIGS[job.label], mode: job.mode } });
  const out: Outcome = {
    ...job, reason: r.reason, rounds: r.rounds, target: r.s.settings.targetPoints,
    rejected: r.rejected.slice(0, 3), errors: r.errors.slice(0, 3), autos: r.autos,
    ms: Math.round(performance.now() - t), p95: r.p95,
  };
  parentPort!.postMessage(out);
});
