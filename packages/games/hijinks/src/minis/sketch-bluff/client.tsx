/* Sketch Bluff screens: the gala gallery TV (studio, unveiling, forgeries, reveals, exhibition) and the phone controller. */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArcadeButton, DrawingPad, DrawingRenderer, StatusNotice } from '../../../../../party-ui/src/index';
import type { Drawing } from '../../../../../party-contract/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, BigTitle, Confetti, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting, Scoreboard, Timer,
  fitText, ordinal, rankOf, useDraft, useNow, useSend,
} from '../../core/ui';
import { FAKE_SUB, FIND_PTS, MAX_LIKES, MAX_TITLE, REAL_SUB, letter, type Beat, type Piece, type SketchPrivate, type SketchPublic } from './types';
import './styles.css';

type P = MiniViewProps<SketchPublic, SketchPrivate>;
type Phone = P & { me: SketchPrivate; player: PackPlayer };
type Shown = Exclude<Beat, { kind: 'tally' }>;
const ACCENT = '#d9a93a';
const find = (players: readonly PackPlayer[], id: string) => players.find(p => p.id === id);
const many = (players: readonly PackPlayer[], ids: readonly string[]) => ids.map(id => find(players, id)).filter(p => !!p);
const plural = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
const art = (media: Record<string, unknown>, key?: string) => key ? media[key] as Drawing | undefined : undefined;
/** Sub-steps of a beat that have started (0 before it, then 1–3). */
const sub = (beat: Shown, t: number) => (beat.kind === 'real' ? REAL_SUB : FAKE_SUB).filter(ms => t - beat.at >= ms).length;

const MEDIUMS = ['Thumb on glass', 'Panic on touchscreen', 'Mixed media: sweat, pixels', 'Digital crayon and regret', 'Fingertip, 80 seconds', 'Oil on phone, sort of', 'Smudge on smartphone'];
const STUDIO_LINES = ['Every artist has a different prompt.', 'No words allowed. Only pictures!', 'Bold lines read best from the sofa.', 'Big shapes. Fewer details. More genius.'];
const WAIT_LINES = [
  'Adjust your monocle. Look unimpressed.', 'Practise saying “derivative” with a sniff.', 'Hold your champagne flute higher.', 'Nod slowly at a blank wall.',
  'Whisper “bold use of negative space”.', 'Pretend you’ve been to Paris.', 'Admire a fire extinguisher. Call it brave.', 'Stroke your chin. Thoughtfully.',
];

// ---------- art direction ----------

/** Velvet-wallpaper gallery with a wood wainscot behind every TV screen. */
const Gallery = () => <div className="sb-wall" aria-hidden="true"><i className="sb-wainscot" /></div>;

/** Brass stanchions and sagging velvet ropes along the gallery floor. */
function Ropes() {
  const posts = [80, 560, 1040, 1520, 2000];
  return <svg className="sb-ropes" viewBox="0 0 2080 120" aria-hidden="true">
    {posts.slice(1).map((x, i) => <path key={x} className="sb-rope" d={`M${posts[i]! + 8} 30Q${(posts[i]! + x) / 2} 104 ${x - 8} 30`} />)}
    {posts.map(x => <g key={x} className="sb-post"><rect x={x - 7} y={26} width={14} height={86} rx={5} /><circle cx={x} cy={22} r={15} /><ellipse cx={x} cy={114} rx={34} ry={7} /></g>)}
  </svg>;
}

function Monocle({ className = '' }: { className?: string }) {
  return <svg className={`sb-monocle ${className}`} viewBox="0 0 120 150" aria-hidden="true">
    <path className="sb-monocle-chain" d="M88 92Q100 120 92 146" />
    <circle className="sb-monocle-rim" cx="52" cy="52" r="42" /><circle className="sb-monocle-glass" cx="52" cy="52" r="32" />
    <path className="sb-monocle-shine" d="M34 36Q42 26 56 26" />
  </svg>;
}

/** A gilded frame. With a drawing it shows the art; `cover` hangs a velvet drape over it; otherwise `children` fill the canvas. */
function Frame({ drawing, label = 'A masterpiece', cover, className = '', children }: { drawing?: Drawing; label?: string; cover?: boolean; className?: string; children?: ReactNode }) {
  return <figure className={`sb-frame ${className}`} data-cover={cover || undefined}>
    <div className="sb-canvas">{drawing ? <DrawingRenderer drawing={drawing} label={label} /> : children}</div>
    {cover && <div className="sb-drape" role="img" aria-label="Drawing finished"><i className="sb-tassel" /></div>}
  </figure>;
}

