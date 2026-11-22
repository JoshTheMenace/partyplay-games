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

/**
 * One bold emblem per minigame, drawn on a 120×120 grid in the tile's accent (`--accent`), cream and ink. They give the
 * wall and the intro card something to recognise from the sofa; a game without one keeps the two critters.
 */
const EMBLEMS: Record<string, ReactNode> = {
  'quip-clash': <><path className="hj-em-main" d="M10 18H70C76 18 80 22 80 28V58C80 64 76 68 70 68H40L24 84V68H10C6 68 4 64 4 58V28C4 22 6 18 10 18Z" /><path className="hj-em-pale" d="M56 46H108C113 46 116 49 116 54V84C116 89 113 92 108 92H98V106L82 92H56C51 92 48 89 48 84V54C48 49 51 46 56 46Z" /><path className="hj-em-ink" d="M20 36H62M20 50H50" /><path className="hj-em-bolt" d="M88 56L74 72H84L78 86L96 68H86Z" /></>,
  'tall-tales': <><path className="hj-em-pale" d="M18 14H92L104 26V106H18Z" /><path className="hj-em-main" d="M26 24H82V44H26Z" /><path className="hj-em-ink" d="M28 56H94M28 68H94M28 80H70M28 92H86" /><circle className="hj-em-stamp" cx={86} cy={84} r={22} /><path className="hj-em-cream-line" d="M74 84L83 93L99 76" /></>,
  'sketch-bluff': <><path className="hj-em-ink" d="M32 112L46 84M88 112L74 84M60 112V92" /><rect className="hj-em-main" x={14} y={12} width={92} height={76} rx={6} /><rect className="hj-em-pale" x={24} y={22} width={72} height={56} rx={2} /><path className="hj-em-scribble" d="M32 66C40 40 48 70 56 48S70 34 76 58S86 60 90 44" /><circle className="hj-em-stamp" cx={84} cy={34} r={6} /></>,
  'shirt-show': <><path className="hj-em-main" d="M40 10L22 16L4 36L22 50L30 42V110H90V42L98 50L116 36L98 16L80 10C76 20 68 24 60 24C52 24 44 20 40 10Z" /><path className="hj-em-bolt" d="M60 44L66 60H82L69 70L74 86L60 76L46 86L51 70L38 60H54Z" /></>,
  'quiz-panic': <><path className="hj-em-pale" d="M24 108V52C24 28 40 12 60 12C80 12 96 28 96 52V108L84 98L72 108L60 98L48 108L36 98Z" /><ellipse className="hj-em-dark" cx={46} cy={50} rx={7} ry={10} /><ellipse className="hj-em-dark" cx={74} cy={50} rx={7} ry={10} /><path className="hj-em-ink" d="M52 72Q60 80 68 72" /><path className="hj-em-main" d="M88 8L98 26H78Z" /><path className="hj-em-main" d="M100 30L112 38L100 46Z" /></>,
  'odd-one-in': <><circle className="hj-em-pale" cx={48} cy={48} r={34} /><circle className="hj-em-main" cx={48} cy={48} r={22} /><path className="hj-em-handle" d="M74 74L108 108" /><path className="hj-em-ink" d="M38 44Q42 38 46 44M52 44Q56 38 60 44M40 56Q48 62 58 54" /></>,
  ballpark: <><path className="hj-em-pale" d="M8 92A52 52 0 0 1 112 92Z" /><path className="hj-em-main" d="M22 92A38 38 0 0 1 60 54V92Z" /><path className="hj-em-ink" d="M60 40V50M24 62L32 68M96 62L88 68" /><path className="hj-em-needle" d="M60 92L88 44" /><circle className="hj-em-dark" cx={60} cy={92} r={9} /></>,
  'comment-section': <><rect className="hj-em-dark" x={30} y={6} width={60} height={108} rx={12} /><rect className="hj-em-pale" x={37} y={18} width={46} height={72} rx={4} /><path className="hj-em-ink" d="M44 30H74M44 42H66" /><path className="hj-em-heart" d="M60 78C48 68 46 58 53 55C57 53 60 57 60 59C60 57 63 53 67 55C74 58 72 68 60 78Z" /><circle className="hj-em-main" cx={98} cy={30} r={14} /><path className="hj-em-cream-line" d="M98 23V32M98 37V37.5" /></>,
  'bracket-brawl': <><path className="hj-em-ink hj-em-wire" d="M8 18H34V42H8M8 78H34V102H8M34 30H58V90H34M58 60H84" /><rect className="hj-em-main" x={2} y={10} width={24} height={16} rx={4} /><rect className="hj-em-pale" x={2} y={34} width={24} height={16} rx={4} /><rect className="hj-em-pale" x={2} y={70} width={24} height={16} rx={4} /><rect className="hj-em-main" x={2} y={94} width={24} height={16} rx={4} /><path className="hj-em-bolt" d="M84 36H112V52C112 66 106 74 98 76V88H108V96H88V88H98V76C90 74 84 66 84 52Z" /></>,
  'split-decision': <><path className="hj-em-main" d="M56 10A50 50 0 0 0 56 110L50 84L62 62L48 40Z" /><path className="hj-em-grape" d="M66 10A50 50 0 0 1 66 110L58 84L72 62L58 38Z" /><path className="hj-em-cream-line" d="M24 60L38 48V56H44V64H38V72Z" /><path className="hj-em-cream-line" d="M98 60L84 48V56H78V64H84V72Z" /></>,
  airlock: <><rect className="hj-em-dark" x={10} y={70} width={100} height={40} rx={8} /><path className="hj-em-hazard" d="M22 110L42 70H56L36 110ZM56 110L76 70H90L70 110Z" /><ellipse className="hj-em-stamp" cx={60} cy={66} rx={38} ry={14} /><path className="hj-em-main hj-em-button" d="M26 60V46C26 26 42 14 60 14C78 14 94 26 94 46V60C94 68 78 74 60 74C42 74 26 68 26 60Z" /><path className="hj-em-shine" d="M40 38C44 28 52 24 60 24" /></>,
};
export const hasEmblem = (id: string) => Object.hasOwn(EMBLEMS, id);
/** The minigame's emblem as a square SVG (decorative). */
export function Emblem({ id, className = '' }: { id: string; className?: string }) {
  return hasEmblem(id) ? <svg className={`hj-emblem ${className}`} viewBox="0 0 120 120" aria-hidden="true">{EMBLEMS[id]}</svg> : null;
}

