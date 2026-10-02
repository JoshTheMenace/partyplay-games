/* Shirt Show screens: the wrestling-runway arena TV (studio, ring bouts, champion, main event) and the phone controller. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArcadeButton, DrawingPad, StatusNotice } from '../../../../../party-ui/src/index';
import { DRAWING_COLORS, type Drawing } from '../../../../../party-contract/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  AvatarBadge, AvatarStack, Avatar, BigTitle, Confetti, PhoneChoices, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting, PlayerStrip, Scoreboard, Timer,
  ordinal, rankOf, useDraft, useNow, useSend, useTimeline,
} from '../../core/ui';
import {
  FINAL_RESULT, MAX_DESIGNS, MAX_SLOGAN, MAX_SLOGANS, MIN_INK, RESULT, SHIRT_COLORS, inkOf,
  type Bout, type ClashResult, type Credits, type Final, type Packed, type Pos, type Pts, type ShirtPrivate, type ShirtPublic, type ShirtView,
} from './types';
import './styles.css';

type P = MiniViewProps<ShirtPublic, ShirtPrivate>;
type Phone = P & { me: ShirtPrivate; player: PackPlayer };
type Media = Record<string, unknown>;
const ACCENT = '#ff3fae';
const find = (players: readonly PackPlayer[], id: string | null) => players.find(p => p.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RESULT_STEPS = [RESULT.voters, RESULT.credits, RESULT.winner], FINAL_STEPS = [FINAL_RESULT.voters, FINAL_RESULT.credits, FINAL_RESULT.winner];
const myPoints = (r: ClashResult, id: string) => r.credits.reduce((sum, c, i) => sum + (c.maker === id ? r.points[i]!.maker : 0) + (c.artist === id ? r.points[i]!.artist : 0) + (c.writer === id ? r.points[i]!.writer : 0), 0);

const WAIT_LINES = [
  'Practise your runway walk. Hips first.', 'Flex for the cameras. Any muscle will do.', 'Rehearse a dramatic entrance.', 'Strike a pose. Hold it. Longer.',
  'Think of a wrestling name. Keep it secret.', 'Air-guitar your own theme tune.', 'Glare at the competition. Lovingly.', 'Practise holding a belt over your head.',
];
const STUDIO = {
  draw: { title: 'Design time!', copy: 'Draw anything you’d want on a shirt. Send up to four designs.', unit: ['design on the rack', 'designs on the rack'] },
  write: { title: 'Slogan time!', copy: 'Write short, punchy slogans. Up to six. Anyone could end up wearing them.', unit: ['slogan in the press', 'slogans in the press'] },
  make: { title: 'Stitch it together!', copy: 'Pick a design and a slogan made by other players, choose a colour, and send your shirt to the ring.', unit: ['shirt sewn', 'shirts sewn'] },
} as const;

// ---------- the shirt ----------

const TEE = 'M140 30Q200 74 260 30L334 54L394 136L338 186L312 164L316 418Q200 434 84 418L88 164L62 186L6 136L66 54Z';
const FOLDS = 'M118 300Q128 360 114 404M286 292Q274 352 290 406M200 420Q206 380 200 350';
/** Slogan size (% of the shirt width) by length: short slogans shout, long ones wrap onto three lines. */
const sloganSize = (n: number) => n <= 8 ? 10.5 : n <= 14 ? 8.6 : n <= 22 ? 7.2 : n <= 30 ? 6.2 : 5.6;

/** A design as a screen print: every stroke gets a contrasting edge so it reads on any shirt colour. */
export function Print({ packed, className = '' }: { packed: unknown; className?: string }) {
  // Thin pens are thickened: pads draw at phone scale, prints are seen from the sofa.
  const lines = (Array.isArray(packed) ? packed as Packed : []).map(s => ({ ink: DRAWING_COLORS[s[0]!] ?? DRAWING_COLORS[0], w: Math.max(s[1] ?? 12, 18 + (s[1] ?? 12) * .6), pts: s.slice(2).join(' ') }));
  return <svg className={`ss-print-art ${className}`} viewBox="0 0 1000 1000" aria-hidden="true">
    <g className="ss-print-edge">{lines.map((l, i) => <polyline key={i} points={l.pts} strokeWidth={l.w + 22} stroke={l.ink === DRAWING_COLORS[0] ? '#fff6e5' : '#05071a'} />)}</g>
    <g>{lines.map((l, i) => <polyline key={i} points={l.pts} strokeWidth={l.w} stroke={l.ink} />)}</g>
  </svg>;
}

