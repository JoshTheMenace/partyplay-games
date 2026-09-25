import type { SectorDef } from './types';

/** Standard runs visit every sector in order; short runs visit only the first. The last sector's exit is the Flagship. Repeated factions weight random squads. */
export const SECTORS: readonly SectorDef[] = [
  { id: 'rustbelt', name: 'The Rustbelt', theme: 'rustbelt', tier: 1, factions: ['raiders'], hazards: ['asteroids', 'solar'],
    blurb: 'A graveyard of mining rigs where Scrap Raiders weld their fleets from whatever drifts past.' },
  { id: 'veil', name: 'The Veil', theme: 'veil', tier: 2, factions: ['vesk', 'vesk', 'raiders'], hazards: ['nebula', 'ion-storm'],
    blurb: 'Violet nebula banks hide the Vesk Hive, whose brood ships would rather eat your crew than your hull.' },
  { id: 'meridian', name: 'Meridian Reach', theme: 'meridian', tier: 3, factions: ['wardens', 'wardens', 'raiders'], hazards: ['solar', 'ion-storm', 'asteroids'],
    blurb: 'The last lane before the Armada. Ancient Warden drones still guard it, and they do not negotiate.' },
];
export const sectorDef = (id: string) => { const found = SECTORS.find(s => s.id === id); if (!found) throw new Error(`Unknown sector ${id}`); return found; };
