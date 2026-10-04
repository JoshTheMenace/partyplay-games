/* Trolley Court shared visuals: card faces and backs, figure silhouettes, name chips, the Conductor and small helpers. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { opposite, type Card, type CardKind, type Figure, type Placed, type PublicPlayer, type PublicView, type Side } from './types';

export const art = { base: '/games/trolley-court/' };
export const TEAM: Record<Side, string> = { north: 'North', south: 'South' };
export const KIND: Record<CardKind, string> = { innocent: 'Innocent', guilty: 'Guilty', modifier: 'Twist' };
export const vars = (o: Record<string, string | number>) => o as CSSProperties;
export const slotName = (side: Side, slot: number) => slot === 0 ? 'Bystander' : slot === 1 ? 'Their pick' : `Planted by ${TEAM[opposite(side)]}`;
export const heading = (v: PublicView): Side => v.struck ?? (v.lever.pulled ? opposite(v.defaultSide) : v.defaultSide);
export const player = (v: PublicView, id?: string) => v.players.find(p => p.id === id);
export const cardText = (c: Card) => c.text || 'Blank card: write your own';
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Who put a card on the tracks, for author tags. */
export const credit = (v: PublicView, p: Placed) => p.from === 'deck' ? 'from the deck' : p.auto ? 'auto-picked' : `by ${player(v, p.by)?.name ?? TEAM[p.from]}`;
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useNow(serverNowMs: () => number, ms = 250) {
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => { const t = setInterval(() => setNow(serverNowMs()), ms); return () => clearInterval(t); }, [serverNowMs, ms]);
  return now;
}

/** Silhouettes on a 48×48 grid; everything fills currentColor. */
const FIG: Record<Figure, ReactNode> = {
  person: <><circle cx="24" cy="12" r="7"/><path d="M13 46V33a11 11 0 0 1 22 0v13z"/></>,
  pair: <><circle cx="15" cy="15" r="6"/><circle cx="33" cy="13" r="6.5"/><path d="M5 46V34a10 10 0 0 1 20 0v12zM23 46V32a10 10 0 0 1 20 0v14z"/></>,
  crowd: <><circle cx="10" cy="19" r="5"/><circle cx="38" cy="19" r="5"/><circle cx="24" cy="13" r="6"/><path d="M1 46V35a9 9 0 0 1 18 0v11zM29 46V35a9 9 0 0 1 18 0v11zM14 46V31a10 10 0 0 1 20 0v15z"/></>,
  child: <><circle cx="24" cy="21" r="6"/><path d="M20 15c1-5 6-6 8-3M16 46V37a8 8 0 0 1 16 0v9z"/><circle cx="38" cy="10" r="5"/><path d="M38 15v16" fill="none" stroke="currentColor" strokeWidth="1.5"/></>,
  elder: <><circle cx="21" cy="12" r="7"/><path d="M10 46V33a11 11 0 0 1 22 0v13z"/><path d="M37 46V26a4 4 0 0 0-8 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></>,
  animal: <><ellipse cx="22" cy="28" rx="15" ry="9"/><circle cx="39" cy="20" r="6"/><path d="M36 13l2-5 3 5zM9 34h5v12H9zM27 34h5v12h-5zM7 25L1 20" stroke="currentColor" strokeWidth="2"/></>,
  pet: <><ellipse cx="21" cy="34" rx="12" ry="9"/><circle cx="34" cy="21" r="8"/><path d="M28 16l1-9 5 6zM40 16l-1-9-5 6zM10 32C2 30 4 20 9 22" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/><path d="M12 40h5v6h-5zM24 40h5v6h-5z"/></>,
  creature: <><path d="M8 46C5 30 10 12 24 12s19 18 16 34l-5-5-5 5-6-5-6 5-5-5z"/><path d="M14 15l-4-9 9 5zM34 15l4-9-9 5z"/><circle cx="24" cy="25" r="6" fill="var(--tc-paper)"/><circle cx="25" cy="26" r="3"/></>,
  robot: <><path d="M23 3h2v6h-2z"/><circle cx="24" cy="3" r="2.5"/><rect x="13" y="9" width="22" height="16" rx="4"/><circle cx="19" cy="17" r="2.5" fill="var(--tc-paper)"/><circle cx="29" cy="17" r="2.5" fill="var(--tc-paper)"/><rect x="11" y="28" width="26" height="18" rx="3"/><path d="M5 30h5v10H5zM38 30h5v10h-5z"/></>,
  object: <><rect x="8" y="22" width="32" height="24" rx="2"/><rect x="5" y="15" width="38" height="8" rx="2"/><path d="M24 15c-6-9-14-6-10-1M24 15c6-9 14-6 10-1" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M22 15h4v31h-4z" fill="var(--tc-paper)" opacity=".5"/></>,
  vehicle: <><path d="M3 34v-7l7-1 6-9h17l8 9 5 1v7z"/><circle cx="13" cy="36" r="6"/><circle cx="36" cy="36" r="6"/><path d="M18 19h6v7h-11zM27 19h5l6 7H27z" fill="var(--tc-paper)" opacity=".6"/></>,
  building: <><path d="M24 4L3 20h42z"/><rect x="7" y="20" width="34" height="26"/><rect x="20" y="31" width="8" height="15" fill="var(--tc-paper)" opacity=".55"/><rect x="11" y="25" width="6" height="6" fill="var(--tc-paper)" opacity=".55"/><rect x="31" y="25" width="6" height="6" fill="var(--tc-paper)" opacity=".55"/></>,
};
export const FigureIcon = ({ figure = 'person' }: { figure?: Figure }) => <svg className="tc-figure" viewBox="0 0 48 48" aria-hidden="true">{FIG[figure] ?? FIG.person}</svg>;
const TWIST = <svg className="tc-figure" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4l5 13 14 1-11 9 4 14-12-8-12 8 4-14L5 18l14-1z"/></svg>;
export const Skull = () => <svg className="tc-skull" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.5 2 3 6 3 10.5c0 3 1.5 5 3.5 6V20a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3.5c2-1 3.5-3 3.5-6C21 6 17.5 2 12 2z"/><circle cx="8.5" cy="11" r="2.4" fill="var(--kp-ink)"/><circle cx="15.5" cy="11" r="2.4" fill="var(--kp-ink)"/><path d="M11 15h2l-1-2z" fill="var(--kp-ink)"/></svg>;
/** A conductor's cap with a judge's wig curl peeking out. */
export const Cap = () => <svg className="tc-cap" viewBox="0 0 32 24" aria-hidden="true"><path d="M4 14C4 6 10 3 16 3s12 3 12 11z" fill="#1d2a6b" stroke="var(--kp-ink)" strokeWidth="2"/><path d="M2 14h28l-3 5H5z" fill="var(--kp-ink)"/><circle cx="16" cy="9" r="3" fill="var(--kp-sun)"/><circle cx="5" cy="20" r="3.4" fill="var(--kp-cream)" stroke="var(--kp-ink)"/><circle cx="27" cy="20" r="3.4" fill="var(--kp-cream)" stroke="var(--kp-ink)"/></svg>;

