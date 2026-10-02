/* Bracket Brawl screens: a neon arena broadcast on the TV (jumbotron, the full bracket, a ticker) and the phone controller. */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, AvatarStack, BigTitle, Confetti, PhoneChoices, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting,
  PlayerStrip, Scoreboard, Timer, Trophy, fitText, ordinal, rankOf, useNow, useTimeline,
} from '../../core/ui';
import {
  BRACKETS, CHAMP, KIND_NAMES, KINDS, MAX_ANSWER, PTS, TWIST, resultBeats, roundName, seedOf, showBeats, weight,
  type Bout, type BrawlPrivate, type BrawlPublic, type Kind, type Slot,
} from './types';
import './styles.css';

type P = MiniViewProps<BrawlPublic, BrawlPrivate>;
type Phone = P & { me: BrawlPrivate; player: PackPlayer };
const ACCENT = '#c8ff2e';
const find = (players: readonly PackPlayer[], id: string | undefined) => id ? players.find(p => p.id === id) : undefined;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const slotOf = (view: BrawlPublic, id: string | null | undefined) => view.entries.find(e => e.id === id);
const liveBout = (view: BrawlPublic) => view.match ? view.bouts[view.round - 1]?.[view.match.index] : undefined;
/** Matchups decided so far, oldest first. The live one waits for its verdict beat, so nothing on screen spoils it. */
const decidedBouts = (view: BrawlPublic) => { const live = liveBout(view); return view.bouts.flat().filter(b => b.winner !== undefined && b !== live); };
const CORNERS = ['Blue corner', 'Red corner'] as const;
const KIND_RULES: Record<Kind, string> = {
  standard: 'Write an answer. It enters the bracket.',
  blind: 'Answer the category. The real prompt is a secret!',
  smackdown: 'New question each round. Votes count double!',
};
const WAIT_LINES = [
  'Stretch. Brawling is a contact sport.', 'Practise your victory lap.', 'Pick a walk-out song. Hum it quietly.', 'Act like you didn’t write the weird one.',
  'Trash talk is free. Use it wisely.', 'Champions hydrate.', 'Somewhere, a trophy is waiting for you.', 'Rehearse a humble post-match interview.',
];

// ---------- TV: arena dressing ----------