/** Museum label: a title in gallery italics, with optional kicker and footer lines. */
function Placard({ title, kicker, footer, size = 56, className = '', children }: { title: ReactNode; kicker?: ReactNode; footer?: ReactNode; size?: number; className?: string; children?: ReactNode }) {
  return <div className={`sb-placard ${className}`}>
    {kicker && <span className="sb-placard-kicker">{kicker}</span>}
    <p className="sb-title-text" style={{ fontSize: typeof title === 'string' ? fitText(title, size) : size }}>{title}</p>
    {footer && <span className="sb-placard-foot">{footer}</span>}
    {children}
  </div>;
}

function Head({ view, children }: { view: SketchPublic; children?: ReactNode }) {
  const chip = view.rounds === 1 ? 'Grand Gala' : view.round === 1 ? `Round 1 of ${view.rounds}` : 'Round 2 · Double points';
  return <header className="sb-head">
    <span className="sb-sign"><Monocle className="sb-sign-monocle" /><span className="kp-title">Sketch <em>Bluff</em></span></span>
    <span className="sb-round" data-round={view.round}>{chip}</span>
    <span className="sb-head-side">{children}</span>
  </header>;
}

/** Who still owes a title or guess, as a compact avatar grid with done ticks. */
function Roster({ players, done, label, compact }: { players: readonly PackPlayer[]; done: readonly string[]; label: ReactNode; compact?: boolean }) {
  return <div className="sb-roster" data-compact={compact || undefined}>
    <p className="sb-roster-label"><b className="kp-numeral">{players.filter(p => done.includes(p.id)).length}/{players.length}</b> {label}</p>
    <ol>{players.map(p => { const lit = done.includes(p.id); return <li key={p.id} data-lit={lit || undefined} data-offline={!p.connected || undefined} style={{ '--c': p.color } as CSSProperties}>
      <Avatar avatar={p.avatar} color={p.color} size={compact ? 52 : 60} mood={!p.connected ? 'sad' : lit ? 'done' : 'thinking'} /><span className={compact ? 'hj-sr' : undefined}>{p.name}</span>
    </li>; })}</ol>
  </div>;
}

// ---------- TV ----------

function DrawTV({ view, players, vip, now }: P) {
  const n = players.length, cols = n <= 5 ? n : n <= 6 ? 3 : Math.ceil(n / 2), t = useNow(now, 1000), line = Math.floor(Math.max(0, t - view.at) / 7000) % STUDIO_LINES.length;
  return <section className="sb-draw">
    <Head view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={132} /></Head>
    <div className="sb-draw-copy">
      <BigTitle size={96} kicker={view.round > 1 ? 'New prompts, fresh paint' : 'The studio is open'}>Draw your secret masterpiece!</BigTitle>
      <p className="sb-studio-line" key={line}>{STUDIO_LINES[line]}</p>
    </div>
    <ol className="sb-studio" style={{ '--cols': cols } as CSSProperties} data-big={n <= 5 || undefined}>
      {players.map((p, i) => { const done = view.done.includes(p.id); return <li key={p.id} style={{ '--c': p.color, animationDelay: `${i * 70}ms` } as CSSProperties} data-done={done || undefined}>
        <Frame cover={done}><Avatar avatar={p.avatar} color={p.color} size={n <= 5 ? 120 : 92} mood={!p.connected ? 'sad' : 'thinking'} crown={vip === p.id} /><i className="sb-pencil" /></Frame>
        <span className="sb-nameplate">{p.name}</span>
      </li>; })}
    </ol>
  </section>;
}

/** The piece on the wall, under its picture light, with the artist's badge on a brass plate. Stays mounted from title to reveal. */
function Wall({ piece, players, media, big }: { piece: Piece; players: readonly PackPlayer[]; media: Record<string, unknown>; big: boolean }) {
  const artist = find(players, piece.artist);
  return <div className="sb-hang" data-big={big || undefined}>
    <i className="sb-light" aria-hidden="true" />
    <Frame key={piece.art} className="sb-unveil" drawing={art(media, piece.art)} label={`Drawing by ${artist?.name ?? 'an artist'}`} />
    {artist && <span className="sb-artist-plate"><small>Artist</small><AvatarBadge player={artist} size={56} /></span>}
  </div>;
}

