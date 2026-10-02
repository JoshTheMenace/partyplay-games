/* Quiz Panic screens: the Hotel Hijinks TV (trivia, Panic Room, Escape the Hotel) and the phone controller. */
import type { CSSProperties, ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarStack, BigTitle, Callout, Confetti, PhoneChoices, PhoneDone, PhoneShell, PhoneWaiting, Timer, fitText, useDraft, useSend, useTimeline, type Mood,
} from '../../core/ui';
import { Candle, Cobweb, Coin, Concierge, Cup, Door, Ghoul, MemorySymbol } from './art';
import {
  ANSWER, CHALLENGES, EXIT, FINAL, FINAL_TURNS, LONE_PRIZE, ROOM_NAMES, SCRAMBLE_TRIES, SEQUENCE, SYMBOLS, SYMBOL_NAMES, letter, panicBeats,
  type Kind, type QuizPrivate, type QuizPublic, type Side,
} from './types';
import './styles.css';

type P = MiniViewProps<QuizPublic, QuizPrivate>;
type Phone = P & { me: QuizPrivate; player: PackPlayer; ghost: boolean };
const ACCENT = '#4ff0a0', GHOST = '#c9ffe4';
const OPTION_COLORS = ['var(--kp-sun)', 'var(--kp-sky)', 'var(--kp-coral)', 'var(--kp-grape)'];
const cash = (n: number) => `$${n.toLocaleString('en-US')}`;
const find = (players: readonly PackPlayer[], id: string) => players.find(p => p.id === id);
const pick = (players: readonly PackPlayer[], ids: readonly string[]) => ids.map(id => find(players, id)).filter((p): p is PackPlayer => !!p);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (ps: readonly PackPlayer[]) => ps.length <= 2 ? ps.map(p => p.name).join(' & ') : `${ps.slice(0, -1).map(p => p.name).join(', ')} & ${ps.at(-1)!.name}`;
const ghostly = (p: PackPlayer, ghost: boolean): PackPlayer => ghost ? { ...p, color: GHOST } : p;

const SPOOKY_LINES = [
  'The wallpaper is watching. Act natural.', 'Room service will be with you shortly. Probably.', 'Do not feed the ghoul after midnight.',
  'Checkout is at 11. Escape is optional.', 'That creak was the plumbing. Definitely the plumbing.', 'Rate your stay: one star or one skull?',
  'The lift only goes down. Nobody knows why.', 'Mr Grimsby says hello. Mr Grimsby is right behind you.',
];
const WAITS: Record<Kind, string> = { poison: 'Bottoms up…', math: 'Marking the homework…', memory: 'Checking your memory…', hide: 'The ghoul is searching…', scramble: 'Checking the spelling…', coin: 'Fate has spoken…' };
const GHOST_LINES = ['You are a ghost now. Rattle something.', 'Being dead has perks: no rent.', 'Haunt responsibly.', 'Ghosts still earn cash. Spooky capitalism!', 'Practise your best “Wooooo”.'];

// ---------- shared TV pieces ----------

/** Damask wallpaper, wainscot, candles in sconces, cobwebs and floor fog behind every TV screen. */
const Hotel = ({ alarm }: { alarm?: boolean }) => <div className="qp-hotel" data-alarm={alarm || undefined} aria-hidden="true">
  <i className="qp-wainscot" /><Cobweb className="qp-web-l" /><Cobweb className="qp-web-r" />
  <span className="qp-sconce qp-sconce-l"><Candle /></span><span className="qp-sconce qp-sconce-r"><Candle /></span><i className="qp-fog" />
</div>;

function Sign({ children, side }: { children?: ReactNode; side?: ReactNode }) {
  return <header className="qp-head">
    <span className="qp-sign kp-title">Quiz <em>Panic</em></span>
    {children && <span className="qp-chip">{children}</span>}
    <span className="qp-head-side">{side}</span>
  </header>;
}
const Clock = ({ view, now }: { view: QuizPublic; now: () => number }) => <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={124} />;

/** A player's character; ghosts glow mint, fade at the hem and float. */
function Face({ player, ghost, size = 72, mood = 'idle', crown }: { player: PackPlayer; ghost?: boolean; size?: number; mood?: Mood; crown?: boolean }) {
  return <span className="qp-face" data-ghost={ghost || undefined}>
    <Avatar avatar={player.avatar} color={ghost ? GHOST : player.color} mood={mood} size={size} crown={crown} label={ghost ? `${player.name} (ghost)` : player.name} />
  </span>;
}

/** The guest list: everyone (or a cast) with ghost state, money, done lights and an optional mark. */
function Guests({ players, ghost, money, done, vip, marks, moods, size }: {
  players: readonly PackPlayer[]; ghost(id: string): boolean; money?: Record<string, number>; done?: readonly string[]; vip?: string | null;
  marks?: Record<string, ReactNode>; moods?: Record<string, Mood>; size?: number;
}) {
  const small = players.length <= 3, px = size ?? (players.length > 8 ? 74 : players.length > 5 ? 88 : small ? 108 : 104), base = small ? 28 : 24;
  return <ol className="qp-guests" data-n={players.length}>{players.map(p => {
    const lit = done?.includes(p.id), g = ghost(p.id), fit = Math.floor((small ? 270 : 150) / .62 / Math.max(...p.name.split(' ').map(w => w.length)));
    return <li key={p.id} data-lit={lit || undefined} data-ghost={g || undefined} data-offline={!p.connected || undefined} style={{ '--c': g ? GHOST : p.color } as CSSProperties}>
      <Face player={p} ghost={g} size={px} crown={vip === p.id} mood={!p.connected ? 'sad' : moods?.[p.id] ?? (lit ? 'done' : done ? 'thinking' : 'idle')} />
      <b className="hj-name" style={fit < base ? { fontSize: fit } : undefined}>{p.name}</b>
      {money && <span className="qp-cash kp-numeral">{cash(money[p.id] ?? 0)}</span>}
      {!p.connected ? <small>Offline</small> : marks?.[p.id] !== undefined && <em className="qp-mark kp-numeral">{marks[p.id]}</em>}
    </li>;
  })}</ol>;
}

// ---------- trivia ----------

