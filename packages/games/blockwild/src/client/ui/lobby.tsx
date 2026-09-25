/** Room-flow views: world settings, instructions and the results journal. */
import { useEffect, useState, type CSSProperties } from 'react';
import { ArcadeButton, ToggleRow, type InstructionsViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../../../party-ui/src/index';
import type { Difficulty, Mode, Settings, View } from '../../shared/protocol';
import { awards, formatDistance } from './format';

function Segment<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: readonly { value: T; label: string; note: string }[]; disabled: boolean; onChange(value: T): void }) {
  return <fieldset className="bw-field" disabled={disabled}>
    <legend>{label}</legend>
    <div className="bw-segment" role="radiogroup" aria-label={label}>
      {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)}>
        {option.label}<small>{option.note}</small>
      </button>)}
    </div>
  </fieldset>;
}
const MODES: readonly { value: Mode; label: string; note: string }[] = [
  { value: 'survival', label: 'Survival', note: 'Gather, craft, survive the night' }, { value: 'creative', label: 'Creative', note: 'Every block, flight, no danger' },
];
const DIFFICULTIES: readonly { value: Difficulty; label: string; note: string }[] = [
  { value: 'peaceful', label: 'Peaceful', note: 'No monsters' }, { value: 'easy', label: 'Easy', note: 'Gentle nights' }, { value: 'normal', label: 'Normal', note: 'The real thing' },
];
const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

const SEEDS: readonly { value: 'random' | 'fixed'; label: string; note: string }[] = [
  { value: 'random', label: 'Random each world', note: 'A fresh world every start' }, { value: 'fixed', label: 'Fixed seed', note: 'Replay a world you liked' },
];

export function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const fixed = settings.seed > 0, [draft, setDraft] = useState(fixed ? String(settings.seed) : '');
  useEffect(() => { if (settings.seed > 0) setDraft(String(settings.seed)); }, [settings.seed]);
  const valid = /^\d{1,6}$/.test(draft) && Number(draft) >= 1;
  return <div className="bw-world-settings">
    <Segment label="Mode" value={settings.mode} options={MODES} disabled={disabled} onChange={mode => onChange({ ...settings, mode })}/>
    {settings.mode === 'survival' && <Segment label="Difficulty" value={settings.difficulty} options={DIFFICULTIES} disabled={disabled} onChange={difficulty => onChange({ ...settings, difficulty })}/>}
    <Segment label="World seed" value={fixed ? 'fixed' : 'random'} options={SEEDS} disabled={disabled}
      onChange={choice => onChange({ ...settings, seed: choice === 'random' ? 0 : valid ? Number(draft) : randomSeed() })}/>
    {fixed && <div className="bw-field">
      <div className="bw-seed-row">
        <input id="bw-seed" className="kp-input" inputMode="numeric" autoComplete="off" maxLength={6} value={draft} disabled={disabled} aria-label="Seed number" aria-invalid={!valid} aria-describedby="bw-seed-help"
          onChange={event => {
            const next = event.target.value.replace(/\D/g, '').slice(0, 6);
            setDraft(next);
            if (/^\d{1,6}$/.test(next) && Number(next) >= 1) onChange({ ...settings, seed: Number(next) });
          }}/>
        <ArcadeButton type="button" tone="sky" size="sm" disabled={disabled} onClick={() => onChange({ ...settings, seed: randomSeed() })}>New seed</ArcadeButton>
      </div>
      <small id="bw-seed-help" className={valid ? 'kp-muted' : 'bw-invalid'}>{valid ? 'The same seed always grows the same world.' : 'Use a number from 1 to 999999.'}</small>
    </div>}
    <ToggleRow label="Keep inventory when you die" checked={settings.keepInventory} disabled={disabled} onChange={keepInventory => onChange({ ...settings, keepInventory })}/>
  </div>;
}

export function InstructionsView({ role }: InstructionsViewProps) {
  if (role === 'display') return <div className="bw-instructions">
    <h2>Build a world together</h2>
    <p>Everyone explores the same boundless blocky world from their own phone or laptop. This screen follows the action.</p>
    <p>Punch trees, craft tools, dig for iron and diamonds, and get a roof over your heads before the first night.</p>
  </div>;
  return <div className="bw-instructions">
    <h2>Survive, mine, craft and build</h2>
    <ul>
      <li><b>Phone:</b> hold your phone sideways. Left thumb walks, right thumb looks. Hold <b>Mine</b> to break blocks, tap <b>Use</b> to place.</li>
      <li><b>Keyboard:</b> WASD to move, mouse to look, left click mines, right click places, <kbd>E</kbd> opens your inventory.</li>
      <li>Start by punching a tree. The <b>Next goal</b> hint walks you through the rest, all the way to the Nether.</li>
      <li>Later: find villages to trade emeralds, craft armor, and wire levers, lamps and pistons with redstone.</li>
    </ul>
  </div>;
}

/** World journal: days survived, world totals, and each explorer's highlights and awards. */
export function ResultsView({ outcome, publicView, playerId }: ResultsViewProps<View>) {
  const view = publicView, journal = view.journal ?? [];
  const players = view.players, won = awards(journal);
  const rows = outcome.rows.map(row => ({ row, player: players.find(p => p.id === row.playerId), entry: journal.find(e => e.id === row.playerId) }));
  const days = view.stats.days;
  return <div className="bw-results">
    <p className="kp-eyebrow">World journal</p>
    <h1>{days === 0 ? 'Your first day in the wild' : days === 1 ? 'One day in the wild' : `${days} days in the wild`}</h1>
    <ul className="bw-results-totals">
      <li><b className="kp-numeral">{view.stats.mined.toLocaleString()}</b> blocks mined</li>
      <li><b className="kp-numeral">{view.stats.placed.toLocaleString()}</b> placed</li>
      <li><b className="kp-numeral">{view.stats.crafted.toLocaleString()}</b> crafted</li>
      <li><b className="kp-numeral">{view.stats.mobs.toLocaleString()}</b> mobs defeated</li>
    </ul>
    <ol className="bw-journal">
      {rows.map(({ row, player, entry }) => <li key={row.playerId} data-me={row.playerId === playerId} style={{ '--player': player?.color ?? 'var(--kp-sky)' } as CSSProperties}>
        <b className="bw-journal-name">{player?.name ?? 'Explorer'}</b>
        {won.filter(award => award.ids.includes(row.playerId)).map(award => <span key={award.key} className="bw-award">{award.title}</span>)}
        {entry ? <dl>
          <div><dt>Mined</dt><dd>{entry.mined}</dd></div><div><dt>Placed</dt><dd>{entry.placed}</dd></div><div><dt>Crafted</dt><dd>{entry.crafted}</dd></div>
          <div><dt>Mobs</dt><dd>{entry.mobs}</dd></div><div><dt>Deaths</dt><dd>{entry.deaths}</dd></div><div><dt>Travelled</dt><dd>{formatDistance(entry.distance)}</dd></div>
        </dl> : <p className="kp-muted">{row.label ?? 'Explored the world'}</p>}
      </li>)}
    </ol>
  </div>;
}