function TitleSide({ view, piece, players }: P & { piece: Piece }) {
  const artist = find(players, piece.artist);
  return <>
    <Placard className="sb-label-card" kicker={`Piece ${piece.index + 1} of ${piece.count} · ${artist?.name ?? 'Anonymous'}`} title={<>Untitled<span className="sb-qq">???</span></>} size={88}
      footer={`${MEDIUMS[(piece.index + view.round) % MEDIUMS.length]}, ${new Date(view.at).getFullYear()}`} />
    <p className="sb-ask"><b>Forge a fake title</b> on your phone.<small>Make it sound real. Every friend you fool pays you.</small></p>
    <Roster players={players.filter(p => p.id !== piece.artist)} done={view.done} label="forgeries filed" />
  </>;
}

function GuessSide({ view, piece, players }: P & { piece: Piece }) {
  // One type size for the whole board, set by the longest title, so every plaque reads as equal.
  const options = view.options ?? [], size = fitText(options.reduce((a, o) => o.text.length > a.length ? o.text : a, ''), options.length > 5 ? 36 : 48);
  return <>
    <p className="sb-ask sb-ask-guess"><b>Which is the real title?</b></p>
    <ol className="sb-options" data-cols={options.length > 5 ? 2 : 1}>
      {options.map((o, i) => <li key={o.id} style={{ animationDelay: `${i * 90}ms` }}><span className="sb-letter kp-title">{letter(i)}</span><span className="sb-title-text" style={{ fontSize: size }}>{o.text}</span></li>)}
    </ol>
    <Roster players={players.filter(p => p.id !== piece.artist)} done={view.done} label="guesses in · ♥ your favourite titles" compact={options.length > 5} />
  </>;
}

/** Who fell for a title (or found the real one): names matter, so badges rather than a bare avatar stack. */
function Who({ label, players, mood, children }: { label: string; players: readonly PackPlayer[]; mood: 'happy' | 'sad'; children?: ReactNode }) {
  return <div className="sb-who" data-many={players.length > 4 || undefined}><span>{label}</span>
    {players.map((p, i) => <span key={p.id} className="sb-who-badge" style={{ animationDelay: `${i * 80}ms` }}><AvatarBadge player={p} size={players.length > 4 ? 44 : 56} mood={mood} /></span>)}{children}</div>;
}

function Verdict({ beat, step, round, players }: { beat: Shown; step: number; round: number; players: readonly PackPlayer[] }) {
  if (beat.kind === 'real') {
    const found = many(players, beat.found), artist = find(players, beat.artist);
    return <div className="sb-verdict sb-verdict-real">
      {step >= 2 && <Who label={found.length ? 'Spotted it' : 'Nobody spotted it!'} players={found} mood="happy">{found.length > 0 && <b className="sb-pts kp-numeral">+{(FIND_PTS * round).toLocaleString()} each</b>}</Who>}
      {step >= 3 && artist && <div className="sb-artist-win" data-sad={!found.length || undefined}>
        <Avatar avatar={artist.avatar} color={artist.color} size={130} mood={found.length ? 'happy' : 'sad'} />
        <p><b>{artist.name}</b>{found.length ? <> earns <em className="kp-numeral">+{beat.points.toLocaleString()}</em> for {plural(found.length, 'fan')}</> : ' gets nothing. The artist weeps.'}</p>
        {found.length > 0 && <Confetti burst={beat.id} count={90} />}
      </div>}
    </div>;
  }
  const fooled = many(players, beat.fooled), author = beat.kind === 'fake' ? find(players, beat.author) : undefined;
  return <div className="sb-verdict">
    {step >= 2 && <Who label="Fell for it" players={fooled} mood="sad" />}
    {step >= 3 && <div className="sb-stamp-row">
      <span className="sb-stamp kp-title" data-house={!author || undefined}>{author ? 'Forgery!' : 'House forgery!'}</span>
      {author && beat.kind === 'fake' ? <><AvatarBadge player={author} size={64} mood="happy" /><b className="sb-pts kp-numeral">+{beat.points.toLocaleString()}</b></> : <><Monocle className="sb-house-monocle" /><span className="sb-house">The gallery fooled you!</span></>}
    </div>}
  </div>;
}

