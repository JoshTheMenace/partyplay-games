/* Odd One In screens: the spy-agency interrogation room on the TV (case files, evidence board, line-up, verdicts) and the phone controller. */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, Callout, Confetti, PhoneDone, PhoneShell, PhoneWaiting, PlayerStrip, PromptCard, Scoreboard, Timer,
  ordinal, rankOf, useDraft, useNow, useSend, useTimeline,
} from '../../core/ui';
import { Emblem, Face, Fingerprint, Hand, Lamp, Pointer } from './art';
import { CATEGORY, CLOSED, FACES, NUMBERS, POINTS, REVEAL, TASKS_PER_CASE, VERDICT, answerLabel, type Category, type OddPrivate, type OddPublic, type Verdict } from './types';
import './styles.css';

type P = MiniViewProps<OddPublic, OddPrivate>;
type Phone = P & { me: OddPrivate; player: PackPlayer };
const ACCENT = '#22c9c6';
const REVEAL_STEPS = [...REVEAL.counts, REVEAL.flip, REVEAL.prompt], VERDICT_STEPS = [VERDICT.votes, VERDICT.accused, VERDICT.stamp];
const find = (players: readonly PackPlayer[], id: string | null | undefined) => players.find(p => p.id === id);
const nameOf = (players: readonly PackPlayer[]) => (id: string) => find(players, id)?.name ?? 'Somebody';
/** Short "what they did" label for the line-up and the ballot. */
const saidLabel = (view: OddPublic, value: string, players: readonly PackPlayer[]) =>
  view.category === 'number' ? `Number ${value}` : view.category === 'point' ? `→\u00a0${nameOf(players)(value)}` : answerLabel(view.category, value);
/** What someone did, as a sentence tail: "raised a hand", "said 7", "pointed at Mo", "pulled Smug". */
const didLabel = (view: OddPublic, value: string, players: readonly PackPlayer[]) => ({
  hands: value === 'up' ? 'raised a hand' : 'kept their hand down', number: `said ${value}`, point: `pointed at ${nameOf(players)(value)}`, face: `pulled ${answerLabel('face', value)}`,
})[view.category];
/** A chosen-but-unsent pick locks itself in this long before the deadline. */
const AUTO_LOCK_MS = 900;
const span = (view: OddPublic) => ({ deadline: view.deadline, total: view.deadline - view.at });
const WAIT_LINES = [
  'Practise your poker face.', 'Look innocent. No, more innocent.', 'Somebody here is bluffing. Is it you?', 'Fakers copy. Watch who hesitates.',
  'Act natural. Whatever that means.', 'Detectives notice everything. Even your eyebrows.', 'Stay cool. Blink normally.', 'Trust nobody. Except the snacks.',
];

// ---------- shared bits ----------

/** An answer as art: hand signal, number, pointed-at player or face. */
function AnswerArt({ category, value, players, author, size = 'md' }: { category: Category; value: string; players: readonly PackPlayer[]; author?: string; size?: 'sm' | 'md' | 'lg' }) {
  if (category === 'hands') return <span className="ooi-ev" data-size={size} data-kind="hands" data-down={value !== 'up' || undefined}><Hand down={value !== 'up'} /><b>{value === 'up' ? 'Hand up' : 'Hand down'}</b></span>;
  if (category === 'number') return <span className="ooi-ev" data-size={size} data-kind="number"><b className="kp-numeral">{value}</b></span>;
  if (category === 'face') return <span className="ooi-ev" data-size={size} data-kind="face"><Face id={value} /><b>{answerLabel('face', value)}</b></span>;
  const target = find(players, value);
  return <span className="ooi-ev" data-size={size} data-kind="point" style={target ? { '--t': target.color } as CSSProperties : undefined}>
    <span className="ooi-ev-aim"><Pointer />{target && <Avatar avatar={target.avatar} color={target.color} size={size === 'lg' ? 96 : size === 'md' ? 72 : 40} />}</span>
    <b>{!target ? 'Somebody' : target.id === author ? 'Themself!' : target.name}</b>
  </span>;
}

