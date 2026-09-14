import { SPECIES, speciesFor } from '../definitions/presentation/species';
import { SpeciesSelect } from './crew';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArcadeButton, Panel, StatusNotice, TextInput } from '../../../../party-ui/src/index';
import type { Action, Beacon, ClientProps, Crew, ItemView } from '../contracts';
import { systems as SYSTEM_DEFS } from '../definitions/presentation/index';
import { fitCutaway } from '../render/cutaway';
import { hullPath } from '../render/hulls';
import { containKeys, type Screen } from './controller';
import { CutawaySvg, roomsFromHull } from './cutaway';
import { useStage } from './interior';
import { beaconCode, beaconState, hangarBusy, hangarEditable, hangarInitial, hangarStep, hangarSync, normalizeDraft, sameDraft, shipLabel, upgradeCost, withdrawalDraft, type BeaconState, type Command, type HangarState } from './nav';
const COLORS = ['#4fc6c0', '#71a8e8', '#dc8b74', '#b79bdc', '#e3ae65', '#8fcbb0', '#cfbf7d', '#d28fb1'];
type Sender = { props: ClientProps };
function useSend({ props }: Sender) {
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'success' } | null>(null), [busy, setBusy] = useState(false);
  const send = async (action: Command, success?: string) => {
    setBusy(true);
    try { const result = await props.sendAction({ epoch: props.publicView.epoch, ...action } as Action); setNotice(result.accepted ? success ? { text: success, tone: 'success' } : null : { text: result.reason || 'Not accepted.', tone: 'error' }); return result; }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Connection problem.', tone: 'error' }); return { accepted: false, reason: 'Connection problem.' }; }
    finally { setBusy(false); }
  };
  return { send, notice, busy };
}
/** Restored expeditions: each connected player taps an unclaimed saved captain, including shipless and eliminated slots. */
export function Assignment({ props }: Sender) {
  const { send, notice, busy } = useSend({ props }), pub = props.publicView, mine = props.privateView?.captainId ?? null, me = pub.captains.find(c => c.id === mine);
  return <Panel className="ss-phase ss-assignment"><span className="kp-eyebrow">Resume expedition · sector {pub.sector.index} of {pub.sector.count}</span><h2>Choose your saved captain</h2>
    {notice && <StatusNotice tone={notice.tone}>{notice.text}</StatusNotice>}
    <ul className="ss-captain-grid">{pub.captains.map(captain => { const ship = pub.ships.find(s => s.id === captain.shipId), taken = captain.playerId !== null && captain.id !== mine;
      return <li key={captain.id}><button type="button" disabled={busy || taken || captain.id === mine} aria-pressed={captain.id === mine} style={{ ['--chip' as string]: captain.color }} onClick={() => send({ type: 'claimCaptain', captainId: captain.id }, `You are ${captain.name}`)}>
        <strong>{captain.name}</strong><small>{captain.status === 'active' && ship ? `${ship.name} · hull ${Math.round(ship.hull)}/${ship.maxHull}` : captain.status === 'shipless' ? `Ship lost · ${captain.crewCount} crew survive` : 'Eliminated · spectator seat'}</small><em>{captain.id === mine ? 'Yours' : taken ? 'Claimed' : 'Tap to claim'}</em></button></li>; })}</ul>
    {me && <ArcadeButton tone={me.ready ? 'lime' : 'sun'} disabled={busy} aria-pressed={me.ready} onClick={() => send({ type: 'ready' })}>{me.ready ? 'Ready ✓' : 'Ready'}</ArcadeButton>}
    <small className="ss-muted">{pub.captains.filter(c => c.playerId).length}/{pub.captains.length} claimed · {pub.captains.filter(c => c.ready).length} ready</small>
  </Panel>;
}
/** Small anchored panel for secondary hangar settings so the ship keeps the screen. */
export function Popover({ title, onClose, children, className = '' }: { title: string; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <section ref={ref} className={`ss-popover ${className}`} role="dialog" aria-modal="true" aria-label={title} data-popover={title} tabIndex={-1} onKeyDown={event => containKeys(event, onClose)}><header><strong>{title}</strong><button type="button" className="ss-icon-button" onClick={onClose} aria-label={`Close ${title}`}>✕</button></header>{children}</section>;
}
/** Hangar: hull choices first, then a full cutaway preview of the draft. One Confirm sends chooseHull and, only after it is accepted, ready.
 * Editing an accepted ship first withdraws readiness by re-sending the accepted draft (chooseHull resets ready), so other captains can never launch a stale hull. */
export function Hangar({ props, initialPreview }: Sender & { initialPreview?: string }) {
  const pub = props.publicView, priv = props.privateView!, me = priv.captain!, ship = pub.ships.find(s => s.id === me.shipId), hulls = priv.hulls;
  const [state, setState] = useState<HangarState>(() => { const base = hangarInitial({ hullId: ship?.hullId ?? hulls[0]?.id ?? '', name: ship?.name ?? me.name, color: ship?.color ?? me.color }, !!me.ready); return initialPreview ? hangarStep(base, { type: 'select', hullId: initialPreview, color: hulls.find(h => h.id === initialPreview)?.color ?? me.color }) : me.ready && ship ? { ...base, mode: 'preview' } : base; });
  const step = (event: Parameters<typeof hangarStep>[1]) => setState(current => hangarStep(current, event));
  const latest = useRef({ me, ship, state }); latest.current = { me, ship, state };
  useEffect(() => { setState(current => hangarSync(current, !!me.ready, latest.current.ship ? { hullId: latest.current.ship.hullId, name: latest.current.ship.name, color: latest.current.ship.color } : null)); }, [me.ready]);
  // One network transaction at a time, guarded by a ref so rapid repeated taps before the next render cannot double-send.
  const inflight = useRef(false);
  const [roster, setRoster] = useState(false), [tab, setTab] = useState<'name' | 'paint' | 'stats'>('paint');
  const hull = hulls.find(h => h.id === state.draft.hullId) ?? hulls[0], busy = hangarBusy(state), editable = hangarEditable(state), connected = props.connected !== false;
  const send = (action: Command) => props.sendAction({ epoch: props.publicView.epoch, ...action } as Action).catch((error: unknown) => ({ accepted: false, reason: error instanceof Error ? error.message : 'Connection problem.' }));
  const confirm = async () => {
    const current = latest.current.state; if (!hull || inflight.current || hangarBusy(current) || !connected || current.status === 'accepted') return;
    inflight.current = true; step({ type: 'confirm' });
    try {
      const payload = normalizeDraft(current.draft, hull.name);
      const chosen = await send({ type: 'chooseHull', ...payload }); step({ type: 'chosen', accepted: chosen.accepted, reason: chosen.reason, sent: payload });
      if (!chosen.accepted) return;
      const readied = await send({ type: 'ready' }); step({ type: 'readied', accepted: readied.accepted, reason: readied.reason });
    } finally { inflight.current = false; }
  };
  /** Retrying readiness is the same locked transaction as the first attempt: the draft is frozen until the ack arrives. */
  const readyOnly = async () => {
    const current = latest.current.state; if (inflight.current || hangarBusy(current) || !connected || current.status !== 'error' || !current.accepted || !hull || !sameDraft(current.accepted, normalizeDraft(current.draft, hull.name))) return;
    inflight.current = true; step({ type: 'retry', hullName: hull.name });
    try { const readied = await send({ type: 'ready' }); step({ type: 'readied', accepted: readied.accepted, reason: readied.reason }); } finally { inflight.current = false; }
  };
  /** Edit transaction: while we or the server hold this seat ready, re-send the accepted ship to withdraw readiness before exposing any editable control. Local acceptance counts even when the snapshot lags the ack. */
  const beginEdit = async (then: 'select' | 'preview') => {
    const { me, ship, state } = latest.current; if (inflight.current || hangarBusy(state) || !connected) return;
    const payload = withdrawalDraft(state, !!me.ready, ship ? { hullId: ship.hullId, name: ship.name, color: ship.color } : null);
    if (!payload) { step({ type: 'edit', target: then }); return; }
    inflight.current = true; step({ type: 'edit', target: then });
    try { const result = await send({ type: 'chooseHull', ...payload }); step({ type: 'unreadied', accepted: result.accepted, reason: result.reason }); } finally { inflight.current = false; }
  };
  const readyCount = `${pub.captains.filter(c => c.ready).length}/${pub.captains.length} ready`;
  const rosterPanel = roster && <Popover title="Fleet" onClose={() => setRoster(false)}><ul className="ss-roster">{pub.captains.map(c => { const s = pub.ships.find(x => x.id === c.shipId); return <li key={c.id} style={{ ['--chip' as string]: c.color }}><strong>{c.name}</strong><small>{s ? `${s.name} · ${hulls.find(h => h.id === s.hullId)?.name ?? s.hullId}` : 'choosing…'}{c.ready ? ' · ready' : ''}{!c.connected ? ' · away' : ''}</small></li>; })}</ul></Popover>;
  if (state.mode === 'select' || !hull) return <div className="ss-hangar ss-hangar-select" data-hangar="select" data-status={state.status}>
    <header className="ss-hangar-head"><span><span className="kp-eyebrow">Hangar · {readyCount}</span><h2>{state.status === 'accepted' && ship ? `${ship.name} is ready to launch` : 'Choose your ship'}</h2></span><button type="button" className="ss-hud-phase" onClick={() => setRoster(r => !r)} aria-expanded={roster}>Fleet</button></header>
    {rosterPanel}
    {state.error && <StatusNotice tone="error">{state.error}</StatusNotice>}
    {state.status === 'accepted' && <StatusNotice>Your ship is confirmed and you are marked ready. Choosing another hull withdraws readiness first.</StatusNotice>}
    <ul className="ss-hull-grid" aria-label="Hulls">{hulls.map(h => { const current = ship?.hullId === h.id && state.status === 'accepted'; return <li key={h.id}><button type="button" aria-pressed={state.draft.hullId === h.id} className={state.draft.hullId === h.id ? 'ss-active' : ''} disabled={busy} onClick={() => state.status === 'accepted' ? void beginEdit('preview').then(() => { if (latest.current.state.status !== 'accepted') step({ type: 'select', hullId: h.id, color: h.color }); }) : step({ type: 'select', hullId: h.id, color: h.color })} aria-label={`${h.name}, ${h.traits.join(', ')}. Hull ${h.maxHull}, ${h.maxWeapons} weapon mounts, ${h.crew} crew${current ? '. Your current ship' : ''}.`}><svg viewBox="0 0 100 60" aria-hidden="true"><path d={hullPath(h.id)} fill={current ? state.draft.color : h.color} stroke="#05071a" strokeWidth={4}/></svg><strong>{h.name}</strong><small>{h.traits.join(', ')}</small><small>{h.maxHull} hull · {h.maxWeapons} mounts · {h.crew} crew</small>{current && <em>{me.ready ? 'Ready ✓' : 'Yours'}</em>}</button></li>; })}</ul>
  </div>;
  const rooms = roomsFromHull(hull), previewCrew: Crew[] = Array.from({ length: Math.min(8, hull.crew) }, (_, i) => { const room = hull.rooms[i % hull.rooms.length]; return { id: `${me.shipId ?? `ship-${me.id}`}-crew-${i}`, species: SPECIES[i % SPECIES.length].id, ownerCaptainId: me.id, homeShipId: 'preview', currentShipId: 'preview', name: ['Ari', 'Bo', 'Cleo', 'Dax', 'Eli', 'Faye', 'Gus', 'Hal'][i], roomId: room.id, x: room.x + room.w / 2, y: room.y + room.h / 2, hp: SPECIES[i % SPECIES.length].maxHp, maxHp: SPECIES[i % SPECIES.length].maxHp, status: 'alive', skill: 'engineer', traits: [], order: { kind: 'hold', roomId: room.id }, activity: 'idle', controlEpoch: 0 }; });
  const accepted = state.status === 'accepted', shownName = state.draft.name.trim() || hull.name;
  return <div className="ss-hangar ss-hangar-preview" data-hangar="preview" data-status={state.status} data-editable={editable} style={{ ['--chip' as string]: state.draft.color }}>
    <PreviewStage hullId={hull.id} rooms={rooms} crew={previewCrew} paint={state.draft.color} viewerId={me.id} captainColor={me.color}/>
    <button type="button" className="ss-float ss-float-back" onClick={() => accepted ? void beginEdit('select') : step({ type: 'back' })} disabled={busy} aria-label={accepted ? 'Choose another hull (withdraws readiness)' : 'Back to hull choices'}>‹ Hulls</button>
    <div className="ss-float ss-float-tools">
      {accepted ? <button type="button" className="ss-tool" onClick={() => void beginEdit('preview')} disabled={busy} aria-label="Change ship: withdraw readiness and edit this ship">Change ship</button>
        : <button type="button" className={`ss-tool ${state.panel === 'customize' ? 'ss-active' : ''}`} onClick={() => step({ type: 'panel', panel: 'customize' })} disabled={busy} aria-expanded={state.panel === 'customize'} aria-haspopup="dialog" aria-label={`Customize ${shownName}: name, paint and stats`}><i className="ss-tool-swatch" style={{ background: state.draft.color }} aria-hidden="true"/>Customize</button>}
      <button type="button" className="ss-tool" onClick={() => setRoster(r => !r)} aria-expanded={roster}>Fleet</button>
    </div>
    <div className="ss-preview-title"><strong>{shownName}</strong><small>{hull.name} · {hull.traits.join(', ')}{accepted ? ' · confirmed' : ''}</small></div>
    {state.panel === 'customize' && <Popover title="Customize" onClose={() => step({ type: 'panel', panel: 'customize' })} className="ss-popover-customize">
      <div className="ss-tabs" role="tablist">{(['paint', 'name', 'stats'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'paint' ? 'Paint' : t === 'name' ? 'Name' : 'Stats'}</button>)}</div>
      {tab === 'paint' && <div className="ss-swatches" role="radiogroup" aria-label="Paint">{[me.color, ...COLORS].filter((c, i, all) => all.indexOf(c) === i).map(c => <button key={c} type="button" role="radio" aria-checked={state.draft.color === c} aria-label={`Paint ${c}`} className={`kp-swatch ${state.draft.color === c ? 'ss-swatch-checked' : ''}`} style={{ background: c }} onClick={() => step({ type: 'paint', color: c })} disabled={busy}/>)}</div>}
      {tab === 'name' && <label>Ship name<TextInput value={state.draft.name} maxLength={16} placeholder={hull.name} onChange={e => step({ type: 'name', name: e.target.value })} disabled={busy}/></label>}
      {tab === 'stats' && <><p>{hull.description}</p><dl className="ss-stats"><dt>Hull</dt><dd>{hull.maxHull}</dd><dt>Weapon mounts</dt><dd>{hull.maxWeapons}</dd><dt>Crew</dt><dd>{hull.crew}</dd><dt>Rooms</dt><dd>{hull.rooms.length}</dd><dt>Systems</dt><dd>{hull.startingSystems.filter(s => !['piloting', 'engines', 'shields', 'weaponry', 'life-support', 'doors', 'medical'].includes(s)).map(s => SYSTEM_DEFS.find(d => d.id === s)?.name ?? s).join(', ') || 'Standard'}</dd><dt>Weapons</dt><dd>{hull.startingWeapons.join(', ')}</dd></dl></>}
    </Popover>}
    {rosterPanel}
    {state.error && <div className="ss-toast ss-toast-error" role="alert">{state.error}</div>}
    {!connected && <div className="ss-toast ss-toast-info" role="status">Reconnecting… confirm when the link returns.</div>}
    <div className="ss-float ss-float-confirm">
      {accepted ? <span className="ss-confirm-note" role="status">Ready ✓ · {readyCount}</span>
        : state.status === 'unreadying' ? <span className="ss-confirm-note" role="status">Withdrawing readiness…</span>
        : state.status === 'error' && state.accepted && sameDraft(state.accepted, normalizeDraft(state.draft, hull.name)) ? <ArcadeButton tone="lime" disabled={busy || !connected} onClick={readyOnly}>Ready to launch<small>ship accepted · retry readiness</small></ArcadeButton>
        : <ArcadeButton tone="sun" disabled={busy || !connected} onClick={confirm} aria-label={`Confirm ${shownName}, a ${hull.name}, and mark ready`}>{busy ? 'Confirming…' : 'Confirm ship'}<small>{busy ? 'waiting for the hangar' : 'takes this hull and marks you ready'}</small></ArcadeButton>}
    </div>
  </div>;
}
function PreviewStage({ hullId, rooms, crew, paint, viewerId, captainColor }: { hullId: string; rooms: ReturnType<typeof roomsFromHull>; crew: Crew[]; paint: string; viewerId: string; captainColor: string }) {
  const { ref, size } = useStage({ w: 640, h: 300 }), fit = fitCutaway(rooms, size, hullId, 10);
  return <div ref={ref} className="ss-preview-stage" data-tile={fit.tile}><svg className="ss-interior-art" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Cutaway of the ${hullId} hull painted ${paint}`}>
    <CutawaySvg fit={fit} rooms={rooms} crew={crew} paint={paint} faction="allied" timeMs={0} viewerId={viewerId} captainColors={new Map([[viewerId, captainColor]])}/>
  </svg></div>;
}
/** Departure and each new sector start with an empty currentBeaconId: every unvisited column-0 beacon is then a legal jump. */
export function beaconOptions(beacons: Beacon[], currentId: string) { const current = currentId ? beacons.find(b => b.id === currentId) : null; return current ? current.next.map(id => beacons.find(b => b.id === id)).filter((b): b is Beacon => !!b) : beacons.filter(b => b.column === 0 && !b.visited); }
export const beaconKind = (b: Beacon) => b.kind === 'exit' ? 'Sector exit' : b.kind === 'store' ? 'Station · refit and trade' : b.kind === 'combat' ? 'Hostile signal' : 'Unknown signal';
export function RoutePanel({ screen }: { screen: Screen }) {
  const { world, submit, captainId } = screen, pub = world.publicView, options = beaconOptions(pub.beacons, pub.currentBeaconId), me = pub.captains.find(c => c.id === captainId), leader = pub.leaderCaptainId === captainId;
  const voted = options.find(b => b.id === me?.vote) ?? null, votes = (id: string) => pub.captains.filter(c => c.vote === id), active = pub.captains.filter(c => c.status !== 'spectator'), solo = active.length <= 1;
  return <div className="ss-route-full" data-voted={voted ? beaconCode(voted) : ''}>
    <div className="ss-route-map-column"><span className="kp-eyebrow">{pub.sector.name} · sector {pub.sector.index}/{pub.sector.count} · threat {Math.round(pub.threat)}</span>
      <RouteMap beacons={pub.beacons} currentId={pub.currentBeaconId} votes={pub.captains} myVote={me?.vote ?? null} compact onSelect={id => submit({ type: 'vote', choiceId: id }, { after: 'stay' })}/>
      <small className="ss-muted">{solo ? 'Your vote jumps the fleet at once.' : leader ? 'Votes that agree jump at once; Jump settles a split vote.' : `${pub.captains.find(c => c.id === pub.leaderCaptainId)?.name ?? 'The leader'} commits the jump when votes agree.`}</small></div>
    <div className="ss-route-choice-column"><strong>{options.length ? 'Choose the next beacon' : 'Waiting for the route'}</strong>
      <ul className="ss-choices ss-route-choices">{options.map(beacon => { const code = beaconCode(beacon), mine = me?.vote === beacon.id, others = votes(beacon.id).filter(c => c.id !== captainId); return <li key={beacon.id} className={`ss-kind-${beacon.kind} ${mine ? 'ss-voted' : ''}`}><button type="button" aria-pressed={mine} className={mine ? 'ss-active' : ''} onClick={() => submit({ type: 'vote', choiceId: beacon.id }, { after: 'stay' })} aria-label={`${solo ? 'Jump to' : 'Vote for'} ${code}, ${beacon.label}, ${beaconKind(beacon)}${beacon.visited ? ', visited' : ''}${votes(beacon.id).length ? `, ${votes(beacon.id).length} vote${votes(beacon.id).length === 1 ? '' : 's'}` : ''}`}><b className="ss-code">{code}</b><span><strong>{beacon.label}</strong><small>{beaconKind(beacon)}{beacon.visited ? ' · visited' : ''}</small><em>{mine ? 'your vote' : ''}{others.length ? `${mine ? ' · ' : ''}${others.map(c => c.name).join(', ')}` : ''}</em></span></button></li>; })}{!options.length && <li><StatusNotice>Waiting for the fleet’s next route.</StatusNotice></li>}</ul>
      {leader && !solo && <ArcadeButton tone="sun" disabled={!voted} onClick={() => voted && submit({ type: 'commitChoice', choiceId: voted.id }, { after: 'stay', success: `Jumping to ${beaconCode(voted)} · ${voted.label}` })} aria-label={voted ? `Jump to ${beaconCode(voted)}, ${voted.label}` : 'Jump: vote for a beacon first'}>{voted ? `Jump to ${beaconCode(voted)}` : 'Jump'}<small>{voted ? `${voted.label} · commits the fleet` : 'vote for a beacon first'}</small></ArcadeButton>}
      {!leader && !solo && voted && <span className="ss-confirm-note" role="status">Voted {beaconCode(voted)} · waiting for the fleet</span>}
    </div>
  </div>;
}
type RouteMapProps = { beacons: Beacon[]; currentId: string; votes: { vote: string | null; color: string; name?: string }[]; height?: number; width?: number; labels?: boolean; compact?: boolean; myVote?: string | null; onSelect?(id: string): void };
/** Space map: nebula depth, connected lanes, jump range and stable location codes. Reachable nodes are native buttons; state is shown by shape and text, not color alone. */
export function RouteMap({ beacons, currentId, votes, height, width: widthProp, labels = false, compact = false, myVote = null, onSelect }: RouteMapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ''), columns = Math.max(1, ...beacons.map(b => b.column + 1)), lanes = Math.max(1, ...beacons.map(b => b.lane + 1));
  // Compact phone maps use a logical width that follows the column count so codes stay legible when the map is only a few hundred pixels wide.
  const width = widthProp ?? (compact ? 56 + columns * 66 : 720), H = height ?? (compact ? 64 + (lanes - 1) * 56 : Math.min(300, 104 + (lanes - 1) * 84)), pad = labels ? 64 : compact ? 34 : 24, bottom = labels ? 52 : compact ? 26 : 32;
  const cx = (b: Beacon) => pad + b.column * ((width - pad * 2) / Math.max(1, columns - 1)), cy = (b: Beacon) => 30 + b.lane * ((H - 30 - bottom) / Math.max(1, lanes - 1));
  const reachable = new Set(beaconOptions(beacons, currentId).map(b => b.id)), current = beacons.find(b => b.id === currentId), state = (b: Beacon) => beaconState(b, currentId, reachable);
  const stars = Array.from({ length: 36 }, (_, i) => { const s = Math.sin(i * 12.9898 + beacons.length) * 43758.5453; return { x: ((s - Math.floor(s)) * width), y: ((Math.cos(i * 78.233) * 0.5 + 0.5) * H), r: .6 + (i % 3) * .5 }; });
  const node = (b: Beacon, st: BeaconState) => { const x = cx(b), y = cy(b), r = st === 'current' ? 11 : st === 'reachable' ? 9 : st === 'visited' ? 7 : 5, kindFill = b.kind === 'exit' ? '#78d955' : b.kind === 'store' ? '#28c6e7' : b.kind === 'combat' ? '#ff5748' : '#a9b3e6';
    if (st === 'current') return <><path d={`M${x} ${y - r - 3} L${x + r + 3} ${y} L${x} ${y + r + 3} L${x - r - 3} ${y} Z`} fill="#ffd24a" stroke="#05071a" strokeWidth={2}/><circle cx={x} cy={y} r={r + 9} fill="none" stroke="#ffd24a" strokeOpacity=".5" strokeWidth={1.5}/></>;
    if (st === 'visited') return <><circle cx={x} cy={y} r={r} fill="#0b1030" stroke="#a9b3e6" strokeWidth={2}/><text x={x} y={y + 3.5} textAnchor="middle" className="ss-route-check" fill="#a9b3e6">✓</text></>;
    if (st === 'locked') return <circle cx={x} cy={y} r={r} fill="#3a3f5a" stroke="#05071a" strokeWidth={1.5}/>;
    return <><circle cx={x} cy={y} r={r + 7} fill="none" stroke={myVote === b.id ? '#ffd24a' : '#fff6e5'} strokeWidth={myVote === b.id ? 3 : 1.5} strokeDasharray={myVote === b.id ? undefined : '4 3'}/><circle cx={x} cy={y} r={r} fill={kindFill} stroke="#05071a" strokeWidth={2}/></>; };
  return <div className={`ss-route-map ${onSelect ? 'ss-route-map-live' : ''}`} style={{ aspectRatio: `${width} / ${H}` }}>
    <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`Route map: ${beacons.length} beacons, ${reachable.size} within jump range${current ? `, fleet at ${beaconCode(current)}` : ', at departure'}`}>
      <defs><radialGradient id={`ss-neb-a-${uid}`} cx=".2" cy=".3" r=".7"><stop offset="0" stopColor="#3b2f8a" stopOpacity=".55"/><stop offset="1" stopColor="#3b2f8a" stopOpacity="0"/></radialGradient><radialGradient id={`ss-neb-b-${uid}`} cx=".8" cy=".8" r=".6"><stop offset="0" stopColor="#8a2f4b" stopOpacity=".45"/><stop offset="1" stopColor="#8a2f4b" stopOpacity="0"/></radialGradient></defs>
      <rect width={width} height={H} fill="#070a22" rx={10}/><rect width={width} height={H} fill={`url(#ss-neb-a-${uid})`} rx={10}/><rect width={width} height={H} fill={`url(#ss-neb-b-${uid})`} rx={10}/>
      {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff6e5" opacity={.35 + (i % 4) * .15}/>)}
      {current && <circle cx={cx(current)} cy={cy(current)} r={Math.max(...beacons.filter(b => reachable.has(b.id)).map(b => Math.hypot(cx(b) - cx(current), cy(b) - cy(current))), 40) + 22} fill="#ffd24a" fillOpacity=".05" stroke="#ffd24a" strokeOpacity=".25" strokeDasharray="6 6"/>}
      {beacons.flatMap(b => b.next.map(id => { const n = beacons.find(x => x.id === id); if (!n) return null; const live = b.id === currentId || (!currentId && b.column === 0 && false); return <line key={b.id + id} x1={cx(b)} y1={cy(b)} x2={cx(n)} y2={cy(n)} stroke={live ? '#ffd24a' : '#fff6e5'} strokeOpacity={live ? .95 : .18} strokeWidth={live ? 3 : 1.5} strokeDasharray={live ? undefined : '5 5'}/>; }))}
      {beacons.map(b => { const st = state(b), x = cx(b), y = cy(b), r = st === 'current' ? 11 : st === 'reachable' ? 9 : st === 'visited' ? 7 : 5, voters = votes.filter(v => v.vote === b.id); return <g key={b.id} data-beacon={b.id} data-code={beaconCode(b)} data-state={st}>{node(b, st)}
        <text x={x} y={y - r - (st === 'reachable' || st === 'current' ? 12 : 8)} textAnchor="middle" className={`ss-route-code ${st === 'locked' ? 'ss-route-code-dim' : ''}`} fill={st === 'locked' ? '#6f77a8' : st === 'current' || myVote === b.id ? '#ffd24a' : '#fff6e5'}>{beaconCode(b)}</text>
        {labels && (st === 'reachable' || st === 'current') && <text x={x} y={y + r + 14} textAnchor="middle" className="ss-route-label" fill="#fff6e5">{b.label}</text>}
        {labels && <text x={x} y={y + r + (st === 'reachable' || st === 'current' ? 26 : 14)} textAnchor="middle" className="ss-route-kind" fill="#a9b3e6">{st === 'current' ? 'HERE' : st === 'visited' ? 'VISITED' : st === 'locked' ? b.kind.toUpperCase() : myVote === b.id ? 'YOUR VOTE' : b.kind.toUpperCase()}</text>}
        {compact && st !== 'locked' && <text x={x} y={y + r + 12} textAnchor="middle" className="ss-route-kind" fill="#a9b3e6">{st === 'current' ? 'HERE' : st === 'visited' ? 'SEEN' : myVote === b.id ? 'VOTED' : b.kind.toUpperCase()}</text>}
        {voters.map((v, i) => <circle key={i} cx={x + r + 6 + i * 9} cy={y - r - 2} r={4} fill={v.color} stroke="#05071a"/>)}</g>; })}
    </svg>
    {onSelect && beacons.filter(b => reachable.has(b.id)).map(b => <button key={b.id} type="button" className={`ss-route-node ${myVote === b.id ? 'ss-active' : ''}`} style={{ left: `${cx(b) / width * 100}%`, top: `${cy(b) / H * 100}%` }} aria-pressed={myVote === b.id} aria-label={`${beaconCode(b)} ${b.label}, ${beaconKind(b)}${b.visited ? ', visited' : ''}`} onClick={() => onSelect(b.id)}/>)}
  </div>;
}
export function EventPanel({ screen }: { screen: Screen }) {
  const { world, submit, captainId } = screen, pub = world.publicView, event = pub.event, me = pub.captains.find(c => c.id === captainId), leader = pub.leaderCaptainId === captainId;
  if (!event) return <StatusNotice>Waiting for the fleet.</StatusNotice>;
  return <div className="ss-drawer-stack ss-event"><span className="kp-eyebrow">{pub.sector.name}</span><strong>{event.title}</strong><p className="ss-event-text">{event.text}</p>
    {event.resolved ? <><p className="ss-event-result">{event.result}</p>{me?.ready ? <span className="ss-confirm-note" role="status" data-waiting="true">Ready ✓ · waiting for {pub.captains.filter(c => c.status !== 'spectator' && !c.ready).length} more ({pub.captains.filter(c => c.status !== 'spectator' && c.ready).length}/{pub.captains.filter(c => c.status !== 'spectator').length})</span> : <ArcadeButton tone="sun" size="sm" onClick={() => submit({ type: 'continue' }, { after: 'stay' })}>Continue</ArcadeButton>}</>
      : <ul className="ss-choices">{event.choices.map(choice => { const voters = pub.captains.filter(c => c.vote === choice.id);
        return <li key={choice.id} className={choice.special ? 'ss-special' : ''}><button type="button" disabled={!choice.available} aria-pressed={me?.vote === choice.id} className={me?.vote === choice.id ? 'ss-active' : ''} onClick={() => submit({ type: 'vote', choiceId: choice.id }, { after: 'stay' })}>
          <strong>{choice.special ? '★ ' : ''}{choice.label}</strong><small>{choice.text}</small>{choice.requirement && <small className="ss-req">{choice.available ? 'Available: ' : 'Needs: '}{choice.requirement}</small>}{choice.cost > 0 && <small className="ss-req">Costs {choice.cost} scrap from a contributor</small>}<em>{voters.map(c => c.name).join(', ')}{choice.contributors.length ? ` · backed by ${choice.contributors.map(id => pub.captains.find(c => c.id === id)?.name ?? id).join(', ')}` : ''}</em></button>
          {(choice.requirement || choice.cost > 0) && <ArcadeButton tone={choice.contributors.includes(captainId) ? 'lime' : 'grape'} size="sm" aria-pressed={choice.contributors.includes(captainId)} onClick={() => submit({ type: 'contribute', choiceId: choice.id }, { after: 'stay', success: 'Contribution offered' })}>{choice.contributors.includes(captainId) ? 'Contributing' : 'Contribute'}</ArcadeButton>}
          {leader && <ArcadeButton tone="sun" size="sm" disabled={!choice.available} onClick={() => submit({ type: 'commitChoice', choiceId: choice.id }, { after: 'stay' })}>Commit</ArcadeButton>}</li>; })}
        {!event.choices.length && <li><ArcadeButton tone="sun" size="sm" onClick={() => submit({ type: 'continue' }, { after: 'stay' })}>Continue</ArcadeButton></li>}</ul>}
    <small className="ss-muted">{leader ? 'You commit the fleet’s choice.' : 'Votes show on the TV; the leader commits.'}</small>
  </div>;
}
function ItemCard({ item, action, label, tone = 'sun', disabled, note }: { item: ItemView; action(): void; label: string; tone?: 'sun' | 'lime' | 'coral' | 'ghost' | 'sky' | 'grape'; disabled?: boolean; note?: string }) {
  const kindNote = item.kind === 'drone' ? 'launches from cargo' : item.kind === 'system' ? 'installs into a bay' : item.kind === 'augment' ? 'passive once installed' : 'mounts on weaponry';
  return <li className="ss-item"><div><strong>{item.name}</strong><small>{item.kind} · {note ?? kindNote}</small><p>{item.description}</p></div><ArcadeButton tone={tone} size="sm" disabled={disabled} onClick={action} aria-label={`${label} ${item.name}`}>{label}</ArcadeButton></li>;
}
export function LootPanel({ screen }: { screen: Screen }) {
  const { world, submit, captainId } = screen, pub = world.publicView, priv = world.privateView, me = pub.captains.find(c => c.id === captainId), carrier = pub.ships.find(s => s.id === priv.cargoShipId);
  const allied = pub.ships.filter(s => s.faction === 'allied' && s.status === 'active');
  return <div className="ss-drawer-stack ss-loot"><span className="kp-eyebrow">Rewards · {priv.wallet} scrap</span><strong>{pub.loot.length ? 'Tap an item to take it' : 'Everything has been collected'}</strong>
    <ul className="ss-items">{pub.loot.map(item => <ItemCard key={item.id} item={item} label="Take" action={() => submit({ type: 'collectItem', itemId: item.id, version: item.version }, { after: 'stay', success: `${item.name} is yours` })} disabled={!priv.canAct}/>)}</ul>
    <small className="ss-muted">Cargo goes to {carrier ? shipLabel(carrier, pub.ships) : 'no surviving carrier'}.{allied.length > 1 ? ' Change:' : ''}</small>
    {allied.length > 1 && <div className="ss-inline">{allied.map(s => <ArcadeButton key={s.id} tone={s.id === priv.cargoShipId ? 'lime' : 'ghost'} size="sm" aria-pressed={s.id === priv.cargoShipId} onClick={() => submit({ type: 'transferCargo', itemId: null, shipId: s.id }, { after: 'stay' })}>{s.name}</ArcadeButton>)}</div>}
    {priv.inventory.filter(i => i.location === 'cargo').length > 0 && <small className="ss-muted">Cargo: {priv.inventory.filter(i => i.location === 'cargo').map(i => i.name).join(', ')}</small>}
    <small className="ss-muted ss-discard">Unclaimed items are discarded when the fleet leaves.</small>
    <ArcadeButton tone={me?.ready ? 'lime' : 'sun'} aria-pressed={me?.ready} onClick={() => submit({ type: 'ready' }, { after: 'stay' })}>{me?.ready ? 'Ready ✓' : 'Done here'}</ArcadeButton>
  </div>;
}
export function StorePanel({ screen }: { screen: Screen }) {
  const { world, submit, captainId, own } = screen, pub = world.publicView, priv = world.privateView, me = pub.captains.find(c => c.id === captainId), ownShip = priv.ownShip;
  const [tab, setTab] = useState<'buy' | 'cargo' | 'ship' | 'crew'>('buy'), [replace, setReplace] = useState<string | null>(null), [skill, setSkill] = useState<Crew['skill']>('engineer'), [species,setSpecies]=useState<NonNullable<Crew['species']>>('human');
  const cargo = priv.inventory.filter(i => i.location === 'cargo'), installed = priv.inventory.filter(i => i.location === 'installed' && i.carrierShipId === own), hull = ownShip ? priv.hulls.find(h => h.id === ownShip.ship.hullId) : null;
  const weaponTier = ownShip?.rooms.find(r => r.system === 'weaponry')?.tier ?? 1, weaponsFull = ownShip ? ownShip.weapons.length >= Math.min(weaponTier, hull?.maxWeapons ?? weaponTier) : true;
  const replaced = installed.find(i => i.id === replace) ?? null, replacementFor = (item: ItemView) => replaced && replaced.kind === item.kind ? replaced.id : null;
  return <div className="ss-drawer-stack ss-store"><span className="kp-eyebrow">Store · {priv.wallet} scrap{ownShip ? ` · ammo ${ownShip.ammo}` : ''}</span>
    <div className="ss-tabs" role="tablist">{(['buy', 'cargo', 'ship', 'crew'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'buy' ? 'Buy' : t === 'cargo' ? `Cargo ${cargo.length}` : t === 'ship' ? 'Ship' : 'Crew'}</button>)}</div>
    {tab === 'buy' && <ul className="ss-items">{priv.store.map(item => <ItemCard key={item.id} item={item} label={`Buy ${item.price}`} disabled={priv.wallet < item.price || !priv.canAct} action={() => submit({ type: 'purchaseItem', itemId: item.id, version: item.version }, { after: 'stay', success: `Bought ${item.name}` })}/>)}{!priv.store.length && <li><small className="ss-muted">Nothing left in stock for you.</small></li>}</ul>}
    {tab === 'cargo' && <>
      {ownShip && installed.length > 0 && <div className="ss-inline"><small className="ss-muted">Installed · tap one to replace it when installing the same kind:</small>{installed.map(i => <ArcadeButton key={i.id} tone={replace === i.id ? 'coral' : 'ghost'} size="sm" aria-pressed={replace === i.id} onClick={() => setReplace(replace === i.id ? null : i.id)}>{i.name}<small>{i.kind}</small></ArcadeButton>)}</div>}
      <ul className="ss-items">{cargo.map(item => <li key={item.id} className="ss-item"><div><strong>{item.name}</strong><small>{item.kind} · aboard {pub.ships.find(s => s.id === item.carrierShipId)?.name ?? 'lost carrier'}</small><p>{item.description}</p></div>
        <div className="ss-inline">{item.kind === 'drone' ? <small className="ss-drone-note">Launches from cargo in battle · needs a working drone bay and 1 ammo</small> : <ArcadeButton tone="lime" size="sm" disabled={!ownShip || item.carrierShipId !== own} onClick={() => submit({ type: 'installItem', itemId: item.id, replaceItemId: replacementFor(item) }, { after: 'stay', success: `${item.name} installed` })}>Install{replacementFor(item) ? ` (replace ${replaced!.name})` : item.kind === 'weapon' && weaponsFull ? ' (mounts full)' : ''}</ArcadeButton>}
          <ArcadeButton tone="ghost" size="sm" onClick={() => submit({ type: 'sellItem', itemId: item.id, version: item.version }, { after: 'stay', success: `Sold ${item.name}` })}>Sell {Math.floor(item.price / 2)}</ArcadeButton>
          {own && item.carrierShipId !== own && <ArcadeButton tone="sky" size="sm" onClick={() => submit({ type: 'transferCargo', itemId: item.id, shipId: own }, { after: 'stay' })}>Bring aboard</ArcadeButton>}</div></li>)}{!cargo.length && <li><small className="ss-muted">Cargo is empty. Installed equipment is listed above and can only be sold after you unmount it by replacing it.</small></li>}</ul>
      </>}
    {tab === 'ship' && (ownShip ? <div className="ss-ship-shop"><small className="ss-muted">Hull {Math.round(ownShip.ship.hull)}/{ownShip.ship.maxHull}. Close this panel and tap a room on your ship to upgrade its tier ({upgradeCost(1)} scrap at tier 1, then +15 per tier).</small>
      <ArcadeButton tone="lime" size="sm" disabled={ownShip.ship.hull >= ownShip.ship.maxHull} onClick={() => submit({ type: 'repairHull' }, { after: 'stay', success: 'Hull repaired' })}>Repair hull<small>1 scrap per point, up to 20</small></ArcadeButton>
      <ArcadeButton tone="sky" size="sm" onClick={() => submit({ type: 'buyAmmo' }, { after: 'stay', success: 'Ammunition loaded' })}>Buy ammunition<small>10 scrap for 5</small></ArcadeButton></div> : <StatusNotice>No ship to refit. Cargo can still be carried by allies.</StatusNotice>)}
    {tab === 'crew' && <div className="ss-ship-shop"><small className="ss-muted">{priv.crew.filter(c => c.status === 'alive').length}/8 crew. Recruits are offered by some stations and events.</small>
      <SpeciesSelect value={species} onChange={setSpecies}/><label>Skill<select value={skill} onChange={e => setSkill(e.target.value as Crew['skill'])}>{(['pilot', 'engineer', 'gunner', 'medic', 'fighter', 'scientist'] as const).map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <ArcadeButton tone="grape" size="sm" disabled={priv.wallet < 60} onClick={() => submit({ type: 'recruitCrew', replaceCrewId: null, skill, species }, { after: 'stay', success: 'Recruit welcomed aboard' })}>Recruit {speciesFor(species).name} {skill}<small>60 scrap</small></ArcadeButton>
      {priv.crew.filter(c => c.status === 'alive').length >= 8 && <div className="ss-inline"><small className="ss-muted">Roster full. Replace:</small>{priv.crew.filter(c => c.status === 'alive').map(c => <ArcadeButton key={c.id} tone="ghost" size="sm" onClick={() => submit({ type: 'recruitCrew', replaceCrewId: c.id, skill, species }, { after: 'stay' })}>{c.name}</ArcadeButton>)}</div>}</div>}
    <ArcadeButton tone={me?.ready ? 'lime' : 'sun'} aria-pressed={me?.ready} onClick={() => submit({ type: 'ready' }, { after: 'stay' })}>{me?.ready ? 'Ready ✓' : 'Done shopping'}</ArcadeButton>
  </div>;
}
export function ResultsPanel({ props }: Sender) {
  const pub = props.publicView, priv = props.privateView, me = priv?.captain ?? null;
  return <Panel className="ss-phase ss-results"><span className="kp-eyebrow">{pub.result === 'victory' ? 'Expedition complete' : pub.result === 'defeat' ? 'The fleet was lost' : 'Expedition paused'}</span><h2>{pub.message || (pub.result === 'victory' ? 'Victory' : pub.result === 'defeat' ? 'Defeat' : 'Saved for later')}</h2>
    {me && <p>{me.name}: {me.status === 'active' ? 'ship intact' : me.status === 'shipless' ? `${me.crewCount} crew survived without a ship` : 'eliminated'} · {priv?.wallet ?? 0} scrap</p>}
    <ul className="ss-roster">{pub.captains.map(c => <li key={c.id} style={{ ['--chip' as string]: c.color }}><strong>{c.name}</strong><small>{c.status} · {c.crewCount} crew</small></li>)}</ul></Panel>;
}