function QuestionTV({ view, players, vip, now }: P) {
  const q = view.question!, a = view.answer, step = useTimeline(view.at, a ? [ANSWER.picks, ANSWER.correct, ANSWER.money, ANSWER.doom] : [Infinity], now);
  const ghost = (id: string) => view.ghosts.includes(id), look = (p: PackPlayer) => ghostly(p, ghost(p.id));
  const marks: Record<string, ReactNode> = {}, moods: Record<string, Mood> = {};
  if (a && step >= 1) for (const p of players) {
    const mine = a.picks[p.id], earned = a.earned[p.id];
    marks[p.id] = step >= 3 && earned ? `+${cash(earned)}` : mine === undefined ? '—' : letter(mine);
    if (step >= 2) moods[p.id] = mine === a.correct ? 'happy' : 'sad';
  }
  const money = a && step < 3 ? Object.fromEntries(players.map(p => [p.id, (view.money[p.id] ?? 0) - (a.earned[p.id] ?? 0)])) : view.money;
  const right = a ? players.filter(p => a.picks[p.id] === a.correct) : [], lone = a && Object.values(a.earned).includes(LONE_PRIZE), doomed = a ? pick(players, a.doomed) : [];
  return <section className="qp-question" data-phase={view.phase}>
    <Sign side={view.phase === 'question' && <Clock view={view} now={now} />}>Question <b className="kp-numeral">{view.q}</b> of {view.total}</Sign>
    <div className="qp-q-main">
      <Concierge className={step >= 2 && a && !right.length ? 'qp-gloat' : ''} />
      <div className="qp-card" key={view.q}>
        <span className="qp-cat">{q.category}</span>
        <p style={{ fontSize: fitText(q.text, 68) }}>{q.text}</p>
      </div>
    </div>
    <ol className="qp-options">{q.options.map((o, i) => {
      const state = !a || step < 2 ? 'idle' : i === a.correct ? 'right' : 'wrong', who = a && step >= 1 ? players.filter(p => a.picks[p.id] === i).map(look) : [];
      return <li key={i} data-state={state} style={{ '--o': OPTION_COLORS[i], animationDelay: `${200 + i * 120}ms` } as CSSProperties}>
        <span className="qp-letter kp-title">{letter(i)}</span><span className="qp-option-text" style={{ fontSize: fitText(o, 50) }}>{o}</span>
        {who.length > 0 && <AvatarStack className="qp-pickers" players={who} size={60} max={5} />}
      </li>;
    })}</ol>
    <p className="qp-foot" role="status">{!a ? <>Lock in your answer on your phone. <b className="kp-numeral">{view.done.length}/{players.length}</b> locked in</>
      : step < 2 ? 'Let’s see who checks out…'
      : !right.length ? <b className="qp-bad">Nobody got it! The hotel is delighted.</b>
      : <><b>{plural(right.length, 'guest')}</b> got it right{lone && step >= 3 ? <span className="qp-lone">Lone genius · ×1.5!</span> : null}</>}</p>
    <Guests players={players} ghost={ghost} money={money} done={a ? undefined : view.done} vip={vip} marks={marks} moods={moods} />
    {step >= 4 && doomed.length > 0 && <div className="qp-doom" role="status">
      <Callout tone="coral">To the Panic Room!</Callout>
      <div className="qp-doom-row">{doomed.map(p => <span key={p.id} className="qp-doomed"><Face player={p} size={doomed.length > 6 ? 100 : 130} mood="sad" /><b className="hj-name">{p.name}</b></span>)}</div>
    </div>}
  </section>;
}

// ---------- Panic Room ----------

function KindArt({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'poison': return <div className="qp-art-cups"><Cup n={1} /><Cup n={2} poison /><Cup n={3} /></div>;
    case 'math': return <div className="qp-chalk qp-chalk-art kp-numeral"><span>7 + 8 = ?</span><span>21 − 9 = ?</span><span>6 × 4 = ?</span></div>;
    case 'memory': return <div className="qp-art-symbols">{[0, 3, 1, 5, 4].map((s, i) => <MemorySymbol key={i} i={s} size={124} />)}</div>;
    case 'hide': return <div className="qp-art-doors"><Door /><Door open><Ghoul /></Door><Door /></div>;
    case 'scramble': return <div className="qp-tiles qp-art-tiles">{[...'TOGSH'].map((c, i) => <span key={i} className="qp-tile kp-title">{c}</span>)}</div>;
    case 'coin': return <div className="qp-art-coin"><Coin side="H" /></div>;
  }
}

function PanicIntroTV({ view, players }: P) {
  const p = view.panic!, info = CHALLENGES[p.kind], doomed = pick(players, p.doomed), poisoners = pick(players, p.poisoners ?? []);
  return <section className="qp-panic-intro">
    <Sign>After question <b className="kp-numeral">{view.q}</b></Sign>
    <div className="qp-intro-main">
      <div className="qp-intro-art"><KindArt kind={p.kind} /></div>
      <div className="qp-intro-copy">
        <p className="qp-siren kp-title">Panic Room!</p>
        <BigTitle size={124}>{info.name}</BigTitle>
        <p className="qp-blurb">{info.blurb}</p>
        {p.kind === 'poison' && <p className="qp-sub">{poisoners.length ? <><b>{names(poisoners)}</b> {poisoners.length === 1 ? 'spikes' : 'spike'} the cups first.</> : 'Nobody is safe, so the ghoul spikes a cup himself.'}</p>}
      </div>
      <Concierge className="qp-gloat-loop" />
    </div>
    <div className="qp-cast"><h3>{doomed.length === 1 ? 'Doomed guest' : `${doomed.length} doomed guests`}</h3>
      <div className="qp-doom-row">{doomed.map(d => <span key={d.id} className="qp-doomed"><Face player={d} size={doomed.length > 6 ? 96 : 120} mood="sad" /><b className="hj-name">{d.name}</b></span>)}</div></div>
  </section>;
}

