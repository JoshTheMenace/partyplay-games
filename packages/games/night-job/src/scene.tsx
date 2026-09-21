/* The shared screen's canvas: the whole floor, always. Snapshots are presented ~100 ms behind arrival and
 * interpolated per actor; a guard missing from either neighbouring snapshot is drawn from the newest one
 * only, never carried forward. Phones render no scene; they are controllers. */
import { useEffect, useRef } from 'react';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import type { SceneViewProps } from '../../../party-ui/src/index';
import type { Point, Settings, View } from './model';
import { getMap } from './maps';
import { createRenderer } from './render';

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 3;
export function blend(a: View, b: View, k: number): View {
  const players = b.players.map(p => { const q = a.players.find(o => o.id === p.id); return q && near(p, q) && !p.suspended ? { ...p, x: lerp(q.x, p.x, k), y: lerp(q.y, p.y, k) } : p; });
  const guards = b.guards.map(g => { const q = a.guards.find(o => o.id === g.id); if (!q || !near(g, q)) return g; const turn = Math.atan2(Math.sin(g.facing - q.facing), Math.cos(g.facing - q.facing)); return { ...g, x: lerp(q.x, g.x, k), y: lerp(q.y, g.y, k), facing: q.facing + turn * k }; });
  return { ...b, players, guards, now: lerp(a.now, b.now, k) };
}

export function NightJobScene(props: SceneViewProps<Settings, View, null>) {
  const canvas = useRef<HTMLCanvasElement>(null), live = useRef(props); live.current = props;
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const scope = new ResourceScope(props.signal), renderer = createRenderer(element); scope.defer(renderer.dispose);
    const observer = new ResizeObserver(renderer.resize); observer.observe(element.parentElement ?? element); scope.defer(() => observer.disconnect());
    const buffer = new SnapshotBuffer<View>(100, 32, { adaptive: { minMs: 75, maxMs: 150 }, monotonic: true, resetGapMs: 500 });
    scope.listen(document, 'visibilitychange', () => { if (document.hidden) buffer.clear(); });
    let heist: string | null = null, lastTime: number | null = null, ready = false, failures = 0, handle = 0;
    const frame = (now: number) => {
      const p = live.current, raw = p.publicView;
      try {
        let shown: View | null = null;
        if (raw) {
          if (raw.heistId !== heist) { heist = raw.heistId; buffer.clear(); }
          if (p.snapshotTime !== null && p.snapshotTime !== lastTime) { lastTime = p.snapshotTime; buffer.push(p.snapshotTime, raw, now); }
          shown = buffer.sample(p.serverNowMs(), blend) ?? raw;
        }
        renderer.draw(getMap(raw?.mission ?? p.settings?.mission ?? 'velvet') ?? getMap('velvet'), shown, null, shown?.now ?? p.serverNowMs(), now);
        failures = 0;
        if (!ready) { ready = true; if (!p.signal.aborted) p.onReady(); }
      } catch (error) { if (++failures === 1) console.error('[night-job] frame failed; the loop continues', error); if (failures === 180 && !p.signal.aborted) p.onError(error); }
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame); scope.defer(() => cancelAnimationFrame(handle));
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <canvas ref={canvas} className="nj-canvas" aria-label="Heist floor plan"/>;
}
