import type { SpeciesId } from '../../contracts';

export type SpeciesDefinition = { id: SpeciesId; name: string; description: string; maxHp: number; speed: number; melee: number; repair: number; color: string };
export const SPECIES: readonly SpeciesDefinition[] = [
  { id: 'human', name: 'Human', description: 'Adaptable crew with balanced health, movement, combat and repair.', maxHp: 100, speed: 1, melee: 1, repair: 1, color: '#78c9e8' },
  { id: 'bastion', name: 'Bastion', description: 'Sturdy mineral folk. 140 health, but move 20% slower.', maxHp: 140, speed: .8, melee: 1, repair: 1, color: '#b5a1dd' },
  { id: 'skitter', name: 'Skitter', description: 'Quick insect folk. Move 25% faster, but have 85 health.', maxHp: 85, speed: 1.25, melee: 1, repair: 1, color: '#9bd576' },
  { id: 'ember', name: 'Ember', description: 'Fiery close-combat specialists. Deal 25% more crew damage, but repair 15% slower.', maxHp: 100, speed: 1, melee: 1.25, repair: .85, color: '#f0aa68' },
];
export const speciesFor = (id: SpeciesId = 'human'): SpeciesDefinition => SPECIES.find(species => species.id === id) ?? SPECIES[0];
