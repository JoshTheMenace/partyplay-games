import type { HullDef, SystemId } from '../contracts';
import { parseLayout } from './geometry';

const L: Record<string, SystemId | null> = { H: 'helm', E: 'engines', S: 'shields', W: 'weapons', O: 'oxygen', M: 'medbay', T: 'teleporter', C: 'cloak', D: 'defense', X: null, Y: null };
type Spec = Omit<HullDef, 'gridW' | 'gridH' | 'rooms' | 'doors'> & { plan: string[] };
const hull = ({ plan, ...spec }: Spec): HullDef => ({ ...spec, ...parseLayout(plan, L) });

/** Player hulls, in hangar order. Deck plans face right: engines at the stern (x=0), helm at the nose. */
export const PLAYER_HULLS: readonly HullDef[] = [
  hull({ id: 'wayfarer', name: 'Wayfarer', role: 'All-rounder', blurb: 'A dependable explorer with a burst laser, a missile rack and room to grow a cloak or teleporter.', player: true, automated: false,
    plan: ['..OOWW...', 'EEMMWWSSH', 'EEMMCCSSH', '..TTCC...'],
    maxHull: 30, weaponSlots: 3, startSystems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1 },
    startWeapons: ['burst-laser', 'swift-missile'], startAmmo: 8, paint: '#3fa7ff',
    startCrew: [{ species: 'human', role: 'pilot' }, { species: 'human', role: 'gunner' }, { species: 'bastion', role: 'engineer' }] }),
  hull({ id: 'lancer', name: 'Lancer', role: 'Glass cannon', blurb: 'Fast and fragile. Ion blasts strip shields so the pike beam can carve through three rooms.', player: true, automated: false,
    plan: ['.OO.WWDD..', 'EEMMWWSSHH', '.TT.CC....'],
    maxHull: 24, weaponSlots: 4, startSystems: { helm: 1, engines: 3, shields: 1, weapons: 3, oxygen: 1, medbay: 1 },
    startWeapons: ['basic-laser', 'ion-blast', 'pike-beam'], startAmmo: 4, paint: '#ff6b4a',
    startCrew: [{ species: 'skitter', role: 'pilot' }, { species: 'human', role: 'gunner' }, { species: 'human', role: 'engineer' }] }),
  hull({ id: 'bulwark', name: 'Bulwark', role: 'Shield wall', blurb: 'Heavy armor, two shield layers and point defense. Slow, stubborn and hard to kill.', player: true, automated: false,
    plan: ['..OOSS..', 'EEMMSSWW', 'EEMMXXWW', '..DDXXHH', '..TT....'],
    maxHull: 36, weaponSlots: 2, startSystems: { helm: 1, engines: 1, shields: 2, weapons: 2, oxygen: 1, medbay: 1, defense: 1 },
    startWeapons: ['heavy-laser', 'swift-missile'], startAmmo: 12, paint: '#78d955',
    startCrew: [{ species: 'bastion', role: 'soldier' }, { species: 'bastion', role: 'engineer' }, { species: 'human', role: 'pilot' }, { species: 'human', role: 'gunner' }] }),
  hull({ id: 'corsair', name: 'Corsair', role: 'Boarder', blurb: 'A four-berth teleporter and two Ember brawlers. Ion the enemy, then beam aboard and wreck it from inside.', player: true, automated: false,
    plan: ['..OOTT...', 'EEMMTTWWH', 'EECCSSWWH', '....SS...'],
    maxHull: 28, weaponSlots: 3, startSystems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1, teleporter: 2 },
    startWeapons: ['burst-laser', 'ion-blast'], startAmmo: 4, paint: '#b58aff',
    startCrew: [{ species: 'ember', role: 'soldier' }, { species: 'ember', role: 'soldier' }, { species: 'human', role: 'pilot' }, { species: 'skitter', role: 'engineer' }] }),
  hull({ id: 'halcyon', name: 'Halcyon', role: 'Fleet medic', blurb: 'Keeps the fleet flying. Its nanite lance repairs allied hulls and a big medbay patches crew fast.', player: true, automated: false,
    plan: ['..OOMM...', 'EETTMMSSH', 'EETTWWSSH', '....WW...'],
    maxHull: 28, weaponSlots: 3, startSystems: { helm: 1, engines: 2, shields: 1, weapons: 3, oxygen: 1, medbay: 2, teleporter: 1 },
    startWeapons: ['burst-laser', 'ion-blast', 'nanite-lance'], startAmmo: 4, paint: '#ffd24a',
    startCrew: [{ species: 'human', role: 'pilot' }, { species: 'human', role: 'medic' }, { species: 'skitter', role: 'engineer' }] }),
];