/** Live stage of a challenge: the prop on the left, the instruction and the cast with done lights. */
function PanicTV({ view, players, now }: P) {
  const p = view.panic!, info = CHALLENGES[p.kind], st = p.stage;
  const cast = pick(players, st === 'poison' ? p.poisoners ?? [] : p.doomed), ghost = (id: string) => view.ghosts.includes(id);
  const shown = useTimeline(view.at, Array.from({ length: SEQUENCE }, (_, i) => 300 + i * 450), now), landed = useTimeline(view.at, [1700], now) > 0;
  const flips = p.flips ?? [], flip = flips.at(-1);
  const say = st === 'poison' ? 'Survivors: secretly poison one cup on your phone.' : st === 'drink' ? 'Doomed guests: pick a cup. Bottoms up!'
    : st === 'memorize' ? 'Memorise these five symbols!' : st === 'recall' ? 'Tap the symbols back in order on your phone.'
    : st === 'hide' ? 'Pick a room to hide in. The ghoul is coming…' : st === 'call' ? `Call it! Flip ${(p.flips?.length ?? 0) + 1} of 3.`
    : st === 'flip' ? (landed ? `${flip === 'H' ? 'Heads' : 'Tails'}! Right calls light up below.` : 'The coin is in the air…') : p.kind === 'math' ? 'Solve all three sums on your phone. One slip and you’re toast.' : 'Unscramble your secret word. Three tries.';
  // Coin marks come from the landed flips only, so the guest list never spoils a coin that is still spinning.
  const seen = st === 'flip' && !landed ? flips.length - 1 : flips.length, coinMarks: Record<string, ReactNode> = {};
  if (p.kind === 'coin') for (const id of p.doomed) {
    const calls = (p.calls?.[id] ?? []).slice(0, seen), wins = calls.filter((c, i) => c === flips[i]).length;
    coinMarks[id] = wins >= 2 ? 'Safe!' : calls.length - wins >= 2 ? 'Out!' : calls.map((c, i) => c === flips[i] ? '✓' : '✗').join(' ') || '…';
  }
  return <section className="qp-panic" data-kind={p.kind} data-stage={st}>
    <Sign side={<Clock view={view} now={now} />}>{info.name}</Sign>
    <div className="qp-stage"><div className="qp-prop">
      {(st === 'poison' || st === 'drink') && <div className="qp-table">{Array.from({ length: p.cups ?? 0 }, (_, i) => <Cup key={i} n={i + 1} />)}</div>}
      {p.kind === 'math' && <div className="qp-chalk kp-numeral"><span>? + ? = ?</span><span>? − ? = ?</span><span>? × ? = ?</span></div>}
      {st === 'memorize' && <div className="qp-sequence">{p.sequence?.map((s, i) => i < shown ? <MemorySymbol key={i} i={s} size={220} label /> : <span key={i} className="qp-slot" />)}</div>}
      {st === 'recall' && <div className="qp-sequence">{Array.from({ length: SEQUENCE }, (_, i) => <span key={i} className="qp-slot kp-title">?</span>)}</div>}
      {st === 'hide' && <div className="qp-doors">{ROOM_NAMES.map(r => <div key={r} className="qp-room"><Door /><b>{r}</b></div>)}</div>}
      {p.kind === 'scramble' && <div className="qp-burn"><Candle className="qp-big-candle" /><div className="qp-tiles">{[...'SCRAMBLE'].map((c, i) => <span key={i} className="qp-tile kp-title" style={{ animationDelay: `${i * 90}ms` }}>{c}</span>)}</div></div>}
      {p.kind === 'coin' && <div className="qp-coin-stage" data-spin={(st === 'flip' && !landed) || undefined}>
        {st === 'flip' && flip ? (landed ? <><Coin side={flip} className="qp-landed" /><b className="kp-title">{flip === 'H' ? 'Heads!' : 'Tails!'}</b></> : <Coin side="H" className="qp-spinning" />) : <Coin side="H" className="qp-idle-coin" />}
      </div>}
    </div><div className="qp-host"><Concierge /><p className="qp-say">{say}</p></div></div>
    <Guests players={cast} ghost={ghost} done={st === 'memorize' || st === 'flip' ? undefined : view.done} marks={p.kind === 'coin' ? coinMarks : undefined} size={cast.length > 6 ? 84 : 112} />
  </section>;
}

/** Panic reveal: one beat per cup, searched room or doomed player, then the verdict (new ghosts appear). */
function PanicRevealTV({ view, players, now }: P) {
  const p = view.panic!, r = p.reveal!, beats = panicBeats(p.kind, p.kind === 'poison' ? p.cups ?? 0 : p.kind === 'hide' ? r.searched?.length ?? 0 : p.doomed.length);
  const step = useTimeline(view.at, [...beats.steps, beats.verdict], now), verdict = step > beats.steps.length;
  const doomed = pick(players, p.doomed), dead = pick(players, r.dead), isGhost = (id: string) => verdict && r.dead.includes(id);
  const row = (d: PackPlayer, i: number, body: ReactNode) => <li key={d.id} data-shown={step > i || undefined} data-dead={(step > i && r.dead.includes(d.id)) || undefined}>
    <Face player={d} ghost={isGhost(d.id)} size={doomed.length > 6 ? 64 : doomed.length > 3 ? 84 : 110} mood={step > i ? (r.dead.includes(d.id) ? 'sad' : 'happy') : 'thinking'} />
    <b className="hj-name">{d.name}</b><span className="qp-row-body">{step > i ? body : <span className="qp-pending" aria-label="Checking"><i /><i /><i /></span>}</span>
    {step > i && <em className={r.dead.includes(d.id) ? 'qp-tag-dead' : 'qp-tag-live'}>{r.dead.includes(d.id) ? 'Dead' : 'Lives!'}</em>}
  </li>;
  return <section className="qp-reveal" data-kind={p.kind}>
    <Sign>{CHALLENGES[p.kind].name}</Sign>
    <div className="qp-reveal-main">
      {p.kind === 'poison' && <div className="qp-table qp-table-reveal">{Array.from({ length: p.cups ?? 0 }, (_, c) => {
        const open = step > c, drinkers = doomed.filter(d => r.drinks?.[d.id] === c), poison = r.poisoned?.includes(c), spikers = pick(players, Object.keys(r.poisoners ?? {}).filter(id => r.poisoners![id] === c));
        return <div key={c} className="qp-cup-slot" data-open={open || undefined} data-poison={(open && poison) || undefined}>
          <div className="qp-drinkers">{drinkers.map(d => <Face key={d.id} player={d} ghost={isGhost(d.id)} size={drinkers.length > 3 ? 64 : drinkers.length > 1 ? 84 : 110} mood={open ? (poison ? 'sad' : 'happy') : 'thinking'} />)}</div>
          {drinkers.length > 0 && <small className="qp-drinker-names">{names(drinkers)}</small>}
          <Cup n={c + 1} poison={open && poison} />
          <b className="kp-title">{open ? (poison ? 'Poison!' : 'Just punch') : '…'}</b>
          {open && poison && spikers.length > 0 && <span className="qp-spikers"><small>Spiked by</small><AvatarStack players={spikers} size={52} max={4} /></span>}
        </div>;
      })}</div>}
      {p.kind === 'hide' && <div className="qp-doors qp-doors-reveal">{ROOM_NAMES.map((name, room) => {
        const at = r.searched?.indexOf(room) ?? -1, searched = at >= 0 && step > at, opened = searched || verdict, hiders = doomed.filter(d => r.rooms?.[d.id] === room);
        return <div key={name} className="qp-room" data-searched={searched || undefined}>
          <Door open={opened}>{searched && <Ghoul className="qp-ghoul-peek" />}{opened && hiders.map(d => <Face key={d.id} player={d} ghost={isGhost(d.id)} size={hiders.length > 3 ? 52 : hiders.length > 1 ? 64 : 84} mood={searched ? 'sad' : 'happy'} />)}</Door>
          <b>{name}</b>
        </div>;
      })}</div>}
      {p.kind === 'memory' && <div className="qp-sequence qp-sequence-small">{r.sequence?.map((s, i) => <MemorySymbol key={i} i={s} size={110} />)}</div>}
      {['math', 'memory', 'scramble', 'coin'].includes(p.kind) && <ol className="qp-rows" data-n={doomed.length}>{doomed.map((d, i) => row(d, p.kind === 'coin' ? -1 : i,
        p.kind === 'math' ? (r.sums?.[d.id] ?? []).map((x, k) => <span key={k} className="qp-sum kp-numeral" data-ok={x.given === x.answer || undefined}>{x.sum.a} {x.sum.op} {x.sum.b} = {x.given ?? '?'}</span>)
        : p.kind === 'memory' ? (r.attempts?.[d.id] ? r.attempts[d.id]!.map((s, k) => <span key={k} className="qp-attempt" data-ok={s === r.sequence?.[k] || undefined}><MemorySymbol i={s} size={doomed.length <= 3 ? 84 : 54} /></span>) : <i>No answer</i>)
        : p.kind === 'scramble' ? <span className="qp-word kp-title">{r.words?.[d.id]}</span>
        : <span className="qp-flips">{(p.flips ?? []).map((f, k) => { const c = p.calls?.[d.id]?.[k]; return c ? <span key={k} data-ok={c === f || undefined}><Coin side={f} /></span> : null; })}</span>))}</ol>}
    </div>
    <div className="qp-verdict" role="status">{!verdict ? <p className="qp-wait">{WAITS[p.kind]}</p> : (dead.length
      ? <><Callout tone="coral">{dead.length === doomed.length && doomed.length > 1 ? 'Nobody made it!' : dead.length === 1 ? 'A new ghost!' : `${dead.length} new ghosts!`}</Callout><p><b>{names(dead)}</b> {dead.length === 1 ? 'joins' : 'join'} the afterlife.</p></>
      : <><Callout tone="lime">{doomed.length === 1 ? 'Survived!' : 'Everyone survived!'}</Callout><p>The ghoul goes hungry. For now.</p></>)}</div>
  </section>;
}

