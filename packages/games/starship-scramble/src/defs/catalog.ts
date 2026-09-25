import type { AugmentDef, CrewRole, SpeciesDef, SpeciesId, SystemDef, SystemId, WeaponDef } from '../contracts';

const w = (d: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'kind' | 'blurb' | 'price' | 'tier' | 'chargeMs'>): WeaponDef =>
  ({ shots: 1, damage: 0, pierce: 0, ion: 0, crewDamage: 15, fireChance: 0, breachChance: 0, ammo: 0, target: 'enemy', ...d });
export const WEAPONS: readonly WeaponDef[] = [
  w({ id: 'basic-laser', name: 'Basic Laser', kind: 'laser', tier: 1, price: 30, chargeMs: 9000, damage: 1, blurb: 'One reliable bolt. Each bolt pops a shield layer.' }),
  w({ id: 'burst-laser', name: 'Burst Laser', kind: 'laser', tier: 1, price: 50, chargeMs: 11000, shots: 2, damage: 1, blurb: 'Two bolts per volley. The workhorse of the frontier.' }),
  w({ id: 'burst-laser-ii', name: 'Burst Laser II', kind: 'laser', tier: 2, price: 80, chargeMs: 12000, shots: 3, damage: 1, blurb: 'Three bolts. Shreds single-layer shields.' }),
  w({ id: 'heavy-laser', name: 'Heavy Laser', kind: 'laser', tier: 1, price: 55, chargeMs: 9500, damage: 2, fireChance: .1, crewDamage: 30, blurb: 'A slow, hard-hitting bolt that can start fires.' }),
  w({ id: 'swift-missile', name: 'Swift Missile', kind: 'missile', tier: 1, price: 45, chargeMs: 10000, damage: 2, pierce: 9, ammo: 1, fireChance: .1, breachChance: .1, blurb: 'Ignores shields. Uses one missile.' }),
  w({ id: 'hellfire-missile', name: 'Hellfire Missile', kind: 'missile', tier: 2, price: 75, chargeMs: 13000, damage: 3, pierce: 9, ammo: 1, fireChance: .45, breachChance: .2, blurb: 'Ignores shields and sets rooms ablaze.' }),
  w({ id: 'breach-missile', name: 'Breach Missile', kind: 'missile', tier: 2, price: 70, chargeMs: 15000, damage: 3, pierce: 9, ammo: 1, breachChance: .7, crewDamage: 25, blurb: 'Punches hull breaches that vent oxygen.' }),
  w({ id: 'pike-beam', name: 'Pike Beam', kind: 'beam', tier: 1, price: 40, chargeMs: 14000, damage: 1, beamRooms: 3, blurb: 'Sweeps three rooms. Blocked while any shield layer is up.' }),
  w({ id: 'halberd-beam', name: 'Halberd Beam', kind: 'beam', tier: 3, price: 85, chargeMs: 16000, damage: 2, beamRooms: 2, fireChance: .15, blurb: 'Two damage per room; each shield layer absorbs one.' }),
  w({ id: 'ion-blast', name: 'Ion Blast', kind: 'ion', tier: 1, price: 35, chargeMs: 8000, ion: 1, crewDamage: 0, blurb: 'Knocks out a shield layer, or stuns a system for 6 seconds.' }),
  w({ id: 'heavy-ion', name: 'Heavy Ion', kind: 'ion', tier: 2, price: 65, chargeMs: 12000, ion: 2, crewDamage: 0, blurb: 'Two layers of ion. Shuts shields down hard.' }),
  w({ id: 'flak-cannon', name: 'Flak Cannon', kind: 'flak', tier: 2, price: 70, chargeMs: 17000, shots: 4, damage: 1, crewDamage: 10, blurb: 'Four fragments scatter around the target room.' }),
  w({ id: 'nanite-lance', name: 'Nanite Lance', kind: 'support', tier: 1, price: 50, chargeMs: 14000, damage: 2, crewDamage: 0, support: 'repair', target: 'ally', blurb: 'Fire at an ally: repairs 2 hull and fixes the struck system.' }),
  w({ id: 'aegis-projector', name: 'Aegis Projector', kind: 'support', tier: 2, price: 55, chargeMs: 16000, crewDamage: 0, support: 'shield', target: 'ally', blurb: 'Fire at an ally: grants an extra shield layer for 10 seconds.' }),
  w({ id: 'medic-pulse', name: 'Medic Pulse', kind: 'support', tier: 1, price: 40, chargeMs: 12000, damage: 40, crewDamage: 0, support: 'heal', target: 'ally', blurb: 'Fire at an allied room: heals everyone inside by 40.' }),
  w({ id: 'flechette-cannon', name: 'Flechette Cannon', kind: 'laser', tier: 1, price: 40, chargeMs: 8500, damage: 1, crewDamage: 45, blurb: 'A cloud of needles that shreds crew in the struck room.' }),
  w({ id: 'dart-missile', name: 'Dart Missile', kind: 'missile', tier: 1, price: 35, chargeMs: 7000, damage: 1, pierce: 9, ammo: 1, blurb: 'A cheap, quick missile that ignores shields.' }),
  w({ id: 'phase-laser', name: 'Phase Laser', kind: 'laser', tier: 2, price: 75, chargeMs: 13000, damage: 2, pierce: 1, blurb: 'Slips straight through a single shield layer.' }),
  w({ id: 'incendiary-cannon', name: 'Incendiary Cannon', kind: 'laser', tier: 2, price: 65, chargeMs: 13000, shots: 2, damage: 1, fireChance: .45, blurb: 'Two burning bolts that set rooms ablaze.' }),
  w({ id: 'ion-scatter', name: 'Ion Scatter', kind: 'ion', tier: 2, price: 70, chargeMs: 13000, shots: 2, ion: 1, crewDamage: 0, blurb: 'Two ion bolts: strip two layers or stun two systems.' }),
  w({ id: 'burst-laser-iii', name: 'Burst Laser III', kind: 'laser', tier: 3, price: 115, chargeMs: 15000, shots: 4, damage: 1, blurb: 'Four bolts. Heavy shields do not last long.' }),
  w({ id: 'twin-heavy-laser', name: 'Twin Heavy Laser', kind: 'laser', tier: 3, price: 105, chargeMs: 15000, shots: 2, damage: 2, fireChance: .15, crewDamage: 30, blurb: 'Two heavy bolts that punch holes and start fires.' }),
  w({ id: 'glaive-beam', name: 'Glaive Beam', kind: 'beam', tier: 3, price: 125, chargeMs: 22000, damage: 3, beamRooms: 3, fireChance: .1, blurb: 'Three damage per room across three rooms; each shield layer absorbs one.' }),
  w({ id: 'pegasus-missile', name: 'Pegasus Missile', kind: 'missile', tier: 3, price: 110, chargeMs: 17000, shots: 2, damage: 2, pierce: 9, ammo: 2, fireChance: .15, blurb: 'Twin warheads that ignore shields. Uses two missiles.' }),
  w({ id: 'storm-flak', name: 'Storm Flak', kind: 'flak', tier: 3, price: 100, chargeMs: 20000, shots: 7, damage: 1, crewDamage: 10, blurb: 'Seven fragments blanket the target room and its neighbours.' }),
  w({ id: 'nanite-storm', name: 'Nanite Storm', kind: 'support', tier: 3, price: 95, chargeMs: 18000, damage: 4, crewDamage: 0, support: 'repair', target: 'ally', blurb: 'Fire at an ally: repairs 4 hull and fixes the struck system.' }),
];

