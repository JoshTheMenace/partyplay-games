/* Quiz Panic art: original SVG pieces for the Hotel Hijinks (concierge, ghoul, cups, doors, coin, memory symbols, candles). */
import type { CSSProperties, ReactNode } from 'react';
import { SYMBOL_NAMES, type Side } from './types';

/** Mr Grimsby, the hotel's skeletal concierge: bellhop cap, red jacket, one gloved hand presenting. */
export function Concierge({ className = '' }: { className?: string }) {
  return <svg className={`qp-concierge ${className}`} viewBox="0 0 230 390" aria-hidden="true">
    <ellipse className="qp-shadow" cx="110" cy="378" rx="72" ry="9" />
    <path className="qp-ink-line" d="M90 285L86 368L68 372M130 285L134 368L152 372" strokeWidth="13" />
    <path className="qp-red" d="M70 286Q50 220 66 196L54 168Q58 150 82 148L138 148Q162 150 166 168L154 196Q170 220 150 286Q110 300 70 286Z" />
    <path className="qp-red qp-arm" d="M158 164Q196 152 206 104" fill="none" strokeWidth="22" strokeLinecap="round" />
    <path className="qp-arm-trim" d="M158 164Q196 152 206 104" fill="none" strokeWidth="10" strokeLinecap="round" />
    <circle className="qp-glove" cx="208" cy="94" r="15" />
    <path className="qp-red qp-arm" d="M64 166Q38 214 50 266" fill="none" strokeWidth="22" strokeLinecap="round" />
    <circle className="qp-glove" cx="51" cy="274" r="14" />
    <path className="qp-cream" d="M94 148L110 206L126 148Z" />
    <path className="qp-ink" d="M94 150L110 160L94 170ZM126 150L110 160L126 170Z" />
    {[214, 240, 266].map(y => <circle key={y} className="qp-gold" cx="110" cy={y} r="6" />)}
    <rect className="qp-bone" x="99" y="118" width="22" height="30" rx="6" />
    <path className="qp-bone" d="M68 72Q68 18 110 18Q152 18 152 72Q152 108 132 124L88 124Q68 108 68 72Z" />
    <ellipse className="qp-ink" cx="93" cy="74" rx="13" ry="15" /><ellipse className="qp-ink" cx="127" cy="74" rx="13" ry="15" />
    <circle className="qp-eye-glow" cx="95" cy="76" r="5" /><circle className="qp-eye-glow" cx="129" cy="76" r="5" />
    <path className="qp-ink" d="M105 96L110 86L115 96Z" />
    <path className="qp-ink-line" d="M84 106Q110 122 136 106M95 110L94 118M105 113L105 121M115 113L115 121M125 110L126 118" strokeWidth="3.5" />
    <path className="qp-ink-line" d="M88 100Q78 98 74 90M132 100Q142 98 146 90" strokeWidth="3" />
    <g transform="rotate(-10 110 24)"><path className="qp-red" d="M80 36L86 4L134 4L140 36Z" /><rect className="qp-gold" x="80" y="26" width="60" height="10" rx="3" /></g>
  </svg>;
}

/** The ghoul: a hunched green lump with long claws and lamp eyes. */
export function Ghoul({ className = '' }: { className?: string }) {
  return <svg className={`qp-ghoul ${className}`} viewBox="0 0 220 230" aria-hidden="true">
    <ellipse className="qp-shadow" cx="110" cy="222" rx="80" ry="8" />
    <path className="qp-ghoul-arm" d="M48 120Q14 140 10 184M172 120Q206 140 210 184" fill="none" strokeWidth="18" strokeLinecap="round" />
    <path className="qp-ink-line" d="M2 188L8 178M10 192L12 180M20 190L16 178M218 188L212 178M210 192L208 180M200 190L204 178" strokeWidth="5" />
    <path className="qp-ghoul-body" d="M40 216Q22 130 60 76Q110 14 160 76Q198 130 180 216Q168 202 156 216Q144 202 132 216Q120 202 110 216Q98 202 86 216Q74 202 62 216Q52 202 40 216Z" />
    <path className="qp-ghoul-belly" d="M72 200Q66 150 110 140Q154 150 148 200Z" />
    <ellipse className="qp-ghoul-eye" cx="88" cy="96" rx="16" ry="13" /><ellipse className="qp-ghoul-eye" cx="132" cy="96" rx="16" ry="13" />
    <ellipse className="qp-ink" cx="90" cy="97" rx="4" ry="10" /><ellipse className="qp-ink" cx="130" cy="97" rx="4" ry="10" />
    <path className="qp-ink" d="M76 124Q110 150 144 124Q110 166 76 124Z" />
    <path className="qp-cream" d="M84 128L90 138L96 132L102 142L110 134L118 142L124 132L130 138L136 128Q110 142 84 128Z" />
  </svg>;
}

