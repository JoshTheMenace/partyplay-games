import type { CaptainView, PublicView } from '../contracts';
import { deriveShip } from '../sim';
import { eventView } from './events';
import { prices } from './fleet';
import { mapView } from './map';
import { shipById, type State } from './state';

/**
 * A 4v4 battle must fit the 24 KB snapshot budget: snapshots (10 Hz) carry at most the 12 newest events of the last 1.5 s,
 * no fallen crew, no sector map nodes or cargo (neither is used in battle), boss phases without their loadouts, and 2-decimal fractions.
 */
const EVENT_WINDOW_MS = 1500, EVENT_CAP = 12;
/** Deep copy for the wire: drops undefined fields and rounds fractions down to 2 decimals (a shown 1 is a full charge). */
const plain = (v: unknown): unknown => typeof v === 'number' ? Number.isInteger(v) ? v : Math.floor(v * 100 + 1e-9) / 100
  : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).flatMap(([k, x]) => x === undefined ? [] : [[k, plain(x)]])) : v;

export function publicView(s: State): PublicView {
  const status = (shipId: string | null): CaptainView['status'] => { const ship = shipById(s, shipId); return ship?.status === 'destroyed' ? 'wrecked' : ship?.hullId === 'lifeboat' ? 'lifeboat' : 'flying'; };
  return plain({
    phase: s.phase, turn: s.turn, settings: s.settings, captains: s.captains.map(c => ({ ...c, cargo: s.combat ? [] : c.cargo, status: status(c.shipId) })),
    ships: s.ships.map(ship => ({ ...ship, phases: ship.phases.map(p => ({ ...p, weapons: [], systems: {} })), ...deriveShip(ship, s) })), crew: s.crew.filter(k => k.state !== 'dead'),
    combat: s.combat && { ...s.combat, events: s.combat.events.filter(e => e.atMs >= s.combat!.t - EVENT_WINDOW_MS).slice(-EVENT_CAP) },
    map: s.combat ? { ...s.map, nodes: [] } : mapView(s.map, s.revealed), sectorIndex: s.sectorIndex, sectorCount: s.sectors.length,
    event: eventView(s), loot: s.loot, store: s.offers && { offers: s.offers, ...prices(s) }, voteDeadline: s.deadline,
    reserves: s.reserves, message: s.message, result: s.result, fleetStats: s.fleetStats,
  } satisfies PublicView) as PublicView;
}
