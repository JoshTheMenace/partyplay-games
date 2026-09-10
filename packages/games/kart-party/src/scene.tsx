import { useEffect, useRef } from 'react';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { viewportRect } from '../../../../modules/kart-party/game/split-screen';
import { createRenderer } from '../../../../modules/kart-party/game/renderer';
import { GameAudio } from '../../../../modules/kart-party/game/audio';
import { createRace } from '../../../../modules/kart-party/game/simulation';
import { createMotionBuffer } from '../../../../modules/kart-party/game/motion-buffer';
import type { Race } from '../../../../modules/kart-party/game/types';
import type { Settings } from './server';
export default function KartScene(props: SceneViewProps<Settings, Race>) {
  const container = useRef<HTMLDivElement>(null), latest = useRef(props), buffer = useRef(createMotionBuffer<Race>({ maxExtrapolationSeconds: 0 })); latest.current = props;
  useEffect(() => { if (props.publicView) buffer.current.push(props.publicView, performance.now()/1000); }, [props.publicView]);
  useEffect(() => {
    const renderer = createRenderer(container.current!, message => latest.current.onError(Error(message)));
    if (!renderer) return;
    const audio = new GameAudio(), mode = props.playerId ? 'solo' : 'display';
    const unlock = () => { try { audio.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch {} audio.start(props.settings.track, props.settings.speedClass, mode); };
    const sound = (event: Event) => { audio.muted = (event as CustomEvent<{ muted: boolean }>).detail.muted; if (!audio.muted) unlock(); };
    unlock(); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); window.addEventListener('party-sound', sound);
    const preview = createRace({ ...props.settings, players: props.players.map((player, driver) => ({ ...player, driver })) });
    let frame = 0, previous = performance.now(), ready = false;
    const render = (now: number) => {
      if (props.signal.aborted) return;
      try {
        const current = latest.current, presented = buffer.current.sample(now/1000);
        const rendered = renderer.render({ race: presented?.race ?? current.publicView ?? preview, track: props.settings.track, playerIds: props.players.map(player => player.id), quality: matchMedia('(pointer: coarse)').matches ? 'performance' : 'high', paused: false, interpolated: !!presented, snappedIds: presented?.snappedIds }, Math.min(.1,(now-previous)/1000), now/1000);
        audio.update(current.publicView, current.playerId ?? '', false, mode);
        previous = now;
        if (rendered && !ready) { ready = true; current.onReady(); }
        frame = requestAnimationFrame(render);
      } catch (error) { latest.current.onError(error); }
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); renderer.dispose(); audio.dispose(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('party-sound', sound); buffer.current.reset(); };
  }, [props.roundId, props.signal]);
  return <div ref={container} className="pk-canvas">{props.players.length > 1 && props.players.map((player,index) => {
    const rect = viewportRect(props.players.length,index), racer = props.publicView?.racers.find(r => r.id === player.id);
    return <span className="pk-racer-label" key={player.id} style={{ left:`${rect.x*100}%`, top:`${rect.y*100}%` }}>{player.name}{racer && ` · #${racer.rank} · Lap ${racer.lap}/${props.publicView!.laps}`}</span>;
  })}</div>;
}
