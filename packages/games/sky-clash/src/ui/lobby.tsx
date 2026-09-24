import { useState, type CSSProperties } from 'react';
import { ArcadeButton, Eyebrow, Modal, StatusNotice, TextInput, type LobbyViewProps } from '../../../../party-ui/src/index';
import type { RosterPlayer } from '../../../../party-contract/src/protocol';
import { FIGHTERS, type FighterKind, type LobbyChoice, type Settings } from '../model';
import { STAGE_IDS, getStage, stageFrame, type StageId } from '../stages';
import { Portrait, StageImage, costumeOf, costumeTone, costumesOf, tone } from './assets';
import { CPU_LEVELS, DIRECTIONS, SERIES, STAT_LABELS, costumeColors, filterFighters, fighterStats, seriesOf, type SeriesId } from './data';
import { cpuCount, firstStep, isComplete, leaders, pickCostume, pickFighter, pickStage, readChoice, readSettings, readyChoice, rulesLine, takenCostumes, voteCounts, type StagePick } from './lobby-choice';
type Props = LobbyViewProps<Settings>;
const fighterName = (f: LobbyChoice['fighter']) => f === 'random' ? 'Random' : f ? FIGHTERS[f].name : 'Choosing…';
const stageName = (s: LobbyChoice['stage']) => s === 'random' ? 'Random stage' : s ? getStage(s).name : 'No vote yet';
const hazardLabel = (id: StageId) => getStage(id).hazardLabel ?? stageFrame(id, 0, true).hazard?.label;
const cpuNote = (humans: number, s: Settings) => { const n = cpuCount(humans, s); return n ? `+${n} CPU${n === 1 ? '' : 's'} · ${CPU_LEVELS[s.cpuLevel]}` : null; };
export function LobbyView(props: Props) {
  const me = props.players.find(p => p.id === props.playerId);
  // A new lobby id (settings change, replay) re-reads the server's copy of this seat's draft.
  return me ? <PhoneLobby key={props.lobbyId} {...props} me={me}/> : <LobbyBoard {...props}/>;
}
// ── Phone ────────────────────────────────────────────────────────────────
function PhoneLobby({ players, settings: raw, connected, error, onChoice, onReady, me }: Props & { me: RosterPlayer }) {
  const settings = readSettings(raw), voting = settings.stage === 'vote';
  const [draft, setDraft] = useState(() => readChoice(me.lobbyChoice)), [step, setStep] = useState(() => firstStep(draft, voting)), [details, setDetails] = useState(false);
  const send = (next: LobbyChoice) => { setDraft(next); onChoice(next); };
  const ready = () => { const next = readyChoice(draft, voting); if (next !== draft) send(next); onReady(true); };
  const readyCount = players.filter(p => p.ready).length, cpus = cpuNote(players.length, settings), kind = draft.fighter !== 'random' ? draft.fighter : null;
  const notices = <>{!connected && <StatusNotice>Reconnecting… your picks are saved.</StatusNotice>}{error && <StatusNotice tone="error">{error}</StatusNotice>}</>;
  if (me.ready) return <section className="sky-clash-lobby sc-phone-lobby sc-ready" style={kind ? costumeTone(kind, draft.costume) : undefined}>
    <Portrait kind={draft.fighter} costume={draft.costume} render className="sc-ready-render"/>
    <div className="sc-ready-copy">
      <Eyebrow>Locked in · {readyCount}/{players.length} ready</Eyebrow>
      <h2>{fighterName(draft.fighter)}{kind && <small>{costumeOf(kind, draft.costume).name}</small>}</h2>
      {voting && <p className="sc-ready-vote">{draft.stage && <StageImage id={draft.stage}/>}<span>Your stage vote<b>{stageName(draft.stage)}</b></span></p>}
      <p className="kp-muted">{cpus ? `${cpus}. ` : ''}The host starts when everyone is ready. Turn your phone sideways for the fight.</p>
      <ArcadeButton tone="ghost" disabled={!connected} onClick={() => onReady(false)}>Not ready · change picks</ArcadeButton>
      {notices}
    </div>
  </section>;
  const fighterStep = step === 'fighter';
  return <section className="sky-clash-lobby sc-phone-lobby" data-step={step} style={kind ? costumeTone(kind, draft.costume) : undefined}>
    <header className="sc-lobby-head">
      <div><Eyebrow>{voting ? `Step ${fighterStep ? 1 : 2} of 2 · ` : ''}{rulesLine(settings)}{cpus ? ` · ${cpus}` : ''}</Eyebrow><h2>{fighterStep ? 'Choose your fighter' : 'Vote for a stage'}</h2></div>
    </header>
    {fighterStep ? <FighterPicker players={players} me={me.id} draft={draft} disabled={!connected} onChange={send} onDetails={() => setDetails(true)}/>
      : <StagePicker players={players} draft={draft} disabled={!connected} onChange={send}/>}
    <footer className="sc-lobby-foot">
      {fighterStep ? <>
        {draft.fighter && <Portrait kind={draft.fighter} costume={draft.costume} render className="sc-foot-hero"/>}
        <SelectedFighter players={players} me={me.id} draft={draft} disabled={!connected} onChange={send} onDetails={() => setDetails(true)}/>
        {voting ? <ArcadeButton tone="sky" disabled={!connected || !draft.fighter} onClick={() => setStep('stage')}>Next: stage vote</ArcadeButton>
          : <ArcadeButton tone="lime" disabled={!connected || !draft.fighter} onClick={ready}>Ready!</ArcadeButton>}
      </> : <>
        {draft.stage ? <div className="sc-foot-hero"><StageImage id={draft.stage}/><p>{draft.stage === 'random' ? 'If Random wins, any of the 30 stages can come up.' : getStage(draft.stage).blurb}</p></div>
          : draft.fighter && <Portrait kind={draft.fighter} costume={draft.costume} render className="sc-foot-hero"/>}
        <p className="sc-foot-vote">{draft.stage ? <><small>Your vote</small><b>{stageName(draft.stage)}</b></> : 'Tap a stage to vote'}</p>
        <ArcadeButton tone="ghost" onClick={() => setStep('fighter')}>← Fighter</ArcadeButton>
        <ArcadeButton tone="lime" disabled={!connected || !isComplete(draft)} onClick={ready}>Ready!</ArcadeButton>
      </>}
      {notices}
    </footer>
    {details && draft.fighter && <Modal title={fighterName(draft.fighter)} onClose={() => setDetails(false)}><FighterDetails kind={draft.fighter} costume={draft.costume}/></Modal>}
  </section>;
}
function FighterPicker({ players, me, draft, disabled, onChange, onDetails }: { players: RosterPlayer[]; me: string; draft: LobbyChoice; disabled: boolean; onChange(c: LobbyChoice): void; onDetails(): void }) {
  const [query, setQuery] = useState(''), [series, setSeries] = useState<SeriesId | 'all'>('all'), list = filterFighters(query, series);
  const others = (kind: FighterKind) => players.filter(p => p.id !== me && readChoice(p.lobbyChoice).fighter === kind);
  const tile = (id: FighterKind | 'random') => { const on = draft.fighter === id, costume = on ? draft.costume : 0, taken = id === 'random' ? [] : others(id);
    return <button key={id} type="button" className="sc-fighter-tile" aria-pressed={on} disabled={disabled} style={id === 'random' ? undefined : costumeTone(id, costume)}
      aria-label={`${id === 'random' ? 'Random fighter' : FIGHTERS[id].name}${taken.length ? `, also picked by ${taken.map(p => p.name).join(', ')}` : ''}`}
      onClick={() => { if (on && id !== 'random') onDetails(); else onChange(pickFighter(draft, id)); }}>
      <Portrait kind={id} costume={costume}/><span>{id === 'random' ? 'Random' : FIGHTERS[id].name}</span>
      {taken.length > 0 && <i className="sc-tile-dots" aria-hidden="true">{taken.map(p => <em key={p.id} style={{ background: p.color }}/>)}</i>}
    </button>; };
  return <div className="sc-lobby-body sc-fighter-body">
    <div className="sc-tools">
      <TextInput type="search" aria-label="Search fighters or specials" placeholder="Search 33 fighters" value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="sc-chips" role="group" aria-label="Series">{[{ id: 'all' as const, label: 'All' }, ...SERIES].map(s => <button key={s.id} type="button" aria-pressed={series === s.id} onClick={() => setSeries(s.id)}>{s.label}</button>)}</div>
    </div>
    <div className="sc-fighter-grid" role="group" aria-label="Fighters">
      {!query && series === 'all' && tile('random')}
      {list.map(tile)}
      {!list.length && <p className="sc-empty">No fighter matches “{query}”.</p>}
    </div>
  </div>;
}
function SelectedFighter({ players, me, draft, disabled, onChange, onDetails }: { players: RosterPlayer[]; me: string; draft: LobbyChoice; disabled: boolean; onChange(c: LobbyChoice): void; onDetails(): void }) {
  const f = draft.fighter;
  if (!f) return <p className="sc-foot-pick">Tap a fighter. Tap again for moves and stats.</p>;
  if (f === 'random') return <div className="sc-foot-pick"><Portrait kind="random"/><div className="sc-foot-random"><b>Random</b><small>Dealt when the match starts</small></div></div>;
  return <div className="sc-foot-pick">
    <button type="button" className="sc-foot-who" onClick={onDetails} aria-label={`${FIGHTERS[f].name} details: stats and specials`}><Portrait kind={f} costume={draft.costume}/><span><b>{FIGHTERS[f].name}</b><small>{costumeOf(f, draft.costume).name} · Details</small></span></button>
    <Swatches kind={f} costume={draft.costume} taken={takenCostumes(players, me, f)} disabled={disabled} onPick={n => onChange(pickCostume(draft, n))}/>
  </div>;
}
function Swatches({ kind, costume, taken, disabled, onPick }: { kind: FighterKind; costume: number; taken?: Set<number>; disabled?: boolean; onPick?(n: number): void }) {
  return <div className="sc-swatches" role="group" aria-label="Costume">{costumesOf(kind).map((c, i) => { const col = costumeColors(c, kind);
    return <button key={i} type="button" className="sc-swatch" aria-pressed={costume === i} disabled={disabled || !onPick} onClick={() => onPick?.(i)}
      aria-label={`${c.name} costume${taken?.has(i) ? ' (also picked by another player)' : ''}`} title={c.name}
      style={{ background: `conic-gradient(from 225deg, ${col.primary} 0 50%, ${col.secondary} 0 75%, ${col.accent} 0)` }}>{taken?.has(i) && <em aria-hidden="true"/>}</button>; })}</div>;
}
/** Full fighter sheet: render, series, Melee attributes, specials by direction and costumes. */
export function FighterDetails({ kind, costume }: { kind: FighterKind | 'random'; costume: number }) {
  if (kind === 'random') return <div className="sc-details"><Portrait kind="random" render className="sc-details-render"/><p>One of the 33 fighters is dealt to you when the match starts. Feeling lucky?</p></div>;
  const f = FIGHTERS[kind], s = fighterStats(kind);
  return <div className="sc-details" style={costumeTone(kind, costume)}>
    <Portrait kind={kind} costume={costume} render className="sc-details-render"/>
    <div className="sc-details-copy">
      <Eyebrow>{seriesOf(kind).label}{f.bonus ? ' · Bonus fighter' : ''}</Eyebrow>
      <p className="sc-facts"><span><b className="kp-numeral">{s.weight}</b> weight</span><span><b className="kp-numeral">{s.jumps}</b> jumps</span><span><b className="kp-numeral">{s.height.toFixed(1)}</b> m</span><span>{s.weightClass}</span></p>
      <dl className="sc-bars">{(Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[]).map(k => <div key={k}><dt>{STAT_LABELS[k]}</dt>
        <dd role="meter" aria-label={STAT_LABELS[k]} aria-valuemin={1} aria-valuemax={5} aria-valuenow={s.bars[k]}>{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= s.bars[k] ? 'sc-on' : undefined}/>)}</dd></div>)}</dl>
    </div>
    <ul className="sc-specials" aria-label="Specials">{f.specials.map((name, i) => <li key={i}><b aria-label={`${DIRECTIONS[i].label} special`}>{DIRECTIONS[i].arrow}</b><span><small>{DIRECTIONS[i].label} + Special</small>{name}</span></li>)}</ul>
    <Swatches kind={kind} costume={costume}/>
  </div>;
}
function StagePicker({ players, draft, disabled, onChange }: { players: RosterPlayer[]; draft: LobbyChoice; disabled: boolean; onChange(c: LobbyChoice): void }) {
  const [query, setQuery] = useState(''), counts = voteCounts(players), q = query.trim().toLowerCase();
  const ids: StagePick[] = ['random', ...STAGE_IDS.filter(id => !q || `${getStage(id).name} ${getStage(id).source}`.toLowerCase().includes(q))];
  return <div className="sc-lobby-body sc-stage-body">
    <div className="sc-tools"><TextInput type="search" aria-label="Search stages" placeholder="Search 30 stages" value={query} onChange={e => setQuery(e.target.value)}/><p className="kp-muted">Most votes wins · ties drawn at random</p></div>
    <div className="sc-stage-grid" role="group" aria-label="Stages">{ids.map(id => { const hazard = id === 'random' ? null : hazardLabel(id), voters = players.filter(p => readChoice(p.lobbyChoice).stage === id);
      return <button key={id} type="button" className="sc-stage-card" aria-pressed={draft.stage === id} disabled={disabled} onClick={() => onChange(pickStage(draft, id))}
        aria-label={`${id === 'random' ? 'Random stage' : getStage(id).name}, ${counts[id]} vote${counts[id] === 1 ? '' : 's'}`} style={id === 'random' ? undefined : tone(getStage(id).palette.accent)}>
        <StageImage id={id}/><span className="sc-stage-name">{id === 'random' ? 'Random' : getStage(id).name}</span>
        <span className="sc-stage-meta">{id === 'random' ? 'Any of the 30' : hazard ? `⚠ ${hazard}` : 'No hazards'}</span>
        {counts[id] > 0 && <b className="sc-votes"><span className="kp-numeral">{counts[id]}</span>{voters.map(p => <em key={p.id} style={{ background: p.color }}/>)}</b>}
      </button>; })}</div>
  </div>;
}
// ── Display (host watching) ───────────────────────────────────────────────
function LobbyBoard({ players, settings: raw }: Props) {
  const settings = readSettings(raw), counts = voteCounts(players), cpus = cpuCount(players.length, settings), readyCount = players.filter(p => p.ready).length;
  const fixed = settings.stage === 'vote' ? null : settings.stage, lead = leaders(players);
  const voted = (Object.keys(counts) as StagePick[]).filter(id => counts[id] > 0).sort((a, b) => counts[b] - counts[a]);
  return <section className="sky-clash-lobby sc-board" style={{ '--seats': Math.max(2, players.length + cpus) } as CSSProperties}>
    <header className="sc-board-head">
      <h2 className="kp-display">Choose your fighters</h2>
      <p><b className="kp-numeral">{readyCount}/{players.length}</b> ready · {rulesLine(settings)}</p>
    </header>
    <ol className="sc-board-seats">
      {players.map((p, i) => { const c = readChoice(p.lobbyChoice), f = c.fighter, kind = f && f !== 'random' ? f : null;
        return <li key={p.id} className={`sc-seat${p.ready ? ' sc-seat-ready' : ''}${p.connected ? '' : ' sc-seat-offline'}`} style={kind ? costumeTone(kind, c.costume, { '--sc-player': p.color }) : tone(p.color, { '--sc-player': p.color })}>
          <span className="sc-seat-tag kp-numeral">P{i + 1}</span>
          <span className="sc-seat-state">{p.ready ? 'Ready!' : p.connected ? f ? 'Picking…' : 'Choosing…' : 'Offline'}</span>
          <Portrait kind={f} costume={c.costume} render className="sc-seat-render"/>
          <div className="sc-seat-copy">
            <strong className="sc-seat-name">{p.name}</strong>
            <span className="sc-seat-fighter">{fighterName(f)}</span>
            <span className="sc-seat-costume">{kind ? <><Swatches kind={kind} costume={c.costume}/>{costumeOf(kind, c.costume).name}</> : f === 'random' ? 'Dealt at the start' : ' '}</span>
            {!fixed && <span className="sc-seat-vote">{c.stage ? <><StageImage id={c.stage}/><span>{stageName(c.stage)}</span></> : <span>No stage vote yet</span>}</span>}
          </div>
        </li>; })}
      {Array.from({ length: cpus }, (_, i) => <li key={`cpu-${i}`} className="sc-seat sc-seat-cpu sc-seat-ready">
        <span className="sc-seat-tag kp-numeral">CPU</span><span className="sc-seat-state">{CPU_LEVELS[settings.cpuLevel]}</span>
        <Portrait kind="random" render className="sc-seat-render"/>
        <div className="sc-seat-copy"><strong className="sc-seat-name">CPU {i + 1}</strong><span className="sc-seat-fighter">Random fighter</span><span className="sc-seat-costume">{players.length === 1 && !settings.cpus ? 'Your sparring partner' : 'Joins the brawl'}</span></div>
      </li>)}
    </ol>
    <div className="sc-board-votes" aria-live="polite">
      <Eyebrow>{fixed ? 'Stage chosen by the host' : 'Stage votes · most votes wins, ties drawn at random'}</Eyebrow>
      <div className="sc-vote-row">{fixed ? <VoteTile id={fixed} count={null} lead players={[]}/>
        : voted.length ? voted.map(id => <VoteTile key={id} id={id} count={counts[id]} lead={lead.includes(id)} tied={lead.length > 1} players={players.filter(p => readChoice(p.lobbyChoice).stage === id)}/>)
        : <p className="kp-muted">No votes yet. All 30 stages (and Random) are on your phones.</p>}</div>
    </div>
  </section>;
}
function VoteTile({ id, count, lead, tied, players }: { id: StagePick; count: number | null; lead: boolean; tied?: boolean; players: RosterPlayer[] }) {
  return <article className={`sc-vote-tile${lead ? ' sc-vote-lead' : ''}`}><StageImage id={id}/>
    <div><strong>{id === 'random' ? 'Random' : getStage(id).name}</strong>{count === null ? <small>Host pick</small> : <small><b className="kp-numeral">{count}</b> vote{count === 1 ? '' : 's'}{lead ? tied ? ' · tied' : ' · leading' : ''}</small>}
      <span className="sc-voters">{players.map(p => <i key={p.id} style={{ background: p.color }} title={p.name}/>)}</span></div></article>;
}