/** Tile illustration: a spinning starburst in the minigame accent, its emblem and a character (stable per id) peeking up. */
export function TileArt({ info, children }: { info: MiniInfo; children?: ReactNode }) {
  const h = hash(info.id), a = h % 16, b = (a + 3 + (h >>> 4) % 12) % 16, emblem = hasEmblem(info.id);
  return <div className="hj-tile-art" data-emblem={emblem || undefined}>
    <svg aria-hidden="true" className="hj-burst" viewBox="-50 -50 100 100">{Array.from({ length: 12 }, (_, i) => <path key={i} d="M0 0L-5 -70L5 -70Z" transform={`rotate(${i * 30})`} />)}</svg>
    {emblem && <span aria-hidden="true" className="hj-tile-emblem"><Emblem id={info.id} /></span>}
    <span aria-hidden="true" className="hj-tile-critter hj-tile-critter-a"><Avatar avatar={a} color={TINTS[h % TINTS.length]!} mood="happy" size={120} /></span>
    {!emblem && <span aria-hidden="true" className="hj-tile-critter hj-tile-critter-b"><Avatar avatar={b} color={TINTS[(h >>> 8) % TINTS.length]!} mood={h & 1 ? 'thinking' : 'idle'} size={96} /></span>}
    {children}
  </div>;
}
