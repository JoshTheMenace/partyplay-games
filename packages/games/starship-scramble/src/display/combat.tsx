import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { overheat, routLine, type CaptainView, type Combat, type PublicView, type ShipView } from '../contracts';
import { weaponDef } from '../defs/catalog';
import { manifest } from '../manifest';
import { useCombatAudio } from '../audio/sfx';
import { BattleRenderer } from '../render/battle';
import { arrivalMs, sceneLayout, type SceneShip } from '../render/scene';
import { KIND_COLORS } from '../render/ship';
import './combat.css';

/** The battle scene canvas (TV owner). Frozen props so the phone's PersonalView can embed it with mouse targeting. Fills its (sized) parent. */
export type CombatSceneProps = {
  view: PublicView; serverNowMs(): number;
  /** Personal view: clicking a room reports it; highlight rooms that are valid targets; show selected crew. */
  onRoomClick?(shipId: string, roomId: string): void; highlight?: readonly { shipId: string; roomIds: readonly string[] }[]; selectedCrew?: readonly string[];
};
const HAZARDS: Record<string, string> = { asteroids: 'Asteroid field', solar: 'Solar flares', 'ion-storm': 'Ion storm', nebula: 'Nebula' };
const OUTCOMES = { victory: ['Victory', 'The squadron is broken'], escaped: ['FTL jump', 'The fleet got away'], defeat: ['Fleet lost', 'Every ship is down'] } as const;
export type Toast = { id: number; text: string };
/** Who paused the battle: the run stores the captain's name (ids also resolve); null after a save loads. */
export const pauser = (view: PublicView) => { const p = view.combat?.pausedBy; return p ? view.captains.find(c => c.id === p || c.playerId === p)?.name ?? p : null; };

/** The message feed and the Flagship's phase banner, shared by the battle scene and the fleet broadcast. */
export function useBattleFeed(view: PublicView) {
  const [toasts, setToasts] = useState<Toast[]>([]), [banner, setBanner] = useState<Toast | null>(null);
  const lastMessage = useRef(view.message), phase = useRef<string | null>(null), nextId = useRef(0), timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms); timers.current.add(id); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const boss = (view.fleet?.ships ?? view.ships).find(s => s.hullId === 'flagship'), now = boss && view.combat ? `${view.combat.id}:${boss.phase}` : null;
    if (phase.current && now && now !== phase.current && boss!.phase > 0) { const b = { id: nextId.current++, text: view.message || 'The Flagship reforms its hull!' }; setBanner(b); later(() => setBanner(x => x === b ? null : x), 4500); }
    phase.current = now;
    if (!view.message || view.message === lastMessage.current) return; lastMessage.current = view.message;
    const toast = { id: nextId.current++, text: view.message }; setToasts(list => [...list.slice(-2), toast]);
    later(() => setToasts(list => list.filter(x => x !== toast)), 5200);
  }, [view]);
  return { toasts, banner };
}

