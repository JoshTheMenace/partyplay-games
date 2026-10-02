/* Airlock screens: the retro-futurist bridge on the TV (briefing, tests, answer boards, red alert, mission report) and the phone controller. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArcadeButton, DrawingPad, DrawingRenderer, StatusNotice } from '../../../../../party-ui/src/index';
import type { Drawing } from '../../../../../party-contract/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, Confetti, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting, PlayerStrip, PromptCard, Scoreboard, Timer,
  fitText, ordinal, rankOf, useDraft, useNow, useSend, useTimeline,
} from '../../core/ui';
import { Antennae, BigButton, Earth, Icon, Ship } from './art';
import {
  ICONS, KIND, MAX_ANSWER, MAX_PUSHES, RATING_MAX, endBeats, resultBeats, verdictBeats,
  type AirPrivate, type AirPublic, type Board, type IconId, type Kind, type Value,
} from './types';
import './styles.css';

type P = MiniViewProps<AirPublic, AirPrivate>;
type Phone = P & { me: AirPrivate; player: PackPlayer };
const ACCENT = '#ff2d55';
const find = (players: readonly PackPlayer[], id: string | undefined) => players.find(p => p.id === id);
const nameOf = (players: readonly PackPlayer[], id: string) => find(players, id)?.name ?? 'Somebody';
const names = (list: string[]) => list.length > 1 ? `${list.slice(0, -1).join(', ')} & ${list.at(-1)}` : list[0] ?? '';
/** Players still aboard (spaced aliens sit the rest of the trip out). */
const aboard = (view: AirPublic, players: readonly PackPlayer[]) => players.filter(p => !view.out.includes(p.id));
/** How many ABORT votes save a suspect, in words. */
const saveLine = (saves: number, who: string) => saves > 1 ? `It takes two ABORT votes to save ${who}.` : `Every vote must say AIRLOCK. One ABORT saves ${who}.`;
const LIGHTS = ['#ff5748', '#ffd24a', '#78d955', '#28c6e7', '#b58aff'];
const kindOf = (view: AirPublic): Kind => view.kinds.at(-1) ?? 'answer';
const promptText = (kind: Kind, prompt: string) => kind === 'draw' ? `Draw ${prompt}` : prompt;
/** A chosen-but-unsent pick locks itself in this long before the deadline; a started doodle sends itself a little earlier. */
const AUTO_LOCK_MS = 900, AUTO_DRAW_MS = 1600;
const span = (view: AirPublic) => ({ deadline: view.deadline, total: view.deadline - view.at });
const WAIT_LINES = [
  'Act natural. Humans love acting natural.', 'Blink at a normal human speed.', 'Somebody here has antennae under their hat.', 'Breathe air. Like humans do.',
  'Rehearse your “I’m definitely human” face.', 'Trust nobody. Especially the quiet ones.', 'Check your neighbour for green skin.', 'Earth is getting closer. So are the aliens.',
];

