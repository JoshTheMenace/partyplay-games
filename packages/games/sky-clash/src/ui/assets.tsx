import { useEffect, useState, type CSSProperties } from 'react';
import { manifest } from '../manifest';
import { FIGHTERS, type Costume, type FighterKind, type FighterView } from '../model';
import { getStage, type StageId } from '../stages';
import { costumeColors, fallbackCostumes } from './data';
/** Model-pipeline art (portraits, renders, costumes), bundled as URLs/JSON. Any missing file falls back to a drawn emblem. */
const byName = <T,>(files: Record<string, T>) => Object.fromEntries(Object.entries(files).map(([path, value]) => [path.split('/').pop()!.replace(/\.\w+$/, ''), value]));
const PORTRAITS = byName(import.meta.glob<string>('../../assets/portraits/*.webp', { eager: true, query: '?url', import: 'default' }));
const RENDERS = byName(import.meta.glob<string>('../../assets/renders/*.webp', { eager: true, query: '?url', import: 'default' }));
const COSTUMES = byName(import.meta.glob<unknown>('../../assets/costumes/*.json', { eager: true, import: 'default' }));
const isCostume = (c: unknown): c is Costume => !!c && typeof (c as Costume).name === 'string' && !!(c as Costume).colors && typeof (c as Costume).colors === 'object';
const costumeList = (kind: FighterKind): Costume[] => {
  const raw = COSTUMES[kind], list = Array.isArray(raw) ? raw : (raw as { costumes?: unknown } | undefined)?.costumes;
  return Array.isArray(list) && list.length >= 4 && list.every(isCostume) ? list.slice(0, 4) : fallbackCostumes(kind);
};
export const costumesOf = (kind: FighterKind) => costumeList(kind);
export const costumeOf = (kind: FighterKind, costume = 0) => costumeList(kind)[Math.max(0, Math.min(3, costume))];
const lookup = (files: Record<string, string>, kind: FighterKind, costume: number) => files[`${kind}-${costume}`] ?? files[kind];
/** CSS variables for a fighter tinted by its costume. */
export function costumeTone(kind: FighterKind, costume = 0, extra?: Record<string, string>) {
  const c = costumeColors(costumeOf(kind, costume), kind);
  return { '--sc-color': c.primary, '--sc-costume': c.primary, '--sc-costume-2': c.secondary, '--sc-costume-3': c.accent, ...extra } as CSSProperties;
}
export const tone = (color: string, extra?: Record<string, string>) => ({ '--sc-color': color, ...extra }) as CSSProperties;
const initials = (kind: FighterKind) => FIGHTERS[kind].name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('');
/** Drawn bust in costume colors: stands in for a missing portrait and draws the stock heads. */
export function Emblem({ kind, costume = 0 }: { kind: FighterKind; costume?: number }) {
  const c = costumeColors(costumeOf(kind, costume), kind);
  return <svg className="sc-emblem" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M6 66c1-15 12-22 26-22s25 7 26 22z" fill={c.primary}/><path d="M22 46l10 9 10-9" fill={c.secondary}/>
    <circle cx="32" cy="27" r="14" fill={c.secondary}/><circle cx="32" cy="29" r="11" fill="#f3c9a4"/>
    <path d="M20 26c0-9 5-14 12-14s12 5 12 14c-4-4-8-5-12-5s-8 1-12 5z" fill={c.primary}/>
    <text x="32" y="62" textAnchor="middle" fontFamily="'Lilita One','Arial Black',sans-serif" fontSize="13" fill="#fff6e5" stroke="#05071a" strokeWidth="2" paintOrder="stroke">{initials(kind)}</text>
  </svg>;
}
/** Portrait (head and shoulders) or full-body render when the pipeline supplied one; the emblem otherwise and on load failure. */
export function Portrait({ kind, costume = 0, render = false, className = '' }: { kind: FighterKind | 'random' | null; costume?: number; render?: boolean; className?: string }) {
  const url = !kind || kind === 'random' ? undefined : render ? lookup(RENDERS, kind, costume) ?? lookup(PORTRAITS, kind, costume) : lookup(PORTRAITS, kind, costume);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!kind || kind === 'random') return <span className={`sc-portrait sc-portrait-random ${className}`} aria-hidden="true"><b>{kind ? '?' : ''}</b></span>;
  return <span className={`sc-portrait${render ? ' sc-portrait-render' : ''} ${className}`} style={costumeTone(kind, costume)} aria-hidden="true">
    {url && !failed ? <img src={url} alt="" draggable={false} decoding="async" onError={() => setFailed(true)}/> : <Emblem kind={kind} costume={costume}/>}</span>;
}
/** Melee-style stock heads: small portraits, lost stocks greyed out; more than five collapse to "×n". */
export function StockIcons({ f, max }: { f: Pick<FighterView, 'fighter' | 'costume' | 'stocks'>; max: number }) {
  const shown = Math.max(0, f.stocks), many = Math.max(max, shown) > 5;
  return <span className="sc-stocks" role="img" aria-label={`${shown} stock${shown === 1 ? '' : 's'} left`}>
    {many ? <><Portrait kind={f.fighter} costume={f.costume} className="sc-stock"/><b className="kp-numeral">×{shown}</b></>
      : Array.from({ length: Math.max(max, shown) }, (_, i) => <Portrait key={i} kind={f.fighter} costume={f.costume} className={i < shown ? 'sc-stock' : 'sc-stock sc-stock-lost'}/>)}
  </span>;
}
export const stageImage = (id: StageId) => `${manifest.assetBase}maps/${id}.webp`;
/** Regenerated 16:9 stage card; a palette gradient with the stage name while the image is missing. */
export function StageImage({ id, className = '' }: { id: StageId | 'random'; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  if (id === 'random') return <span className={`sc-stage-img sc-stage-random ${className}`} aria-hidden="true"><b>?</b></span>;
  const p = getStage(id).palette;
  return <span className={`sc-stage-img ${className}`} aria-hidden="true" style={{ background: `linear-gradient(180deg, ${p.skyTop}, ${p.skyBottom} 70%, ${p.ground})` }}>
    {failed ? <b className="sc-stage-fallback" style={{ color: p.light }}>{getStage(id).name}</b> : <img src={stageImage(id)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)}/>}</span>;
}
