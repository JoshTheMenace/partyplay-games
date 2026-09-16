import { partyAwards } from './engine/awards';
import { itemRoulette } from './engine/item-roulette';
import { ITEMS } from './engine/items';
import { COURSE_DESIGNS } from './engine/course-designs';
import { GarageView } from './garage-view';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { HoldButton, SteerPad, type GameClientModule, type GameViewProps, type SceneViewProps } from '../../../party-ui/src/index';
import { NEUTRAL, type Input, type Race } from './engine/types';
import { worldSteer } from './engine/input';
import { TRACKS } from './engine/tracks';
import type { Action, Settings } from './server';
import { screenMode } from './views';
import './style.css';
const Scene = lazy(() => import('./scene'));
type Props = GameViewProps<Input, Action, Race, null>;
function DrivingControls({ publicView: race, playerId, isHost, setInput, releaseInput, sendAction, connected }: Props) {
  const held = useRef({ ...NEUTRAL, throttle: true }), latest = useRef({ setInput, releaseInput, sendAction }); latest.current = { setInput, releaseInput, sendAction };
  const change = (value: Partial<Input>) => { Object.assign(held.current, value); latest.current.setInput({ ...held.current, steer: worldSteer(held.current.steer) }); };
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
  const racer = race.racers.find(player => player.id === playerId)!, roulette = itemRoulette(race, racer);
  return <div className="pk-controller" data-screen={screenMode(race.viewMode ?? 'tv', race.racers.filter(r => !r.bot).length, playerId, isHost)} data-racer-speed={racer.speed.toFixed(2)}><strong>{racer.name} · #{racer.rank} · Lap {racer.lap}/{race.laps}</strong>{race.viewMode !== 'personal' && !isHost && <span className="pk-view-hint">Watch your race on the TV</span>}<div className="pk-controls"><SteerPad label="Steer" disabled={!connected} onChange={value => change({ steer: value.x })}/><HoldButton label="Brake" disabled={!connected} onChange={brake => change({ brake })}>Brake <small>Space</small></HoldButton><HoldButton label="Drift" disabled={!connected} onChange={drift => change({ drift })}>Drift <small>Shift</small></HoldButton><HoldButton label="Use item" disabled={!connected || roulette.active || !racer.item} onChange={use => { if (use) void sendAction({ type: 'use' }); }}>{roulette.item && !(roulette.active && matchMedia('(prefers-reduced-motion: reduce)').matches) && <img className="pk-item-icon" src={`/games/kart-party/item-icons/${roulette.item}.png`} alt=""/>}{roulette.active ? 'Choosing…' : racer.item ? ITEMS[racer.item].name : 'Item'} <small>E</small></HoldButton></div>{race.phase === 'countdown' && <b className="pk-countdown">{Math.ceil(race.countdown)}</b>}</div>;
}
function Controls(props:Props){
  return props.publicView.garage?<GarageView race={props.publicView} playerId={props.playerId} isHost={props.isHost} connected={props.connected !== false} sendAction={props.sendAction}/>:<DrivingControls {...props}/>;
}
function Display(props: Props) {
  const race=props.publicView;
  if(race.garage)return <GarageView race={race} playerId={null} isHost={props.isHost} connected={props.connected !== false} sendAction={props.sendAction}/>;
  return race.phase === 'countdown' ? <b className="pk-countdown">{Math.ceil(race.countdown)}</b> : null;
}
function SceneView(props: SceneViewProps<Settings, Race, null>) {
  const controlsOnly = screenMode(props.settings.views, props.players.length, props.playerId, props.isHost) === 'controls';
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    if (!controlsOnly) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { if (!props.signal.aborted) latest.current.onReady(); }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [controlsOnly, props.signal]);
  return controlsOnly ? null : <Suspense fallback={null}><Scene {...props}/></Suspense>;
}
export const client: GameClientModule<Input, Action, Settings, Race, null> = {
  sceneRoles: ['display', 'controller'], SceneView, DisplayView: Display, ControllerView: Controls,
  SettingsView: ({ settings, onChange, disabled }) => <div className="pk-settings"><label>Course<select disabled={disabled} value={settings.track} onChange={event => onChange({ ...settings, track: event.target.value as Settings['track'] })}>{Object.values(TRACKS).map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label><label>Laps<select disabled={disabled} value={settings.laps} onChange={event => onChange({ ...settings, laps: Number(event.target.value) })}>{[1,2,3,4,5].map(laps => <option key={laps}>{laps}</option>)}</select></label><label>Speed<select disabled={disabled} value={settings.speedClass} onChange={event => onChange({ ...settings, speedClass: Number(event.target.value) as Settings['speedClass'] })}>{[50,100,150,200].map(speed => <option key={speed} value={speed}>{speed}cc</option>)}</select></label><label>CPU difficulty<select disabled={disabled} value={settings.difficulty} onChange={event => onChange({ ...settings, difficulty: event.target.value as Settings['difficulty'] })}>{['easy','normal','hard'].map(level => <option key={level}>{level}</option>)}</select></label><label>Race views<select disabled={disabled} value={settings.views ?? 'auto'} onChange={event => onChange({ ...settings, views: event.target.value as Settings['views'] })}><option value="auto">Auto (up to 4 on TV; 5–10 personal)</option><option value="tv">TV views (split screen)</option><option value="personal">Personal views (each racer's screen)</option></select></label><p className="pk-view-help">Personal views put each race on the player's phone or device. A watching TV follows the race. A playing host sees their own view.</p><p>{COURSE_DESIGNS[settings.track].guide}</p></div>,
  InstructionsView: () => <><h2>Ready to race?</h2><p>Arrow keys or the pad steer. Shift drifts, Space brakes, E uses an item. Acceleration is automatic. Karts bump each other; brake before crowded corners.</p></>,
  ResultsView: ({ publicView: race }) => <><h1>Finish line!</h1><ol className="pk-results">{[...race.racers].sort((a,b) => a.rank-b.rank).map(racer => <li key={racer.id}><strong>#{racer.rank} {racer.name}{racer.bot ? ' · CPU' : ''}</strong><span>{racer.finishTime === null ? 'Did not finish' : `${racer.finishTime.toFixed(1)}s`}</span></li>)}</ol><section className="pk-awards" aria-label="Party awards">{partyAwards(race).map(award=><article key={award.id}><small>{award.blurb}</small><h2>{award.title}</h2><strong>{award.racer.name}</strong><span>{award.value}</span></article>)}</section></>,
  prepare() {}, dispose() {},
};
