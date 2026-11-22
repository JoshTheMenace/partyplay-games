/**
 * What travels. Every phone receives the public view ten times a second, so a room's traffic grows with the square of its roster.
 * `rules.publicView` returns a Wire and `rules.playerView` an Own; every screen calls `decode` and `seat` and gets back the PublicView the UI is written against.
 *
 * - Whatever changes rarely (who is aboard, the sector map, the event text, the loot and store cards, the fleet's ship list) sits in the four fields the
 *   manifest's snapshotCache names; the room sends them again only when `rev`, a hash of their content, changes.
 * - Everything else is positional rows instead of keyed objects: about a third of the JSON it replaces.
 * - A single wing's battle is public (the TV draws it). A fleet of several wings shares only `fleet` (hull, shields and state per ship, and the shots in
 *   flight); each phone gets its own wing's engagement, and its captain's cargo, privately.
 */
import type { CaptainView, Combat, CombatEvent, Crew, EventView, FleetShip, FleetShot, Item, Loot, MapNode, Offer, Phase, Projectile, PublicView, ShipStatus, ShipView, WeaponKind } from './contracts';

export type Codec<T> = { en(value: T): unknown; de(wire: any): T };
const raw: Codec<any> = { en: value => value, de: wire => wire };
/** Fixed-order rows. `key?` is an optional field: absent in the object, null on the wire. */
export function rec<T>(keys: string, nested: Record<string, Codec<any>> = {}): Codec<T> {
  const fields = keys.split(' ').map(key => ({ key: key.replace('?', ''), optional: key.endsWith('?') }));
  return {
    en: value => fields.map(f => { const x = (value as Record<string, unknown>)[f.key]; return x === undefined || x === null ? null : (nested[f.key] ?? raw).en(x); }),
    de: row => Object.fromEntries(fields.flatMap((f, i) => f.optional && row[i] === null ? [] : [[f.key, row[i] === null ? null : (nested[f.key] ?? raw).de(row[i])]])) as T,
  };
}
export const list = <T>(c: Codec<T>): Codec<T[]> => ({ en: value => value.map(c.en), de: wire => (wire as unknown[]).map(c.de) });

/** A ship's own fields, in save and wire order; the wire adds the derived ones. */
export const SHIP_KEYS = 'id faction captainId enemyId hullId name paint wing slot hull maxHull shields shieldCharge tempShield tempShieldMs rooms weapons ammo augments status cloakMs cloakCooldownMs teleportCooldownMs defenseCooldownMs fleeAtMs phase phases ai fleeBelow autopilot assist scale lastHitBy';
export const SHIP_PARTS = { rooms: list(rec('id system tier damage ionMs fire breach oxygen repair')), weapons: list(rec('uid defId charge target auto powered', { target: rec('shipId roomId') })) };
const SHIP = rec<ShipView>(`${SHIP_KEYS} evasion maxShields levels`, { ...SHIP_PARTS, phases: list(rec('maxHull weapons systems line')) });
export const CREW = rec<Crew>('id name species role faction ownerId shipId roomId x y hp maxHp state station path beam? back?', { beam: rec('shipId roomId') });
export const SHOT = rec<Projectile>('id kind weaponId fromShipId toShipId roomId mount launchMs arriveMs');
const EVENT = rec<CombatEvent>('id type atMs shipId roomId? amount? weaponId? fromShipId? crewId?');
const COMBAT = rec<Combat>('id t paused pausedBy hazard objective surviveUntilMs ftl jumpVotes projectiles events introUntilMs enemyCharge outcome nextId rng', { projectiles: list(SHOT), events: list(EVENT) });
const NODE = rec<MapNode>('id col row x y kind links visited hazard dest?'), ITEM = rec<Item>('id kind defId ownerId wing?'), OFFER = rec<Omit<Offer, 'soldTo'>>('id kind defId price wing crew?');
const CHOICE = rec<Omit<EventView['choices'][number], 'votes'>>('id label badge available');
const WHO = rec<Pick<CaptainView, 'id' | 'playerId' | 'name' | 'color' | 'wing' | 'shipId' | 'hullId'>>('id playerId name color wing shipId hullId');
const CRAFT = rec<Pick<FleetShip, 'id' | 'wing' | 'faction' | 'captainId' | 'hullId' | 'name' | 'paint' | 'slot' | 'maxHull' | 'phases'>>('id wing faction captainId hullId name paint slot maxHull phases');
const STATS = ['damage', 'kills', 'repairs', 'scrapEarned', 'saves'] as const, STATUS: ShipStatus[] = ['active', 'destroyed', 'fled'], SEAT: CaptainView['status'][] = ['flying', 'wrecked', 'lifeboat'];
const KINDS: WeaponKind[] = ['laser', 'missile', 'beam', 'ion', 'flak', 'support'];

