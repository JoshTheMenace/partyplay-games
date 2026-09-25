import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Atom, Bomb, ChevronsRight, EyeOff, Flame, Gauge, HeartPulse, Home, Orbit, Pause, Play, Rocket, Shield, Telescope, Undo2, Wind, X, Zap, type LucideIcon } from 'lucide-react';
import { overheat, type ClientProps, type Crew, type RoomState, type ShipView, type WeaponKind, type WeaponState } from '../contracts';
import { useCombatAudio } from '../audio/sfx';
import { ROLES, speciesDef, systemDef, weaponDef } from '../defs/catalog';
import { hullDef } from '../defs/hulls';
import { pauser } from '../display/combat';
import { alive, myCaptain, Meter, Pips, roomName, shipOf, Spin, type Actions } from './common';
import { ShipStage, ShipThumb } from './stage';

export const KIND_ICON: Record<WeaponKind, LucideIcon> = { laser: Zap, missile: Rocket, beam: Activity, ion: Atom, flak: Bomb, support: HeartPulse };
export type Mode = { kind: 'crew' } | { kind: 'weapon'; uid: string; shipId: string | null } | { kind: 'teleport'; shipId: string | null } | { kind: 'fleet' };
const CREW: Mode = { kind: 'crew' };
const short = (ship: ShipView | undefined, roomId: string) => { const room = ship?.rooms.find(r => r.id === roomId); return room?.system ? systemDef(room.system).short : 'Bay'; };
export const weaponStatus = (ship: ShipView, w: WeaponState) => { const def = weaponDef(w.defId);
  return !w.powered ? 'unpowered' : def.ammo && ship.ammo < def.ammo ? 'ammo' : w.charge >= 1 ? 'ready' : 'charging'; };

