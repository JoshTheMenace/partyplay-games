/* Tall Tales screens: the tabloid newsroom TV (front pages, clippings, FIB!/TRUTH stamps) and the phone controller. */
import type { CSSProperties, ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, AvatarStack, Confetti, PhoneChoices, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting, PlayerStrip, Scoreboard, Timer,
  fitText, ordinal, rankOf, useNow, useSend, useTimeline,
} from '../../core/ui';
import { FOOL_PTS, HOUSE_RATE, LIE_STEPS, LIKES, LIKE_PTS, MAX_LIE, QUESTIONS, ROUNDS, TRUTH_PTS, TRUTH_STEPS, letter, stampAt, type Beat, type Option, type TallPrivate, type TallPublic } from './types';
import './styles.css';

type P = MiniViewProps<TallPublic, TallPrivate>;
type Phone = P & { me: TallPrivate; player: PackPlayer };
type Fact = NonNullable<TallPublic['fact']>;
const ACCENT = '#e0301e';
const find = (players: readonly PackPlayer[], id: string) => players.find(p => p.id === id);
const people = (players: readonly PackPlayer[], ids: readonly string[]) => ids.map(id => find(players, id)).filter(p => !!p);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list: readonly PackPlayer[]) => list.length <= 2 ? list.map(p => p.name).join(' & ') : `${list.slice(0, -1).map(p => p.name).join(', ')} & ${list.at(-1)!.name}`;
const round = (view: TallPublic) => ROUNDS[view.round - 1]!;
const shell = (view: TallPublic, player: PackPlayer, vip: string | null, now: () => number, timer = true) =>
  ({ player, vip: vip === player.id, accent: ACCENT, ...(timer ? { timer: { deadline: view.deadline, now, total: view.deadline - view.at } } : {}) });

const DESK_LINES = [
  'Make it sound boring. Boring is believable.', 'The best lies are oddly specific.', 'Don’t be funny. Be convincing. Okay, be a bit funny.',
  'Think like a fact-checker. Then lie to one.', 'If it sounds too silly, it might be the truth.', 'Stuck? The Tribune will lie for you.',
];
const WAIT_LINES = [
  'Practise your innocent face.', 'Look shocked when the truth comes out.', 'Somebody here is a professional liar.', 'Read the room. Then fool it.',
  'Trust nobody. Especially the paper.', 'Hold the front page!', 'Rehearse “I knew it all along.”',
];

// ---------- shared newsprint pieces ----------

/** The story with its blank: an empty red rule, or the revealed answer stamped in. An empty blank stays glued to the word
    before it and the punctuation after it, so it never wraps onto a line of its own. */
function Story({ text, fill, size, inline }: { text: string; fill?: string; size?: number; inline?: boolean }) {
  const [before = '', after = ''] = text.split('___'), Tag = inline ? 'span' : 'p';
  const lead = fill ? '' : before.match(/\S*\s?$/)![0], tail = fill ? '' : after.match(/^\S*/)![0];
  return <Tag className="tt-story" style={size ? { fontSize: size } : undefined}>{before.slice(0, before.length - lead.length)}<span className="tt-glue">{lead}<span className="tt-blank" data-fill={fill ? true : undefined}>{fill ?? <span className="hj-sr">blank</span>}</span>{tail}</span>{after.slice(tail.length)}</Tag>;
}

function Masthead({ view, children }: { view: TallPublic; children?: ReactNode }) {
  const r = round(view), story = view.phase === 'scores' || view.phase === 'round' ? null : view.q + 1;
  return <header className="tt-mast">
    <span className="tt-burst kp-title" aria-hidden="true">Extra!</span>
    <div className="tt-mast-title">
      <b className="kp-title">The Tall Tales Tribune</b>
      <small><span>{r.name}</span><span>{r.mult > 1 ? `${r.mult}× points` : 'Late edition'}</span>{story && <span>Story {story} of {QUESTIONS}</span>}<span>Price: one fib</span></small>
    </div>
    <span className="tt-mast-side">{children}</span>
  </header>;
}