export function CombatScene({ view, onRoomClick, highlight, selectedCrew }: CombatSceneProps) {
  const root = useRef<HTMLDivElement>(null), bg = useRef<HTMLCanvasElement>(null), main = useRef<HTMLCanvasElement>(null), renderer = useRef<BattleRenderer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 }), { toasts, banner } = useBattleFeed(view), [hovering, setHovering] = useState(false);
  const shape = view.ships.map(s => `${s.id}:${s.faction}:${s.slot}:${s.hullId}:${s.phases.length}`).join();
  const scene = useMemo(() => sceneLayout(view, size.w, size.h), [shape, size]);
  useLayoutEffect(() => {
    const r = renderer.current = new BattleRenderer(bg.current!, main.current!, manifest.assetBase), el = root.current!;
    const observer = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; r.resize(w, h); setSize(s => s.w === w && s.h === h ? s : { w, h }); });
    observer.observe(el); return () => { observer.disconnect(); r.dispose(); renderer.current = null; };
  }, []);
  useEffect(() => { renderer.current?.set({ view, scene, highlight, selectedCrew }); });
  useCombatAudio(view); // one scene per device (TV display or host PersonalView), so every cue plays exactly once
  const pick = (e: { clientX: number; clientY: number }) => { const r = renderer.current, box = root.current!.getBoundingClientRect(); return r?.pick(e.clientX - box.left, e.clientY - box.top) ?? null; };
  const combat = view.combat, captains = new Map(view.captains.map(c => [c.id, c]));
  return <div ref={root} className={`ss-combat-scene${combat?.paused ? ' is-paused' : ''}${hovering ? ' is-pointing' : ''}`} style={{ '--u': `${scene.ui}px` } as CSSProperties}
    onPointerMove={onRoomClick && (e => { const hit = pick(e); if (renderer.current) renderer.current.hover = hit; setHovering(!!hit); })}
    onPointerLeave={onRoomClick && (() => { if (renderer.current) renderer.current.hover = null; setHovering(false); })}
    onClick={onRoomClick && (e => { const hit = pick(e); if (hit) onRoomClick(hit.shipId, hit.roomId); })}>
    <canvas ref={bg} className="ss-scene__layer" aria-hidden/>
    <canvas ref={main} className="ss-scene__layer" aria-hidden/>
    {combat && <Header view={view} combat={combat}/>}
    {combat && view.ships.map(ship => scene.ships[ship.id] && <Plate key={ship.id} ship={ship} at={scene.ships[ship.id]} captain={ship.captainId ? captains.get(ship.captainId) : undefined} t={combat.t} hidden={combat.t < arrivalMs(combat, ship)}/>)}
    {combat && <Callout view={view} combat={combat} banner={banner}/>}
    <div className="ss-feed" aria-live="polite">{toasts.map(t => <div key={t.id} className="ss-feed__item">{t.text}</div>)}</div>
  </div>;
}

/** Sector, objective and the fleet's meters. A fleet of several wings (view.fleet) also shows how many of its ships still fly against the line where it breaks. */
export function Header({ view, combat }: { view: PublicView; combat: Combat }) {
  const all = view.fleet?.ships ?? view.ships, foes = all.filter(s => s.faction === 'enemy'), alive = foes.filter(s => s.status === 'active').length, boss = foes.find(s => s.hullId === 'flagship');
  const objective = combat.objective === 'boss' && boss ? `Destroy the ${boss.name} · phase ${boss.phase + 1} of ${(typeof boss.phases === 'number' ? boss.phases : boss.phases.length) || 1}`
    : combat.objective === 'survive' && combat.surviveUntilMs !== null ? `Survive the onslaught · ${Math.max(0, Math.ceil((combat.surviveUntilMs - combat.t) / 1000))}s`
    : `Destroy the squadron${view.fleet ? 's' : ''} · ${alive} of ${foes.length} left`;
  const voters = view.captains.filter(c => c.connected).length, ready = combat.ftl >= 1, heat = overheat(combat);
  const fleet = view.fleet?.ships.filter(s => s.faction === 'ally'), flying = fleet?.filter(s => s.status === 'active').length ?? 0, line = fleet ? routLine(fleet.length) : 0;
  return <header className="ss-hud">
    <div className="ss-hud__where"><span className="ss-hud__sector">{view.map.name}</span><span className="ss-hud__objective">{objective}</span></div>
    {fleet && <div className={`ss-strength${flying <= line + Math.ceil(fleet.length / 8) ? ' is-low' : ''}`} aria-label={`${flying} of ${fleet.length} ships flying; the fleet breaks at ${line}`}>
      <span className="ss-strength__label">Fleet <b>{flying}</b>/{fleet.length} flying</span>
      <span className="ss-strength__bar"><i style={{ width: `${flying / fleet.length * 100}%` }}/><em style={{ left: `${line / fleet.length * 100}%` }}/></span>
      <span className="ss-strength__note">breaks at {line}</span></div>}
    {combat.paused && <div className="ss-hud__pause">{pauser(view) ? `Paused by ${pauser(view)}` : 'Paused'}</div>}
    <div className="ss-hud__side">
      {combat.hazard !== 'none' && <span className="ss-hud__chip">{HAZARDS[combat.hazard]}</span>}
      {heat > 0 && <span className="ss-hud__chip ss-hud__heat" style={{ '--heat': heat } as CSSProperties}>{heat < 1 ? `Shields overheating · ${Math.round(heat * 100)}%` : 'Shields burnt out'}</span>}
      {combat.objective !== 'boss' && <div className={`ss-ftl${ready ? ' is-ready' : ''}`}>
        <span className="ss-ftl__label">{ready ? `FTL ready — vote to jump · ${combat.jumpVotes.length}/${voters}` : 'FTL drive'}</span>
        <span className="ss-ftl__bar"><i style={{ width: `${Math.round(Math.min(1, combat.ftl) * 100)}%` }}/></span>
      </div>}
    </div>
  </header>;
}