// ---------- Escape the Hotel ----------

/** The corridor: Lobby (0) to EXIT (10). Players stack two abreast per space; the ghoul lurks behind. */
function Track({ players, pos, ghoul, ghost, marks, moving, done }: { players: readonly PackPlayer[]; pos: Record<string, number>; ghoul: number; ghost(id: string): boolean; marks?: Record<string, ReactNode>; moving?: boolean; done?: readonly string[] }) {
  const slot: Record<string, number> = {}, count: Record<number, number> = {};
  for (const p of players) { const at = pos[p.id] ?? 0; slot[p.id] = count[at] = (count[at] ?? -1) + 1; }
  const tok = players.length <= 4 ? 100 : players.length <= 6 ? 84 : 72;
  return <div className="qp-track" data-moving={moving || undefined} style={{ '--tok': `${tok}px` } as CSSProperties}>
    <ol className="qp-lane">{Array.from({ length: EXIT + 1 }, (_, i) => <li key={i} data-exit={i === EXIT || undefined} data-ghoul={i <= ghoul && ghoul > 0 || undefined}>
      {i === EXIT ? <span className="qp-exit kp-title">Exit</span> : <span className="kp-numeral">{i === 0 ? 'Lobby' : i}</span>}
    </li>)}</ol>
    <span className="qp-ghoul-token" style={{ '--at': ghoul } as CSSProperties}><Ghoul /></span>
    {players.map(p => <span key={p.id} className="qp-token" style={{ '--at': pos[p.id] ?? 0, '--col': slot[p.id]! % 2, '--row': Math.floor(slot[p.id]! / 2), '--c': p.color } as CSSProperties}>
      <Face player={p} ghost={ghost(p.id)} size={tok} mood={done?.includes(p.id) ? 'done' : ghost(p.id) ? 'sad' : 'idle'} />
      {marks?.[p.id] !== undefined && <em className="qp-token-mark kp-numeral">{marks[p.id]}</em>}
    </span>)}
  </div>;
}

function FinalIntroTV({ view, players }: P) {
  const f = view.final!, ghost = (id: string) => view.ghosts.includes(id), marks: Record<string, ReactNode> = {};
  for (const p of players) if (f.bonus?.[p.id]) marks[p.id] = `+${f.bonus[p.id]}`;
  return <section className="qp-final-intro">
    <Sign>Final round</Sign>
    <div className="qp-final-title"><Concierge /><div><BigTitle kicker="The exit is that way →" size={120}>Escape the Hotel!</BigTitle>
      <ul className="qp-rules"><li><b>Pick what fits</b> each category. Every right pick moves you 1 space. One wrong pick: you stay put.</li>
        <li><b>Living guests</b> race for the Exit. The richest start ahead.</li>
        <li><b>Ghosts</b> start in the Lobby. Pass the last living guest to steal their body!</li>
        <li><b>The ghoul</b> creeps forward every turn. Get caught and you’re a ghost.</li></ul></div></div>
    <Track players={players} pos={f.pos} ghoul={f.ghoul} ghost={ghost} marks={marks} />
  </section>;
}

function FinalTV({ view, players, now }: P) {
  const f = view.final!, r = f.result, step = useTimeline(view.at, r ? [...FINAL.items, FINAL.move, FINAL.swap, FINAL.ghoul] : [Infinity], now);
  const moved = step >= 4, swapped = step >= 5, ghoulMoved = step >= 6;
  const before = new Set(r?.ghostsBefore ?? view.ghosts), afterSwap = new Set(before);
  for (const s of r?.swaps ?? []) { afterSwap.delete(s.ghost); afterSwap.add(s.living); }
  const ghost = (id: string) => !r ? view.ghosts.includes(id) : ghoulMoved ? view.ghosts.includes(id) : swapped ? afterSwap.has(id) : before.has(id);
  const pos = r && !moved ? r.from : f.pos, ghoul = r && !ghoulMoved ? r.ghoulFrom : f.ghoul, marks: Record<string, ReactNode> = {};
  if (r && moved) for (const p of players) if (r.moves[p.id] || (r.picks[p.id] ?? []).length) marks[p.id] = r.moves[p.id] ? `+${r.moves[p.id]}` : '✗';
  const swaps = r && swapped ? r.swaps : [], caught = r && ghoulMoved ? pick(players, r.caught) : [], escaped = r && swapped ? pick(players, r.escaped) : [];
  return <section className="qp-final" data-phase={view.phase}>
    <Sign side={view.phase === 'final-question' && <Clock view={view} now={now} />}>Escape · turn <b className="kp-numeral">{f.turn}</b> of {FINAL_TURNS}</Sign>
    <div className="qp-category"><span className="qp-cat">Which of these are…</span><h2 className="kp-title" style={{ fontSize: fitText(f.category, 104) }}>{f.category}</h2></div>
    <ol className="qp-items">{f.items.map((item, i) => {
      const shown = !!r && step > i, who = r && shown ? players.filter(p => r.picks[p.id]?.includes(i)).map(p => ghostly(p, before.has(p.id))) : [];
      return <li key={item} data-state={!shown ? 'idle' : r!.fits[i] ? 'fit' : 'nope'} style={{ animationDelay: `${i * 140}ms` }}>
        <span style={{ fontSize: fitText(item, 66) }}>{item}</span>
        {shown && <b className="qp-fit kp-title">{r!.fits[i] ? '✓ Fits' : '✗ Nope'}</b>}
        {who.length > 0 && <AvatarStack className="qp-pickers" players={who} size={56} max={6} />}
      </li>;
    })}</ol>
    <p className="qp-foot" role="status">{!r ? <>Tap every item that fits. <b className="kp-numeral">{view.done.length}/{players.length}</b> locked</>
      : !moved ? 'Let’s check your picks…'
      : escaped.length ? <b className="qp-good">{names(escaped)} {escaped.length === 1 ? 'reaches' : 'reach'} the exit!</b>
      : caught.length ? <b className="qp-bad">The ghoul caught {names(caught)}!</b>
      : swaps.length ? <b className="qp-ghosty">Body swap! {names(pick(players, swaps.map(s => s.ghost)))} {swaps.length === 1 ? 'is' : 'are'} back from the dead!</b>
      : ghoulMoved && f.ghoul > 0 ? `The ghoul creeps to space ${f.ghoul}…` : 'Everyone shuffles onward.'}</p>
    <Track players={players} pos={pos} ghoul={ghoul} ghost={ghost} marks={marks} moving done={r ? undefined : view.done} />
    {escaped.length > 0 && <Confetti burst={`escape-${f.turn}`} count={120} />}
  </section>;
}

