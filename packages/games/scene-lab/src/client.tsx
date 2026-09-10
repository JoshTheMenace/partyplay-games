import { lazy, Suspense, useRef } from 'react';
import { ArcadeButton, Countdown, HoldButton, Panel, SteerPad, type GameClientModule, type GameViewProps } from '../../../party-ui/src/index';
import type { Input, Settings, View } from './model';
import './style.css';
const Arena = lazy(() => import('./scene'));
type Props = GameViewProps<Input, never, View, null>;
function Controller({ publicView, playerId, setInput, releaseInput, serverNowMs }: Props) {
  const input = useRef<Input>({ x: 0, y: 0, boost: false }), player = publicView.players.find(p => p.id === playerId)!;
  const change = (part: Partial<Input>) => { input.current = { ...input.current, ...part }; if (!input.current.x && !input.current.y && !input.current.boost) releaseInput?.(); else setInput(input.current); };
  return <Panel className="sl-controller"><p className="kp-eyebrow">PLAYER {publicView.players.indexOf(player) + 1} · {player.name}</p><div className="sl-controller-heading"><h1>Go for gold.</h1><Countdown deadline={publicView.endsAt} serverNowMs={serverNowMs}/></div><p>Collect gold stars. Hold Boost to move faster.</p><div className="sl-controls"><SteerPad onChange={change}/><HoldButton label="Boost" onChange={boost => change({ boost })}/></div><p className="sl-score">{player.score} stars collected</p></Panel>;
}
export const client: GameClientModule<Input, never, Settings, View, null> = {
  SceneView: props => <Suspense fallback={null}><Arena {...props}/></Suspense>,
  DisplayView: ({ publicView, serverNowMs }) => <div className="sl-hud"><div className="sl-title"><span>SCENE LAB</span><h1>Star sprint</h1><p>Steer. Boost. Grab gold.</p></div><Countdown deadline={publicView.endsAt} serverNowMs={serverNowMs}/><div className="sl-roster">{publicView.players.map((player, i) => <span key={player.id}><b style={{ background: player.color }}>{i + 1}</b>{player.name}<strong>{player.score}</strong></span>)}</div></div>,
  ControllerView: Controller,
  SettingsView: ({ settings, onChange, disabled }) => <div className="kp-row"><label>Round length <select value={settings.seconds ?? 20} disabled={disabled} onChange={event => onChange({ seconds: Number(event.target.value) })}><option value={20}>20 seconds</option><option value={45}>45 seconds</option></select></label><ArcadeButton tone="ghost" disabled={disabled} onClick={event => { const low = localStorage.getItem('party.sceneQuality') !== 'low'; localStorage.setItem('party.sceneQuality', low ? 'low' : 'balanced'); event.currentTarget.querySelector('span')!.textContent = `Graphics: ${low ? 'low' : 'balanced'}`; }}>Graphics: {localStorage.getItem('party.sceneQuality') === 'low' ? 'low' : 'balanced'}</ArcadeButton></div>,
  InstructionsView: () => <><h2>Collect the most gold stars.</h2><p>Drag the pad or use arrow keys / WASD. Hold Boost with your other thumb. The middle pillar and walls block movement; players can pass each other.</p></>,
  prepare() {}, dispose() {},
};
