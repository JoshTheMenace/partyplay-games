import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionResult } from '../../../../party-contract/src/index';
import { ArcadeButton, HoldButton, Panel, StatusNotice, SteerPad } from '../../../../party-ui/src/index';
import type { Action, ClientProps, Crew, InteriorView, ShipSummary } from '../contracts';
import { systems as SYSTEM_DEFS } from '../definitions/presentation/index';
import { CrewPortrait, SpeciesSelect } from './crew';
import { speciesFor } from '../definitions/presentation/species';
import { StarshipAudio } from '../render/audio';
import { hullPath } from '../render/hulls';
import { Interior, SYSTEM_GLYPH, crewSummary, effectiveTier, roomStatus, roomTitle } from './interior';
import { BASIC_SYSTEMS, HOSTILE_DRONES, HOSTILE_SYSTEMS, SELF_SYSTEMS, BETWEEN_BATTLES, bareName, carriedDrones, crewLocation, crewShips, defaultShip, initial, legalTargets, nextRequestId, ownShipId, present, reconcile, reduce, seconds, shipLabel, SIM_PHASES, transporterFor, uncrewedAllies, upgradeCost, type Command, type Local, type Nav, type Step, type Tool, type World } from './nav';
import { Assignment, EventPanel, Hangar, LootPanel, ResultsPanel, RoutePanel, StorePanel } from './phases';
export type Submit = (action: Command, options?: { after?: 'return' | 'stay' | Nav; success?: string }) => Promise<ActionResult>;
export type Menu = 'none' | 'main' | 'ships' | 'crew' | 'phase';
export type Screen = { props: ControllerProps; world: World; local: Local; dispatch(step: Step): void; submit: Submit; captainId: string; own: string | null; audio: StarshipAudio; openMenu(menu: Menu): void; closeDrawer(): void; setAim(aim: boolean): void };
export type ControllerProps = ClientProps & { fleet?: () => void; initialMenu?: Menu; initialPreview?: string };
/** Phone controller entry. Phases before the fleet exists get their own full screens; everything else shares the ship-first captain screen. */
export function Controller(props: ControllerProps) {
  const { publicView: pub, privateView: priv } = props;
  if (!priv) return <Panel className="ss-wait"><StatusNotice>Reconnecting to the fleet…</StatusNotice></Panel>;
  if (pub.assignment || pub.phase === 'assignment') return <Assignment props={props}/>;
  if (!priv.captain || !priv.captainId) return <Panel className="ss-wait"><StatusNotice>This expedition has no captain seat for you yet. Wait for the fleet to reach a safe phase.</StatusNotice></Panel>;
  if (pub.phase === 'hangar') return <Hangar props={props} initialPreview={props.initialPreview}/>;
  if (pub.phase === 'results') return <ResultsPanel props={props}/>;
  return <CaptainScreen props={props}/>;
}
export function useAudio(view: World['publicView'], ownShip: string | null) {
  const audio = useRef<StarshipAudio | null>(null);
  useEffect(() => { audio.current = new StarshipAudio(); return () => { audio.current?.dispose(); audio.current = null; }; }, []);
  useEffect(() => { audio.current?.update(view, ownShip); }, [view, ownShip]);
  return audio;
}
export function CaptainScreen({ props }: { props: ControllerProps }) {
  const world: World = { publicView: props.publicView, privateView: props.privateView! }, captainId = world.privateView.captainId!, own = ownShipId(world), phase = world.publicView.phase;
  const [local, setLocal] = useState<Local>(() => initial(defaultShip(world)));
  const [menu, setMenu] = useState<Menu>(() => props.initialMenu ?? (BETWEEN_BATTLES.includes(phase) ? 'phase' : 'none'));
  const [aim, setAim] = useState(false);
  const dispatch = (step: Step) => setLocal(current => reduce(current, step));
  const latest = useRef({ local, world, menu }); latest.current = { local, world, menu };
  useEffect(() => { setLocal(current => reconcile(current, world, Date.now())); }, [world.publicView, world.privateView]);
  // A new fleet phase announces itself by opening its drawer once; combat closes it so the ship is unobstructed.
  const seenPhase = useRef(phase);
  useEffect(() => { if (seenPhase.current === phase) return; seenPhase.current = phase; setMenu(BETWEEN_BATTLES.includes(phase) ? 'phase' : 'none'); }, [phase]);
  useEffect(() => { if (local.nav.kind !== 'teleport') setAim(false); }, [local.nav.kind]);
  const audioRef = useAudio(world.publicView, own), audio = audioRef.current ?? new StarshipAudio();
  const submit: Submit = async (action, options = {}) => {
    const at = latest.current.local.epoch; dispatch({ type: 'sent' });
    let result: ActionResult;
    try { result = await props.sendAction({ epoch: latest.current.world.publicView.epoch, ...action } as Action); } catch (error) { result = { accepted: false, reason: error instanceof Error ? error.message : 'The order was lost. Try again.' }; }
    dispatch({ type: 'ack', ack: { at, accepted: result.accepted, reason: result.reason, after: options.after, success: options.success, now: Date.now() } });
    audioRef.current?.play(result.accepted ? 'accept' : 'deny');
    return result;
  };
  /** Any menu dismisses direct control first, so a held stick never keeps a crew walking behind a drawer. */
  const openMenu = (next: Menu) => { if (latest.current.local.nav.kind === 'control') { props.releaseInput?.(); void submit({ type: 'controlCrew', crewId: null }, { after: { kind: 'interior' } }); } setMenu(next); };
  const closeDrawer = () => { setMenu('none'); const nav = latest.current.local.nav.kind; if (nav === 'room' || nav === 'weapons' || nav === 'targets' || nav === 'teleport') dispatch({ type: 'open', nav: { kind: 'interior' } }); };
  // Inspection: one coalesced request per deliberate ship switch. Ids seed from the server's latest so a reload never sends an id it already rejected.
  const inspected = world.privateView.inspectedShipId, requestRef = useRef(0);
  useEffect(() => {
    const viewed = local.viewedShipId; if (!viewed || viewed === own || inspected === viewed) return;
    const timer = setTimeout(() => { const requestId = nextRequestId(requestRef.current, latest.current.world.privateView.viewRequestId); requestRef.current = requestId; props.sendAction({ epoch: latest.current.world.publicView.epoch, type: 'inspectShip', shipId: viewed, requestId }).catch(() => {}); }, 150);
    return () => clearTimeout(timer);
  }, [local.viewedShipId, own, inspected, world.publicView.epoch]);
  // Keyboard for the playing host: Escape closes a drawer, then steps back; P pauses or readies. Movement keys belong to the focused SteerPad.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return;
      const { local, world, menu } = latest.current;
      if (event.key === 'Escape') { if (menu !== 'none' || event.defaultPrevented) return; event.preventDefault(); if (local.nav.kind !== 'interior') dispatch({ type: 'back' }); }
      else if (event.key.toLowerCase() === 'p' && world.publicView.phase === 'combat' && world.privateView.canAct) { event.preventDefault(); void submit(world.publicView.paused ? { type: 'resume', force: false } : { type: 'pause' }, { after: 'stay' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const screen: Screen = { props, world, local, dispatch, submit, captainId, own, audio, openMenu, closeDrawer, setAim };
  const interior = local.viewedShipId === own ? world.privateView.ownShip : inspected === local.viewedShipId ? world.privateView.inspectedShip : null;
  const viewedSummary = world.publicView.ships.find(s => s.id === local.viewedShipId) ?? null;
  const spectator = world.privateView.captain?.status === 'spectator' || !world.privateView.canAct;
  const nav = local.nav, drawer: 'room' | 'weapons' | 'teleport' | Menu | null = menu !== 'none' ? menu : nav.kind === 'room' ? 'room' : nav.kind === 'weapons' || nav.kind === 'targets' ? 'weapons' : nav.kind === 'teleport' && !aim ? 'teleport' : null;
  const aiming = nav.kind === 'systems' || nav.kind === 'crew' || (nav.kind === 'teleport' && aim);
  return <div className={`ss-captain ${nav.kind === 'control' ? 'ss-captain-control' : ''} ${aiming ? 'ss-captain-aiming' : ''}`} data-nav={nav.kind} data-viewed={local.viewedShipId ?? ''} data-epoch={local.epoch} data-menu={drawer ?? 'none'} data-aiming={aiming}>
    <Hud screen={screen} interior={interior} spectator={spectator}/>
    <section className="ss-stage" aria-label="Ship cutaway">
      {interior ? <Stage screen={screen} interior={interior} aim={aim}/> : viewedSummary ? <Scanning ship={viewedSummary} world={world}/> : <Panel className="ss-wait"><StatusNotice>No vessel to show.</StatusNotice></Panel>}
      {local.notice && <div className={`ss-toast ss-toast-${local.notice.tone}`} role={local.notice.tone === 'error' ? 'alert' : 'status'}>{local.notice.text}</div>}
    </section>
    {nav.kind === 'control' ? <DirectControl screen={screen}/> : aiming ? <AimDock screen={screen} interior={interior}/> : <Dock screen={screen} spectator={spectator}/>}
    {drawer === 'ships' && <Drawer title="Ships" onClose={() => setMenu('none')}><ShipList screen={screen} onPicked={() => setMenu('none')}/></Drawer>}
    {drawer === 'room' && interior && nav.kind === 'room' && <Drawer title={roomTitle(interior.rooms.find(r => r.id === nav.roomId) ?? { name: 'Room' })} onClose={closeDrawer}><RoomPanel screen={screen} interior={interior} roomId={nav.roomId}/></Drawer>}
    {drawer === 'weapons' && <Drawer title={nav.kind === 'targets' ? 'Choose a vessel' : 'Weapons and systems'} onClose={closeDrawer}>{nav.kind === 'targets' ? <TargetsPanel screen={screen} tool={nav.tool}/> : <WeaponsPanel screen={screen}/>}</Drawer>}
    {drawer === 'crew' && <Drawer title="Your crew" onClose={() => setMenu('none')}><CrewList screen={screen}/></Drawer>}
    {drawer === 'teleport' && nav.kind === 'teleport' && <Drawer title="Teleporter" onClose={closeDrawer}><TeleportPanel screen={screen} nav={nav}/></Drawer>}
    {drawer === 'phase' && <Drawer title={phaseTitle(phase)} onClose={() => setMenu('none')} size={phase === 'route' ? 'full' : 'wide'}><PhaseDrawer screen={screen} spectator={spectator}/></Drawer>}
    {drawer === 'main' && <Drawer title="Captain’s menu" onClose={() => setMenu('none')}><MainMenu screen={screen} interior={interior} spectator={spectator}/></Drawer>}
  </div>;
}
const phaseTitle = (phase: World['publicView']['phase']) => phase === 'rewards' ? 'Salvage' : phase === 'store' ? 'Station' : phase === 'route' ? 'Route' : phase === 'event' ? 'Encounter' : 'Fleet';
/** Shared keyboard containment for every overlay: Escape dismisses even from inputs, Tab and Shift+Tab cycle inside the overlay so nothing behind receives keys. */
export function containKeys(event: { key: string; shiftKey: boolean; currentTarget: HTMLElement; preventDefault(): void; stopPropagation(): void }, onClose: () => void) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
  if (event.key !== 'Tab') return;
  const root = event.currentTarget, tabbable = [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
  const first = tabbable[0], last = tabbable.at(-1), active = document.activeElement as HTMLElement | null;
  if (!first || !last) { event.preventDefault(); root.focus(); return; }
  if (event.shiftKey && (active === first || !tabbable.includes(active!) )) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !tabbable.includes(active!))) { event.preventDefault(); first.focus(); }
}
/** Right-side modal drawer: closes on backdrop, close button or Escape; Tab stays inside; focus moves in and is restored on close. Only present while open, so rooms stay tappable otherwise. */
export function Drawer({ title, onClose, children, size = 'normal' }: { title: string; onClose(): void; children: ReactNode; size?: 'normal' | 'wide' | 'full' }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <div className="ss-drawer-root"><div className="ss-drawer-backdrop" onClick={onClose} aria-hidden="true"/>
    <section ref={ref} className={`ss-drawer ss-drawer-${size}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-drawer={title} onKeyDown={event => containKeys(event, onClose)}>
      <header className="ss-drawer-head"><strong>{title}</strong><button type="button" className="ss-icon-button" onClick={onClose} aria-label={`Close ${title}`}>✕</button></header>
      <div className="ss-drawer-body">{children}</div>
    </section></div>;
}
function Hud({ screen, interior, spectator }: { screen: Screen; interior: InteriorView | null; spectator: boolean }) {
  const { world, local, submit, captainId, openMenu, own } = screen, pub = world.publicView, ship = interior?.ship ?? pub.ships.find(s => s.id === local.viewedShipId) ?? null, ships = pub.ships;
  const me = pub.captains.find(c => c.id === captainId), combat = pub.phase === 'combat', eligible = pub.captains.filter(c => c.status !== 'spectator' && c.connected), solo = eligible.length <= 1;
  const stranded = world.privateView.crew.some(c => c.status === 'alive' && ships.find(s => s.id === c.currentShipId)?.faction === 'enemy'), uncrewed = uncrewedAllies(world).length > 0, attention = BETWEEN_BATTLES.includes(pub.phase) && (stranded || uncrewed);
  const label = ship ? shipLabel(ship, ships) : 'No vessel', sub = !ship ? '' : ship.id === own ? pub.phase === 'store' ? 'tap a room to upgrade' : 'your ship' : ship.faction === 'enemy' ? bareName(ship) : `${pub.captains.find(c => c.id === ship.ownerCaptainId)?.name ?? 'ally'}’s ship · your crew only`;
  return <header className="ss-hud">
    <button type="button" className="ss-hud-ship" onClick={() => openMenu('ships')} aria-label={`Ships. Viewing ${ship?.id === own ? 'own ship ' : ''}${label}${ship && ship.id !== own ? ` ${bareName(ship)}` : ''}. Open the ship list.`} style={{ ['--chip' as string]: ship?.faction === 'enemy' ? '#ff5748' : ship?.color ?? '#a9b3e6' }}>
      {ship && <svg viewBox="0 0 100 60" className="ss-hud-hull" aria-hidden="true"><path d={hullPath(ship.hullId)} fill={ship.faction === 'enemy' ? '#b2542f' : ship.color} stroke="#05071a" strokeWidth={4} fillRule="evenodd"/></svg>}
      <span className="ss-hud-name"><strong>{ship?.id === own ? 'Own ship' : label}</strong><small>{!own && world.privateView.captain?.status === 'shipless' ? 'My survivors · ' : ''}{sub}</small></span>
      {ship && <span className="ss-hud-vitals" aria-hidden="true"><i className="ss-hud-hullbar" style={{ ['--fill' as string]: `${Math.max(0, ship.hull / ship.maxHull) * 100}%` }}/><b>{Array.from({ length: Math.max(1, Math.min(6, Math.ceil(ship.shield))) }, (_, i) => <i key={i} className={i < Math.floor(ship.shield) ? 'ss-pip-on' : ''}/>)}</b>{interior && ship.id === own && <small>ammo {interior.ammo}</small>}</span>}
      <span className="ss-hud-caret" aria-hidden="true">▾</span>
    </button>
    <div className="ss-hud-alerts" aria-live="polite">{spectator && <span className="ss-hud-alert ss-hud-spectating">Spectating</span>}{ship && ship.alerts.length > 0 && <button type="button" className="ss-hud-alert" onClick={() => openMenu('main')} aria-label={`Alerts: ${ship.alerts.join(', ')}. Open the menu for details.`}>{ship.alerts[0]}{ship.alerts.length > 1 ? ` +${ship.alerts.length - 1}` : ''}</button>}</div>
    <div className="ss-hud-actions">
      {combat && !spectator && (pub.paused
        ? <ArcadeButton tone={me?.ready ? 'lime' : 'sun'} size="sm" onClick={() => submit({ type: 'resume', force: false }, { after: 'stay' })} aria-pressed={me?.ready} aria-label={solo ? 'Resume the battle' : me?.ready ? `Ready to resume, waiting for ${eligible.filter(c => !c.ready).length} more` : 'Ready to resume'}>{solo ? 'Resume' : me?.ready ? `Ready ${eligible.filter(c => c.ready).length}/${eligible.length}` : 'Ready to resume'}</ArcadeButton>
        : <ArcadeButton tone="sky" size="sm" onClick={() => submit({ type: 'pause' }, { after: 'stay' })}>Pause</ArcadeButton>)}
      {combat && pub.paused && <span className="ss-hud-paused" aria-hidden="true">⏸</span>}
      {!combat && <button type="button" className={`ss-hud-phase ${attention ? 'ss-attention' : ''}`} onClick={() => openMenu('phase')} aria-label={`${phaseTitle(pub.phase)}${attention ? ', needs attention' : ''}. Open the ${phaseTitle(pub.phase).toLowerCase()} panel.`}>{phaseTitle(pub.phase)}{attention && <i aria-hidden="true"/>}</button>}
      <button type="button" className="ss-icon-button" onClick={() => openMenu('main')} aria-label="Captain’s menu">☰</button>
    </div>
  </header>;
}
function Dock({ screen, spectator }: { screen: Screen; spectator: boolean }) {
  const { world, dispatch, openMenu, props, own } = screen, crew = world.privateView.crew.filter(c => c.status === 'alive');
  return <nav className="ss-dock" aria-label="Captain controls">
    {!spectator && own && <button type="button" className="ss-dock-button" onClick={() => dispatch({ type: 'open', nav: { kind: 'weapons' } })} aria-label="Weapons and systems"><b>⌖</b><small>Arms</small></button>}
    {!spectator && crew.length > 0 && <button type="button" className="ss-dock-button" onClick={() => openMenu('crew')} aria-label={`Your crew, ${crew.length} alive`}><b>{crew.length}</b><small>Crew</small></button>}
    {props.fleet && <button type="button" className="ss-dock-button" onClick={() => { openMenu('none'); props.fleet?.(); }} aria-label="Fleet overview"><b>◎</b><small>Fleet</small></button>}
  </nav>;
}
function Scanning({ ship, world }: { ship: ShipSummary; world: World }) {
  return <Panel className="ss-scanning" role="status"><span className="kp-eyebrow">Scanning {shipLabel(ship, world.publicView.ships)}</span><strong>{bareName(ship)}</strong><p>Hull {Math.round(ship.hull)}/{ship.maxHull} · Shields {Math.floor(ship.shield)} · {ship.crewCount} crew</p><ul>{ship.rooms.map(room => <li key={room.id}>{room.name}{room.system ? ` · ${SYSTEM_GLYPH[room.system]}` : ''}</li>)}</ul></Panel>;
}
/** Ship list drawer with the same identities as the TV: own ship first, then allies, then E1..En. In targeting or teleport modes a pick becomes the destination. */
function ShipList({ screen, onPicked }: { screen: Screen; onPicked(): void }) {
  const { world, local, dispatch, own, setAim } = screen, ships = world.publicView.ships, ordered = [...ships.filter(s => s.id === own), ...ships.filter(s => s.faction === 'allied' && s.id !== own).sort((a, b) => a.formation - b.formation), ...ships.filter(s => s.faction === 'enemy').sort((a, b) => a.formation - b.formation)];
  const mine = (id: string) => world.privateView.crew.filter(c => c.status === 'alive' && c.currentShipId === id).length;
  const targets = local.nav.kind === 'targets' ? new Set(legalTargets(local.nav.tool, world).map(s => s.id)) : null;
  const pick = (ship: ShipSummary) => {
    if (local.nav.kind === 'targets' && targets?.has(ship.id)) dispatch({ type: 'open', nav: { kind: 'systems', tool: local.nav.tool, targetShipId: ship.id } });
    else if (local.nav.kind === 'teleport') { dispatch({ type: 'view', shipId: ship.id }); dispatch({ type: 'open', nav: { ...local.nav, targetShipId: ship.id } }); setAim(true); }
    else dispatch({ type: 'view', shipId: ship.id });
    onPicked();
  };
  const survivors = !own && crewShips(world).length > 0;
  return <ul className="ss-ship-list">
    {survivors && <li><button type="button" className={`ss-chip ss-chip-own ${local.viewedShipId === crewShips(world)[0]?.id ? 'ss-chip-active' : ''}`} onClick={() => { dispatch({ type: 'view', shipId: crewShips(world)[0].id }); onPicked(); }}><strong>My survivors</strong><small>{world.privateView.crew.filter(c => c.status === 'alive').length} crew · your ship was lost</small></button></li>}
    {ordered.map(ship => { const label = shipLabel(ship, ships), gone = !present(ship), count = mine(ship.id), isOwn = ship.id === own, legal = targets ? targets.has(ship.id) : true;
      return <li key={ship.id}><button type="button" className={`ss-chip ${isOwn ? 'ss-chip-own' : ship.faction === 'enemy' ? 'ss-chip-enemy' : 'ss-chip-ally'} ${local.viewedShipId === ship.id ? 'ss-chip-active' : ''} ${gone ? 'ss-chip-gone' : ''}`} disabled={gone || !legal} onClick={() => pick(ship)} style={{ ['--chip' as string]: ship.faction === 'enemy' ? '#ff5748' : ship.color }}
        aria-label={`${isOwn ? 'Own ship ' : ''}${label}${ship.faction === 'enemy' ? ` ${bareName(ship)}` : ''}. Hull ${Math.round(ship.hull)} of ${ship.maxHull}. ${count ? `${count} of your crew aboard. ` : ''}${ship.alerts.join(', ')}${gone ? `. ${ship.status}` : ''}`}>
        <svg viewBox="0 0 100 60" className="ss-chip-hull" aria-hidden="true"><path d={hullPath(ship.hullId)} fill={gone ? '#3a3f5a' : ship.faction === 'enemy' ? '#b2542f' : ship.color} stroke="#05071a" strokeWidth={4} fillRule="evenodd" transform={ship.faction === 'enemy' ? 'translate(100 0) scale(-1 1)' : undefined}/></svg>
        <strong>{isOwn ? 'Own ship' : label}</strong><small>{ship.faction === 'enemy' ? bareName(ship) : ship.name} · hull {Math.round(ship.hull)}/{ship.maxHull}{count ? ` · ${count} of yours aboard` : ''}{gone ? ` · ${ship.status}` : ship.alerts.length ? ` · ${ship.alerts.join(', ')}` : ''}</small>
        {!gone && <i className="ss-chip-hull-bar" style={{ ['--fill' as string]: `${Math.max(0, ship.hull / ship.maxHull) * 100}%` }}/>}
      </button></li>; })}
  </ul>;
}
function Stage({ screen, interior, aim }: { screen: Screen; interior: InteriorView; aim: boolean }) {
  const { world, local, dispatch, submit, captainId, own } = screen, nav = local.nav, ships = world.publicView.ships, label = shipLabel(interior.ship, ships), timeMs = world.publicView.timeMs;
  const store = world.publicView.phase === 'store', ownView = interior.ship.id === own;
  const onRoom = (roomId: string) => {
    const room = interior.rooms.find(r => r.id === roomId)!;
    if (nav.kind === 'systems' && nav.targetShipId === interior.ship.id) return void fire(nav.tool, interior.ship.id, roomId, screen);
    if (nav.kind === 'teleport' && aim) {
      if (!nav.crewIds.length) return dispatch({ type: 'notice', notice: { text: 'Choose crew to transport first.', tone: 'info', at: Date.now() } });
      const transporter = transporterFor(nav.crewIds, world, own, interior.ship.id); if (!transporter) return dispatch({ type: 'notice', notice: { text: 'No allied teleporter can reach that crew. Choose a destination with a working teleporter.', tone: 'error', at: Date.now() } });
      return void submit({ type: 'teleportCrew', crewIds: nav.crewIds, transporterShipId: transporter, targetShipId: interior.ship.id, roomId }, { after: { kind: 'interior' }, success: `Crew arriving in ${roomTitle(room)}` });
    }
    if (nav.kind === 'crew') return void submit({ type: 'orderCrew', crewId: nav.crewId, roomId, order: nav.order }, { after: 'stay', success: `${nav.order} order sent to ${roomTitle(room)}` });
    dispatch({ type: 'open', nav: { kind: 'room', roomId } });
  };
  const highlight = nav.kind === 'room' ? nav.roomId : nav.kind === 'crew' ? world.privateView.crew.find(c => c.id === nav.crewId)?.roomId ?? null : null;
  const roomLabel = nav.kind === 'systems' ? (room: typeof interior.rooms[number]) => `Target ${roomTitle(room)} on ${label}. ${roomStatus(room, timeMs)}` : undefined;
  void store; void ownView;
  return <Interior view={interior} world={world} captainId={captainId} onRoom={onRoom} highlightRoomId={highlight} selectedCrewId={nav.kind === 'crew' || nav.kind === 'control' ? nav.crewId : null} roomLabel={roomLabel} disabled={nav.kind === 'control'}/>;
}
/** While the ship itself is the control surface the dock column widens and holds the pending order, its Cancel, and a small options popup. Nothing is drawn over the rooms. */
function AimDock({ screen, interior }: { screen: Screen; interior: InteriorView | null }) {
  const { world, local, dispatch, submit, setAim, openMenu } = screen, nav = local.nav, pub = world.publicView;
  const [options, setOptions] = useState(false);
  useEffect(() => { setOptions(false); }, [nav.kind, nav.kind === 'crew' ? nav.crewId : '']);
  const cancel = (label: string, action: () => void) => <button type="button" className="ss-dock-button ss-dock-cancel" onClick={action} aria-label={label}><b>✕</b><small>Cancel</small></button>;
  if (nav.kind === 'systems') return <nav className="ss-dock ss-dock-aim" aria-label="Targeting" role="status"><span className="ss-dock-status"><strong>{toolName(nav.tool, world)}</strong><small>→ {interior ? shipLabel(interior.ship, pub.ships) : 'target'}</small><small>tap a room</small></span>{cancel('Cancel targeting', () => dispatch({ type: 'back' }))}</nav>;
  if (nav.kind === 'teleport') { const dest = pub.ships.find(s => s.id === nav.targetShipId); return <nav className="ss-dock ss-dock-aim" aria-label="Teleport destination" role="status"><span className="ss-dock-status"><strong>Teleport {nav.crewIds.length}</strong><small>→ {dest ? shipLabel(dest, pub.ships) : 'destination'}</small><small>tap a room</small></span><button type="button" className="ss-dock-button" onClick={() => setAim(false)} aria-label="Change crew or destination"><b>⇄</b><small>Change</small></button>{cancel('Cancel teleport', () => dispatch({ type: 'open', nav: { kind: 'interior' } }))}</nav>; }
  if (nav.kind !== 'crew') return null;
  const crew = world.privateView.crew.find(c => c.id === nav.crewId), orders: Crew['order']['kind'][] = ['move', 'repair', 'fight', 'heal', 'hold'], here = crew?.currentShipId === local.viewedShipId, sim = SIM_PHASES.includes(pub.phase);
  if (!crew) return null;
  return <nav className="ss-dock ss-dock-aim" aria-label="Crew order" role="status"><span className="ss-dock-status"><strong>{crew.name}</strong><small>{nav.order}</small><small>{here ? 'tap a room' : 'other ship'}</small></span>
    <button type="button" className={`ss-dock-button ${options ? 'ss-active' : ''}`} onClick={() => setOptions(o => !o)} aria-expanded={options} aria-haspopup="dialog" aria-label={`Order options for ${crew.name}`}><b>⋯</b><small>Options</small></button>
    {cancel('Cancel crew order', () => dispatch({ type: 'back' }))}
    {options && <section className="ss-popover ss-popover-aim" role="dialog" aria-label={`Options for ${crew.name}`} tabIndex={-1} onKeyDown={event => containKeys(event, () => setOptions(false))}><header><strong>{crew.name}</strong><button type="button" className="ss-icon-button" onClick={() => setOptions(false)} aria-label="Close options">✕</button></header>
      <div className="ss-aim-orders" role="radiogroup" aria-label="Order">{orders.map(kind => <button key={kind} type="button" role="radio" aria-checked={nav.order === kind} className={nav.order === kind ? 'ss-active' : ''} onClick={() => { dispatch({ type: 'open', nav: { kind: 'crew', crewId: crew.id, order: kind } }); setOptions(false); }}>{kind}</button>)}</div>
      <div className="ss-inline">{!here && <ArcadeButton tone="ghost" size="sm" onClick={() => { dispatch({ type: 'view', shipId: crew.currentShipId }); setOptions(false); }}>Go to their ship</ArcadeButton>}
        {sim && <ArcadeButton tone="sky" size="sm" onClick={() => { setOptions(false); void submit({ type: 'controlCrew', crewId: crew.id }, { after: { kind: 'control', crewId: crew.id }, success: `Controlling ${crew.name}` }); }} aria-label={`Direct control of ${crew.name}`}>Direct control</ArcadeButton>}
        {sim && <ArcadeButton tone="grape" size="sm" onClick={() => { setOptions(false); dispatch({ type: 'open', nav: { kind: 'teleport', crewIds: [crew.id], targetShipId: null } }); openMenu('none'); }} aria-label={`Teleport ${crew.name}`}>Teleport</ArcadeButton>}</div>
    </section>}
  </nav>;
}
function toolName(tool: Tool, world: World) {
  if (tool.type === 'weapon') return world.privateView.ownShip?.weapons.find(w => w.itemId === tool.weaponId)?.name ?? 'weapon';
  if (tool.type === 'drone') return world.privateView.inventory.find(i => i.id === tool.itemId)?.name ?? 'drone';
  return SYSTEM_DEFS.find(s => s.id === tool.systemId)?.name ?? tool.systemId;
}
function fire(tool: Tool, targetShipId: string, roomId: string, screen: Screen) {
  const name = toolName(tool, screen.world), label = shipLabel(screen.world.publicView.ships.find(s => s.id === targetShipId)!, screen.world.publicView.ships);
  if (tool.type === 'weapon') return screen.submit({ type: 'targetWeapon', weaponId: tool.weaponId, targetShipId, roomId }, { after: 'return', success: `${name} targeting ${label}` });
  if (tool.type === 'drone') return screen.submit({ type: 'deployDrone', itemId: tool.itemId, targetShipId, roomId }, { after: 'return', success: `${name} launched at ${label}` });
  return screen.submit({ type: 'activateSystem', systemId: tool.systemId, targetShipId, roomId }, { after: 'return', success: `${name} active` });
}
export const Back = ({ dispatch, label = 'Back' }: { dispatch(step: Step): void; label?: string }) => <ArcadeButton tone="ghost" size="sm" className="ss-back" onClick={() => dispatch({ type: 'back' })}>{label}</ArcadeButton>;
/** Weapons, active systems and carried drones in one drawer. Only the own ship's equipment is ever listed. */
function WeaponsPanel({ screen }: { screen: Screen }) {
  const { world, dispatch, submit, own } = screen, ownShip = world.privateView.ownShip, pub = world.publicView, combat = pub.phase === 'combat', timeMs = pub.timeMs, drones = carriedDrones(world), deployed = new Set(pub.drones.map(d => d.id));
  if (!ownShip) return <StatusNotice>No ship to arm. Your surviving crew can still be commanded from the crew list.</StatusNotice>;
  return <div className="ss-drawer-stack">
    <span className="kp-eyebrow">Weapons · {ownShip.ship.name} · ammo {ownShip.ammo}</span>
    <ul className="ss-weapons">{ownShip.weapons.map(w => { const target = w.order ? pub.ships.find(s => s.id === w.order!.shipId) : null, room = target?.rooms.find(r => r.id === w.order!.roomId);
      return <li key={w.itemId} className={w.disabled ? 'ss-disabled' : ''}><button type="button" className={`ss-weapon ss-weapon-pip ${w.disabled ? 'ss-disabled' : w.readyInMs === 0 ? 'ss-ready' : ''} ${w.order?.hold ? 'ss-hold' : ''}`} disabled={w.disabled} onClick={() => dispatch({ type: 'open', nav: { kind: 'targets', tool: { type: 'weapon', weaponId: w.itemId, ally: w.target === 'ally' } } })} aria-label={`${w.name}, ${w.family}. ${w.disabled ? 'Offline: weaponry damaged.' : w.readyInMs ? `Ready in ${seconds(w.readyInMs)}` : 'Ready'}. ${target ? `Targeting ${shipLabel(target, pub.ships)} ${room?.name ?? ''}${w.order?.hold ? ', holding fire' : ''}` : 'No target'}. ${w.description}`}>
        <strong>{w.name}</strong><small>{w.family}{w.ammoCost ? ` · ${w.ammoCost} ammo` : ''} · {w.disabled ? 'offline' : w.readyInMs ? `ready in ${seconds(w.readyInMs)}` : 'ready'}</small>
        <progress max={1} value={w.disabled ? 0 : 1 - w.readyInMs / Math.max(1, w.readyInMs + w.chargeMs)} aria-hidden="true"/>
        <em>{target ? `→ ${shipLabel(target, pub.ships)} · ${room?.name ?? ''}${w.order?.hold ? ' · holding' : ''}` : w.target === 'ally' ? 'Choose an ally' : 'Choose a target'}</em></button>
        {w.order && <ArcadeButton tone={w.order.hold ? 'coral' : 'ghost'} size="sm" aria-pressed={w.order.hold} onClick={() => submit({ type: 'holdFire', weaponId: w.itemId, hold: !w.order!.hold }, { after: 'stay' })}>{w.order.hold ? 'Holding' : 'Hold fire'}</ArcadeButton>}</li>; })}
      {!ownShip.weapons.length && <li><small className="ss-muted">No weapons installed.</small></li>}</ul>
    {combat && <><span className="kp-eyebrow">Systems and drones</span><div className="ss-system-grid">{ownShip.systems.filter(s => !BASIC_SYSTEMS.includes(s.id)).map(system => { const def = SYSTEM_DEFS.find(d => d.id === system.id), room = ownShip.rooms.find(r => r.system === system.id), tier = room ? Math.min(system.tier, effectiveTier(room, timeMs)) : system.tier, cooling = Math.max(0, system.cooldownUntilMs - timeMs), active = system.activeUntilMs > timeMs;
      const tool: Tool = { type: 'system', systemId: system.id, ally: !HOSTILE_SYSTEMS.includes(system.id), self: SELF_SYSTEMS.includes(system.id) };
      return <ArcadeButton key={system.id} tone={active ? 'lime' : cooling || !tier ? 'ghost' : 'sky'} size="sm" disabled={!!cooling || !tier} aria-label={`${def?.name ?? system.id}${active ? ', active' : cooling ? `, recharging ${seconds(cooling)}` : !tier ? ', disabled' : ''}`} onClick={() => tool.self ? dispatch({ type: 'open', nav: { kind: 'systems', tool, targetShipId: own! } }) : dispatch({ type: 'open', nav: { kind: 'targets', tool } })}>{def?.name ?? system.id}<small>{active ? 'active' : cooling ? seconds(cooling) : !tier ? 'offline' : `T${tier}`}</small></ArcadeButton>; })}
      {drones.map(({ item, operational }) => <ArcadeButton key={item.id} tone={deployed.has(item.id) ? 'lime' : 'grape'} size="sm" disabled={deployed.has(item.id) || ownShip.ammo < 1 || !operational} aria-label={`${item.name} drone${deployed.has(item.id) ? ', deployed' : !operational ? ', drone bay offline' : ownShip.ammo < 1 ? ', needs ammunition' : ', launch from cargo'}`} onClick={() => dispatch({ type: 'open', nav: { kind: 'targets', tool: { type: 'drone', itemId: item.id, ally: !HOSTILE_DRONES.includes(item.definitionId.replace('drone-', '')) } } })}>{item.name}<small>{deployed.has(item.id) ? 'deployed' : !operational ? 'bay offline' : ownShip.ammo < 1 ? 'no ammo' : 'launch · 1 ammo'}</small></ArcadeButton>)}
      {!ownShip.systems.some(s => !BASIC_SYSTEMS.includes(s.id)) && !drones.length && <small className="ss-muted">No active systems installed.</small>}</div></>}
    <small className="ss-muted">Weapons repeat on their target until it is destroyed or you hold fire. Slots beyond your weaponry tier stay offline.</small></div>;
}
function TargetsPanel({ screen, tool }: { screen: Screen; tool: Tool }) {
  const { world, dispatch } = screen, targets = legalTargets(tool, world), ships = world.publicView.ships;
  return <div className="ss-drawer-stack"><Back dispatch={dispatch}/><span className="kp-eyebrow">{toolName(tool, world)}</span>
    <ul className="ss-targets">{targets.map(ship => <li key={ship.id}><button type="button" onClick={() => dispatch({ type: 'open', nav: { kind: 'systems', tool, targetShipId: ship.id } })}><b style={{ ['--chip' as string]: ship.faction === 'enemy' ? '#ff5748' : ship.color }}>{shipLabel(ship, ships)}</b><span>{bareName(ship)}</span><small>Hull {Math.round(ship.hull)}/{ship.maxHull} · Shields {Math.floor(ship.shield)}</small></button></li>)}{!targets.length && <li><StatusNotice>No legal target right now.</StatusNotice></li>}</ul>
    <small className="ss-muted">Then tap the room to hit. Nothing fires until the server accepts the order.</small></div>;
}
function RoomPanel({ screen, interior, roomId }: { screen: Screen; interior: InteriorView; roomId: string }) {
  const { world, dispatch, submit, captainId, own, closeDrawer } = screen, room = interior.rooms.find(r => r.id === roomId), pub = world.publicView, timeMs = pub.timeMs;
  if (!room) return <StatusNotice>Room unavailable.</StatusNotice>;
  const occupants = interior.crew.filter(c => c.roomId === roomId), mine = occupants.filter(c => c.ownerCaptainId === captainId), others = occupants.filter(c => c.ownerCaptainId !== captainId), ownView = interior.ship.id === own, def = room.system ? SYSTEM_DEFS.find(s => s.id === room.system) : null;
  const doors = ownView && pub.phase === 'combat' && interior.systems.some(s => s.id === 'doors'), upgrade = ownView && pub.phase === 'store' && room.system, mannedBy = room.mannedBy ? interior.crew.find(c => c.id === room.mannedBy) : null;
  const hull = world.privateView.hulls.find(h => h.id === interior.ship.hullId), cap = Math.min(def?.maxTier ?? 0, room.system === 'weaponry' ? hull?.maxWeapons ?? def?.maxTier ?? 0 : Infinity), cost = upgradeCost(room.tier), canAfford = world.privateView.wallet >= cost;
  return <div className="ss-drawer-stack"><span className="kp-eyebrow">{room.system ? SYSTEM_GLYPH[room.system] : 'Bay'} · {shipLabel(interior.ship, pub.ships)}</span><strong>{roomStatus(room, timeMs)}</strong>
    {def && <small className="ss-muted">{def.description}</small>}
    {room.known && mannedBy && <small>Manned by {mannedBy.name}{mannedBy.ownerCaptainId !== interior.ship.ownerCaptainId ? ' (guest)' : ''}</small>}
    {room.known && <small>Oxygen {Math.round(room.oxygen)}% · capacity {room.capacity}</small>}
    {upgrade && (room.tier >= cap ? <small className="ss-muted">{room.system === 'weaponry' && hull && room.tier >= hull.maxWeapons ? `This hull mounts at most ${hull.maxWeapons} weapons.` : 'Maximum tier reached.'}</small>
      : <ArcadeButton tone="lime" size="sm" disabled={!canAfford} onClick={() => submit({ type: 'upgradeRoom', roomId }, { after: 'stay', success: `${roomTitle(room)} upgraded` })}>Upgrade to tier {room.tier + 1}<small>{cost} scrap{canAfford ? '' : ` · you have ${world.privateView.wallet}`}{room.system === 'weaponry' ? ' · unlocks another weapon mount' : ''}</small></ArcadeButton>)}
    {doors && <ArcadeButton tone={room.locked ? 'coral' : 'ghost'} size="sm" aria-pressed={room.locked} onClick={() => submit({ type: 'setDoor', roomId, locked: !room.locked }, { after: 'stay' })}>{room.locked ? 'Unlock doors' : 'Lock doors'}</ArcadeButton>}
    {mine.length > 0 && <><span className="kp-eyebrow">Your crew here</span><ul className="ss-crew-list">{mine.map(c => <li key={c.id}><button type="button" onClick={() => { closeDrawer(); dispatch({ type: 'open', nav: { kind: 'crew', crewId: c.id, order: 'move' } }); }}><strong>{c.name}</strong><small>{crewSummary(c)}</small></button></li>)}</ul></>}
    {others.length > 0 && <><span className="kp-eyebrow">Also here</span><ul className="ss-crew-static">{others.map(c => <li key={c.id}>{c.name} · {c.ownerCaptainId === null ? 'hostile' : pub.captains.find(cap => cap.id === c.ownerCaptainId)?.name ?? 'ally'}{c.ownerCaptainId !== null && c.ownerCaptainId !== captainId ? ' · not yours to command' : ''}</li>)}</ul></>}
    {ownView && pub.phase === 'combat' && !room.system && <small className="ss-muted">Open compartment. Use it to hold boarders away from machinery.</small>}
  </div>;
}
/** Crew drawer: every living owned crew wherever they stand. Tapping one hands the ship over as the order surface. */
function CrewList({ screen }: { screen: Screen }) {
  const { world, dispatch, own, submit, openMenu } = screen, pub = world.publicView, crew = world.privateView.crew.filter(c => c.status === 'alive'), simPhase = SIM_PHASES.includes(pub.phase), combat = pub.phase === 'combat';
  const teleporters = pub.ships.some(s => s.faction === 'allied' && present(s) && s.rooms.some(r => r.system === 'teleporter')), stranded = crew.some(c => pub.ships.find(s => s.id === c.currentShipId)?.faction === 'enemy');
  return <div className="ss-drawer-stack">
    {!own && <StatusNotice>Your ship is gone. Command your crew where they stand; you cannot take an ally’s helm.</StatusNotice>}
    <ul className="ss-crew-list">{crew.map(member => <li key={member.id}><button type="button" onClick={() => { openMenu('none'); dispatch({ type: 'view', shipId: member.currentShipId }); dispatch({ type: 'open', nav: { kind: 'crew', crewId: member.id, order: 'move' } }); }} className="ss-crew-card" aria-label={`${crewSummary(member)} at ${crewLocation(member, world)}`}><CrewPortrait crew={member} ownerColor={world.publicView.captains.find(c=>c.id===member.ownerCaptainId)?.color}/><strong>{member.name} · {speciesFor(member.species).name}</strong><small>{member.skill} · {crewLocation(member, world)} · {Math.round(member.hp)}/{member.maxHp}</small><small className="ss-crew-trait">{speciesFor(member.species).description}</small><i style={{ ['--fill' as string]: `${member.hp / member.maxHp * 100}%` }}/></button></li>)}{!crew.length && <li><small className="ss-muted">No living crew.</small></li>}</ul>
    {simPhase && crew.length > 0 && teleporters && <ArcadeButton tone="grape" size="sm" onClick={() => { dispatch({ type: 'open', nav: { kind: 'teleport', crewIds: [], targetShipId: null } }); openMenu('none'); }}>{own ? 'Teleporter' : 'Request transport'}{stranded && !combat ? <small>extract crew before jumping</small> : null}</ArcadeButton>}
    {stranded && !combat && <ArcadeButton tone="coral" size="sm" onClick={() => submit({ type: 'abandonCrew' }, { after: 'stay' })}>Leave stranded crew behind<small>lost on the next jump</small></ArcadeButton>}
  </div>;
}
function TeleportPanel({ screen, nav }: { screen: Screen; nav: Extract<Nav, { kind: 'teleport' }> }) {
  const { world, dispatch, own, setAim } = screen, crew = world.privateView.crew.filter(c => c.status === 'alive'), pub = world.publicView, transporter = transporterFor(nav.crewIds, world, own, nav.targetShipId), transporterShip = transporter ? pub.ships.find(s => s.id === transporter) : null;
  const destinations = pub.ships.filter(s => present(s) && (s.faction === 'allied' || s.status === 'surrendered' || nav.crewIds.length > 0)), dest = pub.ships.find(s => s.id === nav.targetShipId);
  const toggle = (id: string) => dispatch({ type: 'open', nav: { ...nav, crewIds: nav.crewIds.includes(id) ? nav.crewIds.filter(c => c !== id) : [...nav.crewIds, id] } });
  return <div className="ss-drawer-stack"><span className="kp-eyebrow">1 · Choose crew</span>
    <ul className="ss-check-list">{crew.map(c => <li key={c.id}><label><input type="checkbox" checked={nav.crewIds.includes(c.id)} onChange={() => toggle(c.id)}/><span><strong>{c.name}</strong><small>{crewLocation(c, world)}</small></span></label></li>)}</ul>
    <span className="kp-eyebrow">2 · Destination</span>
    <div className="ss-inline">{destinations.map(s => <ArcadeButton key={s.id} tone={nav.targetShipId === s.id ? 'lime' : 'ghost'} size="sm" aria-pressed={nav.targetShipId === s.id} onClick={() => dispatch({ type: 'open', nav: { ...nav, targetShipId: s.id } })}>{shipLabel(s, pub.ships)}</ArcadeButton>)}</div>
    <small className="ss-muted">{transporterShip ? `Using ${shipLabel(transporterShip, pub.ships)}’s teleporter.` : nav.crewIds.length ? 'No teleporter at their ship: pick an allied destination that has a working teleporter.' : 'Select crew, then a destination.'}</small>
    <ArcadeButton tone="sun" disabled={!nav.crewIds.length || !dest || !transporter} onClick={() => { if (dest) dispatch({ type: 'view', shipId: dest.id }); setAim(true); }}>3 · Tap a room on {dest ? shipLabel(dest, pub.ships) : 'the destination'}</ArcadeButton>
  </div>;
}
/** Direct control bar: movement left, context actions right. Every neutral state and every exit releases the held input. */
function DirectControl({ screen }: { screen: Screen }) {
  const { world, props, submit, local } = screen, crewId = local.nav.kind === 'control' ? local.nav.crewId : null, crew = world.privateView.crew.find(c => c.id === crewId) ?? null;
  const held = useRef({ x: 0, y: 0, action: 'none' as 'none' | 'repair' | 'fight' | 'heal' }), latest = useRef({ props, crew }); latest.current = { props, crew };
  const publish = () => { const { props, crew } = latest.current, h = held.current; if (!crew || (!h.x && !h.y && h.action === 'none')) props.releaseInput?.(); else props.setInput({ crewId: crew.id, controlEpoch: crew.controlEpoch, x: h.x, y: h.y, action: h.action }); };
  useEffect(() => { publish(); }, [crew?.controlEpoch, crew?.id]);
  useEffect(() => () => { held.current = { x: 0, y: 0, action: 'none' }; latest.current.props.releaseInput?.(); }, []);
  const release = () => { held.current = { x: 0, y: 0, action: 'none' }; props.releaseInput?.(); submit({ type: 'controlCrew', crewId: null }, { after: { kind: 'interior' } }); };
  const act = (action: 'repair' | 'fight' | 'heal') => (down: boolean) => { held.current.action = down ? action : held.current.action === action ? 'none' : held.current.action; publish(); };
  if (!crew) return <div className="ss-control"><StatusNotice>Crew unavailable.</StatusNotice></div>;
  const disabled = !props.connected || world.publicView.paused;
  return <div className="ss-control" data-crew={crew.id} data-control-epoch={crew.controlEpoch}>
    <SteerPad label={`Move ${crew.name}`} disabled={disabled} onChange={value => { held.current.x = value.x; held.current.y = value.y; publish(); }}/>
    <div className="ss-control-actions"><span className="kp-eyebrow">{crew.name} · {crewLocation(crew, world)}{world.publicView.paused ? ' · paused' : ''}</span>
      <div className="ss-control-buttons"><HoldButton label="Repair" disabled={disabled} onChange={act('repair')}>Repair</HoldButton><HoldButton label="Fight" disabled={disabled} onChange={act('fight')}>Fight</HoldButton><HoldButton label="Heal" disabled={disabled} onChange={act('heal')}>Heal</HoldButton>
      <ArcadeButton tone="ghost" size="sm" onClick={release}>Stop</ArcadeButton></div>
    </div>
  </div>;
}
/** Between battles: the fleet cannot jump with an uncrewed allied hull. Explain the two ways out; the leader gets a deliberate two-tap abandon. */
function DepartureNotice({ screen }: { screen: Screen }) {
  const { world, submit, captainId } = screen, pub = world.publicView, hulls = uncrewedAllies(world), leader = pub.leaderCaptainId === captainId;
  const lastHull = pub.ships.filter(s => s.faction === 'allied' && s.status === 'active').length === 1;
  const [arming, setArming] = useState<string | null>(null);
  useEffect(() => { if (!arming) return; const timer = setTimeout(() => setArming(null), 6000); return () => clearTimeout(timer); }, [arming]);
  if (!hulls.length || !BETWEEN_BATTLES.includes(pub.phase)) return null;
  return <div className="ss-row ss-departure" role="status" data-uncrewed={hulls.length}><span className="kp-eyebrow">Uncrewed hull{hulls.length > 1 ? 's' : ''} · fleet cannot jump</span>
    <ul className="ss-departure-list">{hulls.map(ship => { const owner = pub.captains.find(c => c.id === ship.ownerCaptainId); return <li key={ship.id}><strong>{ship.name}</strong><small>{owner ? `${owner.name}’s ship` : 'allied hull'} · nobody aboard</small>
      {leader && (arming === ship.id ? <ArcadeButton tone="coral" size="sm" onClick={() => { setArming(null); void submit({ type: 'abandonShip', shipId: ship.id }, { after: 'stay', success: `${ship.name} abandoned` }); }} aria-label={lastHull ? `Confirm abandon ${ship.name}: this is the last surviving friendly hull, so the expedition ends here` : `Confirm abandon ${ship.name}: the hull and all cargo aboard are lost`}>{lastHull ? 'Confirm · ends the expedition' : 'Confirm'}<small>{lastHull ? 'last friendly hull · no fleet remains' : 'hull and cargo lost'}</small></ArcadeButton>
        : <ArcadeButton tone="ghost" size="sm" onClick={() => setArming(ship.id)} aria-label={`Abandon ${ship.name}`}>Abandon</ArcadeButton>)}</li>; })}</ul>
    <small className="ss-muted">{lastHull ? 'This is the last surviving friendly hull. Teleport living crew aboard to keep the expedition going' : 'Teleport any living friendly crew aboard to keep it'}{leader ? lastHull ? '. Abandoning it leaves no fleet and ends the expedition.' : ', or abandon it. Abandoning loses the hull and every item stored on it; survivors elsewhere keep their captain.' : `. Only ${pub.captains.find(c => c.id === pub.leaderCaptainId)?.name ?? 'the leader'} can abandon it.`}</small>
  </div>;
}
function SpectatorPanel({ screen }: { screen: Screen }) {
  const { world, submit } = screen, pub = world.publicView, priv = world.privateView, store = pub.phase === 'store', cost = 60;
  const [skill, setSkill] = useState<Crew['skill']>('engineer'), [species,setSpecies]=useState<NonNullable<Crew['species']>>('human');
  const carrier = pub.ships.find(s => s.id === priv.cargoShipId) ?? pub.ships.find(s => s.faction === 'allied' && present(s));
  return <div className="ss-drawer-stack ss-spectator"><span className="kp-eyebrow">Spectating</span><strong>No crew remain under your command.</strong>
    <p>Your seat, wallet and record stay saved. You can inspect every vessel, but ordinary orders wait until a recruit or rescue restores your slot.</p>
    {store ? <div className="ss-recovery" data-recovery="store"><span className="kp-eyebrow">Recovery offer</span><strong>Hire a recruit for {cost} scrap</strong><small className="ss-muted">Wallet {priv.wallet} · they board {carrier ? shipLabel(carrier, pub.ships) : 'a surviving ally'} and return you to active play.</small>
      <SpeciesSelect value={species} onChange={setSpecies}/><label>Specialty<select value={skill} onChange={e => setSkill(e.target.value as Crew['skill'])}>{(['pilot', 'engineer', 'gunner', 'medic', 'fighter', 'scientist'] as const).map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <ArcadeButton tone="grape" disabled={priv.wallet < cost || !carrier} onClick={() => submit({ type: 'recruitCrew', replaceCrewId: null, skill, species }, { after: 'stay', success: 'Recruit hired. Welcome back, captain.' })}>Recruit {skill}<small>{priv.wallet < cost ? `need ${cost - priv.wallet} more scrap` : `${cost} scrap`}</small></ArcadeButton></div>
      : <small className="ss-muted">Stations offer a paid recruit that restores your command. Rescue events may also return crew.</small>}
    {pub.objective && <small>{pub.objective.description}</small>}
  </div>;
}
/** Phase drawer: what the fleet is deciding now, with any departure blockers on top. */
function PhaseDrawer({ screen, spectator }: { screen: Screen; spectator: boolean }) {
  const { world, dispatch, submit, openMenu } = screen, phase = world.publicView.phase;
  const stranded = world.privateView.crew.some(c => c.status === 'alive' && world.publicView.ships.find(s => s.id === c.currentShipId)?.faction === 'enemy');
  return <div className="ss-drawer-stack">
    {spectator && <SpectatorPanel screen={screen}/>}
    <DepartureNotice screen={screen}/>
    {stranded && <div className="ss-row ss-extraction" role="status"><span className="kp-eyebrow">Crew aboard enemy vessels</span><small className="ss-muted">Extract them before the fleet jumps, or acknowledge the loss.</small><div className="ss-inline"><ArcadeButton tone="grape" size="sm" onClick={() => { dispatch({ type: 'open', nav: { kind: 'teleport', crewIds: [], targetShipId: null } }); openMenu('none'); }}>Teleporter<small>extract crew before jumping</small></ArcadeButton><ArcadeButton tone="coral" size="sm" onClick={() => submit({ type: 'abandonCrew' }, { after: 'stay' })}>Leave them<small>lost on the next jump</small></ArcadeButton></div></div>}
    {phase === 'rewards' ? <LootPanel screen={screen}/> : phase === 'store' ? <StorePanel screen={screen}/> : phase === 'route' ? <RoutePanel screen={screen}/> : phase === 'event' ? <EventPanel screen={screen}/> : <StatusNotice>The fleet is in battle. Close this panel to command your ship.</StatusNotice>}
  </div>;
}
/** Menu drawer: ship stats, battle controls the HUD cannot hold, the spectator seat and help. */
function MainMenu({ screen, interior, spectator }: { screen: Screen; interior: InteriorView | null; spectator: boolean }) {
  const { world, submit, captainId, own } = screen, pub = world.publicView, priv = world.privateView, leader = pub.leaderCaptainId === captainId, combat = pub.phase === 'combat', escaping = pub.objective?.kind === 'escape';
  const [arming, setArming] = useState(false);
  useEffect(() => { if (!arming) return; const timer = setTimeout(() => setArming(false), 6000); return () => clearTimeout(timer); }, [arming]);
  const ship = interior?.ship ?? null;
  return <div className="ss-drawer-stack">
    {spectator && <SpectatorPanel screen={screen}/>}
    {ship && <dl className="ss-stats"><dt>Vessel</dt><dd>{ship.id === own ? `${ship.name} (yours)` : `${shipLabel(ship, pub.ships)} · ${bareName(ship)}`}</dd><dt>Hull</dt><dd>{Math.round(ship.hull)}/{ship.maxHull}</dd><dt>Shields</dt><dd>{Math.floor(ship.shield)}</dd>{interior && ship.id === own && <><dt>Ammo</dt><dd>{interior.ammo}</dd></>}<dt>Scrap</dt><dd>{priv.wallet}</dd><dt>Crew alive</dt><dd>{priv.crew.filter(c => c.status === 'alive').length}</dd>{ship.alerts.length > 0 && <><dt>Alerts</dt><dd>{ship.alerts.join(', ')}</dd></>}</dl>}
    {combat && pub.paused && <div className="ss-row ss-pause-detail" data-paused="true"><span className="kp-eyebrow">Tactical pause</span><strong>{pub.pausedBy ? `${pub.captains.find(c => c.id === pub.pausedBy)?.name ?? 'A captain'} paused the battle` : 'Paused'}</strong>
      <ul className="ss-ready-list">{pub.captains.filter(c => c.status !== 'spectator' && c.connected).map(c => <li key={c.id} style={{ ['--chip' as string]: c.color }} className={c.ready ? 'ss-ready' : ''}>{c.name}<b>{c.ready ? 'ready' : 'planning'}</b></li>)}</ul>
      {leader && pub.captains.filter(c => c.status !== 'spectator' && c.connected).length > 1 && <ArcadeButton tone="coral" size="sm" onClick={() => submit({ type: 'resume', force: true }, { after: 'stay' })}>Resume now<small>leader · continues without idle captains</small></ArcadeButton>}</div>}
    {combat && pub.objective && <div className="ss-row"><span className="kp-eyebrow">{escaping ? 'Retreating' : 'Objective'}</span><small>{escaping && pub.objective.deadlineMs !== null ? `Hold ${seconds(pub.objective.deadlineMs - pub.timeMs)}. ` : ''}{pub.objective.description}</small>{priv.queued.length > 0 && <small className="ss-muted">{priv.queued.length} order{priv.queued.length === 1 ? '' : 's'} queued for resume</small>}</div>}
    {combat && leader && !spectator && !escaping && (arming ? <ArcadeButton tone="coral" onClick={() => { setArming(false); void submit({ type: 'retreat' }, { after: 'stay', success: 'Retreat ordered' }); }} aria-label="Confirm withdraw: no salvage, hold 20 seconds, extract crew before jumping">Confirm withdraw<small>no salvage · hold 20s</small></ArcadeButton> : <ArcadeButton tone="ghost" onClick={() => setArming(true)} aria-label="Withdraw from battle">Withdraw from battle<small>leader only · two taps</small></ArcadeButton>)}
    <small className="ss-muted">Tap a room to inspect it. Weapons and Crew live on the right edge. Escape closes any panel; P pauses in battle.</small>
  </div>;
}
