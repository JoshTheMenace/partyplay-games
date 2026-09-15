import { lazy, Suspense, useEffect, useRef, type CSSProperties } from 'react';
import { HoldButton, SteerPad, requestLandscape, type GameClientModule, type GameViewProps } from '../../../party-ui/src/index';
import { DRIVERS, NEUTRAL, type Input, type Race } from '../../../../modules/kart-party/game/types';
import { screenSteer } from '../../../../modules/kart-party/game/input';
import { ITEMS } from '../../../../modules/kart-party/game/items';
import { disposePowerupModels, preparePowerupModels } from '../../../../modules/kart-party/game/powerup-models';
import { TRACKS } from '../../../../modules/kart-party/game/tracks';
import { itemRoulette } from '../../../../modules/kart-party/game/item-roulette';
import { partyAwards } from '../../../../modules/kart-party/game/awards';
import { hasPersonalCamera } from '../../../../modules/kart-party/game/personal-camera';
import type { Action, Settings } from './server';
import './style.css';
const Scene = lazy(() => import('./scene'));
type Props = GameViewProps<Input, Action, Race, null>;
const driver=(index:number)=>DRIVERS[((index%DRIVERS.length)+DRIVERS.length)%DRIVERS.length];
function RaceIntro({race}:{race:Race}){const count=Math.ceil(race.countdown),track=TRACKS[race.track];return <div className="pk-race-intro" aria-live="polite"><span>{track.name}</span><b>{count>3?'READY':count||'GO!'}</b><small>{race.laps} {race.laps===1?'lap':'laps'} · {race.speedClass}cc</small></div>;}
function KartResults({race}:{race:Race}){
  const order=[...race.racers].sort((a,b)=>a.rank-b.rank),winner=order[0],awards=partyAwards(race);
  return <section className="pk-finish-show"><header className="pk-finish-hero"><span>CHECKERED FLAG · {TRACKS[race.track].name}</span><h1>{winner?.name??'Race'} wins!</h1><p>{race.laps} {race.laps===1?'lap':'laps'} · {race.speedClass}cc · Party awards unlocked</p></header><div className="pk-podium">{order.slice(0,3).map((racer,index)=><article key={racer.id} className={`pk-podium-place pk-podium-${index+1}`} style={{'--driver':driver(racer.driver).color} as CSSProperties}><i>{index+1}</i><strong>{racer.name}</strong><small>{racer.finishTime===null?'DNF':`${racer.finishTime.toFixed(1)}s`}</small></article>)}</div><div className="pk-awards"><h2>Party awards</h2><div>{awards.map((award,index)=><article key={award.id} style={{'--driver':driver(award.racer.driver).color,'--delay':`${index*70}ms`} as CSSProperties}><span>★</span><small>{award.blurb}</small><h3>{award.title}</h3><strong>{award.racer.name}</strong><em>{award.value}</em></article>)}</div></div><ol className="pk-results">{order.map(racer=><li key={racer.id}><span><i style={{background:driver(racer.driver).color}}/>{racer.rank}. <strong>{racer.name}</strong>{racer.bot&&<small> CPU</small>}</span><b>{racer.finishTime===null?'DNF':`${racer.finishTime.toFixed(1)}s`}</b></li>)}</ol></section>;
}
function Controls({ publicView: race, playerId, viewRole, isHost, setInput, releaseInput, sendAction, connected }: Props) {
  const held = useRef({ ...NEUTRAL, throttle: true }), latest = useRef({ setInput, releaseInput, sendAction }); latest.current = { setInput, releaseInput, sendAction };
  const change = (value: Partial<Input>) => { Object.assign(held.current, value); latest.current.setInput({ ...held.current }); };
  useEffect(() => {
    if (connected) latest.current.setInput(held.current);
    const keys = new Set<string>();
    const release = () => { keys.clear(); held.current = { ...NEUTRAL, throttle: true }; latest.current.releaseInput?.(); };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select') || event.repeat) return;
      const name = event.key.toLowerCase();
      if (['a','d','arrowleft','arrowright'].includes(name) && !(event.target as HTMLElement)?.closest('.kp-steer-pad')) { event.preventDefault(); if (event.type === 'keydown') keys.add(name); else keys.delete(name); change({ steer: screenSteer(Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'))) }); }
      const field = event.key === 'Shift' ? 'drift' : ['e','E'].includes(event.key) ? 'use' : event.key === ' ' ? 'brake' : null;
      if (field) { event.preventDefault(); if (field === 'use') { if (event.type === 'keydown') void latest.current.sendAction({ type: 'use' }); } else change({ [field]: event.type === 'keydown' }); }
    };
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', release); document.addEventListener('visibilitychange', hidden);
    return () => { release(); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hidden); };
  }, [connected]);
  useEffect(() => {
    if (!playerId || viewRole !== 'controller' || isHost) return;
    try { if (localStorage.getItem('kart-party.personal-camera') === 'true') void sendAction({ type: 'camera', enabled: true }); } catch {}
  }, [playerId, viewRole, isHost, race.startId, sendAction]);
  const racer = race.racers.find(player => player.id === playerId)!;
  const roulette=itemRoulette(race,racer),shown=roulette.item,portrait=shown?{backgroundImage:`url(/games/kart-party/item-icons/${shown}.png)`} as CSSProperties:undefined;
  const phoneCamera=viewRole==='controller'&&!isHost,personalCamera=phoneCamera&&hasPersonalCamera(race,playerId);
  const toggleCamera=()=>{const enabled=!personalCamera;try{localStorage.setItem('kart-party.personal-camera',String(enabled));}catch{}if(enabled)void requestLandscape();void sendAction({type:'camera',enabled});};
  return <div className={`pk-controller${personalCamera?' pk-personal-camera-on':''}`} data-racer-speed={racer.speed.toFixed(2)}>{phoneCamera&&<><button type="button" className="pk-camera-toggle" aria-pressed={personalCamera} disabled={!connected} onClick={toggleCamera}><span aria-hidden="true">◉</span> Camera {personalCamera?'on':'off'}</button>{!personalCamera&&<div className="pk-camera-off-copy"><b>Personal camera is off</b><span>Turn it on to race from this phone.</span></div>}</>}<strong>{racer.name} · #{racer.rank} · Lap {racer.lap}/{race.laps}</strong><div className="pk-controls"><SteerPad label="Steer" disabled={!connected} onChange={value => change({ steer: screenSteer(value.x) })}/><HoldButton label="Brake" disabled={!connected} onChange={brake => change({ brake })}>Brake <small>Space</small></HoldButton><HoldButton label="Drift" disabled={!connected} onChange={drift => change({ drift })}>Drift <small>Shift</small></HoldButton><HoldButton label={roulette.active?'Choosing item':racer.item?`Use ${ITEMS[racer.item].name}`:'Use item'} disabled={!connected||roulette.active} onChange={use => { if (use) void sendAction({ type: 'use' }); }}><span className={`pk-item-button-content${shown?' pk-item-button-content-held':''}${roulette.active?' pk-item-roulette':''}`}><span className="pk-item-portrait" style={portrait} aria-hidden="true"/><span className="pk-item-caption">{roulette.active?'Choosing…':racer.item?ITEMS[racer.item].name:'Item'}</span><small className="pk-item-key">E</small></span></HoldButton></div>{race.phase==='countdown'&&<RaceIntro race={race}/>}</div>;
}
function Display({ publicView: race }: Props) {
  return race.phase==='countdown'?<RaceIntro race={race}/>:null;
}
export const client: GameClientModule<Input, Action, Settings, Race, null> = {
  sceneRoles: ['display','controller'], SceneView: props => <Suspense fallback={null}><Scene {...props}/></Suspense>, DisplayView: Display, ControllerView: Controls,
  SettingsView: ({ settings, onChange, disabled }) => <div className="pk-settings"><label>Course<select disabled={disabled} value={settings.track} onChange={event => onChange({ ...settings, track: event.target.value as Settings['track'] })}>{Object.values(TRACKS).map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label><label>Laps<select disabled={disabled} value={settings.laps} onChange={event => onChange({ ...settings, laps: Number(event.target.value) })}>{[1,2,3,4,5].map(laps => <option key={laps}>{laps}</option>)}</select></label><label>Speed<select disabled={disabled} value={settings.speedClass} onChange={event => onChange({ ...settings, speedClass: Number(event.target.value) as Settings['speedClass'] })}>{[50,100,150,200].map(speed => <option key={speed} value={speed}>{speed}cc</option>)}</select></label><label>CPU difficulty<select disabled={disabled} value={settings.difficulty} onChange={event => onChange({ ...settings, difficulty: event.target.value as Settings['difficulty'] })}>{['easy','normal','hard'].map(level => <option key={level}>{level}</option>)}</select></label></div>,
  InstructionsView: () => <><h2>Ready to race?</h2><p>Arrow keys or the pad steer. Shift drifts, Space brakes, E uses an item. Acceleration is automatic.</p></>,
  ResultsView: ({ publicView: race }) => <KartResults race={race}/>,
  prepare({ assetBase, signal }) { return preparePowerupModels(assetBase,signal); }, dispose() { disposePowerupModels(); },
};
