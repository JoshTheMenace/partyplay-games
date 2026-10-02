/* Comment Section screens: the Scrollhole TV (answering, twisting, the feed, the vote, verdicts, scores) and the phone controller. */
import { useId, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, AvatarStack, BigTitle, Confetti, PhoneChoices, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting, PlayerStrip,
  Scoreboard, Timer, ordinal, rankOf, useCountUp, useDraft, useSend, useTimeline,
} from '../../core/ui';
import {
  KINDS, MAX_ANSWER, MAX_TWIST, POST, ROUNDS, handle, letter, revealBeats, type CommentPrivate, type CommentPublic, type Format, type Kind, type Post, type Verdict,
} from './types';
import './styles.css';

type P = MiniViewProps<CommentPublic, CommentPrivate>;
type Phone = P & { me: CommentPrivate; player: PackPlayer };
type Draft = Omit<Format, 'ask'> & { twist: string; answer: string };
const ACCENT = '#4d7cff';
const find = (players: readonly PackPlayer[], id: string) => players.find(p => p.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** 12400 → "12.4K". */
const compact = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n);

/** The fake apps. `said` labels the original answer inside each post. */
const APPS: Record<Kind, { name: string; icon: string; color: string; said?: string }> = {
  review: { name: 'Shopaloo', icon: '🛒', color: '#ff8a1f', said: 'Review' },
  photo: { name: 'Pixstack', icon: '📷', color: '#e8407f', said: 'Caption' },
  news: { name: 'Daily Doomscroll', icon: '📰', color: '#d7263d', said: 'Top comment' },
  search: { name: 'Askew Search', icon: '🔍', color: '#0f9fb3', said: 'Then searched' },
  job: { name: 'Workwurld', icon: '💼', color: '#2b6fd6', said: 'Application' },
  dating: { name: 'Swoonr', icon: '💘', color: '#ff4f7b', said: 'About me' },
  forum: { name: 'Threadbare', icon: '🧵', color: '#8a5cf5', said: '✓ Best answer' },
  recipe: { name: 'Crumbly', icon: '🥧', color: '#bf6a22', said: 'Review' },
  video: { name: 'Clipclop', icon: '▶', color: '#f0322b', said: 'Top comment' },
  chat: { name: 'Yapper', icon: '💬', color: '#1fae5a' },
  status: { name: 'Scrollhole', icon: '🌀', color: ACCENT },
};
const brand = (kind: Kind) => ({ '--brand': APPS[kind].color }) as CSSProperties;
const TRENDING = ['#OutOfContext', '#ThatsNotWhatIMeant', '#DeleteThisNow', '#ScreenshotTaken', '#ContextIsEverything', '#Ruined', '#ReportedForComedy', '#MumSawThis', '#NotMyFinestHour', '#TrendingForTheWrongReasons'];
const REACTIONS = ['😂', '💀', '😱', '🔥', '😬', '🙈', '👀', '🤡', '😳', '🫠'];
const WAIT_LINES = [
  'Practise your “I can explain” face.', 'Draft a public apology. Just in case.', 'Act like you’ve never used the internet.',
  'Rehearse saying “that was out of context”.', 'Clear your search history. Spiritually.', 'Look innocent. It’s mostly true.',
  'Pretend to still be typing. Mind games.', 'Mute your family group chat. Pre-emptively.',
];

const App = ({ kind }: { kind: Kind }) => <i className="cs-app" style={brand(kind)} aria-hidden="true">{APPS[kind].icon}</i>;
function Logo({ className = '' }: { className?: string }) { return <span className={`cs-logo ${className}`}><i aria-hidden="true">🌀</i><span>Scroll<em>hole</em></span></span>; }

/**
 * One twisted post as a mock app screen. The context (the twist) sits in the app's slot and the original answer, attributed to
 * its author, sits where that app puts what people say. `step` (feed only) staggers it: 0 context, 1+ the answer drops in.
 */