/** All combat-order state and handlers, shared by the phone controller and the host's PersonalView. */
export function useCombat(props: ClientProps, actions: Actions) {
  const view = props.publicView, combat = view.combat, me = myCaptain(props), ship = shipOf(view, me);
  const [mode, setMode] = useState<Mode>(CREW), [awayId, setAwayId] = useState<string | null>(null), [picked, setPicked] = useState<string[]>([]);
  const mine = alive(view.crew).filter(c => !!me && c.ownerId === me.id);
  /** The ship shown for crew orders: any ship you chose to look at (teammates included), else your own. */
  const crewShip = view.ships.find(s => s.id === awayId && s.status !== 'destroyed') ?? ship;
  const selected = picked.filter(id => mine.some(c => c.id === id && c.shipId === crewShip?.id));
  const weapon = mode.kind === 'weapon' ? ship?.weapons.find(w => w.uid === mode.uid) ?? null : null;
  const support = !!weapon && weaponDef(weapon.defId).target === 'ally';
  const candidates = !ship || mode.kind === 'crew' ? [] : mode.kind === 'fleet' ? view.ships.filter(s => s.status === 'active').sort((a, b) => +(a.faction !== 'ally') - +(b.faction !== 'ally'))
    : view.ships.filter(s => s.status === 'active' && (mode.kind === 'teleport' ? s.id !== ship.id : (s.faction === 'ally') === support));
  /** The ship shown for aiming: the chosen one, else (teleport) the first ally or (weapons) one already targeted, else the first candidate. */
  const aim = mode.kind === 'crew' || mode.kind === 'fleet' ? null : candidates.find(s => s.id === mode.shipId) ?? (mode.kind === 'teleport' ? candidates.find(s => s.faction === 'ally') : candidates.find(s => ship?.weapons.some(w => w.target?.shipId === s.id))) ?? candidates[0] ?? null;
  const teleRoom = ship?.rooms.find(r => r.system === 'teleporter' && r.tier > 0) ?? null, pad = teleRoom && hullDef(ship!.hullId).rooms.find(r => r.id === teleRoom.id), seats = teleRoom && pad ? Math.min(Math.min(teleRoom.tier, 3) + 1, pad.w * pad.h) : 0;
  const away = [...new Set(mine.filter(c => c.shipId !== ship?.id).map(c => c.shipId))].flatMap(id => view.ships.filter(s => s.id === id));
  const ready = ship?.status === 'active' ? ship.weapons.filter(w => w.target && weaponStatus(ship, w) === 'ready') : [];
  const cancel = () => setMode(CREW);
  const openShip = (id: string | null) => { setAwayId(id); setPicked([]); cancel(); };
  const pickWeapon = (uid: string) => setMode(m => m.kind === 'weapon' && m.uid === uid ? CREW : { kind: 'weapon', uid, shipId: ship?.weapons.find(w => w.uid === uid)?.target?.shipId ?? null });
  const aimAt = (shipId: string) => mode.kind === 'fleet' ? openShip(shipId === ship?.id ? null : shipId) : setMode(m => m.kind === 'crew' || m.kind === 'fleet' ? m : { ...m, shipId });
  const fleet = () => mode.kind === 'fleet' ? cancel() : setMode({ kind: 'fleet' });
  const toggleCrew = (id: string) => { const c = mine.find(x => x.id === id); if (!c) return;
    if (c.shipId !== crewShip?.id) { setAwayId(c.shipId === ship?.id ? null : c.shipId); setPicked([id]); return; }
    if (selected.includes(id)) setPicked(selected.filter(x => x !== id)); else if (selected.length >= 4) actions.hint('Up to four crew at a time.'); else setPicked([...selected, id]); };
  const room = (shipId: string, roomId: string) => {
    if (weapon && candidates.some(s => s.id === shipId)) { void actions.act({ type: 'target', weapon: weapon.uid, shipId, roomId }, `target-${weapon.uid}`); return cancel(); }
    if (mode.kind === 'fleet') return openShip(shipId === ship?.id ? null : shipId);
    if (mode.kind === 'teleport' && candidates.some(s => s.id === shipId)) { void actions.act({ type: 'teleport', crewIds: selected, shipId, roomId }); setPicked([]); return cancel(); }
    const here = mine.filter(c => c.shipId === shipId && c.roomId === roomId);
    if (selected.length && shipId === crewShip?.id) { setPicked([]); if (!selected.every(id => here.some(c => c.id === id))) void actions.act({ type: 'crew', crewIds: selected, roomId }); }
    else if (here.length) { setAwayId(shipId === ship?.id ? null : shipId); setPicked(here.slice(0, 4).map(c => c.id)); }
    else actions.hint(crewShip !== ship && !mine.some(c => c.shipId === crewShip?.id) ? `None of your crew are aboard ${crewShip?.name}. Select crew at home and tap Teleport to board.` : 'Pick crew first: tap a room with your crew in it, or a name in the crew list.');
  };
  /** Selected crew anywhere aboard your ship (or whoever stands on the pad) walk to the teleporter and beam over together. */
  const teleport = () => {
    if (mode.kind === 'teleport') return cancel();
    const home = mine.filter(c => c.shipId === ship?.id), crew = selected.length && crewShip === ship ? selected : home.filter(c => c.roomId === teleRoom?.id).slice(0, seats).map(c => c.id);
    if (!crew.length) return actions.hint('Select crew aboard your ship first (tap their room or name), then Teleport.');
    if (crew.length > seats) return actions.hint(`The teleporter carries ${seats} at a time.`);
    setAwayId(null); setPicked(crew); setMode({ kind: 'teleport', shipId: null });
  };
  const roomLabel = (s: ShipView) => (r: RoomState) => { const people = alive(view.crew).filter(c => c.shipId === s.id && c.roomId === r.id), own = people.filter(c => c.ownerId === me?.id).length, foes = people.filter(c => c.faction === 'enemy').length;
    return [`${roomName(r.system)} room`, `${own} crew`, foes && `${foes} hostile`, r.damage && 'damaged', r.fire && 'on fire', r.breach && 'breached', r.ionMs > 0 && 'ionized', s.id === weapon?.target?.shipId && r.id === weapon.target.roomId && 'current target'].filter(Boolean).join(', '); };
  const fire = () => actions.act({ type: 'fire' });
  const pause = () => combat && actions.act({ type: 'pause', paused: !combat.paused });
  const stations = () => actions.act({ type: 'stations' });
  const cloak = () => actions.act({ type: 'cloak' });
  return { view, combat, me, ship, mode, setMode, cancel, mine, crewShip, selected, weapon, support, candidates, aim, teleRoom, seats, away, ready,
    openShip, pickWeapon, aimAt, fleet, toggleCrew, room, teleport, roomLabel, fire, pause, stations, cloak, actions, now: props.serverNowMs };
}
export type CombatState = ReturnType<typeof useCombat>;