/** A finished shirt: the tee in its colour, the design on the chest and the slogan above or below it. `stand` adds the mannequin. */
export function Tee({ shirt, media, stand, className = '' }: { shirt: Pick<ShirtView, 'design' | 'slogan' | 'color' | 'pos'>; media: Media; stand?: boolean; className?: string }) {
  const c = SHIRT_COLORS[shirt.color] ?? SHIRT_COLORS[0];
  return <figure className={`ss-tee ${className}`} data-pos={shirt.pos} data-light={c.light || undefined} data-stand={stand || undefined} style={{ '--tee': c.hex } as CSSProperties} role="img" aria-label={`${c.name} shirt: ${shirt.slogan}`}>
    <svg className="ss-tee-art" viewBox="0 0 400 440" aria-hidden="true">
      {stand && <path className="ss-tee-neck" d="M168 44V8Q200 -6 232 8V44Z" />}
      <path className="ss-tee-body" d={TEE} /><path className="ss-tee-fold" d={FOLDS} /><path className="ss-tee-collar" d="M140 30Q200 74 260 30" />
    </svg>
    <div className="ss-print"><Print packed={media[shirt.design]} /></div>
    <p className="ss-slogan" style={{ '--fs': sloganSize(shirt.slogan.length) } as CSSProperties}>{shirt.slogan}</p>
  </figure>;
}

/** Blank tee silhouette for racks and line-ups. */
const Blank = ({ color, tag, className = '' }: { color?: string; tag?: ReactNode; className?: string }) => <span className={`ss-blank ${className}`} style={color ? { '--tee': color } as CSSProperties : undefined} data-empty={!color || undefined}>
  <svg viewBox="0 0 400 440" aria-hidden="true"><path d={TEE} /></svg>{tag && <b>{tag}</b>}
</span>;

/** The ring bell: a brass dome on a bracket, with its hammer. Swings while `ring`. */
const Bell = ({ ring }: { ring?: boolean }) => <svg className="ss-bell" data-ring={ring || undefined} viewBox="0 0 120 120" aria-hidden="true">
  <rect className="ss-bell-mount" x="48" y="2" width="24" height="20" rx="5" /><circle className="ss-bell-dome" cx="60" cy="64" r="46" />
  <circle className="ss-bell-rim" cx="60" cy="64" r="32" /><circle className="ss-bell-knob" cx="60" cy="64" r="10" /><path className="ss-bell-shine" d="M30 46Q38 30 54 26" />
  <path className="ss-bell-hammer" d="M112 116L86 90" /><circle className="ss-bell-head" cx="84" cy="88" r="9" />
</svg>;

/** Championship belt: leather strap, gold plate, a star. */
function Belt({ className = '' }: { className?: string }) {
  return <svg className={`ss-belt ${className}`} viewBox="0 0 400 140" aria-hidden="true">
    <path className="ss-belt-strap" d="M6 52Q200 30 394 52V92Q200 70 6 92Z" />
    {[40, 84, 316, 360].map(x => <rect key={x} className="ss-belt-stud" x={x - 14} y={52} width={28} height={30} rx={6} />)}
    <ellipse className="ss-belt-plate" cx="200" cy="70" rx="92" ry="64" /><ellipse className="ss-belt-ring" cx="200" cy="70" rx="72" ry="48" />
    <path className="ss-belt-star" d="M200 34L210 60L238 60L216 76L224 102L200 86L176 102L184 76L162 60L190 60Z" />
  </svg>;
}

// ---------- TV ----------

/** Ring ropes, turnbuckles, neon and floor smoke behind every TV screen. */
const Arena = ({ ring }: { ring?: boolean }) => <div className="ss-arena" data-ring={ring || undefined} aria-hidden="true">
  <i className="ss-neon ss-neon-l" /><i className="ss-neon ss-neon-r" />
  <div className="ss-ropes"><i /><i /><i /></div><i className="ss-post ss-post-l" /><i className="ss-post ss-post-r" />
  <i className="ss-apron" /><i className="ss-smoke ss-smoke-1" /><i className="ss-smoke ss-smoke-2" /><i className="ss-smoke ss-smoke-3" />
</div>;

function Head({ chip, round, children }: { chip: ReactNode; round?: number | 'final'; children?: ReactNode }) {
  return <header className="ss-head">
    <span className="ss-sign"><b className="kp-title">Shirt</b><em className="kp-title">Show</em></span>
    <span className="ss-chip" data-round={round}>{chip}</span>
    <span className="ss-head-side">{children}</span>
  </header>;
}

