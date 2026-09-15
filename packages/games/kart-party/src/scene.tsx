import { useEffect, useRef } from 'react';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { viewportRect } from '../../../../modules/kart-party/game/split-screen';
import { createRenderer, KART_QUALITY_TIERS } from '../../../../modules/kart-party/game/renderer';
import { kartModelPreparationMetrics } from '../../../../modules/kart-party/game/powerup-models';
import { FrameMetrics, QualityGovernor } from '../../../party-runtime/src/index';
import { GameAudio } from '../../../../modules/kart-party/game/audio';
import { createRace } from '../../../../modules/kart-party/game/simulation';
import { createMotionBuffer, PARTY_PRESENTATION } from '../../../../modules/kart-party/game/motion-buffer';
import { cameraPlayerIds, hasPersonalCamera } from '../../../../modules/kart-party/game/personal-camera';
import type { Race } from '../../../../modules/kart-party/game/types';
import type { Settings } from './server';
export default function KartScene(props: SceneViewProps<Settings, Race>) {
  const container = useRef<HTMLDivElement>(null), latest = useRef(props), buffer = useRef(createMotionBuffer<Race>(PARTY_PRESENTATION)); latest.current = props;
  useEffect(() => { if (props.publicView) buffer.current.push(props.publicView, performance.now()/1000); }, [props.publicView]);
  useEffect(() => {
    const renderer = createRenderer(container.current!, message => latest.current.onError(Error(message)));
    if (!renderer) return;
    const audio = new GameAudio(), mode = props.viewRole === 'controller' ? 'controller' : props.playerId ? 'solo' : 'display';
    const unlock = () => { try { audio.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch {} audio.start(props.settings.track, props.settings.speedClass, mode); };
    const sound = (event: Event) => { audio.muted = (event as CustomEvent<{ muted: boolean }>).detail.muted; if (!audio.muted) unlock(); };
    // A suspended tab resumes from fresh snapshots rather than replaying the stale ones.
    // Phones only: sustained slow frames lower resolution and particle volume; see QualityGovernor.
    const governor = matchMedia('(pointer: coarse)').matches ? new QualityGovernor(KART_QUALITY_TIERS) : null;
    // Opt-in diagnostics (?kartperf): frame intervals, render work, presentation delay and tier, logged every ten seconds from this mount.
    const diagnostics = new URLSearchParams(location.search).has('kartperf') ? { intervals: new FrameMetrics(), work: new FrameMetrics(), snapshotGaps: new FrameMetrics(), since: performance.now(), lastSnapshotSerial:-1, lastSnapshotAt:0, lastRaceTime:-1, frozenFrames:0, qualityChanges:0, lastTier:0 } : null;
    const perfOutput=diagnostics?document.createElement('output'):null;if(perfOutput){perfOutput.className='pk-perf';perfOutput.setAttribute('aria-label','Kart performance diagnostics');perfOutput.textContent='MEASURING…';container.current!.appendChild(perfOutput);}
    const hidden = () => { if (document.hidden) { buffer.current.reset(); governor?.reset(); } };
    unlock(); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); window.addEventListener('party-sound', sound); document.addEventListener('visibilitychange', hidden);
    const preview = createRace({ ...props.settings, players: props.players.map((player, driver) => ({ ...player, driver })) });
    let frame = 0, previous = performance.now(), ready = false, audioFaulted = false;
    const render = (now: number) => {
      if (props.signal.aborted) return;
      try {
        const current = latest.current, presented = buffer.current.sample(now/1000), race = presented?.race ?? current.publicView ?? preview;
        if(diagnostics&&current.publicView&&current.publicView.serial!==diagnostics.lastSnapshotSerial){if(diagnostics.lastSnapshotAt)diagnostics.snapshotGaps.record(now-diagnostics.lastSnapshotAt);diagnostics.lastSnapshotAt=now;diagnostics.lastSnapshotSerial=current.publicView.serial;}
        // Audio tracks race events and countdown even while this phone's camera is off.
        // A sound fault is logged once and never ends the round or stops the picture.
        try { audio.update(current.publicView, current.playerId ?? '', false, mode); } catch (error) { if (!audioFaulted) { audioFaulted = true; console.error('[kart] audio update failed; the race view continues', error); } }
        if (ready && current.viewRole === 'controller' && !hasPersonalCamera(race,current.playerId)) { previous=now; frame=requestAnimationFrame(render); return; }
        const qualityTier = governor ? governor.frame(now - previous, now) : 0;
        if(diagnostics&&qualityTier!==diagnostics.lastTier){diagnostics.qualityChanges++;diagnostics.lastTier=qualityTier;}
        diagnostics?.intervals.record(now - previous);
        const workStart = diagnostics ? performance.now() : 0;
        const rendered = renderer.render({ race, track: props.settings.track, playerIds: cameraPlayerIds(race,props.players.map(player => player.id),current.viewRole,current.playerId), localPlayerId:current.playerId??undefined, personalView:current.viewRole==='controller', quality: matchMedia('(pointer: coarse)').matches ? 'performance' : 'high', paused: false, interpolated: !!presented, snappedIds: presented?.snappedIds, qualityTier }, Math.min(.1,(now-previous)/1000), now/1000);
        if (diagnostics) {
          diagnostics.work.record(performance.now() - workStart);
          if(race.phase==='racing'&&race.time===diagnostics.lastRaceTime)diagnostics.frozenFrames++;diagnostics.lastRaceTime=race.time;
          if (now - diagnostics.since >= 10000) {
            const report={capturedAt:new Date().toISOString(),frameIntervalMs:diagnostics.intervals.snapshot(),renderWorkMs:diagnostics.work.snapshot(),snapshotGapMs:diagnostics.snapshotGaps.snapshot(),presentationDelayMs:Math.round((presented?.delaySeconds??0)*1000),qualityTier,qualityChanges:diagnostics.qualityChanges,frozenFrames:diagnostics.frozenFrames,renderer:renderer.metrics(),preparation:kartModelPreparationMetrics()};
            console.info('[kart-perf]',JSON.stringify(report));(window as Window&{__kartPerf?:unknown}).__kartPerf=report;
            if(perfOutput)perfOutput.textContent=`FRAME ${report.frameIntervalMs.p50Ms.toFixed(1)} / ${report.frameIntervalMs.p95Ms.toFixed(1)} ms · WORK ${report.renderWorkMs.p95Ms.toFixed(1)} ms · TIER ${qualityTier}\nDRAW ${report.renderer.calls} · TRI ${Math.round(report.renderer.triangles/1000)}k · GEO ${report.renderer.geometries} · TEX ${report.renderer.textures}\nPREP ${report.preparation.milliseconds.toFixed(0)} ms · ${(report.preparation.bytes/1048576).toFixed(2)} MiB · DELAY ${report.presentationDelayMs} ms`;
            diagnostics.intervals=new FrameMetrics();diagnostics.work=new FrameMetrics();diagnostics.snapshotGaps=new FrameMetrics();diagnostics.frozenFrames=0;diagnostics.qualityChanges=0;diagnostics.since=now;
          }
        }
        previous = now;
        if (rendered && !ready) { ready = true; current.onReady(); }
        frame = requestAnimationFrame(render);
      } catch (error) { latest.current.onError(error); }
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); perfOutput?.remove(); renderer.dispose(); audio.dispose(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('party-sound', sound); document.removeEventListener('visibilitychange', hidden); buffer.current.reset(); };
  }, [props.roundId, props.signal]);
  const visiblePlayers=props.publicView&&props.viewRole==='display'?props.players.filter(player=>cameraPlayerIds(props.publicView!,props.players.map(item=>item.id),props.viewRole,props.playerId).includes(player.id)):[];
  return <div ref={container} className="pk-canvas">{visiblePlayers.length > 1 && visiblePlayers.map((player,index) => {
    const rect = viewportRect(visiblePlayers.length,index), racer = props.publicView?.racers.find(r => r.id === player.id);
    return <span className="pk-racer-label" key={player.id} style={{ left:`${rect.x*100}%`, top:`${rect.y*100}%` }}>{player.name}{racer && ` · #${racer.rank} · Lap ${racer.lap}/${props.publicView!.laps}`}</span>;
  })}</div>;
}
