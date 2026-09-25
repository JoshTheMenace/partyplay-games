import { useState } from 'react';
import { StatusNotice, ToggleRow, type SettingsViewProps } from '../../../../party-ui/src/index';
import {
  CPU_LEVELS, DEFAULT_SETTINGS, MAPS, MISSIONS, MODES, ROUND_SECONDS, SCENARIOS, SEAFARERS_SCENARIOS,
  TABLE_SIZE, TARGET_RANGE, TIMER_PRESETS, TIMERS, VARIANTS, type Settings, type TimedStep,
} from '../model';
import { maxTarget, restrictions, suggestedTarget, type OptionKey } from '../settings';
import { EmblemChip } from './shared/SeatChip';
import { plural, secondsText } from './shared/format';
import { MODULE_HELP } from './shared/help';
import {
  CPU_NAMES, MAP_NAMES, MISSION_NAMES, MODE_NAMES, SCENARIO_NAMES, SEAFARERS_NAMES, TIMER_NAMES,
  VARIANT_NAMES,
} from './shared/labels';

const MAP_BLURB = {
  base: 'One island with classic harbours. It grows for 5–10 players.',
  seafarers: 'Islands across the sea. Ships, gold fields and a pirate.',
  explorers: 'Sail into fog with settlers and crews. Missions score points.',
};
const MODE_BLURB = {
  standard: 'One player at a time. With 5+ players the next player gets a build turn.',
  connect: 'One shared roll, then everyone trades and builds at once against a round timer.',
};
const STEPS: [TimedStep, string][] = [
  ['setup', 'Setup step'], ['roll', 'Roll'], ['main', 'Main turn'], ['paired', 'Paired turn'],
  ['discard', 'Discard'], ['robber', 'Robber'], ['prompt', 'Other prompts'], ['offer', 'Offer open'],
];
const NAMES: Record<OptionKey, string> = { ...SCENARIO_NAMES, ...VARIANT_NAMES };
const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const flip = <T extends string>(list: readonly T[], key: T, on: boolean) =>
  on ? [...list, key] : list.filter(k => k !== key);

type Option<T> = readonly [value: T, label: string, blurb?: string];
type RadiosProps<T> = {
  legend: string; value: T; options: readonly Option<T>[]; onPick(value: T): void; disabled: boolean;
};
function Radios<T extends string | number>({ legend, value, options, onPick, disabled }: RadiosProps<T>) {
  return <fieldset className="island-settlers-radios"><legend>{legend}</legend>
    {options.map(([v, label, blurb]) => <label key={v} data-on={v === value || undefined}>
      <input type="radio" name={legend} checked={v === value} disabled={disabled} onChange={() => onPick(v)}/>
      <span><b>{label}</b>{blurb && <small>{blurb}</small>}</span>
    </label>)}
  </fieldset>;
}

/** "You + 2 phones + 1 CPU = 4 seats" for a chosen head count (the view is not told who has joined). */
function TablePreview({ size }: { size: number }) {
  const [people, setPeople] = useState(1), seats = Math.max(size, people), cpus = seats - people;
  const parts = ['You', people > 1 ? plural(people - 1, 'phone') : '', cpus ? plural(cpus, 'CPU') : ''];
  return <>
    <label>Preview with<select value={people} onChange={e => setPeople(+e.target.value)}>
      {range(1, TABLE_SIZE.max).map(n => <option key={n} value={n}>{plural(n, 'person', 'people')}</option>)}
    </select></label>
    <p className="island-settlers-preview" aria-live="polite">
      <span aria-hidden="true">{range(0, seats - 1).map(i => <EmblemChip key={i} index={i} size="28px"/>)}</span>
      {parts.filter(Boolean).join(' + ')} = {plural(seats, 'seat')}
      {seats > size ? ' (the table grows to fit)' : ''}
    </p>
  </>;
}

function TimerTable({ timer }: { timer: Settings['timer'] }) {
  return <div className="island-settlers-scroll"><table className="island-settlers-timers">
    <thead><tr><th scope="col">Preset</th>
      {STEPS.map(([k, label]) => <th key={k} scope="col">{label}</th>)}
    </tr></thead>
    <tbody>{TIMER_PRESETS.map(t => <tr key={t} data-on={t === timer || undefined}>
      <th scope="row">{TIMER_NAMES[t]}</th>{STEPS.map(([k]) => <td key={k}>{secondsText(TIMERS[t][k])}</td>)}
    </tr>)}</tbody>
  </table></div>;
}

