/** A server clock the preview controls: starts at the fixture's `now` + offset, can pause and jump. */
export type Clock = { now(): number; running(): boolean; toggle(): void; jump(ms: number): void };

export function makeClock(start: number, paused: boolean): Clock {
  let base = start, since = performance.now(), running = !paused;
  const now = () => base + (running ? performance.now() - since : 0);
  const rebase = (ms: number, run: boolean) => { base = now() + ms; since = performance.now(); running = run; };
  return { now, running: () => running, toggle: () => rebase(0, !running), jump: ms => rebase(ms, running) };
}
