/* Split Decision screens: the Dilemma Dimension on the TV (portal machine, YES/NO split screen, The Big Split board) and the phone controller. */
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, BigTitle, Confetti, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting, PlayerStrip, Scoreboard, Timer,
  fitText, ordinal, rankOf, useNow, useSend, useTimeline,
} from '../../core/ui';
import {
  MAX_FILL, RESULT, ROUND_NAMES, carousel, finalBeats, sentence, showBeats,
  type Card, type Final, type FinalOutcome, type Outcome, type Side, type SplitPrivate, type SplitPublic, type Verdict,
} from './types';
import './styles.css';

type P = MiniViewProps<SplitPublic, SplitPrivate>;
type Phone = P & { me: SplitPrivate; player: PackPlayer };
const ACCENT = '#ffe23a';
const RESULT_STEPS = [RESULT.slide, RESULT.author, RESULT.points];
const find = (players: readonly PackPlayer[], id: string) => players.find(p => p.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const span = (view: SplitPublic) => ({ deadline: view.deadline, total: view.deadline - view.at });
const VERDICT: Record<Verdict, string> = { perfect: 'Perfect split!', close: 'So close!', lopsided: 'Lopsided!', unanimous: 'Unanimous!', silent: 'Total silence' };
const SIDE_NAMES = [['Yes', 'No'], ['A', 'B']] as const;
/** Sentence size on the TV: three lines across the transmission screen at worst. */
const sentencePx = (len: number, base = 66) => Math.round(base * (len <= 70 ? 1 : len <= 110 ? .88 : len <= 150 ? .79 : .7));

const TIPS = [
  'Aim for half yes, half no. That’s the jackpot.', 'Too tempting? Everyone says yes. Zero points.', 'Too awful? Everyone says no. Also zero.',
  'The perfect catch makes the room argue.', 'Voters on the losing side earn a Bold bonus.', 'Stuck? The machine will fill it, for half points.',
  'Think about who’s on the sofa tonight.', 'A tiny catch for a huge reward… or a huge catch for a tiny one?',
];
const WAIT_LINES = [
  'Practise your best “I would NEVER” face.', 'Decide now: yes or no to everything.', 'Somebody is about to start an argument.',
  'Balance a cushion on your head. For the vibes.', 'Picture the room split in half. Lovely.', 'Hum something cosmic.',
  'Plan your Bold vote. Dare to disagree.', 'Your dilemma is out there. Somewhere. In the dimension.',
];

// ---------- shared art ----------

/** The Dilemma Dimension: nebula, two star layers, a perspective floor and the glowing rift that splits the world in two. */
const Cosmos = () => <div className="sd-cosmos" aria-hidden="true"><i className="sd-stars" /><i className="sd-stars sd-stars-2" /><i className="sd-floor" /><i className="sd-rift" /></div>;

const Logo = () => <span className="sd-logo kp-title"><b>Split</b><b>Decision</b></span>;

/** The portal machine: a yellow/purple split ring with spinning dashes and a core. */
function Portal({ className = '', children }: { className?: string; children?: ReactNode }) {
  return <div className={`sd-portal ${className}`}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs><radialGradient id="sd-core"><stop offset="0" stopColor="#fff8c9" /><stop offset=".35" stopColor="#c58bff" /><stop offset="1" stopColor="#1a0638" /></radialGradient></defs>
      <circle cx="100" cy="100" r="96" className="sd-portal-shadow" />
      <path d="M100 6A94 94 0 0 0 100 194" className="sd-portal-yes" /><path d="M100 6A94 94 0 0 1 100 194" className="sd-portal-no" />
      <circle cx="100" cy="100" r="78" fill="url(#sd-core)" className="sd-portal-core" />
      <circle cx="100" cy="100" r="86" className="sd-portal-dash" /><circle cx="100" cy="100" r="66" className="sd-portal-dash sd-portal-dash-2" />
      <path d="M100 2L92 40L106 64L94 100L108 136L96 160L100 198" className="sd-portal-bolt" />
      {[0, 60, 120, 180, 240, 300].map(a => <circle key={a} r="5" cx={100 + 94 * Math.cos(a * Math.PI / 180)} cy={100 + 94 * Math.sin(a * Math.PI / 180)} className="sd-portal-bolt-dot" />)}
    </svg>
    {children && <div className="sd-portal-in">{children}</div>}
  </div>;
}

/** A scenario sentence with its blanks: filled ones glow (yellow for A/the catch, purple for B), empty ones shimmer. */
function Sentence({ parts, fills, shown = fills.length, active, className = '', style }: { parts: readonly string[]; fills: readonly (string | undefined)[]; shown?: number; active?: number; className?: string; style?: CSSProperties }) {
  return <p className={`sd-sentence ${className}`} style={style}>{parts.map((part, i) => <Fragment key={i}>{part}
    {i < parts.length - 1 && (i < shown && fills[i] !== undefined
      ? <mark data-slot={i}>{fills[i]}</mark>
      : <span className="sd-blank" data-active={active === i || undefined} data-slot={i} aria-label="blank"><i>{active === i ? '?' : ''}</i></span>)}
  </Fragment>)}</p>;
}

function Head({ view, children }: { view: SplitPublic; children?: ReactNode }) {
  return <header className="sd-head">
    <Logo />
    <span className="sd-chip" data-round={view.round}>{ROUND_NAMES[view.round - 1]}</span>
    <span className="sd-head-side">{children}</span>
  </header>;
}

// ---------- TV ----------

function WriteTV({ view, players, vip, now }: P) {
  const final = view.phase === 'final-write', rather = view.round === 2, t = useNow(now, 1000), tip = Math.floor(Math.max(0, t - view.at) / 6000) % TIPS.length;
  return <section className="sd-write" data-final={final || undefined}>
    <Head view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={128} /></Head>
    <div className="sd-write-main">
      <Portal className="sd-portal-big"><b className="kp-numeral">{view.done.length}<small>/{players.length}</small></b><span>{final ? 'takes in' : rather ? 'pairs in' : 'dilemmas in'}</span></Portal>
      <div className="sd-write-copy">
        <h1 className="sd-marquee kp-title">{final ? 'The Big Split!' : rather ? 'Would you rather?' : 'Split the room!'}</h1>
        {final && view.final
          ? <div className="sd-screen sd-screen-final"><span className="sd-screen-tab">One dilemma for everyone</span>
            <Sentence parts={view.final.parts} fills={[]} active={0} style={{ fontSize: sentencePx(view.final.parts.join('').length + 8, 60) }} /></div>
          : <p className="sd-lead">{rather
            ? <>Everyone writes <b className="sd-a">both options</b> of their own would-you-rather. Make it a <em>really</em> tough choice.</>
            : <>Everyone is finishing their <b className="sd-a">own dilemma</b> on their phone. Fill in the catch so the room splits <em>right down the middle</em>.</>}</p>}
        <div className="sd-scale" aria-label="How the author scores">
          <span data-v="perfect"><b className="kp-numeral">50/50</b><small>{final ? '3000' : rather ? '2000' : '1000'} pts</small></span>
          <span data-v="close"><b className="kp-numeral">75/25</b><small>{final ? '1500' : rather ? '1000' : '500'} pts</small></span>
          <span data-v="unanimous"><b className="kp-numeral">All agree</b><small>0 pts</small></span>
        </div>
        <p className="sd-tip" key={tip}>{final ? 'Next: judge every take, yes or no. Fast!' : TIPS[tip]}</p>
      </div>
    </div>
    <PlayerStrip players={players} done={view.done} vip={vip} />
  </section>;
}

/** Voter avatars: gathered in the portal, then sliding into their half. Positions are px offsets inside the arena. */
function voterSpots(o: Outcome, step: number) {
  const all = [...o.sides[0], ...o.sides[1]], big = all.length <= 4, slot = big ? 200 : 154, spots = new Map<string, { x: number; pct: number; y: number }>();
  if (step < 1) all.forEach((id, i) => { const a = i / Math.max(1, all.length) * Math.PI * 2 - Math.PI / 2, r = all.length > 1 ? (all.length > 5 ? 96 : 64) : 0; spots.set(id, { pct: 50, x: r * Math.cos(a), y: 186 + r * Math.sin(a) * .7 }); });
  else o.sides.forEach((ids, side) => {
    const cols = ids.length <= 4 ? ids.length : Math.ceil(ids.length / 2);
    // Half centres sit 32 px off the quarter lines (the beam gap); one row floats mid-panel, two rows stack.
    const rows = Math.ceil(ids.length / Math.max(1, cols));
    ids.forEach((id, k) => { const row = Math.floor(k / cols), inRow = Math.min(cols, ids.length - row * cols), col = k % cols; spots.set(id, { pct: side ? 75 : 25, x: (side ? 32 : -32) + (col - (inRow - 1) / 2) * slot, y: (rows > 1 ? 168 : big ? 200 : 232) + row * 162 }); });
  });
  return spots;
}

function Half({ side, card, visible, count, step }: { side: Side; card: Card; visible: boolean; count?: number; step: number }) {
  const rather = card.kind === 'rather', o = card.outcome, open = rather && (!o || step < 1), won = !!o && step >= 3 && o.verdict !== 'perfect' && o.sides[side].length > 0 && o.sides[side].length < o.sides[1 - side]!.length;
  return <div className="sd-half" data-side={side} data-rather={rather || undefined} data-open={open || undefined} data-hidden={!visible || undefined} data-bold={won || undefined}>
    <header>
      <b className="sd-half-label kp-title">{SIDE_NAMES[rather ? 1 : 0][side]}</b>
      {rather && (visible ? <p style={{ fontSize: fitText(card.fills[side] ?? '', open ? 80 : 54) }}>{card.fills[side]}</p> : <span className="sd-blank sd-blank-big" />)}
      {count !== undefined && <b className="sd-half-count kp-numeral">{count}</b>}
    </header>
    {count === 0 && <p className="sd-half-empty kp-title">Nobody!</p>}
    {won && <span className="sd-bold-tag">Bold! +{o.bold} each</span>}
  </div>;
}

function CardTV({ view, card, players, now }: P & { card: Card }) {
  const phase = view.phase, o = card.outcome, rather = card.kind === 'rather', beats = showBeats(card.fills);
  const shown = useTimeline(view.at, phase === 'show' ? beats.fills : [0, 0], now), step = useTimeline(view.at, phase === 'result' && o ? RESULT_STEPS : [Infinity], now);
  const author = o ? find(players, o.author) : undefined, spots = o ? voterSpots(o, step) : null, len = sentence(card.parts, card.fills).length;
  const big = !!o && o.sides[0].length + o.sides[1].length <= 4;
  const counts = o && step >= 1 ? [o.sides[0].length, o.sides[1].length] : undefined, total = counts ? counts[0]! + counts[1]! : 0;
  return <section className="sd-card" data-phase={phase} key={card.index}>
    <Head view={view}>{phase === 'vote' ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={116} /> : <span className="sd-count">{rather ? 'Choice' : 'Dilemma'} <b className="kp-numeral">{card.index + 1}</b> of {card.count}</span>}</Head>
    <div className="sd-screen sd-screen-card">
      <span className="sd-screen-tab">{rather ? 'Incoming choice' : 'Incoming dilemma'}{o && step >= 2 && author && <> · by <b>{author.name}</b></>}</span>
      {rather
        ? <p className="sd-sentence sd-rather-lead" style={{ fontSize: sentencePx(card.parts[0]!.length + 30) }}>{card.parts[0]!.trim()}…</p>
        : <Sentence parts={card.parts} fills={card.fills} shown={shown} style={{ fontSize: sentencePx(len) }} />}
    </div>
    <div className="sd-arena">
      <Half side={0} card={card} visible={!rather || shown >= 1} count={counts?.[0]} step={step} />
      <Half side={1} card={card} visible={!rather || shown >= 2} count={counts?.[1]} step={step} />
      <i className="sd-beam" aria-hidden="true" />
      {(!o || step < 2) && <Portal className="sd-portal-mid" key="portal">{phase === 'vote' ? <><b className="kp-numeral">{card.votes}</b><span>{card.votes === 1 ? 'vote in' : 'votes in'}</span></> : !o ? <span className="sd-portal-q kp-title">?</span> : null}</Portal>}
      {o && spots && [...spots].map(([id, at], i) => { const p = find(players, id), side = o.sides[0].includes(id) ? 0 : 1, rebel = step >= 3 && o.bold > 0 && o.sides[side].length < o.sides[1 - side]!.length;
        return p && <div key={id} className="sd-voter" data-placed={step >= 1 || undefined} data-big={big || undefined} style={{ left: `calc(${at.pct}% + ${at.x}px)`, top: at.y, transitionDelay: `${(i % 6) * 60}ms` }}>
          <Avatar avatar={p.avatar} color={p.color} size={big ? 136 : 100} mood={step < 1 ? 'thinking' : rebel || o.verdict === 'perfect' ? 'happy' : 'idle'} /><b className="hj-name">{p.name}</b>
        </div>; })}
      {o && step >= 2 && author && <div className="sd-author" data-verdict={step >= 3 ? o.verdict : undefined}>
        <AvatarBadge player={author} size={124} layout="column" mood={step < 3 ? 'idle' : o.points ? 'happy' : 'sad'} detail={rather ? 'asked this' : 'wrote this'} />
        {step >= 3 && <b className="sd-points kp-numeral" data-zero={!o.points || undefined}>+{o.points}</b>}
        {step >= 3 && o.house && <span className="sd-house">Machine-filled · half points</span>}
      </div>}
    </div>
    <div className="sd-foot" role="status">
      {phase === 'show' ? <p>{rather ? 'Option A… or option B?' : 'Read it… then decide.'} <b>Voting opens in a moment.</b></p>
        : phase === 'vote' ? <p><b>Vote on your phone!</b> {rather ? 'A or B?' : 'Yes or no?'} The author can’t vote.</p>
        : !o || step < 1 ? <p>The room is splitting…</p>
        : <div className="sd-meter-row">
          <span className="sd-meter" aria-label={`${counts![0]} ${SIDE_NAMES[rather ? 1 : 0][0]}, ${counts![1]} ${SIDE_NAMES[rather ? 1 : 0][1]}`}>
            <i style={{ width: `${total ? counts![0]! / total * 100 : 50}%` }} /><em aria-hidden="true" />
          </span>
          {step >= 3 && <b className="sd-verdict kp-title" data-verdict={o.verdict}>{VERDICT[o.verdict]}</b>}
        </div>}
    </div>
    {o && step >= 3 && o.verdict === 'perfect' && <Confetti burst={view.turn} count={120} />}
  </section>;
}

function ScoresTV({ view, players }: P) {
  const prev = view.prev ?? {}, gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  return <section className="sd-scores">
    <Head view={view} />
    <div className="sd-scores-main">
      <div className="sd-scores-side">
        <BigTitle kicker={`After round ${view.round}`} size={124}>Scores!</BigTitle>
        <Portal className="sd-portal-small" />
        <p className="sd-next">{view.round === 1 ? <>Next: <b>Would you rather?</b> You write both sides. <b>Double</b> points!</> : <>Next: <b>The Big Split.</b> One dilemma for everyone. <b>Triple</b> points!</>}</p>
      </div>
      <Scoreboard players={players} scores={view.scores} from={prev} delay={900} rowHeight={players.length > 8 ? 80 : 90} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
    </div>
  </section>;
}

function Take({ i, fill, r, shown, crowned, best, players, n }: { i: number; fill: string; r?: FinalOutcome; shown: boolean; crowned: boolean; best: boolean; players: readonly PackPlayer[]; n: number }) {
  const author = r && find(players, r.author), total = r ? r.yes + r.no : 0;
  return <li className="sd-take" data-state={!shown ? 'idle' : crowned ? (best ? 'win' : 'lose') : 'shown'} data-verdict={shown ? r?.verdict : undefined} style={{ animationDelay: `${i * 70}ms` }}>
    <span className="sd-take-n kp-title">{String.fromCharCode(65 + i)}</span>
    <p style={{ fontSize: fitText(fill, n > 6 ? 36 : n > 4 ? 44 : 70) }}>{fill}</p>
    {shown && r && <footer>
      <span className="sd-mini-meter" aria-label={`${r.yes} yes, ${r.no} no`}><b className="kp-numeral">{r.yes}</b><span><i style={{ width: `${total ? r.yes / total * 100 : 50}%` }} /></span><b className="kp-numeral">{r.no}</b></span>
      {author && <AvatarBadge player={author} size={n > 6 ? 40 : n > 4 ? 52 : 72} mood={best && crowned ? 'happy' : 'idle'} />}
    </footer>}
    {shown && r && <b className="sd-points kp-numeral" data-zero={!r.points || undefined}>+{r.points}</b>}
    {shown && r && (r.verdict === 'perfect' || r.verdict === 'unanimous' || r.house) && <span className="sd-take-tag" data-verdict={r.verdict} data-house={r.house || undefined}>
      {r.verdict === 'perfect' || r.verdict === 'unanimous' ? VERDICT[r.verdict] : 'Machine-filled'}{r.house && r.points ? ' · half pts' : ''}</span>}
  </li>;
}

function FinalTV({ view, final, players, vip, now }: P & { final: Final }) {
  const result = final.result, n = final.entries.length, b = finalBeats(result?.entries.length ?? 0);
  const step = useTimeline(view.at, result ? [...b.reveals, b.best, b.bold] : [Infinity], now), order = new Map(result?.entries.map((r, i) => [r.id, i]));
  const crowned = !!result && step > result.entries.length, bolded = !!result && step > result.entries.length + 1;
  const champs = result?.best.map(id => find(players, id)).filter(p => !!p) ?? [], cols = n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  const rebels = result ? players.filter(p => result.bold[p.id]).sort((a, c) => result.bold[c.id]! - result.bold[a.id]!) : [];
  return <section className="sd-final" data-phase={view.phase}>
    <Head view={view}>{view.phase === 'final-vote' ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={116} /> : null}</Head>
    <div className="sd-screen sd-screen-final-card"><span className="sd-screen-tab">One dilemma · {plural(n, 'take')}</span>
      <Sentence parts={final.parts} fills={[]} style={{ fontSize: sentencePx(final.parts.join('').length + 8, 50) }} /></div>
    <ol className="sd-takes" style={{ '--cols': cols } as CSSProperties} data-dense={n > 6 || undefined} data-roomy={n <= 4 || undefined}>
      {final.entries.map((e, i) => { const at = order.get(e.id) ?? -1, r = result?.entries[at];
        return <Take key={e.id} i={i} fill={e.fill} r={r} n={n} shown={!!r && step > at} crowned={crowned} best={!!r && result!.best.includes(r.author)} players={players} />; })}
    </ol>
    {view.phase === 'final-vote'
      ? <><p className="sd-final-hint"><b>Judge every take on your phone:</b> <span className="sd-a">yes</span> or <span className="sd-b">no</span>? The evenest split wins big.</p><PlayerStrip players={players} done={view.done} vip={vip} size={64} /></>
      : <div className="sd-final-foot" role="status">{!crowned ? <p>Splitting the takes…</p>
        : !bolded ? <p>{champs.length ? <><b>{champs.map(p => p.name).join(' & ')}</b> split the room best!</> : 'Nobody split the room. Unanimous all round!'}</p>
        : rebels.length ? <div className="sd-rebels"><span className="kp-title">Bold bonus</span>{rebels.map((p, i) => <span key={p.id} className="sd-rebel" style={{ animationDelay: `${i * 80}ms` }}><Avatar avatar={p.avatar} color={p.color} size={rebels.length > 6 ? 42 : 52} mood="happy" /><b className="hj-name">{p.name}</b><em className="kp-numeral">+{result!.bold[p.id]}</em></span>)}</div>
        : <p>No Bold bonuses: nobody was a lone rebel this time.</p>}</div>}
    {crowned && champs.length > 0 && <Confetti burst="big-split" count={130} />}
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-split-decision sd-tv" data-phase={view.phase}>
    <Cosmos />
    {view.phase === 'write' || view.phase === 'final-write' ? <WriteTV {...props} />
      : view.card ? <CardTV {...props} card={view.card} />
      : view.phase === 'scores' ? <ScoresTV {...props} />
      : view.final ? <FinalTV {...props} final={view.final} /> : null}
  </div>;
}

// ---------- phone ----------

const shellOf = ({ player, vip }: Phone) => ({ player, vip: vip === player.id, accent: ACCENT });
function Standing({ view, players, player }: { view: SplitPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  return <p className="sd-standing"><b className="kp-title">{ordinal(rankOf(view.scores, player.id, players.map(p => p.id)))}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>;
}
/** The two big buttons: YES/NO (or A/B with the option text). Sends on tap; the confirmed side stays lit. */
function Choice({ rather, options, picked, onPick, disabled }: { rather: boolean; options?: readonly string[]; picked?: Side; onPick(side: Side): void; disabled?: boolean }) {
  return <div className="sd-yn" role="radiogroup" aria-label={rather ? 'A or B' : 'Yes or no'} data-rather={rather || undefined}>
    {([0, 1] as const).map(side => <button key={side} type="button" role="radio" aria-checked={picked === side} data-side={side} data-on={picked === side || undefined} data-off={(picked !== undefined && picked !== side) || undefined}
      disabled={disabled || picked !== undefined} onClick={() => onPick(side)}>
      <b className="kp-title">{SIDE_NAMES[rather ? 1 : 0][side]}</b>{rather && options && <span>{options[side]}</span>}
    </button>)}
  </div>;
}

function WritePhone(props: Phone) {
  const { view, me, players, now, send, sessionKey } = props, task = me.task!, [machine, run] = useSend(), final = view.phase === 'final-write', rather = task.kind === 'rather';
  const open = task.slots.findIndex(s => s.text === undefined), fills = task.slots.map(s => s.text), shell = { ...shellOf(props), timer: { ...span(view), now } };
  const eyebrow = final ? 'The Big Split · your take' : rather ? `Would you rather · option ${open < 0 ? 'B' : SIDE_NAMES[1][open]} of 2` : 'Round 1 · your dilemma';
  if (open < 0) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow={eyebrow} title="Locked in!">
      <PhoneDone title="Into the portal it goes." detail={final ? 'Next: judge everyone’s take, fast.' : 'Now act like you’d say yes. Or no. Keep them guessing.'}>
        <div className="sd-phone-card"><Sentence parts={task.parts} fills={fills} />{task.slots.some(s => s.house) && <em className="sd-house-chip">Machine-filled · half points</em>}</div>
      </PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the others" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell} eyebrow={eyebrow} title={rather ? (open ? 'Now the other side!' : 'Write a tough choice') : 'Fill in the catch!'}>
    <PhoneTextEntry multiline maxLength={MAX_FILL} draftKey={`${sessionKey}:${view.turn}:${open}`} placeholder={rather ? 'e.g. eat soup with a fork' : 'e.g. you sneeze every ten minutes'}
      label={<span className="sd-phone-card"><Sentence parts={task.parts} fills={fills} active={open} /></span>}
      hint={rather ? 'Make A and B equally tempting.' : 'Aim for half yes, half no.'}
      submitLabel={rather && !open ? 'Lock in A · write B' : 'Lock it in'} onSubmit={text => send({ turn: view.turn, k: 'fill', slot: open, text })} />
    <ArcadeButton tone="ghost" size="md" className="sd-machine-btn" disabled={machine.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'house', slot: open }))}>
      Stuck? Let the machine fill it <small className="sd-nowrap">(half points)</small>
    </ArcadeButton>
    {machine.status === 'rejected' && <StatusNotice tone="error">{machine.reason}</StatusNotice>}
  </PhoneShell>;
}