function FinalEndTV({ view, players }: P) {
  const f = view.final!, winners = pick(players, f.winners ?? []), ghost = (id: string) => view.ghosts.includes(id);
  return <section className="qp-final-end">
    <Sign>Checkout time</Sign>
    <div className="qp-escape">
      <div className="qp-exit-door"><span className="kp-title">Exit</span>{winners.map(w => <Face key={w.id} player={w} size={winners.length > 2 ? 120 : 170} mood="happy" />)}</div>
      <div><BigTitle kicker={f.how === 'escaped' ? 'Free at last!' : f.how === 'furthest' ? 'Time’s up! Closest to the door:' : 'The ghoul got everyone…'} size={110}>
        {winners.length ? `${names(winners)} ${f.how === 'escaped' ? (winners.length === 1 ? 'escapes!' : 'escape!') : winners.length === 1 ? 'wins!' : 'win!'}` : 'Nobody escapes!'}</BigTitle>
        <p className="qp-blurb">{f.how === 'escaped' ? 'Everyone else is staying. Forever.' : 'The hotel keeps the rest of you. Enjoy your stay.'}</p></div>
    </div>
    <Track players={players} pos={f.pos} ghoul={f.ghoul} ghost={ghost} />
    {winners.length > 0 && <Confetti burst="checkout" count={150} />}
  </section>;
}

function Display(props: P) {
  const { view } = props, ph = view.phase;
  return <div className="hj-quiz-panic qp-tv" data-phase={ph}>
    <Hotel alarm={ph.startsWith('panic')} />
    {ph === 'question' || ph === 'answer' ? <QuestionTV {...props} />
      : ph === 'panic-intro' ? <PanicIntroTV {...props} />
      : ph === 'panic' ? <PanicTV {...props} />
      : ph === 'panic-reveal' ? <PanicRevealTV {...props} />
      : ph === 'final-intro' ? <FinalIntroTV {...props} />
      : ph === 'final-end' ? <FinalEndTV {...props} />
      : <FinalTV {...props} />}
  </div>;
}

// ---------- phone ----------

const shellOf = ({ player, ghost, vip, view, now }: Phone, timer = false) => ({
  player: ghostly(player, ghost), vip: vip === player.id, accent: ACCENT, className: ghost ? 'qp-ghost-shell' : '',
  timer: timer ? { deadline: view.deadline, now, total: view.deadline - view.at } : null,
});
const Cash = ({ view, player }: { view: QuizPublic; player: PackPlayer }) => <p className="qp-standing">You have <b className="kp-numeral">{cash(view.money[player.id] ?? 0)}</b></p>;

function QuestionPhone(props: Phone) {
  const { view, me, ghost, send } = props, q = view.question!, locked = me.pick !== undefined;
  return <PhoneShell {...shellOf(props, true)} eyebrow={`Question ${view.q} of ${view.total} · ${q.category}`} title={locked ? `Locked in: ${letter(me.pick!)}` : ghost ? 'Ghosts still get paid!' : 'Answer or panic!'}>
    <p className="qp-phone-q">{q.text}</p>
    <PhoneChoices key={view.turn} className="qp-answers" label="Pick an answer" picked={locked ? [String(me.pick)] : null} locked={locked}
      options={q.options.map((o, i) => ({ id: String(i), label: <><span className="qp-letter kp-title">{letter(i)}</span><span>{o}</span></>, ariaLabel: `${letter(i)}: ${o}`, color: OPTION_COLORS[i] }))}
      onSubmit={([i]) => send({ turn: view.turn, k: 'answer', option: Number(i) })} />
    {locked && <p className="hj-note">{ghost ? 'You can’t die again. Just get rich.' : 'No take-backs. Hope you’re right…'}</p>}
  </PhoneShell>;
}

function AnswerPhone(props: Phone) {
  const { view, me, player, ghost, now } = props, a = view.answer!, step = useTimeline(view.at, [ANSWER.correct, ANSWER.doom], now);
  const got = a.earned[player.id], doomed = a.doomed.includes(player.id), right = me.pick === a.correct;
  const title = !step ? 'Drumroll…' : right ? (got === LONE_PRIZE ? 'Lone genius!' : 'Correct!') : me.pick === undefined ? 'No answer!' : 'Wrong!';
  return <PhoneShell {...shellOf(props)} eyebrow={`Question ${view.q} of ${view.total}`} title={title}>
    <div className="qp-result" data-good={(step > 0 && right) || undefined} data-bad={(step > 0 && !right) || undefined}>
      <Face player={player} ghost={ghost} size={132} mood={!step ? 'thinking' : right ? 'happy' : 'sad'} />
      {step > 0 && got ? <b className="qp-gain kp-numeral">+{cash(got)}</b> : null}
      {step > 0 && <p>The answer: <b>{letter(a.correct)}. {view.question!.options[a.correct]}</b></p>}
      {step > 1 && doomed ? <p className="qp-alert">You’re heading to the Panic Room…</p> : step > 0 && !right && ghost ? <p>Lucky you’re already dead.</p> : null}
      {step > 0 ? <Cash view={view} player={player} /> : <p className="qp-standing">Fingers crossed…</p>}
    </div>
  </PhoneShell>;
}

