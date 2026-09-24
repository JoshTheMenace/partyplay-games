/* SceneView glue: renderer + snapshot buffer + local prediction + audio + HUD overlays.
 * One animation loop per round: sample the interpolated race, swap in the predicted local kart,
 * pick viewports (split / personal / director-followed spectator), render, voice audio, and report
 * ready only after a real frame. OWNER: render-world agent. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { FrameMetrics, QualityGovernor } from '../../../party-runtime/src/index';
import { KartAudio, type AudioRole } from './audio/audio';
import { inputBus } from './input-bus';
import { RaceBuffer } from './net/interpolate';
import { KartPredictor } from './net/predict';
import { Director, type ShotViewport } from './render/camera';
import { planViewports } from './render/layout';
import { createKartRenderer, type KartRendererExt } from './render/renderer';
import type { FrameInput, QualityTier, RacerPose } from './render/types';
import { getTrack } from './tracks/index';
import { SharedHud, ViewportHud } from './ui/Hud';
import { resolveViewMode, screenMode } from './views';
import type { KartState, RaceEvent, RaceView, Settings } from './sim/types';

type Props = SceneViewProps<Settings, RaceView, null>;

/** Stand-in view while the room prepares (no racers yet): the world and item boxes, camera on the grid. */
function idleRace(settings: Settings, viewMode: 'tv' | 'personal'): RaceView {
  return { track: settings.track, laps: settings.laps, speedClass: settings.speedClass, difficulty: settings.difficulty, items: settings.items, viewMode,
    phase: 'countdown', time: -3.5, racers: [], entities: [], boxes: getTrack(settings.track).boxes.map(() => 0), events: [], serial: 0,
    firstFinish: null, endAt: null, cooldowns: { thunder: 0, comet: 0 } };
}
const readMuted = () => { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } };

