/**
 * The crew of the Reaches: Sky Clash's original fighters (DESIGN.md). Plain display data with no imports, so the contract in
 * src/model.ts can list them ahead of the legacy roster. Everything else about a fighter lives in src/crew/<id>/.
 */
export const CREW = ['sola', 'toll', 'kes', 'vesper'] as const;
export type CrewKind = typeof CREW[number];
export const CREW_DATA = {
  sola: { name: 'Sola', title: 'The Lamplighter', blurb: 'Keeps the beacons of the Reaches lit. Long reach, steady feet, a lantern that bites.', sourceIndex: -1, profile: 'sola', style: 'crew', color: '#ff9a3c', height: 1.72, radius: .3,
    specials: ['Cinder Lob', 'Pike Vault', 'Updraft', 'Kindle'], bonus: false, archetype: 'All-rounder' },
  toll: { name: 'Toll', title: 'The Bell of the Yard', blurb: 'The Bellyard’s old casting automaton, still on shift. Slow to start, armoured through his wind-ups, and every hit rings.', sourceIndex: -1, profile: 'toll', style: 'crew', color: '#ffd27a', height: 2.0, radius: .5,
    specials: ['Knell', 'Ram', 'Steam Hoist', 'Bell Drop'], bonus: false, archetype: 'Heavy' },
  kes: { name: 'Kes', title: 'The Kite-Runner', blurb: 'Courier of the upper winds. Three jumps, quick feet and a kite that lifts him out of trouble; hit him once and he goes a long way.', sourceIndex: -1, profile: 'kes', style: 'crew', color: '#8ff0d0', height: 1.6, radius: .26,
    specials: ['Gale Dart', 'Tailwind', 'Kite Lift', 'Downdraft'], bonus: false, archetype: 'Fast and light' },
  vesper: { name: 'Vesper', title: 'The Glasswright', blurb: 'Patient and exact. Keeps rivals at the end of her blowpipe, leaves glass drifting where they want to stand, and answers a careless hit in kind.', sourceIndex: -1, profile: 'vesper', style: 'crew', color: '#bfeaff', height: 1.82, radius: .3,
    specials: ['Glass Bulb', 'Shard Fan', 'Bubble Lift', 'Kiln Mirror'], bonus: false, archetype: 'Zoner' },
} as const satisfies Record<CrewKind, { name: string; title: string; blurb: string; sourceIndex: number; profile: string; style: string; color: string; height: number; radius: number; specials: readonly [string, string, string, string]; bonus: boolean; archetype: string }>;
export const isCrew = (kind: string): kind is CrewKind => (CREW as readonly string[]).includes(kind);
