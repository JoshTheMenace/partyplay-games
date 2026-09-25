import type { CSSProperties } from 'react';
import type { PublicView, SeatId } from '../../model';
import { SeatChip } from '../shared/SeatChip';
import { nameOf } from '../shared/seats';
import { snake } from './logic';

const u = (n: number) => `calc(${n} * var(--u))`;

/** "Race to 10": a 0…target track with emblem pawns at each seat's public VP (EXPERIENCE §3.2). */
export function RaceTrack({ pub, vp }: { pub: PublicView; vp: Record<SeatId, number> }) {
  const target = Math.max(1, pub.settings.targetPoints), stacks = new Map<number, SeatId[]>();
  for (const s of pub.seats) {
    const at = Math.min(target, vp[s.id] ?? s.vp);
    stacks.set(at, [...(stacks.get(at) ?? []), s.id]);
  }
  const ticks = Array.from({ length: target + 1 }, (_, i) => i);
  const at = (points: number) => `${(points / target) * 100}%`;
  return <header className="island-settlers-hud-race island-settlers-panel" aria-label={`Race to ${target}`}>
    <p className="island-settlers-hud-race-label">Race to <b className="kp-numeral">{target}</b></p>
    <div className="island-settlers-hud-track">
      {ticks.map(i => <i key={i} style={{ left: at(i) }} data-bold={i % 5 === 0 || undefined}/>)}
      {[...stacks].map(([points, ids]) => {
        const close = points === target - 1 && pub.turn.stage !== 'finale' && pub.turn.stage !== 'ended';
        const label = ids.map(id => `${nameOf(pub, id)} ${points}`).join(', ');
        return <span key={points} className="island-settlers-hud-pawns" style={{ left: at(points) }}
          data-close={close || undefined} role="img" aria-label={`${label} points`}>
          {close && <em>1 to win</em>}
          {ids.slice(0, 3).map((id, i) => <span key={id} style={{ '--stack': i } as CSSProperties}>
            <SeatChip pub={pub} seat={id} size={u(26)}/>
          </span>)}
          {ids.length > 3 && <b className="island-settlers-hud-more">+{ids.length - 3}</b>}
        </span>;
      })}
    </div>
  </header>;
}

/** Setup: the snake order 1…n then n…1, with a sun caret on the placement happening now (§3.9). */
export function SnakeStrip({ pub, width }: { pub: PublicView; width: number }) {
  const { rows, at } = snake(pub), size = Math.min(26, (width - 32 - 36) / rows[0].length - 8);
  const state = (r: number, c: number) => !at ? 'next'
    : r === at[0] && c === at[1] ? 'now' : r < at[0] || (r === at[0] && c < at[1]) ? 'done' : 'next';
  return <header className="island-settlers-hud-race island-settlers-panel" aria-label="Setup order">
    {rows.map((row, r) => <ol key={r} className="island-settlers-hud-snake">
      <li className="island-settlers-hud-snake-label" aria-label={`Round ${r + 1}`}>{r ? '2 ◂' : '1 ▸'}</li>
      {row.map((id, c) => <li key={id} data-state={state(r, c)}>
        <SeatChip pub={pub} seat={id} size={u(size)}/>
      </li>)}
    </ol>)}
  </header>;
}
