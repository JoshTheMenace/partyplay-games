/**
 * Everything that moves across the stage (EXPERIENCE §3.6–3.7): resource cards arcing from hexes to
 * seat chips, face-down steal cards between rows, robber pings on hexes, and the chip bump on arrival.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Good, SeatId, TileId } from '../../../model';
import type { ScreenPoint } from '../../shared/bridge';
import { Icon } from '../../shared/icons';
import { GOOD_META } from '../../shared/labels';
import { ROLL_MS } from '../../shared/timeline';
import { arc, clamp01, EASE } from './motion';
import { FLY, HOP_MS, PING_MS, type Beat, type Flight, type Origin } from './plan';

export type Box = ScreenPoint & { left: number; right: number; height: number };
/** What every overlay layer receives from the Theatre each frame. */
export type Layer = { beats: Beat[]; now: number; at: Locate; reduced: boolean };

/** Stage-px lookups the Theatre provides (bridge points and measured rail chips). */
export type Locate = {
  u: number;
  tile(id: TileId): ScreenPoint | null;
  seat(id: SeatId): ScreenPoint | null;
  chip(id: SeatId): HTMLElement | null;
  /** The seat's rail VP numeral and its line 2, as boxes. */
  vp(id: SeatId): Box | null;
  line(id: SeatId): Box | null;
  bank(): ScreenPoint;
};

const from = (o: Origin, at: Locate) =>
  ('tile' in o ? at.tile(o.tile) : 'seat' in o ? at.seat(o.seat) : at.bank());

const cardStyle = (good: Good, i: number) =>
  ({ '--good': GOOD_META[good].color, '--good-deep': GOOD_META[good].deep, '--i': i }) as CSSProperties;

/** A resource card (or a fanned stack when one flight carries several goods) with its "+n" badge. */
export function GoodCard({ goods }: { goods: { good: Good; amount: number }[] }) {
  const total = goods.reduce((n, g) => n + g.amount, 0);
  return <span className="island-settlers-card-stack" data-count={goods.length}>
    {goods.map(({ good }, i) => <span key={good} className="island-settlers-card" style={cardStyle(good, i)}>
      <Icon name={good} size="66%"/></span>)}
    <b className="island-settlers-card-badge kp-numeral">+{total}</b>
  </span>;
}

/** The TV never shows what was stolen: a navy card with a sun emblem. */
const FaceDown = () => <span className="island-settlers-card island-settlers-card-back" aria-hidden="true">
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.6"/>
    <path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2M5.3 5.3l2.3 2.3M16.4 16.4l2.3 2.3M5.3 18.7l2.3-2.3
      M16.4 7.6l2.3-2.3"/></svg>
</span>;

function FlightView({ flight, t, at }: { flight: Flight; t: number; at: Locate }) {
  const local = t - flight.delay;
  if (local < 0 || local >= flight.ms) return null;
  const a = from(flight.from, at), b = at.seat(flight.seat);
  if (!a || !b) return null;
  const steal = !!flight.faceDown, p = (steal ? EASE.steal : EASE.fly)(local / flight.ms);
  const bend = steal ? { x: -120 * at.u, y: 0 } : { x: 0, y: -FLY.lift * at.u };
  const { x, y } = arc(a, b, bend, p), shrink = 1 - 0.25 * clamp01((p - 0.8) / 0.2);
  return <span className="island-settlers-flight" data-steal={steal || undefined}
    style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${shrink})` }}>
    {steal ? <FaceDown/> : <GoodCard goods={flight.goods}/>}
  </span>;
}

/** Robber pings: blocked hexes flash during the roll; the robber's new hex after its hop. */
const pingsOf = (beat: Beat): { tile: TileId; at: number }[] => {
  const e = beat.event;
  if (e.kind === 'roll') {
    return [...new Set(e.blocked.map(b => b.tile))].map(tile => ({ tile, at: ROLL_MS.flash }));
  }
  return e.kind === 'robber' ? [{ tile: e.tile, at: HOP_MS }] : [];
};

function Ping({ point, t, u }: { point: ScreenPoint; t: number; u: number }) {
  const p = t / PING_MS;
  const style = {
    transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`,
    '--ring': 0.6 + 0.8 * EASE.out(p), '--fade': 1 - p, '--size': `${72 * u}px`,
  } as CSSProperties;
  return <span className="island-settlers-ping" style={style}><Icon name="robber"/></span>;
}

const BUMP = { duration: 160, easing: 'ease-out' };

/** Seat chip bump (scale 1.12, 160 ms) when cards land. Uses WAAPI so the rail keeps its own styles. */
function useBumps(beats: Beat[], now: number, at: Locate, reduced: boolean) {
  const last = useRef(now);
  useEffect(() => {
    const prev = last.current;
    last.current = now;
    if (reduced || now <= prev) return;
    for (const b of beats) for (const f of b.flights) {
      const land = b.start + f.delay + f.ms;
      if (land > prev && land <= now) {
        at.chip(f.seat)?.animate([{ scale: 1 }, { scale: 1.12 }, { scale: 1 }], BUMP);
      }
    }
  }, [beats, now, at, reduced]);
}

export function Flights({ beats, now, at, reduced }: Layer) {
  useBumps(beats, now, at, reduced);
  if (reduced) return null;
  return <>
    {beats.flatMap(b => pingsOf(b).map(({ tile, at: start }) => {
      const t = now - b.start - start, point = at.tile(tile);
      return point && t >= 0 && t < PING_MS
        ? <Ping key={`${b.event.id}:${tile}`} point={point} t={t} u={at.u}/> : null;
    }))}
    {beats.flatMap(b => b.flights.map(f =>
      <FlightView key={`${b.event.id}:${f.key}`} flight={f} t={now - b.start} at={at}/>))}
  </>;
}
