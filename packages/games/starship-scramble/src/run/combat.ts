/** Battle setup (squads and scaling), per-tick bookkeeping, and the aftermath: rebuilds, loot, defeat and victory. */
import type { BossPhase, Captain, Ship, SystemId } from '../contracts';
import type { EnemyDef, EventEffect } from '../content/types';
import { ENEMIES, enemyDef } from '../content/enemies';
import { hullDef } from '../defs/hulls';
import { createCrew, createShip, startCombat, stepCombat, type CombatWorld } from '../sim';
import { shipLabel } from './events';
import { berths, openLoot } from './fleet';
import { int, pick, random, weighted } from './rng';
import { captainById, currentNode, enter, living, online, recruit, say, scrapScale, sector, shipById, shipOf, uid, type State } from './state';

type CombatEffect = Extract<EventEffect, { kind: 'combat' }>;
const PAINT: Partial<Record<EnemyDef['faction'], string>> = { vesk: '#6f8b2e', wardens: '#6a7688', armada: '#b01e32' };
/**
 * Tuning by sector tier and by fleet size (index = captains − 1). A lone captain lacks the fleet's combined volleys, so enemies there are
 * softer; big fleets face tougher, faster-firing enemies. The Flagship's hull is BOSS[0] + BOSS[1] × captains of its authored phases.
 */
const HULL_SCALE = [1, 1.2, 1.4, 1.4], FLEET_HULL = [.85, 1, 1.15, 1.25], FLEET_CHARGE = [.9, 1, 1.3, 1.4], BOSS = [-.1, .6], SHORT_BOSS = .5, CADET_HULL = .9, CADET_BOSS = .75;
/** Wall-clock beat after an outcome so the TV can show the last explosion. */
const END_MS = 2500;
const SQUADS = ENEMIES.filter(d => !d.phases && d.id !== 'rogue-trader');

/** Per-enemy threat budget: grows with sector tier and beacon column, so every sector opens gently. */
const cap = (s: State) => 1 + .5 * sector(s).tier + .25 * currentNode(s).col;
/**
 * Enemies per fight by fleet size: 1 captain → 1 (sometimes 2 small), 2 → 2, 3 → 2–3, 4 → 3. Explicit (event) lists are padded or trimmed,
 * weakest first, to fit; outside ambushes an enemy over the beacon's budget is swapped for one within it (its faction, else the sector's).
 */
function squad(s: State, enemies: CombatEffect['enemies'], ambush: boolean): EnemyDef[] {
  const n = s.captains.length, size = n === 1 ? 1 : n === 2 ? 2 : n === 3 ? int(s, 2, 3) : 3, max = cap(s);
  if (enemies !== 'sector') {
    const within = (d: EnemyDef) => [SQUADS.filter(o => o.faction === d.faction && o.threat <= max), SQUADS.filter(o => sector(s).factions.includes(o.faction) && o.threat <= max)].find(l => l.length);
    const list = enemies.map(enemyDef).map(d => ambush || d.phases || d.threat <= max ? d : pick(s, within(d) ?? [d])).sort((a, b) => a.threat - b.threat);
    if (list.some(d => d.phases)) return [...list, ...Array.from({ length: Math.max(0, n - (s.settings.difficulty === 'cadet' ? 4 : 2)) }, () => enemyDef('armada-gunship'))];
    const low = list[0].threat, pool = SQUADS.filter(d => d.faction === list[0].faction && d.threat <= low);
    while (list.length < size) list.push(pick(s, pool.length ? pool : list));
    return list.slice(0, list.every(d => d.threat <= 1) ? Math.max(size, 2) : size);
  }
  const faction = pick(s, sector(s).factions), pool = SQUADS.filter(d => d.faction === faction), small = n === 1 && random(s) < .25, count = small ? 2 : size;
  const min = Math.min(...pool.map(d => d.threat));
  let budget = max * (small ? 1.2 : count);
  return Array.from({ length: count }, (_, i) => {
    const options = pool.filter(d => d.threat <= budget - (count - i - 1) * min), d = options.length ? weighted(s, options, o => o.threat) : pool.find(o => o.threat === min)!;
    budget -= d.threat; return d;
  });
}

/**
 * Flagship phases for this fleet: hull scales with fleet size and difficulty; it raises at most one shield layer per captain, powers
 * one weapon per captain plus one, and never boards a lone captain. Short runs (one sector of upgrades) meet it with a third less hull
 * and one level less of shields, point defense and teleporter. Fleets of 3 and 4 also face one and two Armada Gunship escorts (none on Cadet, where the Flagship is also 25% smaller).
 */
