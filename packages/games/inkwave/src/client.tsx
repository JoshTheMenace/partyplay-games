import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice, type GameAudioProps, type GameClientModule, type GameViewProps, type LobbyViewProps, type SceneViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { type Input, type Action, type Choice, type PublicView, type Settings } from './model';
import './style.css';
type Props = GameViewProps<Input, Action, PublicView, null>;
const base = '/games/inkwave/', channel = 'partyplay-inkwave';
const defaultChoice: Choice = { weapon: 'shooter', sub: null, special: null, style: { hair: 0, skin: 0, outfit: 0, hat: 0 } };
function OriginalScreen({ screen, data, onMessage }: { screen: string; data: unknown; onMessage?(message: Record<string, any>): void }) {
  const id = useId(), iframe = useRef<HTMLIFrameElement>(null), latest = useRef({ data, onMessage }); latest.current = { data, onMessage };
  const [error, setError] = useState('');
  useEffect(() => {
    const send = (type: string) => iframe.current?.contentWindow?.postMessage({ channel, roundId: id, type, data: latest.current.data }, location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== id) return;
      if (event.data.type === 'loaded') send('init');
      if (event.data.type === 'error') setError(event.data.message);
      latest.current.onMessage?.(event.data);
    };
    const unlock = () => send('unlock');
    window.addEventListener('message', receive); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { send('stop'); window.removeEventListener('message', receive); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [id]);
  useEffect(() => { iframe.current?.contentWindow?.postMessage({ channel, roundId: id, type: 'update', data }, location.origin); }, [id, data]);
  return <>{error && <StatusNotice tone="error">{error}</StatusNotice>}<iframe ref={iframe} className={`inkwave-original inkwave-${screen}`} title={`Inkwave ${screen}`} src={`${base}index.html?party&screen=${screen}&round=${encodeURIComponent(id)}`} allow="autoplay" hidden={screen === 'sound'}/></>;
}
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <OriginalScreen screen="settings" data={{ settings, disabled }} onMessage={message => { if (message.type === 'settings' && !disabled) onChange(message.settings); }}/>;
}
function Lobby({ players, playerId, settings, onChoice, onReady, connected, error }: LobbyViewProps<Settings>) {
  const player = players.find(player => player.id === playerId), choice = (player?.lobbyChoice || defaultChoice) as Choice;
  return <div className="inkwave inkwave-lobby">{player ? <><OriginalScreen screen="loadout" data={{ settings, choice, name: player.name, disabled: !connected || player.ready }} onMessage={message => { if (message.type === 'choice' && connected && !player.ready) onChoice(message.choice); }}/><div className="inkwave-ready"><ArcadeButton disabled={!connected} onClick={() => { if (!player.ready && !player.lobbyChoice) onChoice(defaultChoice); onReady(!player.ready); }}>{player.ready ? 'Change loadout' : 'Ready to ink!'}</ArcadeButton>{player.ready && <span>Ready · waiting for the host</span>}</div></> : <p>Players choose their loadouts and locker looks on their phones.</p>}<p>{settings.map === 'cargo' ? 'Cargo Terminal: human players only, at least one on each team.' : settings.mode === 'boss' ? 'One squad of eight against HULLBREAKER. CPUs fill empty seats.' : 'Two teams of four. CPUs fill empty seats and take over disconnected players.'}</p>{error && <StatusNotice tone="error">{error}</StatusNotice>}</div>;
}
function Scene(props: SceneViewProps<Settings, PublicView, null>) {
  const iframe = useRef<HTMLIFrameElement>(null), latest = useRef(props), sentRevision = useRef(-1), sceneReady = useRef(false); latest.current = props;
  useEffect(() => {
    sceneReady.current = false; sentRevision.current = -1;
    const send = (type: string, data = {}) => iframe.current?.contentWindow?.postMessage({ channel, roundId: props.roundId, type, ...data }, location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== props.roundId) return;
      if (event.data.type === 'loaded') send('init', { settings: props.settings, players: props.players, playerId: props.playerId });
      if (event.data.type === 'ready') { sceneReady.current = true; latest.current.onReady(); if (latest.current.publicView) send('snapshot', { view: latest.current.publicView }); }
      if (event.data.type === 'input') latest.current.setInput(event.data.input);
      if (event.data.type === 'release') latest.current.releaseInput();
      if (event.data.type === 'action') void latest.current.sendAction(event.data.action).then(result => send('ack', { result }));
      if (event.data.type === 'error' && !props.signal.aborted) latest.current.onError(new Error(event.data.message));
    };
    const unlock = () => send('unlock');
    window.addEventListener('message', receive); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { send('stop'); window.removeEventListener('message', receive); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [props.roundId, props.signal]);
  useEffect(() => {
    if (!props.publicView || !sceneReady.current) return;
    const view: Partial<PublicView> = { ...props.publicView };
    if (sentRevision.current === view.revision) delete view.ink;
    sentRevision.current = props.publicView.revision;
    iframe.current?.contentWindow?.postMessage({ channel, roundId: props.roundId, type: 'snapshot', view }, location.origin);
  }, [props.publicView, props.roundId]);
  return <iframe ref={iframe} className="inkwave-scene" title="Inkwave arena" src={`${base}index.html?party&round=${encodeURIComponent(props.roundId)}`} tabIndex={-1}/>;
}
function Display({ publicView: view }: Props) {
  const seconds = Math.max(0, Math.ceil(view.time)), boss = view.boss, tint = (team: number) => ({ '--team': view.colors[team] }) as CSSProperties;
  const team = (index: number) => <div className="inkwave-team" style={tint(index)}><small>{view.teams[index]}</small><b>{view.zones ? view.zones.count[index] : `${(view.coverage[index] * 100).toFixed(1)}%`}</b></div>;
  const squad = (index: number) => <li key={index}>{view.roster.map((player, i) => player.team === index && <div key={player.id} style={tint(player.team)}><b>{player.name}</b><span>{boss ? `${Math.round(view.stats[i].bossDmg || 0)} damage` : `${Math.round(view.stats[i].turf)}p`} · {view.stats[i].splats} splats</span></div>)}</li>;
  return <div className="inkwave inkwave-display">
    <div className="inkwave-score">
      {boss ? <div className="inkwave-team" style={{ '--team': '#ff4150', '--hp': `${Number(boss[7]) / Number(boss[17]) * 100}%` } as CSSProperties}><small>HULLBREAKER · Phase {Number(boss[8])}</small><b>{Math.ceil(Number(boss[7]) / Number(boss[17]) * 100)}% HP</b><i/></div> : team(0)}
      <strong>{view.state === 'intro' ? 'GET READY' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}<small>{boss ? 'Sink HULLBREAKER' : view.zones ? 'Hold the zones' : 'Most turf wins'}</small></strong>
      {!boss && team(1)}
    </div>
    <ul className="inkwave-roster">{boss ? squad(0) : [squad(0), squad(1)]}</ul>
  </div>;
}
function Controller({ publicView: view }: Props) { return view.state === 'intro' ? <div className="inkwave inkwave-intro"><strong>GET READY!</strong></div> : null; }
function AudioView(props: GameAudioProps<PublicView>) { return props.isHost ? <OriginalScreen screen="sound" data={{ phase: props.phase, publicView: props.publicView && { boss: props.publicView.boss?.[8], time: props.publicView.time, result: props.publicView.result && { winner: props.publicView.result.winner } }, connected: props.connected }}/> : null; }
export const client: GameClientModule<Input, Action, Settings, PublicView, null> = {
  immersivePhone: true, sceneRoles: ['display', 'controller'], SceneView: Scene, LobbyView: Lobby, AudioView,
  DisplayView: Display, ControllerView: Controller, PersonalView: Controller, SettingsView, settingsWide: true,
  InstructionsView: () => <div className="inkwave"><h2>Make a splash.</h2><p>Move with your left thumb. Drag the right side to aim; hold the large fire button and drag it to aim while shooting. Hold SQUID in your own ink to refill and swim. JUMP, SUB and SP use your other abilities. MAP lets you Super Jump to a teammate. On a computer: WASD, mouse, click to fire, Shift to swim, Space to jump, E for sub, F for special.</p><p>Paint floors to score in Turf War, hold zones in Zone Control, or team up against HULLBREAKER in Boss Battle. CPUs fill empty seats except on Cargo Terminal.</p></div>,
  ResultsView: ({ publicView: view, playerId, isHost }) => <div className={playerId ? undefined : 'inkwave-watch'}><OriginalScreen screen="results" data={{ view, settings: view.settings, playerId, isHost }}/></div>,
  prepare: () => {}, dispose: () => {},
};
export default client;
