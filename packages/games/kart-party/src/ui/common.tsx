/* Small shared UI helpers: formatting, portraits and kart previews. */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CHARACTERS, KART_BODIES } from '../sim/stats';
import type { KartBodyId } from '../sim/types';

export const ASSET_BASE = '/games/kart-party/';
export const COUNTDOWN_SECONDS = 3.5;   // mirrors sim/race.ts (kept local so UI bundles don't pull the simulation)
export const TIER_COLORS = ['#fff6e5', '#3fb4ff', '#ff9a1f', '#c46bff'] as const;
export const ordinalSuffix = (n: number) => { const t = n % 100; return t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; };
export const ordinal = (n: number) => `${n}${ordinalSuffix(n)}`;
export const rankTone = (rank: number) => rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
export function formatTime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.--';
  const cs = Math.round(Math.max(0, seconds) * 100);   // round once so 119.996 reads 2:00.00, never 1:60.00
  return `${Math.floor(cs / 6000)}:${(cs % 6000 / 100).toFixed(2).padStart(5, '0')}`;
}
export const kartName = (id: KartBodyId) => KART_BODIES.find(k => k.id === id)?.name ?? id;
export const character = (i: number) => CHARACTERS[i] ?? CHARACTERS[0];
/** "Luna · Bolt", or just "Bolt" when the racer is named after its character (CPUs). */
export const rideLabel = (r: { name: string; character: number; kart: KartBodyId }) => r.name === character(r.character).name ? kartName(r.kart) : `${character(r.character).name} · ${kartName(r.kart)}`;

const failed = new Set<string>();
/** Image with a drawn fallback underneath: a missing or slow preview never leaves a broken icon. */
function Preview({ src, className, style, fallback }: { src: string; className: string; style?: CSSProperties; fallback: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'bad'>(() => failed.has(src) ? 'bad' : 'loading');
  return <span className={className} style={style} aria-hidden="true">
    {state !== 'ok' && <span className="kp2-preview-fallback">{fallback}</span>}
    {state !== 'bad' && <img src={src} alt="" draggable={false} decoding="async" onLoad={() => setState('ok')} onError={() => { failed.add(src); setState('bad'); }}/>}
  </span>;
}
export function Portrait({ index, size, className = '' }: { index: number; size?: string; className?: string }) {
  const c = character(index);
  return <Preview src={`${ASSET_BASE}models/previews/char-${index}.png`} className={`kp2-portrait ${className}`} fallback={c.name[0]}
    style={{ '--c': c.color, '--a': c.accent, ...(size ? { '--s': size } : {}) } as CSSProperties}/>;
}
export function KartPreview({ id, className = '' }: { id: KartBodyId; className?: string }) {
  return <Preview src={`${ASSET_BASE}models/previews/kart-${id}.png`} className={`kp2-kart-preview ${className}`} fallback={KART_SVG}/>;
}
const KART_SVG = <svg viewBox="0 0 64 40" width="80%" focusable="false"><g stroke="#05071a" strokeWidth="2.5" strokeLinejoin="round">
  <path d="M8 26l4-9h14l6-7h12l4 7h8l2 9z" fill="var(--kp-coral)"/><path d="M30 10h10l3 7H26z" fill="#bff3ff"/>
  <circle cx="17" cy="29" r="7" fill="#1b1f3b"/><circle cx="48" cy="29" r="7" fill="#1b1f3b"/></g></svg>;