/** One line that sums the evidence up: hands up/down, the average, the crowd favourite. */
function summary(view: OddPublic, players: readonly PackPlayer[]): string {
  const values = (view.answers ?? []).map(a => a.value), count = (v: string) => values.filter(x => x === v).length;
  if (!values.length) return '';
  if (view.category === 'hands') return `${count('up')} ${count('up') === 1 ? 'hand' : 'hands'} up · ${count('down')} down`;
  if (view.category === 'number') {
    const nums = values.map(Number), avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `Average ${Math.round(avg * 10) / 10} · lowest ${Math.min(...nums)} · highest ${Math.max(...nums)}`;
  }
  const top = Math.max(...values.map(count)), leaders = [...new Set(values.filter(v => count(v) === top))];
  if (top === 1) return 'Everybody picked something different!';
  const label = (v: string) => answerLabel(view.category, v, nameOf(players));
  return `${view.category === 'point' ? 'Most pointed at' : 'Most made'}: ${leaders.map(label).join(' & ')} ×${top}`;
}

function Head({ view, children }: { view: OddPublic; children?: ReactNode }) {
  return <header className="ooi-head">
    <span className="ooi-logo kp-title">Odd <em>One</em> In</span>
    <span className="ooi-chip">Case {view.round} of {view.rounds} · <b>{CATEGORY[view.category].name}</b></span>
    <span className="ooi-pips" aria-label={`Task ${view.task} of ${TASKS_PER_CASE}`}>{Array.from({ length: TASKS_PER_CASE }, (_, i) => <i key={i} data-on={i < view.task || undefined} />)}<small>Task {view.task}</small></span>
    <span className="ooi-head-side">{children}</span>
  </header>;
}

/** Venetian-blind light on a dark teal wall: the interrogation room behind every TV screen. */
const Room = () => <div className="ooi-room" aria-hidden="true"><i className="ooi-blinds" /><Fingerprint className="ooi-room-print" /></div>;
const LampRig = ({ className = '' }: { className?: string }) => <div className={`ooi-lamp-rig ${className}`} aria-hidden="true"><i className="ooi-cone" /><Lamp /></div>;

// ---------- TV ----------

function CaseTV({ view }: P) {
  const c = CATEGORY[view.category], last = view.round === view.rounds;
  return <section className="ooi-case">
    <Head view={view} />
    <div className="ooi-folder">
      <span className="ooi-tab">Case file no. {String(view.round).padStart(3, '0')}</span>
      <div className="ooi-photo"><i className="ooi-clip" /><Emblem category={view.category} /></div>
      <div className="ooi-folder-copy">
        <p className="ooi-type">{last ? 'Final case' : `Case ${view.round} of ${view.rounds}`} · Classified</p>
        <h1 className="kp-title">{c.name}</h1>
        <p className="ooi-stem">{c.stem}</p>
        <ol className="ooi-steps"><li>{c.how} on your phone.</li><li>{c.irl} on 3.</li><li>Find the faker!</li></ol>
      </div>
      <span className="ooi-stamp" data-tone="red">One of you is faking</span>
      <Fingerprint className="ooi-folder-print" />
    </div>
    <p className="ooi-foot">A faker has been chosen in secret. Your tasks are on their way…</p>
  </section>;
}

function TaskTV({ view, players, vip, now }: P) {
  const c = CATEGORY[view.category], again = view.task > 1;
  return <section className="ooi-task">
    <Head view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={132} /></Head>
    <div className="ooi-task-main">
      <div className="ooi-interrogate"><LampRig /><div className="ooi-emblem"><Emblem category={view.category} /></div></div>
      <div className="ooi-task-copy">
        {again ? <p className="ooi-banner">The faker slipped away! <b>Same faker, new task.</b></p> : <p className="ooi-kicker">{c.stem}</p>}
        <h1 className="kp-title ooi-title">Check your phone!</h1>
        <p className="ooi-lede">Everyone has a secret task. <b>Except the faker.</b></p>
        <div className="ooi-tally" role="status"><b className="kp-numeral">{view.done.length}<small>/{players.length}</small></b><span>answers locked<small>{c.how}</small></span></div>
        <p className="ooi-irl">Then {c.irl.toLowerCase()} on 3!</p>
      </div>
    </div>
    <PlayerStrip players={players} done={view.done} vip={vip} badges={Object.fromEntries(view.cleared.map(id => [id, 'Cleared']))} />
  </section>;
}

