/* Ballpark screens: the covert data lab on the TV (radar survey, the Ballpark Meter, Most Wanted posters) and the phone controller. */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, AvatarStack, BigTitle, Callout, Confetti, PhoneDone, PhoneShell, PhoneWaiting, PlayerStrip, Scoreboard, StillWorking, Timer,
  fitText, ordinal, rankOf, useDraft, useNow, useSend, useTimeline,
} from '../../core/ui';
import {
  AIM_MS, BETS, BET_POINTS, MUCH, REVEAL, ROUND_NAMES, TIERS, WANTED_PICKS, WANTED_POINTS, betCopy, possible, spring, wantedBeats, wins,
  type BallparkPrivate, type BallparkPublic, type Bet, type Reveal,
} from './types';
import './styles.css';

type P = MiniViewProps<BallparkPublic, BallparkPrivate>;
type Phone = P & { me: BallparkPrivate; player: PackPlayer };
const ACCENT = '#2de0c8';
const REVEAL_STEPS = [REVEAL.bets, REVEAL.sweep, REVEAL.land, REVEAL.score];
const find = (players: readonly PackPlayer[], id: string | null | undefined) => players.find(p => p.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const span = (view: BallparkPublic) => ({ deadline: view.deadline, total: view.deadline - view.at });
const clamp = (v: number) => Math.min(100, Math.max(0, v));
/** Connected players who can bet on this agent. */
const bettors = (players: readonly PackPlayer[], agent: string) => players.filter(p => p.connected && p.id !== agent).length;
const WAIT_LINES = [
  'Act casual. Agents never look at the camera.', 'Your answer is safe in the vault.', 'Somebody here is lying to the survey. Probably.',
  'Count the room. Do the maths. Trust your gut.', 'Remember: you are part of the data.', 'Keep a straight face. Statistics are watching.',
  'Estimate how many snacks are left. Practise.', 'Whisper “interesting…” and say nothing else.',
];

// ---------- shared art ----------

/** The lab behind every TV screen: graph-paper glass, CRT scanlines and a slow radar sweep in the corner. */
const Lab = () => <div className="bp-lab" aria-hidden="true"><i className="bp-lab-grid" /><i className="bp-lab-radar" /><i className="bp-lab-scan" /></div>;

/** A tiny trench-coat agent silhouette: the anonymous crowd. */
const Spy = ({ className = '' }: { className?: string }) => <svg className={`bp-spy ${className}`} viewBox="0 0 40 64" aria-hidden="true">
  <path d="M8 62V40C8 31 13 27 20 27C27 27 32 31 32 40V62Z" /><circle cx="20" cy="18" r="8" />
  <path className="bp-spy-hat" d="M6 13H34L29 10L27 2H13L11 10Z" /><path className="bp-spy-collar" d="M14 29L20 40L26 29" />
</svg>;

/** Green-bar teleprinter paper: the question card everywhere. */
function Printout({ text, eyebrow, size = 64, stamp, className = '' }: { text: string; eyebrow: ReactNode; size?: number; stamp?: ReactNode; className?: string }) {
  return <div className={`bp-printout ${className}`}>
    <span className="bp-printout-tab">{eyebrow}</span>
    <p style={{ fontSize: fitText(text, size) }}>{text}</p>
    {stamp && <span className="bp-stamp">{stamp}</span>}
  </div>;
}

function Head({ view, children }: { view: BallparkPublic; children?: ReactNode }) {
  const q = view.q;
  return <header className="bp-head">
    <span className="bp-logo"><b className="kp-title">Ballpark</b><small>Bureau of Educated Guesses</small></span>
    <span className="bp-chip" data-round={view.round}>{ROUND_NAMES[view.round - 1]}{q && <> · Case <b>{q.index + 1}</b> of {q.count}</>}</span>
    <span className="bp-head-side">{children}</span>
  </header>;
}

// ---------- the Ballpark Meter ----------

const CX = 500, CY = 500;
const pt = (r: number, v: number) => { const a = Math.PI * (1 - v / 100); return [Math.round((CX + r * Math.cos(a)) * 10) / 10, Math.round((CY - r * Math.sin(a)) * 10) / 10] as const; };
function band(a: number, b: number, r1: number, r2: number) {
  const [x1, y1] = pt(r2, a), [x2, y2] = pt(r2, b), [x3, y3] = pt(r1, b), [x4, y4] = pt(r1, a);
  return `M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z`;
}
const LEDS = Array.from({ length: 50 }, (_, i) => ({ d: band(i * 2 + .3, i * 2 + 1.7, 400, 446), hue: Math.round(172 - i * 2.75) }));
const TICKS = Array.from({ length: 101 }, (_, v) => { const r = v % 10 ? v % 5 ? 318 : 306 : 292, [x1, y1] = pt(r, v), [x2, y2] = pt(334, v); return { v, d: `M${x1} ${y1}L${x2} ${y2}` }; });
const needle = (v: number) => ({ transform: `rotate(${(clamp(v) - 50) * 1.8}deg)` });

type Zone = { bet: Bet; from: number; to: number };
/** The betting zones around a guess: lower/higher, split into "much" beyond ±15 in round 2. */
function zones(guess: number, much: boolean): Zone[] {
  if (!much) return [{ bet: 'lower', from: 0, to: guess }, { bet: 'higher', from: guess, to: 100 }];
  const lo = Math.max(0, guess - MUCH), hi = Math.min(100, guess + MUCH);
  return [{ bet: 'much-lower' as Bet, from: 0, to: lo }, { bet: 'lower' as Bet, from: lo, to: guess }, { bet: 'higher' as Bet, from: guess, to: hi }, { bet: 'much-higher' as Bet, from: hi, to: 100 }].filter(z => z.to > z.from);
}

/** Semicircle gauge: LED level, betting zones, scale, the agent's needle (live or locked) and the truth needle. */
function Meter({ dial, guess, truth, much, winning, live }: { dial: number | null; guess: number | null; truth: number | null; much: boolean; winning?: readonly Bet[]; live?: boolean }) {
  const level = truth ?? dial ?? -1;
  return <svg className="bp-meter" viewBox="0 0 1000 540" aria-hidden="true" data-live={live || undefined}>
    <defs><radialGradient id="bp-face" cx="50%" cy="100%" r="100%"><stop offset="0" stopColor="#0f3a44" /><stop offset=".8" stopColor="#06161f" /></radialGradient></defs>
    <path className="bp-meter-shadow" d={`M14 ${CY + 14}A486 486 0 0 1 986 ${CY + 14}Z`} />
    <path className="bp-meter-rim" d={`M14 ${CY}A486 486 0 0 1 986 ${CY}Z`} />
    <path className="bp-meter-face" d={`M30 ${CY}A470 470 0 0 1 970 ${CY}Z`} fill="url(#bp-face)" />
    {LEDS.map((l, i) => <path key={i} className="bp-led" data-on={i * 2 + 1 <= level || undefined} d={l.d} style={{ '--h': l.hue } as CSSProperties} />)}
    {guess !== null && zones(guess, much).map(z => <path key={z.bet} className="bp-zone" data-bet={z.bet} data-win={winning?.includes(z.bet) || undefined} data-lose={(winning && !winning.includes(z.bet)) || undefined} d={band(z.from, z.to, 338, 392)} />)}
    {TICKS.map(t => <path key={t.v} className="bp-tick" data-major={t.v % 10 === 0 || undefined} d={t.d} />)}
    {Array.from({ length: 11 }, (_, i) => { const [x, y] = pt(252, i * 10); return <text key={i} className="bp-scale" x={x} y={y + 12}>{i * 10}</text>; })}
    {guess !== null && much && [guess - MUCH, guess + MUCH].filter(v => v > 0 && v < 100).map(v => { const [x, y] = pt(366, v); return <text key={v} className="bp-x2" x={x} y={y + 9}>×2</text>; })}
    {dial !== null && <g className="bp-needle" data-ghost={truth !== null || undefined} style={needle(dial)}><path d={`M${CX - 13} ${CY}L${CX} ${CY - 430}L${CX + 13} ${CY}Z`} /></g>}
    {truth !== null && <g className="bp-needle bp-needle-truth" style={needle(truth)}><path d={`M${CX - 16} ${CY}L${CX} ${CY - 452}L${CX + 16} ${CY}Z`} /></g>}
    <circle className="bp-hub" cx={CX} cy={CY} r="34" /><circle className="bp-hub-cap" cx={CX} cy={CY} r="14" />
  </svg>;
}

// ---------- TV ----------

/** Survey: radar blips (one per anonymous answer), the question on teleprinter paper and the agent on deck. */
function SurveyTV({ view, players, vip, now }: P) {
  const q = view.q!, agent = find(players, q.agent), n = view.done.length;
  return <section className="bp-survey">
    <Head view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={132} /></Head>
    <div className="bp-survey-main">
      <div className="bp-radar" role="status" aria-label={`${n} of ${players.length} answers in`}>
        <i className="bp-radar-sweep" />
        {view.done.map((_, i) => { const a = i * 2.4, r = 18 + (i * 61 % 27); return <b key={i} className="bp-blip" style={{ left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%` }} />; })}
        <span className="bp-radar-count"><b className="kp-numeral">{n}<small>/{players.length}</small></b><small>answers in</small></span>
      </div>
      <div className="bp-survey-copy">
        <Printout eyebrow={<>Secret survey · intercept {String(q.index + 1).padStart(2, '0')}</>} text={q.text} size={78} stamp={q.open ? 'On the record' : 'Classified'} className="bp-survey-card" />
        <p className="bp-privacy">{q.open
          ? <><b>On the record:</b> this one shows who said what.</>
          : <><b>Yes or no on your phone.</b> Anonymous: only the total is revealed.</>}</p>
        {agent && <div className="bp-ondeck"><Avatar avatar={agent.avatar} color={agent.color} size={88} mood="thinking" /><span><small>Agent on deck</small><b>{agent.name}</b> estimates the % next</span></div>}
      </div>
    </div>
    <PlayerStrip players={players} done={view.done} vip={vip} />
  </section>;
}

/** One side of the betting floor. Bets stay hidden until the reveal; then avatars drop in and a winning booth stamps its pay.
    Everyone in a booth wins or loses together, so the pay shows once (a crowd of nine still fits). */
function Booth({ zone, guess, bettors, step, r, shrink }: { zone: Bet; guess: number; bettors: PackPlayer[]; step: number; r?: Reveal; shrink?: boolean }) {
  const copy = betCopy(zone, guess), settled = step >= 4 && !!r, won = settled && wins(zone, r.guess, r.truth), dense = bettors.length > 4, empty = step >= 1 && !!r && !bettors.length;
  return <div className="bp-booth" data-bet={zone} data-win={(settled && won) || undefined} data-lose={(settled && !won) || undefined} style={empty && shrink ? { flex: 'none' } : { flexGrow: 1 + (step >= 1 ? bettors.length : 0) }}>
    <header><b className="kp-title">{zone.endsWith('higher') ? '▲' : '▼'} {copy.label}</b><small>{possible(zone, guess) ? copy.range : 'Off the scale'}{zone.startsWith('much') && <em>×2</em>}</small></header>
    {step >= 1 && r && <ul data-dense={dense || undefined}>{bettors.map((p, i) => <li key={p.id} style={{ animationDelay: `${i * 90}ms` }}>
      <AvatarBadge player={p} size={dense ? 52 : 68} layout="column" mood={settled ? (won ? 'happy' : 'sad') : 'thinking'} />
    </li>)}</ul>}
    {settled && won && bettors.length > 0 && <span className="bp-stamp bp-booth-pay">+{zone.startsWith('much') ? BET_POINTS.much : BET_POINTS.plain}{bettors.length > 1 && <small> each</small>}</span>}
    {empty && <p className="bp-booth-empty">Nobody</p>}
    {!r && <span className="bp-booth-sealed kp-title" aria-hidden="true">?</span>}
  </div>;
}

function Floor({ side, guess, much, view, players, step }: { side: 'lower' | 'higher'; guess: number; much: boolean; view: BallparkPublic; players: readonly PackPlayer[]; step: number }) {
  const r = view.result, list: Bet[] = side === 'lower' ? (much ? ['much-lower', 'lower'] : ['lower']) : (much ? ['much-higher', 'higher'] : ['higher']);
  const crowds = list.map(zone => r ? players.filter(p => r.bets[p.id] === zone) : []);
  // Round 2: an empty booth shrinks to its header when the booth beside it has bettors, so a crowd of nine still fits.
  return <div className="bp-floor" data-side={side}>
    {list.map((zone, i) => <Booth key={zone} zone={zone} guess={guess} step={r ? step : 0} r={r} bettors={crowds[i]!} shrink={crowds.some(c => c.length > 0)} />)}
  </div>;
}

/** Guess, bet and reveal share one screen: the meter in the middle, the agent or the betting floor on the sides. */
function DialTV({ view, players, now }: P) {
  const q = view.q!, r = view.result, phase = view.phase, agent = find(players, q.agent), much = view.round > 1;
  const t = useNow(now, phase === 'reveal' ? 33 : phase === 'guess' ? 100 : 250) - view.at;
  const step = r ? REVEAL_STEPS.filter(x => t >= x).length : 0, landed = step >= 3, scored = step >= 4;
  const guess = r?.guess ?? (q.locked ? q.dial : null);
  const truth = r && step >= 2 ? clamp(r.guess + (r.truth - r.guess) * spring((t - REVEAL.sweep) / (REVEAL.land - REVEAL.sweep))) : null;
  const winning = scored && r ? BETS.filter(b => wins(b, r.guess, r.truth)) : undefined;
  const tier = r ? TIERS[r.tier] : undefined;
  return <section className="bp-dialtv" data-phase={phase}>
    <Head view={view}>{phase !== 'reveal' && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} />}</Head>
    <Printout className="bp-qstrip" eyebrow={<>What % of this room said <b>yes</b>?{q.respondents !== undefined && <> · {plural(q.respondents, 'answer')}</>}</>} text={q.text} size={58} />
    <div className="bp-dial-main">
      {phase === 'guess' ? <div className="bp-agent-card">
        {agent && <AvatarBadge player={agent} size={136} layout="column" mood={q.locked ? 'done' : 'thinking'} detail={q.locked ? 'Locked in!' : 'is on the dial'} />}
        <p>The agent knows their own answer. <b>Nobody else’s.</b></p>
        <ol className="bp-ladder" aria-label="Agent points">{TIERS.map(t => <li key={t.within}>±{t.within}<b className="kp-numeral">{t.points}</b></li>)}</ol>
      </div> : guess !== null && <Floor side="lower" guess={guess} much={much} view={view} players={players} step={step} />}
      <div className="bp-dial-centre">
        <Meter dial={phase === 'guess' && !q.locked ? q.dial : guess} guess={phase === 'guess' ? null : guess} truth={truth} much={much} winning={winning} live={phase === 'guess' && !q.locked} />
        <div className="bp-console">
          {phase !== 'guess' && agent && <span className="bp-console-agent"><AvatarBadge player={agent} size={64} mood={scored ? (r!.tier >= 0 ? 'happy' : 'sad') : 'idle'} detail={scored ? (r!.gains[agent.id] ? `+${r!.gains[agent.id]}` : 'No points') : `guessed ${guess}%`} /></span>}
          <span className="bp-readout" data-truth={truth !== null || undefined}>
            <small>{truth !== null ? 'The truth' : phase === 'guess' ? (q.locked ? 'Locked in' : 'Agent’s estimate') : 'The guess'}</small>
            <b className="kp-numeral">{truth !== null ? Math.round(truth) : (phase === 'guess' && !q.locked ? q.dial : guess) ?? '--'}<i>%</i></b>
          </span>
          {scored && r && <span className="bp-verdict" data-tier={r.tier}><b className="kp-title">{tier ? tier.label : 'Way off!'}</b><small>{r.truth === r.guess ? 'Exactly right!' : `Off by ${Math.abs(r.truth - r.guess)}`}</small></span>}
        </div>
        {q.locked && phase === 'guess' && <span className="bp-locked kp-title" aria-hidden="true">Locked</span>}
      </div>
      {phase === 'guess' ? <div className="bp-hint">
        <p className="kp-title">Everyone else</p>
        <p>Get ready to bet: will the truth be <b className="bp-up">▲ higher</b> or <b className="bp-down">▼ lower</b>? The right call pays <b className="bp-up">{BET_POINTS.plain}</b>.</p>
        {much && <p className="bp-hint-much"><b>Long shots:</b> more than {MUCH} points away pays <b>double</b>.</p>}
      </div> : guess !== null && <Floor side="higher" guess={guess} much={much} view={view} players={players} step={step} />}
    </div>
    <div className="bp-foot" role="status">{landed && r ? <Crowds r={r} players={players} /> : <p>
      {phase === 'guess' ? (q.locked ? <><b>{agent?.name}</b> locks in <b>{q.dial}%</b>!</> : <><b>{agent?.name}</b> is dialling in their estimate…</>)
        : phase === 'bet' ? <><b>Bet on your phone:</b> higher or lower than {guess}%? <span className="bp-pill kp-numeral">{view.done.length}/{bettors(players, q.agent)} bets in</span>
          <StillWorking players={players.filter(p => p.connected && p.id !== q.agent && !view.done.includes(p.id))} label={null} /></>
        : step >= 2 ? 'Reading the room…' : 'The truth is…'}
    </p>}</div>
    {scored && r?.tier === 0 && <><Confetti burst={view.turn} count={120} /><div className="bp-bullseye"><Callout tone="lime">Bullseye!</Callout></div></>}
  </section>;
}

/** The two crowds: anonymous agents (or real faces when the question is on the record). */
function Crowds({ r, players }: { r: Reveal; players: readonly PackPlayer[] }) {
  if (r.house) return <span className="bp-house">Not enough intel came in, so the lab made up a number.</span>;
  const side = (said: 'yes' | 'no', n: number, ids?: string[]) => <span className="bp-crowd" data-said={said}>
    <b className="kp-numeral">{n}</b><small>said {said}</small>
    <span className="bp-crowd-row">{ids ? ids.map(id => { const p = find(players, id); return p && <Avatar key={id} avatar={p.avatar} color={p.color} size={56} mood={said === 'yes' ? 'happy' : 'idle'} />; })
      : Array.from({ length: n }, (_, i) => <Spy key={i} />)}</span>
  </span>;
  return <span className="bp-crowds">{side('yes', r.yes, r.yesIds)}<i className="bp-crowds-vs">{r.yesIds ? 'on the record' : 'anonymous'}</i>{side('no', r.no, r.noIds)}</span>;
}

function ScoresTV({ view, players }: P) {
  const prev = view.prev ?? {}, gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  const next = view.round === 1 ? (players.length >= 7 ? <>Round 2: the <b>three lowest scorers</b> take the dial. Long shots pay <b>double</b>.</> : <>Round 2: everyone dials again. Long shots pay <b>double</b>.</>)
    : <>Final round: <b>Most Wanted</b>. Read the room!</>;
  return <section className="bp-scores">
    <Head view={view} />
    <div className="bp-scores-main">
      <div className="bp-scores-side">
        <BigTitle kicker={`After round ${view.round}`} size={130}>Debrief</BigTitle>
        <div className="bp-radar bp-radar-small" aria-hidden="true"><i className="bp-radar-sweep" /></div>
        <p className="bp-next">{next}</p>
      </div>
      <Scoreboard players={players} scores={view.scores} from={prev} delay={900} rowHeight={players.length > 8 ? 80 : 90} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
    </div>
  </section>;
}

/** Most Wanted: nine posters. Tick, pick three, then the posters reveal their ticks from fewest to most. */
function WantedTV({ view, players, vip, now }: P) {
  const w = view.wanted!, r = w.result, b = wantedBeats(w.items.length);
  const step = useTimeline(view.at, r ? [...b.reveals, b.totals] : [Infinity], now), totals = !!r && step > w.items.length;
  const seen = new Map(r?.order.map((i, k) => [i, k]));
  const hunters = r ? players.filter(p => r.picks[p.id]).sort((a, c) => r.gains[c.id]! - r.gains[a.id]!) : [];
  return <section className="bp-wanted" data-phase={view.phase}>
    <Head view={view}>{view.phase !== 'wanted' && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} />}</Head>
    <div className="bp-wanted-title">
      <span className="bp-stamp bp-stamp-big">Most Wanted</span>
      <h1 className="kp-title">{w.title}</h1>
      <p>{view.phase === 'tick' ? <><b>Tick what’s true for you.</b> Anonymous: only totals are shown.</>
        : view.phase === 'pick' ? <><b>Pick the {WANTED_PICKS}</b> the room ticked most. #1 pays {WANTED_POINTS[0]}, #2 {WANTED_POINTS[1]}, #3 {WANTED_POINTS[2]}.</>
        : <>Ticked by the room, fewest first…</>}</p>
    </div>
    <ol className="bp-posters">{w.items.map((text, i) => {
      const k = seen.get(i) ?? -1, shown = !!r && k >= 0 && step > k, rank = r?.ranks[i] ?? 0, top = shown && rank >= 1 && rank <= WANTED_POINTS.length;
      const pickers = shown && r ? players.filter(p => r.picks[p.id]?.includes(i)) : [];
      return <li key={i} className="bp-poster" data-shown={shown || undefined} data-top={top || undefined} style={{ animationDelay: `${i * 70}ms` }}>
        <span className="bp-poster-n kp-numeral">{i + 1}</span>
        <p style={{ fontSize: fitText(text, 44) }}>{text}</p>
        {shown && r && <footer>
          <span className="bp-poster-meter"><b className="kp-numeral">{r.counts[i]}</b><small>of {r.filed}</small><i><span style={{ width: `${r.filed ? r.counts[i]! / r.filed * 100 : 0}%` }} /></i></span>
          {pickers.length > 0 && <AvatarStack players={pickers} size={40} max={6} mood={top ? 'happy' : 'idle'} />}
        </footer>}
        {top && <span className="bp-stamp bp-poster-rank">#{rank} · +{WANTED_POINTS[rank - 1]}</span>}
      </li>;
    })}</ol>
    {view.phase !== 'wanted' ? <PlayerStrip players={players} done={view.done} vip={vip} size={players.length > 8 ? 64 : 76} />
      : <div className="bp-hunters" role="status">{totals ? hunters.map((p, i) => <span key={p.id} className="bp-hunter" style={{ animationDelay: `${i * 80}ms` }}>
          <Avatar avatar={p.avatar} color={p.color} size={56} mood={r!.gains[p.id]! > 0 ? 'happy' : 'sad'} /><b className="hj-name">{p.name}</b><em className="kp-numeral">+{r!.gains[p.id]}</em></span>)
        : <p>Counting the ticks…</p>}</div>}
    {totals && hunters.some(p => r!.gains[p.id]! > 0) && <Confetti burst="most-wanted" count={110} />}
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-ballpark bp-tv" data-phase={view.phase}>
    <Lab />
    {view.phase === 'survey' && view.q ? <SurveyTV {...props} />
      : view.q ? <DialTV {...props} />
      : view.phase === 'scores' ? <ScoresTV {...props} />
      : view.wanted ? <WantedTV {...props} /> : null}
  </div>;
}

// ---------- phone ----------

const shellOf = ({ player, vip }: Phone) => ({ player, vip: vip === player.id, accent: ACCENT });
const eyebrow = (view: BallparkPublic) => `${ROUND_NAMES[view.round - 1]}${view.q ? ` · case ${view.q.index + 1} of ${view.q.count}` : ''}`;

function Standing({ view, players, player }: { view: BallparkPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  return <p className="bp-standing"><b className="kp-title">{ordinal(rankOf(view.scores, player.id, players.map(p => p.id)))}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>;
}
const Memo = ({ text, label }: { text: string; label: ReactNode }) => <div className="bp-memo"><small>{label}</small><p>{text}</p></div>;
const Said = ({ me }: { me: BallparkPrivate }) => me.answer ? <span className="bp-said" data-said={me.answer}>You said {me.answer}</span> : <span className="bp-said">Your answer didn’t make it in time</span>;

function SurveyPhone(props: Phone) {
  const { view, me, players, send, now } = props, q = view.q!, [state, run] = useSend(), agent = me.role === 'agent';
  const shell = { ...shellOf(props), eyebrow: eyebrow(view), timer: { ...span(view), now } };
  const note = q.open ? <><b>On the record.</b> This harmless one shows who said what on the TV.</> : <><b>Your answer is anonymous.</b> The TV only ever shows the room’s total.</>;
  if (me.answer) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} title="Answer filed!">
      <PhoneDone title={`You said ${me.answer}`} detail={note} />
      {agent && <p className="bp-cue">You’re the agent! Next: guess what % said yes.</p>}
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the others" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell} title="Yes or no?">
    {agent && <p className="bp-banner">You’re the agent for this one! Answer first, then dial in the room.</p>}
    <Memo label={q.open ? 'On the record' : 'Classified · anonymous'} text={q.text} />
    <div className="bp-yn" role="group" aria-label="Your answer">
      {[true, false].map(yes => <button key={String(yes)} type="button" data-yes={yes} disabled={state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'answer', yes }))}>
        <b className="kp-title">{yes ? 'Yes' : 'No'}</b></button>)}
    </div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <p className="bp-lock-note"><span aria-hidden="true">{q.open ? '👀' : '🔒'}</span> {note}</p>
  </PhoneShell>;
}

/** The agent's dial: a big slider plus fine nudges. Positions stream to the TV at most four times a second. */
function Dial({ view, now, send, sessionKey }: Phone) {
  const q = view.q!, [value, setValue] = useDraft<number>(`${sessionKey}:${view.turn}:dial`, q.dial ?? 50), [state, run] = useSend();
  const last = useRef(0), timer = useRef(0), touched = useRef(false), auto = useRef(false), pending = state.status === 'pending';
  const push = (raw: number) => {
    const v = clamp(Math.round(raw)); touched.current = true; setValue(v);
    window.clearTimeout(timer.current);
    const fire = () => { last.current = Date.now(); void send({ turn: view.turn, k: 'aim', value: v }); };
    const wait = last.current + AIM_MS - Date.now();
    if (wait <= 0) fire(); else timer.current = window.setTimeout(fire, wait);
  };
  const lock = () => { window.clearTimeout(timer.current); return run(() => send({ turn: view.turn, k: 'lock', value })); };
  // A dial that was moved but not locked locks itself just before the buzzer.
  const late = view.deadline - useNow(now, 200) < 700;
  useEffect(() => { if (late && touched.current && !auto.current) { auto.current = true; void lock(); } });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <div className="bp-dial">
    <output className="bp-dial-read kp-numeral" aria-live="off">{value}<i>%</i></output>
    <label className="bp-slider"><span className="hj-sr">What percent said yes</span>
      <input type="range" min={0} max={100} step={1} value={value} disabled={pending} style={{ '--v': `${value}%` } as CSSProperties} onChange={e => push(Number(e.target.value))} />
    </label>
    <div className="bp-scale-row" aria-hidden="true">{[0, 25, 50, 75, 100].map(v => <span key={v}>{v}</span>)}</div>
    <div className="bp-nudges">{[-5, -1, 1, 5].map(d => <button key={d} type="button" disabled={pending} onClick={() => push(value + d)} aria-label={`${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)}`}>{d > 0 ? `+${d}` : `−${-d}`}</button>)}</div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={pending} onClick={() => void lock()}>{pending ? 'Locking…' : `Lock in ${value}%`}</ArcadeButton></div>
  </div>;
}

function GuessPhone(props: Phone) {
  const { view, me, players, now } = props, q = view.q!, agent = find(players, q.agent);
  const shell = { ...shellOf(props), eyebrow: eyebrow(view), timer: { ...span(view), now } };
  const label = <>What % said yes? · {plural(q.respondents ?? 0, 'answer')}</>;
  if (me.role === 'agent') return q.locked
    ? <PhoneShell {...shell} title={`Locked at ${q.dial}%`}><PhoneDone title="Estimate filed" detail="Now the room bets on you. Higher? Lower?" /><Said me={me} /></PhoneShell>
    : <PhoneShell {...shell} title="You’re the agent!">
      <Memo label={<>{label}{me.answer && <> · you said {me.answer}</>}</>} text={q.text} />
      <Dial {...props} />
    </PhoneShell>;
  return <PhoneShell {...shell} title={`${agent?.name ?? 'The agent'} is on the dial`}>
    <Memo label={label} text={q.text} />
    <div className="bp-mirror" role="status"><small>{q.locked ? 'Locked in' : 'Live estimate'}</small><b className="kp-numeral">{q.dial ?? '--'}<i>%</i></b>
      <span className="bp-mirror-bar"><i style={{ width: `${q.dial ?? 0}%` }} /></span></div>
    <Said me={me} />
    <p className="bp-cue">Get ready: higher or lower?</p>
  </PhoneShell>;
}

const ARROW: Record<Bet, string> = { 'much-higher': '▲▲', higher: '▲', lower: '▼', 'much-lower': '▼▼' };
function BetPhone(props: Phone) {
  const { view, me, players, now, send } = props, q = view.q!, guess = q.dial ?? 50, agent = find(players, q.agent), [state, run] = useSend();
  const shell = { ...shellOf(props), eyebrow: eyebrow(view), timer: { ...span(view), now } };
  if (me.role === 'agent') return <PhoneShell {...shell} title="The room is betting on you">
    <div className="bp-mirror"><small>Your guess</small><b className="kp-numeral">{guess}<i>%</i></b></div>
    <p className="bp-cue">{view.done.length} of {bettors(players, q.agent)} bets in. Keep a poker face.</p>
  </PhoneShell>;
  if (me.bet) return <PhoneShell {...shell} title={`${betCopy(me.bet, guess).label}!`}>
    <PhoneDone title="Bet placed" detail={`You bet the truth is ${betCopy(me.bet, guess).range}. Eyes on the TV!`} />
  </PhoneShell>;
  const list = (view.round > 1 ? ['much-higher', 'higher', 'lower', 'much-lower'] : ['higher', 'lower']) as Bet[];
  return <PhoneShell {...shell} title={`Higher or lower than ${guess}%?`}>
    <Memo label="What % said yes?" text={q.text} />
    <p className="bp-guessline">{agent && <Avatar avatar={agent.avatar} color={agent.color} size={44} />}<span><b>{agent?.name ?? 'The agent'}</b> guessed</span><b className="kp-numeral">{guess}%</b></p>
    <div className="bp-bets" role="radiogroup" aria-label="Your bet" data-much={view.round > 1 || undefined}>
      {list.map(bet => { const c = betCopy(bet, guess), ok = possible(bet, guess);
        return <button key={bet} type="button" role="radio" aria-checked={false} data-bet={bet} disabled={!ok || state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'bet', bet }))}>
          <span className="bp-arrow" aria-hidden="true">{ARROW[bet]}</span><span><b>{c.label}</b><small>{ok ? c.range : 'Off the scale'}</small></span>
          {bet.startsWith('much') && <em>×2</em>}
        </button>; })}
    </div>
    {view.round > 1 && <p className="hj-note">Long shots pay double, but only if the truth is more than {MUCH} points away.</p>}
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
  </PhoneShell>;
}

function RevealPhone(props: Phone) {
  const { view, me, player, players, now } = props, r = view.result!, scored = useTimeline(view.at, [REVEAL.score], now) > 0, gain = r.gains[player.id];
  const bet = me.bet ?? r.bets[player.id], agent = me.role === 'agent';
  const title = !scored ? 'The truth is…' : agent ? (r.tier >= 0 ? TIERS[r.tier]!.label : 'Way off!') : !bet ? 'No bet placed' : gain ? 'Cashed in!' : 'Wrong way!';
  return <PhoneShell {...shellOf(props)} eyebrow={eyebrow(view)} title={title}>
    <div className="bp-result" data-won={(scored && !!gain) || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={124} mood={!scored ? 'thinking' : gain ? 'happy' : 'sad'} />
      {scored ? <>
        <b className="bp-points kp-numeral" data-zero={!gain || undefined}>+{gain ?? 0}</b>
        <p>The truth: <b>{r.truth}%</b>. {agent ? (r.truth === r.guess ? 'Exactly right!' : `You were off by ${Math.abs(r.truth - r.guess)}.`) : bet ? `You bet ${betCopy(bet, r.guess).label.toLowerCase()} than ${r.guess}%.` : 'Bet next time!'}</p>
        <Standing view={view} players={players} player={player} />
      </> : <>
        <Memo label="What % said yes?" text={view.q!.text} />
        <p>{agent ? <>Your guess: <b>{r.guess}%</b></> : bet ? <>You bet <b>{betCopy(bet, r.guess).label.toLowerCase()}</b>: {betCopy(bet, r.guess).range}</> : 'No bet this time.'}</p>
        <p className="bp-cue">Eyes on the TV!</p>
      </>}
      <Said me={me} />
    </div>
  </PhoneShell>;
}

function ScoresPhone(props: Phone) {
  const { view, player, players } = props;
  return <PhoneShell {...shellOf(props)} eyebrow={`After round ${view.round}`} title="Debrief">
    <div className="bp-result"><Avatar avatar={player.avatar} color={player.color} size={124} mood={rankOf(view.scores, player.id, players.map(p => p.id)) === 1 ? 'happy' : 'idle'} />
      <Standing view={view} players={players} player={player} />
      <p className="hj-note">{view.round === 1 ? 'Round 2: long shots pay double. Plenty of time for a comeback!' : 'Next: Most Wanted, the final round.'}</p></div>
  </PhoneShell>;
}

/** Most Wanted lists: tick any (anonymous) or pick exactly three. Choices are a persisted draft until sent. */
function WantedList({ view, send, sessionKey, mode }: Phone & { mode: 'ticks' | 'picks' }) {
  const items = view.wanted?.items ?? [], [draft, setDraft] = useDraft<number[]>(`${sessionKey}:${view.turn}:${mode}`, []), [state, run] = useSend();
  const chosen = draft.filter(i => i >= 0 && i < items.length), max = mode === 'picks' ? WANTED_PICKS : items.length, pending = state.status === 'pending';
  const toggle = (i: number) => setDraft(chosen.includes(i) ? chosen.filter(x => x !== i) : chosen.length < max ? [...chosen, i] : max === 1 ? [i] : chosen);
  const label = mode === 'ticks' ? (chosen.length ? `File it · ${plural(chosen.length, 'tick')}` : 'None of these · file it') : `Lock in my ${WANTED_PICKS} (${chosen.length}/${WANTED_PICKS})`;
  return <>
    <ul className="bp-list" data-mode={mode} aria-label={mode === 'ticks' ? 'Statements that are true for you' : 'The room’s top three'}>
      {items.map((text, i) => { const on = chosen.includes(i), full = !on && chosen.length >= max;
        return <li key={i}><button type="button" className="bp-item" data-i={i} aria-pressed={on} data-on={on || undefined} disabled={pending || full} onClick={() => toggle(i)}>
          <span className="bp-box" aria-hidden="true">{on ? '✓' : ''}</span><span>{text}</span></button></li>; })}
    </ul>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={pending || (mode === 'picks' && chosen.length !== WANTED_PICKS)} onClick={() => void run(() => send({ turn: view.turn, k: mode, [mode]: [...chosen].sort((a, b) => a - b) }))}>{pending ? 'Sending…' : label}</ArcadeButton></div>
  </>;
}

function WantedPhone(props: Phone) {
  const { view, me, players, now } = props, w = view.wanted!, tick = view.phase === 'tick';
  const shell = { ...shellOf(props), eyebrow: `Most Wanted · ${w.title}`, timer: { ...span(view), now } };
  const filed = tick ? me.ticks : me.picks, waiting = players.filter(p => p.connected && !view.done.includes(p.id));
  if (filed) return <PhoneShell {...shell} title={tick ? 'Confession filed!' : 'Picks locked!'}>
    <PhoneDone title={tick ? plural(filed.length, 'tick') : 'Your top three'} detail={tick ? 'Anonymous: only the totals go on the TV.' : 'Watch the posters for the big reveal.'}>
      {!tick && <ul className="bp-mine">{filed.map(i => <li key={i}>{w.items[i]}</li>)}</ul>}
    </PhoneDone>
    {waiting.length > 0 && <PhoneWaiting title="Waiting on the others" waitingFor={waiting} lines={WAIT_LINES} />}
  </PhoneShell>;
  return <PhoneShell {...shell} title={tick ? 'Tick what’s true for you' : `Pick the room’s top ${WANTED_PICKS}`}>
    <p className="bp-lock-note">{tick ? <><span aria-hidden="true">🔒</span> <b>Anonymous.</b> Tick as many or as few as you like.</> : <>Which {WANTED_PICKS} did the most people tick? #1 pays {WANTED_POINTS[0]}.</>}</p>
    <WantedList {...props} key={view.turn} mode={tick ? 'ticks' : 'picks'} />
  </PhoneShell>;
}

function WantedResultPhone(props: Phone) {
  const { view, me, player, players, now } = props, w = view.wanted!, r = w.result!, b = wantedBeats(w.items.length);
  const done = useTimeline(view.at, [b.totals], now) > 0, gain = r.gains[player.id] ?? 0, hits = (me.picks ?? []).filter(i => r.ranks[i]! >= 1 && r.ranks[i]! <= WANTED_POINTS.length).length;
  return <PhoneShell {...shellOf(props)} eyebrow={`Most Wanted · ${w.title}`} title={!done ? 'Counting the ticks…' : gain ? `${plural(hits, 'hit')}!` : 'No hits this time'}>
    <div className="bp-result" data-won={(done && gain > 0) || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={124} mood={!done ? 'thinking' : gain ? 'happy' : 'sad'} />
      {done ? <><b className="bp-points kp-numeral" data-zero={!gain || undefined}>+{gain}</b><Standing view={view} players={players} player={player} /></> : <p className="bp-cue">Eyes on the posters!</p>}
      {me.picks && <ul className="bp-mine">{me.picks.map(i => <li key={i}>{w.items[i]}</li>)}</ul>}
    </div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Stand by, agent" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-ballpark bp-phone">
    {view.phase === 'survey' && view.q ? <SurveyPhone {...phone} />
      : view.phase === 'guess' && view.q ? <GuessPhone {...phone} />
      : view.phase === 'bet' && view.q ? <BetPhone {...phone} />
      : view.phase === 'reveal' && view.result ? <RevealPhone {...phone} />
      : view.phase === 'scores' ? <ScoresPhone {...phone} />
      : view.phase === 'wanted' && view.wanted?.result ? <WantedResultPhone {...phone} />
      : view.wanted ? <WantedPhone {...phone} /> : null}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
