/* Standings: animated scoreboard and the 1st/2nd/3rd podium. */
import { useEffect, useState, type CSSProperties } from 'react';
import type { PackPlayer } from '../contract';
import { Avatar, AvatarBadge } from './avatar';
import { useCountUp } from './hooks';

export const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** Competition ranking (1, 1, 3…): 1 + number of players with a strictly higher score. */
export const rankOf = (scores: Record<string, number>, id: string, ids: readonly string[]) => 1 + ids.filter(o => (scores[o] ?? 0) > (scores[id] ?? 0)).length;

/** Gold trophy icon. Decorative unless `label` is given. */
export const Trophy = ({ className = '', label }: { className?: string; label?: string }) => <svg className={`hj-trophy ${className}`} viewBox="0 0 48 48" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
  <path className="hj-trophy-handles" d="M12 10H5C5 20 9 24 15 25M36 10H43C43 20 39 24 33 25" />
  <path className="hj-trophy-cup" d="M11 5H37V15C37 24 31 30 24 30C17 30 11 24 11 15Z" /><path className="hj-trophy-cup" d="M20 30H28V36H33V43H15V36H20Z" />
  <path className="hj-trophy-shine" d="M17 10V16C17 20 19 23 21 24" />
</svg>;

function Count({ value }: { value: number }) { return <>{useCountUp(value)}</>; }

/**
 * Ranked rows that slide to their new places while scores count up. Pass `from` (previous scores) to animate from the
 * old standings after `delay` ms; deltas pop next to each name. `highlight` marks ids (e.g. this round's winners).
 */
export function Scoreboard({ players, scores, from, delay = 700, highlight = [], rowHeight = 84, className = '' }: { players: readonly PackPlayer[]; scores: Record<string, number>; from?: Record<string, number>; delay?: number; highlight?: readonly string[]; rowHeight?: number; className?: string }) {
  const [settled, setSettled] = useState(!from);
  useEffect(() => { if (!from) return; const id = setTimeout(() => setSettled(true), delay); return () => clearTimeout(id); }, [!from, delay]); // `from` identity may change every render
  const shown = settled ? scores : from!, ids = players.map(p => p.id), score = (id: string) => shown[id] ?? 0;
  const order = [...players].sort((a, b) => score(b.id) - score(a.id) || ids.indexOf(a.id) - ids.indexOf(b.id));
  return <ol className={`hj-board ${className}`} style={{ height: rowHeight * players.length, '--row': `${rowHeight}px` } as CSSProperties}>
    {players.map(p => { const rank = rankOf(shown, p.id, ids), gain = from && settled ? (scores[p.id] ?? 0) - (from[p.id] ?? 0) : 0;
      return <li key={p.id} data-top={rank === 1 || undefined} data-hot={highlight.includes(p.id) || undefined} style={{ transform: `translateY(${order.indexOf(p) * rowHeight}px)`, '--c': p.color } as CSSProperties} aria-label={`${ordinal(rank)}: ${p.name}, ${scores[p.id] ?? 0} points`}>
        <span className="hj-board-rank kp-numeral">{ordinal(rank)}</span>
        <AvatarBadge player={p} size={rowHeight - 18} mood={rank === 1 && settled ? 'happy' : 'idle'} />
        {gain > 0 && <em className="hj-board-gain kp-numeral">+{gain}</em>}
        <b className="hj-board-score kp-numeral"><Count value={score(p.id)} /></b>
      </li>; })}
  </ol>;
}

/**
 * Celebration podium: tied players share a step, steps rise 3rd → 2nd → 1st, everyone else lines up below.
 * `winners` get the trophy (defaults to the top score when it is above zero).
 */
export function Podium({ players, scores, winners, unit = 'pts', className = '' }: { players: readonly PackPlayer[]; scores: Record<string, number>; winners?: readonly string[]; unit?: string; className?: string }) {
  const ids = players.map(p => p.id), values = [...new Set(players.map(p => scores[p.id] ?? 0))].sort((a, b) => b - a);
  const steps = values.slice(0, 3).map(v => players.filter(p => (scores[p.id] ?? 0) === v)), rest = players.filter(p => values.indexOf(scores[p.id] ?? 0) >= 3);
  const won = winners ?? (values[0]! > 0 ? steps[0]!.map(p => p.id) : []);
  rest.sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  return <div className={`hj-podium ${className}`}>
    <div className="hj-podium-steps">{[1, 0, 2].map(place => { const group = steps[place]; if (!group) return null; const rank = rankOf(scores, group[0]!.id, ids);
      return <section key={place} className={`hj-step hj-step-${place + 1}`} data-crowd={group.length > 1 || undefined} style={{ '--n': group.length } as CSSProperties} aria-label={`${ordinal(rank)} place: ${group.map(p => p.name).join(', ')}`}>
        <div className="hj-step-people">{group.map(p => <div key={p.id} className="hj-step-person" style={{ '--c': p.color } as CSSProperties}>
          {won.includes(p.id) && <Trophy className="hj-step-trophy" label="Trophy winner" />}
          <Avatar avatar={p.avatar} color={p.color} size={group.length === 1 ? (place === 0 ? 150 : 120) : group.length === 2 ? 110 : group.length === 3 ? 92 : 72} mood={place === 0 ? 'happy' : 'idle'} />
          <b className="hj-name">{p.name}</b>
        </div>)}</div>
        <div className="hj-step-block"><span className="kp-title">{ordinal(rank)}</span><small className="kp-numeral">{scores[group[0]!.id] ?? 0} {unit}</small></div>
      </section>; })}</div>
    {rest.length > 0 && <ol className="hj-podium-rest">{rest.map(p => <li key={p.id}><span className="kp-numeral">{ordinal(rankOf(scores, p.id, ids))}</span><AvatarBadge player={p} size={44} /><b className="kp-numeral">{scores[p.id] ?? 0}</b></li>)}</ol>}
  </div>;
}
