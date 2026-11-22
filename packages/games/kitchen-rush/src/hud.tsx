// Shared-screen HUD pieces: icons with graceful fallbacks, order tickets, timer, score, banners and the chef strip.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Coins, CookingPot, Flame, Heater, Slice, Star, Timer, TriangleAlert, Zap } from 'lucide-react';
import { LINES, RECIPES, RUSH_SECONDS, itemLabel, rushHour, type Item, type Order, type Restaurant, type View } from './model';
import { LEVELS } from './levels';
import { assetUrl } from './asset-url';
import { clock, foodIcon, iconFallback, itemIcons, nextTip, patience, patienceTone, place, recipeSteps, type Process } from './presentation';

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
export function OrderRail({ view, compact = false }: { view: View; compact?: boolean }) {
  const cards = useOrderRail(view);
  return <section className={`kr-rail ${compact ? 'kr-rail-compact' : ''}`} aria-label="Orders">
    {cards.map(({ order, kind }) => <OrderCard key={order.id} order={order} now={view.now} relaxed={view.settings.relaxed} leaving={kind} compact={compact}/>)}
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
/** Coins, stars and the next tip. With `shared` it is the whole restaurant's score, which has no tip of its own. */
export function ScoreBox({ view, shared = false, rush = false }: { view: Pick<View, 'score' | 'stars' | 'thresholds' | 'combo'>; shared?: boolean; rush?: boolean }) {
  const top = Math.max(view.thresholds[2] * 1.15, view.score, 1), at = (score: number) => `${Math.min(100, score / top * 100)}%`;
  const combo = Math.max(1, Math.min(4, view.combo));
  // Coins just earned float up off the total.
  const before = useRef(view.score), [gain, setGain] = useState(0);
  useEffect(() => { const earned = view.score - before.current; before.current = view.score; if (earned > 0) setGain(earned); }, [view.score]);
  return <div className="kr-score" aria-label={`${shared ? 'Restaurant: ' : ''}${view.score} coins, ${view.stars} of 3 stars${shared ? '' : `, ${nextTip(combo, rush)}`}`}>
    <span className="kr-coin" aria-hidden="true"><Coins/></span>
    <output key={view.score} className="kp-numeral kr-score-value">{view.score}</output>
    {gain > 0 && <i key={`gain${view.score}`} className="kr-gain kp-numeral" aria-hidden="true">+{gain}</i>}
    {shared ? <b className="kr-combo kr-shared"><small>All kitchens</small>Restaurant</b> : <b key={`c${combo}${rush}`} className={`kr-combo kr-combo-${combo} ${rush ? 'kr-rush' : ''}`}><small>{rush ? 'Rush tip' : 'Next tip'}</small>×{combo * (rush ? 2 : 1)}</b>}
    <span className="kr-star-bar" aria-hidden="true"><i style={{ width: at(view.score) }}/>
      {view.thresholds.map((score, i) => <span key={i} className={view.score >= score ? 'kr-got' : ''} style={{ left: at(score) }}><Star/></span>)}
    </span>
  </div>;
}
/** Rush hour announces itself for its first five seconds. */
const rushOpening = (view: View) => rushHour(view) && view.endsAt - view.now > (RUSH_SECONDS - 5) * 1000;
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
  if (rushOpening(view)) banners.push({ tone: 'rush', text: <><Zap aria-hidden="true"/>Rush hour! Double tips</> });
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
    <b>{view.first + i + 1}</b><span>{chef.name}</span><ItemIcon item={chef.held}/>
  </li>)}</ol>;
}

