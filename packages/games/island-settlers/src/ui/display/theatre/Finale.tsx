/**
 * The finale's hidden-VP flips (EXPERIENCE §3.10): during each seat's slot a card turns over its rail
 * VP numeral, "?" on the back and "+2" on the face. WP-hud's rail owns the numeral, crown, ranks and
 * the FLIP re-sort; this overlay only adds the card, placed over `[data-seat-vp]`.
 */
import type { PublicView } from '../../../model';
import type { Layer } from './Flights';
import { EASE } from './motion';
import { flipsAt } from './reveal';

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
