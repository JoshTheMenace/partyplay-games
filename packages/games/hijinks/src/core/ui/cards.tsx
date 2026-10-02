/* TV cards: roster strip, prompt, answer and the anticipation → reveal → reaction → score choreography. */
import type { CSSProperties, ReactNode } from 'react';
import type { PackPlayer } from '../contract';
import { Avatar, AvatarBadge, AvatarStack, type AvatarSize } from './avatar';

/** Font size (px) that keeps long player text readable inside a card: base for short lines, smaller as it grows. */
export function fitText(text: string, base: number): number {
  const n = text.length;
  return Math.round(base * (n <= 24 ? 1 : n <= 50 ? .84 : n <= 90 ? .7 : n <= 140 ? .6 : .52));
}

/**
 * Every player in roster order. With `done` (ids that submitted) slots light up Jackbox-style; without it they just idle.
 * `badges` adds a small pill per player (score, trophies…). Sized for 10 players across the TV.
 */
export function PlayerStrip({ players, done, vip, badges, size, className = '' }: { players: readonly PackPlayer[]; done?: readonly string[]; vip?: string | null; badges?: Record<string, ReactNode>; size?: AvatarSize; className?: string }) {
  const px = size ?? (players.length > 8 ? 80 : 100);
  return <ol className={`hj-strip ${className}`} aria-label={done ? `${players.filter(p => done.includes(p.id)).length} of ${players.length} players ready` : 'Players'}>
    {players.map(p => { const lit = done?.includes(p.id), fit = Math.floor(156 / .62 / Math.max(...p.name.split(' ').map(w => w.length))); return <li key={p.id} data-lit={lit || undefined} data-waiting={(done && !lit) || undefined} data-offline={!p.connected || undefined} style={{ '--c': p.color } as CSSProperties}>
      <Avatar avatar={p.avatar} color={p.color} size={px} crown={vip === p.id} mood={!p.connected ? 'sad' : lit ? 'done' : done ? 'thinking' : 'idle'} />
      <b className="hj-name" style={fit < 24 ? { fontSize: fit } : undefined}>{p.name}</b>
      {!p.connected ? <small>Offline</small> : badges?.[p.id] !== undefined && <em className="kp-numeral">{badges[p.id]}</em>}
      <span className="hj-sr">{!p.connected ? 'offline' : lit ? 'ready' : done ? 'still working' : ''}</span>
    </li>; })}
  </ol>;
}

/** The current prompt as a big TV card. Strings auto-shrink with length. */
export function PromptCard({ children, eyebrow = 'The prompt', size = 64, className = '' }: { children: ReactNode; eyebrow?: ReactNode; size?: number; className?: string }) {
  return <div className={`hj-prompt ${className}`}>
    {eyebrow && <span className="hj-prompt-tab">{eyebrow}</span>}
    <p style={{ fontSize: typeof children === 'string' ? fitText(children, size) : size }}>{children}</p>
  </div>;
}

export type AnswerState = 'idle' | 'win' | 'lose';
/**
 * A player answer on paper. `text` (auto-sized) or custom `children` (e.g. a DrawingRenderer). Optional `label` chip,
 * `voters` stack, `author` revealed when `showAuthor`, `points` pop and `tag` sticker. `state` win/lose drives the reaction.
 */
export function AnswerCard({ text, children, label, author, showAuthor, voters, points, tag, state = 'idle', size = 52, className = '' }: { text?: string; children?: ReactNode; label?: ReactNode; author?: PackPlayer | null; showAuthor?: boolean; voters?: readonly PackPlayer[]; points?: number | null; tag?: ReactNode; state?: AnswerState; size?: number; className?: string }) {
  return <article className={`hj-answer ${className}`} data-state={state} style={author && showAuthor ? { '--c': author.color } as CSSProperties : undefined}>
    {label && <span className="hj-answer-label">{label}</span>}
    {tag && <span className="hj-answer-tag">{tag}</span>}
    <div className="hj-answer-body">{text !== undefined && <p style={{ fontSize: fitText(text, size) }}>{text}</p>}{children}</div>
    {(voters?.length || (author && showAuthor) || points != null) && <footer>
      {voters && <AvatarStack players={voters} size={56} max={10} />}
      {author && showAuthor && <span className="hj-answer-author"><AvatarBadge player={author} size={56} mood={state === 'win' ? 'happy' : state === 'lose' ? 'sad' : 'idle'} /></span>}
      {points != null && <b className="hj-answer-points kp-numeral" key={points}>{points > 0 ? `+${points}` : points}</b>}
    </footer>}
  </article>;
}

export type VoteEntry = { id: string; text?: string; content?: ReactNode; author?: PackPlayer | null; voters: readonly PackPlayer[]; points?: number; tag?: ReactNode; label?: ReactNode };
/**
 * Reveal helper for any vote. Drive `step` from server time (useTimeline): 0 answers only, 1 voters fly in,
 * 2 authors revealed, 3 points + winner reaction (most voters; ties all win). Two entries get a head-to-head VS layout.
 */
export function VoteReveal({ entries, step, className = '' }: { entries: readonly VoteEntry[]; step: number; className?: string }) {
  const top = Math.max(0, ...entries.map(e => e.voters.length)), versus = entries.length === 2;
  return <div className={`hj-reveal ${versus ? 'hj-reveal-versus' : ''} ${className}`} style={{ '--n': Math.min(entries.length, 4) } as CSSProperties}>
    {entries.map((e, i) => <AnswerCard key={e.id} className={versus ? `hj-side-${i}` : undefined} text={e.text} label={e.label} tag={step >= 3 ? e.tag : undefined}
      voters={step >= 1 ? e.voters : undefined} author={e.author} showAuthor={step >= 2} points={step >= 3 && e.points !== undefined ? e.points : null}
      state={step < 3 || !top ? 'idle' : e.voters.length === top ? 'win' : 'lose'} size={versus ? 60 : entries.length > 4 ? 40 : 48}>{e.content}</AnswerCard>)}
    {versus && <span className="hj-vs kp-title" aria-hidden="true">VS</span>}
  </div>;
}

/** Waiting-room helper for the TV: who still owes an answer, as a row of thinking avatars. */
export function StillWorking({ players, label = 'Still writing…' }: { players: readonly PackPlayer[]; label?: ReactNode }) {
  if (!players.length) return null;
  return <div className="hj-still"><span>{label}</span>{players.map(p => <Avatar key={p.id} avatar={p.avatar} color={p.color} mood="thinking" size={52} />)}</div>;
}