/** A clothing rail of tees: `lit` coloured (filled), the rest waiting. Two rails when crowded. */
function Rack({ count, lit, tag }: { count: number; lit: number; tag?: (i: number) => ReactNode }) {
  const rails = count > 12 ? 2 : 1, per = Math.max(1, Math.ceil(count / rails)), step = Math.min(132, 760 / per), width = Math.min(150, step * 1.45);
  return <div className="ss-rack" style={{ '--w': `${width}px`, '--gap': `${step - width}px` } as CSSProperties}>
    {Array.from({ length: rails }, (_, r) => <div key={r} className="ss-rail">
      {Array.from({ length: Math.min(per, count - r * per) }, (_, k) => { const i = r * per + k;
        return <Blank key={i} className="ss-hang" color={i < lit ? SHIRT_COLORS[i % SHIRT_COLORS.length]!.hex : undefined} tag={i < lit ? tag?.(i) : undefined} />; })}
    </div>)}
    {!count && <p className="ss-rack-empty">The rack is empty… for now.</p>}
  </div>;
}

function StudioTV({ view, players, vip, now }: P) {
  const phase = view.phase as 'draw' | 'write' | 'make', copy = STUDIO[phase], t = useNow(now, 1000);
  const total = phase === 'make' ? view.sewn?.[0] ?? 0 : Object.values(view.counts ?? {}).reduce((a, b) => a + b, 0);
  const sparks = view.sparks ?? [], spark = sparks.length ? sparks[Math.floor(Math.max(0, t - view.at) / 5000) % sparks.length] : '';
  return <section className="ss-studio" data-phase={phase}>
    <Head chip={`Round ${view.round} · ${phase === 'draw' ? 'Designs' : phase === 'write' ? 'Slogans' : 'Sewing room'}`} round={view.round}>
      <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={124} />
    </Head>
    <div className="ss-studio-main">
      <div className="ss-studio-art">
        {phase === 'write' && spark
          ? <div className="ss-press" key={spark}><span className="ss-press-tab kp-title">Need a slogan?</span><p>{spark}</p></div>
          : <Rack count={phase === 'make' ? view.sewn?.[1] ?? 0 : total} lit={phase === 'make' ? total : total} tag={phase === 'make' ? () => 'Sewn' : () => '?'} />}
      </div>
      <div className="ss-studio-copy">
        <BigTitle kicker={`Round ${view.round}`} size={118}>{copy.title}</BigTitle>
        <p className="ss-copy">{copy.copy}</p>
        <div className="ss-tally" role="status"><b className="kp-numeral">{total}{phase === 'make' && <small>/{view.sewn?.[1] ?? 0}</small>}</b><span>{total === 1 && phase !== 'make' ? copy.unit[0] : copy.unit[1]}</span></div>
      </div>
    </div>
    <PlayerStrip players={players} vip={vip} done={view.done} badges={view.counts ? Object.fromEntries(players.map(p => [p.id, view.counts![p.id] ?? 0])) : undefined} />
  </section>;
}

/** One corner's story: votes, then who made it and whose parts it wears, then the points. */
function CornerCard({ votes, known, credits, voters, pts, bonus, players, won }: { votes: boolean; known: boolean; credits?: Credits; voters: readonly PackPlayer[]; pts?: Pts; bonus?: number; players: readonly PackPlayer[]; won: boolean }) {
  const maker = credits && find(players, credits.maker);
  const part = (label: string, by: string | null | undefined, points = 0) => {
    const p = by ? find(players, by) : undefined;
    return <li key={label}><small>{label}</small>{by === credits?.maker ? <span>their own</span> : p ? <AvatarBadge player={p} size={40} /> : <span>the house</span>}{pts && points > 0 && <b className="kp-numeral">+{points}</b>}</li>;
  };
  return <div className="ss-card" data-won={(pts && won) || undefined}>
    {votes ? <div className="ss-card-votes"><b className="kp-numeral">{voters.length}</b><small>{voters.length === 1 ? 'vote' : 'votes'}</small>{voters.length > 0 && <AvatarStack players={voters} size={52} max={6} />}</div>
      : !known && <p className="ss-card-wait">Who made it?</p>}
    {known && maker ? <div className="ss-card-maker">
      <small>{credits!.auto ? 'Auto-stitched for' : 'Made by'}</small>
      <span className="ss-card-who"><AvatarBadge player={maker} size={72} layout="column" mood={pts ? (won ? 'happy' : 'sad') : 'idle'} />{pts && <b className="ss-sticker kp-numeral">+{pts.maker + (won && bonus ? bonus : 0)}</b>}</span>
      <ul>{part('Art', credits!.artist, pts?.artist)}{part('Words', credits!.writer, pts?.writer)}</ul>
    </div> : <span className="ss-mystery kp-title" aria-label="Mystery maker">?</span>}
  </div>;
}

