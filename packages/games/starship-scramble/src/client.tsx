import { useEffect, useRef } from 'react';
import type { GameClientContext } from '../../../party-contract/src/index';
import { ToggleRow, type GameAudioProps, type GameClientModule, type InstructionsViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import type { Action, ClientProps, Input, Settings } from './contracts';
import { decode, seat, type Own, type Wire } from './wire';
import { Display } from './display';
import { Debrief } from './display/over';
import { backdrop } from './display/common';
import { Controller, Personal } from './phone';
import { StarshipMusic } from './audio/music';
import { loadShipArt } from './render/ship';

/** Every screen decodes the wire for its own seat, then renders the view model the UI is written against. */
const Ready = (View: (props: ClientProps) => React.ReactNode) => function ReadyView(props: GameClientContext<Input, Action, Wire, Own>) {
  const ready = useRef(props.assetsReady); ready.current = props.assetsReady;
  useEffect(() => { let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => ready.current()); }); return () => cancelAnimationFrame(frame); }, []);
  return <View {...props} publicView={seat(decode(props.publicView), props.privateView)} privateView={props.privateView && { captainId: props.privateView.captainId }}/>;
};
const LENGTHS: Record<Settings['length'], string> = { short: 'Short · 1 sector, about 20 minutes', standard: 'Standard · 3 sectors, about 45–60 minutes', long: 'Long · 5 sectors, about 90+ minutes' };
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <div className="ss-settings">
    <ToggleRow label="Cadet difficulty · gentler enemies, extra reserve hulls, crew run damage control" checked={settings.difficulty === 'cadet'} disabled={disabled} onChange={on => onChange({ ...settings, difficulty: on ? 'cadet' : 'captain' })}/>
    <label style={{ display: 'grid', gap: '.4rem', fontWeight: 800 }}>Run length<select value={settings.length} disabled={disabled} onChange={e => onChange({ ...settings, length: e.target.value as Settings['length'] })}>
      {(Object.keys(LENGTHS) as Settings['length'][]).map(k => <option key={k} value={k}>{LENGTHS[k]}</option>)}</select></label>
    <p className="kp-muted">Every sector exit lets the fleet vote on which sector comes next. Cadet enemies have less hull and charge slower, each wing gets 3 reserve hulls instead of 2, and crews fight fires and boarders without being told (any captain can switch that on or off). Turn Cadet off for the Captain's game. Runs can be saved and resumed later.</p>
  </div>;
}
function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="ss-instructions"><h2>Starship Scramble</h2>
    <p>Every captain flies their own ship. Jump across the sector together, stay ahead of the Crimson Armada, and destroy its flagship. Five captains or more fly in wings of up to four: each wing fights its own enemies, and a wing that wins covers the others.</p>
    {role === 'display' ? <p>The TV shows the sector map, events and the whole battle. Each phone holds one captain's ship and controls.</p>
      : <p>Your guns aim themselves; tap a weapon, then an enemy room, to pick a better target. Tap crew, then a room, to move them. Fire together with your wing to break shields. Anyone can pause.</p>}
  </div>;
}
function ResultsView(props: ResultsViewProps<Wire>) {
  const publicView = decode(props.publicView), { result } = publicView;
  return <div className="ss-results"><div className="ss-bg ss-results-card" data-result={result ?? undefined} style={backdrop(result === 'defeat' ? 'armada-reach' : 'map')}>
    <h2>{result === 'victory' ? 'Victory' : result === 'defeat' ? 'Defeat' : 'Expedition saved'}</h2>{publicView.message && <p>{publicView.message}</p>}<Debrief view={publicView}/></div></div>;
}
/** Host-only soundtrack; phones never duplicate the music. */
function AudioView(props: GameAudioProps<Wire>) {
  const music = useRef<StarshipMusic | null>(null);
  useEffect(() => { if (!props.isHost) return; const instance = music.current = new StarshipMusic(); return () => { instance.dispose(); music.current = null; }; }, [props.isHost]);
  useEffect(() => { music.current?.update({ ...props, publicView: props.publicView && decode(props.publicView) }); }, [props.isHost, props.phase, props.publicView, props.connected]);
  return null;
}
export const client: GameClientModule<Input, Action, Settings, Wire, Own> = {
  immersivePhone: true, allowPortraitController: view => !!view && view.phase !== 'combat',
  DisplayView: Ready(Display), ControllerView: Ready(Controller), PersonalView: Ready(Personal), SettingsView, InstructionsView, ResultsView, AudioView,
  prepare: async ({ assetBase, signal }) => { await Promise.all([loadShipArt(assetBase, signal), typeof document !== 'undefined' && 'fonts' in document ? Promise.race([Promise.all([document.fonts.load("400 24px 'Lilita One'"), document.fonts.load("800 24px Nunito")]).catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]) : null]); },
  dispose: () => {},
};
export default client;
