// Shared-screen HUD pieces: icons with graceful fallbacks, order tickets, timer, score, banners and the chef strip.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Coins, CookingPot, Flame, Heater, Slice, Star, Timer, TriangleAlert } from 'lucide-react';
import { RECIPES, itemLabel, type Item, type Order, type View } from './model';
import { LEVELS } from './levels';
import { assetUrl } from './asset-url';
import { clock, foodIcon, iconFallback, itemIcons, nextTip, patience, patienceTone, recipeSteps, type Process } from './presentation';

// ── Icons ───────────────────────────────────────────────────────────────────
const missing = new Set<string>();
function IconImage({ name, className }: { name: string; className: string }) {
  const [, retry] = useState(0);
  if (missing.has(name)) { const chip = iconFallback(name); return <span className={`kr-icon kr-icon-chip ${className}`} style={{ '--chip': chip.color } as CSSProperties} aria-hidden="true"><i>{chip.glyph}</i></span>; }
  return <img className={`kr-icon ${className}`} src={assetUrl(`icons/${name}.png`)} alt="" aria-hidden="true" draggable={false} onError={() => { missing.add(name); retry(n => n + 1); }}/>;
}
/** Game icon by DESIGN.md name; falls back to a coloured emoji chip if the file is missing. */
export const Icon = ({ name, className = '' }: { name: string; className?: string }) => <IconImage key={name} name={name} className={className}/>;

export function ItemIcon({ item, className = '' }: { item: Item | null | undefined; className?: string }) {
  const icons = itemIcons(item);
  if (!icons) return <span className={`kr-item kr-item-empty ${className}`} aria-hidden="true"/>;
  return <span className={`kr-item ${className}`} title={itemLabel(item)} aria-hidden="true">
    <Icon name={icons.main}/>
    {icons.parts.length > 0 && <span className="kr-item-parts">{icons.parts.slice(0, 4).map((part, i) => <Icon key={i} name={foodIcon(part)}/>)}</span>}
    {(icons.count ?? 0) > 1 && <b className="kr-item-count">{icons.count}</b>}
  </span>;
}
const PROCESS_ICON = { chop: Slice, boil: CookingPot, fry: Flame, bake: Heater } satisfies Record<Process, unknown>;
export function ProcessBadge({ process }: { process: Process }) {
  const Glyph = PROCESS_ICON[process];
  return <span className={`kr-badge kr-badge-${process}`} title={process}><Glyph aria-hidden="true"/></span>;
}

// ── Orders ──────────────────────────────────────────────────────────────────
export type Leaving = 'served' | 'expired';
export function OrderCard({ order, now, relaxed, leaving, compact = false }: { order: Order; now: number; relaxed: boolean; leaving?: Leaving; compact?: boolean }) {
  const recipe = RECIPES[order.recipe], left = relaxed ? 1 : patience(order, now), tone = leaving ?? patienceTone(left);
  return <article className={`kr-order kr-order-${tone} ${compact ? 'kr-order-compact' : ''}`} aria-label={`${recipe.name}${relaxed ? '' : `, ${Math.ceil(left * 100)}% patience left`}`}>
    <header><Icon name={`dish_${order.recipe}`} className="kr-order-dish"/><strong>{recipe.name}</strong></header>
    <ul className="kr-order-parts">{recipeSteps(order.recipe).map(step => <li key={foodIcon(step.part)}>
      <Icon name={foodIcon(step.part)}/>{step.process && <ProcessBadge process={step.process}/>}{step.count > 1 && <b>×{step.count}</b>}
    </li>)}</ul>
    {!relaxed && <div className="kr-patience"><i style={{ width: `${left * 100}%` }}/></div>}
    {leaving && <span className="kr-order-stamp">{leaving === 'served' ? 'Served!' : 'Missed'}</span>}
  </article>;
}
/** Current tickets plus recently removed ones (kept briefly for their exit animation), oldest first. */
export function useOrderRail(view: View) {
  const [leaving, setLeaving] = useState<{ order: Order; kind: Leaving }[]>([]), previous = useRef(view.orders);
  useEffect(() => {
    const gone = previous.current.filter(order => !view.orders.some(next => next.id === order.id));
    previous.current = view.orders;
    if (gone.length) setLeaving(list => [...list, ...gone.map(order => ({ order, kind: (!view.settings.relaxed && view.now >= order.expiresAt - 300 ? 'expired' : 'served') as Leaving }))]);
  }, [view.orders, view.now, view.settings.relaxed]);
  useEffect(() => { if (!leaving.length) return; const timer = setTimeout(() => setLeaving([]), 750); return () => clearTimeout(timer); }, [leaving]);
  return [...view.orders.map(order => ({ order, kind: undefined as Leaving | undefined })), ...leaving].sort((a, b) => a.order.id - b.order.id);
}
export function OrderRail({ view }: { view: View }) {
  const cards = useOrderRail(view);
  return <section className="kr-rail" aria-label="Orders">
    {cards.map(({ order, kind }) => <OrderCard key={order.id} order={order} now={view.now} relaxed={view.settings.relaxed} leaving={kind}/>)}
    {!cards.length && <p className="kr-rail-empty">Orders incoming…</p>}
  </section>;
}