function Board({ view, players, flipped }: { view: OddPublic; players: readonly PackPlayer[]; flipped: boolean }) {
  const answers = view.answers ?? [], n = answers.length, cols = n <= 5 ? n : n <= 8 ? Math.ceil(n / 2) : 5;
  return <ol className="ooi-board" style={{ '--cols': cols } as CSSProperties} data-dense={n > 5 || undefined}>
    {answers.map((a, i) => { const p = find(players, a.player); return p && <li key={a.player} className="ooi-card" data-flipped={flipped || undefined} style={{ '--c': p.color, '--i': i } as CSSProperties}>
      <div className="ooi-card-back"><Fingerprint /><b className="kp-title">?</b><AvatarBadge player={p} size={n > 5 ? 52 : 72} /></div>
      <div className="ooi-card-front">
        <AvatarBadge player={p} size={n > 5 ? 52 : 72} />
        <AnswerArt category={view.category} value={a.value} players={players} author={a.player} size={n > 5 ? 'md' : 'lg'} />
        {(a.auto || view.cleared.includes(p.id)) && <span className="ooi-card-tags">{a.auto && <em className="ooi-tag">No answer: random</em>}
          {view.cleared.includes(p.id) && <em className="ooi-tag" data-tone="cleared">Cleared</em>}</span>}
      </div>
    </li>; })}
  </ol>;
}

/** Reveal (3-2-1, every card flips at once, the real task drops in) and the discussion that follows on the same board. */
function BoardTV({ view, players, now }: P) {
  const discuss = view.phase === 'discuss', c = CATEGORY[view.category];
  const step = useTimeline(view.at, discuss ? [0, 0, 0, 0, 0] : REVEAL_STEPS, now), flipped = step >= 4;
  return <section className="ooi-boardtv" data-phase={view.phase}>
    <Head view={view}>{discuss && <span className="ooi-ready kp-numeral">{view.done.length}/{players.length} <small>ready to vote</small></span>}</Head>
    <div className="ooi-top" data-discuss={discuss || undefined}>
      <div className="ooi-task-slot">{step >= 5 && view.prompt ? <PromptCard eyebrow="The real task was" size={64} className="ooi-prompt">{view.prompt}</PromptCard>
        : flipped && <span className="ooi-act kp-title">{c.act}</span>}</div>
      {discuss && <div className="ooi-who"><span className="kp-title">Who’s faking?</span><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={170} /></div>}
    </div>
    <Board view={view} players={players} flipped={flipped} />
    <p className="ooi-foot" role="status">{!flipped ? <><b>{c.irl}</b> when the count hits zero!</> : <>{summary(view, players)}{discuss && <span> · <b>Talk it out!</b> Who hesitated? Who copied?</span>}</>}</p>
    {!flipped && step > 0 && <div className="ooi-count" aria-live="polite"><small>Do it for real on 3!</small><b className="kp-title" key={step}>{4 - step}</b></div>}
    {flipped && !discuss && step < 5 && <i className="ooi-flash" />}
  </section>;
}

/** Voter tokens stacked above a suspect (the count above them always shows the total). */
const TOWER = 7;
const STAMP: Record<Verdict['outcome'], string> = { caught: 'Faker!', framed: 'Framed!', hung: 'Hung jury' };
function verdictLine(view: OddPublic, players: readonly PackPlayer[], v: Verdict): ReactNode {
  const accused = find(players, v.accused);
  if (v.outcome === 'caught') return <><b>{accused?.name}</b> was the faker! +{POINTS.team} each, +{POINTS.correct} per correct vote.</>;
  const tail = v.escaped ? ' And that was the last task…' : ` Task ${view.task + 1} next, same faker.`;
  if (v.outcome === 'framed') return <><b>{accused?.name}</b> was innocent! The real faker is still out there.{tail}</>;
  return <>{Object.keys(v.votes).length ? 'A tie at the top.' : 'Nobody voted.'} The faker slips away.{tail}</>;
}

