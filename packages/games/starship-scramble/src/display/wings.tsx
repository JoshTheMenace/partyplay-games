/** Crowd layouts: what the TV shows once a fleet is more than one wing (five captains or more), where one card per captain no longer fits. */
import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { WING_COLORS, wingCount, wingLetter, wingName, type CaptainView, type PublicView } from '../contracts';
import { hullDef } from '../defs/hulls';
import { hullPlan, loadShipArt } from '../render/ship';
import { ASSET, Scrap, itemInfo, tint } from './common';

export const wingTint = (wing: number) => tint(WING_COLORS[wing % WING_COLORS.length]);
export const WingTag = ({ wing }: { wing: number }) => <span className="ss-wingtag" style={wingTint(wing)}><b>{wingLetter(wing)}</b>{wingName(wing)}</span>;

/** A hull sprite in its paint, drawn once (sixty of these share a screen; they must not each run a frame loop). */
export function HullThumb({ hullId, paint, className = '' }: { hullId: string; paint: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const draw = () => { const c = ref.current, g = c?.getContext('2d'); if (!live || !c || !g) return;
      const src = hullPlan(hullId, paint, Math.max(1, Math.round(c.clientWidth * Math.min(2, devicePixelRatio || 1))));
      c.width = src.width; c.height = src.height; g.drawImage(src, 0, 0); };
    draw(); void loadShipArt(ASSET).then(draw);
    return () => { live = false; };
  }, [hullId, paint]);
  return <canvas ref={ref} className={`ss-hullthumb ${className}`} aria-hidden/>;
}

/** One card per wing, laid out to fill the screen: two columns up to four wings, three up to six, four beyond. */
export function WingBoard({ view, tally, children }: { view: PublicView; tally?(captains: CaptainView[], wing: number): ReactNode; children(captains: CaptainView[], wing: number): ReactNode }) {
  const n = wingCount(view.captains.length), cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
  return <div className="ss-wingboard" data-dense={n > 8 || undefined} style={{ '--cols': cols, '--rows': Math.ceil(n / cols) } as React.CSSProperties}>{Array.from({ length: n }, (_, wing) => {
    const captains = view.captains.filter(c => c.wing === wing);
    return <article key={wing} className="ss-wingcard" style={wingTint(wing)}><header><b>{wingLetter(wing)}</b><span>{wingName(wing)}</span>{tally?.(captains, wing)}</header>{children(captains, wing)}</article>; })}</div>;
}
const Count = ({ n, of, label }: { n: number; of: number; label: string }) => <em className={`ss-tag ${n >= of && of ? 'ss-tag-ok' : ''}`}>{n}/{of} {label}</em>;
const readyTally = (captains: CaptainView[]) => { const live = captains.filter(c => c.connected); return <Count n={live.filter(c => c.ready).length} of={live.length} label="ready"/>; };

/** Top bar for a big fleet: one chip per wing with a hull bar per ship and how many of its captains have acted. */
export function WingBar({ view }: { view: PublicView }) {
  const voting = view.phase === 'map' || view.phase === 'event' && !view.event?.result, hulls = new Map(view.fleet?.ships.map(s => [s.captainId, s]));
  return <ul className="ss-topbar-wings">{Array.from({ length: wingCount(view.captains.length) }, (_, wing) => {
    const captains = view.captains.filter(c => c.wing === wing), live = captains.filter(c => c.connected), done = live.filter(c => voting ? c.vote : c.ready).length;
    return <li key={wing} style={wingTint(wing)} data-done={done >= live.length && live.length > 0 || undefined} aria-label={`${wingName(wing)} wing: ${done} of ${live.length} ${voting ? 'voted' : 'ready'}`}>
      <b>{wingLetter(wing)}</b>
      <span className="ss-wingbar-hulls">{captains.map(c => { const ship = hulls.get(c.id), hp = ship ? ship.hull / ship.maxHull : 0;
        return <i key={c.id} className={c.connected ? '' : 'ss-away'} data-low={hp < .35 || undefined}><i style={{ height: `${hp * 100}%`, background: c.color }}/></i>; })}</span>
      {view.captains.length <= 40 && <small className="kp-numeral">{done}/{live.length}</small>}</li>; })}</ul>;
}

export function FleetHangar({ view }: { view: PublicView }) {
  return <WingBoard view={view} tally={readyTally}>{captains => <ul className="ss-wingrows">{captains.map(c => { const ship = view.fleet?.ships.find(s => s.id === c.shipId);
    return <li key={c.id} style={tint(c.color)} className={c.connected ? '' : 'ss-away'} data-ready={c.ready || undefined}>
      {ship ? <HullThumb hullId={ship.hullId} paint={ship.paint}/> : <span className="ss-hullthumb ss-hullthumb-empty"/>}
      <span className="ss-wingrow-text"><b>{c.name}</b><small>{ship ? hullDef(ship.hullId).name : 'choosing…'}</small></span>
      {c.ready && <Check aria-label="ready"/>}</li>; })}</ul>}</WingBoard>;
}

/**
 * Loot and store for a big fleet: every wing's own table (the cards are on the phones). A pip per item shows what is taken and by whom;
 * the rows under it name as many as the card has room for, taken ones first.
 */
export function FleetGoods({ view }: { view: PublicView }) {
  const wings = wingCount(view.captains.length), room = wings > 12 ? 2 : wings > 8 ? 3 : wings > 4 ? 5 : 9;
  const who = (id: string | null | undefined) => view.captains.find(c => c.id === id) ?? null;
  const rows = (wing: number) => view.loot ? view.loot.items.filter(i => (i.wing ?? 0) === wing).map(i => ({ id: i.id, info: itemInfo(i.kind, i.defId), owner: who(view.loot!.claims[i.id] ?? i.ownerId), price: null as number | null }))
    : (view.store?.offers ?? []).filter(o => o.wing === wing).map(o => ({ id: o.id, info: itemInfo(o.kind, o.defId, o.crew), owner: who(o.soldTo), price: o.price }));
  return <WingBoard view={view} tally={readyTally}>{(_, wing) => { const all = rows(wing), list = [...all.filter(r => r.owner), ...all.filter(r => !r.owner)].slice(0, room);
    return all.length ? <><p className="ss-goods-pips" aria-label={`${all.filter(r => r.owner).length} of ${all.length} taken`}>{all.map(r => <i key={r.id} style={r.owner ? { background: r.owner.color } : undefined}/>)}
      <small>{all.filter(r => r.owner).length}/{all.length} {view.loot ? 'claimed' : 'sold'}</small></p>
      <ul className="ss-goods">{list.map(({ id, info, owner, price }) => <li key={id} className={owner ? 'ss-goods-taken' : ''} style={owner ? tint(owner.color) : undefined}>
      <info.Glyph aria-hidden/><span>{info.name}</span>{owner ? <em>{owner.name}</em> : price !== null ? <Scrap n={price}/> : <em className="ss-muted">up for grabs</em>}</li>)}</ul></>
      : <p className="ss-muted ss-goods-none">Nothing for this wing.</p>; }}</WingBoard>;
}