function PanicIntroPhone(props: Phone) {
  const { view, me, player, ghost } = props, p = view.panic!, info = CHALLENGES[p.kind];
  return <PhoneShell {...shellOf(props)} eyebrow="Panic Room" title={me.doomed ? 'You’re doomed!' : p.poisoners?.includes(player.id) ? 'You’re the poisoner!' : 'Watch them squirm'}>
    <div className="qp-result" data-bad={me.doomed || undefined}>
      <Face player={player} ghost={ghost} size={120} mood={me.doomed ? 'sad' : 'happy'} />
      <h3 className="qp-phone-kind kp-title">{info.name}</h3>
      <p>{me.doomed ? info.doomed : p.poisoners?.includes(player.id) ? 'Pick a cup to poison when the cups appear.' : info.blurb}</p>
    </div>
  </PhoneShell>;
}

function CupsPhone(props: Phone) {
  const { view, me, send } = props, p = view.panic!, poison = me.task === 'poison', done = me.cup !== undefined;
  return <PhoneShell {...shellOf(props, true)} eyebrow="Poison Punch" title={done ? (poison ? `Cup ${me.cup! + 1} is spiked` : `You drink cup ${me.cup! + 1}`) : poison ? 'Poison a cup' : 'Pick a cup'}>
    <p className="hj-note">{poison ? 'The doomed won’t see which. Other survivors may spike cups too.' : 'Some cups are poisoned. At least one is safe.'}</p>
    <PhoneChoices key={view.turn} className="qp-cups" columns={2} label={poison ? 'Cup to poison' : 'Cup to drink'} picked={done ? [String(me.cup)] : null} locked={done}
      options={Array.from({ length: p.cups ?? 0 }, (_, i) => ({ id: String(i), label: <><Cup n={i + 1} /><span>Cup {i + 1}</span></>, ariaLabel: `Cup ${i + 1}`, color: poison ? ACCENT : 'var(--kp-coral)' }))}
      onSubmit={([c]) => send({ turn: view.turn, k: 'cup', cup: Number(c) })} />
  </PhoneShell>;
}

function MathPhone(props: Phone) {
  const { view, me, send, sessionKey } = props, sums = me.sums ?? [], [state, run] = useSend();
  const [draft, setDraft] = useDraft<{ at: number; vals: string[] }>(`${sessionKey}:${view.turn}:math`, { at: 0, vals: sums.map(() => '') });
  if (me.answers) return <PhoneShell {...shellOf(props, true)} eyebrow="Mad Math" title="Answers locked!">
    <PhoneDone detail="Fingers crossed…"><ul className="qp-mine">{sums.map((s, i) => <li key={i} className="kp-numeral">{s.a} {s.op} {s.b} = <b>{me.answers![i]}</b></li>)}</ul></PhoneDone>
  </PhoneShell>;
  const at = Math.min(draft.at, sums.length - 1), val = draft.vals[at] ?? '', last = at === sums.length - 1, s = sums[at];
  const set = (v: string) => setDraft({ at, vals: draft.vals.map((x, i) => i === at ? v : x) });
  const ready = draft.vals.every(Boolean);
  return <PhoneShell {...shellOf(props, true)} eyebrow={`Mad Math · sum ${at + 1} of ${sums.length}`} title="Quick! Solve it.">
    <div className="qp-sums">{sums.map((x, i) => <button key={i} type="button" className="kp-numeral" data-on={i === at || undefined} data-filled={!!draft.vals[i] || undefined} onClick={() => setDraft({ ...draft, at: i })}>{x.a} {x.op} {x.b} = {draft.vals[i] || '?'}</button>)}</div>
    {s && <p className="qp-display kp-numeral" aria-live="polite">{s.a} {s.op} {s.b} = <b>{val || '?'}</b></p>}
    <div className="qp-keypad">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => <button key={d} type="button" className="kp-numeral" onClick={() => set((val + d).slice(0, 4))}>{d}</button>)}
      <button type="button" aria-label="Delete" onClick={() => set(val.slice(0, -1))}>⌫</button>
      <button type="button" className="kp-numeral" onClick={() => set((val + 0).replace(/^0+(?=\d)/, '').slice(0, 4))}>0</button>
      <button type="button" disabled={!val || last} onClick={() => setDraft({ ...draft, at: at + 1 })}>Next</button></div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={!ready || state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'math', answers: draft.vals.map(Number) }))}>
      {state.status === 'pending' ? 'Sending…' : ready ? 'Lock in all three' : `Answer all ${sums.length} sums`}</ArcadeButton></div>
  </PhoneShell>;
}

function MemoryPhone(props: Phone) {
  const { view, me, send, sessionKey } = props, p = view.panic!, [state, run] = useSend();
  const [seq, setSeq] = useDraft<number[]>(`${sessionKey}:${view.turn}:memory`, []);
  if (p.stage === 'memorize') return <PhoneShell {...shellOf(props, true)} eyebrow="Memory Lane" title="Eyes on the TV!">
    <PhoneWaiting player={props.player} title="Memorise the five symbols" detail="You’ll tap them back in order in a moment." lines={SPOOKY_LINES} />
  </PhoneShell>;
  if (me.memory) return <PhoneShell {...shellOf(props, true)} eyebrow="Memory Lane" title="Sequence locked!">
    <PhoneDone detail="Did you get it right?"><div className="qp-picked">{me.memory.map((s, i) => <MemorySymbol key={i} i={s} size={52} />)}</div></PhoneDone>
  </PhoneShell>;
  return <PhoneShell {...shellOf(props, true)} eyebrow="Memory Lane" title={seq.length < SEQUENCE ? `Tap symbol ${seq.length + 1} of ${SEQUENCE}` : 'Ready?'}>
    <div className="qp-picked" aria-label={`${seq.length} of ${SEQUENCE} picked`}>{Array.from({ length: SEQUENCE }, (_, i) => seq[i] !== undefined ? <MemorySymbol key={i} i={seq[i]!} size={52} /> : <span key={i} className="qp-pslot" />)}</div>
    <div className="qp-symbol-pad">{Array.from({ length: SYMBOLS }, (_, i) => <button key={i} type="button" disabled={seq.length >= SEQUENCE} aria-label={SYMBOL_NAMES[i]} onClick={() => setSeq([...seq, i])}><MemorySymbol i={i} size={64} label /></button>)}</div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky qp-pair">
      <ArcadeButton tone="ghost" size="lg" disabled={!seq.length} onClick={() => setSeq(seq.slice(0, -1))}>Undo</ArcadeButton>
      <ArcadeButton tone="lime" size="lg" disabled={seq.length < SEQUENCE || state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'memory', seq }))}>{state.status === 'pending' ? 'Sending…' : 'Lock it in'}</ArcadeButton>
    </div>
  </PhoneShell>;
}