/** The line-up: vote on phones, then votes fly in, the accused is spotlit and stamped. */
function LineupTV({ view, players, now }: P) {
  const v = view.verdict, step = useTimeline(view.at, v ? VERDICT_STEPS : [Infinity], now), n = players.length;
  const votes = (id: string) => v ? players.filter(p => v.votes[p.id] === id) : [], said = (id: string) => view.answers?.find(a => a.player === id)?.value;
  const accused = step >= 2 ? v?.accused ?? null : null, size = n > 8 ? 148 : n > 6 ? 170 : n > 4 ? 200 : 240, token = n > 8 ? 54 : n > 4 ? 64 : 80;
  const title = !v ? 'Point the finger!' : step < 3 ? 'The votes are in…' : v.outcome === 'caught' ? 'Gotcha!' : v.outcome === 'framed' ? 'Framed!' : 'Hung jury!';
  return <section className="ooi-lineup-tv" data-phase={view.phase} data-outcome={step >= 3 ? v?.outcome : undefined}>
    <Head view={view}>{!v && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} />}</Head>
    <h1 className="kp-title ooi-title" key={title}>{title}</h1>
    <div className="ooi-lineup-wall" style={{ '--n': n } as CSSProperties} data-dense={n > 8 || undefined}>
      <div className="ooi-chart" aria-hidden="true">{['7', '6', '5', '4'].map(h => <span key={h}>{h} ft</span>)}</div>
      <ol className="ooi-lineup">{players.map(p => {
        const mine = votes(p.id), on = accused === p.id, value = said(p.id);
        return <li key={p.id} style={{ '--c': p.color } as CSSProperties} data-accused={on || undefined} data-dim={(accused && !on) || undefined} data-voted={(!v && view.done.includes(p.id)) || undefined}>
          <div className="ooi-votes">{step >= 1 && v && <>{mine.slice(0, TOWER).map((voter, i) => <i key={voter.id} style={{ '--i': i } as CSSProperties}><Avatar avatar={voter.avatar} color={voter.color} size={token} /></i>)}
            <b className="kp-numeral" data-zero={!mine.length || undefined}>{mine.length}</b></>}</div>
          <div className="ooi-suspect"><Avatar avatar={p.avatar} color={p.color} size={size} mood={on && step >= 3 ? 'sad' : v ? 'thinking' : 'idle'} />
            {on && step >= 3 && v && v.outcome !== 'hung' && <span className="ooi-stamp ooi-stamp-sm" data-tone={v.outcome === 'caught' ? 'red' : 'blue'}>{STAMP[v.outcome]}</span>}</div>
          <b className="hj-name">{p.name}</b>
          {value !== undefined && <span className="ooi-said">{saidLabel(view, value, players)}</span>}
          {!v && view.done.includes(p.id) && <em className="ooi-tag" data-tone="voted">Voted</em>}
          {view.cleared.includes(p.id) && !on && <em className="ooi-tag" data-tone="cleared">Cleared</em>}
        </li>;
      })}</ol>
    </div>
    <p className="ooi-foot" role="status">{!v ? <><b>Vote on your phone.</b> {view.done.length}/{players.length} voted · most votes is accused, ties let the faker walk</> : step < 3 ? 'Counting the votes…' : verdictLine(view, players, v)}</p>
    {step >= 3 && v?.outcome === 'caught' && <Confetti burst={view.turn} count={110} />}
    {step >= 3 && v?.outcome === 'hung' && <div className="ooi-hung"><Callout tone="sky">The faker slips away…</Callout></div>}
  </section>;
}

function ClosedTV({ view, players, now }: P) {
  const c = view.closed!, step = useTimeline(view.at, [CLOSED.faker, CLOSED.scores], now), f = find(players, c.faker);
  const gains = players.map(p => c.gains[p.id] ?? 0), best = Math.max(0, ...gains);
  return <section className="ooi-closed">
    <Head view={view} />
    <div className="ooi-closed-main">
      <div className="ooi-folder ooi-mugfile">
        <span className="ooi-tab">Case {view.round} closed</span>
        <p className="ooi-type">{c.caught ? 'The faker was caught' : 'The faker was never caught…'}</p>
        <div className="ooi-mugshot">
          <div className="ooi-chart" aria-hidden="true">{['7', '6', '5', '4'].map(h => <span key={h}>{h} ft</span>)}</div>
          {step >= 1 && f ? <div className="ooi-mug"><Avatar avatar={f.avatar} color={f.color} size={210} mood={c.caught ? 'sad' : 'happy'} /><span className="ooi-placard">{f.name}</span></div>
            : <span className="ooi-mystery kp-title">?</span>}
          {step >= 1 && <span className="ooi-stamp" data-tone={c.caught ? 'red' : 'gold'}>{c.caught ? 'Caught' : 'Master of disguise'}</span>}
        </div>
        {step >= 1 && <ol className="ooi-trail">{c.trail.map((t, i) => <li key={i}><small>Task {i + 1}</small><span>{t.prompt}</span><b>The faker {didLabel(view, t.value, players)}</b></li>)}</ol>}
      </div>
      <div className="ooi-closed-side">
        {step >= 2 ? <Scoreboard players={players} scores={view.scores} from={view.prev} delay={500} rowHeight={players.length > 8 ? 78 : 88} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
          : <p className="ooi-drum kp-title">{c.caught ? 'Case closed!' : 'The faker was…'}</p>}
      </div>
    </div>
    {step >= 1 && !c.caught && <Confetti burst={`escape-${view.round}`} count={90} />}
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-odd-one-in ooi-tv" data-phase={view.phase}>
    <Room />
    {view.phase === 'case' ? <CaseTV {...props} />
      : view.phase === 'task' ? <TaskTV {...props} />
      : view.phase === 'reveal' || view.phase === 'discuss' ? <BoardTV {...props} />
      : view.phase === 'closed' && view.closed ? <ClosedTV {...props} />
      : <LineupTV {...props} />}
  </div>;
}

