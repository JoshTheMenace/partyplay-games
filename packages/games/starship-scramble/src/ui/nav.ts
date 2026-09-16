import type { Action, Beacon, Crew, PrivateView, PublicView, ShipSummary, SystemId } from '../contracts';
/** Action without its epoch, distributed across the union so each command keeps its own fields. */
export type Command = Action extends infer A ? A extends Action ? Omit<A, 'epoch'> : never : never;
import { enemyLabel } from '../render/formation';
export type Tool = { type: 'weapon'; weaponId: string; ally: boolean } | { type: 'system'; systemId: SystemId; ally: boolean; self: boolean } | { type: 'drone'; itemId: string; ally: boolean };
export type Nav =
  | { kind: 'interior' } | { kind: 'weapons' } | { kind: 'targets'; tool: Tool } | { kind: 'systems'; tool: Tool; targetShipId: string }
  | { kind: 'crew'; crewId: string; order: Crew['order']['kind'] } | { kind: 'control'; crewId: string }
  | { kind: 'teleport'; crewIds: string[]; targetShipId: string | null } | { kind: 'room'; roomId: string };
export type Notice = { text: string; tone: 'error' | 'success' | 'info'; at: number };
export type Local = { nav: Nav; epoch: number; viewedShipId: string | null; returnShipId: string | null; notice: Notice | null; pending: number; controlSince: number | null };
export type Ack = { at: number; accepted: boolean; reason?: string; after?: 'return' | 'stay' | Nav; success?: string; now: number };
export type Step = { type: 'view'; shipId: string } | { type: 'open'; nav: Nav; now?: number } | { type: 'back' } | { type: 'sent' } | { type: 'ack'; ack: Ack } | { type: 'notice'; notice: Notice | null };
export const initial = (viewedShipId: string | null): Local => ({ nav: { kind: 'interior' }, epoch: 0, viewedShipId, returnShipId: viewedShipId, notice: null, pending: 0, controlSince: null });
/** How long a freshly granted direct control may wait for the snapshot that carries the server's controlledCrewId. */
export const CONTROL_GRACE_MS = 2000;
export const present = (ship: ShipSummary) => ship.status === 'active' || ship.status === 'surrendered';
/** Same identity as the TV: allied ships by name, enemies by stable E-number. */
export const shipLabel = (ship: ShipSummary, ships: ShipSummary[]) => ship.faction === 'enemy' ? enemyLabel(ship, ships) : ship.name;
export function back(nav: Nav): Nav {
  if (nav.kind === 'systems') return { kind: 'targets', tool: nav.tool };
  if (nav.kind === 'targets') return nav.tool.type === 'weapon' ? { kind: 'weapons' } : { kind: 'interior' };
  return { kind: 'interior' };
}
/** Every deliberate navigation bumps the epoch so a late acknowledgement can only complete the request it belongs to. */
export function reduce(local: Local, step: Step): Local {
  switch (step.type) {
    case 'view': return { ...local, epoch: local.epoch + 1, viewedShipId: step.shipId, nav: local.nav.kind === 'targets' || local.nav.kind === 'teleport' ? local.nav : { kind: 'interior' }, returnShipId: local.nav.kind === 'targets' || local.nav.kind === 'teleport' ? local.returnShipId : step.shipId };
    case 'open': {
      const leavingInterior = local.nav.kind === 'interior' || local.nav.kind === 'room' || local.nav.kind === 'crew';
      const next: Local = { ...local, epoch: local.epoch + 1, nav: step.nav, returnShipId: leavingInterior ? local.viewedShipId : local.returnShipId, controlSince: step.nav.kind === 'control' ? step.now ?? Date.now() : local.controlSince };
      if (step.nav.kind === 'systems') next.viewedShipId = step.nav.targetShipId;
      return next;
    }
    case 'back': { const nav = back(local.nav); return { ...local, epoch: local.epoch + 1, nav, viewedShipId: local.nav.kind === 'systems' ? local.returnShipId ?? local.viewedShipId : local.viewedShipId }; }
    case 'sent': return { ...local, pending: local.pending + 1 };
    case 'notice': return { ...local, notice: step.notice };
    case 'ack': {
      const { ack } = step, pending = Math.max(0, local.pending - 1);
      if (!ack.accepted) return { ...local, pending, notice: { text: ack.reason || 'The ship did not accept that order.', tone: 'error', at: ack.now } };
      const notice: Notice | null = ack.success ? { text: ack.success, tone: 'success', at: ack.now } : null;
      if (ack.at !== local.epoch || !ack.after || ack.after === 'stay') return { ...local, pending, notice };
      if (ack.after === 'return') return { ...local, pending, notice, epoch: local.epoch + 1, nav: { kind: 'interior' }, viewedShipId: local.returnShipId ?? local.viewedShipId };
      return { ...local, pending, notice, epoch: local.epoch + 1, nav: ack.after, controlSince: ack.after.kind === 'control' ? ack.now : local.controlSince };
    }
  }
}
export type World = { publicView: PublicView; privateView: PrivateView };
export const ownShipId = (world: World) => world.privateView.captain?.shipId ?? null;
/** Where the viewer's crew live, most crew first; used for My survivors and as the fallback view. */
export function crewShips(world: World) {
  const counts = new Map<string, number>();
  for (const crew of world.privateView.crew) if (crew.status === 'alive') counts.set(crew.currentShipId, (counts.get(crew.currentShipId) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => world.publicView.ships.find(s => s.id === id)).filter((s): s is ShipSummary => !!s && present(s));
}
export function defaultShip(world: World) {
  const own = ownShipId(world), ships = world.publicView.ships;
  return own && ships.some(s => s.id === own && present(s)) ? own : crewShips(world)[0]?.id ?? ships.find(s => s.faction === 'allied' && present(s))?.id ?? ships.find(present)?.id ?? null;
}
/** Runs on every snapshot. Snapshots never navigate forward; they only retire views and selections the world no longer supports. */
export function reconcile(local: Local, world: World, now: number): Local {
  const { publicView: pub, privateView: priv } = world, ships = pub.ships, alive = (id: string) => ships.some(s => s.id === id && present(s));
  let next = local;
  const combat = pub.phase === 'combat';
  if (!next.viewedShipId || !alive(next.viewedShipId)) {
    const fallback = defaultShip(world), lost = next.viewedShipId && ships.some(s => s.id === next.viewedShipId);
    next = { ...next, viewedShipId: fallback, returnShipId: fallback, nav: next.nav.kind === 'targets' || next.nav.kind === 'systems' ? next.nav : { kind: 'interior' }, epoch: next.epoch + 1, notice: lost ? { text: 'That vessel was lost. Showing your surviving crew.', tone: 'info', at: now } : next.notice };
  }
  if (next.returnShipId && !alive(next.returnShipId)) next = { ...next, returnShipId: next.viewedShipId };
  const nav = next.nav;
  if (nav.kind === 'systems' && !alive(nav.targetShipId)) next = { ...next, nav: { kind: 'targets', tool: nav.tool }, epoch: next.epoch + 1, viewedShipId: next.returnShipId ?? next.viewedShipId, notice: { text: 'That target is gone. Choose another.', tone: 'info', at: now } };
  if (nav.kind === 'teleport' && nav.targetShipId && !alive(nav.targetShipId)) next = { ...next, nav: { ...nav, targetShipId: null }, epoch: next.epoch + 1 };
  if ((nav.kind === 'crew' || nav.kind === 'control') && !priv.crew.some(c => c.id === nav.crewId && c.status === 'alive')) next = { ...next, nav: { kind: 'interior' }, epoch: next.epoch + 1, notice: { text: 'That crew member is no longer available.', tone: 'info', at: now } };
  // The server is the authority on direct control. A null grant right after acquisition may just be an older snapshot, so allow a short grace; after that, or on a different crew, release.
  if (nav.kind === 'control' && priv.controlledCrewId !== nav.crewId && (priv.controlledCrewId !== null || now - (next.controlSince ?? 0) > CONTROL_GRACE_MS)) next = { ...next, nav: { kind: 'interior' }, epoch: next.epoch + 1, controlSince: null, notice: { text: 'Direct control ended. Your crew hold position.', tone: 'info', at: now } };
  if (!combat && (nav.kind === 'targets' || nav.kind === 'systems')) next = { ...next, nav: { kind: 'interior' }, epoch: next.epoch + 1, viewedShipId: next.returnShipId ?? next.viewedShipId };
  if (nav.kind === 'control' && !SIM_PHASES.includes(pub.phase)) next = { ...next, nav: { kind: 'interior' }, epoch: next.epoch + 1 };
  if (nav.kind === 'weapons' && !priv.ownShip) next = { ...next, nav: { kind: 'interior' }, epoch: next.epoch + 1 };
  if (next.notice && now - next.notice.at > 6000) next = { ...next, notice: null };
  return next;
}
/** A target picker lists only vessels the selected tool may legally address; the server still validates. */
export function legalTargets(tool: Tool, world: World) {
  const own = ownShipId(world);
  return world.publicView.ships.filter(ship => present(ship) && (tool.type === 'system' && tool.self ? ship.id === own : tool.ally ? ship.faction === 'allied' : ship.faction === 'enemy' && ship.status === 'active'));
}
export const crewLocation = (crew: Crew, world: World) => { const ship = world.publicView.ships.find(s => s.id === crew.currentShipId); return ship ? `${shipLabel(ship, world.publicView.ships)} · ${ship.rooms.find(r => r.id === crew.roomId)?.name ?? crew.roomId}` : 'Unknown'; };
export const SELF_SYSTEMS: SystemId[] = ['cloak', 'point-defense', 'decoy', 'boarding-defense'];
export const HOSTILE_SYSTEMS: SystemId[] = ['hacking', 'tractor', 'scanner'];
export const BASIC_SYSTEMS: SystemId[] = ['piloting', 'engines', 'shields', 'weaponry', 'life-support', 'doors', 'medical', 'teleporter', 'drone-bay'];
export const HOSTILE_DRONES = ['attack', 'board', 'fire', 'ion', 'breach'];
export const seconds = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))}s`;
/** Phases in which the server accepts crew and ship orders, including post-surrender extraction during rewards. */
export const SIM_PHASES: PublicView['phase'][] = ['combat', 'event', 'route', 'store', 'rewards'];
/** Matches the expedition rule exactly: 20 + tier x 15 scrap per room upgrade. */
export const upgradeCost = (tier: number) => 20 + tier * 15;

/** Enemy names may already carry their shared E-label; never print it twice beside the label. */
export const bareName = (ship: Pick<ShipSummary, 'name' | 'faction'>) => ship.faction === 'enemy' ? ship.name.replace(/^E\d+\s*[·:-]\s*/, '') : ship.name;
const hasTeleporter = (world: World, id: string | null | undefined) => !!id && world.publicView.ships.some(s => s.id === id && present(s) && s.faction === 'allied' && s.rooms.some(r => r.system === 'teleporter'));
/** Server rule: the transporter must be at the crew's source or at the destination. Own ship is only a recall fallback. */
export function transporterFor(crewIds: string[], world: World, own: string | null, destinationShipId: string | null = null) {
  const crew = world.privateView.crew.filter(c => crewIds.includes(c.id)), source = crew[0]?.currentShipId;
  if (source && crew.every(c => c.currentShipId === source) && hasTeleporter(world, source)) return source;
  if (hasTeleporter(world, destinationShipId)) return destinationShipId!;
  return hasTeleporter(world, own) ? own : null;
}
/** Drones launch from cargo or the original mount, carried by the own ship, only while the drone bay works. */
export function carriedDrones(world: World) {
  const ship = world.privateView.ownShip; if (!ship) return [];
  const bay = ship.rooms.find(r => r.system === 'drone-bay'), operational = !!ship.systems.some(s => s.id === 'drone-bay') && !!bay && bay.disruptedUntilMs <= world.publicView.timeMs && bay.tier - Math.ceil(bay.damage / 10) > 0;
  return world.privateView.inventory.filter(i => i.kind === 'drone' && (i.location === 'cargo' || i.location === 'installed') && i.carrierShipId === ship.ship.id).map(item => ({ item, operational }));
}
export const OBJECTIVE_LABEL: Record<NonNullable<PublicView['objective']>['kind'], string> = { destroy: 'Defeat the hostile fleet', survive: 'Survive the assault', escape: 'Retreat', defend: 'Defend the objective', finale: 'Finale' };
/** Active allied hulls with no living friendly crew aboard. The server flags them; the fleet cannot jump with one until crew board it or the leader abandons it. */
export const uncrewedAllies = (world: World) => world.publicView.ships.filter(s => s.faction === 'allied' && s.status === 'active' && s.alerts.includes('Uncrewed'));
export const BETWEEN_BATTLES: PublicView['phase'][] = ['route', 'event', 'rewards', 'store'];
/** Inspection ids must always exceed the server's last accepted id, including after a reload that resets local state. */
export const nextRequestId = (local: number, serverLatest: number) => Math.max(local, serverLatest) + 1;
/** Concise, phase-aware context for the TV footer and the personal overview. Never the stale free-form message outside results. */
export function phaseContext(view: PublicView): { title: string; detail: string; hint: string } {
  const active = view.captains.filter(c => c.status !== 'spectator'), ready = active.filter(c => c.ready).length, voted = active.filter(c => c.vote !== null).length;
  switch (view.phase) {
    case 'hangar': return { title: 'Hangar', detail: `${ready}/${active.length} ready to launch`, hint: 'Choose a ship on your phone, then mark ready.' };
    case 'assignment': return { title: 'Crew assignment', detail: `${view.captains.filter(c => c.playerId).length}/${view.captains.length} captains claimed`, hint: 'Tap your saved captain on your phone.' };
    case 'route': { const options = view.currentBeaconId ? view.beacons.find(b => b.id === view.currentBeaconId)?.next.length ?? 0 : view.beacons.filter(b => b.column === 0 && !b.visited).length; return { title: 'Choose the next beacon', detail: `${options} beacon${options === 1 ? '' : 's'} within jump range · ${voted}/${active.length} voted`, hint: 'Vote for a beacon on your phone. The leader commits the jump.' }; }
    case 'event': return view.event ? view.event.resolved ? { title: view.event.title, detail: view.event.result, hint: 'Continue when everyone has read the outcome.' } : { title: view.event.title, detail: view.event.text, hint: view.event.choices.length ? `${voted}/${active.length} voted · the leader commits the fleet’s choice` : 'Read the encounter, then continue.' } : { title: 'Encounter', detail: '', hint: 'Waiting for the fleet.' };
    case 'rewards': return { title: 'Salvage', detail: view.loot.length ? `${view.loot.length} item${view.loot.length === 1 ? '' : 's'} unclaimed · discarded when the fleet leaves` : 'Everything has been collected', hint: `${ready}/${active.length} ready to move on` };
    case 'store': return { title: 'Station', detail: 'Refit, restock and recruit on your phones', hint: `No timer · ${ready}/${active.length} done shopping` };
    case 'combat': return { title: view.objective ? OBJECTIVE_LABEL[view.objective.kind] : 'Battle', detail: view.objective?.description ?? '', hint: view.objective?.description ?? 'Fleet steady' };
    default: return { title: view.result === 'victory' ? 'Expedition complete' : view.result === 'defeat' ? 'The fleet was lost' : 'Expedition paused', detail: view.message, hint: view.message };
  }
}
/** One stable location code per beacon, lane letter then column number, identical on the TV, phone map, cards and the jump button. */
export const beaconCode = (beacon: Pick<Beacon, 'lane' | 'column'>) => `${String.fromCharCode(65 + Math.max(0, Math.min(25, beacon.lane)))}${beacon.column + 1}`;
export type BeaconState = 'current' | 'reachable' | 'visited' | 'locked';
export const beaconState = (beacon: Beacon, currentId: string, reachable: Set<string>): BeaconState => beacon.id === currentId ? 'current' : reachable.has(beacon.id) ? 'reachable' : beacon.visited ? 'visited' : 'locked';
/** Hangar draft flow: choose a hull, preview it, then one Confirm sends chooseHull and, only once that is accepted, ready.
 * Editing an accepted ship is a transaction: re-sending the accepted draft withdraws server readiness first (chooseHull resets ready), and only then is the draft mutable. */
export type HangarDraft = { hullId: string; name: string; color: string };
export type HangarStatus = 'idle' | 'choosing' | 'readying' | 'accepted' | 'unreadying' | 'error';
/** `accepted` remembers the draft the server took, so a withdrawal right after our ready ack sends the right hull even while the snapshot still shows a previous selection. */
export type HangarState = { mode: 'select' | 'preview'; draft: HangarDraft; status: HangarStatus; error: string | null; panel: 'customize' | null; expect: 'ready' | 'notReady' | null; resume: 'select' | 'preview' | null; accepted: HangarDraft | null };
export type HangarEvent = { type: 'select'; hullId: string; color: string } | { type: 'back' } | { type: 'name'; name: string } | { type: 'paint'; color: string } | { type: 'panel'; panel: HangarState['panel'] } | { type: 'confirm' } | { type: 'chosen'; accepted: boolean; reason?: string; sent?: HangarDraft } | { type: 'readied'; accepted: boolean; reason?: string } | { type: 'edit'; target: 'select' | 'preview' } | { type: 'unreadied'; accepted: boolean; reason?: string } | { type: 'retry'; hullName?: string };
export const hangarBusy = (state: HangarState) => state.status === 'choosing' || state.status === 'readying' || state.status === 'unreadying';
/** Only an unaccepted, idle draft may be edited; an accepted ship must pass through the edit transaction first. */
export const hangarEditable = (state: HangarState) => state.status === 'idle' || state.status === 'error';
export const hangarInitial = (draft: HangarDraft, accepted: boolean): HangarState => ({ mode: 'select', draft, status: accepted ? 'accepted' : 'idle', error: null, panel: null, expect: null, resume: null, accepted: accepted ? draft : null });
export function hangarStep(state: HangarState, event: HangarEvent): HangarState {
  switch (event.type) {
    case 'select': return hangarEditable(state) ? { ...state, mode: 'preview', draft: { ...state.draft, hullId: event.hullId, color: state.draft.color || event.color }, status: 'idle', error: null, panel: null } : state;
    case 'back': return hangarBusy(state) || state.status === 'accepted' ? state : { ...state, mode: 'select', panel: null, error: null };
    case 'name': return hangarEditable(state) ? { ...state, status: 'idle', error: null, draft: { ...state.draft, name: event.name.slice(0, 16) } } : state;
    case 'paint': return hangarEditable(state) ? { ...state, status: 'idle', error: null, draft: { ...state.draft, color: event.color } } : state;
    case 'panel': return hangarBusy(state) ? state : { ...state, panel: state.panel === event.panel ? null : event.panel };
    case 'confirm': return hangarBusy(state) || state.status === 'accepted' ? state : { ...state, status: 'choosing', error: null, panel: null };
    // The exact normalised payload the server accepted becomes both the draft and the accepted record, so withdrawal and retry re-send precisely what parseAction already took.
    case 'chosen': return state.status !== 'choosing' ? state : event.accepted ? { ...state, status: 'readying', draft: event.sent ?? state.draft, accepted: { ...(event.sent ?? state.draft) } } : { ...state, status: 'error', error: event.reason || 'The hangar refused that ship. Adjust and confirm again.' };
    // Only a locked readiness attempt may complete; a late ack after the player edited the draft is ignored.
    case 'readied': return state.status !== 'readying' ? state : event.accepted ? { ...state, status: 'accepted', mode: 'preview', expect: 'ready', accepted: state.accepted ?? { ...state.draft } } : { ...state, status: 'error', error: event.reason || 'Your ship was accepted but readiness failed. Tap Ready to launch to retry.' };
    // Retrying readiness locks the controls exactly like the first attempt, so no edit can slip in before the ack.
    case 'retry': return state.status === 'error' && state.accepted !== null && sameDraft(state.accepted, event.hullName ? normalizeDraft(state.draft, event.hullName) : state.draft) ? { ...state, status: 'readying', error: null, panel: null } : state;
    case 'edit': return hangarBusy(state) ? state : state.status === 'accepted' ? { ...state, status: 'unreadying', error: null, panel: null, resume: event.target } : { ...state, mode: event.target, panel: null };
    case 'unreadied': return state.status !== 'unreadying' ? state : event.accepted ? { ...state, status: 'idle', expect: 'notReady', mode: state.resume ?? 'preview', resume: null, accepted: null } : { ...state, status: 'accepted', resume: null, error: event.reason || 'The hangar kept your ship ready. Try again.' };
  }
}
/** The server is the authority on readiness. After our own transition we ignore snapshots that still show the old value; otherwise a reload or an outside change follows the server. */
export function hangarSync(state: HangarState, ready: boolean, authoritative: HangarDraft | null = null): HangarState {
  if (state.expect === 'ready') return ready ? { ...state, expect: null } : state;
  if (state.expect === 'notReady') return ready ? state : { ...state, expect: null };
  if (hangarBusy(state)) return state;
  if (state.status === 'accepted' && !ready) return { ...state, status: 'idle', accepted: null };
  // Readiness appearing from outside (a reload, or a stale flow) adopts the server's ship so an unsent draft is never shown as accepted.
  if (state.status === 'idle' && ready) return { ...state, status: 'accepted', mode: 'preview', draft: authoritative ?? state.draft, accepted: authoritative ?? { ...state.draft } };
  return state;
}
export const sameDraft = (a: HangarDraft, b: HangarDraft) => a.hullId === b.hullId && a.name === b.name && a.color === b.color;
/** The payload actually sent for a draft: a blank or padded name falls back to the hull name, exactly as the confirm button labels it. */
export const normalizeDraft = (draft: HangarDraft, hullName: string): HangarDraft => ({ hullId: draft.hullId, name: draft.name.trim() || hullName, color: draft.color });
/** What withdrawing readiness must re-send: the locally accepted draft first (the ack may precede the snapshot), else the server's ship; null means nothing is ready and the edit needs no transaction. */
export function withdrawalDraft(state: HangarState, ready: boolean, ship: HangarDraft | null): HangarDraft | null {
  if (state.status === 'accepted' && state.accepted) return state.accepted;
  if (ready && ship) return ship;
  if (state.status === 'accepted' && ship) return ship;
  return null;
}