/** Short text for an answer value: “Toast”, “7/10”, a name, an icon name or a doodle. */
function valueLabel(kind: Kind, value: Value, players: readonly PackPlayer[], icons?: IconId[]): string {
  if (kind === 'rating') return `${value}/${RATING_MAX}`;
  if (kind === 'pick') return nameOf(players, String(value));
  if (kind === 'choice') return ICONS[icons?.[Number(value)] ?? 'planet'];
  return kind === 'draw' ? 'A doodle' : String(value);
}
/** What a player did on the board, as a phrase: “said “toast””, “rated it 7/10”, “picked Mo”, “picked themself”. */
function didLabel(board: Board | undefined, id: string, players: readonly PackPlayer[]): string | null {
  const v = board?.answers.find(x => x.player === id)?.value;
  if (!board || v === undefined) return board ? 'gave no answer' : null;
  if (board.kind === 'draw') return null;
  if (board.kind === 'rating') return `rated it ${v}/${RATING_MAX}`;
  if (board.kind === 'pick') return v === id ? 'picked themself' : `picked ${nameOf(players, String(v))}`;
  return board.kind === 'choice' ? `picked ${valueLabel('choice', v, players, board.icons)}` : `said “${v}”`;
}
/** One line summing up the answers: matches, the average, the favourite. */
function summary(board: Board, players: readonly PackPlayer[]): string {
  const given = board.answers.filter(a => a.value !== undefined), missing = board.answers.filter(a => a.value === undefined).map(a => nameOf(players, a.player));
  const tail = missing.length ? ` · No answer: ${names(missing)}` : '', count = (key: (v: Value) => string) => {
    const tally = new Map<string, number>();
    for (const a of given) tally.set(key(a.value!), (tally.get(key(a.value!)) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    return top > 1 ? { top, keys: [...tally].filter(([, n]) => n === top).map(([k]) => k) } : null;
  };
  if (!given.length) return `Nobody answered!${tail}`;
  if (board.kind === 'rating') {
    const nums = given.map(a => Number(a.value)), avg = Math.round(nums.reduce((x, y) => x + y, 0) / nums.length * 10) / 10;
    return `Average ${avg} · lowest ${Math.min(...nums)} · highest ${Math.max(...nums)}${tail}`;
  }
  if (board.kind === 'draw') return `Does any doodle look a little… off?${tail}`;
  const best = count(v => board.kind === 'answer' ? String(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : String(v));
  if (!best) return `Every answer is different!${tail}`;
  const label = (k: string) => board.kind === 'answer' ? `“${given.find(a => String(a.value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === k)!.value}”` : valueLabel(board.kind, board.kind === 'choice' ? Number(k) : k, players, board.icons);
  return `${board.kind === 'answer' ? 'Matching answers' : 'Most picked'}: ${best.keys.map(label).join(' & ')} ×${best.top}${tail}`;
}

// ---------- TV ----------

/** The bridge: a huge viewport onto drifting stars, a riveted frame, blinking consoles and red alert beacons. */
function Bridge({ alert }: { alert: boolean }) {
  return <div className="al-bridge" data-alert={alert || undefined} aria-hidden="true">
    <div className="al-window"><i className="al-stars al-stars-1" /><i className="al-stars al-stars-2" /><i className="al-stars al-stars-3" /></div>
    <div className="al-console">{Array.from({ length: 30 }, (_, i) => <i key={i} style={{ '--c': LIGHTS[(i * 7) % LIGHTS.length], animationDelay: `${(i * 37) % 23 / 10}s`, animationDuration: `${1.4 + (i * 13) % 9 / 5}s` } as CSSProperties} />)}</div>
    <i className="al-beacon al-beacon-l" /><i className="al-beacon al-beacon-r" />
  </div>;
}

/** Ship → Earth progress: seven stops, the ship at the current test. */
function Route({ view }: { view: AirPublic }) {
  // Tests still to pass: the current one counts until its answers are in.
  const passed = view.phase === 'brief' || view.phase === 'test' ? Math.max(view.test, 1) - 1 : view.test;
  const left = view.phase === 'end' ? 0 : view.tests - passed, at = Math.max(0, view.test - 1) / view.tests;
  return <div className="al-route" aria-label={left ? `Earth in ${left} tests` : 'Arriving at Earth'}>
    <span className="al-route-label">{view.phase === 'end' ? 'Mission over' : !left ? 'Earth ahead!' : left === 1 ? 'Last test before Earth' : <>Earth in <b className="kp-numeral">{left}</b> tests</>}</span>
    <span className="al-route-track">
      {Array.from({ length: view.tests }, (_, i) => <i key={i} data-on={i < view.test || undefined} />)}
      <span className="al-route-ship" style={{ '--at': at } as CSSProperties}><Ship /></span>
      <Earth className="al-route-earth" />
    </span>
  </div>;
}

function Head({ view, children }: { view: AirPublic; children?: ReactNode }) {
  return <header className="al-head">
    <span className="al-logo kp-title">Air<em>lock</em></span>
    {view.test > 0 && view.phase !== 'end' && <span className="al-chip">Test {view.test}/{view.tests} · <b>{KIND[kindOf(view)].name}</b></span>}
    <Route view={view} />
    <span className="al-head-side">{children}</span>
  </header>;
}

/** Test emblems: speech bubble, gauge, pointing hand, pencil, four tiles. */
function KindGlyph({ kind }: { kind: Kind }) {
  return <svg className="al-glyph" viewBox="0 0 64 64" aria-hidden="true">{{
    answer: <><path d="M8 12h48v30H30l-12 12V42H8z" /><path className="al-glyph-ink" d="M18 24h28M18 32h18" /></>,
    rating: <><path d="M6 46a26 26 0 0 1 52 0z" /><path className="al-glyph-ink" d="M32 46 46 24" /><circle className="al-glyph-dot" cx="32" cy="46" r="5" /></>,
    pick: <><circle cx="22" cy="22" r="10" /><path d="M6 56q0-18 16-18t16 18z" /><path d="M40 30h18l-6-6m6 6-6 6" className="al-glyph-ink" /></>,
    draw: <><path d="m14 50 4-14 28-28 10 10-28 28z" /><path className="al-glyph-ink" d="m40 14 10 10M18 36l10 10" /></>,
    choice: <><rect x="8" y="8" width="20" height="20" rx="5" /><rect x="36" y="8" width="20" height="20" rx="5" /><rect x="8" y="36" width="20" height="20" rx="5" /><rect className="al-glyph-on" x="36" y="36" width="20" height="20" rx="5" /></>,
  }[kind]}</svg>;
}

/** A round porthole with Earth growing as the ship closes in. */
function Porthole({ view, className = '' }: { view: AirPublic; className?: string }) {
  const k = view.phase === 'end' ? 1 : Math.max(0, view.test) / view.tests;
  return <div className={`al-porthole ${className}`} aria-hidden="true">
    <i className="al-stars al-stars-2" /><i className="al-stars al-stars-3" />
    <span className="al-porthole-earth" style={{ '--k': k } as CSSProperties}><Earth /></span>
  </div>;
}

function BriefTV({ view, players }: P) {
  const many = view.aliens > 1, dense = players.length > 6;
  return <section className="al-brief">
    <Head view={view} />
    <div className="al-brief-main">
      <p className="al-kicker"><i className="al-blink" />Incoming transmission · mission briefing</p>
      <h1 className="kp-title al-title">{many ? 'Two aliens are aboard!' : 'An alien is aboard!'}</h1>
      <p className="al-lede">Scanners say {many ? 'two of you aren’t' : 'one of you isn’t'} human. <b>Check your phone in secret.</b></p>
      <ol className="al-manifest" data-dense={dense || undefined}>{players.map((p, i) => <li key={p.id} style={{ '--c': p.color, animationDelay: `${300 + i * 90}ms` } as CSSProperties}>
        <Avatar avatar={p.avatar} color={p.color} size={dense ? 84 : 112} mood="thinking" />
        <b className="hj-name">{p.name}</b><small className="kp-numeral">ID-{String(i + 1).padStart(3, '0')}</small>
      </li>)}</ol>
      <ol className="al-steps">
        <li><b className="kp-numeral">1</b><span>Pass <b>{view.tests} tests</b> to reach Earth</span></li>
        <li><b className="kp-numeral">2</b><span>Aliens get a <b>slightly different</b> question</span></li>
        <li><b className="kp-numeral">3</b><span>{many ? <>Push the <b>button</b> to space them one by one</> : <>Push the <b>button</b> to space a suspect</>}</span></li>
      </ol>
    </div>
  </section>;
}

function TestTV({ view, players: everyone, vip, now }: P) {
  const kind = kindOf(view), last = view.test === view.tests, players = aboard(view, everyone);
  return <section className="al-test">
    <Head view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={124} /></Head>
    <div className="al-test-main">
      <Porthole view={view} />
      <div className="al-test-copy" key={view.test}>
        <p className="al-kicker">{last ? 'Final test before Earth!' : `Crew test ${view.test} of ${view.tests}`}</p>
        <h1 className="kp-title al-title"><KindGlyph kind={kind} />{KIND[kind].name}</h1>
        <p className="al-lede">Your test is on your phone. <b>{KIND[kind].how}.</b></p>
        <p className="al-warn">Careful: the aliens’ question is <b>slightly different</b>…</p>
        <div className="al-tally" role="status"><b className="kp-numeral">{view.done.length}<small>/{players.length}</small></b><span>answers in</span></div>
      </div>
    </div>
    <PlayerStrip players={players} done={view.done} vip={vip} />
  </section>;
}

function Card({ board, i, open, players, media, dense }: { board: Board; i: number; open: boolean; players: readonly PackPlayer[]; media: Record<string, unknown>; dense: boolean }) {
  const few = board.answers.length <= 4;
  const a = board.answers[i]!, p = find(players, a.player)!, v = a.value;
  const body = !open ? <span className="al-wait" aria-label="Scanning"><i /><i /><i /></span>
    : v === undefined ? <em className="al-none">No answer</em>
    : board.kind === 'draw' ? (media[String(v)] ? <DrawingRenderer drawing={media[String(v)] as Drawing} label={`Doodle by ${p.name}`} /> : <em className="al-none">Loading…</em>)
    : board.kind === 'pick' ? <span className="al-picked">{find(players, String(v)) && <Avatar avatar={find(players, String(v))!.avatar} color={find(players, String(v))!.color} size={dense ? 64 : 84} />}<b>{String(v) === a.player ? 'Themself!' : nameOf(players, String(v))}</b></span>
    : <p style={{ fontSize: fitText(String(v), dense ? 40 : few ? 60 : 50) }}>{String(v)}</p>;
  return <li className="al-card" data-open={open || undefined} data-empty={(open && v === undefined) || undefined} style={{ '--c': p.color } as CSSProperties}>
    <AvatarBadge player={p} size={dense ? 44 : 60} />
    <div className="al-card-body">{body}</div>
  </li>;
}

function RatingBoard({ board, shown, players }: { board: Board; shown: number; players: readonly PackPlayer[] }) {
  return <ol className="al-rates" data-dense={board.answers.length > 6 || undefined}>
    <li className="al-rate-scale" aria-hidden="true"><span />{Array.from({ length: RATING_MAX }, (_, i) => <b key={i} className="kp-numeral">{i + 1}</b>)}</li>
    {board.answers.map((a, i) => { const p = find(players, a.player)!, open = i < shown;
      return <li key={a.player} data-open={open || undefined} style={{ '--c': p.color, '--v': open && a.value !== undefined ? Number(a.value) / RATING_MAX : 0 } as CSSProperties}>
        <AvatarBadge player={p} size={board.answers.length > 6 ? 40 : 56} />
        <span className="al-rate-track">{open && (a.value === undefined ? <em className="al-none">No answer</em> : <><i className="al-rate-fill" /><b className="al-rate-num kp-numeral">{String(a.value)}</b></>)}</span>
      </li>; })}
  </ol>;
}

function ChoiceBoard({ board, shown, players }: { board: Board; shown: number; players: readonly PackPlayer[] }) {
  const open = board.answers.filter((_, i) => i < shown), dense = board.answers.length > 6;
  return <div className="al-choices">{(board.icons ?? []).map((icon, k) => { const who = open.filter(a => a.value === k);
    return <div key={icon} className="al-choice" data-count={who.length}>
      <div className="al-choice-head"><Icon id={icon} /><b>{ICONS[icon]}</b><span className="kp-numeral">{who.length}</span></div>
      <ul>{who.map(a => <li key={a.player}><AvatarBadge player={find(players, a.player)!} size={dense ? 38 : 48} /></li>)}</ul>
    </div>; })}</div>;
}

function AnswerBoard({ board, shown, players, media }: { board: Board; shown: number; players: readonly PackPlayer[]; media: Record<string, unknown> }) {
  if (board.kind === 'rating') return <RatingBoard board={board} shown={shown} players={players} />;
  if (board.kind === 'choice') return <ChoiceBoard board={board} shown={shown} players={players} />;
  const n = board.answers.length, cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  return <ol className="al-cards" data-kind={board.kind} data-dense={n > 6 || undefined} style={{ '--cols': cols } as CSSProperties}>
    {board.answers.map((a, i) => <Card key={a.player} board={board} i={i} open={i < shown} players={players} media={media} dense={n > 6} />)}
  </ol>;
}

/** Results (answers flip one by one) and the discussion that follows on the same board, with the big red button. */
function BoardTV({ view, players, media, now }: P) {
  const board = view.board!, n = board.answers.length, plan = resultBeats(n), discuss = view.phase === 'discuss';
  const step = useTimeline(view.at, discuss ? [0] : [...plan.cards, plan.summary], now), shown = discuss ? n : Math.min(step, n), summed = discuss || step > n;
  const online = aboard(view, players).filter(p => p.connected).length, left = view.aliens - view.out.length;
  return <section className="al-boardtv" data-phase={view.phase}>
    <Head view={view}>{discuss && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={116} />}</Head>
    <PromptCard className="al-prompt" eyebrow="The crew’s real test" size={56}>{promptText(board.kind, board.prompt)}</PromptCard>
    <div className="al-board-row">
      <AnswerBoard board={board} shown={shown} players={players} media={media} />
      <aside className="al-side" data-discuss={discuss || undefined}>
        {discuss ? <>
          <h2 className="kp-title">{left > 1 ? 'Who are the aliens?' : 'Who’s the alien?'}</h2>
          <BigButton className="al-side-button" />
          <p>{view.aliens < 2 ? <><b>Push the button</b> on your phone to space a suspect.</> : view.out.length ? <><b className="al-side-left">One alien spaced, one to go!</b> Push the button again.</> : <><b>Push the button</b> to space the aliens one by one.</>}</p>
          <p className="al-side-ready"><b className="kp-numeral">{view.done.length}/{online}</b> ready for the next test</p>
        </> : <>
          <div className="al-radar"><i /></div>
          <h2 className="kp-title">Scanning…</h2>
          <p>Look for answers that don’t <b>quite</b> fit the question.</p>
        </>}
      </aside>
    </div>
    <p className="al-foot" role="status">{summed ? summary(board, players) : 'Decoding the crew’s answers…'}</p>
  </section>;
}

/** Red alert: the suspect in the airlock, everyone else votes; then the votes flip, the doors open (or not) and the truth comes out. */
function AlertTV({ view, players, now }: P) {
  const v = view.verdict, ballot = v ?? view.ballot!, by = find(players, ballot.by), board = view.board, suspect = find(players, ballot.suspect)!;
  const plan = v ? verdictBeats(v.votes.length, v.eject) : null;
  const step = useTimeline(view.at, plan ? [...plan.votes, plan.outcome, ...plan.roles] : [Infinity], now);
  const flipped = v ? Math.min(step, v.votes.length) : 0, decided = !!v && step > v.votes.length, open = decided && !!v?.eject, role = decided && step > v!.votes.length + 1 ? v!.role : undefined;
  const voters = v ? v.votes : aboard(view, players).filter(p => p.id !== ballot.suspect && (p.connected || view.done.includes(p.id))).map(p => ({ player: p.id, vote: undefined, auto: undefined }));
  const them = suspect.name, line = didLabel(board, suspect.id, players), left = view.aliens - view.out.length - (role === 'alien' ? 1 : 0);
  const aborts = v ? v.votes.filter(x => x.vote === 'abort').length : 0;
  const title = !v ? 'Red alert!' : !decided ? 'The votes are in…' : v.eject ? 'Airlock open!' : 'Aborted!';
  return <section className="al-alert" data-phase={view.phase} data-open={open || undefined} data-abort={(decided && !v?.eject) || undefined}>
    <Head view={view}>{!v && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={116} />}</Head>
    <div className="al-alert-main">
      <div className="al-voters">
        <h3>{v ? 'The votes' : <><b className="kp-numeral">{view.done.length}/{voters.length}</b> voted</>}</h3>
        <ol data-dense={voters.length > 6 || undefined}>{voters.map((x, i) => { const p = find(players, x.player)!, shown = !!v && i < flipped;
          return <li key={x.player} data-vote={shown ? x.vote : undefined} data-in={(!v && view.done.includes(x.player)) || undefined}>
            <Avatar avatar={p.avatar} color={p.color} size={voters.length > 6 ? 40 : 52} mood={shown ? (x.vote === 'airlock' ? 'happy' : 'idle') : 'thinking'} />
            <span className="al-voter"><b className="hj-name">{p.name}</b>
            <span className="al-chipvote">{shown ? (x.vote === 'airlock' ? 'Airlock' : x.auto ? 'No vote' : 'Abort') : !v && view.done.includes(x.player) ? 'Voted' : '…'}</span></span>
          </li>; })}</ol>
      </div>
      <div className="al-lock">
        <h1 className="kp-title al-title" key={title}>{title}</h1>
        <div className="al-chamber">
          <div className="al-space"><i className="al-stars al-stars-2" /><i className="al-stars al-stars-3" /></div>
          <i className="al-door al-door-l" /><i className="al-door al-door-r" />
          <div className="al-inside"><div className="al-suspect" data-out={open || undefined} data-role={role} style={{ '--i': 0 } as CSSProperties}>
            <span className="al-float">{role === 'alien' && <Antennae />}<Avatar avatar={suspect.avatar} color={suspect.color} size={240} mood={role === 'alien' ? 'happy' : open ? 'sad' : 'thinking'} /></span>
            <b className="al-placard">{suspect.name}</b>
            {!open && line && <small className="al-said">{line}</small>}
            {role && <span className="al-stamp" data-role={role}>{role === 'alien' ? 'Alien!' : 'Human!'}</span>}
          </div></div>
          {decided && !v?.eject && <span className="al-stamp al-stamp-big" data-role="abort">Aborted</span>}
        </div>
      </div>
      <div className="al-alert-side">
        {by && <div className="al-pusher"><Avatar avatar={by.avatar} color={by.color} size={96} mood="happy" /><p><b>{by.name}</b> pushed the button!</p><BigButton pressed /></div>}
        <p className="al-alert-copy">{!v ? <><b>Vote on your phone:</b> AIRLOCK or ABORT. {ballot.saves > 1 ? <>It takes <b>two ABORTs</b> to save {them}.</> : <>Every vote must say AIRLOCK to space {them}.</>}</>
          : !decided ? 'Counting…' : v.eject ? (!role ? 'Out they go! But were they really an alien…?' : role === 'crew' ? 'A human was spaced. The aliens win!' : left ? 'Got one! But one more alien is still aboard…' : 'Got them! The ship is safe.')
          : <>{aborts > 1 ? `${aborts} ABORT votes.` : 'One ABORT is all it takes.'} {them} stays aboard… for now.</>}</p>
      </div>
    </div>
  </section>;
}

function EndTV({ view, players, now }: P) {
  const e = view.end!, plan = endBeats(e.aliens.length), step = useTimeline(view.at, [...plan.unmask, plan.banner, plan.scores], now);
  const unmasked = Math.min(step, e.aliens.length), banner = step > e.aliens.length, scored = step > e.aliens.length + 1, crew = e.winner === 'crew';
  const by = e.by ? nameOf(players, e.by) : null, gains = players.map(p => e.gains[p.id] ?? 0), best = Math.max(0, ...gains);
  const heroes = names([...new Set(e.heroes)].map(id => nameOf(players, id))), left = e.aliens.length - view.out.length;
  const story = e.how === 'caught' ? <>{heroes ? <><b>{heroes}</b> pushed the button and the</> : 'The'} crew spaced {e.aliens.length > 1 ? 'both aliens' : 'the alien'}. Earth is safe!</>
    : e.how === 'framed' ? <>{by ? <><b>{by}</b> framed a human and the crew spaced them.</> : 'The crew spaced a human.'} The aliens took over the ship after <b>{e.survived}</b> {e.survived === 1 ? 'test' : 'tests'}.</>
    : <>The ship reached Earth with {left > 1 ? 'two aliens' : 'an alien'} still aboard. All <b>{e.survived}</b> tests survived!</>;
  return <section className="al-end" data-winner={banner ? e.winner : undefined}>
    <Head view={view} />
    <div className="al-end-main">
      <div className="al-end-story">
        <p className="al-kicker"><i className="al-blink" />Mission report</p>
        <h1 className="kp-title al-title" key={String(banner)}>{!banner ? (e.aliens.length > 1 ? 'The aliens were…' : 'The alien was…') : crew ? 'The crew wins!' : 'The aliens win!'}</h1>
        <ol className="al-unmask">{e.aliens.map((id, i) => { const p = find(players, id)!; return <li key={id} data-on={i < unmasked || undefined}>
          {i < unmasked ? <><span className="al-float"><Antennae /><Avatar avatar={p.avatar} color={p.color} size={e.aliens.length > 1 ? 170 : 210} mood={crew ? 'sad' : 'happy'} /></span><b className="al-placard">{p.name}</b></>
            : <span className="al-mystery kp-title">?</span>}
        </li>; })}</ol>
        {banner && <p className="al-lede">{story}</p>}
      </div>
      <div className="al-end-side">{scored ? <Scoreboard players={players} scores={view.scores} from={view.prev} delay={400} rowHeight={players.length > 8 ? 80 : 90} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
        : <Porthole view={view} className="al-end-porthole" />}</div>
    </div>
    {banner && <Confetti burst={`end-${e.winner}`} count={crew ? 130 : 70} />}
  </section>;
}

function Display(props: P) {
  const { view } = props, alert = view.phase === 'vote' || (view.phase === 'verdict' && !!view.verdict);
  return <div className="hj-airlock al-tv" data-phase={view.phase}>
    <Bridge alert={alert} />
    {view.phase === 'brief' ? <BriefTV {...props} />
      : view.phase === 'test' ? <TestTV {...props} />
      : (view.phase === 'results' || view.phase === 'discuss') && view.board ? <BoardTV {...props} />
      : alert ? <AlertTV {...props} />
      : view.end ? <EndTV {...props} /> : null}
  </div>;
}

// ---------- phone ----------

const shellOf = ({ player, vip }: Phone) => ({ player, vip: vip === player.id, accent: ACCENT });
const eyebrow = (view: AirPublic) => `Test ${view.test} of ${view.tests} · ${KIND[kindOf(view)].name}`;

/** The secret ID. Crew and alien cards are identical until held, so a glance over the shoulder gives nothing away. */
function IdCard({ view, me, players, big, compact, test }: { view: AirPublic; me: AirPrivate; players: readonly PackPlayer[]; big?: boolean; compact?: boolean; test?: boolean }) {
  const [peek, setPeek] = useState(false), on = () => setPeek(true), off = () => setPeek(false), alien = me.role === 'alien';
  const allies = me.allies.map(id => `${nameOf(players, id)}${view.out.includes(id) ? ' (spaced)' : ''}`);
  return <button type="button" className="al-id" data-big={big || undefined} data-compact={compact || undefined} data-peek={peek || undefined} aria-label="Secret ID card. Press and hold to read it."
    onPointerDown={on} onPointerUp={off} onPointerLeave={off} onPointerCancel={off} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') on(); }} onKeyUp={off} onBlur={off} onContextMenu={e => e.preventDefault()}>
    <span className="al-id-tab">Crew ID · top secret</span>
    {peek ? <span className="al-id-text" role="status">
      <b className="kp-title">{alien ? 'Alien' : 'Human'}</b>
      <span>{alien ? (allies.length ? `Fellow alien: ${names(allies)}` : 'The only alien. Blend in!') : view.aliens > 1 ? (view.out.length ? 'One alien down! Find the other!' : 'Find both aliens before Earth!') : 'Find the alien before Earth!'}</span>
      <small>{test && me.prompt ? `Your test: ${promptText(kindOf(view), me.prompt)}` : alien ? 'Your scan hacks the crew’s real test.' : 'Your scan double-checks your test.'}</small>
    </span> : <span className="al-id-text"><b className="kp-title">Hold to peek</b><span>Keep it hidden from your neighbours</span><small>Release to hide it again</small></span>}
  </button>;
}

function ScanButton({ view, me, send }: Phone) {
  const [state, run] = useSend();
  return <div className="al-scan">
    <ArcadeButton tone="ghost" size="md" disabled={!me.scan || view.phase !== 'test' || state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'scan' }))}>{me.scan ? 'Scan ship computer' : 'Scan used'}</ArcadeButton>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
  </div>;
}

