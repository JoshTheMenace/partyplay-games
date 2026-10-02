/* Pack branding: the marquee logo and the generated art on game-wall tiles. */
import type { CSSProperties, ReactNode } from 'react';
import type { MiniInfo } from '../contract';
import { Avatar } from '../ui';

const hash = (text: string) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const TINTS = ['#ffd24a', '#28c6e7', '#78d955', '#b58aff', '#ff5748', '#fff6e5'];

/** The "Hijinks" marquee sign with chasing bulbs. */
export function Logo({ size = 1 }: { size?: number }) {
  return <div className="hj-logo" style={{ '--k': size } as CSSProperties} role="img" aria-label="Hijinks">
    <span className="hj-logo-bulbs" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</span>
    <span className="hj-logo-word kp-title" aria-hidden="true">Hi<em>jinks</em></span>
  </div>;
}

/** Tile illustration: a spinning starburst in the minigame accent with two characters (stable per id) peeking up. */
export function TileArt({ info, children }: { info: MiniInfo; children?: ReactNode }) {
  const h = hash(info.id), a = h % 16, b = (a + 3 + (h >>> 4) % 12) % 16;
  return <div className="hj-tile-art">
    <svg aria-hidden="true" className="hj-burst" viewBox="-50 -50 100 100">{Array.from({ length: 12 }, (_, i) => <path key={i} d="M0 0L-5 -70L5 -70Z" transform={`rotate(${i * 30})`} />)}</svg>
    <span aria-hidden="true" className="hj-tile-critter hj-tile-critter-a"><Avatar avatar={a} color={TINTS[h % TINTS.length]!} mood="happy" size={120} /></span>
    <span aria-hidden="true" className="hj-tile-critter hj-tile-critter-b"><Avatar avatar={b} color={TINTS[(h >>> 8) % TINTS.length]!} mood={h & 1 ? 'thinking' : 'idle'} size={96} /></span>
    {children}
  </div>;
}
