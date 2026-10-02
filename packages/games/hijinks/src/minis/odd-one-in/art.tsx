/* Odd One In art: interrogation lamp, fingerprints, category emblems, the hand signals and the eight Face Value faces. All original SVG. */
import type { CSSProperties, ReactElement } from 'react';
import type { Category, FaceId } from './types';

/** The hanging interrogation lamp: cord, enamel shade, hot bulb. The light cone is CSS (.ooi-cone). */
export function Lamp({ className = '' }: { className?: string }) {
  return <svg className={`ooi-lamp ${className}`} viewBox="0 0 240 230" aria-hidden="true">
    <path className="ooi-lamp-cord" d="M120 0V70" />
    <rect className="ooi-lamp-cap" x="104" y="62" width="32" height="26" rx="6" />
    <path className="ooi-lamp-shade" d="M110 86H130L222 196Q120 214 18 196Z" />
    <path className="ooi-lamp-rim" d="M18 196Q120 214 222 196" />
    <ellipse className="ooi-lamp-bulb" cx="120" cy="202" rx="44" ry="15" />
    <path className="ooi-lamp-shine" d="M100 104 52 182" />
  </svg>;
}

/** A whorl fingerprint: broken concentric ridges, slightly off-centre like a real print. */
export function Fingerprint({ className = '' }: { className?: string }) {
  const rings = [10, 18, 26, 34, 42, 50, 58];
  return <svg className={`ooi-print ${className}`} viewBox="0 0 120 140" aria-hidden="true">
    {rings.map((r, i) => <ellipse key={r} cx={60 + (i % 2) * 2} cy={72 - i} rx={r * .82} ry={r} pathLength={100} strokeDasharray={`${62 + i * 4} ${7 + (i % 3) * 3} ${18 - i} 6`} strokeDashoffset={i * 13} />)}
    <path d="M60 64Q56 74 62 82" />
  </svg>;
}

/** An open palm with a cuff; `down` lowers it. */
export function Hand({ down = false, className = '' }: { down?: boolean; className?: string }) {
  return <svg className={`ooi-hand ${className}`} data-down={down || undefined} viewBox="0 0 100 140" aria-hidden="true">
    <g transform={down ? 'rotate(180 50 70)' : undefined}>
      <rect className="ooi-hand-cuff" x="30" y="104" width="40" height="34" rx="6" />
      <rect className="ooi-hand-skin" x="22" y="18" width="13" height="56" rx="6.5" />
      <rect className="ooi-hand-skin" x="36" y="6" width="13" height="64" rx="6.5" />
      <rect className="ooi-hand-skin" x="50" y="8" width="13" height="62" rx="6.5" />
      <rect className="ooi-hand-skin" x="64" y="20" width="12" height="52" rx="6" />
      <path className="ooi-hand-skin" d="M22 60Q20 92 34 106H68Q80 92 80 66Q86 52 94 46Q100 40 92 36Q80 34 72 56V60Z" />
      <path className="ooi-hand-line" d="M36 70V58M50 68V56M63 70V58" />
    </g>
  </svg>;
}

/** A pointing hand for Point Blank. */
export function Pointer({ className = '' }: { className?: string }) {
  return <svg className={`ooi-pointer ${className}`} viewBox="0 0 160 100" aria-hidden="true">
    <rect className="ooi-hand-cuff" x="2" y="30" width="30" height="46" rx="6" />
    <rect className="ooi-hand-skin" x="70" y="26" width="84" height="16" rx="8" />
    <path className="ooi-hand-skin" d="M30 34Q34 22 52 24H82V44Q90 46 90 54Q90 62 82 62Q90 64 88 72Q86 80 78 80Q82 86 76 90Q68 94 54 92Q34 92 30 80Z" />
    <path className="ooi-hand-skin" d="M50 24Q48 6 60 8Q66 12 66 26" />
    <path className="ooi-hand-line" d="M80 50H60M78 66H58M74 80H56" />
  </svg>;
}

/** Number Crunch emblem: a flip counter. */
function Counter({ value = '07' }: { value?: string }) {
  return <svg className="ooi-counter" viewBox="0 0 140 120" aria-hidden="true">
    <rect className="ooi-counter-box" x="6" y="14" width="128" height="96" rx="14" />
    <rect className="ooi-counter-card" x="20" y="26" width="46" height="72" rx="6" /><rect className="ooi-counter-card" x="74" y="26" width="46" height="72" rx="6" />
    <path className="ooi-counter-split" d="M20 62H66M74 62H120" />
    <text x="43" y="85" textAnchor="middle">{value[0]}</text><text x="97" y="85" textAnchor="middle">{value[1]}</text>
    <circle className="ooi-counter-pin" cx="70" cy="8" r="6" />
  </svg>;
}