/** Your version of the test, plus what your scan found (worded the same for both roles: crew simply see their own test again). */
function MyPrompt({ view, me }: { view: AirPublic; me: AirPrivate }) {
  const kind = kindOf(view);
  return <div className="al-myprompt">
    <small>Your test</small>
    <p>{promptText(kind, me.prompt ?? '')}</p>
    {me.intercepted && <p className="al-scanned"><b>Ship computer:</b> the crew’s test is “{promptText(kind, me.intercepted)}”</p>}
  </div>;
}

function MineValue({ view, me, players, sessionKey }: Phone) {
  const kind = kindOf(view), [drawing] = useDraft<Drawing>(`${sessionKey}:${view.test}:art`, { strokes: [] });
  if (me.answer === undefined) return null;
  return <div className="al-mine"><small>You answered</small>
    {kind === 'draw' ? (drawing.strokes.length ? <div className="al-mine-art"><DrawingRenderer drawing={drawing} label="Your doodle" /></div> : <b>Your doodle</b>)
      : kind === 'choice' ? <b className="al-mine-icon"><Icon id={me.icons?.[Number(me.answer)] ?? 'planet'} />{valueLabel(kind, me.answer, players, me.icons)}</b>
      : <b>{valueLabel(kind, me.answer, players)}</b>}
  </div>;
}

