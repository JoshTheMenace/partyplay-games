/* Opt-in performance diagnostics for the field renderer.
 *
 * OFF unless asked for, and free when off: every entry point is a boolean test
 * and an early return, `now()` answers 0 without touching the clock, and
 * nothing is allocated. Turn it on with `?pdperf` in the page URL, or with
 * `localStorage.setItem('pd.perf', '1')` on a phone where the URL is awkward.
 *
 * It exists because "the game stutters" is three unrelated problems that look
 * identical on screen, and each has a different fix:
 *
 *   SLOW FRAMES       the renderer misses its 16.7 ms budget. `drops` climbs.
 *                     Usually pixel count: a 2x display is four times the work
 *                     for every full-screen pass.
 *   STARVED BUFFER    snapshots arrive further apart than the interpolation
 *                     delay covers, so the renderer runs past its newest one and
 *                     EVERYTHING — digger, monsters, rocks — holds still until
 *                     the next lands, then jumps. `underruns` climbs, frames can
 *                     be perfectly fast. Classic on phones over busy Wi-Fi.
 *   BUSY MAIN THREAD  something else on the page blocks the frame. Shows up as
 *                     long frame intervals with little work inside them.
 *
 * Passes can also be switched OFF, because JavaScript timers cannot see raster
 * time — a full-screen composite costs its pixels after the call returns — so
 * the honest way to price a pass is to remove it and watch the frame rate:
 *
 *   ?pdperf&pdskip=light,vfx,gutters,entities    (comma list, any subset)
 *   ?pdperf&pddpr=1                              (cap device pixel ratio)
 *
 * Nothing here is shipped to players on purpose; it is a measuring tool.
 */

const params = (() => {
  try { return new URLSearchParams(window.location.search); } catch { return null; }
})();

function stored(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** Whether diagnostics are on. Read once: toggling needs a reload. */
export const on: boolean = !!params?.has('pdperf') || stored('pd.perf') === '1';

const skipped = new Set<string>(
  on ? (params?.get('pdskip') ?? stored('pd.skip') ?? '').split(',').map(s => s.trim()).filter(Boolean) : []);

/** True when a pass has been switched off for measurement. Always false when off. */
export function skip(pass: string) { return on && skipped.has(pass); }

/** A device-pixel-ratio cap for measurement, or 0 for none. */
export const dprCap: number = on ? Number(params?.get('pddpr') ?? stored('pd.dpr') ?? 0) || 0 : 0;

/* ── rolling samples ──────────────────────────────────────────────────── */

/** Ten seconds BY THE CLOCK. A sample count only meant ten seconds at exactly
 * 60 fps: at 30 fps it described twenty, and a frozen stretch never aged out. */
const WINDOW_MS = 10_000;
/** Storage bound: ten seconds at 120 fps. */
const CAPACITY = 1200;

class Ring {
  private at = new Float64Array(CAPACITY);
  private data = new Float64Array(CAPACITY);
  private n = 0;
  private i = 0;
  push(v: number, t = performance.now()) {
    this.at[this.i] = t; this.data[this.i] = v;
    this.i = (this.i + 1) % CAPACITY; if (this.n < CAPACITY) this.n++;
  }
  private recent(t: number) {
    const out: number[] = [];
    for (let k = 0; k < this.n; k++) if (t - this.at[k] <= WINDOW_MS) out.push(this.data[k]);
    return out;
  }
  stats(t = performance.now()) {
    const s = this.recent(t).sort((a, b) => a - b);
    if (!s.length) return { p50: 0, p95: 0, max: 0, n: 0 };
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1], n: s.length };
  }
  count(pred: (v: number) => boolean, t = performance.now()) {
    return this.recent(t).filter(pred).length;
  }
  clear() { this.n = 0; this.i = 0; }
}

const sections = new Map<string, Ring>();
const intervals = new Ring();
const work = new Ring();
const snapGaps = new Ring();
const underrunMs = new Ring();
let lastFrame = 0;
let lastSnap = 0;
let underruns = 0;
let frames = 0;

/** Forget everything measured, so a new scene does not report the last one's frames. */
export function reset() {
  sections.clear(); intervals.clear(); work.clear(); snapGaps.clear(); underrunMs.clear();
  lastFrame = 0; lastSnap = 0; underruns = 0; frames = 0;
}

/** The clock, or 0 when diagnostics are off so callers never pay for it. */
export function now() { return on ? performance.now() : 0; }

/** Record time spent in a named section since `start` (from `now()`). */
export function add(section: string, start: number) {
  if (!on) return;
  let r = sections.get(section);
  if (!r) { r = new Ring(); sections.set(section, r); }
  r.push(performance.now() - start);
}