function PostCard({ post, author, size, step = 9, children }: { post: Draft; author?: PackPlayer; size: 'feed' | 'grid' | 'phone'; step?: number; children?: ReactNode }) {
  const app = APPS[post.kind], px = size === 'feed' ? 62 : size === 'grid' ? 36 : 30;
  const avatar = author && <Avatar avatar={author.avatar} color={author.color} size={px} mood={step >= 1 && size === 'feed' ? 'sad' : 'idle'} />;
  return <article className="cs-post" data-kind={post.kind} data-size={size} style={brand(post.kind)}>
    <header className="cs-post-bar"><App kind={post.kind} /><b>{app.name}</b><span>{post.meta}</span></header>
    {post.kind === 'status' && <div className="cs-cover">{avatar}{author && <span className="cs-who"><b>{author.name}</b><small>{handle(author.name)}</small></span>}</div>}
    <div className="cs-slot"><small>{post.label}</small><p>{post.twist || <span className="cs-blank">your context goes here…</span>}</p></div>
    <div className="cs-said" data-hidden={step < 1 || undefined}>
      {post.kind !== 'status' && <div className="cs-by">{avatar}{author && <b>{handle(author.name)}</b>}{app.said && <small>{app.said}</small>}</div>}
      <p>{post.answer}</p>
      {step < 1 && <span className="cs-typing">{author ? handle(author.name) : 'Someone'} is typing <i className="cs-dots" aria-hidden="true"><em /><em /><em /></i></span>}
    </div>
    {children}
  </article>;
}

function Likes({ post, step }: { post: Post; step: number }) {
  const likes = useCountUp(step >= 2 ? post.likes : Math.round(post.likes * .03), 2600);
  return <footer className="cs-post-foot"><span className="cs-heart" data-on={step >= 2 || undefined}>♥ <b className="kp-numeral">{compact(likes)}</b></span><span>💬 {step >= 3 ? post.replies.length + Math.round(post.likes / 900) : 0}</span><span>↗ Share</span></footer>;
}

// ---------- TV ----------

function AppBar({ view, badge, children }: { view: CommentPublic; badge?: number; children?: ReactNode }) {
  return <header className="cs-bar">
    <Logo />
    <span className="cs-chip" data-round={view.round}>{ROUNDS[view.round - 1]?.name}{view.round > 1 && <b> ×{ROUNDS[view.round - 1]!.mult}</b>}</span>
    <span className="cs-search" aria-hidden="true">🔍 Search Scrollhole</span>
    <span className="cs-bell" aria-hidden="true">🔔{!!badge && <b key={badge}>{badge}</b>}</span>
    <span className="cs-bar-side">{children}</span>
  </header>;
}

function Ticker({ items }: { items: string[] }) {
  const row = items.map((t, i) => <span key={i}>{t}</span>);
  return <div className="cs-ticker" aria-hidden="true"><b>Trending</b><div className="cs-ticker-run"><div className="cs-ticker-track">{row}{row}</div></div></div>;
}
const trending = (view: CommentPublic, players: readonly PackPlayer[]) => {
  const top = [...players].sort((a, b) => (view.scores[b.id] ?? 0) - (view.scores[a.id] ?? 0))[0];
  return [...TRENDING.map((t, i) => `${t} · ${compact(1200 + ((i * 7919 + view.round * 104_729) % 90_000))} posts`), ...(top && view.scores[top.id] ? [`${handle(top.name)} is trending`] : [])];
};

function RoundTV({ view }: P) {
  const r = ROUNDS[view.round - 1]!, final = view.round === ROUNDS.length, apps: Kind[] = final ? ['status'] : [...KINDS];
  return <section className="cs-round" key={view.round}>
    <Logo className="cs-logo-big" />
    <div className="cs-notif"><App kind="status" /><div><small>Scrollhole · now</small><b>{r.name}</b><p>{r.blurb}</p></div><span className="cs-notif-badge kp-numeral">{view.round}</span></div>
    <ul className="cs-fan" data-final={final || undefined}>{apps.map((k, i) => <li key={k} style={{ ...brand(k), '--i': i } as CSSProperties}><App kind={k} /><span>{APPS[k].name}</span></li>)}</ul>
    <p className="cs-round-points">{final ? <>Every answer becomes a <b>status update</b> on its author’s profile. <b>×3 points</b>, two votes each.</> : view.round > 1 ? <>Every vote is worth <b>double</b>.</> : <>Twister: <b>100</b> per vote. Ruined author: <b>50</b> per vote.</>}</p>
  </section>;
}