// ── Kitchen lines ───────────────────────────────────────────────────────────
export const lineStyle = (line: number) => ({ '--line': LINES[line % LINES.length].color }) as CSSProperties;
/** A kitchen's letter and name in its colour, with its place in the race when given. */
export function LineBadge({ line, rank, short = false }: { line: number; rank?: number; short?: boolean }) {
  const info = LINES[line % LINES.length];
  return <span className="kr-line" style={lineStyle(line)} aria-label={`Kitchen ${info.letter}, ${info.name}${rank ? `, ${place(rank)} place` : ''}`}><b>{info.letter}</b>{!short && <span>{info.name}</span>}{rank !== undefined && <em>{place(rank)}</em>}</span>;
}
/** One kitchen on the broadcast board: place, coins, its own star rating and its open tickets coloured by patience. */
function LineCard({ view, rank }: { view: View; rank: number }) {
  const burning = view.tiles.some(tile => tile.fire);
  return <li className={`kr-board-line ${rank === 1 && view.score > 0 ? 'kr-lead' : ''} ${burning ? 'kr-burning' : ''}`} style={lineStyle(view.line)}>
    <LineBadge line={view.line}/>
    <output key={view.score} className="kp-numeral">{view.score}</output>
    <span className="kr-stars" aria-label={`${view.stars} of 3 stars`}>{[0, 1, 2].map(i => <Star key={i} className={i < view.stars ? 'kr-got' : ''} aria-hidden="true"/>)}</span>
    <span className="kr-board-orders" aria-label={`${view.orders.length} open orders`}>{burning && <Flame className="kr-board-fire" aria-hidden="true"/>}
      {view.orders.slice(0, 5).map(order => <i key={order.id} className={`kr-wait-${view.settings.relaxed ? 'ok' : patienceTone(patience(order, view.now))}`}><Icon name={`dish_${order.recipe}`}/></i>)}{view.orders.length > 5 && <b>+{view.orders.length - 5}</b>}</span>
    <em>{place(rank)}</em>
  </li>;
}
/**
 * Shared screen for a restaurant of several kitchens. Every kitchen is on screen at once, so the HUD keeps to the clock,
 * the shared score and stars, and one card per kitchen; each phone shows its own kitchen's tickets.
 */
export function Broadcast({ restaurant }: { restaurant: Restaurant }) {
  const first = restaurant.lines[0], burning = restaurant.lines.filter(view => view.tiles.some(tile => tile.fire)).map(view => LINES[view.line % LINES.length].letter);
  const [star, setStar] = useState(0), best = useRef<number | null>(null);
  useEffect(() => { if (best.current !== null && restaurant.stars > best.current) setStar(restaurant.stars); best.current = Math.max(best.current ?? 0, restaurant.stars); }, [restaurant.stars]);
  useEffect(() => { if (!star) return; const timer = setTimeout(() => setStar(0), 2600); return () => clearTimeout(timer); }, [star]);
  return <div className="kr-stage kr-stage-broadcast" data-lines={restaurant.lines.length} data-fire={burning.length > 0 || undefined}>
    <div className="kr-broadcast-top"><ScoreBox view={{ ...restaurant, combo: 1 }} shared/><TimerBox view={first}/></div>
    <div className="kr-banners" role="status">
      {star > 0 && <p className="kr-banner kr-banner-star"><Star aria-hidden="true"/>{star === 3 ? 'Three stars for the restaurant!' : `Restaurant star ${star}!`}</p>}
      {rushOpening(first) && <p className="kr-banner kr-banner-rush"><Zap aria-hidden="true"/>Rush hour! Double tips in every kitchen</p>}
      {burning.length > 0 && <p className="kr-banner kr-banner-fire"><Flame aria-hidden="true"/>Fire in kitchen {burning.join(', ')}!</p>}
    </div>
    <Callout view={first}/>
    <ol className="kr-board" aria-label="Kitchens">{restaurant.lines.map(view => <LineCard key={view.line} view={view} rank={restaurant.ranks[view.line]}/>)}</ol>
    {first.settings.relaxed && <span className="kr-relaxed">Relaxed</span>}
  </div>;
}

/**
 * Full HUD overlay for one kitchen; `solo` rearranges it around on-screen controls (children) and `handheld` tightens it
 * for a phone. In a restaurant of several kitchens it also names this kitchen and its place.
 */
export function Hud({ view, restaurant, solo = false, handheld = false, children }: { view: View; restaurant?: Restaurant; solo?: boolean; handheld?: boolean; children?: ReactNode }) {
  const many = restaurant && restaurant.lines.length > 1;
  return <div className={`kr-stage ${solo ? 'kr-stage-solo' : ''} ${handheld ? 'kr-stage-handheld' : ''}`} data-fire={view.tiles.some(tile => tile.fire) || undefined}>
    <OrderRail view={view} compact={handheld}/>
    <div className="kr-corner"><TimerBox view={view}/>{solo && <ScoreBox view={view} rush={rushHour(view)}/>}{many && <LineBadge line={view.line} rank={restaurant.ranks[view.line]}/>}</div>
    <Banners view={view}/>
    <Callout view={view}/>
    {!solo && <footer className="kr-footer"><ScoreBox view={view} rush={rushHour(view)}/><ChefStrip view={view}/></footer>}
    {view.settings.relaxed && <span className="kr-relaxed">Relaxed</span>}
    {children}
  </div>;
}