/** The ring: holder on the left, challenger on the right, cards on the outside, VS in the middle. */
function Ring({ sides, result, step, labels, media, players, final }: { sides: readonly [ShirtView, ShirtView]; result?: ClashResult; step: number; labels: [ReactNode, ReactNode]; media: Media; players: readonly PackPlayer[]; final?: Final }) {
  const bonus = final?.result?.bonus;
  const decided = step >= 3 && !!result;
  return <div className="ss-ring" data-final={final ? true : undefined}>
    {([0, 1] as const).map(i => {
      const state = !decided ? 'idle' : result!.winner === i ? 'win' : 'lose', voters = result ? result.voters[i].map(id => find(players, id)).filter(p => !!p) : [];
      return <div key={i} className={`ss-corner ss-corner-${i}`} data-state={state}>
        <CornerCard votes={!!result && step >= 1} known={(!!result && step >= 2) || !!final} credits={result?.credits[i] ?? final?.credits[i]} voters={voters} pts={decided ? result!.points[i] : undefined} bonus={bonus} players={players} won={state === 'win'} />
        <div className="ss-slot">
          <span className="ss-plate">{labels[i]}</span>
          <div className="ss-runway" key={sides[i].id}><Tee shirt={sides[i]} media={media} stand /></div>
          {state === 'win' && <Belt className="ss-belt-win" />}
          {state === 'win' && final && <span className="ss-sash kp-title" role="status">Shirt of the night!</span>}
          {state === 'lose' && <span className="ss-ko kp-title" role="status">{result!.tie ? 'Tie' : 'KO!'}</span>}
        </div>
      </div>;
    })}
    <span className="ss-vs kp-title" aria-hidden="true">VS</span>
  </div>;
}

/** Knocked-out shirts and the challengers still waiting behind the curtain. */
function Lineup({ ko, left, media }: { ko: readonly ShirtView[]; left: number; media: Media }) {
  if (!ko.length && !left) return null;
  return <div className="ss-lineup">
    {ko.length > 0 && <span className="ss-lineup-ko"><small>Out</small>{ko.map(s => <span key={s.id} className="ss-mini"><Tee shirt={s} media={media} /><i>✕</i></span>)}</span>}
    {left > 0 && <span className="ss-lineup-left"><small>Waiting</small>{Array.from({ length: Math.min(left, 6) }, (_, i) => <Blank key={i} tag={i === 0 ? '?' : undefined} />)}{left > 6 && <b>+{left - 6}</b>}</span>}
  </div>;
}

function BoutTV({ view, bout, players, media, now }: P & { bout: Bout }) {
  const result = bout.result, step = useTimeline(view.at, view.phase === 'result' ? RESULT_STEPS : [Infinity], now);
  const holder = bout.streak ? `Champ · ${plural(bout.streak, 'win')}` : 'In the ring', winner = result && step >= 3 ? result.winner : null;
  const maker = result && winner !== null ? find(players, result.credits[winner].maker) : undefined;
  return <section className="ss-bout" data-phase={view.phase}>
    <Head chip={`Round ${view.round} · Bout ${bout.index + 1} of ${bout.count}`} round={view.round}>
      {view.phase === 'vote' ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={116} /> : <Bell ring={view.phase === 'show' || winner !== null} />}
    </Head>
    <Ring sides={bout.sides} result={result} step={step} labels={[holder, 'Challenger']} media={media} players={players} />
    <footer className="ss-foot">
      <p role="status">{view.phase === 'show' ? (bout.index ? 'A new challenger approaches!' : 'Shirts, enter the ring!')
        : view.phase === 'vote' ? <><b>Which would you wear?</b> Vote on your phone! <span className="kp-numeral">{plural(bout.votes, 'vote')} in</span></>
        : winner === null ? 'The judges are tallying…'
        : result!.tie ? <><b>Tie!</b> The champ keeps the belt.</>
        : <><b>{maker?.name}</b>’s shirt {winner ? 'takes the belt!' : result!.streak > 1 ? `defends! ${result!.streak} wins in a row.` : 'holds the ring!'}</>}</p>
      <Lineup ko={view.ko ?? []} left={view.left ?? 0} media={media} />
    </footer>
    {winner === 0 && !result!.tie && result!.streak >= 3 && <div className="ss-streak kp-title" role="status">{result!.streak}-win streak!</div>}
  </section>;
}

function ChampTV({ view, players, media }: P) {
  const champ = view.champ!, maker = find(players, champ.credits.maker), prev = view.prev ?? {};
  const gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  return <section className="ss-champ">
    <Head chip={`Round ${view.round} champion`} round={view.round} />
    <div className="ss-champ-main">
      <div className="ss-podium">
        <p className="ss-champ-title kp-title">Champion!</p>
        <div className="ss-podium-row">
          <div className="ss-champ-shirt"><Tee shirt={champ.shirt} media={media} /><Belt className="ss-belt-champ" /></div>
          <div className="ss-champ-copy">
            {maker && <AvatarBadge player={maker} size={110} mood="happy" detail={champ.wins ? `${plural(champ.wins, 'bout')} won` : 'Unbeaten'} />}
            <b className="ss-sticker ss-sticker-big kp-numeral">+{champ.bonus}</b>
          </div>
        </div>
      </div>
      <Scoreboard players={players} scores={view.scores} from={prev} delay={1800} rowHeight={players.length > 8 ? 78 : 88} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
    </div>
    <Confetti burst={`champ-${view.round}`} count={110} />
  </section>;
}