function CardPhone(props: Phone) {
  const { view, me, player, players, now, send } = props, card = view.card!, o = card.outcome, rather = card.kind === 'rather', [state, run] = useSend();
  const step = useTimeline(view.at, view.phase === 'result' ? RESULT_STEPS : [Infinity], now), eyebrow = `${ROUND_NAMES[view.round - 1]} · ${rather ? 'choice' : 'dilemma'} ${card.index + 1} of ${card.count}`;
  const mine = me.role === 'author', shell = { ...shellOf(props), eyebrow };
  if (view.phase === 'result' && o) {
    const scored = step >= 3, side = me.side, rebel = side !== undefined && o.bold > 0 && o.sides[side].length < o.sides[1 - side]!.length;
    const title = !scored ? 'The room is splitting…' : mine ? VERDICT[o.verdict] : side === undefined ? 'You sat that one out' : rebel ? 'Bold move!' : o.verdict === 'perfect' ? 'Perfectly split!' : 'With the crowd';
    const gain = mine ? o.points : rebel ? o.bold : 0;
    return <PhoneShell {...shell} title={title}>
      {!scored && <div className="sd-phone-card"><Sentence parts={card.parts} fills={card.fills} /></div>}
      <div className="sd-phone-result" data-won={(scored && gain > 0) || undefined}>
        <Avatar avatar={player.avatar} color={player.color} size={124} mood={!scored ? 'thinking' : gain ? 'happy' : 'idle'} />
        {scored ? <>
          <b className="sd-phone-points kp-numeral" data-zero={!gain || undefined}>+{gain}</b>
          <p>{mine ? <>The room went <b className="sd-a">{o.sides[0].length}</b> {SIDE_NAMES[rather ? 1 : 0][0].toLowerCase()} · <b className="sd-b">{o.sides[1].length}</b> {SIDE_NAMES[rather ? 1 : 0][1].toLowerCase()}{o.house ? ' (machine-filled: half points)' : ''}</>
            : side === undefined ? 'Vote next time: the losing side earns a Bold bonus!' : <>You said <b className={side ? 'sd-b' : 'sd-a'}>{SIDE_NAMES[rather ? 1 : 0][side]}</b>{o.sides[side].length > 1 ? ` with ${plural(o.sides[side].length - 1, 'other')}` : ', all on your own'}.</>}</p>
          <Standing view={view} players={players} player={player} />
        </> : <p className="sd-tv-cue">Eyes on the TV!</p>}
      </div>
    </PhoneShell>;
  }
  if (mine) return <PhoneShell {...shell} title={rather ? 'Your choice is up!' : 'Your dilemma is up!'} timer={view.phase === 'vote' ? { ...span(view), now } : null}>
    <div className="sd-phone-card"><Sentence parts={card.parts} fills={card.fills} /></div>
    <PhoneWaiting title="No voting on your own" detail={view.phase === 'vote' ? `${plural(card.votes, 'vote')} in. Fingers crossed for 50/50!` : 'Act natural. Nobody knows it’s yours… yet.'} lines={WAIT_LINES} />
  </PhoneShell>;
  if (view.phase === 'show') return <PhoneShell {...shell} title="Get ready to decide!">
    <div className="sd-phone-card"><Sentence parts={card.parts} fills={card.fills} shown={0} /></div>
    <p className="sd-tv-cue">Eyes on the TV!</p>
  </PhoneShell>;
  return <PhoneShell {...shell} title={me.side !== undefined ? 'Vote locked in!' : rather ? 'Which would you rather?' : 'Would you do it?'} timer={{ ...span(view), now }}>
    <div className="sd-phone-card">{rather ? <p className="sd-sentence">{card.parts[0]!.trim()}…</p> : <Sentence parts={card.parts} fills={card.fills} />}</div>
    <Choice rather={rather} options={card.fills} picked={me.side} disabled={state.status === 'pending'} onPick={side => void run(() => send({ turn: view.turn, k: 'vote', side }))} />
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    {me.side !== undefined && <p className="hj-note">Be honest! If you end up on the smaller side, you earn a Bold bonus.</p>}
  </PhoneShell>;
}

