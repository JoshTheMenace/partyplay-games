import { useEffect, useRef } from 'react';
import { ToggleRow, type GameAudioProps, type GameClientModule, type InstructionsViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import type { Action, ClientProps, Input, PrivateView, PublicView, Settings } from './contracts';
import { Display } from './display';
import { Debrief } from './display/over';
import { backdrop } from './display/common';
import { Controller, Personal } from './phone';
import { StarshipMusic } from './audio/music';
import { loadShipArt } from './render/ship';

const Ready = (View: (props: ClientProps) => React.ReactNode) => function ReadyView(props: ClientProps) {
  const ready = useRef(props.assetsReady); ready.current = props.assetsReady;
  useEffect(() => { let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => ready.current()); }); return () => cancelAnimationFrame(frame); }, []);
  return <View {...props}/>;
};
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <div className="ss-settings">
    <ToggleRow label="Cadet difficulty · gentler enemies, extra reserve hulls" checked={settings.difficulty === 'cadet'} disabled={disabled} onChange={on => onChange({ ...settings, difficulty: on ? 'cadet' : 'captain' })}/>
    <ToggleRow label="Short run · one sector, then the flagship (about 20 minutes)" checked={settings.length === 'short'} disabled={disabled} onChange={on => onChange({ ...settings, length: on ? 'short' : 'standard' })}/>
    <p className="kp-muted">Cadet enemies have 25% less hull and charge 20% slower, and the fleet gets 3 reserve hulls instead of 2. A standard run crosses three sectors (about 45 minutes). Runs can be saved and resumed later.</p>
  </div>;
}
function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="ss-instructions"><h2>Starship Scramble</h2>
    <p>Every captain flies their own ship. Jump across the sector together, stay ahead of the Crimson Armada, and destroy its flagship.</p>
    {role === 'display' ? <p>The TV shows the sector map, events and the whole battle. Each phone holds one captain's ship and controls.</p>
      : <p>Tap a weapon, then an enemy room, to fire. Tap crew, then a room, to move them. Fire together with your friends to break shields. Anyone can pause.</p>}
  </div>;
}
function ResultsView({ publicView }: ResultsViewProps<PublicView>) {
  const { result } = publicView;
  return <div className="ss-results"><div className="ss-bg ss-results-card" data-result={result ?? undefined} style={backdrop(result === 'defeat' ? 'armada-reach' : 'map')}>
    <h2>{result === 'victory' ? 'Victory' : result === 'defeat' ? 'Defeat' : 'Expedition saved'}</h2>{publicView.message && <p>{publicView.message}</p>}<Debrief view={publicView}/></div></div>;
}
/** Host-only soundtrack; phones never duplicate the music. */
function AudioView(props: GameAudioProps<PublicView>) {
  const music = useRef<StarshipMusic | null>(null);
  useEffect(() => { if (!props.isHost) return; const instance = music.current = new StarshipMusic(); return () => { instance.dispose(); music.current = null; }; }, [props.isHost]);
  useEffect(() => { music.current?.update(props); }, [props.isHost, props.phase, props.publicView, props.connected]);
  return null;
}
export const client: GameClientModule<Input, Action, Settings, PublicView, PrivateView> = {
  immersivePhone: true, allowPortraitController: view => !!view && view.phase !== 'combat',
  DisplayView: Ready(Display), ControllerView: Ready(Controller), PersonalView: Ready(Personal), SettingsView, InstructionsView, ResultsView, AudioView,
  prepare: async ({ assetBase, signal }) => { await Promise.all([loadShipArt(assetBase, signal), typeof document !== 'undefined' && 'fonts' in document ? Promise.race([Promise.all([document.fonts.load("400 24px 'Lilita One'"), document.fonts.load("800 24px Nunito")]).catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]) : null]); },
  dispose: () => {},
};
export default client;
