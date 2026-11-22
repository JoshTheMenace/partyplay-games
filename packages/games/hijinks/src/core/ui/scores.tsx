/* Standings: animated scoreboard and the 1st/2nd/3rd podium. */
import { useEffect, useState, type CSSProperties } from 'react';
import type { PackPlayer } from '../contract';
import { COSY, isCrowd } from '../crowd';
import { Avatar, AvatarBadge } from './avatar';
import { useCountUp } from './hooks';

/** Big-room limits: scoreboard cells (two columns of sixteen), places named under the podium, faces in a tied podium cluster. */
const BOARD_CELLS = 32, REST_ROWS = 9, STEP_FACES = 8;
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
  // Big rooms: two columns in the height ten rows used to take. Up to 32 players all fit; above that the last cell counts the rest.
  const n = players.length, crowd = isCrowd(n), cells = crowd ? Math.min(n, BOARD_CELLS) : n, per = crowd ? Math.ceil(cells / 2) : n, seats = n > cells ? cells - 1 : cells;
  const row = crowd ? Math.min(rowHeight, Math.floor(rowHeight * COSY / per)) : rowHeight;
  const at = (i: number) => `translate(${crowd && i >= per ? 'calc(100% + 18px)' : '0'}, ${(crowd ? i % per : i) * row}px)`;
  return <ol className={`hj-board ${className}`} data-crowd={crowd || undefined} style={{ height: row * per, '--row': `${row}px` } as CSSProperties}>
    {players.map(p => { const rank = rankOf(shown, p.id, ids), gain = from && settled ? (scores[p.id] ?? 0) - (from[p.id] ?? 0) : 0, place = order.indexOf(p), out = place >= seats;
      return <li key={p.id} data-top={rank === 1 || undefined} data-hot={highlight.includes(p.id) || undefined} data-out={out || undefined} aria-hidden={out || undefined} style={{ transform: at(Math.min(place, cells - 1)), '--c': p.color } as CSSProperties} aria-label={`${ordinal(rank)}: ${p.name}, ${scores[p.id] ?? 0} points`}>
        <span className="hj-board-rank kp-numeral">{ordinal(rank)}</span>
        <AvatarBadge player={p} size={row - (crowd ? 14 : 18)} mood={rank === 1 && settled ? 'happy' : 'idle'} />
        {gain > 0 && <em className="hj-board-gain kp-numeral">+{gain}</em>}
        <b className="hj-board-score kp-numeral"><Count value={score(p.id)} /></b>
      </li>; })}
    {n > cells && <li className="hj-board-more" style={{ transform: at(cells - 1) }}>+{n - seats} more · your place is on your phone</li>}
  </ol>;
}

/**
 * Celebration podium: tied players share a step, steps rise 3rd → 2nd → 1st, everyone else lines up below.
 * `winners` get the trophy (defaults to the top score when it is above zero).
 */
export function Podium({ players, scores, winners, unit = 'pts', className = '' }: { players: readonly PackPlayer[]; scores: Record<string, number>; winners?: readonly string[]; unit?: string; className?: string }) {
  const ids = players.map(p => p.id), values = [...new Set(players.map(p => scores[p.id] ?? 0))].sort((a, b) => b - a), crowd = isCrowd(players.length);
  const steps = values.slice(0, 3).map(v => players.filter(p => (scores[p.id] ?? 0) === v)), rest = players.filter(p => values.indexOf(scores[p.id] ?? 0) >= 3);
  const won = winners ?? (values[0]! > 0 ? steps[0]!.map(p => p.id) : []);
  rest.sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  // A big room names the next nine places; everyone's own place is on their phone.
  const listed = crowd ? rest.slice(0, REST_ROWS) : rest;
  return <div className={`hj-podium ${className}`} data-crowd={crowd || undefined}>
    <div className="hj-podium-steps">{[1, 0, 2].map(place => { const all = steps[place]; if (!all) return null; const rank = rankOf(scores, all[0]!.id, ids);
      // A big room's tie can put a dozen players on one step: from four up they stand as a cluster of faces with a count.
      const faces = crowd && all.length > 3, group = faces ? all.slice(0, all.length > STEP_FACES ? STEP_FACES - 1 : STEP_FACES) : all, champs = faces && all.some(p => won.includes(p.id));
      return <section key={place} className={`hj-step hj-step-${place + 1}`} data-crowd={group.length > 1 || undefined} style={{ '--n': Math.min(group.length, 4) } as CSSProperties} aria-label={`${ordinal(rank)} place: ${all.map(p => p.name).join(', ')}`}>
        <div className="hj-step-people" data-faces={faces || undefined}>{place === 0 && won.length > 0 && <i className="hj-step-rays" aria-hidden="true" />}{champs && <Trophy className="hj-step-trophy" label="Trophy winners" />}
          {group.map(p => <div key={p.id} className="hj-step-person" style={{ '--c': p.color } as CSSProperties}>
            {!faces && won.includes(p.id) && <Trophy className="hj-step-trophy" label="Trophy winner" />}
            <Avatar avatar={p.avatar} color={p.color} size={faces ? 76 : group.length === 1 ? (place === 0 ? 150 : 120) : group.length === 2 ? 110 : group.length === 3 ? 92 : 72} mood={place === 0 ? 'happy' : 'idle'} />
            {!faces && <b className="hj-name">{p.name}</b>}
          </div>)}{all.length > group.length && <b className="hj-step-more kp-numeral">+{all.length - group.length}</b>}</div>
        {faces && <p className="hj-step-tied">{all.length} tied</p>}
        <div className="hj-step-block"><span className="kp-title">{ordinal(rank)}</span><small className="kp-numeral">{scores[all[0]!.id] ?? 0} {unit}</small></div>
      </section>; })}</div>
    {rest.length > 0 && <ol className="hj-podium-rest" data-many={rest.length > 4 || undefined}>{listed.map((p, i) => <li key={p.id} style={{ '--i': i } as CSSProperties}><span className="kp-numeral">{ordinal(rankOf(scores, p.id, ids))}</span><AvatarBadge player={p} size={crowd ? 36 : 44} /><b className="kp-numeral">{scores[p.id] ?? 0}</b></li>)}
      {rest.length > listed.length && <li className="hj-podium-more">+{rest.length - listed.length} more · your place is on your phone</li>}</ol>}
  </div>;
}