function FinalTV({ view, final, players, media, now }: P & { final: Final }) {
  const result = final.result, step = useTimeline(view.at, view.phase === 'final-result' ? FINAL_STEPS : [Infinity], now), intro = useTimeline(view.at, [2600], now) === 0 && view.phase === 'final-show';
  const winner = result && step >= 3 ? result.winner : null, maker = winner !== null ? find(players, result!.credits[winner].maker) : undefined;
  const label = (i: 0 | 1) => <>Round {i + 1} champ{final.wins[i] ? <small> · {plural(final.wins[i], 'win')}</small> : null}</>;
  return <section className="ss-final" data-phase={view.phase}>
    <Head chip="The main event" round="final">{view.phase === 'final-vote' ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={116} /> : <Bell ring />}</Head>
    <Ring sides={final.sides} result={result} step={step} labels={[label(0), label(1)]} media={media} players={players} final={final} />
    <footer className="ss-foot"><p role="status">{view.phase === 'final-show' ? 'Two champions. One shirt of the night.'
      : view.phase === 'final-vote' ? <><b>Double points!</b> Vote on your phone! <span className="kp-numeral">{plural(final.votes, 'vote')} in</span></>
      : winner === null ? 'The whole arena holds its breath…'
      : <><b>{maker?.name}</b> made the shirt of the night! +{result!.bonus} bonus{result!.tiebreak ? ' (tie broken by ring wins)' : ''}</>}</p></footer>
    {intro && <div className="ss-main-event" role="status"><BigTitle kicker="Ladies, gentlemen and everyone in between" size={170}>Main event!</BigTitle></div>}
    {winner !== null && <Confetti burst="final" count={140} />}
  </section>;
}

function Display(props: P) {
  const { view } = props, ring = !!view.bout || !!view.final;
  return <div className="hj-shirt-show ss-tv" data-phase={view.phase}>
    <Arena ring={ring} />
    {view.phase === 'draw' || view.phase === 'write' || view.phase === 'make' ? <StudioTV {...props} />
      : view.bout ? <BoutTV {...props} bout={view.bout} />
      : view.phase === 'champ' && view.champ ? <ChampTV {...props} />
      : view.final ? <FinalTV {...props} final={view.final} /> : null}
  </div>;
}

// ---------- phone ----------

const shellOf = (view: ShirtPublic, player: PackPlayer, vip: string | null, now: () => number, timer = true) =>
  ({ player, vip: vip === player.id, accent: ACCENT, ...(timer ? { timer: { deadline: view.deadline, now, total: view.deadline - view.at } } : {}) });

