import type { CaptainView, FleetShip, PublicView, Ship, ShipView } from '../contracts';
import { sectorDef } from '../content/sectors';
import { deriveShip } from '../sim';
import { level } from '../sim/core';
import { eventView } from './events';
import { prices } from './fleet';
import { mapView } from './map';
import { runDepth, shipById, wings, type State } from './state';

/**
 * A wing's battle must fit the 24 KB snapshot budget before packing: views carry at most the 12 newest events of the last 1.5 s,
 * no fallen crew, no sector map nodes or cargo in battle (neither is used there), boss phases without their loadouts, and 2-decimal fractions.
 */
const EVENT_WINDOW_MS = 1500, EVENT_CAP = 12;
/** Deep copy for the wire: drops undefined fields and rounds fractions down to 2 decimals (a shown 1 is a full charge). */
const plain = (v: unknown): unknown => typeof v === 'number' ? Number.isInteger(v) ? v : Math.floor(v * 100 + 1e-9) / 100
  : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).flatMap(([k, x]) => x === undefined ? [] : [[k, plain(x)]])) : v;
const shipView = (s: State, ship: Ship): ShipView => ({ ...ship, phases: ship.phases.map(p => ({ ...p, weapons: [], systems: {} })), ...deriveShip(ship, s) });

/**
 * What one engagement's screens see: its ships (and the Flagship), the crew aboard them and the shots and events among them. `wing` null is everything.
 * The Flagship is in every wing's view, so what other wings do to it stays out: only shots and events between ships of this view count.
 */
function detail(s: State, wing: number | null) {
  const ships = s.ships.filter(ship => wing === null || ship.wing === wing || ship.wing < 0), here = new Set(ships.map(ship => ship.id)), c = s.combat;
  return { ships: ships.map(ship => shipView(s, ship)), crew: s.crew.filter(k => k.state !== 'dead' && here.has(k.shipId)),
    projectiles: c ? c.projectiles.filter(p => here.has(p.toShipId) && here.has(p.fromShipId)) : [],
    events: c ? c.events.filter(e => e.atMs >= c.t - EVENT_WINDOW_MS && here.has(e.shipId) && (!e.fromShipId || here.has(e.fromShipId))).slice(-EVENT_CAP) : [] };
}
export type WingView = ReturnType<typeof detail>;
/** A phone's private share of a fleet of several wings: its own wing's engagement in full. */
export const wingView = (s: State, wing: number) => plain(detail(s, wing)) as WingView;

const fleetShip = (ship: Ship): FleetShip => { const shields = ship.rooms.find(r => r.system === 'shields' && r.tier);
  return { id: ship.id, wing: ship.wing, faction: ship.faction, captainId: ship.captainId, hullId: ship.hullId, name: ship.name, paint: ship.paint, slot: ship.slot, hull: ship.hull, maxHull: ship.maxHull,
    shields: ship.shields + ship.tempShield, maxShields: (shields ? level(shields) : 0) * ship.scale, status: ship.status, phase: ship.phase, phases: ship.phases.length, cloaked: ship.cloakMs > 0, fleeing: ship.fleeAtMs !== null,
    fires: ship.rooms.filter(r => r.fire > 0).length }; };

/**
 * The view model the UI is written against. A single wing gets the whole battle in detail; a fleet of several wings gets `fleet` (every ship,
 * no interiors) and leaves `ships`, `crew` and the battle's shots and events to each phone's wingView.
 */
export function publicView(s: State): PublicView {
  const status = (shipId: string | null): CaptainView['status'] => { const ship = shipById(s, shipId); return ship?.status === 'destroyed' ? 'wrecked' : ship?.hullId === 'lifeboat' ? 'lifeboat' : 'flying'; };
  const wide = wings(s) > 1, d = wide ? { ships: [], crew: [], projectiles: [], events: [] } : detail(s, null);
  return plain({
    phase: s.phase, turn: s.turn, settings: s.settings, captains: s.captains.map(c => ({ ...c, cargo: s.combat ? [] : c.cargo, status: status(c.shipId) })),
    ships: d.ships, crew: d.crew,
    fleet: wide ? { ships: s.ships.map(fleetShip), shots: (s.combat?.projectiles ?? []).map(p => ({ id: p.id, kind: p.kind, fromShipId: p.fromShipId, toShipId: p.toShipId, launchMs: p.launchMs, arriveMs: p.arriveMs })) } : null,
    combat: s.combat && { ...s.combat, projectiles: d.projectiles, events: d.events },
    map: s.combat ? { ...s.map, nodes: [] } : mapView(s.map, s.revealed), sectorIndex: s.sectorIndex, sectorCount: runDepth(s), route: s.sectors.map(id => sectorDef(id).name),
    event: eventView(s), loot: s.loot, store: s.offers && { offers: s.offers, ...prices(s) }, voteDeadline: s.deadline,
    reserves: s.reserves, message: s.message, result: s.result, fleetStats: s.fleetStats,
  } satisfies PublicView) as PublicView;
}