type Option = { id: string; art: ReactNode; label: string; detail?: string };
/** Tap to choose, then lock it in. The choice is a persisted draft; one still unsent just before the buzzer locks itself in. */
function Picker({ view, now, draftKey, kind, label, items, submit, onSend }: { view: AirPublic; now: () => number; draftKey: string; kind: string; label: string; items: Option[]; submit: string; onSend(value: string): ReturnType<P['send']> }) {
  const [pick, setPick] = useDraft<string>(draftKey, ''), [state, run] = useSend(), pending = state.status === 'pending', auto = useRef(false);
  const late = view.deadline - useNow(now, 200) < AUTO_LOCK_MS, lock = () => run(() => onSend(pick));
  useEffect(() => { if (late && pick && !auto.current) { auto.current = true; void lock(); } });
  return <>
    <div className="al-opts" data-kind={kind} role="radiogroup" aria-label={label}>
      {items.map(o => <button key={o.id} type="button" role="radio" aria-checked={pick === o.id} className="al-opt" data-on={pick === o.id || undefined} data-value={o.id}
        aria-label={o.label || o.id} disabled={pending} onClick={() => setPick(o.id)}>{o.art}{o.label && <span>{o.label}{o.detail && <small>{o.detail}</small>}</span>}</button>)}
    </div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={!pick || pending} onClick={() => void lock()}>{pending ? 'Sending…' : submit}</ArcadeButton></div>
  </>;
}