/** Dark press-room band along the bottom of the page. */
const Band = ({ children }: { children: ReactNode }) => <footer className="tt-band">{children}</footer>;

function Typewriter() {
  return <svg className="tt-typewriter" viewBox="0 0 320 270" aria-hidden="true">
    <path className="tt-tw-paper" d="M96 12h128v96H96z" /><path className="tt-tw-lines" d="M110 34h100M110 52h84M110 70h96M110 88h60" />
    <rect className="tt-tw-roller" x="54" y="100" width="212" height="26" rx="13" /><circle className="tt-tw-knob" cx="46" cy="113" r="16" /><circle className="tt-tw-knob" cx="274" cy="113" r="16" />
    <path className="tt-tw-lever" d="M266 100l38-26" />
    <path className="tt-tw-body" d="M40 132h240l26 104H14z" />
    <path className="tt-tw-plate" d="M120 146h80l6 22h-92z" />
    {[0, 1, 2].map(row => Array.from({ length: 8 - row }, (_, i) => <circle key={`${row}-${i}`} className="tt-tw-key" cx={78 + row * 12 + i * 24} cy={186 + row * 22} r="9" />))}
    <rect className="tt-tw-key" x="110" y="244" width="100" height="14" rx="7" />
  </svg>;
}

// ---------- TV ----------

function RoundTV({ view }: P) {
  const r = round(view), final = view.round === 3;
  return <section className="tt-round" key={view.round}>
    <div className="tt-front-page" data-final={final || undefined}>
      <p className="tt-fp-kicker">Extra! Extra! Read all about it!</p>
      <h1 className="kp-title">{r.name}</h1>
      <p className="tt-fp-deck">{r.blurb}</p>
      <div className="tt-fp-cols">
        <div className="tt-fp-photo"><Typewriter /></div>
        <div className="tt-fp-text"><b>How it works</b><p>One true story, one missing word. Write a lie so believable your friends pick it over the truth.</p></div>
        <div className="tt-fp-text"><b>Scoring</b><p>{(TRUTH_PTS * r.mult).toLocaleString()} for finding the truth. {(FOOL_PTS * r.mult).toLocaleString()} for every friend you fool. {LIKE_PTS} per like.</p></div>
      </div>
    </div>
  </section>;
}

function PickTV({ view, players, vip, now }: P) {
  const chooser = view.chooser ? find(players, view.chooser) : undefined, picked = view.picked;
  return <section className="tt-picker">
    <Masthead view={view}>{picked === undefined && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} />}</Masthead>
    <div className="tt-pick-main">
      <div className="tt-editor">
        <p className="tt-label">Editor’s desk</p>
        {chooser && <div className="tt-photo"><Avatar avatar={chooser.avatar} color={chooser.color} size={210} mood={picked === undefined ? 'thinking' : 'happy'} /></div>}
        <p className="tt-editor-line"><b>{chooser?.name}</b>{picked === undefined ? ' is picking today’s story…' : ' picked the story!'}</p>
      </div>
      <ol className="tt-sections">
        {(view.cats ?? []).map((teaser, i) => <li key={i} data-picked={picked === i || undefined} data-dim={(picked !== undefined && picked !== i) || undefined} style={{ animationDelay: `${i * 90}ms` }}>
          <span className="tt-section-tab">Section {letter(i)}</span>
          <b style={{ fontSize: fitText(teaser, 62) }}>{teaser}</b>
          {picked === i && <span className="tt-stamp tt-stamp-sm">Picked!</span>}
        </li>)}
      </ol>
    </div>
    <Band><PlayerStrip players={players} vip={vip} size={players.length > 8 ? 72 : 88} /></Band>
  </section>;
}