function Activity({ players, done, verb }: { players: readonly PackPlayer[]; done: readonly string[]; verb: string }) {
  return <ol className="cs-activity" data-dense={players.length > 7 || undefined} aria-label={`${done.length} of ${players.length} posted`}>
    {players.map(p => { const ok = done.includes(p.id); return <li key={p.id} data-done={ok || undefined} data-offline={!p.connected || undefined} style={{ '--c': p.color } as CSSProperties}>
      <Avatar avatar={p.avatar} color={p.color} size={players.length > 7 ? 46 : 58} mood={!p.connected ? 'sad' : ok ? 'done' : 'thinking'} />
      <span className="cs-who"><b>{p.name}</b><small>{!p.connected ? 'offline' : ok ? 'posted ✓' : verb}</small></span>
      {!ok && p.connected && <i className="cs-dots" aria-hidden="true"><em /><em /><em /></i>}
    </li>; })}
  </ol>;
}

function WriteTV({ view, players, now }: P) {
  const twist = view.phase === 'twist', final = view.round === ROUNDS.length;
  return <section className="cs-write" data-phase={view.phase}>
    <AppBar view={view} badge={view.done.length}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} /></AppBar>
    <div className="cs-write-main">
      {twist
        ? <div className="cs-machine">
          <h2 className="kp-title">Now, ruin somebody.</h2>
          <p>{final ? <>Everyone got a friend’s answer. Turn it into a <b>status update</b> on their profile.</> : <>Everyone got a friend’s answer and a random app. Write the <b>missing context</b>.</>}</p>
          <ul className="cs-machine-apps" data-final={final || undefined}>{(final ? ['status'] as Kind[] : [...KINDS]).map((k, i) => <li key={k} style={{ ...brand(k), '--i': i } as CSSProperties}><App kind={k} /><span>{APPS[k].name}</span></li>)}</ul>
        </div>
        : <div className="cs-composer">
          <header><Logo /><span>Create post</span></header>
          <div className="cs-composer-box"><span className="cs-ghost-avatar" aria-hidden="true" /><p>What’s on your mind?<i className="cs-caret" aria-hidden="true" /></p></div>
          <p className="cs-composer-note">Everyone got their own <b>innocent question</b>. Answer honestly.</p>
          <p className="cs-composer-small">What could possibly go wrong?</p>
        </div>}
      <aside className="cs-side-panel"><h3>Activity <b className="kp-numeral">{view.done.length}/{players.length}</b></h3><Activity players={players} done={view.done} verb={twist ? 'adding context…' : 'typing…'} /></aside>
    </div>
    <Ticker items={trending(view, players)} />
  </section>;
}

function FeedTV({ view, players, now }: P) {
  const posts = view.posts ?? [], i = posts.length - 1, post = posts[i], author = post && find(players, post.author);
  const step = useTimeline(view.beats?.[i] ?? Infinity, [POST.answer, POST.likes, POST.reply1, POST.reply2], now);
  return <section className="cs-feed">
    <AppBar view={view} badge={posts.length}><span className="cs-count">Post <b className="kp-numeral">{Math.max(1, i + 1)}</b> of {players.length}</span></AppBar>
    <div className="cs-feed-main">
      <aside className="cs-history"><h3>Earlier</h3><ol>{posts.slice(0, -1).reverse().map(p => { const who = find(players, p.author);
        return <li key={p.id} style={brand(p.kind)}><App kind={p.kind} /><span className="cs-who"><b>{APPS[p.kind].name}</b><small>{p.twist}</small></span>{who && <Avatar avatar={who.avatar} color={who.color} size={40} mood="sad" />}</li>; })}</ol></aside>
      <div className="cs-feed-stage">
        {post ? <div className="cs-feed-post" key={post.id} style={{ '--feed-fs': `${post.twist.length + post.answer.length > 60 ? 48 : 54}px` } as CSSProperties}>
          <PostCard post={post} author={author} size="feed" step={step}>
            <Likes post={post} step={step} />
            <ol className="cs-replies">{post.replies.map((r, k) => step >= 3 + k && <li key={k}><b>{r.who}</b> {r.text}</li>)}</ol>
          </PostCard>
          {step >= 2 && <div className="cs-reacts" aria-hidden="true">{REACTIONS.map((_, k) => <i key={k} style={{ '--k': k, '--x': `${(k * 37) % 100}%` } as CSSProperties}>{REACTIONS[(k + post.likes) % REACTIONS.length]}</i>)}</div>}
        </div> : <div className="cs-refresh" role="status"><i aria-hidden="true">↻</i>Refreshing your feed…</div>}
      </div>
      <aside className="cs-feed-cast">{author && <>
        <small>Originally said by</small>
        <AvatarBadge player={author} size={130} layout="column" mood={step >= 1 ? 'sad' : 'idle'} />
        <p className="cs-context-by"><small>Context added by</small><span className="cs-mystery kp-title" aria-label="Secret until the vote">?</span></p>
      </>}</aside>
    </div>
    <Ticker items={trending(view, players)} />
  </section>;
}

