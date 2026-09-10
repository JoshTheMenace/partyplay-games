import { useId, useRef, useState } from 'react';
import { ArcadeButton, Countdown, Eyebrow, Panel, StatusNotice } from '../../../party-ui/src/index';
import type { GameClientModule, GameViewProps, ResultsViewProps, SettingsViewProps } from '../../../party-ui/src/index';
import type { Action, PrivateView, PublicView, Settings } from './types';
import './styles.css';

type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const nameOf = (view: PublicView, id: string) => view.players.find(player => player.id === id)?.name ?? 'Player';
function PlayerMark({ view, id }: { view: PublicView; id: string }) {
  const player = view.players.find(item => item.id === id);
  return <span className="quip-clash-player-mark" style={{ borderColor: player?.color }} aria-hidden="true">{player?.name.slice(0, 1).toUpperCase()}</span>;
}
function Marquee({ publicView: view, serverNowMs, viewRole }: Props) {
  const titles = { writing: 'Writing room', voting: 'Pick the punchline', reveal: 'The reveal', results: 'Curtain call' };
  return <header className="quip-clash-header"><div><Eyebrow>{viewRole === 'display' ? 'Electric comedy club' : 'Quip Clash'} · {view.round === 3 ? 'Double encore' : `Round ${view.round} of 3`}</Eyebrow><h1 className="kp-display">{titles[view.phase]}</h1></div>
    {view.phase !== 'results' && <div className="quip-clash-clock" data-urgent={view.deadline - serverNowMs() <= 10000 || undefined}><Countdown deadline={view.deadline} serverNowMs={serverNowMs} /><span>seconds</span></div>}</header>;
}
function ComedyStage({ sign = 'OPEN MIC' }: { sign?: string }) {
  const uid = useId();
  return <svg className="quip-clash-scene" viewBox="0 0 440 240" aria-hidden="true">
    <defs><linearGradient id={`${uid}-beam`} x2="0" y2="1"><stop stopColor="var(--kp-sun)" stopOpacity=".28" /><stop offset="1" stopColor="var(--kp-sun)" stopOpacity="0" /></linearGradient><radialGradient id={`${uid}-pool`}><stop stopColor="var(--kp-sun)" stopOpacity=".35" /><stop offset="1" stopColor="var(--kp-sun)" stopOpacity="0" /></radialGradient><pattern id={`${uid}-brick`} width="44" height="24" patternUnits="userSpaceOnUse"><path d="M0 0h44M0 12h44M22 0v12M0 12v12" stroke="var(--kp-grape)" strokeWidth="1" opacity=".15" /></pattern></defs>
    <rect x="30" y="10" width="380" height="204" rx="12" fill={`url(#${uid}-brick)`} />
    <path fill={`url(#${uid}-beam)`} d="M60 0 170 220H10ZM380 0 430 220H270Z" />
    <path className="quip-clash-valance" d="M0 0h440v19q-55 18-110 0Q275 37 220 19 165 37 110 19 55 37 0 19Z" />
    <path className="quip-clash-curtain" d="M0 0H55L35 195H0ZM385 0H440V195H405Z" />
    <path className="quip-clash-curtain-pleat" d="M14 18 8 192M32 24 23 191M426 18 432 192M408 24 417 191" />
    <ellipse cx="220" cy="211" rx="210" ry="28" fill={`url(#${uid}-pool)`} />
    <ellipse className="quip-clash-platform" cx="220" cy="218" rx="180" ry="17" />
    <rect className="quip-clash-neon-glow" x="109" y="32" width="222" height="42" rx="10" />
    <g className="quip-clash-neon"><rect x="109" y="32" width="222" height="42" rx="10" /><text x="220" y="62" textAnchor="middle">{sign}</text></g>
    <g className="quip-clash-microphone"><path d="M214 117V210M189 212H239M192 92V106Q192 129 214 129Q236 129 236 106V92" /><rect x="201" y="76" width="26" height="42" rx="13" /><path d="M206 86H222M206 94H222M206 102H222" /></g>
    <g className="quip-clash-stool"><path d="m298 170-9 41m44-41 9 41m-49-16h44" /><ellipse cx="316" cy="167" rx="30" ry="8" /></g>
    <ellipse cx="99" cy="205" rx="38" ry="6" fill="var(--kp-ink)" opacity=".6" />
    <g className="quip-clash-scene-card" transform="rotate(8 100 148)"><rect x="60" y="112" width="87" height="57" rx="6" /></g><g className="quip-clash-scene-card" transform="rotate(-12 100 148)"><rect x="48" y="127" width="87" height="57" rx="6" /><path d="M63 143H118M63 155H113M63 167H99" /></g>
    <path className="quip-clash-spark" d="m359 82 4 10 11 4-11 4-4 10-4-10-11-4 11-4ZM79 69l3 7 8 3-8 3-3 7-3-7-8-3 8-3Z" />
  </svg>;
}
function WritingStage({ view }: { view: PublicView }) {
  return <Panel className="quip-clash-writing-stage"><div className="quip-clash-writing-copy"><Eyebrow>{view.round === 3 ? 'Double encore · Triple points' : 'Two cue cards. Two chances to land it.'}</Eyebrow><h2 className="kp-display">The mic is yours.</h2><p>{view.round === 3 ? 'Same prompt. Two different punchlines. Find both cue cards on your phone.' : 'Your prompts are on your phone. Write two punchlines and lock each answer.'}</p>
    <div className="quip-clash-writing-progress"><div><strong className="kp-numeral">{view.submitted}<span> / {view.expected}</span></strong><span>answers locked</span></div><div className="quip-clash-lock-ticks" role="progressbar" aria-label="Answers locked" aria-valuemin={0} aria-valuemax={view.expected} aria-valuenow={view.submitted}>{Array.from({ length: view.expected }, (_, index) => <span key={index} data-filled={index < view.submitted || undefined} />)}</div></div></div><ComedyStage /></Panel>;
}
function Standings({ view }: { view: PublicView }) {
  return <ol className="quip-clash-standings" aria-label="Scores">{[...view.players].sort((a, b) => b.score - a.score).map(player => <li key={player.id}><PlayerMark view={view} id={player.id} /><span>{player.name}{!player.connected && ' · reconnecting'}</span><strong className="kp-numeral">{player.score}</strong></li>)}</ol>;
}
function Matchup({ view }: { view: PublicView }) {
  const match = view.matchup;
  if (!match) return null;
  const reveal = match.reveal;
  const status = !reveal ? 'Vote on your phone. Authors sit this one out.' : reveal.result === 'missing' ? 'Skipped: an answer was missing. No points awarded.' : reveal.result === 'no-votes' ? 'No votes cast. No points awarded.' : reveal.result === 'tie' ? 'A tie! Vote points stand; no winner bonus.' : 'The votes are in!';
  return <section className="quip-clash-matchup" aria-label="Current matchup"><Eyebrow>Match {view.matchNumber} of {view.matchCount} · {view.multiplier}× points</Eyebrow><h2 className="quip-clash-prompt">{match.prompt}</h2>
    <div className="quip-clash-cards" data-reveal={!!reveal || undefined}>{match.answers.map((answer, side) => <Panel className={`quip-clash-card ${reveal?.winner === side ? 'quip-clash-winner' : ''}`} key={side}><article className="quip-clash-paper" data-long={(answer?.length ?? 0) > 90 || undefined}>
      <header className="quip-clash-card-tab"><span className="quip-clash-card-letter kp-numeral">{side === 0 ? 'A' : 'B'}</span><span className="quip-clash-card-author">{reveal ? nameOf(view, reveal.authors[side]!) : 'Anonymous'}</span>{reveal?.winner === side && <strong className="quip-clash-win-stamp">Winner</strong>}</header><p className="quip-clash-answer">{answer ?? 'No answer submitted'}</p>
      {reveal && <footer className="quip-clash-credit"><p className="quip-clash-points"><strong className="kp-numeral">+{reveal.points[side]}</strong> points · {reveal.votes[side]!.length} {reveal.votes[side]!.length === 1 ? 'vote' : 'votes'}</p><ul className="quip-clash-voters" aria-label={`Voters for answer ${side === 0 ? 'A' : 'B'}`}>{reveal.votes[side]!.map(id => <li key={id}><PlayerMark view={view} id={id} />{nameOf(view, id)}</li>)}{!reveal.votes[side]!.length && <li>No voters</li>}</ul></footer>}
    </article>
    </Panel>)}</div><StatusNotice>{status}</StatusNotice></section>;
}
function DisplayView(props: Props) {
  const view = props.publicView;
  return <main className="quip-clash-stage quip-clash-show" data-density={view.players.length > 6 ? 'dense' : 'full'}><Marquee {...props} />
    {view.phase === 'writing' ? <WritingStage view={view} /> : view.phase === 'results' ? <Panel><h2 className="kp-display">That’s our show!</h2><p>Final scores. The host can start a rematch or pick another game.</p></Panel> : <Matchup view={view} />}
    <Standings view={view} /></main>;
}
function AnswerCard({ question, props, index }: { question: PrivateView['questions'][number]; props: Props; index: number }) {
  const [text, setText] = useState(question.answer ?? question.draft);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const busy = useRef(false);
  const submitted = locked || question.answer !== null;
  async function send(type: 'draft' | 'answer') {
    if (busy.current || submitted) return;
    if (type === 'answer' && !text.trim()) { setError('Write a punchline first, then lock it.'); return; }
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const result = await props.sendAction({ type, turnId: props.publicView.turnId, questionId: question.id, text });
      if (!result.accepted) setError(result.reason ?? 'Could not save. Try again before time runs out.');
      else { setNotice(type === 'draft' ? 'Draft saved. You still need to lock your answer.' : 'Answer locked.'); if (type === 'answer') setLocked(true); }
    } catch { setError('Connection interrupted. Your text is here; try again when connected.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <Panel className="quip-clash-entry" data-locked={submitted || undefined} id={`card-${question.id}`}><form onSubmit={event => { event.preventDefault(); void send('answer'); }}>
    <Eyebrow>Cue card {index + 1} of {props.privateView!.questions.length}</Eyebrow>
    <label htmlFor={question.id} className="quip-clash-entry-label">{question.prompt}</label>
    {submitted ? <><p className="quip-clash-answer">{question.answer ?? text}</p><StatusNotice tone="success">Answer locked. Check that both cue cards are finished.</StatusNotice></> : <>
      <textarea id={question.id} value={text} maxLength={160} rows={3} disabled={pending} onChange={event => { setText(event.target.value); setNotice(''); }} aria-describedby={`${question.id}-help`} placeholder="Your punchline…" />
      <p className="quip-clash-entry-help" data-near={text.length >= 130 || undefined} id={`${question.id}-help`}>{text.length}/160 · Lock to submit.</p>
      <div className="quip-clash-entry-actions"><ArcadeButton type="button" tone="ghost" size="sm" disabled={pending} onClick={() => void send('draft')}>Save draft</ArcadeButton><ArcadeButton type="submit" disabled={pending}>{pending ? 'Sending…' : 'Lock answer'}</ArcadeButton></div>
    </>}
    {notice && !submitted && <StatusNotice tone="success">{notice}</StatusNotice>}{error && <StatusNotice tone="error">{error}</StatusNotice>}
  </form></Panel>;
}
function Ballot({ props }: { props: Props }) {
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const view = props.publicView;
  const own = props.privateView;
  async function vote(choice: 0 | 1) {
    if (busy.current || accepted) return;
    busy.current = true; setPending(true); setError('');
    try {
      const result = await props.sendAction({ type: 'vote', turnId: view.turnId, choice });
      if (result.accepted) setAccepted(true); else setError(result.reason ?? 'Vote rejected. Try again.');
    } catch { setError('Connection interrupted. Try your vote again when connected.'); }
    finally { busy.current = false; setPending(false); }
  }
  if (own?.isAuthor) return <StatusNotice>Your joke is on stage! Authors cannot vote in their own matchup.</StatusNotice>;
  if (accepted || own?.voted !== null && own?.voted !== undefined) return <StatusNotice tone="success">Vote locked. Watch the screen for the reveal.</StatusNotice>;
  return <Panel><h2>{view.matchup?.prompt}</h2><p>Tap the funniest answer. Your vote is final.</p><div className="quip-clash-vote-actions">{view.matchup?.answers.map((answer, side) => <ArcadeButton key={side} tone="sun" disabled={pending || !own?.canVote || answer === null} onClick={() => void vote(side as 0 | 1)}><span className="quip-clash-vote-label">{side === 0 ? 'A' : 'B'}</span>{answer ?? 'No answer submitted'}</ArcadeButton>)}</div>{pending && <StatusNotice>Sending vote…</StatusNotice>}{error && <StatusNotice tone="error">{error}</StatusNotice>}</Panel>;
}
function RevealRecap({ props }: { props: Props }) {
  const view = props.publicView;
  const match = view.matchup;
  const reveal = match?.reveal;
  if (!reveal) return null;
  const side = reveal.authors.findIndex(id => id === props.playerId);
  const vote = props.privateView?.voted;
  const headline = reveal.result === 'missing' ? 'This one skipped.' : reveal.result === 'no-votes' ? 'A quiet room.' : reveal.result === 'tie' ? 'An even split!' : side >= 0 ? reveal.winner === side ? 'You landed it!' : 'Every vote counts.' : vote === reveal.winner ? 'You backed the winner!' : vote === null || vote === undefined ? 'The room has spoken.' : 'Your pick came second.';
  return <Panel className="quip-clash-recap"><Eyebrow>Match {view.matchNumber} of {view.matchCount}</Eyebrow><h2 className="kp-display">{headline}</h2>
    {side >= 0 && <><p className="quip-clash-recap-points"><strong className="kp-numeral">+{reveal.points[side]}</strong> points for your answer</p><blockquote>{match.answers[side] ?? 'No answer submitted'}</blockquote></>}
    <p>{reveal.result === 'missing' ? 'A missing answer means zero points for this matchup.' : reveal.result === 'tie' ? 'Vote points stand. No winner bonus.' : reveal.result === 'no-votes' ? 'No votes cast. No points awarded.' : 'See the answers, authors and votes on the shared screen.'}</p><span className="quip-clash-recap-next">{view.matchNumber === view.matchCount ? view.round === 3 ? 'Final scores coming up' : 'Next round coming up' : 'Next matchup coming up'}</span></Panel>;
}
function ControllerView(props: Props) {
  const view = props.publicView;
  return <main className="quip-clash-controller"><Marquee {...props} />
    {!props.privateView ? <StatusNotice>Waiting for your private cue cards. Reconnect to your player seat to continue.</StatusNotice> : view.phase === 'writing' ? <><nav className="quip-clash-cue-nav" aria-label="Your cue cards">{props.privateView.questions.map((question, index) => <a key={question.id} href={`#card-${question.id}`} data-state={question.answer !== null ? 'locked' : question.draft ? 'draft' : 'empty'}>Card {index + 1}<span>{question.answer !== null ? 'Locked ✓' : question.draft ? 'Draft saved' : 'To write'}</span></a>)}</nav>{view.round === 3 && <p className="quip-clash-finale-note">Same prompt, two different punchlines. <strong>Triple points!</strong></p>}{props.privateView.questions.map((question, index) => <AnswerCard key={question.id} question={question} props={props} index={index} />)}</> : view.phase === 'voting' ? <Ballot key={view.turnId} props={props} /> : view.phase === 'reveal' ? <RevealRecap key={view.turnId} props={props} /> : <><h2 className="kp-display">That’s our show!</h2><Standings view={view} /><p>The host can start a rematch or choose the next game.</p></>}
  </main>;
}
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <Panel className="quip-clash-settings"><p>Default pace: about 8–12 minutes. Fast writers finish sooner.</p>{([
    ['writingSeconds', 'Writing time', [[30, '30 seconds'], [60, '60 seconds'], [100, '100 seconds'], [150, '150 seconds']]],
    ['votingSeconds', 'Voting time', [[0, 'Automatic for group size'], [8, '8 seconds'], [15, '15 seconds'], [25, '25 seconds'], [30, '30 seconds']]],
    ['revealSeconds', 'Reveal time', [[4, '4 seconds'], [6, '6 seconds'], [10, '10 seconds'], [12, '12 seconds']]],
  ] as const).map(([key, label, options]) => <label key={key}>{label}<select value={settings[key]} disabled={disabled} onChange={event => onChange({ ...settings, [key]: Number(event.target.value) })}>{options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>)}</Panel>;
}
function InstructionsView() {
  return <Panel><h2 className="kp-display">A little absurdity goes a long way.</h2><ol><li>In rounds 1 and 2, write two original punchlines on your phone. Lock each answer before time runs out.</li><li>Vote for the funniest anonymous answer. Authors sit out their own matchups.</li><li>Each vote earns 100 points, plus 200 for winning outright. Round 2 doubles points; the finale triples them.</li><li>Double encore finale: everyone gets the same prompt. Write two different punchlines and face two opponents.</li></ol><p>Ties keep vote points but earn no win bonus. A matchup with a missing answer skips for zero points. Unsaved or unlocked drafts never become entries. Equal final scores share the rank.</p><p>3–10 players · Shared screen and portrait phones · The watching host needs no seat.</p></Panel>;
}
function ResultsView({ publicView: view, outcome, playerId }: ResultsViewProps<PublicView>) {
  const winners = outcome.winners;
  const score = outcome.rows.find(row => row.playerId === winners[0])?.score ?? 0;
  const rows = [...outcome.rows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return <section className="quip-clash-stage quip-clash-results" aria-label="Quip Clash final results">
    <div className="quip-clash-result-hero"><div><Eyebrow>Quip Clash · Final curtain</Eyebrow><h2 className="kp-display">{winners.length > 1 ? 'Share the spotlight!' : 'Tonight’s headliner!'}</h2>
      <div className={`quip-clash-champions ${winners.length > 2 ? 'quip-clash-champions-many' : ''}`}>{winners.map(id => <strong key={id}><PlayerMark view={view} id={id} />{nameOf(view, id)}</strong>)}</div>
      <p className="quip-clash-winning-score"><span className="kp-numeral">{score}</span> points{winners.length > 1 ? ' each · Joint winners' : ' · Winner'}</p></div><ComedyStage sign="ENCORE!" /></div>
    <div className="quip-clash-result-caption"><h3>Final standings</h3><span>{rows.length} players · {view.round} rounds</span></div>
    <div className="quip-clash-result-scroll" tabIndex={0} role="region" aria-label="Ranked final scores"><ol className="quip-clash-result-ranks" data-count={rows.length}> {rows.map(row => {
      const tied = rows.filter(other => other.rank === row.rank).length > 1;
      return <li key={row.playerId} className={winners.includes(row.playerId) ? 'quip-clash-result-winner' : ''}><span className="quip-clash-result-rank kp-numeral" aria-label={`${tied ? 'Tied ' : ''}rank ${row.rank}`}>{tied ? '=' : '#'}{row.rank}</span><span className="quip-clash-result-name">{nameOf(view, row.playerId)}{row.playerId === playerId && <small> You</small>}{winners.includes(row.playerId) && <small className="quip-clash-result-badge">{winners.length > 1 ? 'Joint winner' : 'Headliner'}</small>}</span><strong className="kp-numeral">{row.score}<span> pts</span></strong></li>;
    })}</ol></div>
  </section>;
}
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = {
  DisplayView, ControllerView, SettingsView, InstructionsView,
  ResultsView,
  prepare() {}, dispose() {},
};
export default client;
