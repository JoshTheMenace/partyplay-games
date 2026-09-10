import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, Countdown, Eyebrow, Panel, StatusNotice, TextInput } from '../../../party-ui/src/index';
import type { GameClientModule, GameViewProps, ResultsViewProps, SettingsViewProps } from '../../../party-ui/src/index';
import type { Action, Phase, PrivateView, PublicView, Settings } from './types';
import { clearDraft, readDraft, saveDraft, type Draft, type DraftScope } from './draft';
import { answerTones, symbolTones, LabArt, LabSymbol } from './art';
import './styles.css';

type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const labels: Record<Phase, string> = { instructions: 'Welcome to the lab', quiz: 'Charge the machine', 'quiz-reveal': 'The answer is…', 'rescue-preview': 'Rescue briefing', rescue: 'Repair crew, go!', 'rescue-reveal': 'Repair report', 'finale-intro': 'The escape hatch is open', finale: 'Race for the exit', 'finale-reveal': 'Keep those feet moving', results: 'Fresh air. At last!' };
const playerStyle = (color: string) => ({ '--quiz-panic-player': color } as CSSProperties);
function Instructions() {
  return <div className="quiz-panic-instructions"><p>The Bubble Bureau’s quiz machine is stuck on turbo. Build charge, repair the wobbles, then race out together. Highest escape distance wins!</p><ol>
    <li><strong>8 quizzes:</strong> lock one of four answers in 30 seconds. Correct earns 3 charge. No speed bonus.</li>
    <li><strong>Rescue after every quiz:</strong> everyone plays a memory, closest-number, or logic challenge. Success earns 2 charge if you missed the quiz; otherwise 1. Wrong answers cost nothing.</li>
    <li><strong>6-question escape:</strong> every 6 charge gives 1 starting step, capped at 4. Correct answers move 2 steps, or 3 if you started that question behind the leader. You have 18 seconds each.</li>
  </ol><p>Once everyone locks an answer, the reveal opens after a six-second minimum. Most steps after question 6 wins. Equal distances share the win. Nobody is eliminated. A missing answer earns zero; reconnect to keep playing.</p></div>;
}
function Header({ publicView: v, serverNowMs }: Props) {
  return <header className="quiz-panic-header"><div><Eyebrow>{v.finaleStep ? `Escape ${v.finaleStep} of 6` : `Experiment ${v.round} of ${v.rounds}`}</Eyebrow><h1 className="kp-display">{labels[v.phase]}</h1><div className="quiz-panic-progress" aria-hidden="true">{Array.from({ length: v.finaleStep ? 6 : v.rounds }, (_, i) => <i key={i} data-state={i + 1 === (v.finaleStep || v.round) ? 'current' : i + 1 < (v.finaleStep || v.round) ? 'done' : 'next'}/>)}</div></div>{v.phase !== 'results' && <div className="quiz-panic-clock"><Countdown deadline={v.deadline} serverNowMs={serverNowMs}/><span>seconds</span></div>}</header>;
}
function Challenge({ view: v }: { view: PublicView }) {
  return <><h2>{v.question?.prompt || v.challenge?.prompt}</h2>{v.challenge?.sequence && <ol className="quiz-panic-sequence" aria-label="Sequence to remember">{v.challenge.sequence.map((n, i) => <li key={i} data-tone={symbolTones[n]}><LabSymbol value={n}/><span>{i + 1}. {v.challenge!.options[n]}</span></li>)}</ol>}</>;
}
function Reveal({ view: v }: { view: PublicView }) {
  if (!v.reveal) return null;
  return <StatusNotice tone="success"><span className="quiz-panic-reveal"><strong className="kp-display">{v.reveal.answer}</strong><span>{v.reveal.explanation}</span>{v.reveal.source && <a href={v.reveal.source} target="_blank" rel="noreferrer">Read the fact source</a>}</span></StatusNotice>;
}
function FinaleInstructions() {
  return <><h2 className="kp-display">Six questions. One open hatch.</h2><p>Your charge becomes 1 starting step per 6 charge, up to 4. Each correct answer adds 2 steps. Start a question behind the leader and you get 3 instead.</p><p>You have 18 seconds per question. Most steps at the end wins; ties share the win. Everyone can catch up!</p></>;
}
function Scores({ view: v }: { view: PublicView }) {
  const escape = v.phase.startsWith('finale') || v.phase === 'results';
  const score = (p: PublicView['players'][number]) => escape ? p.distance : p.charge;
  return <ol className="quiz-panic-scores" data-density={v.players.length <= 3 ? 'full' : v.players.length <= 6 ? 'compact' : 'dense'} data-escape={escape} aria-label={escape ? 'Escape positions' : 'Charge standings'}>{[...v.players].sort((a, b) => score(b) - score(a)).map(p => {
    const rank = 1 + v.players.filter(other => score(other) > score(p)).length;
    return <li key={p.id} style={playerStyle(p.color)} data-leading={rank === 1}>
      <div className="quiz-panic-score-top"><span className="quiz-panic-rank kp-numeral">{rank}</span><strong>{p.name}</strong><span className="quiz-panic-score-value kp-numeral">{score(p)}<small>{escape ? ` step${p.distance === 1 ? '' : 's'}` : ' charge'}</small></span></div>
      <div className="quiz-panic-meter"><meter min={0} max={escape ? 22 : 32} value={score(p)} aria-label={`${p.name}: ${score(p)} ${escape ? `escape step${score(p) === 1 ? '' : 's'}` : 'charge'}`}/>{escape && <span aria-hidden="true">↗</span>}</div>
      <small className="quiz-panic-score-status" data-gained={v.phase.endsWith('reveal') && p.gained > 0}>{!p.connected ? 'Disconnected · seat saved' : v.phase.endsWith('reveal') ? `+${p.gained} ${escape ? 'steps' : 'charge'}` : p.submitted && ['quiz', 'rescue', 'finale'].includes(v.phase) ? 'Answer locked ✓' : escape ? (p.boost ? 'Catch-up boost · correct = 3' : 'Correct = 2 steps') : p.needsRescue ? 'Rescue success = 2 charge' : 'Ready in the lab'}</small>
    </li>;
  })}</ol>;
}
function DisplayView(props: Props) {
  const v = props.publicView;
  return <main className="quiz-panic quiz-panic-display" data-phase={v.phase}><Header {...props}/><div className="quiz-panic-stage"><LabArt progress={v.finaleStep ? v.finaleStep / 6 : v.round / v.rounds}/><Panel className="quiz-panic-board">{v.phase === 'instructions' ? <Instructions/> : v.phase === 'finale-intro' ? <FinaleInstructions/> : v.phase === 'results' ? <><h2 className="kp-display">Experiment complete!</h2><p>Check the final escape standings. Your room host can start another experiment.</p></> : <><Eyebrow>{v.question?.category || v.challenge?.family}</Eyebrow><Challenge view={v}/>{v.question && <ol className="quiz-panic-options">{v.question.options.map((option, i) => <li key={i} data-tone={answerTones[i]} data-correct={v.reveal ? v.reveal.answer === option : undefined}><b>{String.fromCharCode(65 + i)}</b><span>{option}</span>{v.reveal?.answer === option && <span className="quiz-panic-correct-mark" aria-label="Correct answer">✓</span>}</li>)}</ol>}<Reveal view={v}/>{v.phase === 'rescue-preview' && <p>Study now. Controls open after the briefing.</p>}{v.phase === 'rescue' && <p>Everyone plays. Rescue crew earns 2 charge for success; the support crew earns 1.</p>}</>}</Panel></div><Scores view={v}/></main>;
}
function AnswerControls(props: Props) {
  const { publicView: v, privateView: own } = props;
  const family = v.challenge?.family;
  const scope: DraftScope | null = props.playerId && v.phase === 'rescue' && (family === 'memory' || family === 'estimate') ? { roomId: props.roomId, roundId: props.roundId, playerId: props.playerId, turnId: v.turnId, family } : null;
  const [draft, setDraft] = useState<Draft>(() => {
    try { return !own?.submitted && scope ? readDraft(sessionStorage, scope, v.round > 4 ? 5 : 4) ?? { sequence: [], estimate: '' } : { sequence: [], estimate: '' }; } catch { return { sequence: [], estimate: '' }; }
  });
  const { sequence, estimate } = draft;
  function updateDraft(next: Draft) {
    setDraft(next);
    try { if (scope) saveDraft(sessionStorage, scope, next); } catch { /* Keep the in-memory draft. */ }
  }
  function forgetDraft() {
    try { if (scope) clearDraft(sessionStorage, scope); } catch { /* Optional browser cache. */ }
  }
  useEffect(() => { if (own?.submitted) forgetDraft(); }, [own?.submitted]);
  const [status, setStatus] = useState<'idle' | 'pending' | 'accepted'>('idle'), [error, setError] = useState('');
  const busy = useRef(false);
  const locked = own?.submitted || status !== 'idle';
  async function submit(action: Action) {
    if (busy.current || locked || props.serverNowMs() >= v.deadline) return;
    busy.current = true; setStatus('pending'); setError('');
    try {
      const result = await props.sendAction(action);
      if (result.accepted) { forgetDraft(); setStatus('accepted'); }
      else { setStatus('idle'); setError(result.reason || 'Answer was not accepted. Try again before the timer ends.'); }
    } catch { setStatus('idle'); setError('Could not confirm your answer. Check the connection and retry.'); }
    finally { busy.current = false; }
  }
  if (!own || !props.playerId) return <StatusNotice>Waiting for your player seat to reconnect.</StatusNotice>;
  if (own.submitted || status === 'accepted') {
    const answer = own.answer;
    const description = Array.isArray(answer) ? answer.map(i => v.challenge?.options[i]).join(' → ') : answer === null ? null : v.question ? v.question.options[answer] : v.challenge?.family === 'logic' ? v.challenge.options[answer] : String(answer);
    return <StatusNotice tone="success"><strong>Answer locked{description ? `: ${description}` : ''}.</strong> Watch the lab screen for the reveal.</StatusNotice>;
  }
  return <div className="quiz-panic-controls">{(status === 'pending' || error) && <div aria-live="polite">{status === 'pending' && <StatusNotice>Sending your answer…</StatusNotice>}{error && <StatusNotice tone="error">{error}</StatusNotice>}</div>}
    {v.question && <div className="quiz-panic-answers">{v.question.options.map((option, choice) => <ArcadeButton key={choice} tone={answerTones[choice]} disabled={locked} onClick={() => void submit({ kind: 'answer', turnId: v.turnId, choice })}>{String.fromCharCode(65 + choice)}. {option}</ArcadeButton>)}</div>}
    {v.challenge?.family === 'logic' && <div className="quiz-panic-answers">{v.challenge.options.map((option, value) => <ArcadeButton key={value} tone={answerTones[value]} disabled={locked} onClick={() => void submit({ kind: 'rescue', turnId: v.turnId, value })}>Valve {option}</ArcadeButton>)}</div>}
    {v.challenge?.family === 'memory' && <><output className="quiz-panic-recall" aria-live="polite" aria-label={sequence.length ? `Your sequence: ${sequence.map(i => v.challenge!.options[i]).join(', ')}` : 'Tap symbols in order'}>{Array.from({ length: v.round > 4 ? 5 : 4 }, (_, i) => <span className="quiz-panic-recall-slot" key={i} data-tone={sequence[i] === undefined ? undefined : symbolTones[sequence[i]]} aria-hidden="true">{sequence[i] === undefined ? i + 1 : <LabSymbol value={sequence[i]}/>}</span>)}</output><div className="quiz-panic-symbols">{v.challenge.options.map((option, value) => <ArcadeButton key={value} tone={symbolTones[value]} disabled={locked || sequence.length >= (v.round > 4 ? 5 : 4)} onClick={() => updateDraft({ ...draft, sequence: [...sequence, value] })}><LabSymbol value={value}/> {option}</ArcadeButton>)}</div><div className="quiz-panic-memory-actions"><ArcadeButton tone="ghost" aria-label="Undo last symbol" disabled={locked || !sequence.length} onClick={() => updateDraft({ ...draft, sequence: sequence.slice(0, -1) })}>Undo</ArcadeButton><ArcadeButton disabled={locked || sequence.length !== (v.round > 4 ? 5 : 4)} onClick={() => void submit({ kind: 'rescue', turnId: v.turnId, value: sequence })}> {sequence.length === (v.round > 4 ? 5 : 4) ? 'Lock sequence' : `Lock ${sequence.length}/${v.round > 4 ? 5 : 4}`}</ArcadeButton></div></>}
    {v.challenge?.family === 'estimate' && <form onSubmit={e => { e.preventDefault(); if (/^\d{1,3}$/.test(estimate)) void submit({ kind: 'rescue', turnId: v.turnId, value: Number(estimate) }); }}><label htmlFor="quiz-panic-estimate">Total jars (0–999)</label><TextInput id="quiz-panic-estimate" inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} autoComplete="off" value={estimate} disabled={locked} onChange={e => updateDraft({ ...draft, estimate: e.target.value.replace(/\D/g, '').slice(0, 3) })}/><ArcadeButton type="submit" disabled={locked || !/^\d{1,3}$/.test(estimate)}>Lock estimate</ArcadeButton></form>}
  </div>;
}
function ControllerView(props: Props) {
  const v = props.publicView;
  const active = ['quiz', 'rescue', 'finale'].includes(v.phase);
  return <main className="quiz-panic quiz-panic-phone" data-phase={v.phase}><Header {...props}/><Panel className={`quiz-panic-board ${active ? 'quiz-panic-playing' : ''}`}>
    {v.phase === 'instructions' ? <Instructions/> : v.phase === 'finale-intro' ? <FinaleInstructions/> : v.phase === 'results' ? <p>The experiment is complete. Check the results with your crew!</p> : <>
      <div className="quiz-panic-prompt"><Eyebrow>{v.question?.category || v.challenge?.family}</Eyebrow><Challenge view={v}/>
        {active && <p>{v.phase === 'finale' ? (props.privateView?.boost ? 'Catch-up boost: correct = 3 steps.' : 'Correct = 2 steps.') : v.phase === 'rescue' ? (props.privateView?.needsRescue ? 'Rescue crew: success = 2 charge.' : 'Support crew: success = 1 charge.') : 'Correct = 3 charge. Tap to lock.'}</p>}
        {v.phase === 'rescue' && ['memory', 'estimate'].includes(v.challenge?.family ?? '') && <small>Drafts stay on this phone.</small>}
      </div>
      {active ? <AnswerControls key={`${props.roomId}:${props.roundId}:${props.playerId}:${v.turnId}`} {...props}/> : <><Reveal view={v}/><StatusNotice>{v.phase === 'rescue-preview' ? 'Study the challenge. Controls open when the timer ends.' : `Your change: +${v.players.find(p => p.id === props.playerId)?.gained ?? 0}. Next phase opens automatically.`}</StatusNotice></>}
    </>}
  </Panel></main>;
}
function SettingsView(_props: SettingsViewProps<Settings>) {
  return <Panel><p>2–10 players · 8 experiments + 6 escape questions · up to 13 minutes.</p><p>All three rescue families are included. Quick groups finish sooner once everyone answers. Shared screen and portrait phones required.</p></Panel>;
}
function ResultsView({ outcome, publicView: v }: ResultsViewProps<PublicView>) {
  const winners = outcome.rows.filter(row => row.rank === 1);
  return <div className="quiz-panic quiz-panic-finish">
    <header className="quiz-panic-finish-heading"><div><Eyebrow>Bubble Bureau · Experiment complete</Eyebrow><h2 className="kp-display">{winners.length > 1 ? 'A shared escape!' : 'Out of the lab. On top.'}</h2></div><LabArt/></header>
    <div className="quiz-panic-winners" data-many={winners.length > 3}>{winners.map(row => {
      const p = v.players.find(p => p.id === row.playerId);
      return <Panel key={row.playerId} className="quiz-panic-winner" style={playerStyle(p?.color || 'var(--kp-sky)')}><div><Eyebrow>Escape champion{winners.length > 1 ? ' · tied' : ''}</Eyebrow><h3 className="kp-title">{p?.name || 'Player'}</h3><p>{p?.charge ?? 0} charge collected</p></div><div className="quiz-panic-winner-distance"><strong className="kp-numeral">{row.score}</strong><span>escape step{row.score === 1 ? '' : 's'}</span></div></Panel>;
    })}</div>
    <ol className="quiz-panic-results">{outcome.rows.filter(row => row.rank !== 1).map(row => { const p = v.players.find(p => p.id === row.playerId); return <li key={row.playerId} style={playerStyle(p?.color || 'var(--kp-sky)')}><span className="kp-numeral">#{row.rank}</span><strong>{p?.name || 'Player'}</strong><span>{row.label}</span></li>; })}</ol>
  </div>;
}
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = { DisplayView, ControllerView, SettingsView, InstructionsView: Instructions, ResultsView, prepare() {}, dispose() {} };
export default client;