/** The big emblem for a category (case card, task screen). */
export function Emblem({ category }: { category: Category }) {
  if (category === 'hands') return <Hand />;
  if (category === 'point') return <Pointer />;
  if (category === 'number') return <Counter />;
  return <Face id="smug" />;
}

const FACE_COLORS: Record<FaceId, string> = { gasp: '#7fd6ff', smug: '#c9a2ff', yuck: '#9be36d', eek: '#ffe9a8', joy: '#ffd24a', huh: '#ffae5c', fume: '#ff6b5b', swoon: '#ff9ad5' };
const EYES = { cx: [36, 64], y: 44 };
const Dot = ({ x, y, r = 4.5 }: { x: number; y: number; r?: number }) => <circle className="ooi-face-ink" cx={x} cy={y} r={r} />;
const Line = ({ d }: { d: string }) => <path className="ooi-face-line" d={d} />;
const FEATURES: Record<FaceId, ReactElement> = {
  gasp: <g>{EYES.cx.map(x => <g key={x}><circle className="ooi-face-white" cx={x} cy={44} r={9} /><Dot x={x} y={45} r={4} /></g>)}<Line d="M26 26Q36 18 44 26M56 26Q64 18 74 26" /><ellipse className="ooi-face-mouth" cx={50} cy={74} rx={9} ry={12} /></g>,
  smug: <g><Line d="M27 46Q36 40 45 46M55 46Q64 40 73 46" /><path className="ooi-face-lid" d="M27 46Q36 52 45 46ZM55 46Q64 52 73 46Z" /><Line d="M26 34L44 36M56 30Q64 24 74 32" /><Line d="M36 72Q54 78 68 64" /></g>,
  yuck: <g><Line d="M28 38L42 45L28 50M72 38L58 45L72 50" /><Line d="M30 72Q36 66 42 72T54 72T66 72" /><path className="ooi-face-tongue" d="M44 73Q46 88 54 86Q60 84 56 73Z" /></g>,
  eek: <g>{EYES.cx.map(x => <g key={x}><circle className="ooi-face-white" cx={x} cy={46} r={10} /><Dot x={x} y={46} r={2.6} /></g>)}<Line d="M26 32Q34 30 44 24M56 24Q66 30 74 32" /><rect className="ooi-face-teeth" x={30} y={64} width={40} height={18} rx={5} /><Line d="M40 64V82M50 64V82M60 64V82M30 73H70" /></g>,
  joy: <g><Line d="M27 46Q36 36 45 46M55 46Q64 36 73 46" /><path className="ooi-face-mouth" d="M28 62Q50 92 72 62Z" /><ellipse className="ooi-face-cheek" cx={24} cy={60} rx={7} ry={4.5} /><ellipse className="ooi-face-cheek" cx={76} cy={60} rx={7} ry={4.5} /></g>,
  huh: <g><circle className="ooi-face-white" cx={36} cy={44} r={10} /><Dot x={38} y={44} r={4} /><Dot x={64} y={46} r={4} /><Line d="M24 28Q34 20 46 28M56 38H72" /><Line d="M40 74Q46 70 52 74T66 72" /><text className="ooi-face-q" x={80} y={34}>?</text></g>,
  fume: <g><Line d="M26 30L45 40M74 30L55 40" /><Line d="M29 46Q36 50 43 46M57 46Q64 50 71 46" /><rect className="ooi-face-teeth" x={32} y={66} width={36} height={12} rx={4} /><Line d="M41 66V78M50 66V78M59 66V78" /><g className="ooi-face-steam"><circle cx={13} cy={15} r={5.5} /><circle cx={6} cy={6} r={3.5} /><circle cx={87} cy={15} r={5.5} /><circle cx={94} cy={6} r={3.5} /></g></g>,
  swoon: <g>{EYES.cx.map(x => <path key={x} className="ooi-face-heart" d={`M${x} 52L${x - 10} 42Q${x - 12} 32 ${x - 4} 32Q${x} 32 ${x} 37Q${x} 32 ${x + 4} 32Q${x + 12} 32 ${x + 10} 42Z`} />)}<Line d="M38 70Q50 80 62 70" /><ellipse className="ooi-face-cheek" cx={24} cy={62} rx={7} ry={4.5} /><ellipse className="ooi-face-cheek" cx={76} cy={62} rx={7} ry={4.5} /></g>,
};

/** One of the eight Face Value expressions. */
export function Face({ id, className = '' }: { id: FaceId | string; className?: string }) {
  const face = (Object.hasOwn(FEATURES, id) ? id : 'huh') as FaceId;
  return <svg className={`ooi-face ${className}`} viewBox="0 0 100 100" aria-hidden="true" style={{ '--face': FACE_COLORS[face] } as CSSProperties}>
    <circle className="ooi-face-head" cx={50} cy={52} r={44} />
    <path className="ooi-face-shine" d="M22 30Q28 16 42 12" />
    {FEATURES[face]}
  </svg>;
}