function VerdictFoot({ v, players, roomy }: { v: Verdict; players: readonly PackPlayer[]; roomy: boolean }) {
  const twister = find(players, v.twister), voters = v.voters.map(id => find(players, id)).filter(p => !!p);
  return <footer className="cs-verdict">
    {twister && <span className="cs-twister"><Avatar avatar={twister.avatar} color={twister.color} size={roomy ? 48 : 36} mood={v.votes ? 'happy' : 'idle'} /><span className="cs-who"><small>Context by</small><b>{twister.name}</b></span></span>}
    <span className="cs-votes"><b className="kp-numeral">{v.votes}</b> {v.votes === 1 ? 'vote' : 'votes'}{roomy && voters.length > 0 && <AvatarStack players={voters} size={32} max={5} />}</span>
    {(v.authorPoints > 0 || v.auto || v.house) && <span className="cs-tags">{v.authorPoints > 0 && <em>💔 ruined +{v.authorPoints}</em>}{v.auto && <em>House twist · half</em>}{v.house && <em>House answer</em>}</span>}
  </footer>;
}

function BoardTV({ view, players, vip, now }: P) {
  const posts = view.posts ?? [], n = posts.length, result = view.result, beats = revealBeats(result?.verdicts.length ?? 0), vote = view.phase === 'vote';
  const step = useTimeline(view.at, result ? [...beats.reveals, beats.reported] : [Infinity], now);
  const order = new Map(result?.verdicts.map((v, i) => [v.id, i])), crowned = !!result && step > result.verdicts.length;
  const reported = crowned ? result.verdicts.filter(v => result.reported.includes(v.id)) : [], final = view.round === ROUNDS.length;
  const cols = n <= 3 ? Math.max(1, n) : n === 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5, fs = n <= 3 ? 40 : n <= 4 ? 34 : n <= 6 ? 29 : n <= 8 ? 27 : 23;
  const names = (ids: string[]) => ids.map(id => find(players, id)?.name ?? '?').join(' & ');
  return <section className="cs-board" data-phase={view.phase}>
    <AppBar view={view} badge={vote ? view.done.length : n}>{vote && <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={112} />}</AppBar>
    <p className="cs-board-head" role="status">{vote
      ? <><b>Vote for the most ruinous post!</b> {final ? 'Two votes each.' : 'One vote each.'} <span>Not your own twist.</span></>
      : !crowned ? <>Unmasking who added the context…</>
      : reported.length === 1 ? <><b className="cs-red">Reported!</b> {names([reported[0]!.twister])} ruined {names([posts.find(p => p.id === reported[0]!.id)!.author])}.</>
      : reported.length ? <><b className="cs-red">Reported!</b> A {reported.length}-way tie for most ruinous.</>
      : <>Nobody voted. The algorithm is disappointed.</>}</p>
    <ol className="cs-grid" style={{ '--cols': cols, '--fs': `${fs}px` } as CSSProperties} data-roomy={n <= 4 || undefined} data-dense={n > 8 || undefined}>
      {posts.map((p, i) => {
        const at = order.get(p.id) ?? -1, v = result?.verdicts[at], shown = !!v && step > at, hot = crowned && result.reported.includes(p.id);
        return <li key={p.id} data-state={hot ? 'reported' : crowned ? 'dim' : shown ? 'shown' : undefined} style={{ animationDelay: `${i * 70}ms` }}>
          <span className="cs-letter kp-title">{letter(i)}</span>
          <PostCard post={p} author={find(players, p.author)} size="grid">
            {n <= 3 && <ol className="cs-replies">{p.replies.slice(0, p.twist.length + p.answer.length > 90 ? 1 : 2).map((r, k) => <li key={k}><b>{r.who}</b> {r.text}</li>)}</ol>}
            {shown && v ? <VerdictFoot v={v} players={players} roomy={n <= 6} /> : <footer className="cs-post-foot"><span>♥ {compact(p.likes)}</span><span>💬 {p.replies.length}</span></footer>}</PostCard>
          {shown && v && v.points > 0 && <b className="cs-points kp-numeral">+{v.points}</b>}
          {hot && <b className="cs-stamp" aria-label="Reported">Reported</b>}
        </li>;
      })}
    </ol>
    {vote ? <PlayerStrip className={`cs-strip${n > 6 ? ' cs-strip-dense' : ''}`} players={players} done={view.done} vip={vip} size={n > 6 ? 40 : 58} /> : <div className="cs-board-pad" />}
    {reported.length > 0 && <Confetti burst={`reported-${view.round}`} count={120} />}
  </section>;
}

