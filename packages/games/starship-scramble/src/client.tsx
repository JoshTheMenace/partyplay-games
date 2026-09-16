import { useEffect, useRef } from 'react';
import { Panel, ToggleRow, type GameAudioProps, type GameClientModule, type InstructionsViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import type { Action, ClientProps, Input, PrivateView, PublicView, Settings } from './contracts';
import { Controller } from './ui/controller';
import { Display } from './ui/display';
import { Personal } from './ui/personal';
import { StarshipMusic } from './render/music';
import './styles.css';
function ControllerView(props: ClientProps) {
  const ready = useRef(props.assetsReady); ready.current = props.assetsReady;
  useEffect(() => { ready.current(); }, []);
  return <div className="ss-controller"><Controller {...props}/></div>;
}
function PersonalView(props: ClientProps) {
  const ready = useRef(props.assetsReady); ready.current = props.assetsReady;
  useEffect(() => { ready.current(); }, []);
  return <Personal {...props}/>;
}
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <div className="ss-settings">
    <ToggleRow label="Relaxed difficulty · gentler threat pressure" checked={settings.difficulty === 'relaxed'} disabled={disabled} onChange={relaxed => onChange({ ...settings, difficulty: relaxed ? 'relaxed' : 'standard' })}/>
    <ToggleRow label="Training expedition · short route to learn the ships" checked={settings.expedition === 'training'} disabled={disabled} onChange={training => onChange({ ...settings, expedition: training ? 'training' : 'standard' })}/>
    <p className="kp-muted">One to four captains, one ship each. Landscape phones. Save from the room menu between beacons.</p>
  </div>;
}
function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="ss-instructions">
    <h2>Starship Scramble</h2>
    <p>An original cooperative fleet expedition. Every captain owns a ship and its crew. The fleet jumps together, fights together and shares the salvage.</p>
    {role === 'display' ? <ul><li>The TV shows every allied ship on the left and every enemy, E1 to E6, on the right.</li><li>Alerts for boarders, fire and breaches appear on the ship and in the strip below.</li><li>Events, routes, salvage and stations show here while captains decide on their phones.</li></ul>
      : <ul><li>Your phone opens on your own ship. Tap a room to inspect it, tap your crew to give orders.</li><li>Weapons: pick a weapon, pick a vessel, tap the room to target. It keeps firing until you hold fire.</li><li>Switch to any allied or enemy ship from the bar. You command only your own crew there.</li><li>Teleport crew to help allies. If your ship is destroyed, you fight on through survivors elsewhere.</li><li>Loot is tap-to-take. Scrap is split automatically. Shops have no timer.</li></ul>}
  </div>;
}
function ResultsView({ outcome, publicView }: ResultsViewProps<PublicView>) {
  return <Panel className="ss-results-view"><span className="kp-eyebrow">{publicView.result === 'victory' ? 'Expedition complete' : publicView.result === 'defeat' ? 'Fleet lost' : 'Expedition paused'}</span><h2>{publicView.message || (outcome.complete ? 'The journey ends here.' : 'Saved for another sitting.')}</h2>
    <ul className="ss-roster">{publicView.captains.map(c => <li key={c.id} style={{ ['--chip' as string]: c.color }}><strong>{c.name}</strong><small>{c.status} · {c.crewCount} crew</small></li>)}</ul></Panel>;
}
/** Host-only soundtrack, whether the host watches or plays. Controllers never create music. */
function AudioView(props: GameAudioProps<PublicView>) {
  const music = useRef<StarshipMusic | null>(null);
  useEffect(() => { if (!props.isHost) return; const instance = music.current = new StarshipMusic(); return () => { instance.dispose(); music.current = null; }; }, [props.isHost]);
  useEffect(() => { music.current?.update(props); }, [props.isHost, props.phase, props.publicView, props.connected]);
  return null;
}
export const client: GameClientModule<Input, Action, Settings, PublicView, PrivateView> = {
  DisplayView: Display, ControllerView, PersonalView, SettingsView, InstructionsView, ResultsView, AudioView,
  prepare: async () => { if (typeof document !== 'undefined' && 'fonts' in document) await Promise.race([document.fonts.load("400 24px 'Lilita One'").catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]); },
  dispose: () => {},
};
export default client;