/** Stadium lights, truss, a neon floor grid and a crowd with phone flashes, full bleed behind the broadcast. */
function Arena() {
  return <div className="bb-arena" aria-hidden="true">
    <div className="bb-truss">{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div>
    <div className="bb-rays" />
    <div className="bb-grid" />
    <svg className="bb-crowd" viewBox="0 0 1920 160" preserveAspectRatio="none">
      <path d={`M0 160V${Array.from({ length: 49 }, (_, i) => `${i ? 'L' : ''}${i * 40} ${78 + ((i * 37) % 23)} Q${i * 40 + 20} ${44 + ((i * 53) % 29)} ${i * 40 + 40} ${78 + (((i + 1) * 37) % 23)}`).join(' ')}V160Z`} />
      <path className="bb-crowd-back" d={`M0 160V${Array.from({ length: 65 }, (_, i) => `${i ? 'L' : ''}${i * 30} ${100 + ((i * 29) % 17)} Q${i * 30 + 15} ${76 + ((i * 41) % 21)} ${i * 30 + 30} ${100 + (((i + 1) * 29) % 17)}`).join(' ')}V160Z`} />
    </svg>
    <div className="bb-flashes">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 47 + 13) % 100}%`, bottom: `${8 + (i * 31) % 70}px`, animationDelay: `${(i * 0.73) % 5}s` }} />)}</div>
  </div>;
}

const Bolt = ({ className = '' }: { className?: string }) => <svg className={`bb-bolt ${className}`} viewBox="0 0 40 64" aria-hidden="true"><path d="M26 2 4 36h14L12 62l24-36H22Z" /></svg>;

/** Broadcast bug: logo, LIVE light, bracket chip and a slot on the right (timer, match count). */
function Bug({ view, children }: { view: BrawlPublic; children?: ReactNode }) {
  return <header className="bb-bug">
    <span className="bb-logo kp-title"><Bolt />Bracket<em>Brawl</em></span>
    <span className="bb-live"><i />Live</span>
    <span className="bb-chip" data-kind={view.kind}>
      <small>Bracket</small><b className="kp-numeral">{view.bracket}<small>/{BRACKETS}</small></b>{KIND_NAMES[view.kind]}{view.kind === 'smackdown' && <em>Votes ×2</em>}
    </span>
    <span className="bb-bug-side">{children}</span>
  </header>;
}

/** Lower-third news ticker. Its scroll position comes from the server clock, so new items never make it jump. */
function Ticker({ view, players, now }: P) {
  const [delay] = useState(() => -(now() % 60000)), items = tickerItems(view, players);
  useNow(now, 1000);
  const line = items.map((text, i) => <span key={i}><i>◆</i>{text}</span>);
  return <footer className="bb-ticker" aria-hidden="true">
    <b className="bb-ticker-tag"><Bolt />Brawl wire</b>
    <div className="bb-ticker-window"><div className="bb-ticker-track" style={{ animationDelay: `${delay}ms` }}>{line}{line}</div></div>
  </footer>;
}
function tickerItems(view: BrawlPublic, players: readonly PackPlayer[]): string[] {
  const short = (text: string) => text.length > 34 ? `${text.slice(0, 32).trimEnd()}…` : text;
  const decided = decidedBouts(view), left = view.entries.length - decided.length;
  const outs = decided.slice(-4).map(b => slotOf(view, b.sides[1 - b.winner!])).map(e => `KO: “${short(e?.text ?? '')}” (${e?.house ? 'the House' : find(players, e?.by)?.name ?? 'someone'})`);
  const base = [`Bracket ${view.bracket} of ${BRACKETS}: ${KIND_NAMES[view.kind]}`, KIND_RULES[view.kind], 'Call the champion for bonus points', 'House answers fight for pride only'];
  if (view.phase === 'write') return [...base, 'Answers flooding the locker room', 'Keep it under 50 characters', 'Funny beats clever. Clever beats nothing.'];
  if (view.champ) return [`Champion crowned: “${short(slotOf(view, view.champ.entry)?.text ?? '')}”`, view.champ.oracles.length ? `${plural(view.champ.oracles.length, 'player')} called it` : 'Nobody called it', ...base];
  return [...(view.entries.length ? [`${left} answers still standing`] : []), ...outs, ...base, 'Ties are settled by coin flip. No appeals.'];
}

// ---------- TV: the bracket ----------

/** Wing geometry in stage px. Each wing holds half the bracket, round one on the outside, the finalist next to the centre. */
const WING = { w: 540, h: 812 } as const;
const COLS: Record<number, { w: readonly number[]; gap: number }> = { 3: { w: [200, 150, 130], gap: 30 }, 4: { w: [168, 124, 112, 100], gap: 12 } };
type Cell = { id: string | null; bout: Bout; side: 0 | 1; r: number; i: number };
/** Entrants of round `r` (0-based) on one wing, top to bottom. */
function column(view: BrawlPublic, wing: 0 | 1, r: number): Cell[] {
  const list = view.bouts[r] ?? [];
  if (r === view.rounds - 1) return list[0] ? [{ id: list[0].sides[wing], bout: list[0], side: wing, r, i: 0 }] : [];
  const half = list.length / 2;
  return list.slice(wing * half, (wing + 1) * half).flatMap((bout, k) => ([0, 1] as const).map(side => ({ id: bout.sides[side], bout, side, r, i: wing * half + k })));
}
/** How far the live match's reveal has got: 0 nothing, 1 the verdict is out, 2 the winner's line has lit up. */
type Reveal = { r: number; i: number; level: number } | null;
function cellState(view: BrawlPublic, c: Cell, reveal: Reveal): string {
  if (!c.id) return 'empty';
  if (view.champ?.entry === c.id) return 'champ';
  const live = !!view.match && c.r === view.round - 1 && c.i === view.match.index;
  if (c.bout.winner === undefined || (live && (reveal?.level ?? 0) < 1)) return live ? 'live' : 'idle';
  return c.bout.winner === c.side ? 'won' : 'out';
}

function Wing({ view, players, wing, reveal }: { view: BrawlPublic; players: readonly PackPlayer[]; wing: 0 | 1; reveal: Reveal }) {
  const geo = COLS[view.rounds] ?? COLS[3]!, xs = geo.w.map((_, c) => geo.w.slice(0, c).reduce((a, b) => a + b, 0) + c * geo.gap);
  const mx = (x: number) => wing ? WING.w - x : x, cols = Array.from({ length: view.rounds }, (_, r) => column(view, wing, r));
  const y = (k: number, n: number) => (k + .5) / n * WING.h;
  const lines: { d: string; lit: boolean; key: string }[] = [];
  cols.forEach((list, c) => list.forEach((cell, k) => {
    const x1 = xs[c]! + geo.w[c]!, state = cellState(view, cell, reveal);
    const live = reveal && cell.r === reveal.r && cell.i === reveal.i, lit = (state === 'won' || state === 'champ') && (!live || reveal!.level >= 2);
    const d = c < view.rounds - 1
      ? `M${mx(x1)} ${y(k, list.length)}H${mx(x1 + geo.gap / 2)}V${y(k >> 1, list.length / 2)}H${mx(xs[c + 1]!)}`
      : `M${mx(x1)} ${WING.h / 2}H${mx(WING.w)}`;
    lines.push({ d, lit, key: `${c}-${k}` });
  }));
  return <div className="bb-wing" data-wing={wing} style={{ width: WING.w, height: WING.h }}>
    <svg className="bb-lines" viewBox={`0 0 ${WING.w} ${WING.h}`} aria-hidden="true">
      {lines.map(l => <path key={l.key} d={l.d} data-lit={l.lit || undefined} />)}
    </svg>
    {cols.map((list, c) => list.map((cell, k) => {
      const slot = slotOf(view, cell.id), state = cellState(view, cell, reveal), w = geo.w[c]!, n = list.length, h = c === 0 && n >= 8 ? 86 : c === 0 ? 116 : 104;
      const author = find(players, slot?.by);
      return <div key={`${c}-${k}`} className="bb-slot" data-state={state} data-col={c} data-corner={state === 'live' ? cell.side : undefined}
        style={{ left: wing ? WING.w - xs[c]! - w : xs[c], top: y(k, n) - h / 2, width: w, height: h } as CSSProperties}>
        {slot ? <>
          <b className="bb-seed kp-numeral">{seedOf(slot.id)}</b>
          <p style={{ fontSize: c === 0 ? (n >= 8 ? 18 : 22) : view.rounds === 4 ? 15 : 17 }}>{slot.text}</p>
          {(author || slot.house) && (state === 'out' || (!!view.champ && c === 0)) && <span className="bb-slot-by">{author ? <Avatar avatar={author.avatar} color={author.color} size={c === 0 && n < 8 ? 40 : 32} mood={state === 'out' ? 'sad' : 'happy'} /> : <em>House</em>}</span>}
        </> : <span className="bb-slot-q" aria-hidden="true">?</span>}
      </div>;
    }))}
  </div>;
}

/** The whole bracket around a centre panel. Used from the twist to the champion. */
function BracketTV(props: P) {
  const { view, players, now } = props, b = liveBout(view);
  const beats = b?.winner !== undefined ? resultBeats(!!b.flip, view.round === view.rounds) : null;
  const level = useTimeline(view.at, view.phase === 'result' && beats ? [beats.verdict, beats.advance] : [Infinity], now);
  const reveal: Reveal = view.match ? { r: view.round - 1, i: view.match.index, level } : null;
  return <section className="bb-board" data-rounds={view.rounds}>
    <Wing view={view} players={players} wing={0} reveal={reveal} />
    <div className="bb-center">
      {view.phase === 'twist' ? <TwistHero {...props} />
        : view.phase === 'predict' ? <PredictHero {...props} />
        : view.phase === 'stage' ? <StageHero {...props} />
        : view.phase === 'champ' ? <ChampHero {...props} />
        : b ? <MatchHero {...props} bout={b} /> : null}
    </div>
    <Wing view={view} players={players} wing={1} reveal={reveal} />
  </section>;
}

/** The jumbotron frame every centre panel sits in. */
function Screen({ className = '', children, glow }: { className?: string; children: ReactNode; glow?: string }) {
  return <div className={`bb-screen ${className}`} style={glow ? { '--glow': glow } as CSSProperties : undefined}><i className="bb-bolts" aria-hidden="true" />{children}</div>;
}

function Question({ view, size = 34 }: { view: BrawlPublic; size?: number }) {
  if (view.kind === 'smackdown' && view.judge) return <div className="bb-question" data-judge>
    <small>Part 1 · {view.prompt}</small><p style={{ fontSize: fitText(view.judge, size + 6) }}>{view.judge}</p>
  </div>;
  const text = view.prompt ?? view.hint ?? '';
  return <div className="bb-question"><small>{view.kind === 'blind' && view.prompt ? `Answers to “${view.hint}”` : 'The prompt'}</small><p style={{ fontSize: fitText(text, size) }}>{text}</p></div>;
}

/** Predictions: the wings already list every seeded answer, so the jumbotron sells the bet. */
function PredictHero({ view, players, now }: P) {
  const done = players.filter(p => view.done.includes(p.id)), per = PTS.oracle * weight(view.kind);
  return <Screen className="bb-predict">
    <header className="bb-screen-head"><span className="kp-title">Call the champion!</span><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={92} /></header>
    <Question view={view} size={44} />
    <div className="bb-predict-main">
      <Trophy className="bb-predict-cup" />
      <p>{view.entries.length} answers. {plural(view.rounds, 'round')}. <b>One champion.</b></p>
      <p className="bb-predict-pay">Pick it on your phone: <b>+{per}</b> every round it wins{view.kind === 'smackdown' && ' (×2)'}</p>
    </div>
    <p className="bb-screen-foot"><span className="bb-picks-in"><b className="kp-numeral">{done.length}</b>/{players.length} picks in</span>{done.length > 0 && <AvatarStack players={done} size={44} max={10} mood="done" />}</p>
  </Screen>;
}

function TwistHero({ view, now }: P) {
  const shown = useTimeline(view.at, [TWIST.reveal], now) > 0;
  return <Screen className="bb-twist" glow="#ff3d7f">
    <p className="bb-twist-was">You were answering: <b>{view.hint}</b></p>
    {shown ? <div className="bb-twist-real" key="real"><span className="bb-stamp">Plot twist!</span><small>The real prompt</small><p style={{ fontSize: fitText(view.prompt ?? '', 64) }}>{view.prompt}</p></div>
      : <div className="bb-twist-real" data-hidden key="hidden"><span className="bb-classified">Classified</span></div>}
    {shown && <p className="bb-twist-hint"><span className="bb-arrow" aria-hidden="true">◀</span>Now read your answers again<span className="bb-arrow" aria-hidden="true">▶</span></p>}
  </Screen>;
}

function StageHero({ view }: P) {
  const name = roundName(view.round, view.rounds), matches = view.bouts[view.round - 1]?.length ?? 0, left = matches * 2;
  return <Screen className="bb-stage" glow={view.round === view.rounds ? '#ffd24a' : undefined}>
    <p className="bb-stage-kicker">{view.round === 1 ? 'And we’re underway!' : `${left} answers left standing`}</p>
    <BigTitle size={name.length > 12 ? 92 : 116}>{name}</BigTitle>
    <p className="bb-stage-sub">{plural(matches, 'matchup')} · winners advance</p>
    {view.kind === 'smackdown' && view.judge && <div className="bb-judge"><span className="bb-stamp">Part 2</span><small>This round, vote on…</small><p style={{ fontSize: fitText(view.judge, 50) }}>{view.judge}</p><em>Votes ×2</em></div>}
  </Screen>;
}

function Fighter({ slot, side, bout, tally, decided: done, players, visible }: { slot?: Slot; side: 0 | 1; bout: Bout; tally: boolean; decided: boolean; players: readonly PackPlayer[]; visible: boolean }) {
  const decided = done && bout.winner !== undefined, won = decided && bout.winner === side, author = find(players, slot?.by), votes = bout.votes?.[side] ?? 0;
  const total = (bout.votes?.[0] ?? 0) + (bout.votes?.[1] ?? 0);
  return <div className="bb-fighter" data-corner={side} data-state={decided ? won ? 'won' : 'out' : 'idle'} data-hidden={!visible || undefined}>
    <span className="bb-corner"><b className="bb-seed kp-numeral">{slot ? seedOf(slot.id) : '?'}</b>{CORNERS[side]}</span>
    {visible && slot ? <p style={{ fontSize: fitText(slot.text, 46) }}>{slot.text}</p> : <p className="bb-dots" aria-label="Coming up"><i /><i /><i /></p>}
    {tally && <div className="bb-tally"><i style={{ '--f': total ? votes / total : 0 } as CSSProperties} /><b className="kp-numeral">{votes}</b><small>{votes === 1 ? 'vote' : 'votes'}</small></div>}
    {decided && <span className="bb-verdict kp-title">{won ? 'Advances!' : 'K.O.'}</span>}
    {won && bout.flip && <span className="bb-toss">Won the coin toss</span>}
    {decided && !won && <span className="bb-unmask">{author ? <AvatarBadge player={author} size={46} mood="sad" /> : <em>House answer</em>}</span>}
  </div>;
}

function MatchHero({ view, players, now, bout }: P & { bout: Bout }) {
  const [a, b] = bout.sides.map(id => slotOf(view, id)), beats = showBeats(a?.text ?? '', b?.text ?? ''), voting = view.phase === 'vote';
  const shown = useTimeline(view.at, voting ? [beats.a, beats.b, beats.open] : [0, 0, 0], now);
  const rb = resultBeats(!!bout.flip, view.round === view.rounds), step = useTimeline(view.at, voting ? [Infinity] : [rb.tally, rb.flip, rb.verdict], now);
  const flipping = !voting && !!bout.flip && step >= 2, decided = step >= 3, total = (bout.votes?.[0] ?? 0) + (bout.votes?.[1] ?? 0);
  const count = view.bouts[view.round - 1]?.length ?? 1, winner = decided && bout.winner !== undefined ? slotOf(view, bout.sides[bout.winner]) : undefined;
  return <Screen className="bb-match" key={`${view.round}-${view.match?.index}`}>
    <header className="bb-screen-head">
      <span className="bb-match-name">{roundName(view.round, view.rounds)}{count > 1 && <small>Match {(view.match?.index ?? 0) + 1} of {count}</small>}</span>
      {voting ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={92} /> : <span className="bb-match-votes kp-numeral">{plural(total, 'vote')}</span>}
    </header>
    <Question view={view} />
    <div className="bb-bout">
      {([0, 1] as const).map(side => <Fighter key={side} slot={side ? b : a} side={side} bout={bout} tally={step >= 1} decided={decided} players={players} visible={!voting || shown > side} />)}
      <span className="bb-vs kp-title" aria-hidden="true">VS</span>
      {flipping && !decided && bout.winner !== undefined && <Coin side={bout.winner} at={view.at + rb.flip} now={now} />}
    </div>
    <p className="bb-screen-foot" role="status">
      {voting ? shown < 3 ? 'Read ’em and weep…' : <><b>Vote on your phone!</b> <span className="kp-numeral">{plural(view.match?.votes ?? 0, 'vote')} in</span></>
        : !decided ? (bout.flip ? total ? 'Dead even! Coin flip…' : 'No votes! Coin flip…' : 'The judges’ scorecards…')
        : <><b>“{winner?.text}”</b> {view.round === view.rounds ? 'wins the final!' : 'advances!'}</>}
    </p>
  </Screen>;
}

/** Tie-breaker coin: spins from the flip beat and lands on the winning corner's face just before the verdict. Offset by server time so a reload lands right. */
function Coin({ side, at, now }: { side: 0 | 1; at: number; now(): number }) {
  const [delay] = useState(() => Math.min(0, at - now()));
  return <div className="bb-coin" data-side={side} style={{ animationDelay: `${delay}ms` }} role="img" aria-label="Coin flip">
    <i className="bb-coin-face" data-face="0">A</i><i className="bb-coin-face" data-face="1">B</i>
  </div>;
}

function ChampHero({ view, players, now }: P) {
  const champ = view.champ!, slot = slotOf(view, champ.entry), author = find(players, champ.by);
  const step = useTimeline(view.at, [CHAMP.answer, CHAMP.author, CHAMP.oracles], now), oracles = champ.oracles.map(id => find(players, id)).filter(p => !!p);
  return <Screen className="bb-champ" glow="#ffd24a">
    <div className="bb-champ-cup"><Trophy className="bb-cup" /><span className="kp-title">Champion!</span></div>
    {step >= 1 && <p className="bb-champ-text" style={{ fontSize: fitText(slot?.text ?? '', 60) }}>“{slot?.text}”</p>}
    {step >= 2 && <div className="bb-champ-by">{author ? <><AvatarBadge player={author} size={96} mood="happy" /><b className="bb-plus kp-numeral">+{champ.bonus}</b></> : <><span className="bb-house kp-title">The House</span><small>No points. Just shame.</small></>}</div>}
    {step >= 3 && <div className="bb-oracles">{oracles.length
      ? <><span>Called it!</span><AvatarStack players={oracles} size={52} max={10} mood="happy" /><b className="bb-plus kp-numeral">+{champ.oracle}</b></>
      : <span>Nobody called it!</span>}</div>}
    {step >= 2 && <Confetti burst={champ.entry} count={author ? 120 : 50} />}
  </Screen>;
}

// ---------- TV: writing and scores ----------

/** Faint empty bracket behind the writing screen. */
const GhostBracket = () => <svg className="bb-ghost" viewBox="0 0 1792 560" aria-hidden="true">
  {[0, 1].map(w => { const m = (x: number) => w ? 1792 - x : x; return <g key={w}>{[0, 1, 2, 3].map(k => <path key={k} d={`M${m(0)} ${70 + k * 140}H${m(150)}V${140 + (k >> 1) * 280}H${m(300)}`} />)}{[0, 1].map(k => <path key={`s${k}`} d={`M${m(300)} ${140 + k * 280}H${m(420)}V280H${m(560)}`} />)}</g>; })}
</svg>;

function WriteTV({ view, players, vip, now }: P) {
  const blind = view.kind === 'blind', smack = view.kind === 'smackdown';
  return <section className="bb-write">
    <GhostBracket />
    <Screen className="bb-write-screen" glow={blind ? '#ff3d7f' : smack ? '#ffd24a' : undefined}>
      <p className="bb-write-kicker">{blind ? 'Blind bracket · answer the category' : smack ? 'Smackdown · part one' : 'Write an answer · it enters the bracket'}</p>
      <p className="bb-write-prompt" style={{ fontSize: fitText((blind ? view.hint : view.prompt) ?? '', 112) }}>{blind ? view.hint : view.prompt}</p>
      {blind && <div className="bb-classified-row"><span className="bb-classified">Real prompt: classified</span></div>}
      {smack && <p className="bb-write-note">Part two: a brand-new question every round. <b>Votes count double!</b></p>}
    </Screen>
    <div className="bb-write-row">
      <div className="bb-tally-big" role="status"><b className="kp-numeral">{view.done.length}<small>/{players.length}</small></b><span>ready to brawl<small>{view.size}-slot bracket · max {MAX_ANSWER} characters</small></span></div>
      <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={132} />
    </div>
    <PlayerStrip players={players} done={view.done} vip={vip} />
  </section>;
}

function ScoresTV({ view, players }: P) {
  const prev = view.prev ?? {}, gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains), next = KINDS[view.bracket];
  return <section className="bb-scores">
    <div className="bb-scores-side">
      <BigTitle kicker={`After bracket ${view.bracket}`} size={124}>Standings</BigTitle>
      <Trophy className="bb-scores-cup" />
      {next && <p className="bb-next">Next: <b>{KIND_NAMES[next]}</b><small>{KIND_RULES[next]}</small></p>}
    </div>
    <Scoreboard players={players} scores={view.scores} from={prev} delay={900} rowHeight={players.length > 8 ? 76 : 88} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-bracket-brawl bb-tv" data-phase={view.phase} data-kind={view.kind}>
    <Arena />
    <Bug view={view}>{view.phase === 'write' ? null : <span className="bb-bug-note">{view.phase === 'scores' ? `Bracket ${view.bracket} complete` : view.champ ? 'Champion crowned' : <><b className="kp-numeral">{view.entries.length - decidedBouts(view).length}</b> still standing</>}</span>}</Bug>
    {view.phase === 'write' ? <WriteTV {...props} /> : view.phase === 'scores' ? <ScoresTV {...props} /> : <BracketTV {...props} />}
    <Ticker {...props} />
  </div>;
}

// ---------- phone ----------

const Seed = ({ id }: { id: string }) => <b className="bb-seed kp-numeral">{seedOf(id)}</b>;

function Earned({ me, kind }: { me: BrawlPrivate; kind: Kind }) {
  return <p className="bb-earned"><span className="kp-numeral">+{me.earned}</span> this bracket{kind === 'smackdown' && ' (×2)'}<small>Only you can see this until the champion is crowned.</small></p>;
}

function WritePhone({ view, me, player, players, vip, now, send, sessionKey }: Phone) {
  const shell = { player, vip: vip === player.id, accent: ACCENT, timer: { deadline: view.deadline, now, total: view.deadline - view.at } };
  const open = me.answers.find(a => a.text === undefined), total = me.answers.length, kicker = `Bracket ${view.bracket} · ${KIND_NAMES[view.kind]}`;
  if (!open) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow={kicker} title={total > 1 ? 'Both answers are in!' : 'Answer locked in!'}>
      <PhoneDone title="Ready to brawl." detail="Your answer enters the bracket anonymously.">
        <ul className="bb-mine">{me.answers.map(a => <li key={a.slot}>{a.text}</li>)}</ul>
      </PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the stragglers" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  const label = view.kind === 'blind' ? <><small className="bb-label-tag">Category</small>{view.hint}</> : view.kind === 'smackdown' ? <><small className="bb-label-tag">Part 1</small>{view.prompt}</> : view.prompt;
  return <PhoneShell {...shell} eyebrow={total > 1 ? `${kicker} · answer ${open.slot + 1} of ${total}` : kicker}>
    {view.kind !== 'standard' && <p className="bb-rule" data-kind={view.kind}>{view.kind === 'blind' ? 'The real prompt is secret until everyone has answered. Just answer the category!' : 'Part 2 changes every round. Pick something that could win any fight.'}</p>}
    <PhoneTextEntry multiline label={label} draftKey={`${sessionKey}:${view.turn}:${open.slot}`} maxLength={MAX_ANSWER} placeholder={view.kind === 'standard' ? 'Make it funny…' : 'Answer the category…'}
      submitLabel={open.slot + 1 < total ? 'Lock it in · next answer' : 'Lock it in'} hint={total > 1 ? 'Your two answers start in opposite halves.' : undefined}
      onSubmit={text => send({ turn: view.turn, k: 'answer', slot: open.slot, text })} />
  </PhoneShell>;
}

function TwistPhone({ view, me, player, vip, now }: Phone) {
  const shown = useTimeline(view.at, [TWIST.reveal], now) > 0, mine = me.mine.map(id => slotOf(view, id)?.text).filter(Boolean);
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow={`Bracket ${view.bracket} · Blind`} title={shown ? 'Plot twist!' : 'Drumroll…'}>
    {shown ? <p className="bb-phone-prompt"><small>The real prompt</small>{view.prompt}</p> : <p className="bb-tv-cue">Eyes on the TV!</p>}
    {mine.length > 0 ? <div className="bb-yours"><small>{mine.length > 1 ? 'Your answers' : 'Your answer'}</small>{mine.map(t => <b key={t}>“{t}”</b>)}</div>
      : <p className="hj-note">The House answered for you this time.</p>}
  </PhoneShell>;
}

function PredictPhone({ view, me, player, vip, now, send }: Phone) {
  const shell = { player, vip: vip === player.id, accent: ACCENT, eyebrow: `Bracket ${view.bracket} · predictions`, timer: { deadline: view.deadline, now, total: view.deadline - view.at } };
  const per = PTS.oracle * weight(view.kind);
  if (me.pick) return <PhoneShell {...shell} title="Pick locked!">
    <PhoneDone title="Your champion:" detail={`+${per} every round it wins.`}><p className="bb-pick"><Seed id={me.pick} />{slotOf(view, me.pick)?.text}</p></PhoneDone>
  </PhoneShell>;
  return <PhoneShell {...shell} title="Who takes the title?">
    <p className="bb-hint-line">Tap the answer you think wins it all. <b>+{per}</b> for every round it wins.</p>
    <PhoneChoices className="bb-picks" label="Predict the champion"
      options={view.entries.map(e => ({ id: e.id, label: <><Seed id={e.id} /><span>{e.text}</span></>, ariaLabel: `Seed ${seedOf(e.id)}: ${e.text}`, ...(me.mine.includes(e.id) ? { detail: 'Your answer' } : {}) }))}
      onSubmit={([entry]) => send({ turn: view.turn, k: 'predict', entry })} />
  </PhoneShell>;
}

/** Where you stand in the bracket: your answers still alive and your pick. */
function Status({ view, me }: { view: BrawlPublic; me: BrawlPrivate }) {
  const out = (id: string) => { const e = slotOf(view, id); return !!(e?.by || e?.house) && view.champ?.entry !== id; };
  const alive = me.mine.filter(id => !out(id)).length;
  return <ul className="bb-status">
    <li data-good={alive > 0 || undefined}>{me.mine.length ? alive ? `${plural(alive, 'answer')} still standing` : 'Your answers are out. Vote for chaos!' : 'The House answered for you.'}</li>
    {me.pick && <li data-good={!out(me.pick) || undefined}><Seed id={me.pick} /><span>Your pick “{slotOf(view, me.pick)?.text}” {out(me.pick) ? 'is out' : 'is still alive'}</span></li>}
  </ul>;
}

function StagePhone({ view, me, player, vip }: Phone) {
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow={`Bracket ${view.bracket} · ${KIND_NAMES[view.kind]}`} title={roundName(view.round, view.rounds)}>
    {view.kind === 'smackdown' && view.judge && <p className="bb-phone-prompt" data-judge><small>This round, vote on</small>{view.judge}</p>}
    <Status view={view} me={me} />
    <p className="bb-tv-cue">Eyes on the TV!</p>
  </PhoneShell>;
}

function VotePhone({ view, me, player, vip, now, send }: Phone) {
  const bout = liveBout(view)!, sides = bout.sides.map(id => slotOf(view, id)), count = view.bouts[view.round - 1]!.length;
  const shell = { player, vip: vip === player.id, accent: ACCENT, eyebrow: `${roundName(view.round, view.rounds)}${count > 1 ? ` · match ${view.match!.index + 1} of ${count}` : ''}`, timer: { deadline: view.deadline, now, total: view.deadline - view.at } };
  const question = view.kind === 'smackdown' && view.judge ? view.judge : view.prompt;
  if (me.role === 'author') {
    const mine = sides.filter(s => s && me.mine.includes(s.id));
    return <PhoneShell {...shell} title="You’re in this one!">
      <div className="bb-phone-up"><Avatar avatar={player.avatar} color={player.color} size={120} mood="happy" />
        {mine.map(s => <p key={s!.id} className="bb-phone-bubble">{s!.text}</p>)}
        <p className="hj-note">{mine.length > 1 ? 'Both sides are yours! Sit back and enjoy.' : 'No voting in your own matchup. Look innocent.'}</p></div>
    </PhoneShell>;
  }
  const voted = me.vote !== undefined;
  return <PhoneShell {...shell} title={voted ? 'Vote locked in!' : 'Which wins?'}>
    <p className="bb-phone-prompt" data-judge={view.kind === 'smackdown' || undefined}>{question}{view.kind === 'smackdown' && <em>Votes ×2</em>}</p>
    <PhoneChoices className="bb-vote" label="Pick the winner" picked={voted ? [String(me.vote)] : null} locked={voted}
      options={sides.map((s, i) => ({ id: String(i), label: <><span className="bb-corner-tag">{CORNERS[i]}</span><span>{s?.text}</span></>, ariaLabel: `${CORNERS[i]}: ${s?.text}`, color: i ? '#ff3d7f' : '#2de2ff' }))}
      onSubmit={([side]) => send({ turn: view.turn, k: 'vote', side: Number(side) })} />
  </PhoneShell>;
}

/** The decided matchup on the phone: both corners with their votes, the winner lit, yours tagged. */
function Recap({ view, bout, me }: { view: BrawlPublic; bout: Bout; me: BrawlPrivate }) {
  return <ul className="bb-recap">{([0, 1] as const).map(side => {
    const s = slotOf(view, bout.sides[side]);
    return <li key={side} data-corner={side} data-won={bout.winner === side || undefined}>
      <span className="bb-corner-tag">{CORNERS[side]}{s && me.mine.includes(s.id) && ' · yours'}{bout.winner === side && (bout.flip ? ' · won the toss' : ' · advances')}</span>
      <b>{s?.text}</b><em className="kp-numeral">{bout.votes?.[side] ?? 0}</em>
    </li>;
  })}</ul>;
}

function ResultPhone({ view, me, player, vip, now }: Phone) {
  const bout = liveBout(view)!, beats = resultBeats(!!bout.flip, view.round === view.rounds), out = useTimeline(view.at, [beats.verdict], now) > 0;
  const won = bout.winner === undefined ? undefined : bout.sides[bout.winner], mine = me.role === 'author' ? bout.sides.filter(id => id && me.mine.includes(id)) : [];
  const title = !out ? (bout.flip ? 'Coin flip!' : 'And the winner is…')
    : mine.length ? (mine.includes(won!) ? (mine.length > 1 ? 'You beat yourself!' : 'You advance!') : 'Knocked out!')
    : me.vote === undefined ? 'The room has spoken.' : me.vote === bout.winner ? 'Your side won!' : 'Upset!';
  const gain = mine.includes(won!) ? PTS.win * view.round * weight(view.kind) : 0;
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow={roundName(view.round, view.rounds)} title={title}>
    <div className="bb-phone-result" data-won={(out && gain > 0) || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={104} mood={!out ? 'thinking' : mine.length ? (gain ? 'happy' : 'sad') : 'idle'} />
      {out && gain > 0 && <b className="bb-phone-points kp-numeral">+{gain}</b>}
      {out ? <Recap view={view} bout={bout} me={me} /> : <p className="bb-tv-cue">Eyes on the TV!</p>}
      {out && me.pick === won && <p className="bb-good">Your champion pick wins again! +{PTS.oracle * weight(view.kind)}</p>}
    </div>
    {out && me.earned > 0 && <Earned me={me} kind={view.kind} />}
  </PhoneShell>;
}

function ChampPhone({ view, player, players, vip, now }: Phone) {
  const champ = view.champ!, step = useTimeline(view.at, [CHAMP.author, CHAMP.oracles], now), crowned = step >= 1 && champ.by === player.id, oracle = champ.oracles.includes(player.id);
  const title = step < 1 ? 'Crowning the champion…' : crowned ? 'CHAMPION!' : oracle && step >= 2 ? 'You called it!' : 'That’s the bracket!';
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow={`Bracket ${view.bracket} of ${BRACKETS}`} title={title}>
    <div className="bb-phone-result" data-won={(crowned || (oracle && step >= 2)) || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={120} mood={step < 1 ? 'thinking' : crowned || oracle ? 'happy' : 'idle'} />
      {crowned && <b className="bb-phone-points kp-numeral">+{champ.bonus}</b>}
      {step >= 1 && <p className="bb-champ-line"><small>Champion</small>“{slotOf(view, champ.entry)?.text}”{champ.house && <em>House answer</em>}</p>}
      {step >= 2 && oracle && <p className="bb-good">Your prediction paid +{champ.oracle}</p>}
      {step >= 1 && <p>Bracket total: <b className="kp-numeral">+{(view.scores[player.id] ?? 0) - (view.prev?.[player.id] ?? 0)}</b></p>}
      {step >= 1 && <p className="bb-standing"><b className="kp-title">{ordinal(rankOf(view.scores, player.id, players.map(p => p.id)))}</b> place overall</p>}
    </div>
  </PhoneShell>;
}

function ScoresPhone({ view, player, players, vip }: Phone) {
  const next = KINDS[view.bracket], rank = rankOf(view.scores, player.id, players.map(p => p.id));
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow={`After bracket ${view.bracket}`} title="Standings">
    <div className="bb-phone-result"><Avatar avatar={player.avatar} color={player.color} size={120} mood={rank === 1 ? 'happy' : 'idle'} />
      <p className="bb-standing"><b className="kp-title">{ordinal(rank)}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>
      {next && <p className="hj-note">Next up: <b>{KIND_NAMES[next]}</b>. {KIND_RULES[next]}</p>}</div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = find(players, playerId ?? undefined);
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the brawl!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-bracket-brawl bb-phone">
    {view.phase === 'write' ? <WritePhone {...phone} />
      : view.phase === 'twist' ? <TwistPhone {...phone} />
      : view.phase === 'predict' ? <PredictPhone {...phone} />
      : view.phase === 'stage' ? <StagePhone {...phone} />
      : view.phase === 'vote' ? <VotePhone {...phone} />
      : view.phase === 'result' ? <ResultPhone {...phone} />
      : view.phase === 'champ' ? <ChampPhone {...phone} />
      : <ScoresPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
