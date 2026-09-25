/** Hand-built PublicView fixtures for UI development and layout tests. No simulation required. */
import type { CaptainView, Crew, PublicView, ShipView, SystemId } from '../../src/contracts';
import { ENEMY_HULLS, PLAYER_HULLS, hullDef } from '../../src/defs/hulls';
import { roomSlots } from '../../src/defs/geometry';
import { PAINTS } from '../../src/defs/catalog';

const COLORS = [PAINTS[5], PAINTS[1], PAINTS[2], PAINTS[7]];
export function fixtureShip(id: string, hullId: string, faction: 'ally' | 'enemy', slot: number, captainId: string | null, name = hullDef(hullId).name): ShipView {
  const hull = hullDef(hullId);
  const rooms = hull.rooms.map(room => ({ id: room.id, system: room.system, tier: room.system ? hull.startSystems[room.system] ?? 0 : 0, damage: 0, ionMs: 0, fire: 0, breach: false, oxygen: 100, repair: 0 }));
  const levels = Object.fromEntries(rooms.filter(r => r.system && r.tier).map(r => [r.system, r.tier])) as Partial<Record<SystemId, number>>;
  return { id, faction, captainId, enemyId: faction === 'enemy' ? hullId : null, hullId, name, paint: hull.paint, slot, hull: hull.maxHull, maxHull: hull.maxHull,
    shields: levels.shields ?? 0, shieldCharge: 0, tempShield: 0, tempShieldMs: 0, rooms,
    weapons: hull.startWeapons.map((defId, i) => ({ uid: `${id}-w${i}`, defId, charge: (i * .37) % 1, target: null, auto: true, powered: i < (levels.weapons ?? 0) })),
    ammo: hull.startAmmo, augments: [], status: 'active', cloakMs: 0, cloakCooldownMs: 0, teleportCooldownMs: 0, defenseCooldownMs: 0, fleeAtMs: null, phase: 0, phases: [],
    ai: faction === 'enemy' ? 'balanced' : null, fleeBelow: 0, autopilot: false, lastHitBy: null, evasion: 15, maxShields: levels.shields ?? 0, levels };
}
export function fixtureCrew(ship: ShipView, ownerId: string | null, faction: 'ally' | 'enemy' = ship.faction): Crew[] {
  const hull = hullDef(ship.hullId), spec = hull.startCrew.length ? hull.startCrew : [{ species: 'human' as const, role: 'pilot' as const }, { species: 'ember' as const, role: 'soldier' as const }];
  return spec.map((c, i) => { const room = hull.rooms[i % hull.rooms.length], s = roomSlots(room)[0];
    return { id: `${ship.id}-c${i}`, name: ['Ada', 'Bo', 'Cy', 'Dax', 'Eun', 'Fen'][i] ?? `Crew ${i}`, species: c.species, role: c.role, faction, ownerId, shipId: ship.id, roomId: room.id, x: s.x, y: s.y, hp: 70 + i * 10, maxHp: 100, state: 'manning', station: room.id, path: [] }; });
}
/** A combat view with `allies` captains (1–4, one of each hull) against `enemies` enemy hulls. Long names exercise layout limits. */
export function fixtureCombat(allies = 4, enemies = 3, boss = false): PublicView {
  const captains: CaptainView[] = Array.from({ length: allies }, (_, i) => ({ id: `cap${i}`, playerId: `p${i}`, name: ['Captain Longname Q', 'Mira', 'Oskar the Bold', 'Zed'][i].slice(0, 16), color: COLORS[i], connected: true,
    shipId: `ally${i}`, hullId: PLAYER_HULLS[i].id, scrap: 40 + i * 13, ready: false, vote: null, cargo: [], stats: { damage: 0, kills: 0, repairs: 0, scrapEarned: 0, saves: 0 }, status: 'flying' }));
  const ships = captains.map((c, i) => ({ ...fixtureShip(c.shipId!, c.hullId!, 'ally', i, c.id, `${c.name.split(' ')[0]}'s ${PLAYER_HULLS[i].name}`), paint: c.color }));
  const foes = boss ? [fixtureShip('boss', 'flagship', 'enemy', 0, null)] : Array.from({ length: enemies }, (_, i) => fixtureShip(`enemy${i}`, ENEMY_HULLS[i % 5].id, 'enemy', i, null));
  ships.push(...foes);
  ships[0].rooms[0].fire = 2; ships[0].hull -= 7; ships[1].rooms[2].damage = 1; ships[1].rooms[1].breach = true; ships[1].rooms[1].oxygen = 35;
  foes[0].rooms[1].ionMs = 3000; foes[0].shields = Math.max(0, foes[0].maxShields - 1); foes[0].hull = Math.ceil(foes[0].maxHull * .4);
  const crew = ships.flatMap(s => fixtureCrew(s, s.captainId));
  ships[0].weapons[0].target = { shipId: foes[0].id, roomId: foes[0].rooms.find(r => r.system === 'shields')!.id };
  const t = 42000;
  return { phase: 'combat', turn: 7, settings: { difficulty: 'captain', length: 'standard' }, captains, ships, crew,
    combat: { id: 'c1', t, paused: false, pausedBy: null, hazard: 'none', objective: boss ? 'boss' : 'destroy', surviveUntilMs: null, ftl: .6, jumpVotes: [],
      projectiles: [{ id: 'p1', kind: 'laser', weaponId: 'burst-laser', fromShipId: 'ally0', toShipId: foes[0].id, roomId: foes[0].rooms[0].id, mount: 0, launchMs: t - 500, arriveMs: t + 900 },
        { id: 'p2', kind: 'missile', weaponId: 'swift-missile', fromShipId: foes[0].id, toShipId: 'ally0', roomId: 'weapons', mount: 0, launchMs: t - 300, arriveMs: t + 1500 }],
      events: [{ id: 'e1', type: 'hit', atMs: t - 200, shipId: 'ally0', roomId: 'oxygen', amount: 2, fromShipId: foes[0].id }], introUntilMs: 3000, enemyCharge: 1, outcome: null, nextId: 10, rng: 1 },
    map: { sectorId: 'rustbelt', name: 'The Rustbelt', theme: 'rust', nodes: [], currentId: 'n0', armadaCol: 1, columns: 7 }, sectorIndex: 0, sectorCount: 3,
    event: null, loot: null, store: null, voteDeadline: null, reserves: 2, message: '', result: null, fleetStats: { jumps: 5, kills: 3, scrap: 120, lostShips: 0 } };
}
