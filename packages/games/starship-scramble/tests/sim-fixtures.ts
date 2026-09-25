/** Small world builders for the simulation tests. */
import type { Crew, CrewRole, Hazard, Projectile, Ship, SpeciesId } from '../src/contracts';
import { ENEMIES } from '../src/content/enemies';
import { weaponDef } from '../src/defs/catalog';
import { PLAYER_HULLS, hullDef } from '../src/defs/hulls';
import { createCrew, createShip, startCombat, stepCombat, type CombatWorld, type ShipSpec, type StartOptions, type World } from '../src/sim/index';

export function ship(id: string, hullId: string, faction: 'ally' | 'enemy' = 'ally', over: Partial<ShipSpec> = {}): Ship {
  const hull = hullDef(hullId);
  return createShip({ id, faction, captainId: faction === 'ally' ? `cap-${id}` : null, enemyId: faction === 'enemy' ? hullId : null, hullId, name: id, paint: '#fff', slot: 0,
    weapons: [...hull.startWeapons], ammo: hull.startAmmo, augments: [], ai: faction === 'enemy' ? 'balanced' : null, fleeBelow: 0, phases: [], ...over });
}
export function addCrew(world: World, s: Ship, specs: readonly { species: SpeciesId; role: CrewRole }[] = hullDef(s.hullId).startCrew): Crew[] {
  return specs.map(spec => { const m = createCrew({ id: `${s.id}-c${world.crew.length}`, name: 'Crew', ...spec, faction: s.faction, ownerId: s.captainId }, s, world); world.crew.push(m); return m; });
}
/** A battle already past its intro. Ships keep whatever crew is added. */
export function battle(ships: Ship[], opts: Partial<StartOptions> = {}, crew = true): CombatWorld {
  const world: World = { ships, crew: [] };
  if (crew) for (const s of ships) if (s.faction === 'ally') addCrew(world, s);
  const w = { ...world, combat: startCombat(world, { id: 'c', seed: 1, hazard: 'none', objective: 'destroy', ...opts }) };
  stepCombat(w, 3000);
  return w;
}
export const run = (w: CombatWorld, ms: number, dt = 50) => { for (let t = 0; t < ms; t += dt) stepCombat(w, dt); };
/** A shot arriving on the next step. */
export function shoot(w: CombatWorld, from: Ship, to: Ship, weaponId: string, roomId: string, times = 1) {
  for (let i = 0; i < times; i++) w.combat.projectiles.push({ id: `t${w.combat.nextId++}`, kind: weaponDef(weaponId).kind, weaponId, fromShipId: from.id, toShipId: to.id, roomId, mount: 0, launchMs: w.combat.t, arriveMs: w.combat.t } satisfies Projectile);
  stepCombat(w, 50);
}
export const events = (w: CombatWorld, type: string) => w.combat.events.filter(e => e.type === type);
export const room = (s: Ship, id: string) => s.rooms.find(r => r.id === id)!;

const HAZARDS: Hazard[] = ['none', 'asteroids', 'solar', 'ion-storm', 'nebula'], SQUADS = ENEMIES.filter(d => !d.phases);

/** Autopilot allies (player hulls, rotating) against a same-faction squad of content enemies; crew, hazard and squad come from the seed. */
export function skirmish(seed: number, allies = 4, enemies = 3, hullBoost = 0): CombatWorld {
  let r = seed * 7919 + 1;
  const rnd = () => (r = (r * 48271) % 2147483647) / 2147483647, of = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const world: World = { ships: [], crew: [] }, faction = of(SQUADS).faction;
  for (let i = 0; i < allies; i++) { const hull = PLAYER_HULLS[(seed + i) % 5], s = ship(`a${i}`, hull.id, 'ally', { slot: i, maxHull: hull.maxHull + hullBoost }); s.autopilot = true; world.ships.push(s); addCrew(world, s); }
  for (let j = 0; j < enemies; j++) {
    const d = of(SQUADS.filter(e => e.faction === faction)), hull = hullDef(d.hullId);
    const s = ship(`e${j}`, d.hullId, 'enemy', { slot: j, enemyId: d.id, ai: d.ai, fleeBelow: d.fleeBelow, weapons: d.weapons, systems: d.systems, maxHull: hull.maxHull + d.hullBonus + hullBoost });
    world.ships.push(s); addCrew(world, s, d.crew);
  }
  return { ...world, combat: startCombat(world, { id: `s${seed}`, seed, hazard: of(HAZARDS), objective: 'destroy' }) };
}