function Tally({ beat, players }: { beat: Extract<Beat, { kind: 'tally' }>; players: readonly PackPlayer[] }) {
  const rows = Object.entries(beat.gains).sort((a, b) => b[1] - a[1]).map(([id, pts]) => ({ p: find(players, id), pts, likes: beat.likes[id] ?? 0 })).filter(r => !!r.p);
  return <div className="sb-tally">
    <BigTitle size={70} kicker="This piece earned">{rows.length ? 'The take' : 'Not a penny!'}</BigTitle>
    {rows.length ? <ol data-cols={rows.length > 5 ? 2 : 1}>{rows.map(({ p, pts, likes }, i) => <li key={p!.id} style={{ animationDelay: `${i * 120}ms` }}>
      <AvatarBadge player={p!} size={56} mood="happy" />{likes > 0 && <span className="sb-hearts" aria-label={plural(likes, 'like')}>♥ {likes}</span>}<b className="kp-numeral">+{pts.toLocaleString()}</b>
    </li>)}</ol> : <p className="sb-empty">Art is hard. Nobody scored on this one.</p>}
  </div>;
}

function RevealSide({ view, players, now }: P) {
  const t = useNow(now, 100), beats = view.beats ?? [], last = beats.at(-1), shown = beats.filter((b): b is Shown => b.kind !== 'tally'), current = shown.at(-1);
  const step = current ? sub(current, t) : 0, history = last?.kind === 'tally' ? [] : shown.filter((b): b is Exclude<Shown, { kind: 'real' }> => b.kind !== 'real' && b !== current);
  return <>
    {last?.kind === 'tally' ? <Tally beat={last} players={players} />
      : !current ? <BigTitle size={84} kicker="The forgeries…">Let’s see who fell for what</BigTitle>
      : <div className="sb-spot" key={current.id} data-kind={current.kind}>
        <Placard className="sb-reveal-card" kicker={current.kind === 'real' ? 'And the real title is…' : 'Some of you picked…'} title={current.text} size={72}>
          {current.kind === 'real' && step >= 2 && <span className="sb-genuine kp-title">Genuine</span>}
        </Placard>
        <Verdict beat={current} step={step} round={view.round} players={players} />
      </div>}
    {history.length > 0 && <ul className="sb-history">{history.slice(-4).map(b => <li key={b.id} data-house={b.kind === 'house' || undefined}>
      <span className="sb-title-text">{b.text}</span><small>{b.kind === 'fake' ? find(players, b.author)?.name ?? 'Someone' : 'House'} · {plural(b.fooled.length, 'fooled', 'fooled')}</small>
    </li>)}</ul>}
  </>;
}

function GalleryTV(props: P & { piece: Piece }) {
  const { view, piece, players, media, now } = props;
  return <section className="sb-gallery" data-phase={view.phase}>
    <Head view={view}>{view.phase === 'reveal'
      ? <span className="sb-count">Piece {piece.index + 1} of {piece.count}</span>
      : <Timer key={view.turn} deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} />}</Head>
    <div className="sb-gallery-main">
      <Wall piece={piece} players={players} media={media} big={view.phase === 'title'} />
      <div className="sb-side" key={view.phase}>
        {view.phase === 'title' ? <TitleSide {...props} /> : view.phase === 'guess' ? <GuessSide {...props} /> : <RevealSide {...props} />}
      </div>
    </div>
  </section>;
}

function ScoresTV({ view, players, media }: P) {
  const prev = view.prev ?? {}, pieces = view.pieces ?? [], gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  const last = view.round >= view.rounds, n = pieces.length, cols = n <= 3 ? Math.max(1, n) : n === 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  return <section className="sb-scores">
    <Head view={view} />
    <div className="sb-scores-main">
      <div className="sb-exhibit">
        <BigTitle size={72} kicker={last ? 'Tonight’s exhibition' : `After round ${view.round}`}>{pieces.length ? 'The collection' : 'An empty gallery'}</BigTitle>
        {pieces.length ? <ol style={{ '--cols': cols, '--art': `${n <= 4 ? 210 : n <= 6 ? 176 : 150}px` } as CSSProperties}>{pieces.map((p, i) => <li key={p.art} style={{ animationDelay: `${i * 110}ms` }}>
          <Frame drawing={art(media, p.art)} label={p.title} />
          <span className="sb-title-text">{p.title}</span><small>{find(players, p.artist)?.name}</small>
        </li>)}</ol> : <p className="sb-empty">Nobody finished a drawing. The critics are furious.</p>}
        {!last && <p className="sb-next">Round 2: new prompts, <b>double</b> points!</p>}
      </div>
      <Scoreboard players={players} scores={view.scores} from={prev} delay={1100} rowHeight={players.length > 8 ? 76 : 88} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
    </div>
  </section>;
}