function WriteTV({ view, players, vip, now }: P) {
  const fact = view.fact!, t = useNow(now, 1000), line = Math.floor(Math.max(0, t - view.at) / 7000) % DESK_LINES.length;
  return <section className="tt-write">
    <Masthead view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={124} /></Masthead>
    <div className="tt-write-main">
      <article className="tt-clip tt-lead" key={view.turn}>
        <span className="tt-label">{fact.teaser}</span>
        <Story text={fact.text} size={fitText(fact.text, 92)} />
        <p className="tt-true">✔ True story. Every word, except yours.</p>
      </article>
      <aside className="tt-desk">
        <Typewriter />
        <div className="tt-tally" role="status"><b className="kp-numeral">{view.done.length}<small>/{players.length}</small></b><span>lies filed</span></div>
        <p className="tt-desk-line" key={line}>{DESK_LINES[line]}</p>
      </aside>
    </div>
    <p className="tt-instruct"><b>Fill the blank with a believable lie</b> on your phone.</p>
    <Band><PlayerStrip players={players} done={view.done} vip={vip} /></Band>
  </section>;
}

function ChooseTV({ view, players, vip, now }: P) {
  const options = view.options ?? [], n = options.length, cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  return <section className="tt-choose">
    <Masthead view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} /></Masthead>
    <article className="tt-clip tt-headline"><Story text={view.fact!.text} size={fitText(view.fact!.text, 58)} /></article>
    <p className="tt-instruct"><b>One of these is true.</b> Find it on your phone, and ♥ your favourite lies.</p>
    <ol className="tt-clips" style={{ '--cols': cols } as CSSProperties} data-dense={n > 6 || undefined}>
      {options.map((o, i) => <li key={o.id} className="tt-cutting" style={{ animationDelay: `${i * 70}ms` }}>
        <span className="tt-letter">{letter(i)}</span><p style={{ fontSize: fitText(o.text, n > 9 ? 40 : n > 6 ? 46 : n > 4 ? 52 : 64) }}>{o.text}</p>
      </li>)}
    </ol>
    <Band><PlayerStrip players={players} done={view.done} vip={vip} size={72} /></Band>
  </section>;
}

/** One reveal beat, timed from its server start so a reloaded TV lands on the same moment. */
function BeatTV({ beat, players, now }: { beat: Beat; players: readonly PackPlayer[]; now: () => number }) {
  const offsets = beat.kind === 'truth' ? [TRUTH_STEPS.stamp, TRUTH_STEPS.found] : beat.kind === 'likes' ? [600] : [LIE_STEPS.fooled, LIE_STEPS.stamp, LIE_STEPS.points];
  const step = useTimeline(beat.at, offsets, now);
  if (beat.kind === 'likes') return <div className="tt-beat tt-likes">
    <h2 className="kp-title">Readers’ favourites</h2>
    <ol>{beat.top.slice(0, 3).map((t, i) => <li key={t.id} style={{ animationDelay: `${300 + i * 250}ms` }}>
      <b className="tt-hearts kp-numeral">♥ {t.likes}</b>
      <p style={{ fontSize: fitText(t.text, 60) }}>{t.text}</p>
      <span className="tt-byline-row">{people(players, t.authors).map(p => <AvatarBadge key={p.id} player={p} size={56} mood="happy" />)}</span>
      {step >= 1 && <b className="tt-points kp-numeral">+{t.likes * LIKE_PTS}</b>}
    </li>)}</ol>
    {beat.top.length > 3 && <p className="tt-more">…and {plural(beat.top.length - 3, 'more liked lie')}. Every like pays {LIKE_PTS}.</p>}
  </div>;
  if (beat.kind === 'truth') {
    const found = people(players, beat.found);
    return <div className="tt-beat tt-truth" data-step={step}>
      <p className="tt-beat-label">And the truth is…</p>
      <div className="tt-clip tt-big-clip" data-truth={step >= 1 || undefined}>
        <p style={{ fontSize: fitText(beat.text, 104) }}>{beat.text}</p>
        {step >= 1 && <span className="tt-stamp tt-stamp-truth">Truth</span>}
      </div>
      <div className="tt-found">{step >= 2 && (found.length
        ? <><span className="tt-beat-label">Found it!</span><AvatarStack players={found} size={92} max={10} /><b className="tt-points kp-numeral">+{beat.points.toLocaleString()} each</b></>
        : <span className="tt-beat-label tt-nobody">Nobody found the truth!</span>)}</div>
      {step >= 2 && found.length > 0 && <Confetti burst={`truth-${beat.at}`} count={90} />}
    </div>;
  }
  const fooled = people(players, beat.fooled), authors = beat.kind === 'lie' ? beat.authors : [];
  return <div className="tt-beat tt-fib" data-step={step}>
    <div className="tt-fooled">
      <p className="tt-beat-label">{step >= 1 ? 'Fell for it:' : 'Somebody believed…'}</p>
      {step >= 1 && <AvatarStack players={fooled} size={fooled.length > 4 ? 76 : fooled.length > 2 ? 100 : 150} max={9} mood="sad" />}
      {step >= 1 && <p className="tt-fooled-names" data-few={fooled.length <= 2 || undefined}>{names(fooled)}</p>}
    </div>
    <div className="tt-clip tt-big-clip" data-fib={step >= 2 || undefined}>
      <p style={{ fontSize: fitText(beat.text, 104) }}>{beat.text}</p>
      {step >= 2 && <span className="tt-stamp">{beat.kind === 'house' ? 'House fib!' : 'Fib!'}</span>}
    </div>
    <div className="tt-byline">{step >= 2 && (beat.kind === 'house'
      ? <p className="tt-house-note">Made up by the Tribune. Nobody scores!</p>
      : <><span className="tt-beat-label">Written by</span>{authors.map(a => { const p = find(players, a.id); return p && <span key={a.id} className="tt-author">
          <AvatarBadge player={p} size={84} mood="happy" />
          {step >= 3 && <b className="tt-points kp-numeral">+{a.points.toLocaleString()}</b>}
          {a.house && <small>Lie for me · {Math.round((1 - HOUSE_RATE) * 100)}% off</small>}
        </span>; })}</>)}</div>
  </div>;
}