/** A captain whose ship is lost with no fleet reserves left flies on in a lifeboat. */
export const LIFEBOAT: HullDef = hull({ id: 'lifeboat', name: 'Lifeboat', role: 'Salvage', blurb: 'Scrap welded around an escape pod.', player: false, automated: false,
  plan: ['.WW...', 'EEOSSH', '.MM...'], maxHull: 14, weaponSlots: 1, startSystems: { helm: 1, engines: 1, shields: 1, weapons: 1, oxygen: 1, medbay: 1 },
  startWeapons: ['basic-laser'], startAmmo: 2, paint: '#9aa3b5', startCrew: [{ species: 'human', role: 'pilot' }] });

/** Enemy hulls. Enemy definitions (server content) choose weapons, crew and tiers. */
export const ENEMY_HULLS: readonly HullDef[] = [
  hull({ id: 'skiff', name: 'Skiff', role: 'Scout', blurb: 'A small, quick raider.', player: false, automated: false, plan: ['.WW...', 'EEOSSH', '.MM...'],
    maxHull: 10, weaponSlots: 2, startSystems: { helm: 1, engines: 2, shields: 1, weapons: 1, oxygen: 1, medbay: 1 }, startWeapons: ['basic-laser'], startAmmo: 2, paint: '#c0563d', startCrew: [] }),
  hull({ id: 'raider', name: 'Raider', role: 'Brawler', blurb: 'A pirate workhorse.', player: false, automated: false, plan: ['..WW...', 'EEWWSSH', 'EEOOSSH', '..MM...'],
    maxHull: 14, weaponSlots: 3, startSystems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1 }, startWeapons: ['basic-laser', 'burst-laser'], startAmmo: 4, paint: '#b2462f', startCrew: [] }),
  hull({ id: 'gunship', name: 'Gunship', role: 'Artillery', blurb: 'Heavily armed escort.', player: false, automated: false, plan: ['..WWDD..', 'EEWWSSHH', 'EEOOSSCC', '..MM....'],
    maxHull: 18, weaponSlots: 4, startSystems: { helm: 1, engines: 2, shields: 2, weapons: 3, oxygen: 1, medbay: 1 }, startWeapons: ['burst-laser', 'heavy-laser'], startAmmo: 6, paint: '#8f2f2f', startCrew: [] }),
  hull({ id: 'drone', name: 'Warden Drone', role: 'Automated', blurb: 'A crewless war machine.', player: false, automated: true, plan: ['..WW..', 'EEWWSH', '..DD..'],
    maxHull: 12, weaponSlots: 3, startSystems: { helm: 1, engines: 3, shields: 1, weapons: 2 }, startWeapons: ['ion-blast', 'basic-laser'], startAmmo: 6, paint: '#6a7688', startCrew: [] }),
  hull({ id: 'hive', name: 'Vesk Hive', role: 'Boarder', blurb: 'Organic hull, hungry teleporter.', player: false, automated: false, plan: ['..TT....', 'EETTOOSH', 'EEMMWWSH', '..MM....'],
    maxHull: 16, weaponSlots: 2, startSystems: { helm: 1, engines: 2, shields: 1, weapons: 1, oxygen: 1, medbay: 1, teleporter: 1 }, startWeapons: ['basic-laser'], startAmmo: 2, paint: '#6f8b2e', startCrew: [] }),
  hull({ id: 'dreadnought', name: 'Armada Dreadnought', role: 'Pursuer', blurb: 'The Crimson Armada\'s hunter.', player: false, automated: false, plan: ['..OOWWDD..', 'EEMMWWSSHH', 'EEMMCCSSHH', '..TTCC....'],
    maxHull: 24, weaponSlots: 4, startSystems: { helm: 2, engines: 2, shields: 2, weapons: 3, oxygen: 1, medbay: 1, defense: 1 }, startWeapons: ['burst-laser', 'swift-missile', 'heavy-laser'], startAmmo: 10, paint: '#b01e32', startCrew: [] }),
  hull({ id: 'flagship', name: 'Armada Flagship', role: 'Boss', blurb: 'The heart of the Crimson Armada.', player: false, automated: false, plan: ['...OOWWWW...', 'EEEMMWWWWSSH', 'EEETTCCDDSSH', '...TTCCDD...'],
    maxHull: 40, weaponSlots: 6, startSystems: { helm: 2, engines: 2, shields: 3, weapons: 4, oxygen: 2, medbay: 2, teleporter: 1, cloak: 1, defense: 2 }, startWeapons: ['burst-laser-ii', 'hellfire-missile', 'heavy-ion', 'halberd-beam'], startAmmo: 99, paint: '#c21f3a', startCrew: [] }),
];

export const HULLS: readonly HullDef[] = [...PLAYER_HULLS, LIFEBOAT, ...ENEMY_HULLS];
export const hullDef = (id: string) => { const found = HULLS.find(h => h.id === id); if (!found) throw new Error(`Unknown hull ${id}`); return found; };