export type Wire = {
  /** Read without decoding (the shell's portrait rule). */ phase: Phase;
  /** Content hash of the four cached fields below. */ rev: number; who: unknown[]; map: unknown[]; scene: unknown[]; craft: unknown[] | null;
  live: unknown[]; caps: unknown[][]; claims: Loot['claims'] | null; sold: [offer: number, captain: string][] | null;
  ships: unknown[]; crew: unknown[]; combat: unknown | null; fleet: [ships: number[][], shots: unknown[][]] | null;
};
/** A seat's private share: its captain, its cargo, and in a fleet of several wings its own wing's engagement. */
export type Own = { captainId: string | null; cargo: unknown[]; wing: [ships: unknown[], crew: unknown[], projectiles: unknown[], events: unknown[]] | null };
type WingDetail = { ships: ShipView[]; crew: Crew[]; projectiles: Projectile[]; events: CombatEvent[] };

/** Two 26-bit string hashes side by side: a revision that follows the content, so it survives a loaded save and cannot repeat by accident. */
function revision(text: string) {
  let a = 0x811c9dc5, b = 0x1b873593;
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); a = Math.imul(a ^ ch, 16777619); b = Math.imul(b + ch, 0x5bd1e995) ^ b >>> 13; }
  return (a >>> 6) * 0x4000000 + (b >>> 6);
}

export function encode(v: PublicView): Wire {
  const over = v.phase === 'over' || v.result !== null, index = new Map(v.fleet?.ships.map((ship, i) => [ship.id, i]));
  const who = [v.settings, v.sectorIndex, v.sectorCount, v.captains.map(WHO.en), over ? v.captains.map(c => STATS.map(k => c.stats[k])) : null, v.route];
  const { nodes, ...sector } = v.map, map = [sector, nodes.map(NODE.en)];
  const scene = [v.event && { id: v.event.id, title: v.event.title, text: v.event.text, result: v.event.result, resultLines: v.event.resultLines, choices: v.event.choices.map(CHOICE.en) },
    v.loot && [v.loot.scrapEach, v.loot.items.map(ITEM.en)], v.store && [v.store.repairPrice, v.store.ammoPrice, v.store.offers.map(OFFER.en)]];
  const craft = v.fleet && v.fleet.ships.map(CRAFT.en);
  return {
    phase: v.phase, rev: revision(JSON.stringify([who, map, scene, craft])), who, map, scene, craft,
    live: [v.turn, v.message, v.result, v.reserves, v.voteDeadline, v.fleetStats.jumps, v.fleetStats.kills, v.fleetStats.scrap, v.fleetStats.lostShips],
    caps: v.captains.map(c => [+c.connected | +c.ready << 1 | SEAT.indexOf(c.status) << 2, c.scrap, c.vote]),
    claims: v.loot && v.loot.claims, sold: v.store && v.store.offers.flatMap((o, i): [number, string][] => o.soldTo ? [[i, o.soldTo]] : []),
    ships: v.ships.map(SHIP.en), crew: v.crew.map(CREW.en), combat: v.combat && COMBAT.en(v.combat),
    fleet: v.fleet && [v.fleet.ships.map(s => [s.hull, s.shields, s.maxShields, STATUS.indexOf(s.status) | +s.cloaked << 2 | +s.fleeing << 3 | Math.min(15, s.fires) << 4 | s.phase << 8]),
      v.fleet.shots.map(p => [KINDS.indexOf(p.kind), index.get(p.fromShipId) ?? -1, index.get(p.toShipId) ?? -1, p.launchMs, p.arriveMs])],
  };
}
export const encodeOwn = (captainId: string | null, cargo: readonly Item[], wing: WingDetail | null): Own =>
  ({ captainId, cargo: cargo.map(ITEM.en), wing: wing && [wing.ships.map(SHIP.en), wing.crew.map(CREW.en), wing.projectiles.map(SHOT.en), wing.events.map(EVENT.en)] });

