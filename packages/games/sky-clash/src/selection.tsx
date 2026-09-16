import { useState } from 'react';
import { Eyebrow, Modal, TextInput } from '../../../party-ui/src/index';
import { FIGHTERS, ROSTER, type FighterKind } from './model';
import { getStage, STAGE_IDS, type StageId } from './stages';
const PORTRAITS = import.meta.glob('../assets/*-portrait.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const portrait = (kind: FighterKind) => PORTRAITS[`../assets/${kind}-portrait.png`];
export function StagePreview({ id }: { id: StageId }) {
  return <img className="sc-stage-preview" src={`/games/sky-clash/maps/${id}.webp`} alt={`${getStage(id).name} arena screenshot`} width="640" height="360" loading="lazy"/>;
}
export function StageCard({ choice, hazards }: { choice: StageId; hazards: boolean }) {
  const s = getStage(choice);
  return <div className="sc-stage-card"><StagePreview id={choice}/><div className="sc-stage-copy"><Eyebrow>{STAGE_IDS.indexOf(choice) + 1} of {STAGE_IDS.length} maps</Eyebrow><h3>{s.name}</h3><p>{s.description}</p><p className="sc-stage-source">{s.source ? `Inspired by ${s.source}.` : 'The original Sky Clash arena.'}</p><p>{s.hazard ? `${s.hazard.label}${hazards ? '' : ' · off'}` : 'No hazard'}{s.platforms.some(p => p.motion) ? ' · Moving platforms' : ''}</p></div></div>;
}
export function FighterChoices({ value, disabled, onChange }: { value: FighterKind; disabled: boolean; onChange(kind: FighterKind): void }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), sourced = ROSTER.filter(k => !FIGHTERS[k].bonus).length;
  const list = ROSTER.filter(k => (filter === 'all' || (filter === 'bonus') === FIGHTERS[k].bonus) && `${FIGHTERS[k].name} ${FIGHTERS[k].specials.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div className="sc-menu-tools"><TextInput type="search" aria-label="Search fighters" value={query} placeholder="Search fighters" onChange={e => setQuery(e.target.value)}/><select aria-label="Filter fighters" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All {ROSTER.length}</option><option value="sourced">Sourced {sourced}</option><option value="bonus">Bonus {ROSTER.length-sourced}</option></select></div><div className="sc-tiles" role="group" aria-label="Fighters" tabIndex={0}>{list.map(kind => <button type="button" key={kind} className={`sc-tile${kind === value ? ' sc-tile-on' : ''}`} aria-label={FIGHTERS[kind].name} aria-pressed={kind === value} disabled={disabled && kind !== value} onClick={() => onChange(kind)}><img src={portrait(kind)} alt="" width="64" height="64" loading="lazy"/><span>{FIGHTERS[kind].name}</span>{FIGHTERS[kind].bonus && <small>bonus</small>}</button>)}{!list.length && <p>No fighters match that search.</p>}</div></>;
}
export function FighterDetails({ kind, onClose }: { kind: FighterKind; onClose(): void }) {
  const f = FIGHTERS[kind], rows: [string, number][] = [['Ground speed', f.speed], ['Jump', f.jump], ['Weight', f.weight], ['Jumps', f.jumps]];
  return <Modal title={f.name} onClose={onClose}><div className="sc-fighter-info"><img src={portrait(kind)} alt={`${f.name} portrait`} width="128" height="128"/><p>{f.description}</p><dl className="sc-specials">{f.specials.map((name, i) => <div key={i}><dt>{['Special','Side + Special','Up + Special','Down + Special'][i]}</dt><dd>{name}</dd></div>)}</dl><dl className="sc-choice-stats">{rows.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{Number(value.toPrecision(4))}</dd></div>)}</dl></div></Modal>;
}