function Display(props: P) {
  const { view } = props, piece = view.piece;
  return <div className="hj-sketch-bluff sb-tv" data-phase={view.phase}>
    <Gallery />
    {view.phase === 'draw' ? <DrawTV {...props} />
      : view.phase === 'scores' ? <ScoresTV {...props} />
      : piece ? <GalleryTV {...props} piece={piece} /> : null}
    <Ropes />
  </div>;
}

// ---------- phone ----------

const shellOf = (view: SketchPublic, player: PackPlayer, vip: string | null, now: () => number, timed = true) =>
  ({ player, vip: vip === player.id, accent: ACCENT, ...(timed ? { timer: { deadline: view.deadline, now, total: view.deadline - view.at } } : {}) });

function Standing({ view, players, player }: { view: SketchPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  return <p className="sb-standing"><b className="kp-title">{ordinal(rankOf(view.scores, player.id, players.map(p => p.id)))}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>;
}

/** Drawing pad with a persisted draft. It hands in a started drawing by itself just before time runs out. */
function DrawPhone({ view, me, player, players, vip, now, send, sessionKey }: Phone) {
  const key = `${sessionKey}:${view.turn}:art`, [drawing, setDrawing] = useDraft<Drawing>(key, { strokes: [] }), [state, run] = useSend(), t = useNow(now, 500), auto = useRef(false);
  const submit = () => run(() => send({ turn: view.turn, k: 'draw', drawing }));
  const late = view.deadline - t < 1800, pad = useRef<HTMLDivElement>(null);
  // Short landscape phones: centre the pad (now and after rotating) so the whole canvas is under the thumb.
  useEffect(() => {
    const query = matchMedia('(orientation: landscape) and (max-height: 500px)'), fit = () => { if (query.matches) pad.current?.querySelector('.kp-drawing-surface')?.scrollIntoView({ block: 'center' }); };
    fit(); query.addEventListener('change', fit);
    return () => query.removeEventListener('change', fit);
  }, [me.drawn]);
  useEffect(() => { if (late && !me.drawn && drawing.strokes.length && !auto.current) { auto.current = true; void submit(); } });
  const shell = shellOf(view, player, vip, now);
  if (me.drawn) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow="Your masterpiece" title="Hung in the gallery!">
      <PhoneDone title="Framed!" detail="Act casual. Nobody knows what it’s meant to be.">{drawing.strokes.length > 0 && <Frame className="sb-phone-frame" drawing={drawing} label="Your drawing" />}</PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Other artists still painting" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  const pending = state.status === 'pending';
  return <PhoneShell {...shell}>
    <div className="sb-pad" ref={pad}>
      <p className="sb-prompt"><small>{view.round > 1 ? 'Round 2 · double points' : 'Draw in secret'}</small>{me.prompt}</p>
      <DrawingPad value={drawing} onChange={setDrawing} disabled={pending} label="Your drawing" />
      <p className="sb-rule">No words or letters. Only pictures!</p>
      {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
      <div className="sb-pad-send"><ArcadeButton tone="lime" size="lg" disabled={pending || !drawing.strokes.length} onClick={() => void submit()}>{pending ? 'Hanging…' : 'Hang it in the gallery'}</ArcadeButton></div>
    </div>
  </PhoneShell>;
}

function MiniArt({ view, media }: { view: SketchPublic; media: Record<string, unknown> }) {
  const drawing = art(media, view.piece?.art);
  return drawing ? <Frame className="sb-phone-frame" drawing={drawing} label="The piece on the wall" /> : null;
}

function TitlePhone({ view, me, player, players, vip, now, send, sessionKey, media }: Phone) {
  const [house, run] = useSend(), [open, setOpen] = useDraft(`${sessionKey}:${view.turn}:offers`, false), shell = shellOf(view, player, vip, now), offers = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) offers.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  const piece = view.piece!, eyebrow = `Piece ${piece.index + 1} of ${piece.count} · by ${find(players, piece.artist)?.name ?? 'a mystery artist'}`;
  if (me.artist) return <PhoneShell {...shell} eyebrow={eyebrow} title="That’s your masterpiece!">
    <MiniArt view={view} media={media} />
    <Placard className="sb-phone-placard" kicker="The real title" title={me.prompt ?? ''} size={26} />
    <p className="hj-note">Keep a straight face. Everyone else is forging a fake title for it.</p>
  </PhoneShell>;
  if (me.title !== undefined) {
    const waiting = players.filter(p => p.connected && p.id !== piece.artist && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow={eyebrow} title="Forgery filed!">
      <PhoneDone detail="Now look innocent."><Placard className="sb-phone-placard" kicker="Your fake title" title={me.title} size={26} /></PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the other forgers" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell} eyebrow={eyebrow}>
    <MiniArt view={view} media={media} />
    <PhoneTextEntry multiline label="Write a fake title for this piece" draftKey={`${sessionKey}:${view.turn}:title`} maxLength={MAX_TITLE} placeholder="Copy the style: “a moose doing karate”"
      submitLabel="File my forgery" onSubmit={text => send({ turn: view.turn, k: 'title', text })} />
    {!open ? <ArcadeButton tone="ghost" size="md" className="sb-offer-btn" onClick={() => setOpen(true)}>Stuck? Title for me</ArcadeButton>
      : <div className="sb-offers" ref={offers} role="group" aria-label="House titles"><p>Tap one to file it:</p>
        {(me.suggestions ?? []).map(text => <button key={text} type="button" className="sb-offer sb-title-text" disabled={house.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'title', text }))}>{text}</button>)}
      </div>}
    {house.status === 'rejected' && <StatusNotice tone="error">{house.reason}</StatusNotice>}
  </PhoneShell>;
}

