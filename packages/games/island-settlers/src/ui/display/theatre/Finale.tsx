/**
 * The finale's hidden-VP flips (EXPERIENCE §3.10): during each seat's slot a card turns over its rail
 * VP numeral, "?" on the back and "+2" on the face. WP-hud's rail owns the numeral, crown, ranks and
 * the FLIP re-sort; this overlay only adds the card, placed over `[data-seat-vp]`.
 */
import type { CSSProperties } from 'react';
import type { PublicView } from '../../../model';
import { dense, REVEAL } from '../logic';
import type { Rect } from '../../shared/layout';
import { SeatChip } from '../../shared/SeatChip';
import { SEATS, seatOf } from '../../shared/seats';
import type { Layer } from './Flights';
import { clamp01, EASE, hash } from './motion';
import { flipsAt } from './reveal';

const CONFETTI = ['#ffd24a', '#ff5748', '#28c6e7', '#78d955', '#b58aff', '#fff6e5'];
const PIECES = 46;

/**
 * Once the hidden points are in and the rail has sorted, the winner's card lands on the board with a
 * shower of confetti until the results screen takes over. Reduced motion shows the card alone.
 */
export function WinnerCard({ pub, now, reduced, u, board }: {
  pub: PublicView; now: number; reduced: boolean; u: number; board: Rect;
}) {
  const res = pub.results;
  if (!res || pub.turn.stage !== 'finale') return null;
  const step = dense(pub.seats.length) ? REVEAL.stepDense : REVEAL.step;
  const t = now - res.finaleAt - REVEAL.start - (reduced ? 0 : pub.seats.length * step + 700);
  if (t < 0) return null;
  const winners = res.winners.filter(id => seatOf(pub, id)), enter = reduced ? 1 : EASE.back(clamp01(t / 420), 1.6);
  const style: CSSProperties = {
    left: (board.left + board.width / 2) * u, top: (board.top + board.height * 0.44) * u,
    transform: `translate(-50%, -50%) scale(${0.4 + 0.6 * enter})`, opacity: clamp01(t / 160),
    '--seat': SEATS[(seatOf(pub, winners[0])?.seat ?? 4) % SEATS.length].body,
  } as CSSProperties;
  return <>
    {!reduced && <div className="island-settlers-confetti" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => {
        const life = 2200 + hash(i, 3) * 1600, age = ((t + hash(i, 1) * life) % life) / life;
        const x = (board.left + hash(i, 7) * board.width) * u + Math.sin(age * 6 + i) * 30 * u;
        const y = (board.top - 40 + age * (board.height + 80)) * u;
        return <i key={i} style={{
          transform: `translate(${x}px, ${y}px) rotate(${age * 720 * (i % 2 ? 1 : -1)}deg) scaleY(${0.4 + 0.6 * Math.abs(Math.cos(age * 9 + i))})`,
          background: CONFETTI[i % CONFETTI.length], opacity: Math.min(1, 6 * (1 - age)),
        }}/>;
      })}
    </div>}
    <div className="island-settlers-winner" role="status" style={style}>
      <span className="island-settlers-winner-chips">
        {winners.slice(0, 3).map(id => <SeatChip key={id} pub={pub} seat={id} size={`${72 * u}px`}/>)}
      </span>
      <b>{pub.now.title}</b>
      <small>{res.reason === 'round-limit' ? 'Round limit reached' : `${res.standings[0]?.vp ?? 0} points`}</small>
    </div>
  </>;
}

export function FlipCards({ pub, now, at, reduced }: Omit<Layer, 'beats'> & { pub: PublicView }) {
  return <>{flipsAt(pub, now, reduced).map(({ seat, hidden, p }) => {
    const box = at.vp(seat);
    if (!box) return null;
    const turn = 180 * EASE.inOut(p), face = turn > 90;
    const size = Math.max(box.height, 52 * at.u);
    return <span key={seat} className="island-settlers-flip" data-face={face || undefined} style={{
      width: size * 0.9, height: size * 1.15,
      transform: `translate(${box.x}px, ${box.y}px) translate(-50%, -50%) perspective(${300 * at.u}px) `
        + `rotateY(${turn}deg) scale(${1 + 0.12 * Math.sin(p * Math.PI)})`,
    }}><b className="kp-numeral">{face ? `+${hidden}` : '?'}</b></span>;
  })}</>;
}