function ScoresTV({ view, players }: P) {
  const prev = view.prev ?? {}, gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  return <section className="cs-scores">
    <AppBar view={view} />
    <div className="cs-scores-main">
      <div className="cs-scores-side">
        <BigTitle kicker={`After round ${view.round}`} size={112}>Follower count</BigTitle>
        <div className="cs-notif cs-notif-small"><App kind="status" /><div><small>Scrollhole · up next</small><b>{ROUNDS[view.round]?.name}</b><p>{ROUNDS[view.round]?.blurb}</p></div></div>
      </div>
      <Scoreboard players={players} scores={view.scores} from={prev} delay={900} rowHeight={players.length > 8 ? 80 : 90} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
    </div>
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-comment-section cs-tv" data-phase={view.phase}>
    <div className="cs-wall" aria-hidden="true" />
    {view.phase === 'round' ? <RoundTV {...props} />
      : view.phase === 'answer' || view.phase === 'twist' ? <WriteTV {...props} />
      : view.phase === 'feed' ? <FeedTV {...props} />
      : view.phase === 'scores' ? <ScoresTV {...props} />
      : <BoardTV {...props} />}
  </div>;
}

// ---------- phone ----------

function Standing({ view, players, player }: { view: CommentPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  const rank = rankOf(view.scores, player.id, players.map(p => p.id));
  return <p className="cs-standing"><b className="kp-title">{ordinal(rank)}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> followers</p>;
}
const shellOf = ({ view, player, vip, now }: Phone, timer = false) => ({ player, vip: vip === player.id, accent: ACCENT, eyebrow: ROUNDS[view.round - 1]?.name, ...(timer ? { timer: { deadline: view.deadline, now, total: view.deadline - view.at } } : {}) });

function RoundPhone(props: Phone) {
  const r = ROUNDS[props.view.round - 1]!;
  return <PhoneShell {...shellOf(props)} title={r.name}>
    <div className="cs-notif cs-notif-phone"><App kind="status" /><div><small>Scrollhole · now</small><b>{r.blurb}</b></div></div>
    <PhoneWaiting player={props.player} title="Get ready" detail="First, an innocent question about you." lines={WAIT_LINES} />
  </PhoneShell>;
}

function AnswerPhone(props: Phone) {
  const { view, me, players, send, sessionKey } = props;
  if (me.answer !== undefined) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shellOf(props, true)} title="Answer posted!">
      <PhoneDone title="Nice and innocent." detail="Now act natural. Somebody else gets this next."><p className="cs-mine">“{me.answer}”</p></PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the slowpokes" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shellOf(props, true)} title="Answer honestly">
    <PhoneTextEntry multiline label={me.question ?? ''} draftKey={`${sessionKey}:${view.turn}:answer`} maxLength={MAX_ANSWER} placeholder="Be honest. Keep it innocent…"
      submitLabel="Post answer" hint="Short and sincere works best." onSubmit={text => send({ turn: view.turn, k: 'answer', text })} />
  </PhoneShell>;
}