function GuessPhone({ view, me, player, vip, now, send, media }: Phone) {
  const [picking, runPick] = useSend(), [liking, runLike] = useSend(), options = view.options ?? [], likes = me.likes ?? [], shell = shellOf(view, player, vip, now);
  const title = me.artist ? 'They’re guessing!' : me.pick ? 'Guess locked in!' : 'Which is the real title?';
  return <PhoneShell {...shell} eyebrow={me.artist ? 'Your masterpiece' : `Piece ${view.piece!.index + 1} of ${view.piece!.count}`} title={title}>
    <MiniArt view={view} media={media} />
    <p className="sb-like-hint">{me.artist ? 'Give a ♥ to the funniest forgeries.' : me.pick ? 'Now ♥ the titles you love.' : 'Tap the title you think is real. ♥ the ones you love.'} <b className="kp-numeral">{likes.length}/{MAX_LIKES} ♥</b></p>
    <ol className="sb-ballot">{options.map((o, i) => {
      const mine = o.id === me.mine, picked = o.id === me.pick, liked = likes.includes(o.id);
      return <li key={o.id} className="sb-option" data-id={o.id} data-mine={mine || undefined} data-picked={picked || undefined}>
        <button type="button" className="sb-pick" disabled={!!me.artist || !!me.pick || mine || picking.status === 'pending'} aria-pressed={picked}
          onClick={() => void runPick(() => send({ turn: view.turn, k: 'guess', option: o.id }))}>
          <span className="sb-letter kp-title">{letter(i)}</span><span className="sb-title-text">{o.text}</span>
          {mine ? <em>{me.artist ? 'Real title' : 'Your forgery'}</em> : picked && <em>Your guess</em>}
        </button>
        {!mine && <button type="button" className="sb-like" aria-pressed={liked} aria-label={`${liked ? 'Unlike' : 'Like'} ${o.text}`} disabled={liking.status === 'pending' || (!liked && likes.length >= MAX_LIKES)}
          onClick={() => void runLike(() => send({ turn: view.turn, k: 'like', option: o.id, on: !liked }))}>♥</button>}
      </li>;
    })}</ol>
    {[picking, liking].map((s, i) => s.status === 'rejected' && <StatusNotice key={i} tone="error">{s.reason}</StatusNotice>)}
  </PhoneShell>;
}