function HidePhone(props: Phone) {
  const { view, me, send } = props, done = me.room !== undefined;
  return <PhoneShell {...shellOf(props, true)} eyebrow="Hide & Shriek" title={done ? `Hiding in the ${ROOM_NAMES[me.room!]}` : 'Pick a hiding place'}>
    <p className="hj-note">The ghoul searches two or three rooms. Others may hide with you.</p>
    <PhoneChoices key={view.turn} className="qp-rooms" columns={2} label="Room to hide in" picked={done ? [String(me.room)] : null} locked={done}
      options={ROOM_NAMES.map((r, i) => ({ id: String(i), label: <><span className="qp-door-icon" aria-hidden="true" /><span>{r}</span></>, color: 'var(--kp-sun)' }))}
      onSubmit={([r]) => send({ turn: view.turn, k: 'room', room: Number(r) })} />
  </PhoneShell>;
}

function ScramblePhone(props: Phone) {
  const { view, me, send, sessionKey } = props, letters = me.letters ?? [], misses = me.misses ?? 0, [state, run] = useSend();
  const [used, setUsed] = useDraft<number[]>(`${sessionKey}:${view.turn}:word:${misses}`, []);
  if (me.solved || misses >= SCRAMBLE_TRIES) return <PhoneShell {...shellOf(props, true)} eyebrow="Scramble" title={me.solved ? 'You cracked it!' : 'Out of tries!'}>
    {me.solved ? <PhoneDone title="Saved by spelling." detail="Wait for the others." /> : <div className="qp-result" data-bad><Face player={props.player} size={110} mood="sad" /><p>Last try: <b className="qp-word-small">{me.miss}</b></p><p className="qp-alert">The ghoul is licking his lips.</p></div>}
  </PhoneShell>;
  const guess = used.map(i => letters[i]).join('');
  return <PhoneShell {...shellOf(props, true)} eyebrow={`Scramble · ${plural(SCRAMBLE_TRIES - misses, 'try', 'tries')} left`} title="Unscramble the word">
    {me.miss && <StatusNotice tone="error">“{me.miss}” isn’t it. Try again!</StatusNotice>}
    <div className="qp-answer-slots" aria-label={`Your guess: ${guess || 'empty'}`}>{letters.map((_, i) => <button key={i} type="button" className="qp-tile kp-title" disabled={used[i] === undefined} onClick={() => setUsed(used.filter((_, k) => k !== i))}>{used[i] !== undefined ? letters[used[i]!] : ''}</button>)}</div>
    <div className="qp-tiles qp-tile-pad">{letters.map((c, i) => <button key={i} type="button" className="qp-tile kp-title" disabled={used.includes(i)} onClick={() => setUsed([...used, i])}>{c}</button>)}</div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky qp-pair">
      <ArcadeButton tone="ghost" size="lg" disabled={!used.length} onClick={() => setUsed([])}>Clear</ArcadeButton>
      <ArcadeButton tone="lime" size="lg" disabled={used.length < letters.length || state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'word', text: guess }))}>{state.status === 'pending' ? 'Checking…' : 'Try it'}</ArcadeButton>
    </div>
  </PhoneShell>;
}

function CoinPhone(props: Phone) {
  const { view, me, player, send, now } = props, p = view.panic!, calls = me.calls ?? [], flips = p.flips ?? [], landed = useTimeline(view.at, [1700], now) > 0;
  const safe = p.safe?.includes(player.id), out = p.out?.includes(player.id), wins = calls.filter((c, i) => c === flips[i]).length;
  const pips = <p className="qp-pips" aria-label={`${wins} wins`}>{flips.map((f, i) => <span key={i} data-ok={calls[i] === f || undefined}>{calls[i] === f ? '✓' : '✗'}</span>)}</p>;
  if (p.stage === 'flip') {
    const flip = flips.at(-1)!, mine = calls[flips.length - 1];
    return <PhoneShell {...shellOf(props)} eyebrow={`Coin of Fate · flip ${flips.length}`} title={!landed || !mine ? 'Flipping…' : mine === flip ? 'You called it!' : 'Wrong call!'}>
      <div className="qp-result">{landed ? <Coin side={flip} className="qp-phone-coin" /> : <Coin side="H" className="qp-phone-coin qp-spinning" />}{landed && pips}{landed && (safe ? <p className="qp-good">Two right calls. You live!</p> : out ? <p className="qp-alert">Two wrong calls. Uh oh.</p> : null)}</div>
    </PhoneShell>;
  }
  if (safe || out) return <PhoneShell {...shellOf(props)} eyebrow="Coin of Fate" title={safe ? 'You’re safe!' : 'Fate has spoken…'}><div className="qp-result">{pips}<Face player={player} size={110} mood={safe ? 'happy' : 'sad'} /></div></PhoneShell>;
  const called = calls.length > flips.length;
  return <PhoneShell {...shellOf(props, true)} eyebrow={`Coin of Fate · flip ${flips.length + 1} of 3`} title={called ? `You called ${calls.at(-1) === 'H' ? 'heads' : 'tails'}` : 'Heads or tails?'}>
    {pips}
    <p className="hj-note">Two right calls and you live. Two wrong and you’re a ghost.</p>
    <PhoneChoices key={view.turn} className="qp-coin-pick" columns={2} label="Call the coin" picked={called ? [calls.at(-1)!] : null} locked={called}
      options={(['H', 'T'] as Side[]).map(s => ({ id: s, label: <><Coin side={s} /><span>{s === 'H' ? 'Heads' : 'Tails'}</span></>, color: 'var(--kp-sun)' }))}
      onSubmit={([s]) => send({ turn: view.turn, k: 'call', side: s })} />
  </PhoneShell>;
}

function PanicRevealPhone(props: Phone) {
  const { view, me, player, now } = props, p = view.panic!, r = p.reveal!;
  const beats = panicBeats(p.kind, p.kind === 'poison' ? p.cups ?? 0 : p.kind === 'hide' ? r.searched?.length ?? 0 : p.doomed.length), verdict = useTimeline(view.at, [beats.verdict], now) > 0;
  const dead = r.dead.includes(player.id);
  if (!me.doomed) return <PhoneShell {...shellOf(props)} eyebrow={CHALLENGES[p.kind].name} title={verdict ? (r.dead.length ? `${plural(r.dead.length, 'new ghost')}!` : 'Nobody died!') : 'Eyes on the TV!'}>
    <PhoneWaiting player={ghostly(player, props.ghost)} title={props.ghost ? 'Welcome any new ghosts.' : 'Safe… for now.'} lines={props.ghost ? GHOST_LINES : SPOOKY_LINES} />
  </PhoneShell>;
  // The server already counts the dead as ghosts; the header keeps the living look until the TV's verdict beat.
  return <PhoneShell {...shellOf({ ...props, ghost: verdict && dead })} eyebrow={CHALLENGES[p.kind].name} title={!verdict ? 'Did you make it?' : dead ? 'You died!' : 'You survived!'}>
    <div className="qp-result" data-good={(verdict && !dead) || undefined} data-bad={(verdict && dead) || undefined}>
      <Face player={player} ghost={verdict && dead} size={140} mood={!verdict ? 'thinking' : dead ? 'sad' : 'happy'} />
      <p>{!verdict ? 'Eyes on the TV…' : dead ? 'You’re a ghost now. Keep answering: ghosts still earn cash, and you can steal a body in the final!' : 'You live to answer another question.'}</p>
    </div>
  </PhoneShell>;
}

