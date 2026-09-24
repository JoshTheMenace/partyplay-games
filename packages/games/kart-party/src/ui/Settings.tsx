/* Host settings: course cards with real outlines, then race rules as labelled radio groups. */
import type { ReactNode } from 'react';
import type { SettingsViewProps } from '../../../../party-ui/src/index';
import { TRACK_DEFS, TRACK_IDS } from '../tracks/index';
import type { Settings } from '../sim/types';
import { TrackShape } from './Minimap';

export const DEFAULT_SETTINGS: Settings = { track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 8, items: 'normal', views: 'auto' };
/** The set-pieces only Rainbow Road has, listed on its finale card. */
const FINALE = ['Star rings', 'Springs', 'Low gravity', 'Pinball bumpers', 'Loop-the-loop'];
type Option<V> = { value: V; label: ReactNode; note?: string };

function Choice<K extends keyof Settings>({ name, label, help, options, settings, onChange, disabled, wide }: {
  name: K; label: string; help?: string; options: Option<Settings[K]>[]; settings: Settings; onChange(s: Settings): void; disabled: boolean; wide?: boolean;
}) {
  const current = options.find(o => o.value === settings[name]);
  return <fieldset className={`kp2-choice ${wide ? 'is-wide' : ''}`} disabled={disabled}>
    <legend>{label}</legend>
    <div className="kp2-seg">{options.map(o => <label key={String(o.value)} className={o.value === settings[name] ? 'is-on' : ''}>
      <input type="radio" name={`kp2-${name}`} checked={o.value === settings[name]} onChange={() => onChange({ ...settings, [name]: o.value })}/><span>{o.label}</span>
    </label>)}</div>
    {(current?.note ?? help) && <p className="kp2-choice-note">{current?.note ?? help}</p>}
  </fieldset>;
}

export function SettingsPanel({ settings: raw, onChange, disabled }: SettingsViewProps<Settings>) {
  const settings = { ...DEFAULT_SETTINGS, ...raw };
  const props = { settings, onChange, disabled };
  return <div className="kp2-settings">
    <fieldset className="kp2-courses" disabled={disabled}><legend>Course</legend>
      <div className="kp2-course-grid">{TRACK_IDS.map(id => { const def = TRACK_DEFS[id]; return <label key={id} className={`kp2-course kp2-theme-${def.theme} ${settings.track === id ? 'is-on' : ''}`}>
        <input type="radio" name="kp2-track" checked={settings.track === id} onChange={() => onChange({ ...settings, track: id })}/>
        <TrackShape id={id}/>{def.theme === 'space' && <em className="kp2-course-badge">Grand finale</em>}<b>{def.name}</b><small>{def.tagline}</small>
        {def.theme === 'space' && <ul className="kp2-course-chips">{FINALE.map(f => <li key={f}>{f}</li>)}</ul>}
      </label>; })}</div>
    </fieldset>
    <div className="kp2-choice-grid">
      <Choice name="laps" label="Laps" options={[1, 2, 3, 4, 5].map(n => ({ value: n, label: n, note: `${n} ${n === 1 ? 'lap' : 'laps'} · about ${n === 1 ? '40 seconds' : `${Math.round(n * 4 / 3) / 2} minutes`}` }))} {...props}/>
      <Choice name="speedClass" label="Engine class" options={[
        { value: 50, label: '50cc', note: 'Gentle. Great for first-timers and little ones.' },
        { value: 100, label: '100cc', note: 'The classic pace. Drift for an edge.' },
        { value: 150, label: '150cc', note: 'Fast. Corners need real drifts.' },
        { value: 200, label: '200cc', note: 'Blistering. Brake and drift or kiss the wall.' }]} {...props}/>
      <Choice name="difficulty" label="CPU racers" options={[
        { value: 'easy', label: 'Easy', note: 'Relaxed CPUs that make mistakes.' },
        { value: 'normal', label: 'Normal', note: 'Solid racers. A good drifter pulls ahead.' },
        { value: 'hard', label: 'Hard', note: 'They drift, trick and aim. Bring your best.' }]} {...props}/>
      <Choice name="items" label="Items" options={[
        { value: 'normal', label: 'Normal', note: 'Item boxes on. Racers at the back get better items.' },
        { value: 'frantic', label: 'Frantic', note: 'Everyone gets back-of-the-pack power items. Chaos!' },
        { value: 'off', label: 'Off', note: 'Pure driving. No item boxes.' }]} {...props}/>
      <Choice name="gridSize" label="Grid size" wide options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({ value: n, label: n,
        note: n === 1 ? 'Humans only, no CPUs.' : `CPUs fill the grid up to ${n} racers.` }))} {...props}/>
      <Choice name="views" label="Where people race" wide options={[
        { value: 'auto', label: 'Auto', note: 'Up to 4 players share the TV in split screen. With 5 or more, each phone shows its own race and the TV follows the action.' },
        { value: 'tv', label: 'TV split', note: 'Everyone races on the TV (small tiles with 5+ players). Phones are controllers only.' },
        { value: 'personal', label: 'Own phone', note: 'Each phone shows its own 3D race with touch controls. The TV becomes a live broadcast.' }]} {...props}/>
    </div>
  </div>;
}
