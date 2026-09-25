import { useRef, type ReactNode } from 'react';
import type { PublicView } from '../../model';
import { regions } from '../shared/layout';
import { Banner } from './banner';
import { useSecond, useSize } from './hooks';
import { LeftRail } from './left';
import { SeatRail } from './rail';
import { useTableSfx } from './sound';
import { Theatre } from './theatre';
import './display.css';

export type HudFrameProps = {
  pub: PublicView;
  serverNowMs(): number;
  /** Seated host (PersonalView): reserves the dock and lifts the strip (EXPERIENCE §4.9). */
  host?: boolean;
  /** Play public SFX from this device (the host's screen only). */
  sound?: boolean;
  /** Extra layers drawn inside the stage, e.g. the host dock; size them with `regions()` and `var(--u)`. */
  children?: ReactNode;
};

/**
 * The TV frame over the 3D board (EXPERIENCE §3.1): banner, left rail and seat rail in fixed regions, so the
 * board window never moves. Everything sizes in u (stage height / 980) from the stage's container query.
 * WP-theatre's overlay (dice, strip, fly-outs, finale) is the last child so its flights draw on top.
 */
export function HudFrame({ pub, serverNowMs, host = false, sound = false, children }: HudFrameProps) {
  const ref = useRef<HTMLDivElement>(null), size = useSize(ref), now = useSecond(serverNowMs);
  useTableSfx(pub, serverNowMs, sound);
  const rect = size && size.height > 0 ? regions(size, host) : null;
  return <div ref={ref} className="island-settlers-stage island-settlers-hud" data-stage={pub.turn.stage}>
    {rect && <>
      <Banner pub={pub} rect={rect.banner!} now={now}/>
      <LeftRail pub={pub} rect={rect.left!} serverNowMs={serverNowMs}/>
      <SeatRail pub={pub} rect={rect.rail!} now={now} serverNowMs={serverNowMs}/>
    </>}
    {children}
    <Theatre publicView={pub} serverNowMs={serverNowMs} host={host}/>
  </div>;
}