const Stat = ({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) => <span className="sp-stat" title={label}><Icon size={14} aria-hidden="true"/><span className="kp-numeral" aria-label={label}>{children}</span></span>;
export function StatusStrip({ c }: { c: CombatState }) {
  const { ship, combat } = c; if (!ship || !combat) return null;
  return <div className="sp-status">
    <span className="sp-hull"><b>HULL</b><Meter value={ship.hull} max={ship.maxHull} label={`Hull ${ship.hull} of ${ship.maxHull}`}/><span className="kp-numeral">{ship.hull}</span></span>
    <span className="sp-stat"><Shield size={14} aria-hidden="true"/><Pips on={ship.shields + ship.tempShield} total={ship.maxShields + ship.tempShield} label={`Shields ${ship.shields + ship.tempShield} of ${ship.maxShields + ship.tempShield}`}/></span>
    <Stat icon={Wind} label={`Evasion ${ship.evasion}%`}>{ship.evasion}%</Stat>
    <Stat icon={Rocket} label={`${ship.ammo} missiles`}>{ship.ammo}</Stat>
    {overheat(combat) > 0 && <Stat icon={Flame} label={`Shields overheating ${Math.round(overheat(combat) * 100)}%`}>{Math.round(overheat(combat) * 100)}%</Stat>}
    {combat.objective !== 'boss' && combat.ftl < 1 && <Stat icon={Gauge} label={`FTL drive ${Math.floor(combat.ftl * 100)}% charged`}>{Math.floor(combat.ftl * 100)}%</Stat>}
  </div>;
}
function Tool({ icon: Icon, text, label = text, on, busy, ring, disabled, onClick, className = '' }: { icon: LucideIcon; text: string; label?: string; on?: boolean; busy?: boolean; ring?: number; disabled?: boolean; onClick(): void; className?: string }) {
  return <button type="button" className={`sp-tool ${className}`} aria-pressed={on} aria-label={label} title={label} disabled={disabled || busy} onClick={onClick} style={ring ? { '--ring': ring } as React.CSSProperties : undefined} data-ring={ring ? true : undefined}>
    {busy ? <Spin/> : <Icon size={18} aria-hidden="true"/>}<span>{text}</span></button>;
}
export function Tools({ c }: { c: CombatState }) {
  const { ship, combat, me, actions, mode } = c; if (!combat || !me) return null;
  const alive = ship?.status === 'active', cloakLevel = ship?.levels.cloak ?? 0, tele = !!c.teleRoom, voted = combat.jumpVotes.includes(me.id), connected = c.view.captains.filter(x => x.connected).length;
  const cloakRing = ship ? ship.cloakMs > 0 ? ship.cloakMs / ((3 + 2 * cloakLevel) * 1000) : ship.cloakCooldownMs / 25000 : 0;
  const hasCloak = !!ship?.rooms.some(r => r.system === 'cloak' && r.tier > 0), jump = combat.objective !== 'boss' && combat.ftl >= 1;
  return <div className="sp-tools" data-many={3 + +hasCloak + +tele + +jump >= 5 || undefined}>
    <Tool icon={Home} text="Stations" label="Stations: send your crew to their posts" busy={actions.busy('stations')} onClick={c.stations}/>
    {hasCloak && ship && <Tool icon={EyeOff} text={ship.cloakMs > 0 ? 'Cloaked' : 'Cloak'} on={ship.cloakMs > 0} ring={cloakRing} busy={actions.busy('cloak')} disabled={!alive || !cloakLevel || ship.cloakMs > 0 || ship.cloakCooldownMs > 0} onClick={c.cloak}/>}
    <Tool icon={Telescope} text="Fleet" label={mode.kind === 'fleet' ? 'Close the ship list' : 'View any ship, including teammates'} on={mode.kind === 'fleet'} onClick={c.fleet}/>
    {tele && <Tool icon={Orbit} text="Teleport" label={mode.kind === 'teleport' ? 'Cancel teleport' : `Teleport up to ${c.seats} selected crew`} on={mode.kind === 'teleport'} ring={ship!.teleportCooldownMs / ((25 - 5 * (ship!.levels.teleporter ?? 1)) * 1000)} disabled={!alive} busy={actions.busy('teleport')} onClick={c.teleport}/>}
    {jump && <Tool icon={ChevronsRight} className="sp-tool-jump" text={voted ? 'Voted' : 'Jump'} label={`${voted ? 'Unvote' : 'Jump'} away (${combat.jumpVotes.length}/${Math.floor(connected / 2) + 1} votes)`} on={voted} busy={actions.busy('jump')} onClick={() => actions.act({ type: 'jump', vote: !voted })}/>}
    <Tool icon={combat.paused ? Play : Pause} className="sp-tool-pause" text={combat.paused ? 'Resume' : 'Pause'} label={combat.paused ? 'Resume battle' : 'Pause battle'} on={combat.paused} busy={actions.busy('pause')} onClick={c.pause}/>
  </div>;
}

/** Weapon cards; charge bars extrapolate between snapshots on animation frames. */
export function WeaponRack({ c, keys }: { c: CombatState; keys?: boolean }) {
  const { ship, combat, view, mode } = c, bars = useRef(new Map<string, HTMLElement>()), stamp = useRef({ t: -1, at: 0 }), latest = useRef(c); latest.current = c;
  if (combat && stamp.current.t !== combat.t) stamp.current = { t: combat.t, at: performance.now() };
  useEffect(() => { let frame = 0; const tick = () => { frame = requestAnimationFrame(tick); const { ship, combat } = latest.current; if (!ship || !combat) return;
    const dt = combat.paused || combat.outcome || combat.t < combat.introUntilMs ? 0 : performance.now() - stamp.current.at;
    for (const w of ship.weapons) { const el = bars.current.get(w.uid); if (el) el.style.transform = `scaleX(${w.powered ? Math.min(1, w.charge + dt / weaponDef(w.defId).chargeMs) : w.charge})`; } };
    tick(); return () => cancelAnimationFrame(frame); }, []);
  if (!ship) return null;
  return <div className="sp-weapons" role="group" aria-label="Weapons">{ship.weapons.map((w, i) => { const def = weaponDef(w.defId), Icon = KIND_ICON[def.kind], status = weaponStatus(ship, w), target = w.target && view.ships.find(s => s.id === w.target!.shipId);
    const aim = status === 'unpowered' ? 'Unpowered' : status === 'ammo' ? 'No missiles' : target ? `→ ${target.name} · ${short(target, w.target!.roomId)}` : def.target === 'ally' ? 'Tap to pick an ally' : 'Tap to aim';
    return <button key={w.uid} type="button" className="sp-weapon" data-kind={def.kind} data-status={status} aria-pressed={mode.kind === 'weapon' && mode.uid === w.uid} disabled={ship.status !== 'active'}
      aria-label={`${keys ? `${i + 1}: ` : ''}${def.name}, ${status === 'ready' ? 'charged' : status}, ${target ? `aimed at ${target.name} ${short(target, w.target!.roomId)}` : 'no target'}${w.auto ? '' : ', holding for volley'}`} onClick={() => c.pickWeapon(w.uid)}>
      <span className="sp-weapon-name"><Icon size={14} aria-hidden="true"/>{keys && <kbd>{i + 1}</kbd>}<span>{def.name}</span>{!w.auto && <em>HOLD</em>}</span>
      <span className="sp-weapon-aim">{c.actions.busy(`target-${w.uid}`) ? <Spin/> : aim}</span>
      <span className="sp-charge"><i ref={el => { if (el) bars.current.set(w.uid, el); else bars.current.delete(w.uid); }} style={{ transform: `scaleX(${w.charge})` }}/></span>
    </button>; })}</div>;
}
export function FireButton({ c }: { c: CombatState }) {
  const n = c.ready.length, held = c.ship?.weapons.filter(w => !w.auto).length ?? 0;
  return <button type="button" className="sp-fire" data-ready={n > 0 || undefined} disabled={!n || c.actions.busy('fire')} onClick={c.fire} aria-label={n ? `Fire volley: ${n} weapon${n > 1 ? 's' : ''} charged` : 'Fire volley: nothing charged and aimed'}>
    <b className="kp-display">{c.actions.busy('fire') ? <Spin/> : 'Fire'}</b><small>{n ? `${n} ready` : held ? 'Charging' : 'Auto-firing'}</small></button>;
}

const stateLabel: Partial<Record<Crew['state'], string>> = { walking: 'moving', manning: 'on station', repairing: 'repairing', fighting: 'fighting', extinguishing: 'fire crew', healing: 'healing' };
/** Crew list grouped by ship: the commanded ship's crew as toggles, other ships as "Away team" / "Home" chips. */
export function CrewRoster({ c }: { c: CombatState }) {
  const { mine, crewShip, ship, selected, view, actions } = c;
  const groups = [...new Set([crewShip?.id, ...mine.map(m => m.shipId)])].flatMap(id => view.ships.filter(s => s.id === id));
  return <div className="sp-roster" role="group" aria-label="Your crew">{groups.map(s => { const crew = mine.filter(m => m.shipId === s.id), home = s.id === ship?.id;
    if (s.id !== crewShip?.id) return <div key={s.id} className="sp-away"><button type="button" className="sp-away-open" onClick={() => c.openShip(home ? null : s.id)}>
      {home ? <Home size={15} aria-hidden="true"/> : <Orbit size={15} aria-hidden="true"/>}<span>{home ? 'Back aboard' : 'Away team'} · {s.name} ({crew.length})</span></button>
      {!home && <button type="button" className="sp-away-recall" aria-label={`Recall crew from ${s.name}`} disabled={actions.busy(`recall-${s.id}`)} onClick={() => actions.act({ type: 'recall', shipId: s.id }, `recall-${s.id}`)}>{actions.busy(`recall-${s.id}`) ? <Spin/> : <Undo2 size={16} aria-hidden="true"/>}</button>}</div>;
    return <div key={s.id} className="sp-crew-group">{!home && <p className="sp-group-label">Aboard {s.name}</p>}{crew.map(m => { const sp = speciesDef(m.species), room = s.rooms.find(r => r.id === m.roomId);
      return <button key={m.id} type="button" className="sp-crew" aria-pressed={selected.includes(m.id)} onClick={() => c.toggleCrew(m.id)}
        aria-label={`${m.name}, ${sp.name} ${m.role}, ${Math.ceil(m.hp)} of ${m.maxHp} health, in ${roomName(room?.system ?? null)}${stateLabel[m.state] ? `, ${stateLabel[m.state]}` : ''}`}>
        <span className="sp-crew-face" style={{ background: sp.color }} aria-hidden="true">{m.name[0]}</span>
        <span className="sp-crew-text"><b>{m.name}</b><small>{ROLES.find(r => r.id === m.role)?.name} · {room?.system ? systemDef(room.system).short : 'Bay'}{m.beam ? ` · boarding ${view.ships.find(x => x.id === m.beam!.shipId)?.name ?? ''}` : ['fighting', 'extinguishing', 'repairing'].includes(m.state) ? ` · ${stateLabel[m.state]}` : ''}</small></span>
        <Meter value={m.hp} max={m.maxHp} tone="hp" segments={1} label={`${m.name} health`}/></button>; })}
      {!crew.length && <p className="sp-group-label">No crew aboard</p>}</div>; })}
    {!mine.length && <p className="sp-group-label">All hands lost. Your captain returns with fresh recruits after the battle.</p>}</div>;
}
/** Ship choices while aiming a weapon or the teleporter. */
export function TargetList({ c, pick = true }: { c: CombatState; pick?: boolean }) {
  const { mode, candidates, aim, weapon, actions, view } = c; if (mode.kind === 'crew') return null;
  const def = weapon && weaponDef(weapon.defId);
  return <div className="sp-targets">
    <div className="sp-targets-head"><span>{def ? <>{def.name}<small>{pick ? def.target === 'ally' ? 'Pick an ally, then a room' : 'Pick a ship, then a room' : `Click a highlighted ${def.target === 'ally' ? 'allied' : 'enemy'} room`}</small></> : mode.kind === 'fleet' ? <>Fleet<small>{pick ? 'Pick a ship to view it' : 'Click any ship to view it'}</small></> : <>Teleport {c.selected.length}<small>{pick ? 'Pick a ship, then a room' : 'Click a highlighted room on any ship'}</small></>}</span>
      <button type="button" className="sp-icon-btn" aria-label="Cancel" onClick={c.cancel}><X size={18} aria-hidden="true"/></button></div>
    {pick && <div className="sp-target-list">{candidates.map(s => <button key={s.id} type="button" className="sp-target" aria-pressed={aim?.id === s.id} onClick={() => c.aimAt(s.id)}
      aria-label={`${s.name}, hull ${s.hull} of ${s.maxHull}, ${s.shields} shields${weapon?.target?.shipId === s.id ? ', current target' : ''}`}>
      <ShipThumb view={view} ship={s} serverNowMs={c.now}/><span className="sp-target-text"><b>{s.name}</b><Meter value={s.hull} max={s.maxHull} label={`${s.name} hull`}/>
        <Pips on={s.shields + s.tempShield} total={s.maxShields + s.tempShield} label={`${s.shields + s.tempShield} shields`}/></span>
      {s.fleeAtMs !== null && <Flame className="sp-flee" size={14} aria-label="Fleeing"/>}</button>)}
      {!candidates.length && <p className="sp-group-label">No ships in range.</p>}</div>}
    {weapon && <div className="sp-targets-foot">
      <button type="button" className="sp-chip-btn" aria-pressed={weapon.auto} disabled={actions.busy('autofire')} onClick={() => actions.act({ type: 'autofire', weapon: weapon.uid, auto: !weapon.auto })}>{actions.busy('autofire') ? <Spin/> : null}Auto fire {weapon.auto ? 'on' : 'off'}</button>
      {weapon.target && <button type="button" className="sp-chip-btn" disabled={actions.busy('untarget')} onClick={() => { void actions.act({ type: 'untarget', weapon: weapon.uid }); c.cancel(); }}>Clear target</button>}</div>}
  </div>;
}

/** The phone's landscape combat cockpit. */
export function CombatController(props: ClientProps & { actions: Actions }) {
  const c = useCombat(props, props.actions), { ship, combat, mode, aim, crewShip, view, weapon, selected, mine } = c;
  useCombatAudio(view, ship?.id ?? null, .3); // phones: only own weapon fire and hits on the own ship, quietly; never music
  if (!combat) return null;
  if (!c.me || !ship) return <div className="ss-phone sp-watch"><p className="kp-display">Watching the battle</p><p>You are not captaining a ship this run. Follow the fight on the TV.</p></div>;
  const lost = ship.status !== 'active' && crewShip === ship;
  const caption = mode.kind === 'weapon' ? aim && `Tap a room on ${aim.name} to aim ${weaponDef(weapon!.defId).name}`
    : mode.kind === 'teleport' ? aim && `Tap a room on ${aim.name} to beam ${selected.length} across`
    : mode.kind === 'fleet' ? 'Pick a ship to look at'
    : selected.length ? `${selected.length} selected · tap a room to send them` : crewShip !== ship ? mine.some(m => m.shipId === crewShip?.id) ? `Away team aboard ${crewShip?.name} · tap your crew, then a room` : `Viewing ${crewShip?.name}` : !lost && 'Tap a room with crew, then a room to send them';
  const paused = combat.paused && !combat.outcome, by = pauser(view);
  const stage = mode.kind !== 'crew' && mode.kind !== 'fleet' ? aim ? <ShipStage view={view} ship={aim} serverNowMs={props.serverNowMs} onRoom={id => c.room(aim.id, id)} roomLabel={c.roomLabel(aim)} highlight={aim.rooms.map(r => r.id)} selectedRoom={weapon?.target?.shipId === aim.id ? weapon.target.roomId : null}/>
    : <div className="sp-stage sp-stage-empty"><p>No ships in range</p></div>
    : lost ? <div className="sp-stage sp-stage-empty sp-wreck"><p className="kp-display">{ship.status === 'fled' ? 'Jumped clear' : 'Ship destroyed'}</p><p>{view.reserves > 0 ? `After the battle you return in a rebuilt ${ship.name} (fleet reserves: ${view.reserves}).` : 'No reserve hulls left: after the battle you fly on in a lifeboat.'}{c.away.length ? ' Your away team can still fight.' : ''}</p></div>
    : <ShipStage view={view} ship={crewShip!} serverNowMs={props.serverNowMs} onRoom={id => c.room(crewShip!.id, id)} roomLabel={c.roomLabel(crewShip!)} selectedCrew={selected}/>;
  return <div className="ss-phone sp-combat" data-mode={mode.kind}>
    <header className="sp-top"><StatusStrip c={c}/><Tools c={c}/></header>
    <section className="sp-main" aria-label={mode.kind === 'crew' ? 'Your ship' : 'Target ship'} data-paused={paused || undefined}>{stage}
      {(paused || caption) && <p className="sp-caption" aria-live="polite">{paused ? `${by ? `Paused by ${by}` : 'Paused'} · orders still work` : caption}</p>}
      <Banner c={c}/></section>
    <aside className="sp-side">{mode.kind === 'crew' ? <CrewRoster c={c}/> : <TargetList c={c}/>}</aside>
    <footer className="sp-bottom"><WeaponRack c={c}/><FireButton c={c}/></footer>
    {(props.connected === false || c.actions.error) && <p className="sp-toast" role="alert">{props.connected === false ? 'Reconnecting… orders resume when the link returns.' : c.actions.error}</p>}
  </div>;
}
/** Transient centre banner: warp-in and battle outcome. */
export function Banner({ c }: { c: CombatState }) {
  const { combat } = c, text = combat && (combat.outcome ? { victory: 'Victory', escaped: 'Jumped away', defeat: 'Fleet lost' }[combat.outcome] : combat.t < combat.introUntilMs && 'Warping in…');
  return text ? <p className="sp-banner" role="status">{text}</p> : null;
}