function ScoresPhone(props: Phone) {
  const { view, player, players } = props;
  return <PhoneShell {...shellOf(props)} eyebrow={`After round ${view.round}`} title="Scores!">
    <div className="sd-phone-result"><Avatar avatar={player.avatar} color={player.color} size={124} mood={rankOf(view.scores, player.id, players.map(p => p.id)) === 1 ? 'happy' : 'idle'} />
      <Standing view={view} players={players} player={player} />
      <p className="hj-note">{view.round === 1 ? 'Next: would you rather. You write both sides, double points!' : 'Next: The Big Split. Triple points!'}</p></div>
  </PhoneShell>;
}

/** The Big Split carousel: one take at a time, yes or no, straight to the next. */
function JudgePhone(props: Phone) {
  const { view, me, players, now, send } = props, final = view.final!, [state, run] = useSend(), [sent, setSent] = useState<string[]>([]);
  const queue = carousel(final.entries, me.mine), judged = me.judged ?? {}, next = queue.find(e => !Object.hasOwn(judged, e.id) && !sent.includes(e.id));
  const left = queue.filter(e => !Object.hasOwn(judged, e.id)).length, shell = { ...shellOf(props), eyebrow: 'The Big Split · judge every take', timer: { ...span(view), now } };
  if (!queue.length) return <PhoneShell {...shell} title="Sit back"><PhoneWaiting title="Nothing to judge" detail="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>;
  if (!next) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} title={left ? 'Sending…' : 'All judged!'}>
      <PhoneDone title={`${plural(queue.length, 'take')} judged`} detail="Watch the TV for The Big Split reveal." />
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the others" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  const n = queue.length - left + 1, pick = (side: Side) => { setSent(s => [...s, next.id]); void run(() => send({ turn: view.turn, k: 'judge', entry: next.id, side })).then(ok => { if (!ok) setSent(s => s.filter(id => id !== next.id)); }); };
  return <PhoneShell {...shell} title={`Take ${Math.min(n, queue.length)} of ${queue.length}`}>
    <p className="sd-pips" aria-hidden="true">{queue.map(e => <i key={e.id} data-on={(Object.hasOwn(judged, e.id) || sent.includes(e.id)) || undefined} data-now={e.id === next.id || undefined} />)}</p>
    <div className="sd-phone-card sd-carousel-card" key={next.id}><Sentence parts={final.parts} fills={[next.fill]} /></div>
    <Choice rather={false} disabled={state.status === 'pending'} onPick={pick} />
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
  </PhoneShell>;
}