const decoded = new WeakMap<Wire, PublicView>();
/** The view model back from the wire (memoised per snapshot object: several components decode the same one). */
export function decode(w: Wire): PublicView {
  const hit = decoded.get(w); if (hit) return hit;
  const [settings, sectorIndex, sectorCount, who, stats, route] = w.who as [PublicView['settings'], number, number, unknown[], number[][] | null, string[]];
  const [turn, message, result, reserves, voteDeadline, jumps, kills, scrap, lostShips] = w.live as [number, string, PublicView['result'], number, number | null, number, number, number, number];
  const captains = who.map((row, i): CaptainView => { const [bits, scrap, vote] = w.caps[i] as [number, number, string | null];
    return { ...WHO.de(row), connected: !!(bits & 1), ready: !!(bits & 2), status: SEAT[bits >> 2], scrap, vote, cargo: [], stats: Object.fromEntries(STATS.map((k, j) => [k, stats?.[i][j] ?? 0])) as CaptainView['stats'] }; });
  const [event, loot, store] = w.scene as [Omit<EventView, 'choices' | 'deadlineMs'> & { choices: unknown[] } | null, [number, unknown[]] | null, [number, number, unknown[]] | null];
  const sold = new Map(w.sold), craft = w.craft?.map(CRAFT.de) ?? [], [sector, nodes] = w.map as [Omit<PublicView['map'], 'nodes'>, unknown[]];
  const view: PublicView = {
    phase: w.phase, turn, settings, captains, ships: w.ships.map(SHIP.de), crew: w.crew.map(CREW.de), combat: w.combat ? COMBAT.de(w.combat) : null,
    fleet: w.fleet && { ships: craft.map((ship, i): FleetShip => { const [hull, shields, maxShields, bits] = w.fleet![0][i]; return { ...ship, hull, shields, maxShields, status: STATUS[bits & 3], cloaked: !!(bits & 4), fleeing: !!(bits & 8), fires: bits >> 4 & 15, phase: bits >> 8 }; }),
      shots: w.fleet[1].flatMap((row, i): FleetShot[] => { const [kind, from, to, launchMs, arriveMs] = row as number[];
        return craft[from] && craft[to] ? [{ id: `${from}:${to}:${launchMs}:${i}`, kind: KINDS[kind], fromShipId: craft[from].id, toShipId: craft[to].id, launchMs, arriveMs }] : []; }) },
    map: { ...sector, nodes: nodes.map(NODE.de) }, sectorIndex, sectorCount, route,
    event: event && { ...event, deadlineMs: voteDeadline, choices: event.choices.map(row => { const choice = CHOICE.de(row); return { ...choice, votes: captains.filter(c => c.vote === choice.id).map(c => c.id) }; }) },
    loot: loot && { scrapEach: loot[0], items: loot[1].map(ITEM.de), claims: w.claims ?? {} },
    store: store && { repairPrice: store[0], ammoPrice: store[1], offers: store[2].map((row, i) => ({ ...OFFER.de(row), soldTo: sold.get(i) ?? null })) },
    voteDeadline, reserves, message, result, fleetStats: { jumps, kills, scrap, lostShips },
  };
  decoded.set(w, view); return view;
}

let last: { view: PublicView; own: Own; seat: PublicView } | null = null;
/** The view for one seat: the public view plus what only that seat is sent (its cargo, and its own wing's engagement in a fleet of several wings). */
export function seat(view: PublicView, own: Own | null): PublicView {
  if (!own || !own.cargo.length && !own.wing) return view;
  if (last?.view === view && last.own === own) return last.seat;
  const cargo = own.cargo.map(ITEM.de), [ships, crew, projectiles, events] = own.wing ?? [];
  const mine: PublicView = { ...view, captains: view.captains.map(c => c.id === own.captainId ? { ...c, cargo } : c),
    ...ships && crew && { ships: ships.map(SHIP.de), crew: crew.map(CREW.de), combat: view.combat && { ...view.combat, projectiles: projectiles!.map(SHOT.de), events: events!.map(EVENT.de) } } };
  last = { view, own, seat: mine }; return mine;
}