function RevealTV({ view, players, now }: P) {
  const beats = view.beats ?? [], current = beats.at(-1), truth = beats.find(b => b.kind === 'truth');
  const shown = useNow(now, 200) >= (truth ? stampAt(truth) : Infinity);
  const past = beats.slice(0, -1).filter((b): b is Exclude<Beat, { kind: 'likes' }> => b.kind !== 'likes');
  return <section className="tt-reveal">
    <Masthead view={view} />
    <article className="tt-clip tt-headline"><Story text={view.fact!.text} fill={shown && truth?.kind === 'truth' ? truth.text : undefined} size={fitText(view.fact!.text, 54)} /></article>
    <div className="tt-reveal-main">
      {current ? <BeatTV key={beats.length} beat={current} players={players} now={now} />
        : <div className="tt-beat tt-lead-in"><span className="tt-spinner kp-title">Hold the front page!</span><p>Let’s see who’s been telling tall tales…</p></div>}
      {past.length > 0 && <ol className="tt-rail" aria-label="Already revealed">{past.map(b => <li key={b.id} data-kind={b.kind}>
        <span>{b.text}</span><em>{b.kind === 'truth' ? 'Truth' : 'Fib'}</em>
      </li>)}</ol>}
    </div>
  </section>;
}

function ScoresTV({ view, players }: P) {
  const prev = view.prev ?? {}, final = view.phase === 'final-scores', gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  const top = Math.max(0, ...players.map(p => view.scores[p.id] ?? 0)), champs = top > 0 ? players.filter(p => view.scores[p.id] === top) : [];
  return <section className="tt-scores" data-final={final || undefined}>
    <Masthead view={view} />
    <div className="tt-scores-main">
      <div className="tt-scores-side">
        {final && champs.length ? <>
          <p className="tt-fp-kicker">Final edition</p>
          <div className="tt-photo tt-photo-row">{champs.slice(0, 3).map(p => <Avatar key={p.id} avatar={p.avatar} color={p.color} size={champs.length > 1 ? 150 : 220} mood="happy" />)}</div>
          <h2 className="tt-winner kp-title">{names(champs)} {champs.length > 1 ? 'fool everyone!' : 'fools everyone!'}</h2>
          <p className="tt-next">Local liar{champs.length > 1 ? 's' : ''} denies everything.</p>
        </> : <>
          <p className="tt-fp-kicker">{final ? 'Final edition' : `After ${round(view).name}`}</p>
          <h2 className="tt-scores-title kp-title">The Standings</h2>
          <Typewriter />
          <p className="tt-next">{final ? 'Nobody fooled anybody. Remarkable honesty.' : view.round === 1 ? <>Round 2 is worth <b>double</b>.</> : <>Next: the Final Tall Tale. <b>Triple</b> points!</>}</p>
        </>}
      </div>
      <div className="tt-board"><Scoreboard players={players} scores={view.scores} from={prev} delay={900} rowHeight={players.length > 8 ? 78 : players.length > 5 ? 88 : 112}
        highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} /></div>
    </div>
    {final && champs.length > 0 && <Confetti burst="tall-tales-final" count={130} />}
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-tall-tales tt-tv" data-phase={view.phase}>
    <div className="tt-paper" aria-hidden="true" />
    {view.phase === 'round' ? <RoundTV {...props} />
      : view.phase === 'pick' ? <PickTV {...props} />
      : view.phase === 'write' && view.fact ? <WriteTV {...props} />
      : view.phase === 'choose' ? <ChooseTV {...props} />
      : view.phase === 'reveal' ? <RevealTV {...props} />
      : <ScoresTV {...props} />}
  </div>;
}

