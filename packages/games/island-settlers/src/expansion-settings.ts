import type { Settings } from './model';
import { MISSIONS, SCENARIOS, VARIANTS, type Scenario, type Variant } from './expansion-model';

export const SCENARIO_NAMES: Record<Scenario, string> = { fishing: 'Fishing on Catan', rivers: 'Rivers of Catan', caravans: 'Merchant Trains', 'barbarian-attack': 'Barbarian Attack', traders: 'Traders & Barbarians: deliveries' };
export const VARIANT_NAMES: Record<Variant, string> = { 'friendly-robber': 'Friendly robber', harbormaster: 'Strongest ports' };
export const DEFAULT_SETTINGS: Settings = { mode: 'standard', expansion: 'seafarers', roundSeconds: 90, targetPoints: 12, citiesKnights: false, scenarios: [], variants: [], missions: [...MISSIONS] };
/** Configuration only; shared with the settings UI so rejected combinations have the same explanation. */
export function expansionRestrictions(s: Partial<Settings>): Partial<Record<Scenario | Variant, string>> {
  const reasons: Partial<Record<Scenario | Variant, string>> = {};
  if (s.expansion === 'explorers') {
    for (const key of ['rivers', 'caravans', 'barbarian-attack', 'traders'] as const) reasons[key] = 'This scenario requires the land-board systems replaced by Explorers & Pirates. Choose Base or Seafarers.';
    reasons['friendly-robber'] = 'Explorers & Pirates has no land robber.';
    reasons.harbormaster = 'Explorers & Pirates replaces trading ports with harbor settlements.';
  }
  if (s.scenarios?.some(k => k === 'barbarian-attack' || k === 'traders')) reasons['friendly-robber'] = 'This scenario replaces the land robber with barbarians.';
  return reasons;
}
export function suggestedPoints(s: Partial<Settings>): number {
  const scenarios = s.scenarios ?? [], ck = !!s.citiesKnights;
  let points = s.expansion === 'explorers' ? 8 + (s.missions?.length ?? 3) * 3 + (ck ? 5 : 0) : s.expansion === 'seafarers' ? 12 : 10;
  if (s.expansion !== 'explorers') points = Math.max(points, scenarios.includes('traders') ? 13 : scenarios.some(k => k === 'caravans' || k === 'barbarian-attack') ? 12 : 10) + (ck ? s.expansion === 'base' && !scenarios.includes('traders') && !scenarios.includes('caravans') ? 3 : 2 : 0);
  return Math.max(10, points) + (s.variants?.includes('harbormaster') ? 1 : 0);
}
export function maximumTargetPoints(s: Partial<Settings>): number {
  if (s.citiesKnights || s.scenarios?.some(k => k === 'traders' || k === 'barbarian-attack')) return 30;
  return s.expansion === 'explorers' ? Math.min(30, 13 + 4 * (s.missions?.length ?? 3)) : s.expansion === 'base' ? 22 : 30;
}
export function validateExpansionSettings(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  function list<T extends string>(value: unknown, allowed: readonly T[]): T[] {
    if (!Array.isArray(value) || value.length > allowed.length || value.some(v => !allowed.includes(v)) || new Set(value).size !== value.length) throw new Error('Choose valid, distinct expansion options.');
    return allowed.filter(v => value.includes(v));
  }
  if (!['base', 'seafarers', 'explorers'].includes(s.expansion) || !['standard', 'connect'].includes(s.mode) || ![60, 90, 120].includes(s.roundSeconds) || typeof s.citiesKnights !== 'boolean') throw new Error('Choose valid game settings.');
  s.scenarios = list(s.scenarios, SCENARIOS); s.variants = list(s.variants, VARIANTS); s.missions = list(s.missions, MISSIONS);
  if (s.expansion === 'explorers' && !s.missions.length) throw new Error('Choose at least one expedition mission.');
  s.targetPoints = raw.targetPoints === undefined ? suggestedPoints(s) : Number(raw.targetPoints);
  if (!Number.isInteger(s.targetPoints) || s.targetPoints < 10 || s.targetPoints > maximumTargetPoints(s)) throw new Error(`Choose a victory target from 10 to ${maximumTargetPoints(s)} for this setup.`);
  const reasons = expansionRestrictions(s);
  for (const key of [...s.scenarios, ...s.variants]) if (reasons[key]) throw new Error(reasons[key]);
  return { mode: s.mode, expansion: s.expansion, roundSeconds: s.roundSeconds, targetPoints: s.targetPoints, citiesKnights: s.citiesKnights, scenarios: s.scenarios, variants: s.variants, missions: s.missions };
}