export function Chip({ p, children, me }: { p?: PublicPlayer; children?: ReactNode; me?: boolean }) {
  return <span className="tc-chip" style={vars({ '--seat': p?.color ?? '#888' })} data-off={p ? !p.connected : undefined}><i aria-hidden="true"/><b>{me ? 'You' : p?.name ?? 'Player'}</b>{children}</span>;
}

/** A track card face (spans only, so it can sit inside a button). Innocent and Guilty cards show their figure; twists a star. */
export function CardFace({ card, label, className = '', children }: { card: Card; label?: string; className?: string; children?: ReactNode }) {
  return <span className={`tc-card ${className}`} data-kind={card.kind} data-blank={card.blank ? true : undefined}>
    <span className="tc-card-head">{card.kind === 'modifier' ? TWIST : <FigureIcon figure={card.figure}/>}<span>{label ?? KIND[card.kind]}</span>{card.blank && <em>Write-in</em>}</span>
    <span className="tc-card-text">{cardText(card)}</span>
    {children}
  </span>;
}
export const CardBack = ({ stamp, children }: { stamp?: string; children?: ReactNode }) => <div className="tc-back" aria-label={stamp ? `Face-down card, ${stamp.toLowerCase()}` : 'Face-down card'}>{stamp && <b className="tc-stamp">{stamp}</b>}{children}</div>;

/** Read-only track summary for phones: every revealed card with its twists, in full. */
export function TrackList({ v, side, mine }: { v: PublicView; side: Side; mine?: boolean }) {
  const t = v.tracks[side], hot = heading(v) === side;
  return <section className="tc-tracklist" data-side={side} data-mine={mine} aria-label={`${TEAM[side]} track`}>
    <h3><span>{TEAM[side]}{mine ? ' · your track' : ''}</span>{hot && <em>{v.phase === 'crash' || v.phase === 'complete' ? 'Struck' : 'Trolley heading here'}</em>}</h3>
    <ol>{t.slots.map((c, i) => <li key={i} data-kind={c?.card.kind ?? (i === 2 ? 'guilty' : 'innocent')}><small>{mine && i === 1 ? 'Your pick' : slotName(side, i)}</small>{c ? <><p>{cardText(c.card)}</p>{c.mods.map(m => <p key={m.card.id} className="tc-mod" data-from={m.from}><b>{m.from === 'deck' ? '' : TEAM[m.from]}</b> + {cardText(m.card)}</p>)}</> : <p className="tc-empty">Not revealed yet</p>}</li>)}</ol>
  </section>;
}