/** Twist entry with a live preview of the finished post; mirrors PhoneTextEntry (hj-entry) so drafts, states and QA hooks match. */
function TwistEntry({ target, author, draftKey, onSubmit }: { target: NonNullable<CommentPrivate['target']>; author?: PackPlayer; draftKey: string; onSubmit(text: string): Promise<{ accepted: boolean; reason?: string }> }) {
  const [text, setText] = useDraft(draftKey, ''), [state, run] = useSend(), id = useId();
  const value = text.trim(), pending = state.status === 'pending', locked = pending || state.status === 'accepted';
  const submit = async (event?: FormEvent) => { event?.preventDefault(); if (value && !locked) await run(() => onSubmit(value)); };
  return <form className="hj-entry cs-entry" data-state={state.status} onSubmit={submit}>
    <label htmlFor={id} className="hj-entry-label">{target.format.ask}</label>
    <PostCard post={{ ...target.format, twist: text.trim(), answer: target.answer }} author={author} size="phone" />
    <textarea id={id} rows={2} value={text} maxLength={MAX_TWIST} placeholder="Add the context…" disabled={locked} autoComplete="off" spellCheck enterKeyHint="send" autoCapitalize="sentences"
      aria-describedby={`${id}-n`} onChange={e => setText(e.target.value.slice(0, MAX_TWIST))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
    <div className="hj-entry-meta"><span>The bit in bold is yours.</span><span id={`${id}-n`} className="kp-numeral" data-warn={MAX_TWIST - text.length <= 10 || undefined} aria-label={`${text.length} of ${MAX_TWIST} characters`}>{text.length}/{MAX_TWIST}</span></div>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton type="submit" tone="lime" size="lg" disabled={!value || locked}>{pending ? 'Posting…' : state.status === 'accepted' ? 'Posted ✓' : 'Post it'}</ArcadeButton></div>
  </form>;
}

function TwistPhone(props: Phone) {
  const { view, me, players, send, sessionKey } = props, [help, run] = useSend(), target = me.target!, author = find(players, target.author);
  if (me.twist !== undefined) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shellOf(props, true)} title={me.auto ? 'The house wrote it' : 'Context added 😈'}>
      <PhoneDone title="Posted." detail={me.auto ? 'House twists score half. It’s still out there.' : 'Keep a straight face. Nobody knows it was you.'}>
        <PostCard post={{ ...target.format, twist: me.twist, answer: target.answer }} author={author} size="phone" />
      </PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Still twisting…" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shellOf(props, true)} eyebrow={`Twist it · ${APPS[target.format.kind].name}`} title={author ? <>Ruin {author.name}’s answer</> : 'Ruin this answer'}>
    <TwistEntry target={target} author={author} draftKey={`${sessionKey}:${view.turn}:twist`} onSubmit={text => send({ turn: view.turn, k: 'twist', text })} />
    <ArcadeButton tone="ghost" size="md" className="cs-help" disabled={help.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'auto' }))}>
      Stuck? Let the house write it <small className="cs-nowrap">(half points)</small>
    </ArcadeButton>
    {help.status === 'rejected' && <StatusNotice tone="error">{help.reason}</StatusNotice>}
  </PhoneShell>;
}

