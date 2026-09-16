import { useEffect, useRef, useState } from 'react';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { viewportRect } from './engine/split-screen';
import { createRenderer } from './engine/renderer';
import { GameAudio } from './engine/audio';
import { createRace } from './engine/simulation';
import { FrameMetrics, QualityGovernor } from '../../../party-runtime/src/index';
import { createMotionBuffer, PARTY_PRESENTATION } from './engine/motion-buffer';
import type { Race } from './engine/types';
import type { Settings } from './server';
import { createRaceDirector, screenMode } from './views';
export default function KartScene(props: SceneViewProps<Settings, Race>) {
  const screen = screenMode(props.settings.views, props.players.length, props.playerId, props.isHost);
  const [following, setFollowing] = useState(''), [diagnostics, setDiagnostics] = useState('');
  const container = useRef<HTMLDivElement>(null), latest = useRef(props), buffer = useRef(createMotionBuffer<Race>(PARTY_PRESENTATION)); latest.current = props;
  useEffect(() => { if (props.publicView) buffer.current.push(props.publicView, performance.now()/1000); }, [props.publicView]);
  useEffect(() => {
    const renderer = createRenderer(container.current!, message => latest.current.onError(Error(message)));
    if (!renderer) return;
    const audio = new GameAudio(), mode = props.isHost ? props.playerId ? 'solo' : 'display' : 'controller';
    const unlock = () => { try { audio.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch {} audio.start(props.settings.track, props.settings.speedClass, mode); };
    const sound = (event: Event) => { audio.muted = (event as CustomEvent<{ muted: boolean }>).detail.muted; if (!audio.muted) unlock(); };
    unlock(); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); window.addEventListener('party-sound', sound);
    const preview = createRace({ ...props.settings, players: props.players.map((player, driver) => ({ ...player, driver })) });
    const direct = createRaceDirector(), metrics = new FrameMetrics(), governor = new QualityGovernor(2, { initialTier: matchMedia('(pointer: coarse)').matches ? 1 : 0 });
    let reported = 0;
    let frame = 0, previous = performance.now(), ready = false, previousFocus = '';
    const render = (now: number) => {
      if (props.signal.aborted) return;
      try {
        const current = latest.current, presented = buffer.current.sample(now/1000), race = presented?.race ?? current.publicView ?? preview;
        const focus = screen === 'spectator' ? direct(race) : current.playerId ?? '';
        const playerIds = screen === 'split' ? props.players.map(player => player.id) : [focus];
        const touch = matchMedia('(pointer: coarse)').matches, interval = now - previous;
        metrics.record(interval); const tier = governor.frame(interval, now);
        if (now - reported > 1000 && new URLSearchParams(location.search).has('metrics')) { reported = now; setDiagnostics(JSON.stringify({ ...metrics.snapshot(), tier, delayMs: Math.round((presented?.delaySeconds ?? .1) * 1000) }, null, 2)); }
        const changed = screen !== 'split' && focus !== previousFocus;
        const rendered = renderer.render({ race, track: props.settings.track, playerIds, quality: tier ? 'performance' : 'high', touchControls: touch && screen === 'personal', paused: false, interpolated: !!presented, snappedIds: changed ? [...(presented?.snappedIds ?? []), focus] : presented?.snappedIds }, Math.min(.1,(now-previous)/1000), now/1000);
        if (rendered && changed) { previousFocus = focus; if (screen === 'spectator') setFollowing(focus); }
        audio.update(current.publicView, focus, false, mode);
        previous = now;
        if (rendered && !ready) { ready = true; current.onReady(); }
        frame = requestAnimationFrame(render);
      } catch (error) { latest.current.onError(error); }
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); renderer.dispose(); audio.dispose(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('party-sound', sound); buffer.current.reset(); };
  }, [props.roundId, props.signal, screen]);
  const followed = props.publicView?.racers.find(racer => racer.id === following);
  return <div ref={container} className="pk-canvas" data-quality-diagnostics={!!diagnostics || undefined} data-screen={screen} data-following={screen === 'personal' ? props.playerId : following}>{diagnostics && <details className="pk-metrics"><summary>Scene stats</summary><pre>{diagnostics}</pre></details>}{screen === 'spectator' && <span className="pk-racer-label pk-broadcast">Following {followed?.name ?? 'the race'}{followed && ` · #${followed.rank} · Lap ${followed.lap}/${props.publicView!.laps}`}</span>}{screen === 'split' && props.players.length > 1 && props.players.map((player,index) => {
    const rect = viewportRect(props.players.length,index), racer = props.publicView?.racers.find(r => r.id === player.id);
    return <span className="pk-racer-label" key={player.id} style={{ left:`${rect.x*100}%`, top:`${rect.y*100}%` }}>{player.name}{racer && ` · #${racer.rank} · Lap ${racer.lap}/${props.publicView!.laps}`}</span>;
  })}</div>;
}