/** 20-second doodle with a persisted draft. A started drawing sends itself just before time runs out. */
function DoodlePad({ view, now, send, sessionKey }: Phone) {
  const key = `${sessionKey}:${view.test}:art`, [drawing, setDrawing] = useDraft<Drawing>(key, { strokes: [] }), [state, run] = useSend(), auto = useRef(false);
  const late = view.deadline - useNow(now, 250) < AUTO_DRAW_MS, pending = state.status === 'pending', submit = () => run(() => send({ turn: view.turn, k: 'draw', drawing }));
  useEffect(() => { if (late && drawing.strokes.length && !auto.current) { auto.current = true; void submit(); } });
  // Short screens: bring the whole canvas under the thumb (now and after rotating).
  const pad = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-height: 700px)'), fit = () => { if (query.matches) pad.current?.querySelector('.kp-drawing-surface')?.scrollIntoView({ block: 'center' }); };
    fit(); query.addEventListener('change', fit);
    return () => query.removeEventListener('change', fit);
  }, []);
  return <div className="al-pad" ref={pad}>
    <DrawingPad value={drawing} onChange={setDrawing} disabled={pending} label="Your doodle" />
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky al-pad-send"><ArcadeButton tone="lime" size="lg" disabled={pending || !drawing.strokes.length} onClick={() => void submit()}>{pending ? 'Sending…' : 'Send my doodle'}</ArcadeButton></div>
  </div>;
}

