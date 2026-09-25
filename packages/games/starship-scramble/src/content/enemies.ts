import type { CrewRole, SpeciesId } from '../contracts';
import type { EnemyDef } from './types';

const crew = (...specs: `${SpeciesId}:${CrewRole}`[]) => specs.map(spec => { const [species, role] = spec.split(':') as [SpeciesId, CrewRole]; return { species, role }; });
const e = (d: Omit<EnemyDef, 'hullBonus' | 'fleeBelow'> & Partial<Pick<EnemyDef, 'hullBonus' | 'fleeBelow'>>): EnemyDef => ({ hullBonus: 0, fleeBelow: 0, ...d });

/** Threat is the squad-budget cost (see run/combat). Systems list every room of the hull so nothing depends on hull defaults. */
export const ENEMIES: readonly EnemyDef[] = [
  // Scrap Raiders: crewed brawlers that run when beaten.
  e({ id: 'raider-skiff', name: 'Raider Skiff', faction: 'raiders', hullId: 'skiff', ai: 'balanced', threat: 1, scrap: [26, 36], fleeBelow: .3,
    weapons: ['basic-laser', 'basic-laser'], systems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1 }, crew: crew('human:pilot', 'human:gunner') }),
  e({ id: 'raider-brawler', name: 'Raider Brawler', faction: 'raiders', hullId: 'raider', ai: 'weapons', threat: 2, scrap: [34, 46], fleeBelow: .25,
    weapons: ['burst-laser', 'basic-laser'], systems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1 }, crew: crew('human:pilot', 'human:gunner', 'ember:soldier') }),
  e({ id: 'raider-gunship', name: 'Raider Gunship', faction: 'raiders', hullId: 'gunship', ai: 'shields', threat: 3, scrap: [44, 60], fleeBelow: .2,
    weapons: ['burst-laser', 'heavy-laser'], systems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1, defense: 0, cloak: 0 }, hullBonus: 2,
    crew: crew('human:pilot', 'human:gunner', 'human:engineer', 'ember:soldier') }),
  e({ id: 'rogue-trader', name: 'Rogue Trader', faction: 'raiders', hullId: 'raider', ai: 'balanced', threat: 2, scrap: [40, 56], fleeBelow: .5, hullBonus: 2,
    weapons: ['heavy-laser', 'ion-blast'], systems: { helm: 1, engines: 3, shields: 2, weapons: 2, oxygen: 1, medbay: 1 }, crew: crew('human:pilot', 'bastion:engineer', 'human:gunner') }),
  // Vesk Hive: ion and boarders; they want your crew.
  e({ id: 'vesk-scout', name: 'Vesk Scout', faction: 'vesk', hullId: 'skiff', ai: 'hunter', threat: 1, scrap: [26, 36], fleeBelow: .35,
    weapons: ['ion-blast', 'basic-laser'], systems: { helm: 1, engines: 3, shields: 1, weapons: 2, oxygen: 1, medbay: 1 }, crew: crew('skitter:pilot', 'skitter:gunner') }),
  e({ id: 'vesk-hive', name: 'Vesk Hive Ship', faction: 'vesk', hullId: 'hive', ai: 'boarder', threat: 2, scrap: [36, 50], fleeBelow: .2,
    weapons: ['burst-laser'], systems: { helm: 1, engines: 2, shields: 1, weapons: 1, oxygen: 1, medbay: 1, teleporter: 1 },
    crew: crew('skitter:pilot', 'skitter:soldier', 'skitter:soldier', 'ember:soldier') }),
  e({ id: 'vesk-brood', name: 'Vesk Brood Mother', faction: 'vesk', hullId: 'hive', ai: 'boarder', threat: 3, scrap: [48, 64], fleeBelow: .15, hullBonus: 4,
    weapons: ['burst-laser', 'breach-missile'], systems: { helm: 1, engines: 2, shields: 2, weapons: 2, oxygen: 1, medbay: 2, teleporter: 2 },
    crew: crew('skitter:pilot', 'skitter:gunner', 'skitter:soldier', 'skitter:soldier', 'ember:soldier') }),
  // Wardens: automated, never flee, strip shields.
  e({ id: 'warden-drone', name: 'Warden Drone', faction: 'wardens', hullId: 'drone', ai: 'shields', threat: 2, scrap: [30, 42],
    weapons: ['ion-blast', 'basic-laser'], systems: { helm: 1, engines: 3, shields: 1, weapons: 2, defense: 0 }, crew: [] }),
  e({ id: 'warden-lancer', name: 'Warden Lancer', faction: 'wardens', hullId: 'drone', ai: 'weapons', threat: 3, scrap: [40, 54], hullBonus: 2,
    weapons: ['heavy-laser', 'pike-beam'], systems: { helm: 1, engines: 3, shields: 1, weapons: 2, defense: 1 }, crew: [] }),
  e({ id: 'warden-sentinel', name: 'Warden Sentinel', faction: 'wardens', hullId: 'drone', ai: 'hunter', threat: 4, scrap: [56, 74], hullBonus: 8,
    weapons: ['burst-laser-ii', 'flak-cannon', 'ion-blast'], systems: { helm: 2, engines: 2, shields: 2, weapons: 3, defense: 2 }, crew: [] }),
  // Crimson Armada: the pursuit. Hard hitters, little loot.
  e({ id: 'armada-interceptor', name: 'Armada Interceptor', faction: 'armada', hullId: 'skiff', ai: 'hunter', threat: 2, scrap: [16, 24],
    weapons: ['burst-laser', 'swift-missile'], systems: { helm: 2, engines: 3, shields: 1, weapons: 2, oxygen: 1, medbay: 1 }, crew: crew('human:pilot', 'human:gunner') }),
  e({ id: 'armada-gunship', name: 'Armada Gunship', faction: 'armada', hullId: 'gunship', ai: 'weapons', threat: 3, scrap: [26, 36],
    weapons: ['burst-laser', 'heavy-laser', 'hellfire-missile'], systems: { helm: 1, engines: 2, shields: 1, weapons: 3, oxygen: 1, medbay: 1, defense: 0, cloak: 0 },
    crew: crew('human:pilot', 'human:gunner', 'human:engineer', 'human:soldier') }),
  e({ id: 'armada-dreadnought', name: 'Armada Dreadnought', faction: 'armada', hullId: 'dreadnought', ai: 'shields', threat: 4, scrap: [40, 56],
    weapons: ['burst-laser-ii', 'heavy-ion', 'swift-missile'], systems: { helm: 2, engines: 2, shields: 2, weapons: 3, oxygen: 1, medbay: 1, defense: 1, cloak: 1, teleporter: 0 },
    crew: crew('human:pilot', 'human:gunner', 'human:engineer', 'bastion:soldier', 'human:soldier') }),
  // The Flagship, tuned for a standard run and one captain: run/combat scales hull by fleet size and difficulty, and softens it for short runs.
  e({ id: 'flagship', name: 'Armada Flagship', faction: 'armada', hullId: 'flagship', ai: 'balanced', threat: 10, scrap: [0, 0],
    weapons: ['burst-laser', 'burst-laser', 'swift-missile'], systems: { helm: 2, engines: 2, shields: 2, weapons: 3, oxygen: 2, medbay: 2, teleporter: 0, cloak: 0, defense: 0 },
    crew: crew('human:pilot', 'human:gunner', 'bastion:engineer', 'human:medic', 'ember:soldier', 'bastion:soldier'),
    phases: [
      { maxHull: 22, weapons: ['burst-laser', 'burst-laser', 'swift-missile'], systems: { helm: 2, engines: 2, shields: 2, weapons: 3, oxygen: 2, medbay: 2, teleporter: 0, cloak: 0, defense: 0 },
        line: 'The Flagship opens fire. Break its shields together!' },
      { maxHull: 26, weapons: ['heavy-ion', 'burst-laser', 'hellfire-missile'], systems: { helm: 2, engines: 2, shields: 2, weapons: 3, oxygen: 2, medbay: 2, teleporter: 1, cloak: 1, defense: 1 },
        line: 'Armor cracked! The Flagship cloaks and rearms. Watch for boarders!' },
      { maxHull: 30, weapons: ['halberd-beam', 'burst-laser-ii', 'heavy-laser', 'swift-missile'], systems: { helm: 2, engines: 1, shields: 3, weapons: 4, oxygen: 2, medbay: 2, teleporter: 1, cloak: 0, defense: 2 },
        line: 'Core exposed! The Halberd beam is charging. Finish it!' },
    ] }),
];
export const enemyDef = (id: string) => { const found = ENEMIES.find(d => d.id === id); if (!found) throw new Error(`Unknown enemy ${id}`); return found; };