// ---------- phone ----------

function Standing({ view, players, player }: { view: TallPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  return <p className="tt-standing"><b className="kp-title">{ordinal(rankOf(view.scores, player.id, players.map(p => p.id)))}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>;
}
const PhoneStory = ({ fact, fill }: { fact: Fact; fill?: string }) => <div className="tt-phone-clip"><span className="tt-label">{fact.teaser}</span><Story text={fact.text} fill={fill} /></div>;

function RoundPhone({ view, player, players, vip, now }: Phone) {
  const r = round(view);
  return <PhoneShell {...shell(view, player, vip, now, false)} eyebrow="Extra! Extra!" title={r.name}>
    <div className="tt-phone-card"><Avatar avatar={player.avatar} color={player.color} size={120} mood="happy" /><p>{r.blurb}</p>{view.q > 0 && <Standing view={view} players={players} player={player} />}<p className="tt-tv-cue">Eyes on the TV!</p></div>
  </PhoneShell>;
}

function PickPhone({ view, me, player, players, vip, now, send }: Phone) {
  const chooser = view.chooser ? find(players, view.chooser) : undefined, cats = view.cats ?? [];
  if (view.picked !== undefined) return <PhoneShell {...shell(view, player, vip, now, false)} eyebrow="Story picked" title={cats[view.picked]}>
    <PhoneWaiting title="Hot off the press…" detail="The story is on its way to the TV." lines={WAIT_LINES} />
  </PhoneShell>;
  if (!me.chooser) return <PhoneShell {...shell(view, player, vip, now)} eyebrow="Editor’s desk" title="Today’s story…">
    <PhoneWaiting player={chooser} title={`${chooser?.name ?? 'Someone'} is choosing`} detail="Get your lying face ready." lines={WAIT_LINES} />
  </PhoneShell>;
  return <PhoneShell {...shell(view, player, vip, now)} eyebrow="You’re the editor" title="Pick today’s story">
    <PhoneChoices className="tt-cats" label="Pick a story" options={cats.map((teaser, i) => ({ id: String(i), label: teaser, detail: `Section ${letter(i)}`, color: i % 2 ? 'var(--kp-sky)' : 'var(--kp-sun)' }))}
      onSubmit={([i]) => send({ turn: view.turn, k: 'pick', index: Number(i) })} />
  </PhoneShell>;
}

function WritePhone({ view, me, player, players, vip, now, send, sessionKey }: Phone) {
  const fact = view.fact!, [help, run] = useSend();
  if (me.lie !== undefined) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell(view, player, vip, now)} eyebrow={fact.teaser} title="Lie filed!">
      <PhoneDone title="Hot off the press." detail={me.house ? 'The Tribune wrote this one for you.' : 'Now look innocent.'}><PhoneStory fact={fact} fill={me.lie} /></PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the slow typists" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell(view, player, vip, now)} eyebrow={`Story ${view.q + 1} of ${QUESTIONS} · ${round(view).name}`} title="Write a lie">
    <PhoneTextEntry multiline label={<Story inline text={fact.text} />} draftKey={`${sessionKey}:${view.turn}`} maxLength={MAX_LIE} placeholder="Something believable…"
      submitLabel="File my lie" hint="Fool them. Don’t write the truth!" onSubmit={text => send({ turn: view.turn, k: 'lie', text })} />
    {me.offers ? <div className="tt-offers" role="group" aria-label="House lies">
      <p>Pick one of ours <small>(earns {Math.round((1 - HOUSE_RATE) * 100)}% less)</small></p>
      {me.offers.map((text, i) => <button key={text} type="button" disabled={help.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'house', index: i }))}>{text}</button>)}
    </div> : <ArcadeButton tone="ghost" size="md" className="tt-help" disabled={help.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'help' }))}>
      Stuck? Lie for me <small className="tt-nowrap">(25% fewer points)</small>
    </ArcadeButton>}
    {help.status === 'rejected' && <StatusNotice tone="error">{help.reason}</StatusNotice>}
  </PhoneShell>;
}