function FeedPhone(props: Phone) {
  const { view, me, player, players } = props, posts = view.posts ?? [], cur = posts.at(-1), mine = cur?.id === me.mine, about = cur?.id === me.about;
  return <PhoneShell {...shellOf(props)} title={!cur ? 'Refreshing the feed…' : mine ? 'That’s your twist!' : about ? 'You’ve been ruined!' : 'Eyes on the TV'}>
    <div className="cs-phone-card" data-hot={mine || about || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={124} mood={about ? 'sad' : mine ? 'happy' : 'idle'} />
      <p>{mine ? 'Keep a straight face. Nobody knows it was you… yet.' : about ? 'That’s your answer, with brand-new context. Smile through it.' : cur ? `Post ${posts.length} of ${players.length}. Spot the most ruinous one.` : 'Every twisted post is coming up on the big screen.'}</p>
      <p className="cs-tv-cue">Voting opens after the feed.</p>
    </div>
  </PhoneShell>;
}

function PostOption({ post, author }: { post: Post; author?: PackPlayer }) {
  return <span className="cs-option" style={brand(post.kind)}><App kind={post.kind} /><span className="cs-who"><small>{APPS[post.kind].name} · {post.label}</small><b>{post.twist}</b><q>{post.answer}</q>{author && <small>{handle(author.name)}</small>}</span></span>;
}

function VotePhone(props: Phone) {
  const { view, me, players, send } = props, posts = view.posts ?? [], max = ROUNDS[view.round - 1]!.votes;
  if (me.votes) return <PhoneShell {...shellOf(props, true)} title={me.votes.length > 1 ? 'Votes cast!' : 'Vote cast!'}>
    <PhoneDone title="Reported." detail="Watch the TV for the verdict.">
      <ul className="cs-voted">{me.votes.map(id => { const p = posts.find(x => x.id === id); return p && <li key={id} style={brand(p.kind)}><App kind={p.kind} /><b>{p.twist}</b></li>; })}</ul>
    </PhoneDone>
  </PhoneShell>;
  return <PhoneShell {...shellOf(props, true)} title={max > 1 ? 'Pick up to 2 posts' : 'Which post is the worst?'}>
    <p className="cs-ballot-note">Vote for the most <b>ruinous</b> post. {max > 1 ? 'Pick one or two, then report them.' : 'Tap to vote.'}</p>
    <PhoneChoices className="cs-ballot" label="Vote for the most ruinous post" multi={max > 1} min={1} max={max} submitLabel="Report" onSubmit={ids => send({ turn: view.turn, k: 'vote', posts: ids })}
      options={posts.map((p, i) => ({ id: p.id, label: <><span className="cs-letter kp-title">{letter(i)}</span><PostOption post={p} author={find(players, p.author)} /></>, ariaLabel: `Post ${letter(i)}: ${p.label}: ${p.twist}. ${p.answer}`, disabled: p.id === me.mine, reason: 'Your twist' }))} />
  </PhoneShell>;
}

function ResultsPhone(props: Phone) {
  const { view, me, player, players, now } = props, result = view.result, n = result?.verdicts.length ?? 0, beats = revealBeats(n);
  const step = useTimeline(view.at, [...beats.reveals, beats.reported], now), crowned = step > n;
  const at = (id?: string) => result?.verdicts.findIndex(v => v.id === id) ?? -1, mi = at(me.mine), ai = at(me.about);
  const mine = mi >= 0 && step > mi ? result!.verdicts[mi] : undefined, about = ai >= 0 && step > ai ? result!.verdicts[ai] : undefined;
  const hot = crowned && !!me.mine && !!result?.reported.includes(me.mine), posts = view.posts ?? [];
  const stakes = [['Your twist', posts.find(p => p.id === me.mine)?.twist], ['Made from your answer', posts.find(p => p.id === me.about)?.answer]] as const;
  return <PhoneShell {...shellOf(props)} title={hot ? 'Your post got REPORTED!' : crowned ? 'The feed has spoken' : 'Counting the votes…'}>
    <div className="cs-phone-card" data-hot={hot || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={124} mood={hot ? 'happy' : mine || about ? 'idle' : 'thinking'} />
      {mine && <p className="cs-gain"><b className="kp-numeral">+{mine.points}</b> {plural(mine.votes, 'vote')} for your twist{mine.auto ? ' (house twist, half)' : ''}</p>}
      {about && about.authorPoints > 0 && <p className="cs-gain cs-gain-ruined"><b className="kp-numeral">+{about.authorPoints}</b> for getting ruined</p>}
      {crowned ? <Standing view={view} players={players} player={player} /> : !mine && <p className="cs-tv-cue">Eyes on the TV!</p>}
      <ul className="cs-voted">{stakes.map(([label, text]) => text && <li key={label}><span className="cs-who"><small>{label}</small><b>{text}</b></span></li>)}</ul>
    </div>
  </PhoneShell>;
}

function ScoresPhone(props: Phone) {
  const { view, player, players } = props;
  return <PhoneShell {...shellOf(props)} title="Follower count">
    <div className="cs-phone-card"><Avatar avatar={player.avatar} color={player.color} size={124} mood={rankOf(view.scores, player.id, players.map(p => p.id)) === 1 ? 'happy' : 'idle'} />
      <Standing view={view} players={players} player={player} />
      <p>{view.round === 1 ? 'Round 2 is worth double. Plenty of time to ruin everyone.' : 'The Final Feed is worth triple, with two votes each.'}</p></div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Refreshing…" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-comment-section cs-phone">
    {view.phase === 'round' ? <RoundPhone {...phone} />
      : view.phase === 'answer' ? <AnswerPhone {...phone} />
      : view.phase === 'twist' && me.target ? <TwistPhone {...phone} />
      : view.phase === 'feed' ? <FeedPhone {...phone} />
      : view.phase === 'vote' ? <VotePhone {...phone} />
      : view.phase === 'results' ? <ResultsPhone {...phone} />
      : view.phase === 'scores' ? <ScoresPhone {...phone} />
      : <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