function FinalIntroPhone(props: Phone) {
  const { view, player, ghost } = props, f = view.final!;
  return <PhoneShell {...shellOf(props)} eyebrow="Final round" title="Escape the Hotel!">
    <div className="qp-result" data-good={!ghost || undefined}>
      <Face player={player} ghost={ghost} size={120} mood="happy" />
      <p className="qp-big-line">You start on <b>{f.pos[player.id] ? `space ${f.pos[player.id]}` : 'the Lobby'}</b>{f.bonus?.[player.id] ? ` (+${f.bonus[player.id]} for your cash)` : ''}.</p>
      <p>{ghost ? 'You’re a ghost: pass the last living guest to steal their body.' : 'Reach the Exit first. Stay ahead of the ghoul!'}</p>
    </div>
  </PhoneShell>;
}

function FinalQuestionPhone(props: Phone) {
  const { view, me, send } = props, f = view.final!, locked = !!me.items;
  return <PhoneShell {...shellOf(props, true)} eyebrow={`Turn ${f.turn} of ${FINAL_TURNS} · ${locked ? 'picks locked' : 'which of these are…'}`} title={f.category}>
    <p className="hj-note">Every right pick moves you 1 space. One wrong pick and you stay put. Pick none to play it safe.</p>
    <PhoneChoices key={view.turn} className="qp-items-pick" multi min={0} max={3} label={`Items that are ${f.category}`} picked={locked ? me.items!.map(String) : null} locked={locked} submitLabel="Lock picks"
      options={f.items.map((item, i) => ({ id: String(i), label: item, color: ACCENT }))}
      onSubmit={ids => send({ turn: view.turn, k: 'items', picks: ids.map(Number) })} />
    {locked && <ul className="qp-mine">{me.items!.length ? me.items!.map(i => <li key={i}>{f.items[i]}</li>) : <li>Nothing. Playing it safe!</li>}</ul>}
  </PhoneShell>;
}

function FinalAnswerPhone(props: Phone) {
  const { view, player, now } = props, f = view.final!, r = f.result!, step = useTimeline(view.at, [FINAL.move, FINAL.swap, FINAL.ghoul], now);
  const move = r.moves[player.id] ?? 0, wrong = (r.picks[player.id] ?? []).some(i => !r.fits[i]);
  const stole = r.swaps.find(s => s.ghost === player.id), lost = r.swaps.find(s => s.living === player.id), caught = r.caught.includes(player.id), out = r.escaped.includes(player.id);
  const ghostNow = step >= 3 ? view.ghosts.includes(player.id) : step >= 2 ? (r.ghostsBefore.includes(player.id) ? !stole : !!lost) : r.ghostsBefore.includes(player.id);
  const title = !step ? 'Checking your picks…' : step >= 2 && out ? 'You escaped!' : step >= 3 && caught ? 'The ghoul got you!' : step >= 2 && stole ? 'Body stolen! You live!' : step >= 2 && lost ? 'A ghost stole your body!' : move ? `+${plural(move, 'space')}!` : wrong ? 'Wrong pick! Stuck.' : 'No moves this turn';
  return <PhoneShell {...shellOf({ ...props, ghost: ghostNow })} eyebrow={`Escape · turn ${f.turn} of ${FINAL_TURNS}`} title={title}>
    <div className="qp-result" data-good={(step >= 1 && (move > 0 || !!stole || out)) || undefined} data-bad={(step >= 1 && (wrong || caught || !!lost)) || undefined}>
      <Face player={player} ghost={ghostNow} size={128} mood={!step ? 'thinking' : move || stole || out ? 'happy' : 'sad'} />
      {!step && <p>Eyes on the TV…</p>}
      {step > 0 && <p className="qp-big-line">You’re on <b>{f.pos[player.id] === EXIT ? 'the Exit' : f.pos[player.id] ? `space ${f.pos[player.id]}` : 'the Lobby'}</b>. The ghoul is on {f.ghoul ? `space ${f.ghoul}` : 'the Lobby'}.</p>}
    </div>
  </PhoneShell>;
}

function FinalEndPhone(props: Phone) {
  const { view, player, ghost } = props, f = view.final!, won = f.winners?.includes(player.id);
  return <PhoneShell {...shellOf(props)} eyebrow="Checkout time" title={won ? (f.how === 'escaped' ? 'You escaped!' : 'You win!') : 'You’re staying… forever.'}>
    <div className="qp-result" data-good={won || undefined}><Face player={player} ghost={ghost && !won} size={140} mood={won ? 'happy' : 'sad'} /><Cash view={view} player={player} /></div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Hold on to your candle…" lines={SPOOKY_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player, ghost: view.ghosts.includes(player.id) }, ph = view.phase, task = me.task;
  const watch = () => <PhoneShell {...shellOf(phone, true)} eyebrow={CHALLENGES[view.panic!.kind].name} title={phone.ghost ? 'Ghostly spectator' : 'Watch them squirm'}>
    <PhoneWaiting player={ghostly(phone.player, phone.ghost)} title="Eyes on the TV!" detail={CHALLENGES[view.panic!.kind].blurb} lines={phone.ghost ? GHOST_LINES : SPOOKY_LINES} />
  </PhoneShell>;
  return <div className="hj-quiz-panic qp-phone">
    {ph === 'question' ? <QuestionPhone {...phone} />
      : ph === 'answer' ? <AnswerPhone {...phone} />
      : ph === 'panic-intro' ? <PanicIntroPhone {...phone} />
      : ph === 'panic' ? (task === 'poison' || task === 'drink' ? <CupsPhone {...phone} /> : task === 'math' ? <MathPhone {...phone} /> : task === 'memory' ? <MemoryPhone {...phone} />
        : task === 'hide' ? <HidePhone {...phone} /> : task === 'scramble' ? <ScramblePhone {...phone} /> : task === 'coin' ? <CoinPhone {...phone} /> : watch())
      : ph === 'panic-reveal' ? <PanicRevealPhone {...phone} />
      : ph === 'final-intro' ? <FinalIntroPhone {...phone} />
      : ph === 'final-question' ? <FinalQuestionPhone {...phone} />
      : ph === 'final-answer' ? <FinalAnswerPhone {...phone} />
      : <FinalEndPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