// ---------- phone ----------

const eyebrow = (view: OddPublic) => `Case ${view.round} of ${view.rounds} · Task ${view.task} of ${TASKS_PER_CASE}`;
const shellOf = ({ player, vip }: Phone) => ({ player, vip: vip === player.id, accent: ACCENT });

/** The secret dossier. Faker and task phones render this exact card, so neighbours can’t tell them apart at a glance. */
function Brief({ view, text }: { view: OddPublic; text: string }) {
  return <div className="ooi-brief"><span className="ooi-brief-tab">Top secret · {CATEGORY[view.category].name}</span><p>{text}</p><Fingerprint className="ooi-brief-print" /></div>;
}

type Option = { id: string; art: ReactNode; label: string; detail?: string; color?: string };
function options(category: Category, players: readonly PackPlayer[], me: string): Option[] {
  if (category === 'hands') return [{ id: 'up', art: <Hand />, label: 'Hand up' }, { id: 'down', art: <Hand down />, label: 'Hand down' }];
  if (category === 'number') return NUMBERS.map(n => ({ id: n, art: <b className="kp-numeral">{n}</b>, label: '' }));
  if (category === 'face') return FACES.map(f => ({ id: f.id, art: <Face id={f.id} />, label: f.label }));
  return players.map(p => ({ id: p.id, art: <Avatar avatar={p.avatar} color={p.color} size={44} />, label: p.id === me ? `${p.name} (you)` : p.name }));
}

/** Tap to choose, then lock it in. The choice is a persisted draft; one still unsent just before the buzzer locks itself in. */
function Picker({ view, now, draftKey, kind, label, items, submit, onSend, children }: {
  view: OddPublic; now: () => number; draftKey: string; kind: string; label: string; items: Option[]; submit: string; onSend(value: string): ReturnType<P['send']>; children?: ReactNode;
}) {
  const [pick, setPick] = useDraft<string>(draftKey, ''), [state, run] = useSend(), pending = state.status === 'pending', auto = useRef(false);
  const late = view.deadline - useNow(now, 200) < AUTO_LOCK_MS, lock = () => run(() => onSend(pick));
  useEffect(() => { if (late && pick && !auto.current) { auto.current = true; void lock(); } });
  return <>
    <div className="ooi-options" data-kind={kind} role="radiogroup" aria-label={label}>
      {items.map(o => <button key={o.id} type="button" role="radio" aria-checked={pick === o.id} className="ooi-opt" data-on={pick === o.id || undefined} data-value={o.id}
        aria-label={o.label || o.id} style={o.color ? { '--c': o.color } as CSSProperties : undefined} disabled={pending} onClick={() => setPick(o.id)}>{o.art}{o.label && <span>{o.label}{o.detail && <small>{o.detail}</small>}</span>}</button>)}
    </div>
    {children}
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={!pick || pending} onClick={() => void lock()}>{pending ? 'Sending…' : submit}</ArcadeButton></div>
  </>;
}