/** upgradePrices[k] is the cost from tier k+1 to k+2; installPrice buys tier 1 of an empty system room. */
export const SYSTEMS: readonly SystemDef[] = [
  { id: 'helm', name: 'Helm', short: 'HLM', blurb: 'Must be crewed for the ship to dodge. Higher tiers add evasion.', maxTier: 3, installPrice: 0, upgradePrices: [30, 45] },
  { id: 'engines', name: 'Engines', short: 'ENG', blurb: '+5% evasion per level and faster FTL charge.', maxTier: 5, installPrice: 0, upgradePrices: [15, 25, 35, 45] },
  { id: 'shields', name: 'Shields', short: 'SHD', blurb: 'One shield layer per level. Each layer stops one laser bolt.', maxTier: 4, installPrice: 0, upgradePrices: [60, 90, 130] },
  { id: 'weapons', name: 'Weapons', short: 'WPN', blurb: 'Each level powers one weapon slot.', maxTier: 4, installPrice: 0, upgradePrices: [40, 60, 80] },
  { id: 'oxygen', name: 'Oxygen', short: 'O₂', blurb: 'Refills air. Crew suffocate in empty rooms.', maxTier: 3, installPrice: 0, upgradePrices: [25, 40] },
  { id: 'medbay', name: 'Medbay', short: 'MED', blurb: 'Heals crew standing inside.', maxTier: 3, installPrice: 0, upgradePrices: [30, 45] },
  { id: 'teleporter', name: 'Teleporter', short: 'TEL', blurb: 'Beam crew from this room to any ship. More levels, shorter cooldown.', maxTier: 3, installPrice: 75, upgradePrices: [40, 60] },
  { id: 'cloak', name: 'Cloak', short: 'CLK', blurb: 'Vanish for a few seconds: +60% evasion.', maxTier: 3, installPrice: 90, upgradePrices: [45, 70] },
  { id: 'defense', name: 'Point Defense', short: 'PDS', blurb: 'Shoots down incoming missiles and flak.', maxTier: 3, installPrice: 70, upgradePrices: [40, 60] },
];