function bossPhase(s: State, { systems, maxHull, ...p }: BossPhase, scale: number): BossPhase {
  const n = s.captains.length, soft = sector(s).tier < 3 ? 1 : 0, less = (id: SystemId, min: number) => Math.max(min, (systems[id] ?? 0) - soft);
  return { ...p, maxHull: Math.round(maxHull * scale * (soft ? SHORT_BOSS : 1)),
    systems: { ...systems, shields: Math.min(less('shields', 1), n), defense: less('defense', 0), teleporter: n > 1 ? less('teleporter', 0) : 0, weapons: Math.min(systems.weapons ?? 0, n + 1 - soft) } };
}
function spawn(s: State, d: EnemyDef, slot: number, scale: number) {
  const hull = hullDef(d.hullId), phases = (d.phases ?? []).map(p => bossPhase(s, p, scale));
  const ship = createShip({ id: uid(s, 'e'), faction: 'enemy', captainId: null, enemyId: d.id, hullId: d.hullId, name: d.name, paint: PAINT[d.faction] ?? hull.paint, slot,
    maxHull: phases[0]?.maxHull ?? Math.round((hull.maxHull + d.hullBonus) * scale), systems: phases[0]?.systems ?? d.systems, weapons: d.weapons, ammo: hull.startAmmo, augments: [], ai: d.ai, fleeBelow: d.fleeBelow, phases });
  s.ships.push(ship);
  for (const k of d.crew) recruit(s, null, ship, k.species, k.role);
}

/** Enemy hull scales with sector tier and fleet size, the Flagship's with fleet size only; enemy charge scales with fleet size. Cadet: −10% hull, 20% slower enemy charge. */
export function startFight(s: State, effect: CombatEffect, ambush: boolean) {
  const defs = squad(s, effect.enemies, ambush), cadet = s.settings.difficulty === 'cadet', boss = defs.some(d => d.phases), n = s.captains.length;
  defs.forEach((d, slot) => spawn(s, d, slot, (d.phases ? BOSS[0] + BOSS[1] * n : HULL_SCALE[sector(s).tier - 1] * FLEET_HULL[n - 1]) * (cadet ? d.phases ? CADET_BOSS : CADET_HULL : 1)));
  const objective = boss ? 'boss' : effect.objective ?? 'destroy';
  s.combat = startCombat(s, { id: uid(s, 'b'), seed: int(s, 1, 0x7fffffff), hazard: effect.hazard ?? currentNode(s).hazard, objective, enemyCharge: FLEET_CHARGE[n - 1] * (cadet ? .7 : 1),
    ...objective === 'survive' && { surviveMs: 40000 + 5000 * sector(s).tier } });
  s.fight = { bonus: effect.bonus ?? 1, ambush, endAt: null, counted: [] };
  enter(s, 'combat');
  say(s, boss ? 'The Armada Flagship moves to engage!' : ambush ? 'Armada ambush!' : `${defs.length === 1 ? defs[0].name : `${defs.length} hostiles`} incoming`);
}

/** The fleet jumps when a strict majority of connected captains with a working ship vote for it and the drive is charged. */
function jumpPassed(s: State) {
  const combat = s.combat!, voters = online(s).filter(c => shipById(s, c.shipId)?.status === 'active');
  return combat.objective !== 'boss' && combat.ftl >= 1 && voters.length > 0 && voters.filter(c => combat.jumpVotes.includes(c.id)).length * 2 > voters.length;
}

/** Credit captains for new combat events: damage dealt to enemies, kills, crew repairs, and support shots on allies. */
function tally(s: State) {
  const fight = s.fight!, counted = new Set(fight.counted);
  for (const ev of s.combat!.events) {
    if (counted.has(ev.id)) continue;
    const target = shipById(s, ev.shipId), from = shipById(s, ev.fromShipId ?? (ev.type === 'explode' ? target?.lastHitBy : null) ?? null), shooter = captainById(s, from?.captainId ?? null);
    if (!target) continue;
    if (ev.type === 'hit' && shooter && target.faction === 'enemy') shooter.stats.damage += ev.amount ?? 0;
    if (ev.type === 'explode' && target.faction === 'enemy') { s.fleetStats.kills++; if (shooter) shooter.stats.kills++; say(s, `${target.name} destroyed${shooter ? ` by ${shooter.name}` : ''}!`); }
    if (ev.type === 'explode' && target.faction === 'ally') say(s, `${shipLabel(s, target)} is destroyed!`);
    if (ev.type === 'repair' && ev.crewId) { const owner = captainById(s, s.crew.find(k => k.id === ev.crewId)?.ownerId ?? null); if (owner) owner.stats.repairs++; }
    else if ((ev.type === 'repair' || ev.type === 'heal') && shooter && from !== target) shooter.stats.saves++;
    if (ev.type === 'phase') say(s, target.phases[target.phase]?.line ?? `${target.name} changes tactics!`);
    if (ev.type === 'flee') say(s, `${target.name} is charging its FTL. Stop it!`);
  }
  fight.counted = s.combat!.events.map(e => e.id);
}