/** Host settings (EXPERIENCE §4.10). Blocked options show why; conflicting picks turn off visibly. */
export function SettingsView({ settings: raw, onChange, disabled }: SettingsViewProps<Settings>) {
  const s: Settings = { ...DEFAULT_SETTINGS, ...raw }, reasons = restrictions(s);
  const suggested = suggestedTarget(s), max = maxTarget(s);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (part: Partial<Settings>) => {
    const next = { ...s, ...part }, blocked = restrictions(next);
    const gone = [...next.scenarios, ...next.variants].filter(k => blocked[k]);
    next.scenarios = next.scenarios.filter(k => !blocked[k]);
    next.variants = next.variants.filter(k => !blocked[k]);
    // A target still at the old suggestion follows the new one; a custom target is only clamped.
    const follow = s.targetPoints === suggested && part.targetPoints === undefined;
    next.targetPoints = follow ? suggestedTarget(next) : Math.min(next.targetPoints, maxTarget(next));
    setNotice(gone.length ? gone.map(k => `${NAMES[k]} turned off: ${blocked[k]}`).join(' ') : null);
    onChange(next);
  };
  const toggle = (key: OptionKey, list: 'scenarios' | 'variants') => {
    const on = (s[list] as OptionKey[]).includes(key);
    return <div key={key} className="island-settlers-toggle">
      <ToggleRow label={NAMES[key]} checked={on} disabled={disabled || !!reasons[key]}
        onChange={value => set({ [list]: flip(s[list] as OptionKey[], key, value) })}/>
      <small data-blocked={reasons[key] ? '' : undefined}>{reasons[key] ?? MODULE_HELP[key].lines[0]}</small>
    </div>;
  };

  return <div className="island-settlers-settings">
    <section><h3>Table</h3><div className="island-settlers-row">
      <label>Seats<select value={s.tableSize} disabled={disabled}
        onChange={e => set({ tableSize: +e.target.value })}>
        {range(TABLE_SIZE.min, TABLE_SIZE.max).map(n => <option key={n} value={n}>{n} seats</option>)}
      </select></label>
      <TablePreview size={s.tableSize}/>
    </div></section>
    <Radios legend="Map" value={s.map} disabled={disabled} onPick={map => set({ map })}
      options={MAPS.map(m => [m, MAP_NAMES[m], MAP_BLURB[m]] as const)}/>
    {s.map === 'seafarers' && <Radios legend="Seafarers scenario" value={s.seafarers} disabled={disabled}
      onPick={seafarers => set({ seafarers })}
      options={SEAFARERS_SCENARIOS.map(k => [k, SEAFARERS_NAMES[k]] as const)}/>}
    {s.map === 'explorers' && <fieldset className="island-settlers-toggles"><legend>Missions</legend>
      {MISSIONS.map(k => <ToggleRow key={k} label={MISSION_NAMES[k]} checked={s.missions.includes(k)}
        disabled={disabled} onChange={on => set({ missions: flip(s.missions, k, on) })}/>)}
      <small>Land Ho! (exploring and settling) is always on. Fewer missions mean a lower target.</small>
    </fieldset>}
    <Radios legend="Turns" value={s.mode} disabled={disabled} onPick={mode => set({ mode })}
      options={MODES.map(m => [m, MODE_NAMES[m], MODE_BLURB[m]] as const)}/>
    {s.mode === 'connect' && <Radios legend="Round length" value={s.roundSeconds} disabled={disabled}
      onPick={roundSeconds => set({ roundSeconds })}
      options={ROUND_SECONDS.map(n => [n, `${n} s`] as const)}/>}
    <section><h3>Victory target</h3><div className="island-settlers-row">
      <label>Points to win<select value={s.targetPoints} disabled={disabled}
        onChange={e => set({ targetPoints: +e.target.value })}>
        {range(TARGET_RANGE.min, max).map(n =>
          <option key={n} value={n}>{n}{n === suggested ? ' (suggested)' : ''}</option>)}
      </select></label>
      <p aria-live="polite">Suggested for this setup: <b>{suggested}</b>
        {s.targetPoints !== suggested && <button type="button" className="island-settlers-link"
          disabled={disabled} onClick={() => set({ targetPoints: suggested })}>Use {suggested}</button>}</p>
    </div></section>
    <Radios legend="Timers" value={s.timer} disabled={disabled} onPick={timer => set({ timer })}
      options={TIMER_PRESETS.map(t => [t, TIMER_NAMES[t]] as const)}/>
    <TimerTable timer={s.timer}/>
    <small>Connect rounds always use the round length. A disconnected player who must act gets 30 s.</small>
    <Radios legend="CPU difficulty" value={s.cpuLevel} disabled={disabled}
      onPick={cpuLevel => set({ cpuLevel })}
      options={CPU_LEVELS.map(l => [l, CPU_NAMES[l]] as const)}/>
    <ToggleRow label="Balanced dice: totals turn up about as often as the odds say" checked={s.balancedDice}
      disabled={disabled} onChange={balancedDice => set({ balancedDice })}/>
    {notice && <StatusNotice>{notice}</StatusNotice>}
    <fieldset className="island-settlers-toggles"><legend>Expansions and scenarios</legend>
      <div className="island-settlers-toggle"><ToggleRow label="Cities & Knights" checked={s.citiesKnights}
        disabled={disabled} onChange={citiesKnights => set({ citiesKnights })}/>
        <small>{MODULE_HELP['cities-knights'].lines[0]}</small></div>
      {SCENARIOS.map(k => toggle(k, 'scenarios'))}
    </fieldset>
    <fieldset className="island-settlers-toggles"><legend>Variants</legend>
      {VARIANTS.map(k => toggle(k, 'variants'))}
    </fieldset>
  </div>;
}