function TestPhone(props: Phone) {
  const { view, me, player, players, send, sessionKey, now } = props, kind = kindOf(view), key = `${sessionKey}:${view.turn}`;
  const shell = { ...shellOf(props), eyebrow: eyebrow(view), timer: { ...span(view), now } };
  const tools = <div className="al-tools"><IdCard view={view} me={me} players={players} compact={kind === 'draw'} /><ScanButton {...props} /></div>;
  if (me.answer !== undefined) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} title="Answer locked in!">
      {tools}<MyPrompt view={view} me={me} /><MineValue {...props} />
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the crew" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  const answer = (value: Value) => send({ turn: view.turn, k: 'answer', value });
  const items: Option[] = kind === 'rating' ? Array.from({ length: RATING_MAX }, (_, i) => ({ id: String(i + 1), art: <b className="kp-numeral">{i + 1}</b>, label: '' }))
    : kind === 'pick' ? players.map(p => ({ id: p.id, art: <Avatar avatar={p.avatar} color={p.color} size={44} />, label: p.id === player.id ? `${p.name} (you)` : p.name }))
    : (me.icons ?? []).map((icon, i) => ({ id: String(i), art: <Icon id={icon} />, label: ICONS[icon] }));
  return <PhoneShell {...shell} title={`${KIND[kind].how}!`}>
    {tools}<MyPrompt view={view} me={me} />
    {kind === 'answer' ? <PhoneTextEntry label="Your answer" draftKey={`${key}:text`} maxLength={MAX_ANSWER} placeholder="Short and sweet…" submitLabel="Lock it in" onSubmit={text => answer(text)} />
      : kind === 'draw' ? <DoodlePad {...props} />
      : <>
        {kind === 'rating' && <p className="al-scale-note"><span>1 · not at all</span><span>10 · totally</span></p>}
        <Picker key={view.turn} view={view} now={now} draftKey={`${key}:pick`} kind={kind} label={KIND[kind].how} items={items} submit="Lock it in"
          onSend={value => answer(kind === 'pick' ? value : Number(value))} />
      </>}
  </PhoneShell>;
}

