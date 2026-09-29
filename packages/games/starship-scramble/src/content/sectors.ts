import type { SectorDef } from './types';

/**
 * Every run starts in the Rustbelt; each exit offers the fleet a choice of two sectors for the next depth. Standard runs are three sectors deep,
 * long runs five, short runs only the Rustbelt. The last sector's exit is the Flagship. Repeated factions weight random squads.
 */
export const SECTORS: readonly SectorDef[] = [
  { id: 'rustbelt', name: 'The Rustbelt', theme: 'Scrap Raider space', depths: [1], factions: ['raiders'], hazards: ['asteroids', 'solar'], rows: [2, 4],
    weights: { hostile: 4, distress: 2, unknown: 2.5, derelict: 1.5 },
    blurb: 'A graveyard of mining rigs where Scrap Raiders weld their fleets from whatever drifts past.' },
  { id: 'veil', name: 'The Veil', theme: 'Vesk Hive space', depths: [2, 3], factions: ['vesk', 'vesk', 'raiders'], hazards: ['nebula', 'ion-storm'], rows: [3, 5],
    weights: { hostile: 4, distress: 2, unknown: 1.5, nebula: 2, derelict: 1 },
    blurb: 'Violet nebula banks hide the Vesk Hive, whose brood ships would rather eat your crew than your hull.' },
  { id: 'glasswater', name: 'Glasswater Drift', theme: 'Lumen Choir space', depths: [2, 3], factions: ['choir', 'choir', 'raiders'], hazards: ['asteroids', 'ion-storm'], rows: [2, 5],
    weights: { hostile: 3.5, distress: 2, unknown: 2.5, derelict: 1.5 },
    blurb: 'A slow tide of singing crystal. The Lumen Choir grows its ships here, and raiders chip at the edges for glass.' },
  { id: 'meridian', name: 'Meridian Reach', theme: 'Warden space', depths: [3, 4], factions: ['wardens', 'wardens', 'raiders'], hazards: ['solar', 'ion-storm', 'asteroids'], rows: [2, 4],
    weights: { hostile: 4.5, distress: 1.5, unknown: 2, derelict: 1.5 },
    blurb: 'Ancient Warden drones still guard these lanes, and they do not negotiate.' },
  { id: 'cinder', name: 'The Cinder Expanse', theme: 'Raider warlord space', depths: [3, 4], factions: ['raiders', 'raiders', 'vesk'], hazards: ['solar', 'asteroids'], rows: [3, 5],
    weights: { hostile: 4.5, distress: 2, unknown: 1.5, derelict: 2 },
    blurb: 'A red giant is shedding its skin. Raider warlords fight over the forges in its glow.' },
  { id: 'sanctum', name: 'The Choir Sanctum', theme: 'Lumen Choir heartland', depths: [4, 5], factions: ['choir', 'choir', 'wardens'], hazards: ['nebula', 'ion-storm'], rows: [3, 5],
    weights: { hostile: 4.5, distress: 1.5, unknown: 2, nebula: 1.5, derelict: 1 },
    blurb: 'Cathedral ships the size of moons hum a song that makes shield emitters ache.' },
  { id: 'marches', name: 'The Crimson Marches', theme: 'Armada territory', depths: [5], factions: ['armada', 'raiders', 'wardens'], hazards: ['solar', 'asteroids', 'ion-storm'], rows: [2, 4],
    weights: { hostile: 5, distress: 1.5, unknown: 1.5, derelict: 1.5 },
    blurb: 'Armada shipyards and picket lines, strewn with the burnt hulls of every fleet that came this far.' },
];
export const sectorDef = (id: string) => { const found = SECTORS.find(s => s.id === id); if (!found) throw new Error(`Unknown sector ${id}`); return found; };