/** My outcome lines, each appearing when the TV reaches its beat. */
function outcomes(beats: readonly Beat[], me: SketchPrivate, playerId: string, players: readonly PackPlayer[], t: number) {
  const out: { tone: 'good' | 'bad'; text: string }[] = [];
  for (const b of beats) {
    if (b.kind === 'tally') continue;
    const step = sub(b, t);
    if (b.kind === 'real') {
      if (step >= 2 && b.found.includes(playerId)) out.push({ tone: 'good', text: 'You spotted the real title!' });
      if (step >= 3 && b.artist === playerId) out.push(b.found.length ? { tone: 'good', text: `${plural(b.found.length, 'friend')} found your real title!` } : { tone: 'bad', text: 'Nobody found your real title.' });
      continue;
    }
    if (step < 3) continue;
    if (b.fooled.includes(playerId)) out.push({ tone: 'bad', text: b.kind === 'house' ? 'The house forgery fooled you!' : `You fell for ${find(players, b.author)?.name ?? 'someone'}’s forgery!` });
    if (b.kind === 'fake' && b.author === playerId) out.push({ tone: 'good', text: `Your forgery fooled ${plural(b.fooled.length, 'player')}!` });
  }
  if (!me.artist && !me.pick && beats.some(b => b.kind === 'tally')) out.unshift({ tone: 'bad', text: 'You didn’t guess this time.' });
  return out;
}

function RevealPhone({ view, me, player, players, vip, now, playerId, media }: Phone) {
  const t = useNow(now, 200), beats = view.beats ?? [], tally = beats.find(b => b.kind === 'tally'), gain = tally?.kind === 'tally' ? tally.gains[player.id] ?? 0 : 0;
  const lines = outcomes(beats, me, playerId!, players, t), title = (id?: string) => view.options?.find(o => o.id === id)?.text;
  const stake = me.artist ? undefined : title(me.pick), forged = me.artist ? me.prompt : title(me.mine);
  return <PhoneShell {...shellOf(view, player, vip, now, false)} eyebrow={`Piece ${view.piece!.index + 1} of ${view.piece!.count}`} title={tally ? (gain ? `+${gain.toLocaleString()} this piece!` : 'No points this time') : 'Eyes on the TV!'}>
    {!tally && <MiniArt view={view} media={media} />}
    <div className="sb-result" data-won={(tally && gain > 0) || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={120} mood={tally ? (gain ? 'happy' : 'sad') : 'thinking'} />
      {!tally && (stake || forged) && <dl className="sb-stakes">{stake && <><dt>Your guess</dt><dd className="sb-title-text">{stake}</dd></>}{forged && <><dt>{me.artist ? 'Real title' : 'Your forgery'}</dt><dd className="sb-title-text">{forged}</dd></>}</dl>}
      {lines.length ? <ul>{lines.map((l, i) => <li key={i} data-tone={l.tone}>{l.text}</li>)}</ul> : <p className="sb-cue">The forgeries are being unmasked…</p>}
      {tally && <Standing view={view} players={players} player={player} />}
    </div>
  </PhoneShell>;
}

function ScoresPhone({ view, player, players, vip, now }: Phone) {
  const last = view.round >= view.rounds;
  return <PhoneShell {...shellOf(view, player, vip, now, false)} eyebrow={last ? 'Tonight’s exhibition' : `After round ${view.round}`} title={last ? 'That’s the gala!' : 'Intermission'}>
    <div className="sb-result"><Avatar avatar={player.avatar} color={player.color} size={120} mood={rankOf(view.scores, player.id, players.map(p => p.id)) === 1 ? 'happy' : 'idle'} />
      <Standing view={view} players={players} player={player} />
      <p className="hj-note">{last ? 'Look at the TV for the final standings.' : 'Round 2 has new prompts and double points. Sharpen your fingers!'}</p></div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the gala!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-sketch-bluff sb-phone" data-phase={view.phase}>
    {view.phase === 'draw' ? <DrawPhone {...phone} />
      : view.phase === 'title' ? <TitlePhone {...phone} />
      : view.phase === 'guess' ? <GuessPhone {...phone} />
      : view.phase === 'reveal' ? <RevealPhone {...phone} />
      : <ScoresPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