function BriefPhone(props: Phone) {
  const { view, me, players } = props;
  return <PhoneShell {...shellOf(props)} eyebrow="Mission briefing" title="Your secret ID">
    <IdCard view={view} me={me} players={players} big />
    <ol className="al-phone-steps"><li>Hold the card to read it. <b>Never show anyone your phone!</b></li><li>Pass {view.tests} tests to reach Earth. Aliens get a slightly different question.</li><li>Spot an odd answer? <b>Push the button.</b>{view.aliens > 1 && ' Space both aliens, one at a time. Space a human and the aliens win!'}</li></ol>
  </PhoneShell>;
}

function ResultsPhone(props: Phone) {
  const { view, me, players } = props;
  return <PhoneShell {...shellOf(props)} eyebrow={eyebrow(view)} title="Answers incoming!">
    <div className="al-tools"><IdCard view={view} me={me} players={players} test /></div>
    <MineValue {...props} />
    <p className="al-tv-cue">Eyes on the TV! Compare every answer with the crew’s real test.</p>
  </PhoneShell>;
}

/** Who goes out the airlock: pick one suspect, then push. */
function SuspectPicker(props: Phone & { onCancel(): void }) {
  const { view, me, player, players, send, sessionKey, onCancel, now } = props, board = view.board, others = aboard(view, players).filter(p => p.id !== player.id);
  const [draft, setDraft] = useDraft<string>(`${sessionKey}:${view.turn}:suspect`, ''), [state, run] = useSend(), pending = state.status === 'pending';
  const pick = others.some(p => p.id === draft) ? draft : '';
  return <PhoneShell {...shellOf(props)} eyebrow={`Button push · ${view.pushes[player.id] ?? 0} of ${MAX_PUSHES} left`} title="Pick a suspect" timer={{ ...span(view), now }}>
    <p className="hj-note">Then everyone else votes. {view.aliens - view.out.length > 1 ? <>It takes <b>two</b> ABORT votes to save them.</> : <>It takes <b>every</b> vote to open the airlock.</>}</p>
    <div className="al-opts" data-kind="suspect" role="radiogroup" aria-label="Suspects">{others.map(p => { const on = pick === p.id;
      return <button key={p.id} type="button" role="radio" className="al-opt" data-value={p.id} data-on={on || undefined} aria-checked={on} disabled={pending} onClick={() => setDraft(on ? '' : p.id)}>
        <Avatar avatar={p.avatar} color={p.color} size={44} mood={on ? 'sad' : 'idle'} /><span>{p.name}<small>{didLabel(board, p.id, players) ?? 'drew a doodle'}</small></span>
      </button>; })}</div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky al-push-bar">
      <ArcadeButton tone="ghost" size="lg" disabled={pending} onClick={onCancel}>Cancel</ArcadeButton>
      <ArcadeButton tone="coral" size="lg" disabled={!pick || pending} onClick={() => void run(() => send({ turn: view.turn, k: 'push', suspect: pick }))}>{pending ? 'Pushing…' : 'Push it!'}</ArcadeButton>
    </div>
    {me.ready && <p className="hj-note">You were ready for the next test. Pushing still works.</p>}
  </PhoneShell>;
}

function DiscussPhone(props: Phone) {
  const { view, me, player, players, send, sessionKey, now } = props, left = view.pushes[player.id] ?? 0, online = aboard(view, players).filter(p => p.connected).length;
  const [picking, setPicking] = useDraft(`${sessionKey}:${view.turn}:picking`, false), [state, run] = useSend();
  if (picking && left > 0) return <SuspectPicker {...props} onCancel={() => setPicking(false)} />;
  return <PhoneShell {...shellOf(props)} eyebrow={eyebrow(view)} title={view.aliens - view.out.length > 1 ? 'Who are the aliens?' : 'Who’s the alien?'} timer={{ ...span(view), now }}>
    <div className="al-tools"><IdCard view={view} me={me} players={players} test /></div>
    <button type="button" className="al-push" disabled={!left} onClick={() => setPicking(true)}>
      <BigButton /><span className="kp-title">{left ? 'Push the button' : 'No pushes left'}</span><small>{left} of {MAX_PUSHES} pushes left</small>
    </button>
    {me.ready ? <p className="al-ready" role="status"><span className="hj-done-stamp" aria-hidden="true">✓</span>Ready for the next test · {view.done.length}/{online}</p>
      : <div className="al-ready-btn">{state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
        <ArcadeButton tone="sky" size="lg" disabled={state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'ready' }))}>Ready for the next test</ArcadeButton></div>}
  </PhoneShell>;
}