// ── Score, timer, banners ───────────────────────────────────────────────────
export function TimerBox({ view }: { view: View }) {
  const left = view.endsAt - Math.max(view.now, view.startedAt);
  return <div className={`kr-timer ${left <= 30000 && !view.complete ? 'kr-timer-hurry' : ''}`} role="timer" aria-label={`${clock(left)} left`}>
    <Timer aria-hidden="true"/><output className="kp-numeral">{clock(left)}</output>
  </div>;
}
export function ScoreBox({ view }: { view: View }) {
  const top = Math.max(view.thresholds[2] * 1.15, view.score, 1), at = (score: number) => `${Math.min(100, score / top * 100)}%`;
  const combo = Math.max(1, Math.min(4, view.combo));
  return <div className="kr-score" aria-label={`${view.score} coins, ${view.stars} of 3 stars, ${nextTip(combo)}`}>
    <span className="kr-coin" aria-hidden="true"><Coins/></span>
    <output key={view.score} className="kp-numeral kr-score-value">{view.score}</output>
    <b key={`c${combo}`} className={`kr-combo kr-combo-${combo}`}><small>Next tip</small>×{combo}</b>
    <span className="kr-star-bar" aria-hidden="true"><i style={{ width: at(view.score) }}/>
      {view.thresholds.map((score, i) => <span key={i} className={view.score >= score ? 'kr-got' : ''} style={{ left: at(score) }}><Star/></span>)}
    </span>
  </div>;
}
/** Banners for hazards and celebrations. Stars announce themselves for a moment after the `star` event. */
function Banners({ view }: { view: View }) {
  const [star, setStar] = useState(0), seen = useRef<number | null>(null);
  useEffect(() => {
    const latest = view.events.reduce((max, event) => Math.max(max, event.id), -1), fresh = seen.current !== null && view.events.some(event => event.type === 'star' && event.id > seen.current!);
    seen.current = latest;
    if (fresh) setStar(view.stars);
  }, [view.events, view.stars]);
  useEffect(() => { if (!star) return; const timer = setTimeout(() => setStar(0), 2200); return () => clearTimeout(timer); }, [star]);
  const fire = view.tiles.some(tile => tile.fire), gated = !!LEVELS[view.settings.level]?.gates;
  const banners: { tone: string; text: ReactNode }[] = [];
  if (star) banners.push({ tone: 'star', text: <><Star aria-hidden="true"/>{star === 3 ? 'Three stars!' : `Star ${star} earned!`}</> });
  if (fire) banners.push({ tone: 'fire', text: <><Flame aria-hidden="true"/>Fire! Grab an extinguisher</> });
  if (gated && view.gateWarning) banners.push({ tone: 'warn', text: <><TriangleAlert aria-hidden="true"/>{view.gatesOpen ? 'Drawbridge closing!' : 'Drawbridge opening!'}</> });
  return <div className="kr-banners" role="status">{banners.map(banner => <p key={banner.tone} className={`kr-banner kr-banner-${banner.tone}`}>{banner.text}</p>)}</div>;
}
/** Big centre call-outs: pre-start countdown, "Go!" and "Time's up!". */
function Callout({ view }: { view: View }) {
  const before = view.startedAt - view.now, since = view.now - view.startedAt;
  const text = view.complete ? "Time's up!" : before > 0 ? String(Math.ceil(before / 1000)) : since < 1100 ? 'Go!' : null;
  return text ? <p key={text} className="kr-callout kp-title" aria-live="assertive">{text}</p> : null;
}

// ── Chefs ───────────────────────────────────────────────────────────────────
export function ChefStrip({ view }: { view: View }) {
  return <ol className="kr-chefs" aria-label="Chefs">{view.players.map((chef, i) => <li key={chef.id} className={chef.connected ? '' : 'kr-away'} style={{ '--chef': chef.color } as CSSProperties}>
    <b>{i + 1}</b><span>{chef.name}</span><ItemIcon item={chef.held}/>
  </li>)}</ol>;
}

/** Full HUD overlay for the shared display; `solo` rearranges it around on-screen controls (children). */
export function Hud({ view, solo = false, children }: { view: View; solo?: boolean; children?: ReactNode }) {
  return <div className={`kr-stage ${solo ? 'kr-stage-solo' : ''}`}>
    <OrderRail view={view}/>
    <div className="kr-corner"><TimerBox view={view}/>{solo && <ScoreBox view={view}/>}</div>
    <Banners view={view}/>
    <Callout view={view}/>
    {!solo && <footer className="kr-footer"><ScoreBox view={view}/><ChefStrip view={view}/></footer>}
    {view.settings.relaxed && <span className="kr-relaxed">Relaxed</span>}
    {children}
  </div>;
}
