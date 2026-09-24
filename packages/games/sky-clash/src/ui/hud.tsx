import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../../party-ui/src/index';
import { FIGHTERS, type Action, type FighterView, type Input, type View } from '../model';
import { getStage, stageFrame } from '../stages';
import { Portrait, StockIcons, costumeTone } from './assets';
import { CPU_LEVELS, TEAM_COLORS, damageColor, formatClock } from './data';
import { finishWord, koItems, placements, seats, type FeedItem } from './standings';
type Props = GameViewProps<Input, Action, View, null>;
const FEED_FRAMES = 300, GO_MS = 900, SUDDEN_MS = 2400;
function useTicker(ms: number) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set(v => v + 1), ms); return () => clearInterval(t); }, [ms]); }
/** Transient HUD memory from events: the latest hit per fighter (card shake), the KO feed and the order fighters ran out of stocks. Each event id counts once; a (re)mount starts from a baseline. */
function useEventMemory(view: View) {
  const mem = useRef<{ turn: string; base: number; seen: number; hits: Map<string, { id: number; power: number }>; feed: FeedItem[]; out: string[] } | null>(null);
  const maxId = view.events.reduce((m, e) => Math.max(m, e.id), -1);
  if (mem.current?.turn !== view.turnId) mem.current = { turn: view.turnId, base: maxId, seen: maxId, hits: new Map(), feed: [], out: placements(view).filter(p => p.f.stocks <= 0).reverse().map(p => p.f.id) };
  const m = mem.current, fresh = view.events.filter(e => e.id > m.seen);
  for (const e of fresh) if (e.kind === 'hit' && e.target) m.hits.set(e.target, { id: e.id, power: e.power ?? .3 });
  m.feed = [...m.feed, ...koItems(view, fresh)].filter(item => view.frame - item.frame < FEED_FRAMES).slice(-4);
  m.seen = Math.max(m.seen, maxId);
  for (const f of view.fighters) if (f.stocks <= 0 && !m.out.includes(f.id)) m.out.push(f.id);
  return m;
}
/** Phase transitions this mount actually saw (GO!, SUDDEN DEATH). A reconnect mid-fight shows neither. */
function usePhaseMoments(view: View, now: number) {
  const r = useRef<{ phase: View['phase'] | null; go: number; sudden: number }>({ phase: null, go: 0, sudden: 0 });
  if (r.current.phase !== view.phase) {
    if (r.current.phase === 'countdown' && view.phase === 'fight') r.current.go = now + GO_MS;
    if (view.phase === 'sudden' && r.current.phase !== null) r.current.sudden = now + SUDDEN_MS;
    r.current.phase = view.phase;
  }
  return { go: now < r.current.go, sudden: now < r.current.sudden };
}
/** Warn before each activation and flag its first four seconds; always-on hazards (Big Blue's track) do not pin a badge. */
function useHazardAlert(hazard: { warning: boolean; active: boolean; cycle: number } | null, tick: number) {
  const on = useRef<{ cycle: number; since: number } | null>(null);
  if (hazard?.active && on.current?.cycle !== hazard.cycle) on.current = { cycle: hazard.cycle, since: tick };
  return hazard?.warning ? 'warning' : hazard?.active && tick - on.current!.since < 240 ? 'active' : null;
}
function FighterCard({ f, view, place, hit }: { f: FighterView; view: View; place: number; hit?: { id: number; power: number } }) {
  const out = f.stocks <= 0, team = view.teams && f.team !== null ? TEAM_COLORS[f.team] : null, big = !!hit && hit.power > .6;
  return <li className={`sc-card${out ? ' sc-card-out' : ''}${f.connected ? '' : ' sc-card-offline'}`} style={costumeTone(f.fighter, f.costume, { '--sc-player': f.color, ...(team ? { '--sc-team': team } : {}) })}
    aria-label={`${f.name}, ${FIGHTERS[f.fighter].name}${f.cpu ? `, CPU ${CPU_LEVELS[f.cpu]}` : ''}, ${out ? `out, place ${place}` : `${Math.round(f.damage)} percent, ${f.stocks} stocks`}`}>
    <Portrait kind={f.fighter} costume={f.costume} className="sc-card-portrait"/>
    {f.cpu && <b className="sc-card-cpu" aria-hidden="true">CPU {f.cpu}</b>}
    <strong className="sc-card-name">{f.name}</strong>
    <div className="sc-card-main">
      <span className="sc-card-sub">{f.connected ? FIGHTERS[f.fighter].name : 'Offline'}</span>
      {out ? <span className="sc-card-ko">Knocked out</span> : <StockIcons f={f} max={view.stocks}/>}
    </div>
    <span key={hit?.id ?? 'still'} className={`sc-card-dmg kp-numeral${hit ? big ? ' sc-shake sc-shake-big' : ' sc-shake' : ''}`} style={{ color: out ? undefined : damageColor(f.damage) }}>
      {out ? `#${place}` : <>{Math.round(f.damage)}<small>%</small></>}</span>
  </li>;
}
export function DisplayView({ publicView, serverNowMs }: Props) {
  const view = seats(publicView);
  useTicker(100);
  const now = serverNowMs(), stage = getStage(view.stageId), mem = useEventMemory(view), moment = usePhaseMoments(view, now);
  const hazard = view.phase === 'fight' || view.phase === 'sudden' ? stageFrame(view.stageId, view.stageTick, view.hazards).hazard : null, alert = useHazardAlert(hazard, view.stageTick);
  const count = view.phase === 'countdown' ? Math.max(1, Math.ceil((view.phaseEndsAt - now) / 1000)) : null;
  const clockEnd = view.phase === 'sudden' ? view.phaseEndsAt : view.endsAt, unlimited = !clockEnd;
  const frozen = useRef(0); // GAME!/TIME! holds the clock where the match ended
  if (view.phase !== 'complete') frozen.current = Math.max(0, view.phase === 'countdown' ? view.endsAt - view.phaseEndsAt : clockEnd - now);
  const remaining = frozen.current, low = !unlimited && view.phase !== 'countdown' && remaining < 10_000;
  // Melee order: the first fighter out places last (fighters already out at mount are seeded from the standings).
  const places = new Map(placements(view).map(p => [p.f.id, p.f.stocks <= 0 ? view.fighters.length - mem.out.indexOf(p.f.id) : p.place]));
  const banner = count !== null ? { key: `c${count}`, text: String(count), kind: 'count' } : moment.go ? { key: 'go', text: 'GO!', kind: 'go' }
    : view.phase === 'complete' ? { key: 'end', text: finishWord(view), kind: 'end' } : moment.sudden ? { key: 'sd', text: 'SUDDEN DEATH', kind: 'sudden' } : null;
  return <div className={`sky-clash-hud sc-phase-${view.phase}`} data-fighters={view.fighters.length}>
    <header className="sc-hud-top">
      <div className="sc-hud-stage"><span className="kp-display">{stage.name}</span>
        {hazard && alert && <span className={`sc-hazard${alert === 'active' ? ' sc-hazard-on' : ''}`} role="status">{alert === 'active' ? `${hazard.label}!` : `⚠ ${hazard.label}`}</span>}</div>
      <div className={`sc-hud-clock kp-numeral${low ? ' sc-clock-low' : ''}`} role="timer" aria-label={unlimited ? 'No time limit' : `${formatClock(remaining)} left`}>
        {view.phase === 'sudden' && <small>Sudden death</small>}{unlimited && view.phase !== 'sudden' ? '∞' : formatClock(remaining)}</div>
      <ol className="sc-feed" aria-live="polite">{mem.feed.map(item => <li key={item.id} className={item.star ? 'sc-feed-star' : undefined}>
        {item.source && <><Portrait kind={item.source.fighter} costume={item.source.costume}/><b style={{ color: item.source.color }}>{item.source.name}</b><span>KO’d</span></>}
        <Portrait kind={item.target.fighter} costume={item.target.costume}/><b style={{ color: item.target.color }}>{item.target.name}</b>{!item.source && <span>{item.star ? 'became a star!' : 'fell!'}</span>}</li>)}</ol>
    </header>
    {banner && <div key={banner.key} className={`sc-banner sc-banner-${banner.kind} kp-title`} role="status" aria-live="assertive">{banner.text}</div>}
    <ol className="sc-cards" style={{ '--n': view.fighters.length } as CSSProperties}>{view.fighters.map(f => { const hit = mem.hits.get(f.id);
      return <FighterCard key={f.id} f={f} view={view} place={places.get(f.id) ?? 0} hit={hit && hit.id > mem.base ? hit : undefined}/>; })}</ol>
  </div>;
}