function VotePhone(props: Phone) {
  const { view, me, player, players, send, now } = props, ballot = view.ballot!, [state, run] = useSend();
  const suspect = find(players, ballot.suspect), who = suspect?.name ?? 'them';
  const shell = { ...shellOf(props), eyebrow: `${nameOf(players, ballot.by)} pushed the button!`, timer: { ...span(view), now } };
  const lineup = suspect && <div className="al-lineup"><AvatarBadge player={suspect} size={64} layout="column" mood="thinking" /></div>;
  if (ballot.suspect === player.id) return <PhoneShell {...shell} title="You’re in the airlock!">
    <div className="al-plead" data-alert=""><Avatar avatar={player.avatar} color={player.color} size={128} mood="sad" /><p>Plead your case. <b>Out loud. Right now!</b></p><small>{ballot.saves > 1 ? 'Two ABORT votes save you.' : 'One ABORT vote saves you.'}</small></div>
  </PhoneShell>;
  if (me.vote) return <PhoneShell {...shell} title={me.vote === 'airlock' ? 'You voted AIRLOCK' : 'You voted ABORT'}>
    {lineup}<PhoneDone title="Vote locked in!" detail={ballot.by === player.id ? 'You pushed the button, so your vote is AIRLOCK.' : 'Eyes on the TV.'} />
  </PhoneShell>;
  const vote = (v: 'airlock' | 'abort') => void run(() => send({ turn: view.turn, k: 'vote', vote: v }));
  return <PhoneShell {...shell} title={`Space ${who}?`}>
    {lineup}
    <div className="al-votes">
      <button type="button" className="al-vote" data-vote="airlock" disabled={state.status === 'pending'} onClick={() => vote('airlock')}><b className="kp-title">Airlock</b><small>Space {who}</small></button>
      <button type="button" className="al-vote" data-vote="abort" disabled={state.status === 'pending'} onClick={() => vote('abort')}><b className="kp-title">Abort</b><small>Keep {who} aboard</small></button>
    </div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <p className="hj-note">{saveLine(ballot.saves, who)}</p>
  </PhoneShell>;
}

function VerdictPhone(props: Phone) {
  const { view, player, players, now } = props, v = view.verdict!, plan = verdictBeats(v.votes.length, v.eject);
  const step = useTimeline(view.at, [plan.outcome, ...plan.roles], now), mine = v.suspect === player.id, known = step > 1 ? v.role : undefined, suspect = find(players, v.suspect);
  const title = !step ? 'The votes are in…' : !v.eject ? (mine ? 'Saved! You stay aboard.' : 'Aborted!') : mine ? 'You got spaced!' : 'Airlock open!';
  return <PhoneShell {...shellOf(props)} eyebrow={`${nameOf(players, v.by)} pushed the button`} title={title}>
    {suspect && <div className="al-lineup"><AvatarBadge player={suspect} size={64} layout="column" mood={step && v.eject ? 'sad' : 'thinking'} /></div>}
    <div className="al-phone-result" data-tone={step ? (v.eject ? 'eject' : 'abort') : undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={120} mood={!step ? 'thinking' : mine && v.eject ? 'sad' : 'idle'} />
      {known && <p><b>{nameOf(players, v.suspect)}</b> was {known === 'alien' ? <b className="al-is-alien">an alien!</b> : <b className="al-is-human">human!</b>}</p>}
      {known === 'alien' && view.aliens - view.out.length > 1 && <p className="hj-note">One alien down, one to go!</p>}
      {(!step || (v.eject && !known)) && <p className="al-tv-cue">Eyes on the TV!</p>}
      {step > 0 && !v.eject && <p className="hj-note">Back to the discussion…</p>}
    </div>
  </PhoneShell>;
}

/** A spaced alien sits the rest of the trip out, still on the aliens' team. */
function SpacedPhone(props: Phone) {
  const { view, me, player, players } = props, ally = names(me.allies.filter(id => !view.out.includes(id)).map(id => nameOf(players, id)));
  return <PhoneShell {...shellOf(props)} eyebrow="Floating in space" title="You got spaced!">
    <div className="al-phone-result">
      <span className="al-float"><Antennae /><Avatar avatar={player.avatar} color={player.color} size={124} mood="sad" /></span>
      <p>{ally ? <><b>{ally}</b> is still aboard.</> : 'Your team is still aboard.'} If the crew spaces a human or the ship reaches Earth, you win too!</p>
      <p className="al-tv-cue">Watch the TV and cheer them on.</p>
    </div>
  </PhoneShell>;
}

function EndPhone(props: Phone) {
  const { view, me, player, players, now } = props, e = view.end!, plan = endBeats(e.aliens.length), done = useTimeline(view.at, [plan.banner], now) > 0;
  const won = (me.role === 'alien') === (e.winner === 'aliens'), gain = e.gains[player.id] ?? 0, rank = rankOf(view.scores, player.id, players.map(p => p.id));
  return <PhoneShell {...shellOf(props)} eyebrow="Mission report" title={!done ? 'Unmasking the aliens…' : won ? 'Your team wins!' : 'Your team lost!'}>
    <div className="al-phone-result" data-won={(done && won) || undefined}>
      <span className="al-float">{me.role === 'alien' && done && <Antennae />}<Avatar avatar={player.avatar} color={player.color} size={124} mood={!done ? 'thinking' : won ? 'happy' : 'sad'} /></span>
      {done ? <>
        <p>You were {me.role === 'alien' ? <b className="al-is-alien">an alien</b> : <b className="al-is-human">human</b>}.</p>
        <b className="al-phone-points kp-numeral">+{gain.toLocaleString()}</b>
        <p className="al-standing"><b className="kp-title">{ordinal(rank)}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>
      </> : <p className="al-tv-cue">Eyes on the TV!</p>}
    </div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Stand by, crew…" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-airlock al-phone">
    {view.out.includes(player.id) && view.phase !== 'end' ? <SpacedPhone {...phone} />
      : view.phase === 'brief' ? <BriefPhone {...phone} />
      : view.phase === 'test' ? <TestPhone {...phone} />
      : view.phase === 'results' ? <ResultsPhone {...phone} />
      : view.phase === 'discuss' ? <DiscussPhone {...phone} />
      : view.phase === 'vote' && view.ballot ? <VotePhone {...phone} />
      : view.phase === 'verdict' && view.verdict ? <VerdictPhone {...phone} />
      : view.end ? <EndPhone {...phone} /> : null}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