function Ballot({ view, me, send }: Phone) {
  const [pick, runPick] = useSend(), [heart, runHeart] = useSend(), options = view.options ?? [], likes = me.likes ?? [], mine = new Set(me.mine);
  const row = (o: Option, i: number) => {
    const own = mine.has(o.id), chosen = me.choice === o.id, liked = likes.includes(o.id);
    return <li key={o.id} data-mine={own || undefined} data-chosen={chosen || undefined}>
      <button type="button" className="tt-ballot-pick" disabled={own || !!me.choice || pick.status === 'pending'} aria-label={own ? `Your lie: ${o.text}` : `Pick answer ${letter(i)}: ${o.text}`}
        onClick={() => void runPick(() => send({ turn: view.turn, k: 'choose', option: o.id }))}>
        <span className="tt-letter">{letter(i)}</span><span className="tt-ballot-text">{o.text}</span>{own ? <em>Your lie</em> : chosen && <em>Your pick</em>}
      </button>
      {!own && <button type="button" className="tt-heart" aria-pressed={liked} aria-label={`${liked ? 'Unlike' : 'Like'} answer ${letter(i)}`} disabled={heart.status === 'pending' || (!liked && likes.length >= LIKES)}
        onClick={() => void runHeart(() => send({ turn: view.turn, k: 'like', option: o.id, on: !liked }))}>{liked ? '♥' : '♡'}</button>}
    </li>;
  };
  return <>
    <ul className="tt-ballot">{options.map(row)}</ul>
    <p className="tt-likes-left" aria-live="polite">{LIKES - likes.length > 0 ? `♥ ${plural(LIKES - likes.length, 'like')} left for your favourite lies` : '♥ All likes given. Tap one to take it back.'}</p>
    {[pick, heart].map((s, i) => s.status === 'rejected' && <StatusNotice key={i} tone="error">{s.reason}</StatusNotice>)}
  </>;
}

function ChoosePhone(props: Phone) {
  const { view, me, player, vip, now } = props;
  return <PhoneShell {...shell(view, player, vip, now)} eyebrow={me.choice ? 'Locked in' : 'One of these is true'} title={me.choice ? 'Now ♥ the best lies' : 'Find the truth!'}>
    <PhoneStory fact={view.fact!} />
    <Ballot {...props} />
  </PhoneShell>;
}