function FinalResultPhone(props: Phone) {
  const { view, me, player, players, now } = props, result = view.final?.result, b = finalBeats(result?.entries.length ?? 0);
  const step = useTimeline(view.at, [...b.reveals, b.best, b.bold], now), at = result?.entries.findIndex(r => r.id === me.mine) ?? -1;
  const mine = at >= 0 ? result!.entries[at] : undefined, shown = !!mine && step > at, n = result?.entries.length ?? 0, crowned = step > n, bolded = step > n + 1;
  const won = crowned && !!result?.best.includes(player.id), bold = result?.bold[player.id] ?? 0;
  return <PhoneShell {...shellOf(props)} eyebrow="The Big Split" title={won ? 'You split the room best!' : crowned ? 'That’s the show!' : 'Splitting the takes…'}>
    <div className="sd-phone-result" data-won={won || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={124} mood={won ? 'happy' : shown ? 'idle' : 'thinking'} />
      {shown && mine && <><b className="sd-phone-points kp-numeral" data-zero={!mine.points || undefined}>+{mine.points}</b>
        <p>“{mine.fill}” went <b className="sd-a">{mine.yes} yes</b> · <b className="sd-b">{mine.no} no</b>. {VERDICT[mine.verdict]}</p></>}
      {bolded && bold > 0 && <p className="sd-bold-line">Bold bonus: <b className="kp-numeral">+{bold}</b> for siding with the few.</p>}
      {crowned ? <Standing view={view} players={players} player={player} /> : !shown && <p className="sd-tv-cue">{mine ? 'Your take is coming up. Eyes on the TV!' : 'Eyes on the TV!'}</p>}
    </div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-split-decision sd-phone">
    {(view.phase === 'write' || view.phase === 'final-write') && me.task ? <WritePhone {...phone} />
      : view.phase === 'write' || view.phase === 'final-write' ? <PhoneShell {...shellOf(phone)} title="Sit this one out"><PhoneWaiting title="The portal is busy" detail="You’ll judge the takes in a moment." lines={WAIT_LINES} /></PhoneShell>
      : view.card ? <CardPhone {...phone} />
      : view.phase === 'scores' ? <ScoresPhone {...phone} />
      : view.phase === 'final-vote' ? <JudgePhone {...phone} />
      : <FinalResultPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