export function tickCombat(s: State, dtMs: number, nowMs: number) {
  const combat = s.combat!, fight = s.fight!;
  if (!combat.outcome && !combat.paused) stepCombat(s as CombatWorld, dtMs);
  tally(s);
  if (!combat.outcome && jumpPassed(s)) { combat.outcome = 'escaped'; say(s, 'The fleet jumps away!'); }
  if (!combat.outcome) return;
  fight.endAt ??= nowMs + END_MS;
  if (nowMs >= fight.endAt) endCombat(s);
}

function endCombat(s: State) {
  const { outcome, objective } = s.combat!, { bonus, ambush } = s.fight!;
  s.fleetStats.lostShips += s.ships.filter(ship => ship.faction === 'ally' && ship.status === 'destroyed').length;
  if (outcome === 'defeat' || outcome === 'victory' && objective === 'boss') return finishRun(s, outcome);
  const enemies = s.ships.filter(ship => ship.faction === 'enemy'), killed = enemies.filter(ship => ship.status === 'destroyed');
  const scrap = Math.round(scrapScale(s, killed.reduce((sum, ship) => sum + int(s, ...enemyDef(ship.enemyId!).scrap), 0)) * bonus * (ambush ? .6 : 1));
  const salvage = s.ships.some(x => x.captainId && x.status === 'active' && x.augments.includes('salvage-arm')) ? 1 : 0;
  const items = killed.length ? Math.max(1, Math.round(s.captains.length * bonus * killed.length / enemies.length * (ambush ? .5 : 1))) + salvage : 0;
  // Escaping costs a beacon of lead; surviving an ambush throws the pursuers back behind the fleet.
  s.map.armadaCol = ambush ? Math.min(s.map.armadaCol, currentNode(s).col - 1) : s.map.armadaCol + (outcome === 'escaped' ? 1 : 0);
  // Anyone aboard a destroyed ship dies; enemy crew leave with their ships.
  s.crew = s.crew.filter(k => k.faction === 'ally' && k.state !== 'dead' && k.hp > 0 && shipById(s, k.shipId)?.status !== 'destroyed');
  for (const k of s.crew) delete k.beam;
  s.ships = s.ships.filter(ship => ship.faction === 'ally');
  for (const c of s.captains) restore(s, c);
  s.combat = null; s.fight = null;
  if (outcome === 'victory') return openLoot(s, scrap, items);
  s.pending = []; enter(s, 'map'); say(s, 'The fleet escaped. The Armada gains ground.');
}

/** Rebuild a lost ship from a fleet reserve (same hull, upgrades and weapons, 50% hull) or a lifeboat, bring survivors home, top up to 2 crew. */
function restore(s: State, c: Captain) {
  let ship = shipOf(s, c);
  if (ship.status === 'destroyed') ship = rebuild(s, c, ship);
  for (const k of living(s, c.id)) if (k.shipId !== ship.id) {
    if (berths(s, ship) < 1) { s.crew = s.crew.filter(other => other !== k); continue; }
    Object.assign(k, createCrew({ id: k.id, name: k.name, species: k.species, role: k.role, faction: 'ally', ownerId: c.id, hp: k.hp }, ship, s));
  }
  while (living(s, c.id).length < 2 && berths(s, ship) > 0) recruit(s, c.id, ship, 'human', (['pilot', 'engineer'] as const).find(r => !living(s, c.id).some(k => k.role === r)) ?? 'gunner');
  ship.autopilot = !c.connected;
}
function rebuild(s: State, c: Captain, lost: Ship) {
  const spare = s.reserves > 0, hullId = spare ? c.hullId! : 'lifeboat', same = hullId === lost.hullId, base = hullDef(hullId);
  if (spare) s.reserves--;
  c.cargo = [];
  const ship = createShip({ id: lost.id, faction: 'ally', captainId: c.id, enemyId: null, hullId, name: lost.name, paint: lost.paint, slot: lost.slot, ai: null, fleeBelow: 0, phases: [],
    ...same ? { maxHull: lost.maxHull, systems: Object.fromEntries(lost.rooms.flatMap(r => r.system ? [[r.system, r.tier]] : [])), weapons: lost.weapons.map(w => w.defId), ammo: lost.ammo, augments: lost.augments }
      : { weapons: base.startWeapons, ammo: base.startAmmo, augments: [] } });
  if (spare) ship.hull = Math.ceil(ship.maxHull / 2);
  s.ships[s.ships.indexOf(lost)] = ship;
  say(s, spare ? `${c.name} flies again in a rebuilt ${base.name}` : `${c.name} limps on in a lifeboat`);
  return ship;
}

export function finishRun(s: State, result: 'victory' | 'defeat') {
  s.result = result; s.combat = null; s.fight = null; enter(s, 'over');
  say(s, result === 'victory' ? 'The Flagship breaks apart. The Armada is finished!' : 'The fleet is lost. The Armada rolls on.');
}