export default function KartScene(props: Props) {
  const latest = useRef(props); latest.current = props;
  const canvas = useRef<HTMLCanvasElement>(null), metricsEl = useRef<HTMLPreElement>(null);
  const race = props.publicView;
  const viewMode = race?.viewMode ?? resolveViewMode(props.settings.views, props.players.length);
  const mode = screenMode(viewMode, props.playerId, !!props.isHost);
  // TV racers in stable roster order, so every player's split view stays put.
  const racerKey = (race ? race.racers.filter(r => !r.bot).map(r => r.id) : props.players.map(p => p.id))
    .sort((a, b) => props.players.findIndex(p => p.id === a) - props.players.findIndex(p => p.id === b)).join('\n');
  const [followId, setFollowId] = useState<string | null>(null);
  const viewports = useMemo(() => planViewports(mode, racerKey ? racerKey.split('\n') : [], props.playerId, followId), [mode, racerKey, props.playerId, followId]);
  const viewportsRef = useRef(viewports); viewportsRef.current = viewports;
  const bufferRef = useRef<RaceBuffer | null>(null), predictorRef = useRef<KartPredictor | null>(null);
  const showMetrics = useMemo(() => typeof location !== 'undefined' && new URLSearchParams(location.search).has('metrics'), []);
  const predicted = !!props.playerId && (mode === 'personal' || (mode === 'split' && racerKey.split('\n').includes(props.playerId)));

  useEffect(() => {
    const p = latest.current, track = p.settings.track, own = p.playerId;
    let alive = true, raf = 0, renderer: KartRendererExt | null = null, reported = false;
    const buffer = new RaceBuffer(); bufferRef.current = buffer;
    const predictor = predicted && own ? new KartPredictor(getTrack(track), own) : null; predictorRef.current = predictor;
    const unsubscribe = predictor ? inputBus.subscribe((input, at) => predictor.input(input, at)) : () => {};
    const role: AudioRole = mode === 'controls' ? 'controller' : mode === 'personal' ? 'solo' : 'display';
    const audio = new KartAudio(role, track, mode !== 'personal' || !!p.isHost); audio.muted = readMuted();
    const unlock = () => { audio.unlock(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    const sound = (e: Event) => { audio.muted = !!(e as CustomEvent<{ muted: boolean }>).detail?.muted; if (!audio.muted) audio.unlock(); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); addEventListener('party-sound', sound);
    const coarse = matchMedia('(pointer: coarse)').matches, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const governor = new QualityGovernor(3, { initialTier: coarse ? 1 : 0 }), metrics = new FrameMetrics();
    const director = new Director(), idle = idleRace(p.settings, viewMode);
    const poses = new Map<string, RacerPose>(), pool = new Map<string, { view: RaceView['racers'][number]; kart: KartState }>();
    const newEvents: RaceEvent[] = [], spectatorView: ShotViewport = { rect: { x: 0, y: 0, w: 1, h: 1 }, racerId: null, kind: 'chase', shot: 'chase' };
    const frame: FrameInput = { race: idle, poses, viewports: viewportsRef.current, quality: governor.tier as QualityTier, reducedMotion, time: 0, dt: 0, newEvents };
    const focus: string[] = [], spectatorViews = [spectatorView];
    let lastEvent = -1, last = 0, metricsAt = 0;
    if (showMetrics) Object.assign(window, { __kartScene: { buffer, predictor } });   // QA hooks (sandbox latency checks)

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      try {
        const interval = last ? now - last : 16.7; last = now;
        const sampled = buffer.sample(now), view = sampled ?? idle;
        // Poses: interpolated racers, with the local kart replaced by its prediction.
        if (poses.size !== view.racers.length) { poses.clear(); }
        let mine: KartState | null = null;
        if (predictor && sampled) for (const r of sampled.racers) if (r.id === own) mine = predictor.sample(now, r);
        for (const r of view.racers) {
          let pose = pool.get(r.id);
          if (!pose) pool.set(r.id, pose = { view: r, kart: r });
          pose.view = r; pose.kart = mine && r.id === own ? mine : r;
          poses.set(r.id, pose);
        }
        // Events first seen this frame (stale history is skipped on the first snapshot).
        newEvents.length = 0;
        if (sampled) for (const e of sampled.events) if (e.id > lastEvent) { if (lastEvent >= 0 || e.t > sampled.time - 0.75) newEvents.push(e); }
        if (sampled?.events.length) lastEvent = Math.max(lastEvent, sampled.events[sampled.events.length - 1].id);
        let vps = viewportsRef.current;
        if (mode === 'spectator') {
          const id = director.update(sampled, now / 1000);
          spectatorView.racerId = id; spectatorView.shot = director.shot; vps = spectatorViews;
          if (id !== latestFollow.current) { latestFollow.current = id; setFollowId(id); }
        }
        const tier = governor.frame(interval, now) as QualityTier;
        metrics.record(interval);
        frame.race = view; frame.viewports = vps; frame.quality = vps.length > 4 ? 2 : tier; frame.time = now / 1000; frame.dt = Math.min(interval / 1000, 0.1);
        frame.moverTime = mine && predictor ? now / 1000 + predictor.lead() : undefined;   // bumpers where they hit our predicted kart
        renderer?.render(frame);
        focus.length = 0;
        for (const v of vps) if (v.racerId) focus.push(v.racerId);
        if (mode === 'controls' && own) focus.push(own);
        // The predicted kart voices its own engine, drift chimes and kart events at once (no round trip).
        const events = predictor?.takeEvents() ?? [];
        audio.update(sampled, focus, newEvents, frame.dt, mine && own ? { id: own, kart: mine, events } : null);
        if (!reported && (mode === 'controls' || renderer?.ready())) { reported = true; latest.current.onReady(); }
        if (showMetrics && metricsEl.current && now - metricsAt > 500) {
          metricsAt = now; const m = metrics.snapshot(), s = renderer?.stats();
          metricsEl.current.textContent = `p50 ${m.p50Ms.toFixed(1)}ms p95 ${m.p95Ms.toFixed(1)}ms slow ${m.slowFrames}\ntier ${frame.quality} dpr ${s?.pixelRatio ?? '-'} views ${s?.viewports ?? 0}\ncalls/view ${s?.calls ?? 0} tris/view ${s?.triangles ?? 0}\ngeo ${s?.geometries ?? 0} tex ${s?.textures ?? 0}${predictor ? `\nahead ${((predictor.lead() + now / 1000 - view.time) * 1000).toFixed(0)}ms fix ${predictor.errorMeters.toFixed(2)}m buf ${buffer.delayMs.toFixed(0)}ms` : ''}`;
        }
      } catch (error) { alive = false; cancelAnimationFrame(raf); latest.current.onError(error); }
    };
    if (mode === 'controls') raf = requestAnimationFrame(loop);
    else void createKartRenderer(canvas.current!, { track, signal: p.signal, quality: governor.tier as QualityTier, onError: e => { if (alive) latest.current.onError(e); } })
      .then(r => { if (!alive) { r.dispose(); return; } renderer = r; raf = requestAnimationFrame(loop); }, e => { if (alive && !(e instanceof DOMException && e.name === 'AbortError')) latest.current.onError(e); });
    return () => {
      alive = false; cancelAnimationFrame(raf); renderer?.dispose(); audio.dispose(); unsubscribe();
      removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); removeEventListener('party-sound', sound);
      buffer.reset(); predictor?.reset(); bufferRef.current = null; predictorRef.current = null; director.reset(); latestFollow.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.roundId, props.signal, mode, props.settings.track, predicted]);
  const latestFollow = useRef<string | null>(null);

  // Feed every authoritative snapshot to the interpolation buffer and the predictor.
  useEffect(() => {
    const view = props.publicView, at = props.snapshotTime;
    if (!view || at === null) return;
    bufferRef.current?.push(view, at, performance.now());
    predictorRef.current?.reconcile(view, at, props.serverNowMs());
  }, [props.publicView, props.snapshotTime]);

  if (mode === 'controls') return null;
  const hudMode = mode === 'spectator' ? 'spectator' : mode === 'personal' ? 'personal' : 'split';
  return (
    <div className="kp2-scene" data-screen={mode} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0b0a14' }}>
      <canvas ref={canvas} className="kp2-canvas" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none' }}/>
      {race && mode !== 'spectator' && viewports.map(vp => {
        const racer = vp.racerId ? race.racers.find(r => r.id === vp.racerId) : undefined;
        return racer ? <ViewportHud key={racer.id} race={race} racer={racer} rect={vp.rect} viewports={viewports.length} showControlsHint={racer.id === props.playerId}/> : null;
      })}
      {race && <SharedHud race={race} followId={mode === 'spectator' ? followId : null} mode={hudMode}/>}
      {showMetrics && <pre ref={metricsEl} style={{ position: 'absolute', right: 8, bottom: 8, margin: 0, padding: '6px 8px', font: '11px/1.35 ui-monospace, monospace', color: '#d8ffe0', background: 'rgba(0,0,0,0.6)', borderRadius: 6, pointerEvents: 'none', zIndex: 50 }}/>}
    </div>
  );
}