function Plate({ ship, at, captain, t, hidden }: { ship: ShipView; at: SceneShip; captain?: CaptainView; t: number; hidden: boolean }) {
  const ally = ship.faction === 'ally', frac = Math.max(0, ship.hull / Math.max(1, ship.maxHull)), gone = ship.status !== 'active';
  const flee = ship.fleeAtMs !== null && !gone ? Math.max(0, Math.ceil((ship.fleeAtMs - t) / 1000)) : null;
  const style = { left: at.plate.x, top: at.plate.y, width: at.plate.w, '--c': ally ? captain?.color ?? ship.paint : '#ff5d5d', '--n': Math.max(1, ship.maxHull),
    '--hc': frac > .5 ? 'var(--kp-lime)' : frac > .25 ? 'var(--kp-sun)' : 'var(--kp-coral)' } as CSSProperties;
  return <div className={`ss-plate ${ally ? 'is-ally' : 'is-enemy'}${gone ? ' is-gone' : ''}${hidden ? ' is-hidden' : ''}${!gone && ally && frac <= .25 ? ' is-critical' : ''}`} style={style}>
    <div className="ss-plate__top"><span className="ss-plate__name">{ship.name}</span>
      {flee !== null ? <span className="ss-plate__flee">Jumping {flee}s</span> : !gone && <span className="ss-plate__ev">EV {Math.round(ship.evasion)}%</span>}</div>
    {gone ? <div className="ss-plate__gone">{ship.status === 'fled' ? 'Escaped' : 'Destroyed'}</div> : <>
      <div className="ss-plate__hull"><span className="ss-hull"><em style={{ width: `${frac * 100}%` }}/><i style={{ width: `${frac * 100}%` }}/></span>
        <b className="ss-plate__num">{Math.max(0, ship.hull)}<small>/{ship.maxHull}</small></b></div>
      <div className="ss-plate__row">
        <span className="ss-pips" aria-label={`${ship.shields} shield layers`}>
          {Array.from({ length: Math.max(ship.maxShields, ship.shields) }, (_, i) => <i key={i} className={i < ship.shields ? 'is-on' : ''}/>)}
          {ship.tempShield > 0 && <i className="is-temp"/>}
        </span>
        <span className="ss-guns">{ship.weapons.map(w => { const kind = weaponDef(w.defId).kind;
          return <i key={w.uid} className={`${w.powered ? '' : 'is-off'}${w.charge >= 1 && w.powered ? ' is-ready' : ''}`} style={{ '--k': KIND_COLORS[kind], '--f': w.powered ? Math.min(1, w.charge) : 0 } as CSSProperties}/>; })}</span>
      </div>
    </>}
  </div>;
}

export function Callout({ view, combat, banner }: { view: PublicView; combat: Combat; banner: Toast | null }) {
  const all = view.fleet?.ships ?? view.ships, boss = all.find(s => s.faction === 'enemy' && s.hullId === 'flagship'), [title, sub] = combat.outcome ? view.fleet && combat.outcome === 'defeat' ? ['Fleet broken', 'Too few ships are left to hold the line'] as const : OUTCOMES[combat.outcome]
    : banner ? ['Flagship phase shift', banner.text] : combat.t < combat.introUntilMs ? [boss ? boss.name : 'Battle stations', boss ? 'Break the Armada' : `${all.filter(s => s.faction === 'enemy').length} hostiles inbound · ${view.map.name}`] : [null, null];
  return title ? <div key={`${title}${banner?.id ?? ''}`} className={`ss-callout${combat.outcome ? ` is-${combat.outcome}` : ''}`}><strong>{title}</strong><span>{sub}</span></div> : null;
}