export const AUGMENTS: readonly AugmentDef[] = [
  { id: 'auto-loader', name: 'Auto-Loader', price: 60, blurb: 'Weapons charge 12% faster.' },
  { id: 'reinforced-plating', name: 'Reinforced Plating', price: 45, blurb: '+6 maximum hull.' },
  { id: 'scrap-magnet', name: 'Scrap Magnet', price: 40, blurb: 'Earn 15% more scrap.' },
  { id: 'ion-dampers', name: 'Ion Dampers', price: 45, blurb: 'Ion effects on your ship last half as long.' },
  { id: 'thruster-kit', name: 'Thruster Kit', price: 50, blurb: '+7% evasion while the helm is crewed.' },
  { id: 'shield-capacitor', name: 'Shield Capacitor', price: 60, blurb: 'Shield layers recharge 30% faster.' },
  { id: 'nanite-medics', name: 'Nanite Medics', price: 50, blurb: 'Crew slowly heal anywhere on your ship.' },
  { id: 'fire-suppressant', name: 'Fire Suppressant', price: 40, blurb: 'Fires burn out twice as fast and spread less.' },
  { id: 'missile-recycler', name: 'Missile Recycler', price: 45, blurb: '35% chance a missile shot costs no ammo.' },
  { id: 'hull-welders', name: 'Hull Welders', price: 55, blurb: 'Repair 2 hull after every jump.' },
  { id: 'precision-optics', name: 'Precision Optics', price: 55, blurb: 'Enemies get 10% less evasion against your shots.' },
  { id: 'pre-igniter', name: 'Pre-Igniter', price: 65, blurb: 'Weapons start every battle fully charged.' },
  { id: 'reactive-armor', name: 'Reactive Armor', price: 60, blurb: '20% chance to shrug off 1 damage from each hit.' },
  { id: 'ftl-booster', name: 'FTL Booster', price: 45, blurb: "The fleet's FTL drive charges 25% faster in battle." },
  { id: 'salvage-arm', name: 'Salvage Arm', price: 50, blurb: 'One extra piece of salvage after every victory.' },
  { id: 'repair-drone', name: 'Repair Drone', price: 70, blurb: 'Patches 1 hull every 20 seconds of battle.' },
];

export const SPECIES: readonly SpeciesDef[] = [
  { id: 'human', name: 'Human', blurb: 'Balanced health, speed, combat and repair.', maxHp: 100, speed: 1, melee: 1, repair: 1, color: '#78c9e8' },
  { id: 'bastion', name: 'Bastion', blurb: 'Mineral folk: 140 health, 20% slower.', maxHp: 140, speed: .8, melee: 1, repair: 1, color: '#b5a1dd' },
  { id: 'skitter', name: 'Skitter', blurb: 'Insect folk: 25% faster, 85 health.', maxHp: 85, speed: 1.25, melee: 1, repair: 1, color: '#9bd576' },
  { id: 'ember', name: 'Ember', blurb: 'Fire-blooded brawlers: +25% melee, repair 15% slower.', maxHp: 100, speed: 1, melee: 1.25, repair: .85, color: '#f0aa68' },
];
export const ROLES: readonly { id: CrewRole; name: string; blurb: string; station: SystemId | null }[] = [
  { id: 'pilot', name: 'Pilot', blurb: '+5% evasion at the helm.', station: 'helm' },
  { id: 'gunner', name: 'Gunner', blurb: 'Weapons charge 10% faster while crewed.', station: 'weapons' },
  { id: 'engineer', name: 'Engineer', blurb: 'Repairs 50% faster; shields recharge faster while crewed.', station: 'shields' },
  { id: 'medic', name: 'Medic', blurb: 'Heals crew in the same room.', station: 'medbay' },
  { id: 'soldier', name: 'Soldier', blurb: '+30% melee damage.', station: null },
];

/** Hangar paint swatches; the server accepts any #rrggbb but phones offer these. */
export const PAINTS = ['#3fa7ff', '#28c6e7', '#78d955', '#ffd24a', '#ff9b3d', '#ff5748', '#ff7ac8', '#b58aff'] as const;

const find = <T extends { id: string }>(list: readonly T[], kind: string) => (id: string) => { const found = list.find(item => item.id === id); if (!found) throw new Error(`Unknown ${kind} ${id}`); return found; };
export const weaponDef = find(WEAPONS, 'weapon'), systemDef = find(SYSTEMS, 'system'), augmentDef = find(AUGMENTS, 'augment');
export const speciesDef = (id: SpeciesId) => SPECIES.find(s => s.id === id) ?? SPECIES[0];