function Standing({ view, players, player }: { view: ShirtPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  return <p className="ss-standing"><b className="kp-title">{ordinal(rankOf(view.scores, player.id, players.map(p => p.id)))}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>;
}
const Pips = ({ on, of }: { on: number; of: number }) => <span className="ss-pips" aria-label={`${on} of ${of}`}>{Array.from({ length: of }, (_, i) => <i key={i} data-on={i < on || undefined} />)}</span>;
/** Rotating idea line with a "new idea" button (ideas come from the server, per player). */
function Idea({ ideas, offset, label }: { ideas: readonly string[]; offset: number; label: string }) {
  const [shift, setShift] = useState(0), idea = ideas.length ? ideas[(offset + shift) % ideas.length] : '';
  return idea ? <p className="ss-idea"><small>{label}</small><b>{idea}</b><button type="button" aria-label="New idea" onClick={() => setShift(n => n + 1)}>↻</button></p> : null;
}

function DrawPhone({ view, me, player, players, vip, now, send, sessionKey }: Phone) {
  const count = me.designs ?? 0, [drawing, setDrawing] = useDraft<Drawing>(`${sessionKey}:${view.turn}:d${count}`, { strokes: [] });
  const [state, run] = useSend(), [doneState, runDone] = useSend(), auto = useRef(''), pad = useRef<HTMLDivElement>(null), late = view.deadline - useNow(now, 250) < 1800;
  const submit = () => run(() => send({ turn: view.turn, k: 'design', drawing }));
  // Short screens: bring the pad and its buttons into view for each new design.
  useEffect(() => { if (innerHeight < 720) pad.current?.querySelector('.kp-drawing-surface')?.scrollIntoView({ block: innerWidth > innerHeight ? 'center' : 'end' }); }, [count]);
  // A started design is handed in just before time runs out.
  useEffect(() => { if (late && !me.finished && inkOf(drawing) >= MIN_INK && auto.current !== `${view.turn}:${count}`) { auto.current = `${view.turn}:${count}`; void submit(); } });
  const shell = shellOf(view, player, vip, now);
  if (me.finished) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow={`Round ${view.round} · Designs`} title="On the rack!">
      <PhoneDone title={`${plural(count, 'design')} sent`} detail="Someone else might wear your art. Act natural." />
      {waiting.length > 0 && <PhoneWaiting title="Other artists still drawing" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  const pending = state.status === 'pending' || doneState.status === 'pending';
  return <PhoneShell {...shell} className="ss-draw-shell" eyebrow={<>Round {view.round} · Design {count + 1} of {MAX_DESIGNS} <Pips on={count} of={MAX_DESIGNS} /></>} title="Draw a shirt design">
    <Idea ideas={me.ideas ?? []} offset={count} label="Stuck? Try" />
    <div ref={pad} className="ss-pad"><DrawingPad value={drawing} onChange={setDrawing} disabled={pending} label="Your design" /></div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    {doneState.status === 'rejected' && <StatusNotice tone="error">{doneState.reason}</StatusNotice>}
    <div className="hj-sticky ss-actions">
      <ArcadeButton tone="lime" size="lg" disabled={pending || inkOf(drawing) < MIN_INK} onClick={() => void submit()}>{state.status === 'pending' ? 'Hanging…' : 'Add to the rack'}</ArcadeButton>
      {count > 0 && <ArcadeButton tone="ghost" size="md" disabled={pending} onClick={() => void runDone(() => send({ turn: view.turn, k: 'done' }))}>I’m done drawing ({count} sent)</ArcadeButton>}
    </div>
  </PhoneShell>;
}

function WritePhone({ view, me, player, players, vip, now, send, sessionKey }: Phone) {
  const mine = me.slogans ?? [], n = mine.length, [doneState, runDone] = useSend(), [shift, setShift] = useState(0), shell = shellOf(view, player, vip, now);
  const ideas = me.ideas ?? [], idea = ideas.length ? ideas[(n + shift) % ideas.length] : undefined;
  const list = n > 0 && <ul className="ss-mine">{mine.map(text => <li key={text}>{text}</li>)}</ul>;
  if (me.finished) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow={`Round ${view.round} · Slogans`} title="Off to the press!">
      <PhoneDone title={`${plural(n, 'slogan')} sent`} detail="Anyone could end up wearing these.">{list}</PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Still writing" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell} eyebrow={<>Round {view.round} · Slogan {n + 1} of {MAX_SLOGANS} <Pips on={n} of={MAX_SLOGANS} /></>} title="Write a slogan">
    {idea && <button type="button" className="ss-reroll ss-new-idea" onClick={() => setShift(k => k + 1)}>↻ Another idea</button>}
    <PhoneTextEntry multiline label={idea ? <><small className="ss-label-kicker">Idea · or write anything</small>{idea}</> : 'Write a slogan'} draftKey={`${sessionKey}:${view.turn}:s${n}`} maxLength={MAX_SLOGAN} placeholder="Something you’d wear on your chest…" submitLabel="Print it"
      onSubmit={text => send({ turn: view.turn, k: 'slogan', text })} />
    {list}
    {n > 0 && <ArcadeButton tone="ghost" size="md" className="ss-done-btn" disabled={doneState.status === 'pending'} onClick={() => void runDone(() => send({ turn: view.turn, k: 'done' }))}>I’m done writing ({n} sent)</ArcadeButton>}
    {doneState.status === 'rejected' && <StatusNotice tone="error">{doneState.reason}</StatusNotice>}
  </PhoneShell>;
}

type Build = { design: string; slogan: string; color: number; pos: Pos };
function MakePhone({ view, me, player, players, vip, now, send, sessionKey, media }: Phone) {
  const made = me.made ?? [], need = me.need ?? 1, hand = me.hand, shell = shellOf(view, player, vip, now);
  const [draft, setDraft] = useDraft<Partial<Build>>(`${sessionKey}:${view.turn}:m${made.length}`, {}), [state, run] = useSend(), [roll, runRoll] = useSend();
  if (!hand) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow="Sewing room" title={made.length > 1 ? 'Shirts sent to the ring!' : 'Shirt sent to the ring!'}>
      <PhoneDone title="Stitched!" detail={`Your ${made.length > 1 ? 'shirts fight' : 'shirt fights'} anonymously. Keep a straight face.`}><div className="ss-made">{made.map(s => <Tee key={s.id} shirt={s} media={media} />)}</div></PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Still sewing" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  // Picks that left the hand (after a reroll) fall back to the first option.
  const build: Build = {
    design: hand.designs.includes(draft.design ?? '') ? draft.design! : hand.designs[0]!, slogan: hand.slogans.some(x => x.id === draft.slogan) ? draft.slogan! : hand.slogans[0]!.id,
    color: draft.color ?? (made.length * 3 + player.avatar) % SHIRT_COLORS.length, pos: draft.pos ?? 'bottom',
  };
  const set = (patch: Partial<Build>) => setDraft({ ...build, ...patch }), pending = state.status === 'pending' || roll.status === 'pending';
  const reroll = (what: 'design' | 'slogan') => void runRoll(() => send({ turn: view.turn, k: 'reroll', what }));
  const rerollBtn = (what: 'design' | 'slogan', on: boolean) => <button type="button" className="ss-reroll" data-what={what} disabled={!on || pending} onClick={() => reroll(what)}>{on ? `↻ New ${what}s` : 'Rerolled'}</button>;
  return <PhoneShell {...shell} className="ss-make-shell" eyebrow={need > 1 ? `Sewing room · Shirt ${made.length + 1} of ${need}` : 'Sewing room'} title="Stitch a shirt">
    <div className="ss-preview"><Tee shirt={{ ...build, slogan: hand.slogans.find(x => x.id === build.slogan)!.text }} media={media} /></div>
    <section className="ss-pick"><header><h3>1 · Design</h3>{rerollBtn('design', hand.reroll.design)}</header>
      <div className="ss-designs" role="radiogroup" aria-label="Designs">{hand.designs.map((key, i) => <button key={key} type="button" role="radio" aria-checked={build.design === key} aria-label={`Design ${i + 1}`} data-key={key} className="ss-design" disabled={pending} onClick={() => set({ design: key })}><Print packed={media[key]} /></button>)}</div>
    </section>
    <section className="ss-pick"><header><h3>2 · Slogan</h3>{rerollBtn('slogan', hand.reroll.slogan)}</header>
      <div className="ss-slogans" role="radiogroup" aria-label="Slogans">{hand.slogans.map(x => <button key={x.id} type="button" role="radio" aria-checked={build.slogan === x.id} data-id={x.id} className="ss-slogan-opt" disabled={pending} onClick={() => set({ slogan: x.id })}>{x.text}</button>)}</div>
    </section>
    <section className="ss-pick ss-pick-row">
      <div><h3>3 · Colour</h3><div className="ss-swatches" role="radiogroup" aria-label="Shirt colour">{SHIRT_COLORS.map((c, i) => <button key={c.name} type="button" role="radio" aria-checked={build.color === i} aria-label={c.name} style={{ '--tee': c.hex } as CSSProperties} disabled={pending} onClick={() => set({ color: i })} />)}</div></div>
      <div><h3>4 · Slogan spot</h3><div className="ss-seg" role="radiogroup" aria-label="Slogan position">{(['top', 'bottom'] as const).map(pos => <button key={pos} type="button" role="radio" data-pos={pos} aria-checked={build.pos === pos} disabled={pending} onClick={() => set({ pos })}>{pos === 'top' ? 'Top' : 'Bottom'}</button>)}</div></div>
    </section>
    {[state, roll].map((s, i) => s.status === 'rejected' && <StatusNotice key={i} tone="error">{s.reason}</StatusNotice>)}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={pending} onClick={() => void run(() => send({ turn: view.turn, k: 'shirt', ...build }))}>{state.status === 'pending' ? 'Stitching…' : 'Send it to the ring'}</ArcadeButton></div>
  </PhoneShell>;
}

/** Both shirts side by side; with `result`, each shows its votes and the loser greys out (a regular-bout tie keeps both lit). */
function Pair({ sides, media, result, decided }: { sides: readonly [ShirtView, ShirtView]; media: Media; result?: ClashResult; decided?: boolean }) {
  return <div className="ss-phone-pair">{sides.map((s, i) => <span key={s.id} data-state={result && decided ? (i === result.winner ? 'win' : 'lose') : undefined}>
    <Tee shirt={s} media={media} />{result && <b className="kp-numeral">{plural(result.voters[i]!.length, 'vote')}</b>}
  </span>)}</div>;
}

function ClashPhone({ view, me, player, players, vip, now, send, media }: Phone) {
  const final = view.phase.startsWith('final'), c = (final ? view.final : view.bout)!, result = c.result;
  const step = useTimeline(view.at, view.phase.endsWith('result') ? [final ? FINAL_RESULT.winner : RESULT.winner] : [Infinity], now) > 0;
  const mine = me.mine ?? [], eyebrow = final ? 'The main event' : `Round ${view.round} · Bout ${view.bout!.index + 1} of ${view.bout!.count}`;
  const voting = view.phase === 'vote' || view.phase === 'final-vote', shell = shellOf(view, player, vip, now, voting);
  if (view.phase.endsWith('result') && result) {
    const pts = myPoints(result, player.id), won = mine.includes(result.winner), lost = mine.length > 0 && !won;
    const parts = [result.points.some((x, i) => x.artist && result.credits[i]!.artist === player.id) && 'art', result.points.some((x, i) => x.writer && result.credits[i]!.writer === player.id) && 'words'].filter(Boolean);
    const tie = result.tie && !final, title = !step ? 'Here come the votes…' : tie ? (won ? 'Tied! You keep the ring.' : lost ? 'Tied! The champ stays on.' : 'A dead heat!')
      : won ? (final ? 'Shirt of the night!' : 'Your shirt wins!') : lost ? 'Knocked out!' : me.vote === undefined ? 'The crowd has spoken.' : me.vote === result.winner ? 'You backed the winner!' : 'Bold choice.';
    return <PhoneShell {...shell} eyebrow={eyebrow} title={title}>
      <div className="ss-phone-result" data-won={(step && won) || undefined}>
        <Avatar avatar={player.avatar} color={player.color} size={124} mood={!step ? 'thinking' : won ? 'happy' : lost ? 'sad' : 'idle'} />
        {step && pts > 0 && <b className="ss-phone-points kp-numeral">+{pts}</b>}
        {step && parts.length > 0 && <p>Your {parts.join(' and ')} scored on {mine.length ? 'your rival’s' : 'someone else’s'} shirt!</p>}
        {step ? <Standing view={view} players={players} player={player} /> : <p className="ss-tv-cue">Eyes on the TV!</p>}
      </div>
      <Pair sides={c.sides} media={media} result={step ? result : undefined} decided={!tie} />
    </PhoneShell>;
  }
  if (mine.length) return <PhoneShell {...shell} eyebrow={eyebrow} title={mine.length > 1 ? 'Both shirts are yours!' : 'Your shirt is in the ring!'}>
    <div className="ss-phone-up"><Tee shirt={c.sides[mine[0]!]} media={media} /><p className="hj-note">No voting in your own bout. Strike a pose and act natural.</p></div>
  </PhoneShell>;
  if (!voting) return <PhoneShell {...shell} eyebrow={eyebrow} title={final ? 'Main event!' : 'Get ready to vote!'}>
    <Pair sides={c.sides} media={media} />
    <p className="ss-tv-cue">Shirts are entering the ring. Eyes on the TV!</p>
  </PhoneShell>;
  return <PhoneShell {...shell} eyebrow={eyebrow} title={me.vote !== undefined ? 'Vote locked in!' : 'Which would you wear?'}>
    <PhoneChoices className="ss-vote" label="Pick a shirt" picked={me.vote !== undefined ? [String(me.vote)] : null} locked={me.vote !== undefined}
      options={c.sides.map((s, i) => ({ id: String(i), label: <><Tee shirt={s} media={media} /><span><small>{final ? `Round ${i + 1} champ` : i ? 'Challenger' : view.bout!.streak ? 'Champ' : 'In the ring'}</small>{s.slogan}</span></>, ariaLabel: `${i ? 'Right' : 'Left'} shirt: ${s.slogan}`, color: i ? 'var(--kp-sky)' : ACCENT }))}
      onSubmit={([side]) => send({ turn: view.turn, k: 'vote', side: Number(side) })} />
  </PhoneShell>;
}

function ChampPhone({ view, player, players, vip, now, media }: Phone) {
  const champ = view.champ!, mine = champ.credits.maker === player.id;
  return <PhoneShell {...shellOf(view, player, vip, now, false)} eyebrow={`Round ${view.round} champion`} title={mine ? 'Your shirt is the champ!' : 'We have a champion!'}>
    <div className="ss-phone-result" data-won={mine || undefined}>
      <div className="ss-phone-champ"><Tee shirt={champ.shirt} media={media} /></div>
      {mine && <b className="ss-phone-points kp-numeral">+{champ.bonus}</b>}
      <Standing view={view} players={players} player={player} />
      <p className="hj-note">{view.round === 1 ? 'Round 2 next: fresh designs, fresh slogans, fresh shirts.' : 'Next: the main event. Both champions, double points.'}</p>
    </div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = find(players, playerId);
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-shirt-show ss-phone">
    {view.phase === 'draw' ? <DrawPhone {...phone} />
      : view.phase === 'write' ? <WritePhone {...phone} />
      : view.phase === 'make' ? <MakePhone {...phone} />
      : view.phase === 'champ' ? <ChampPhone {...phone} />
      : <ClashPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