const SYMBOL_ART = [
  <path key="bat" className="qp-ink" d="M50 40Q44 30 38 34L30 26Q18 40 4 42Q14 50 14 62Q22 56 30 60Q36 54 42 62Q46 54 50 60Q54 54 58 62Q64 54 70 60Q78 56 86 62Q86 50 96 42Q82 40 70 26L62 34Q56 30 50 40Z" />,
  <g key="candle"><rect className="qp-cream" x="38" y="44" width="24" height="44" rx="4" /><path className="qp-flame" d="M50 12Q64 28 56 38Q50 44 44 38Q36 28 50 12Z" /><path className="qp-ink-line" d="M50 38V44" strokeWidth="3" /></g>,
  <g key="key"><circle className="qp-ink-ring" cx="30" cy="50" r="15" /><path className="qp-ink-line" d="M45 50H90M78 50V62M88 50V60" strokeWidth="8" /></g>,
  <g key="skull"><path className="qp-cream" d="M22 48Q22 16 50 16Q78 16 78 48Q78 62 68 68V80H32V68Q22 62 22 48Z" /><ellipse className="qp-ink" cx="38" cy="48" rx="8" ry="9" /><ellipse className="qp-ink" cx="62" cy="48" rx="8" ry="9" /><path className="qp-ink" d="M46 66L50 58L54 66Z" /></g>,
  <path key="moon" className="qp-cream" d="M62 14Q30 20 28 50Q30 82 64 86Q40 74 40 50Q40 26 62 14Z" />,
  <g key="spider"><path className="qp-ink-line" d="M50 50L18 30L10 44M50 50L14 50L8 64M50 50L18 66L14 82M50 54L24 84M50 50L82 30L90 44M50 50L86 50L92 64M50 50L82 66L86 82M50 54L76 84" strokeWidth="4" /><ellipse className="qp-ink" cx="50" cy="56" rx="14" ry="16" /><circle className="qp-ink" cx="50" cy="36" r="9" /></g>,
];
export const SYMBOL_COLORS = ['#b58aff', '#ffcf5a', '#28c6e7', '#ff9f43', '#78d955', '#ff5d6c'];
/** One of the six labelled memory symbols (colour and shape both differ, so neither alone is needed). */
export function MemorySymbol({ i, size = 120, label = false }: { i: number; size?: number; label?: boolean }) {
  return <span className="qp-symbol" style={{ '--sym': SYMBOL_COLORS[i], width: size } as CSSProperties}>
    <svg viewBox="0 0 100 100" role="img" aria-label={SYMBOL_NAMES[i]}><circle className="qp-symbol-disc" cx="50" cy="50" r="47" />{SYMBOL_ART[i]}</svg>
    {label && <small>{SYMBOL_NAMES[i]}</small>}
  </span>;
}

/** A punch goblet; poisoned cups bubble green with a skull once revealed. */
export function Cup({ n, poison, className = '' }: { n: number; poison?: boolean; className?: string }) {
  return <svg className={`qp-cup ${className}`} viewBox="0 0 100 150" data-poison={poison || undefined} role="img" aria-label={`Cup ${n}${poison ? ', poisoned' : ''}`}>
    <ellipse className="qp-shadow" cx="50" cy="143" rx="34" ry="5" />
    <path className="qp-glass" d="M14 14H86Q88 64 56 80V118Q74 122 78 136H22Q26 122 44 118V80Q12 64 14 14Z" />
    <path className="qp-punch" d="M19 32H81Q78 62 50 72Q22 62 19 32Z" />
    {poison && <g className="qp-bubbles"><circle cx="34" cy="38" r="5" /><circle cx="58" cy="44" r="4" /><circle cx="46" cy="30" r="3" /><path className="qp-ink" d="M42 48Q42 40 50 40Q58 40 58 48Q58 53 54 55V58H46V55Q42 53 42 48ZM46 47A2 2 0 1 0 46.1 47ZM54 47A2 2 0 1 0 54.1 47Z" /></g>}
    <path className="qp-shine" d="M24 22Q24 46 34 58" />
    <text className="qp-cup-n" x="50" y="132" textAnchor="middle">{n}</text>
  </svg>;
}

/** A hotel door with a brass number plate; `open` swings it to show the dark room. */
export function Door({ open, children }: { open?: boolean; children?: ReactNode }) {
  return <span className="qp-door" data-open={open || undefined}>
    <span className="qp-door-room">{children}</span>
    <svg className="qp-door-leaf" viewBox="0 0 120 200" aria-hidden="true">
      <rect className="qp-wood" x="4" y="4" width="112" height="192" rx="6" />
      <rect className="qp-panel" x="18" y="20" width="84" height="70" rx="4" /><rect className="qp-panel" x="18" y="104" width="84" height="80" rx="4" />
      <circle className="qp-gold" cx="98" cy="104" r="7" />
    </svg>
  </span>;
}

/** The Coin of Fate: heads shows a grinning skull, tails a bat. */
export function Coin({ side, className = '' }: { side: Side; className?: string }) {
  return <svg className={`qp-coin ${className}`} viewBox="0 0 120 120" role="img" aria-label={side === 'H' ? 'Heads' : 'Tails'}>
    <circle className="qp-coin-rim" cx="60" cy="60" r="56" /><circle className="qp-coin-face" cx="60" cy="60" r="44" />
    <g transform="translate(31 22) scale(.58)">{SYMBOL_ART[side === 'H' ? 3 : 0]}</g>
    <text className="qp-coin-label" x="60" y="94" textAnchor="middle">{side === 'H' ? 'HEADS' : 'TAILS'}</text>
  </svg>;
}

export const Candle = ({ className = '' }: { className?: string }) => <svg className={`qp-candle ${className}`} viewBox="0 0 40 120" aria-hidden="true">
  <path className="qp-flame" d="M20 4Q32 22 26 32Q20 38 14 32Q8 22 20 4Z" /><path className="qp-ink-line" d="M20 32V40" strokeWidth="2.5" />
  <path className="qp-wax" d="M8 40H32V114H8Z" /><path className="qp-wax-drip" d="M8 40H32V50Q28 58 26 50Q22 62 18 50Q14 56 12 48Q10 52 8 50Z" />
</svg>;

export const Cobweb = ({ className = '' }: { className?: string }) => <svg className={`qp-web ${className}`} viewBox="0 0 160 160" aria-hidden="true">
  <path d="M0 0L160 40M0 0L120 120M0 0L40 160M0 0L90 150M0 0L150 90M30 8Q26 26 8 30M62 16Q54 52 16 62M96 25Q84 80 25 96M128 32Q110 108 32 128" />
</svg>;