function TaskPhone(props: Phone) {
  const { view, me, player, players, send, sessionKey } = props, c = CATEGORY[view.category];
  const shell = { ...shellOf(props), eyebrow: eyebrow(view), title: 'Your secret task', timer: { ...span(view), now: props.now } };
  if (me.answer !== undefined) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell}>
      <Brief view={view} text={me.brief ?? ''} />
      <div className="ooi-locked" role="status"><span className="hj-done-stamp" aria-hidden="true">✓</span><span>Locked in:</span><AnswerArt category={view.category} value={me.answer} players={players} author={player.id} size="sm" /></div>
      <p className="ooi-phone-cue">Get ready to {c.irl.toLowerCase()} on 3!</p>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the others" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell}>
    <Brief view={view} text={me.brief ?? ''} />
    <Picker key={view.turn} view={view} now={props.now} draftKey={`${sessionKey}:${view.turn}:pick`} kind={view.category} label={c.how} items={options(view.category, players, player.id)} submit="Lock it in"
      onSend={value => send({ turn: view.turn, k: 'answer', value })}>
      {view.category === 'number' && <p className="hj-note">Counting something? 10 means ten or more.</p>}
    </Picker>
  </PhoneShell>;
}

function CasePhone(props: Phone) {
  const { view } = props, c = CATEGORY[view.category];
  return <PhoneShell {...shellOf(props)} eyebrow={`Case ${view.round} of ${view.rounds} · new case`} title={c.name}>
    <div className="ooi-brief"><span className="ooi-brief-tab">Case file · {c.name}</span><p>{c.stem}</p><Fingerprint className="ooi-brief-print" /></div>
    <ol className="ooi-phone-steps"><li>{c.how}.</li><li>{c.irl} on 3.</li><li>Find the faker. Or be the faker!</li></ol>
    <p className="ooi-phone-cue">Your secret task arrives in a moment…</p>
  </PhoneShell>;
}

function RevealPhone(props: Phone) {
  const { view, me, players, player, now } = props, c = CATEGORY[view.category], step = useTimeline(view.at, REVEAL_STEPS, now);
  return <PhoneShell {...shellOf(props)} eyebrow={eyebrow(view)} title={step >= 4 ? c.act : 'Do it for real on 3!'}>
    <div className="ooi-phone-count" data-go={step >= 4 || undefined}>
      {step < 4 ? <b className="kp-title" key={step}>{Math.max(1, 4 - step)}</b>
        : me.answer !== undefined && <AnswerArt category={view.category} value={me.answer} players={players} author={player.id} size="lg" />}
    </div>
    <p className="ooi-phone-cue">{step < 4 ? `${c.irl} when it hits zero.` : `${c.irl}, right now!`}</p>
  </PhoneShell>;
}

function DiscussPhone(props: Phone) {
  const { view, me, players, player, send } = props, [state, run] = useSend(), online = players.filter(p => p.connected).length;
  return <PhoneShell {...shellOf(props)} eyebrow={eyebrow(view)} title="Who’s faking?" timer={{ ...span(view), now: props.now }}>
    {view.prompt && <p className="ooi-phone-prompt">{view.prompt}</p>}
    {me.answer !== undefined && <div className="ooi-locked"><span>You said:</span><AnswerArt category={view.category} value={me.answer} players={players} author={player.id} size="sm" /></div>}
    <p className="hj-note">Grill each other! Who hesitated? Who copied the room? Votes open soon.</p>
    {me.ready ? <PhoneDone title="Ready to vote" detail={`${view.done.length} of ${online} ready. Keep talking!`} />
      : <div className="hj-sticky">{state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
        <ArcadeButton tone="sky" size="lg" disabled={state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'ready' }))}>I’m ready to vote</ArcadeButton></div>}
  </PhoneShell>;
}

function VotePhone(props: Phone) {
  const { view, me, players, player, send, sessionKey } = props, said = (id: string) => view.answers?.find(a => a.player === id)?.value;
  const shell = { ...shellOf(props), eyebrow: eyebrow(view), timer: { ...span(view), now: props.now } };
  if (me.vote) {
    const suspect = find(players, me.vote);
    return <PhoneShell {...shell} title="Accusation filed!">
      <PhoneDone title="Locked in!" detail="Eyes on the TV for the verdict.">{suspect && <div className="ooi-accused"><AvatarBadge player={suspect} size={64} mood="thinking" /></div>}</PhoneDone>
    </PhoneShell>;
  }
  const items = players.filter(p => p.id !== player.id).map(p => { const v = said(p.id);
    return { id: p.id, color: p.color, art: <Avatar avatar={p.avatar} color={p.color} size={44} />, label: p.name,
      detail: [v !== undefined && saidLabel(view, v, players), view.cleared.includes(p.id) && 'Cleared'].filter(Boolean).join(' · ') }; });
  return <PhoneShell {...shell} title="Who’s the faker?">
    <p className="hj-note">Most votes is accused. A tie lets the faker slip away.</p>
    <Picker key={view.turn} view={view} now={props.now} draftKey={`${sessionKey}:${view.turn}:vote`} kind="suspect" label="Pick a suspect" items={items} submit="Accuse!"
      onSend={suspect => send({ turn: view.turn, k: 'vote', suspect })} />
  </PhoneShell>;
}

