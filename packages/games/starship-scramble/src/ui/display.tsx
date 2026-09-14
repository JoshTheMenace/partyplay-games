import { useEffect, useRef } from 'react';
import type { ClientProps, PublicView } from '../contracts';
import { FleetScene } from '../render/fleet-scene';
import { enemyLabel } from '../render/formation';
import { hullPath } from '../render/hulls';
import { useAudio } from './controller';
import { RouteMap, beaconKind, beaconOptions } from './phases';
import { BETWEEN_BATTLES, OBJECTIVE_LABEL, beaconCode, phaseContext } from './nav';
/** Canvas host. Snapshots feed the scene through a ref so React never redraws the battle; assetsReady fires once from the mount effect. */
export function FleetCanvas({ view, serverNowMs, onReady, compact = false }: { view: PublicView; serverNowMs(): number; onReady?(): void; compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), scene = useRef<FleetScene | null>(null), ready = useRef(onReady); ready.current = onReady;
  useEffect(() => {
    if (!canvas.current) return;
    const fleet = new FleetScene(canvas.current); scene.current = fleet;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => ready.current?.()); }); let second = 0;
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); fleet.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.setView(view, serverNowMs()); }, [view, serverNowMs]);
  return <canvas ref={canvas} className={`ss-canvas ${compact ? 'ss-canvas-compact' : ''}`} role="img" aria-label={`Fleet overview: ${view.ships.filter(s => s.faction === 'allied').length} allied ships, ${view.ships.filter(s => s.faction === 'enemy').length} enemy ships`}/>;
}
export function Display(props: ClientProps) {
  const pub = props.publicView; useAudio(pub, null);
  const ready = useRef(props.assetsReady), fired = useRef(false); ready.current = props.assetsReady;
  const once = () => { if (!fired.current) { fired.current = true; ready.current(); } };
  useEffect(() => { if (pub.phase !== 'combat') once(); }, []);
  return <div className="ss-display" data-phase={pub.phase}>
    <TopStrip view={pub}/>
    {pub.phase === 'combat' ? <div className="ss-battle"><FleetCanvas view={pub} serverNowMs={props.serverNowMs} onReady={once}/>{pub.paused && <PauseOverlay view={pub}/>}</div> : <PhaseScreen view={pub}/>}
    <EmergencyRow view={pub}/>
  </div>;
}
function TopStrip({ view }: { view: PublicView }) {
  const beacon = view.beacons.find(b => b.id === view.currentBeaconId);
  return <header className="ss-top"><span className="ss-top-sector" style={{ ['--chip' as string]: view.sector.color }}><b className="kp-display">Starship Scramble</b><span>{view.sector.name} · sector {view.sector.index}/{view.sector.count}{beacon ? ` · ${beacon.label}` : ''}</span></span>
    <span className="ss-top-phase"><b className="kp-display">{view.phase === 'combat' ? view.objective?.kind === 'escape' && view.objective.deadlineMs !== null ? `Retreat · hold ${Math.max(0, Math.ceil((view.objective.deadlineMs - view.timeMs) / 1000))}s` : view.objective ? OBJECTIVE_LABEL[view.objective.kind] : 'Battle' : view.phase === 'rewards' ? 'Salvage' : view.phase === 'store' ? 'Station' : view.phase === 'route' ? 'Choose a beacon' : view.phase === 'event' ? view.event?.title ?? 'Event' : view.phase === 'hangar' ? 'Hangar' : view.phase === 'assignment' ? 'Crew assignment' : 'Results'}</b>{view.phase === 'combat' && view.objective && <small>{view.objective.description}</small>}</span>
    <span className="ss-top-threat" aria-label={`Pursuit threat ${Math.round(view.threat)}`}><small>Pursuit</small><i style={{ ['--fill' as string]: `${Math.min(100, view.threat)}%` }}/></span></header>;
}
/** Compact banner under the top strip: the fleet stays readable while captains plan. */
function PauseOverlay({ view }: { view: PublicView }) {
  const by = view.captains.find(c => c.id === view.pausedBy), eligible = view.captains.filter(c => c.status !== 'spectator' && c.connected);
  return <div className="ss-pause-banner" role="status"><span className="ss-pause-banner-title"><b className="kp-display">Paused</b><small>{by ? `${by.name} called a tactical pause` : 'Tactical pause'}</small></span><ul>{eligible.map(c => <li key={c.id} style={{ ['--chip' as string]: c.color }} className={c.ready ? 'ss-ready' : ''}><span>{c.name}</span><b>{c.ready ? 'ready' : 'planning'}</b></li>)}</ul></div>;
}
/** One chip per ally with an urgent condition. Overflow collapses into a count instead of a ticker. */
export function EmergencyRow({ view }: { view: PublicView }) {
  const allies = view.ships.filter(s => s.faction === 'allied');
  const chips = allies.flatMap(ship => { const owner = view.captains.find(c => c.id === ship.ownerCaptainId); const alerts = ship.status !== 'active' ? [ship.status === 'destroyed' ? 'Destroyed' : ship.status] : ship.alerts; return alerts.length ? [{ id: ship.id, owner: owner?.name ?? ship.name, color: owner?.color ?? ship.color, text: alerts[0] + (alerts.length > 1 ? ` +${alerts.length - 1}` : '') }] : []; });
  const away = view.captains.filter(c => !c.connected && c.status !== 'spectator');
  return <footer className="ss-emergency" aria-live="polite">{chips.map(chip => <span key={chip.id} className="ss-emergency-chip" style={{ ['--chip' as string]: chip.color }}><b>{chip.owner}</b>{chip.text}</span>)}{away.map(c => <span key={c.id} className="ss-emergency-chip ss-emergency-away"><b>{c.name}</b>reconnecting</span>)}{!chips.length && !away.length && <span className="ss-emergency-quiet">{phaseContext(view).hint}</span>}</footer>;
}
const HULL_NAMES: Record<string, string> = { wayfarer: 'Wayfarer', bulwark: 'Bulwark', longbow: 'Longbow', moth: 'Moth', hearth: 'Hearth', kite: 'Kite', magpie: 'Magpie', cuttlefish: 'Cuttlefish' };
function Roster({ view, big = false }: { view: PublicView; big?: boolean }) {
  return <ul className={`ss-tv-roster ${big ? 'ss-tv-roster-big' : ''}`}>{view.captains.map(c => { const ship = view.ships.find(s => s.id === c.shipId), status = !c.playerId ? 'unclaimed' : !c.connected ? 'reconnecting' : c.status === 'spectator' ? 'spectator' : c.ready ? 'ready' : view.phase === 'hangar' ? 'choosing' : view.phase === 'store' ? 'shopping' : view.phase === 'rewards' ? 'collecting' : 'deciding';
    return <li key={c.id} style={{ ['--chip' as string]: c.color }} className={c.ready ? 'ss-ready' : ''} data-status={status}><svg viewBox="0 0 100 60" aria-hidden="true"><path d={hullPath(ship?.hullId ?? 'wayfarer')} fill={ship?.color ?? '#3a3f5a'} stroke="#05071a" strokeWidth={4} fillRule="evenodd"/></svg>
      <strong>{c.name}</strong><small>{ship ? `${ship.name} · ${HULL_NAMES[ship.hullId] ?? ship.hullId}${ship.status === 'active' ? ` · hull ${Math.round(ship.hull)}/${ship.maxHull}` : ` · ${ship.status}`}` : c.status === 'shipless' ? `${c.crewCount} survivors, no ship` : c.status === 'spectator' ? 'eliminated' : 'no ship yet'}</small>
      <em>{status}</em></li>; })}</ul>;
}
function Departure({ view }: { view: PublicView }) {
  const hulls = view.ships.filter(s => s.faction === 'allied' && s.status === 'active' && s.alerts.includes('Uncrewed'));
  if (!hulls.length || !BETWEEN_BATTLES.includes(view.phase)) return null;
  const leader = view.captains.find(c => c.id === view.leaderCaptainId)?.name ?? 'The leader';
  return <p className="ss-tv-departure" role="status"><b>{hulls.map(s => s.name).join(', ')} {hulls.length > 1 ? 'are' : 'is'} uncrewed.</b> Teleport crew aboard, or {leader} abandons the hull and its cargo before the fleet can jump.</p>;
}
function PhaseScreen({ view }: { view: PublicView }) {
  const captains = view.captains, active = captains.filter(c => c.status !== 'spectator'), ready = active.filter(c => c.ready).length, voted = active.filter(c => c.vote !== null).length;
  const voting = view.phase === 'route' || view.phase === 'event' && !view.event?.resolved && (view.event?.choices.length ?? 0) > 0;
  const head = (title: string, lede: string) => <header className="ss-tv-head"><div><h2 className="kp-display">{title}</h2><p>{lede}</p></div>{voting ? <span className="ss-tv-ready kp-numeral" data-counter="voted">{voted}<small>/{active.length} voted</small></span> : view.phase === 'event' || view.phase === 'results' ? null : <span className="ss-tv-ready kp-numeral" data-counter="ready">{ready}<small>/{active.length} ready</small></span>}</header>;
  if (view.phase === 'hangar' || view.phase === 'assignment') return <section className="ss-tv-phase">{head(view.phase === 'hangar' ? 'Choose your ships' : 'Claim your saved captains', view.phase === 'hangar' ? 'Pick a hull, a name and a paint on your phone, then mark ready.' : 'Tap your saved captain on your phone. Lost ships and eliminated seats stay visible.')}<Roster view={view} big/></section>;
  if (view.phase === 'route') { const options = beaconOptions(view.beacons, view.currentBeaconId), current = view.beacons.find(b => b.id === view.currentBeaconId); return <section className="ss-tv-phase ss-tv-route">{head('Where next?', current ? `The fleet holds at ${beaconCode(current)} · ${current.label}. ${options.length} beacon${options.length === 1 ? '' : 's'} within jump range.` : `Departure. ${options.length} beacon${options.length === 1 ? '' : 's'} within jump range.`)}
    <div className="ss-tv-route-body"><RouteMap beacons={view.beacons} currentId={view.currentBeaconId} votes={captains} width={720} labels/>
      <ul className="ss-tv-choices ss-tv-choices-row">{options.map(b => { const voters = captains.filter(c => c.vote === b.id); return <li key={b.id} className={`ss-kind-${b.kind} ${voters.length ? 'ss-voted' : ''}`} data-code={beaconCode(b)}><b className="ss-code">{beaconCode(b)}</b><strong>{b.label}</strong><small>{beaconKind(b)}{b.visited ? ' · visited' : ''}</small><span>{voters.map(c => <b key={c.id} style={{ ['--chip' as string]: c.color }}>{c.name}</b>)}{!voters.length && <small>no votes yet</small>}</span></li>; })}</ul></div>
    <Departure view={view}/><Roster view={view}/></section>; }
  if (view.phase === 'event' && view.event) return <section className="ss-tv-phase ss-tv-event">{head(view.event.title, view.sector.name)}<div className={`ss-tv-event-body ${view.event.resolved || !view.event.choices.length ? '' : 'ss-tv-event-split'}`}><p className="ss-tv-text">{view.event.text}</p>{view.event.resolved ? <p className="ss-tv-result">{view.event.result}</p> : <ul className="ss-tv-choices">{view.event.choices.map(ch => <li key={ch.id} className={ch.special ? 'ss-special' : ''}><strong>{ch.special ? '★ ' : ''}{ch.label}</strong><small>{ch.requirement ? (ch.available ? `Using ${ch.requirement}` : `Needs ${ch.requirement}`) : ch.text}</small><span>{captains.filter(c => c.vote === ch.id).map(c => <b key={c.id} style={{ ['--chip' as string]: c.color }}>{c.name}</b>)}</span></li>)}</ul>}</div><Departure view={view}/></section>;
  if (view.phase === 'rewards') return <section className="ss-tv-phase">{head('Salvage', view.loot.length ? 'Tap an item on your phone to take it. First tap wins. Unclaimed items are discarded when the fleet leaves.' : 'Everything has been collected. Extract stranded crew, then mark ready.')}<ul className="ss-tv-loot">{view.loot.map(item => <li key={item.id}><strong>{item.name}</strong><small>{item.kind}</small></li>)}</ul><Departure view={view}/><Roster view={view}/></section>;
  if (view.phase === 'store') return <section className="ss-tv-phase">{head('Station', 'Browse, refit and recruit on your phones. No timer while anyone is still reading.')}<Roster view={view} big/><Departure view={view}/></section>;
  if (view.phase === 'results') return <section className="ss-tv-phase">{head(view.result === 'victory' ? 'Expedition complete' : view.result === 'defeat' ? 'The fleet was lost' : 'Expedition paused', view.message)}<Roster view={view} big/></section>;
  return <section className="ss-tv-phase">{head('Starship Scramble', view.message)}<Roster view={view}/></section>;
}
export { enemyLabel };
