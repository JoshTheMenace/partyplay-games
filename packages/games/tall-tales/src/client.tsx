import { useEffect, useState } from 'react';
import { ArcadeButton, Countdown, Eyebrow, Panel, StatusNotice, TextInput, ToggleRow } from '../../../party-ui/src/index';
import type { GameClientModule, GameViewProps } from '../../../party-ui/src/index';
import type { Action, PrivateView, PublicView, Settings } from './types';
import './styles.css';
type Props = GameViewProps<null, Action, PublicView, PrivateView>;
function SpecimenArt() {
  return <svg className="tall-tales-specimen" viewBox="0 0 300 310" aria-hidden="true">
    <ellipse cx="150" cy="288" rx="125" ry="15" fill="var(--kp-ink)" opacity=".7"/>
    <path d="M43 253V114a107 107 0 0 1 214 0v139" fill="var(--kp-sky)" fillOpacity=".06" stroke="var(--kp-grape)" strokeWidth="4"/>
    <path d="M58 184v-70a92 92 0 0 1 69-89" fill="none" stroke="var(--kp-cream)" strokeOpacity=".25" strokeWidth="6" strokeLinecap="round"/>
    <path d="M150 108C103 43 36 65 58 127c12 35 59 43 88 26C88 130 70 170 101 194c23 18 45-8 49-33M150 108c47-65 114-43 92 19-12 35-59 43-88 26 58-23 76 17 45 41-23 18-45-8-49-33" fill="var(--kp-grape)" stroke="var(--kp-ink)" strokeWidth="5"/>
    <path d="M66 99c30-16 61 17 77 39M234 99c-30-16-61 17-77 39M102 173l37-19M198 173l-37-19" fill="none" stroke="var(--kp-cream)" strokeOpacity=".5" strokeWidth="3"/>
    <circle cx="93" cy="112" r="18" fill="var(--kp-sun)" stroke="var(--kp-ink)" strokeWidth="4"/><circle cx="207" cy="112" r="18" fill="var(--kp-sun)" stroke="var(--kp-ink)" strokeWidth="4"/>
    <circle cx="93" cy="112" r="7" fill="var(--kp-ink)"/><circle cx="207" cy="112" r="7" fill="var(--kp-ink)"/>
    <path d="M150 97v83M150 102l-16-21M150 102l16-21" fill="none" stroke="var(--kp-ink)" strokeWidth="8" strokeLinecap="round"/>
    <path d="M150 185v49M125 234h50" stroke="var(--kp-sun)" strokeWidth="3"/>
    <rect x="28" y="248" width="244" height="32" rx="12" fill="var(--kp-grape)" stroke="var(--kp-ink)" strokeWidth="5"/>
    <rect x="93" y="244" width="114" height="39" rx="5" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="3"/>
    <text x="150" y="268" textAnchor="middle" fill="var(--kp-ink)" fontFamily="var(--font-display)" fontSize="15">UNVERIFIED</text>
    <path d="M264 48v20M254 58h20M31 201v14M24 208h14" stroke="var(--kp-sun)" strokeWidth="3"/>
  </svg>;
}
function Prompt({ text }: { text: string }) {
  return <h2>{text.split(/(_{2,})/).map((part, index) => /^_{2,}$/.test(part) ? <span key={index} className="tall-tales-blank"><span className="tall-tales-sr-only">blank</span></span> : part)}</h2>;
}
function PlayerName({ player }: { player: PublicView['players'][number] }) {
  return <span className="tall-tales-person"><span className="tall-tales-chip" style={{ background: player.color }} aria-hidden="true">{player.name.slice(0, 1).toUpperCase()}</span><span>{player.name}</span></span>;
}
function People({ ids, view }: { ids: string[]; view: PublicView }) {
  return <span className="tall-tales-people">{ids.map(id => { const player = view.players.find(item => item.id === id); return player ? <PlayerName key={id} player={player}/> : <span key={id}>Player</span>; })}</span>;
}
function Header({ publicView: view, serverNowMs }: Props) {
  return <header className="tall-tales-header"><div className="tall-tales-identity"><h1 className="kp-display">Tall Tales</h1><Eyebrow>{view.category}</Eyebrow></div><div className="tall-tales-tag"><span className="kp-numeral">Specimen {String(view.round).padStart(2, '0')}<span className="tall-tales-total">/{String(view.totalRounds).padStart(2, '0')}</span></span>{view.multiplier === 2 && <strong>FINALE · DOUBLE POINTS</strong>}</div>{view.phase !== 'complete' && <Countdown deadline={view.deadline} serverNowMs={serverNowMs}/>}</header>;
}
function Standings({ view }: { view: PublicView }) {
  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  return <Panel className="tall-tales-standings"><Eyebrow>Archive credits<span className="tall-tales-vote-key"> · Vote letters match the labels</span></Eyebrow><ol>{sorted.map(player => <li key={player.id}><span className="kp-numeral tall-tales-rank">{1 + sorted.filter(other => other.score > player.score).length}</span><span className="tall-tales-player-name"><PlayerName player={player}/>{!player.connected && <small>Reconnecting</small>}</span><span className="tall-tales-score"><strong className="kp-numeral">{player.score}</strong><small className="kp-numeral">{player.gain > 0 ? `+${player.gain}` : ''}</small></span>{view.reveal && <span className="tall-tales-vote-mark" aria-label={view.reveal.options.some(option => option.voters.includes(player.id)) ? `Voted for label ${String.fromCharCode(65 + view.reveal.options.findIndex(option => option.voters.includes(player.id)))}` : 'No vote'}>{view.reveal.options.some(option => option.voters.includes(player.id)) ? String.fromCharCode(65 + view.reveal.options.findIndex(option => option.voters.includes(player.id))) : '–'}</span>}</li>)}</ol></Panel>;
}
function Reveal({ view }: { view: PublicView }) {
  if (!view.reveal) return null;
  const truth = view.reveal.options.find(option => option.truth);
  const lies = view.reveal.options.filter(option => !option.truth).sort((a, b) => b.voters.length - a.voters.length);
  const mostBelieved = Math.max(0, ...lies.filter(option => option.authors.length).map(option => option.voters.length));
  return <><Panel className="tall-tales-truth"><div><Eyebrow>Authenticated specimen · {String.fromCharCode(65 + view.reveal.options.findIndex(option => option.truth))}</Eyebrow><h2 className="kp-display">{view.reveal.answer}</h2></div><div><p>{view.reveal.explanation}</p><a href={view.reveal.sourceUrl} target="_blank" rel="noreferrer">Read the source ↗</a></div><div className="tall-tales-found">{truth?.voters.length ? <>Found by {truth.voters.length} <People ids={truth.voters} view={view}/></> : 'Nobody found the truth this time.'}</div></Panel><div className="tall-tales-options tall-tales-revealed">{lies.map(option => { const best = option.authors.length > 0 && mostBelieved > 0 && option.voters.length === mostBelieved; return <Panel key={option.id} className="tall-tales-option" data-best={best}><div className="tall-tales-option-heading"><strong><span className="tall-tales-reveal-letter">{String.fromCharCode(65 + view.reveal!.options.findIndex(item => item.id === option.id))} · </span>{option.text}</strong>{best && <span className="tall-tales-stamp">Most believed</span>}</div><div className="tall-tales-attribution">{option.authors.length ? <>By <People ids={option.authors} view={view}/></> : 'Archive decoy'}</div><div className="tall-tales-fooled" data-empty={!option.voters.length}>{option.voters.length ? <>Fooled {option.voters.length} <People ids={option.voters} view={view}/></> : 'No votes'}</div></Panel>; })}</div></>;
}
function Progress({ count, total, label }: { count: number; total: number; label: string }) {
  return <output className="tall-tales-progress"><span aria-hidden="true">{Array.from({ length: total }, (_, index) => <i key={index} data-filled={index < count}/>)}</span>{count} of {total} {label} filed</output>;
}
function DisplayView(props: Props) {
  const view = props.publicView;
  return <main className="tall-tales tall-tales-display" data-phase={view.phase} data-dense={view.players.length > 5} data-many-labels={(view.reveal?.options.length ?? view.options.length) > 11}><Header {...props}/><div className="tall-tales-layout"><section className="tall-tales-main"><Panel className="tall-tales-question"><Eyebrow>{view.phase === 'writing' ? 'Supply a convincing false label' : view.phase === 'voting' ? 'Which label tells the truth?' : view.phase === 'complete' ? 'Archive closed' : 'The record is corrected'}</Eyebrow><Prompt text={view.prompt}/></Panel>{view.phase === 'writing' && <Panel className="tall-tales-hint"><div className="tall-tales-hint-copy"><Eyebrow>Department of plausible nonsense</Eyebrow><h2 className="kp-display">Make fiction look factual.</h2><p>Write a short, believable lie on your phone. Match the blank. Keep the truth to yourself.</p><Progress count={view.submitted} total={view.players.length} label="lies"/><small>500 for finding the truth · 300 per rival fooled · Both double in the finale</small></div><SpecimenArt/></Panel>}{view.phase === 'voting' && <><Progress count={view.voted} total={view.players.length} label="votes"/><div className="tall-tales-options">{view.options.map((option, index) => <Panel className="tall-tales-option tall-tales-ballot" key={option.id}><span className="tall-tales-letter">{String.fromCharCode(65 + index)}</span><strong>{option.text}</strong></Panel>)}</div><p className="tall-tales-footer">Choose the true label on your phone.</p></>}{view.reveal && <Reveal view={view}/>}</section><aside className="tall-tales-sidebar"><Standings view={view}/>{view.phase !== 'writing' && <div className="tall-tales-archive-mark"><SpecimenArt/></div>}</aside></div></main>;
}
function Results({ view }: { view: PublicView }) {
  const top = Math.max(0, ...view.players.map(player => player.score));
  const winners = view.players.filter(player => player.score === top);
  return <section className="tall-tales tall-tales-results"><div className="tall-tales-result-hero"><Eyebrow>Collection complete · 7 specimens</Eyebrow><h2 className="kp-display">The archive<br/>has spoken.</h2><div className="tall-tales-winners"><span className="tall-tales-stamp">{winners.length > 1 ? 'Joint chief archivists' : 'Chief archivist'}</span><People ids={winners.map(player => player.id)} view={view}/><strong className="kp-numeral">{top} <span>credits</span></strong></div><SpecimenArt/></div><div><Standings view={view}/><p className="tall-tales-footer">Equal scores share the same rank.</p></div></section>;
}
function ControllerTurn(props: Props) {
  const { publicView: view, privateView: own } = props;
  const draftKey = `tall-tales:draft:${props.playerId ?? 'spectator'}`;
  const [text, setText] = useState(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null'); return saved?.roundId === props.roundId && saved?.turnId === view.turnId && typeof saved.text === 'string' ? saved.text.slice(0, 80) : ''; }
    catch { return ''; }
  });
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      if (view.phase === 'writing' && !accepted && !own?.lie) sessionStorage.setItem(draftKey, JSON.stringify({ roundId: props.roundId, turnId: view.turnId, text }));
      else sessionStorage.removeItem(draftKey);
    } catch { /* Storage may be unavailable; submitting still works. */ }
  }, [draftKey, props.roundId, view.turnId, view.phase, text, accepted, own?.lie]);
  const [, refresh] = useState(0);
  useEffect(() => { const timer = setInterval(() => refresh(value => value + 1), 250); return () => clearInterval(timer); }, []);
  const closed = props.serverNowMs() >= view.deadline;
  async function send(action: Action) {
    setPending(true); setError('');
    try { const result = await props.sendAction(action); if (result.accepted) setAccepted(true); else setError(result.reason ?? 'That was not accepted. Try again.'); }
    catch { setError('Could not confirm submission. Check your connection and retry.'); }
    finally { setPending(false); }
  }
  const filed = accepted || (view.phase === 'writing' ? own?.lie !== null && own?.lie !== undefined : own?.votedOptionId !== null && own?.votedOptionId !== undefined);
  return <main className="tall-tales tall-tales-controller" data-phase={view.phase}><Header {...props}/><Panel className="tall-tales-question"><Eyebrow>{view.phase === 'writing' ? 'Your task: invent a lie' : view.phase === 'voting' ? 'Your task: find the truth' : 'Specimen revealed'}</Eyebrow><Prompt text={view.prompt}/></Panel>{!own ? <StatusNotice>Watching this game. Join the next game to submit answers.</StatusNotice> : <>{view.phase === 'writing' && (filed ? <StatusNotice tone="success">Lie filed{own.lie ? `: “${own.lie}”` : ''}. Watch the archive while the others write.</StatusNotice> : <Panel><form className="tall-tales-form" onSubmit={event => { event.preventDefault(); if (!pending && !closed && text.trim()) void send({ type: 'lie', turnId: view.turnId, text }); }}><label htmlFor="tall-tales-lie">A believable false answer <span className="tall-tales-count" aria-hidden="true">{text.length}/80</span></label><TextInput id="tall-tales-lie" value={text} onChange={event => setText(event.target.value)} maxLength={80} autoComplete="off" autoCapitalize="sentences" enterKeyHint="send" disabled={pending || closed} aria-describedby="tall-tales-help"/><small id="tall-tales-help">1–80 characters. Found the truth? Try a lie instead.</small><ArcadeButton tone="grape" size="lg" type="submit" disabled={pending || closed || !text.trim()}>{pending ? 'Filing…' : 'File my lie'}</ArcadeButton></form></Panel>)}{view.phase === 'voting' && (filed ? <StatusNotice tone="success">Vote filed. The truth will be revealed when the timer ends.</StatusNotice> : <section className="tall-tales-votes" aria-label="Choose the true answer"><p>Choose once. Your own lie is marked and cannot be selected.</p>{view.options.map((option, index) => { const mine = own.ownOptionIds.includes(option.id); return <ArcadeButton tone={mine ? 'ghost' : 'grape'} key={option.id} disabled={pending || closed || mine} onClick={() => void send({ type: 'vote', turnId: view.turnId, optionId: option.id })}><span className="tall-tales-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}{mine ? ' · Your lie' : ''}</span></ArcadeButton>; })}{pending && <StatusNotice>Filing your vote…</StatusNotice>}</section>)}</>}{error && <StatusNotice tone="error">{error}</StatusNotice>}{closed && !view.reveal && <StatusNotice>Time is up. Waiting for the archive to update.</StatusNotice>}{view.reveal && <><Reveal view={view}/><Standings view={view}/></>}<p className="tall-tales-footer">{view.phase === 'writing' ? `${view.submitted}/${view.players.length} lies filed` : view.phase === 'voting' ? `${view.voted}/${view.players.length} votes filed` : view.phase === 'complete' ? 'Game complete. The host can return everyone to the picker.' : 'Next specimen opens automatically.'}</p></main>;
}
function ControllerView(props: Props) { return <ControllerTurn key={`${props.roundId}:${props.publicView.turnId}:${props.publicView.phase}`} {...props}/>; }
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = {
  DisplayView, ControllerView,
  SettingsView: ({ settings, onChange, disabled }) => <Panel><ToggleRow label="Relaxed timers (about 11½ minutes)" checked={settings.pace === 'relaxed'} onChange={checked => onChange({ pace: checked ? 'relaxed' : 'standard' })} disabled={disabled}/><p>Standard: about 10 minutes. Seven specimens, with double points on the last.</p></Panel>,
  InstructionsView: () => <Panel className="tall-tales"><Eyebrow>How to play</Eyebrow><h2 className="kp-display">File a lie. Find the truth.</h2><ol><li>Invent a believable false answer to the factual blank on screen.</li><li>Pick the true answer from the anonymous labels. You cannot pick your own lie.</li><li>Earn 500 for the truth and 300 for each rival your lie fools. Matching lies share an entry; every author earns the full 300 per rival.</li></ol><p>Six normal specimens, then a double-value finale. Archive decoys keep voting playable even if nobody writes. Missed submissions earn no points; you can still vote. Rejoin to recover your filed lie or vote.</p></Panel>,
  ResultsView: ({ publicView }) => <Results view={publicView}/>,
  prepare() {}, dispose() {},
};
export default client;
