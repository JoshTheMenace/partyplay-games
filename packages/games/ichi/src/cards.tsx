import type { CSSProperties, ReactNode } from 'react';
import { colors, type Card, type Color, type Value } from './types';

/** Resolved in client.prepare(); CSS fallbacks render until the art is known to load. table is the role's felt (landscape TV, portrait phone). */
export const art = { base: '/games/ichi/', back: false, table: false };
export const colorName: Record<Color, string> = { coral: 'Coral', sky: 'Sky', lime: 'Lime', sun: 'Sun' };
const valueName: Partial<Record<Value, string>> = { skip: 'Skip', reverse: 'Reverse', draw2: '+2', wild: 'Wild', wild4: 'Wild +4' };
export const cardLabel = (c: Pick<Card, 'color' | 'value'>) => c.color === 'wild' ? valueName[c.value]! : `${colorName[c.color]} ${valueName[c.value] ?? c.value}`;
const valueOrder: Value[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
const colorOrder = (c: Card) => c.color === 'wild' ? 4 : colors.indexOf(c.color);
export const sortCards = <T extends Card>(cards: readonly T[], by: 'color' | 'number') => [...cards].sort((a, b) => {
  const color = colorOrder(a) - colorOrder(b), value = valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value);
  return (by === 'color' ? color || value : value || color) || a.id.localeCompare(b.id);
});
/** Stable small tilt so a pile looks hand-dropped without jittering between renders. */
export const tilt = (id: string, range = 9) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % (range * 2 + 1)) - range; };

const Svg = ({ children, className = 'ichi-emblem' }: { children: ReactNode; className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>;
/** Suit emblems: blossom, wave, bamboo, sun disk. Drawn in currentColor with a --core accent. */
export function Emblem({ color }: { color: Color | 'wild' }) {
  if (color === 'coral') return <Svg>{[0, 72, 144, 216, 288].map(a => <path key={a} d="M12 11.2C9.4 9.6 8.6 6.4 9.9 3.9c.6.9 1.3 1.3 2.1 1.3s1.5-.4 2.1-1.3c1.3 2.5.5 5.7-2.1 7.3z" transform={`rotate(${a} 12 12.4)`}/>)}<circle className="core" cx="12" cy="12.4" r="2"/></Svg>;
  if (color === 'sky') return <Svg><path d="M1.5 20.5a10.5 10.5 0 0 1 21 0z"/><path className="core-line" d="M5.2 20.5a6.8 6.8 0 0 1 13.6 0M8.8 20.5a3.2 3.2 0 0 1 6.4 0"/></Svg>;
  if (color === 'lime') return <Svg><rect x="9.6" y="1.8" width="4.8" height="20.4" rx="1.6"/><path className="core-line" d="M9.4 8.4h5.2M9.4 15h5.2"/><path d="M14.2 8.6c2.6-3.6 5.6-4.6 8.3-4.2-1.4 3.2-4.4 4.8-8.3 4.2zM9.8 15.2c-2.8-3-5.8-3.6-8.3-2.8 1.8 2.9 4.9 3.9 8.3 2.8z"/></Svg>;
  if (color === 'sun') return <Svg><circle cx="12" cy="12" r="5.6"/>{[0, 45, 90, 135, 180, 225, 270, 315].map(a => <rect key={a} x="11" y="1.2" width="2" height="3.6" rx="1" transform={`rotate(${a} 12 12)`}/>)}</Svg>;
  return <Svg><Quadrants/></Svg>;
}
const Quadrants = ({ r = 10 }: { r?: number }) => <>{colors.map((c, i) => { const a = (i * 90 - 90) * Math.PI / 180, b = (i * 90) * Math.PI / 180; return <path key={c} className={`q-${c}`} d={`M12 12L${12 + r * Math.cos(a)} ${12 + r * Math.sin(a)}A${r} ${r} 0 0 1 ${12 + r * Math.cos(b)} ${12 + r * Math.sin(b)}z`}/>; })}</>;
/** Stroked icons get an ink outline pass under the colored pass. */
const Duo = ({ d }: { d: string }) => <Svg className="ichi-icon"><path className="ink" d={d}/><path className="fill" d={d}/></Svg>;
const skipPath = 'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 1 0 0-15.6zM6.6 17.4 17.4 6.6';
const reversePath = 'M5.5 13.5V9.8a3 3 0 0 1 3-3h9m-3-3.2 3.2 3.2-3.2 3.2M18.5 10.5v3.7a3 3 0 0 1-3 3h-9m3 3.2-3.2-3.2 3.2-3.2';
/** Numbers and +N cards sit on a faint suit crest; +4 stacks one crest of every color. */
function Center({ card }: { card: Card }) {
  const v = card.value;
  if (/^\d$/.test(v)) return <><Emblem color={card.color}/><b className="ichi-card-numeral" data-under={v === '6' || v === '9'}>{v}</b></>;
  if (v === 'skip') return <Duo d={skipPath}/>;
  if (v === 'reverse') return <Duo d={reversePath}/>;
  if (v === 'wild') return <Svg className="ichi-wild-disc"><circle className="ring" cx="12" cy="12" r="10.8"/><Quadrants r={10}/><circle className="ring-in" cx="12" cy="12" r="3.4"/></Svg>;
  return <><span className="ichi-marks">{(v === 'draw2' ? [card.color, card.color] : colors).map((c, i) => <Emblem key={i} color={c}/>)}</span><b className="ichi-card-numeral ichi-card-plus">{v === 'draw2' ? '+2' : '+4'}</b></>;
}
const index = (v: Value) => ({ skip: <Duo d={skipPath}/>, reverse: <Duo d={reversePath}/>, draw2: '+2', wild: <Emblem color="wild"/>, wild4: '+4' } as Partial<Record<Value, ReactNode>>)[v] ?? v;
function Corner({ card }: { card: Card }) {
  return <span className="ichi-card-index"><b>{index(card.value)}</b>{card.value !== 'wild' && <Emblem color={card.color}/>}</span>;
}
export function CardFace({ card, className = '' }: { card: Card; className?: string }) {
  return <span className={`ichi-card ${className}`} data-color={card.color} data-value={card.value} aria-hidden="true">
    <span className="ichi-card-field"><Corner card={card}/><span className="ichi-card-center"><Center card={card}/></span></span>
  </span>;
}
export const CardBack = ({ className = '', style }: { className?: string; style?: CSSProperties }) => <span className={`ichi-back ${className}`} style={style} data-art={art.back} aria-hidden="true"/>;
export const ColorChip = ({ color }: { color: Color }) => <span className="ichi-chip" data-color={color}><Emblem color={color}/>{colorName[color]}</span>;
