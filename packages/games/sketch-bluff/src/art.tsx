import type { CSSProperties } from 'react';
import type { PublicView } from './types';
export function GalleryArt() {
  return <div className="sketch-bluff-paper-art" aria-hidden="true">
    <svg viewBox="0 0 160 180"><rect x="8" y="8" width="144" height="164" rx="5" fill="var(--kp-cream)" stroke="var(--kp-sky)" strokeWidth="8" /><path d="M107 35a47 47 0 1 0 18 77A40 40 0 0 1 107 35Z" fill="var(--kp-sun)" stroke="var(--kp-ink)" strokeWidth="5"/><path d="m45 137 19-10v20l-19-10 36-10v20Z" fill="var(--kp-coral)" stroke="var(--kp-ink)" strokeWidth="4"/><path d="m124 24 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="var(--kp-grape)"/><circle cx="63" cy="77" r="4" fill="var(--kp-ink)"/></svg>
    <svg viewBox="0 0 160 180"><rect x="8" y="8" width="144" height="164" rx="5" fill="var(--kp-cream)" stroke="var(--kp-grape)" strokeWidth="8"/><path d="M43 110V85a37 37 0 0 1 74 0v25l-14-9-12 14-12-14-12 14-12-14Z" fill="var(--kp-sky)" stroke="var(--kp-ink)" strokeWidth="5"/><path d="m48 54 72 0M64 52l6-26 28 5 7 21" fill="var(--kp-coral)" stroke="var(--kp-ink)" strokeWidth="5" strokeLinecap="round"/><circle cx="69" cy="79" r="5" fill="var(--kp-ink)"/><circle cx="95" cy="79" r="5" fill="var(--kp-ink)"/><path d="m47 137 67 0" stroke="var(--kp-sun)" strokeWidth="8" strokeLinecap="round"/></svg>
    <svg viewBox="0 0 160 180"><rect x="8" y="8" width="144" height="164" rx="5" fill="var(--kp-cream)" stroke="var(--kp-sun)" strokeWidth="8"/><path d="m66 52-7 20-14 25 8 46h55l8-46-15-25-7-20Z" fill="var(--kp-grape)" stroke="var(--kp-ink)" strokeWidth="5"/><ellipse cx="80" cy="100" rx="22" ry="15" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="4"/><circle cx="83" cy="100" r="7" fill="var(--kp-ink)"/><path d="M80 51V25m0 15-18-9m18 4 15-11" stroke="var(--kp-lime)" strokeWidth="6" strokeLinecap="round"/></svg>
  </div>;
}

export function ArtistChip({ player, compact = false }: { player: PublicView['players'][number]; compact?: boolean }) {
  return <span className={`sketch-bluff-chip ${compact ? 'sketch-bluff-chip-small' : ''}`} style={{ '--sketch-bluff-player': player.color } as CSSProperties}><b aria-hidden="true">{player.name.slice(0, 1).toUpperCase()}</b><span>{player.name}{!player.connected && <small> · reconnecting</small>}</span></span>;
}