/** Call once at the top of each frame, with the rAF timestamp or `now()`. */
export function frameStart(t: number) {
  if (!on) return;
  if (lastFrame) intervals.push(t - lastFrame);
  lastFrame = t;
  frames++;
}

/** Call once at the end of each frame's work, with the start from `now()`. */
export function frameEnd(start: number) {
  if (!on) return;
  work.push(performance.now() - start);
}

/** A snapshot reached the renderer. */
export function snapshot() {
  if (!on) return;
  const t = performance.now();
  if (lastSnap) snapGaps.push(t - lastSnap);
  lastSnap = t;
}

/* The renderer asked for a moment later than the newest snapshot it holds, so
 * it is showing that snapshot frozen. `aheadMs` is by how much. This is the
 * one that makes enemies stop mid-stride while the frame rate stays perfect. */
export function underrun(aheadMs: number) {
  if (!on) return;
  underruns++;
  underrunMs.push(aheadMs);
}

/* ── the overlay ──────────────────────────────────────────────────────── */

const f1 = (v: number) => v.toFixed(1);

/** Everything, as data — for copying out of the console. */
export function report() {
  const iv = intervals.stats();
  const wk = work.stats();
  const sg = snapGaps.stats();
  const out: Record<string, unknown> = {
    fps: iv.p50 ? +(1000 / iv.p50).toFixed(1) : 0,
    frameIntervalMs: { p50: +f1(iv.p50), p95: +f1(iv.p95), max: +f1(iv.max) },
    droppedFrames10s: intervals.count(v => v > 25),
    longFrames10s: intervals.count(v => v > 50),
    jsWorkMs: { p50: +f1(wk.p50), p95: +f1(wk.p95), max: +f1(wk.max) },
    snapshotGapMs: { p50: +f1(sg.p50), p95: +f1(sg.p95), max: +f1(sg.max) },
    bufferUnderrunsTotal: underruns,
    underrunFrames10s: underrunMs.stats().n,
    skipped: [...skipped],
    dpr: window.devicePixelRatio, dprCap,
    frames,
  };
  const sec: Record<string, unknown> = {};
  for (const [name, r] of [...sections.entries()].sort()) {
    const s = r.stats();
    sec[name] = { p50: +f1(s.p50), p95: +f1(s.p95), max: +f1(s.max) };
  }
  out.sectionsMs = sec;
  return out;
}

/* Mounted by the field scene. A DOM overlay rather than canvas text, so drawing
 * the diagnostics cannot itself cost the pass it is measuring. */
export function mount(host: HTMLElement | null): () => void {
  if (!on || !host) return () => {};
  reset();
  const el = document.createElement('pre');
  el.style.cssText = [
    'position:absolute', 'right:4px', 'top:44px', 'z-index:50', 'margin:0',
    'padding:6px 8px', 'max-width:60vw', 'pointer-events:none',
    'font:11px/1.35 ui-monospace,monospace', 'color:#e8ffe8',
    'background:rgba(0,0,0,.72)', 'border-radius:6px', 'white-space:pre',
  ].join(';');
  host.appendChild(el);
  (window as unknown as { __pdPerf?: unknown }).__pdPerf = { report };

  const paint = () => {
    const r = report() as {
      fps: number; frameIntervalMs: { p95: number; max: number };
      droppedFrames10s: number; longFrames10s: number;
      jsWorkMs: { p50: number; p95: number };
      snapshotGapMs: { p95: number; max: number };
      underrunFrames10s: number; sectionsMs: Record<string, { p95: number }>;
    };
    const lines = [
      `fps ${r.fps}  interval p95 ${r.frameIntervalMs.p95} max ${r.frameIntervalMs.max}`,
      `dropped/10s ${r.droppedFrames10s}  long/10s ${r.longFrames10s}`,
      `js work p50 ${r.jsWorkMs.p50} p95 ${r.jsWorkMs.p95} ms`,
      `snapshot gap p95 ${r.snapshotGapMs.p95} max ${r.snapshotGapMs.max} ms`,
      `FROZEN (buffer underrun) frames/10s ${r.underrunFrames10s}`,
      `dpr ${window.devicePixelRatio}${dprCap ? ` cap ${dprCap}` : ''}${skipped.size ? `  skip ${[...skipped].join(',')}` : ''}`,
      ...Object.entries(r.sectionsMs).map(([k, v]) => `  ${k.padEnd(10)} p95 ${v.p95} ms`),
    ];
    el.textContent = lines.join('\n');
  };
  const timer = window.setInterval(paint, 500);
  return () => { window.clearInterval(timer); el.remove(); };
}