/** Your own headlines from the reveal, appearing as each stamp lands on the TV. */
function RevealPhone({ view, me, player, players, vip, now }: Phone) {
  const t = useNow(now, 200), beats = (view.beats ?? []).filter(b => t >= stampAt(b)), lines: { tone: string; text: ReactNode; pts?: number }[] = [];
  const name = (ids: readonly string[]) => names(people(players, ids));
  for (const b of beats) {
    if (b.kind === 'lie') {
      const mine = b.authors.find(a => a.id === player.id);
      if (mine) lines.push({ tone: 'win', text: `Your lie fooled ${plural(b.fooled.length, 'player')}!`, pts: mine.points });
      if (b.fooled.includes(player.id)) lines.push({ tone: 'lose', text: <>You fell for {name(b.authors.map(a => a.id))}’s lie: “{b.text}”</> });
    } else if (b.kind === 'house' && b.fooled.includes(player.id)) lines.push({ tone: 'lose', text: <>You fell for the Tribune’s own fib: “{b.text}”</> });
    else if (b.kind === 'truth') {
      lines.push(b.found.includes(player.id) ? { tone: 'win', text: 'You found the truth!', pts: b.points } : { tone: 'meh', text: <>The truth was “{b.text}”.</> });
      if (me.mine?.length && !beats.some(x => x.kind === 'lie' && x.authors.some(a => a.id === player.id))) lines.push({ tone: 'meh', text: 'Nobody fell for your lie this time.' });
    }
    else if (b.kind === 'likes') {
      const got = b.top.filter(x => x.authors.includes(player.id)).reduce((sum, x) => sum + x.likes, 0);
      if (got) lines.push({ tone: 'win', text: `Your lie got ${plural(got, 'like')}!`, pts: got * LIKE_PTS });
    }
  }
  const truth = beats.find((b): b is Extract<Beat, { kind: 'truth' }> => b.kind === 'truth'), done = !!truth;
  const recap = (view.options ?? []).flatMap(o => [...(me.mine?.includes(o.id) ? [['Your lie', o.text]] : []), ...(me.choice === o.id ? [['Your pick', o.text]] : [])]);
  return <PhoneShell {...shell(view, player, vip, now, false)} eyebrow={`Story ${view.q + 1} of ${QUESTIONS}`} title={done ? 'The truth is out!' : 'Stop the presses…'}>
    <PhoneStory fact={view.fact!} fill={truth?.text} />
    {!done && recap.length > 0 && <dl className="tt-recap">{recap.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>}
    <ol className="tt-my-news">{lines.map((l, i) => <li key={i} data-tone={l.tone}><span>{l.text}</span>{l.pts ? <b className="kp-numeral">+{l.pts.toLocaleString()}</b> : null}</li>)}</ol>
    {!done ? <p className="tt-tv-cue">Eyes on the TV!</p> : <Standing view={view} players={players} player={player} />}
    {!me.choice && !done && <p className="hj-note">You didn’t pick an answer this time.</p>}
  </PhoneShell>;
}

function ScoresPhone({ view, player, players, vip, now }: Phone) {
  const final = view.phase === 'final-scores', rank = rankOf(view.scores, player.id, players.map(p => p.id));
  return <PhoneShell {...shell(view, player, vip, now, false)} eyebrow={final ? 'Final edition' : `After ${round(view).name}`} title={final ? (rank === 1 && (view.scores[player.id] ?? 0) > 0 ? 'Front page news!' : 'That’s the paper!') : 'The standings'}>
    <div className="tt-phone-card"><Avatar avatar={player.avatar} color={player.color} size={132} mood={rank === 1 ? 'happy' : 'idle'} />
      <Standing view={view} players={players} player={player} />
      <p className="hj-note">{final ? 'Awards are next. Look at the TV!' : view.round === 1 ? 'Round 2 is worth double. Plenty of time for a comeback!' : 'The Final Tall Tale is worth triple. Anything can happen.'}</p></div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Hold the front page!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-tall-tales tt-phone">
    {view.phase === 'round' ? <RoundPhone {...phone} />
      : view.phase === 'pick' ? <PickPhone {...phone} />
      : view.phase === 'write' && view.fact ? <WritePhone {...phone} />
      : view.phase === 'choose' ? <ChoosePhone {...phone} />
      : view.phase === 'reveal' ? <RevealPhone {...phone} />
      : <ScoresPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