function VerdictPhone(props: Phone) {
  const { view, me, players, player, now } = props, v = view.verdict!, stamped = useTimeline(view.at, [VERDICT.stamp], now) > 0;
  const accused = find(players, v.accused), mine = v.accused === player.id;
  const title = !stamped ? 'The votes are in…' : v.outcome === 'caught' ? (mine ? 'Busted!' : me.vote === v.accused ? 'Gotcha! Nailed it.' : 'Caught! (Not by you.)')
    : v.outcome === 'framed' ? (mine ? 'You’ve been framed!' : 'Framed! Wrong person.') : 'Hung jury!';
  const detail = !stamped ? 'Eyes on the TV!' : v.outcome === 'caught' ? (mine ? 'The room saw right through you.' : `${accused?.name} was the faker.`)
    : v.outcome === 'framed' ? (mine ? 'You were innocent all along. The room owes you an apology.' : `${accused?.name} was innocent. The faker is still out there.`)
    : Object.keys(v.votes).length ? 'A tie at the top. The faker slips away.' : 'Nobody voted. The faker slips away.';
  return <PhoneShell {...shellOf(props)} eyebrow={eyebrow(view)} title={title}>
    <div className="ooi-phone-result" data-tone={stamped ? (mine && v.outcome === 'caught' ? 'busted' : v.outcome) : undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={128} mood={!stamped ? 'thinking' : mine ? 'sad' : v.outcome === 'caught' ? 'happy' : 'idle'} />
      <p className={stamped ? undefined : 'ooi-tv-cue'}>{detail}</p>
      {!stamped && me.vote && find(players, me.vote) && <div className="ooi-accused"><span>You accused</span><AvatarBadge player={find(players, me.vote)!} size={48} mood="thinking" /></div>}
      {stamped && v.outcome !== 'caught' && <p className="hj-note">{v.escaped ? 'That was the last task. The case file opens next…' : 'Same faker, new task. Stay sharp.'}</p>}
    </div>
  </PhoneShell>;
}

function ClosedPhone(props: Phone) {
  const { view, me, players, player, now } = props, c = view.closed!, shown = useTimeline(view.at, [CLOSED.faker], now) > 0;
  const gain = c.gains[player.id] ?? 0, rank = rankOf(view.scores, player.id, players.map(p => p.id));
  const title = !shown ? 'Case closed…' : me.faker ? (c.caught ? 'Busted!' : 'Master of disguise!') : gain >= POINTS.correct ? (c.caught ? 'Great detective work!' : 'You smelled a rat!') : c.caught ? 'Case cracked!' : 'You were fooled!';
  return <PhoneShell {...shellOf(props)} eyebrow={`Case ${view.round} of ${view.rounds} closed`} title={title}>
    <div className="ooi-phone-result" data-won={(shown && gain >= POINTS.correct) || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={128} mood={!shown ? 'thinking' : me.faker && c.caught ? (gain ? 'idle' : 'sad') : gain >= POINTS.correct ? 'happy' : gain ? 'idle' : 'sad'} />
      {shown ? <>
        <b className="ooi-phone-points kp-numeral">+{gain}</b>
        <p>{me.faker ? (c.caught ? `You survived ${c.survived} of ${TASKS_PER_CASE} tasks.` : 'Nobody suspected a thing.') : `The faker was ${find(players, c.faker)?.name ?? 'somebody'}.`}</p>
        <p className="ooi-standing"><b className="kp-title">{ordinal(rank)}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>
      </> : <p className="ooi-tv-cue">Eyes on the TV!</p>}
    </div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-odd-one-in ooi-phone">
    {view.phase === 'case' ? <CasePhone {...phone} />
      : view.phase === 'task' ? <TaskPhone {...phone} />
      : view.phase === 'reveal' ? <RevealPhone {...phone} />
      : view.phase === 'discuss' ? <DiscussPhone {...phone} />
      : view.phase === 'vote' ? <VotePhone {...phone} />
      : view.phase === 'verdict' && view.verdict ? <VerdictPhone {...phone} />
      : view.closed ? <ClosedPhone {...phone} /> : null}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
