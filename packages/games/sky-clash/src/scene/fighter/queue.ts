/**
 * Keyed, shared, abortable job queue with bounded concurrency: one job per key per page, callers share it, and a job
 * nobody waits for any more is cancelled and forgotten (so a later round can retry). Failed jobs are forgotten too.
 */
const abortError = (signal: AbortSignal) => signal.reason instanceof Error ? signal.reason : new DOMException('Loading was cancelled.', 'AbortError');

export function keyedLoader<K, V>(run: (key: K, signal: AbortSignal) => Promise<V>, limit = 3) {
  type Job = { key: K; promise: Promise<V>; waiting: number; controller: AbortController; start: () => void; started: boolean };
  const jobs = new Map<K, Job>(), queue: Job[] = [];
  let running = 0;
  const pump = () => { while (running < limit && queue.length) { const j = queue.shift()!; if (j.waiting > 0) { running++; j.start(); } } };
  const job = (key: K): Job => {
    const existing = jobs.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    let start!: () => void;
    const promise = new Promise<V>((resolve, reject) => {
      start = () => { entry.started = true; new Promise<V>(r => r(run(key, controller.signal))).then(resolve, reject).finally(() => { running--; pump(); }); };
    });
    const entry: Job = { key, promise, waiting: 0, controller, start, started: false };
    promise.catch(() => { if (jobs.get(key) === entry) jobs.delete(key); });
    jobs.set(key, entry); queue.push(entry);
    return entry;
  };
  return {
    get running() { return running; },
    /** Resolves every requested key (duplicates collapse). Aborting rejects this call and cancels jobs nobody else needs. */
    load(keys: readonly K[], signal: AbortSignal): Promise<Map<K, V>> {
      if (signal.aborted) return Promise.reject(abortError(signal));
      const list = [...new Set(keys)].map(job);
      for (const j of list) j.waiting++;
      pump();
      return new Promise<Map<K, V>>((resolve, reject) => {
        let done = false;
        const release = () => { if (done) return false; done = true; signal.removeEventListener('abort', stop); for (const j of list) j.waiting--; return true; };
        const stop = () => {
          if (!release()) return;
          reject(abortError(signal));
          for (const j of list) if (j.waiting <= 0) {
            if (jobs.get(j.key) === j) jobs.delete(j.key);
            if (j.started) j.controller.abort(); else { const i = queue.indexOf(j); if (i >= 0) queue.splice(i, 1); }
          }
        };
        signal.addEventListener('abort', stop, { once: true });
        Promise.all(list.map(j => j.promise)).then(values => { if (release()) resolve(new Map(list.map((j, i) => [j.key, values[i]]))); }, error => { if (release()) reject(error); });
      });
    },
  };
}
