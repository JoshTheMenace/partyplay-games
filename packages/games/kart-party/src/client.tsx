import { lazy, Suspense, useEffect, useRef } from 'react';
import { HoldButton, SteerPad, type GameClientModule, type GameViewProps } from '../../../party-ui/src/index';
import { NEUTRAL, type Input, type Race } from '../../../../modules/kart-party/game/types';
import { TRACKS } from '../../../../modules/kart-party/game/tracks';
import type { Action, Settings } from './server';
import './style.css';
const Scene = lazy(() => import('./scene'));
type Props = GameViewProps<Input, Action, Race, null>;
function Controls({ publicView: race, playerId, setInput, releaseInput, sendAction, connected }: Props) {
  const held = useRef({ ...NEUTRAL, throttle: true }), latest = useRef({ setInput, releaseInput, sendAction }); latest.current = { setInput, releaseInput, sendAction };
  const change = (value: Partial<Input>) => { Object.assign(held.current, value); latest.current.setInput({ ...held.current }); };
  useEffect(() => {
    if (connected) latest.current.setInput(held.current);
    const keys = new Set<string>();
    const release = () => { keys.clear(); held.current = { ...NEUTRAL, throttle: true }; latest.current.releaseInput?.(); };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select') || event.repeat) return;
      const name = event.key.toLowerCase();
      if (['a','d','arrowleft','arrowright'].includes(name) && !(event.target as HTMLElement)?.closest('.kp-steer-pad')) { event.preventDefault(); if (event.type === 'keydown') keys.add(name); else keys.delete(name); change({ steer: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')) }); }
      const field = event.key === 'Shift' ? 'drift' : ['e','E'].includes(event.key) ? 'use' : event.key === ' ' ? 'brake' : null;
      if (field) { event.preventDefault(); if (field === 'use') { if (event.type === 'keydown') void latest.current.sendAction({ type: 'use' }); } else change({ [field]: event.type === 'keydown' }); }
    };
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', release); document.addEventListener('visibilitychange', hidden);
    return () => { release(); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hidden); };
  }, [connected]);
  const racer = race.racers.find(player => player.id === playerId)!;
  return <div className="pk-controller" data-racer-speed={racer.speed.toFixed(2)}><strong>{racer.name} · #{racer.rank} · Lap {racer.lap}/{race.laps}</strong><div className="pk-controls"><SteerPad label="Steer" disabled={!connected} onChange={value => change({ steer: value.x })}/><HoldButton label="Brake" disabled={!connected} onChange={brake => change({ brake })}>Brake <small>Space</small></HoldButton><HoldButton label="Drift" disabled={!connected} onChange={drift => change({ drift })}>Drift <small>Shift</small></HoldButton><HoldButton label="Use item" disabled={!connected} onChange={use => { if (use) void sendAction({ type: 'use' }); }}>{racer.item ?? 'Item'} <small>E</small></HoldButton></div>{race.phase === 'countdown' && <b className="pk-countdown">{Math.ceil(race.countdown)}</b>}</div>;
}
function Display({ publicView: race }: Props) {
  return race.phase === 'countdown' ? <b className="pk-countdown">{Math.ceil(race.countdown)}</b> : null;
}
export const client: GameClientModule<Input, Action, Settings, Race, null> = {
  SceneView: props => <Suspense fallback={null}><Scene {...props}/></Suspense>, DisplayView: Display, ControllerView: Controls,
  SettingsView: ({ settings, onChange, disabled }) => <div className="pk-settings"><label>Course<select disabled={disabled} value={settings.track} onChange={event => onChange({ ...settings, track: event.target.value as Settings['track'] })}>{Object.values(TRACKS).map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label><label>Laps<select disabled={disabled} value={settings.laps} onChange={event => onChange({ ...settings, laps: Number(event.target.value) })}>{[1,2,3,4,5].map(laps => <option key={laps}>{laps}</option>)}</select></label><label>Speed<select disabled={disabled} value={settings.speedClass} onChange={event => onChange({ ...settings, speedClass: Number(event.target.value) as Settings['speedClass'] })}>{[50,100,150,200].map(speed => <option key={speed} value={speed}>{speed}cc</option>)}</select></label><label>CPU difficulty<select disabled={disabled} value={settings.difficulty} onChange={event => onChange({ ...settings, difficulty: event.target.value as Settings['difficulty'] })}>{['easy','normal','hard'].map(level => <option key={level}>{level}</option>)}</select></label></div>,
  InstructionsView: () => <><h2>Ready to race?</h2><p>Arrow keys or the pad steer. Shift drifts, Space brakes, E uses an item. Acceleration is automatic.</p></>,
  ResultsView: ({ publicView: race }) => <><h1>Finish line!</h1><ol className="pk-results">{[...race.racers].sort((a,b) => a.rank-b.rank).map(racer => <li key={racer.id}><strong>#{racer.rank} {racer.name}{racer.bot ? ' · CPU' : ''}</strong><span>{racer.finishTime === null ? 'Did not finish' : `${racer.finishTime.toFixed(1)}s`}</span></li>)}</ol></>,
  prepare() {}, dispose() {},
};
