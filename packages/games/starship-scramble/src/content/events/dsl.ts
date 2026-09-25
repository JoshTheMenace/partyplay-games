/** Terse builders for authored events. Every helper returns plain EventDef data. */
import type { CrewRole, NodeKind, SpeciesId, SystemId } from '../../contracts';
import type { ChoiceDef, EventDef, EventEffect, Outcome, Requirement, Who } from '../types';

type Combat = Extract<EventEffect, { kind: 'combat' }>;
export const ev = (id: string, sectors: EventDef['sectors'], kinds: readonly NodeKind[], title: string, text: string, choices: ChoiceDef[], extra: Partial<Pick<EventDef, 'weight' | 'unique' | 'requiresFlag'>> = {}): EventDef =>
  ({ id, title, text, sectors, kinds: [...kinds], weight: 1, choices, ...extra });
export const opt = (id: string, label: string, outcomes: Outcome[], requires?: Requirement): ChoiceDef => ({ id, label, outcomes, ...requires && { requires } });
export const out = (text: string, effects: EventEffect[] = [], weight = 1): Outcome => ({ weight, text, effects });
/** A choice with a single guaranteed outcome. */
export const opt1 = (id: string, label: string, text: string, effects: EventEffect[] = [], requires?: Requirement) => opt(id, label, [out(text, effects)], requires);
export const leave = (text = 'The fleet moves on. Some doors are best left shut.') => opt1('leave', 'Move on', text);

export const scrap = (amount: number): EventEffect => ({ kind: 'scrap', amount });
export const hull = (amount: number, who: Who = 'fleet'): EventEffect => ({ kind: 'hull', amount, who });
export const hurt = (amount: number, who: Who = 'random'): EventEffect => ({ kind: 'crewDamage', amount, who });
export const fight = (enemies: Combat['enemies'] = 'sector', extra: Omit<Combat, 'kind' | 'enemies'> = {}): EventEffect => ({ kind: 'combat', enemies, ...extra });
export const armada = (amount: number): EventEffect => ({ kind: 'armada', amount });
export const flag = (name: string): EventEffect => ({ kind: 'flag', flag: name });
export const weapon = (tier?: 1 | 2 | 3, id?: string): EventEffect => ({ kind: 'item', item: 'weapon', ...tier && { tier }, ...id && { id } });
export const augment = (id?: string): EventEffect => ({ kind: 'item', item: 'augment', ...id && { id } });
export const recruit = (species?: SpeciesId, role?: CrewRole): EventEffect => ({ kind: 'crew', ...species && { species }, ...role && { role } });
export const reveal: EventEffect = { kind: 'reveal' }, store: EventEffect = { kind: 'store' }, crewLoss: EventEffect = { kind: 'crewLoss' };

export const pay = (amount: number): Requirement => ({ kind: 'scrap', amount });
export const sys = (system: SystemId, tier = 1): Requirement => ({ kind: 'system', system, tier });
export const kin = (species: SpeciesId): Requirement => ({ kind: 'species', species });
export const role = (role: CrewRole): Requirement => ({ kind: 'role', role });
