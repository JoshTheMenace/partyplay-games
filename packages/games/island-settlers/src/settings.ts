/**
 * Settings validation shared by the server and the SettingsView (browser-safe: imports model.ts only).
 * Every rejected combination carries a one-line reason (ENGINE §14.4); nothing is silently dropped.
 */
import {
  CPU_LEVELS, DEFAULT_SETTINGS, MAPS, MISSIONS, MODES, MODULE_IDS, ROUND_SECONDS, SCENARIOS,
  SEAFARERS_SCENARIOS, TABLE_SIZE, TARGET_RANGE, TIMER_PRESETS, VARIANTS,
  type ModuleId, type Scenario, type Settings, type Variant,
} from './model';

export type OptionKey = Scenario | Variant;

const NEEDS_HOME: readonly Scenario[] = ['rivers', 'caravans', 'barbarian-attack', 'deliveries'];
const SCENARIO_FLOOR: Record<Scenario, number> = {
  fishing: 10, rivers: 10, caravans: 12, 'barbarian-attack': 12, deliveries: 13,
};
/** Official combination sheets (catan.com): a pair's exact target, replacing both floors; C&K is one side. */
const PAIR_TARGET: [string, string, number][] = [
  ['barbarian-attack', 'deliveries', 14], ['caravans', 'deliveries', 15], ['fishing', 'deliveries', 12],
  ['fishing', 'rivers', 10], ['caravans', 'cities-knights', 15], ['deliveries', 'cities-knights', 15],
];
const SEAFARERS_BASE = { 'new-shores': 14, 'four-islands': 13, 'fog-islands': 12 } as const;
/** E&P mission guide: Land Ho! 8, + Pirate Lairs 12, + Fish for Catan 15, + Spices 17. */
const MISSION_POINTS = { lairs: 4, fish: 3, spices: 2 } as const;
/** Seafarers sheets: Caravans +2 and Deliveries (the T&B scenario) +3 over the map; the rest unchanged. */
const SEAFARERS_BONUS: Partial<Record<Scenario, number>> = { caravans: 2, deliveries: 3 };

/** Options that are unavailable with the other current choices, each with the reason shown to the host. */
export function restrictions(s: Partial<Settings>): Partial<Record<OptionKey, string>> {
  const reasons: Partial<Record<OptionKey, string>> = {};
  if (s.map === 'seafarers' && s.seafarers === 'four-islands') {
    // PartyPlay adaptation (ENGINE §19): the official sheet also allows Caravans here.
    const why = 'PartyPlay: Four Islands has no home island for this scenario.';
    for (const key of NEEDS_HOME) reasons[key] = why;
  }
  if (s.scenarios?.some(k => k === 'barbarian-attack' || k === 'deliveries')) {
    reasons['friendly-robber'] = 'This scenario replaces the land robber.';
  }
  if (s.map === 'explorers') {
    for (const key of NEEDS_HOME) reasons[key] = 'Explorers & Pirates allows only Fishing among the scenarios.';
    reasons['friendly-robber'] = 'Explorers & Pirates has no land robber.';
    reasons.harbormaster = 'Explorers & Pirates replaces ports with harbor settlements.';
  }
  return reasons;
}

/** The target applied when the host leaves targetPoints unset. */
export function suggestedTarget(s: Partial<Settings>): number {
  const ck = !!s.citiesKnights, map = s.map ?? 'base', scenarios = s.scenarios ?? [];
  const on = new Set<string>([...scenarios, ...(ck ? ['cities-knights'] : [])]);
  const bonus = Math.max(0, ...scenarios.map(k => SEAFARERS_BONUS[k] ?? 0));
  const seafarers = SEAFARERS_BASE[s.seafarers ?? 'new-shores'] + bonus;
  const missions = (s.missions ?? [...MISSIONS]).reduce((n, m) => n + MISSION_POINTS[m], 8);
  const base = map === 'explorers' ? missions + (ck ? 5 : 0)
    : map === 'seafarers' ? seafarers + (ck ? 2 : 0) : 10 + (ck ? 3 : 0);
  const pairs = PAIR_TARGET.filter(([a, b]) => on.has(a) && on.has(b));
  const paired = new Set(pairs.flatMap(([a, b]) => [a, b]));
  const floors = scenarios.filter(k => !paired.has(k)).map(k => SCENARIO_FLOOR[k]);
  let points = Math.max(base, ...pairs.map(p => p[2]), ...floors);
  if (s.variants?.includes('harbormaster')) points++;
  return Math.min(Math.max(points, TARGET_RANGE.min), maxTarget(s));
}

/** Highest target the host may pick (port of legacy maximumTargetPoints). */
export function maxTarget(s: Partial<Settings>): number {
  const heavy = s.scenarios?.some(k => k === 'deliveries' || k === 'barbarian-attack');
  if (s.citiesKnights || heavy) return TARGET_RANGE.max;
  if (s.map === 'explorers') return Math.min(TARGET_RANGE.max, 13 + 4 * (s.missions ?? MISSIONS).length);
  return s.map === 'base' || !s.map ? 22 : TARGET_RANGE.max;
}

/** Active rule modules in registry order. */
export function modulesFor(s: Settings): ModuleId[] {
  const on = new Set<string>([...s.scenarios, ...s.variants]);
  if (s.map !== 'base') on.add(s.map);
  if (s.citiesKnights) on.add('cities-knights');
  return MODULE_IDS.filter(id => on.has(id));
}

function fail(reason: string): never { throw new Error(reason); }

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], what: string): T {
  return allowed.includes(value as T) ? value as T : fail(`Choose a valid ${what}.`);
}

function list<T extends string>(value: unknown, allowed: readonly T[], what: string): T[] {
  const ok = Array.isArray(value) && value.every(v => allowed.includes(v)) && new Set(value).size === value.length;
  return ok ? allowed.filter(v => value.includes(v)) : fail(`Choose valid, distinct ${what}.`);
}

export function validateSettings(raw: unknown): Settings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('Settings must be an object.');
  const r = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
  const flags = typeof r.citiesKnights === 'boolean' && typeof r.balancedDice === 'boolean';
  if (!flags) fail('Choose valid game options.');
  if (!Number.isInteger(r.tableSize) || r.tableSize < TABLE_SIZE.min || r.tableSize > TABLE_SIZE.max) {
    fail(`Choose a table size from ${TABLE_SIZE.min} to ${TABLE_SIZE.max}.`);
  }
  const s: Settings = {
    mode: oneOf(r.mode, MODES, 'mode'),
    map: oneOf(r.map, MAPS, 'map'),
    seafarers: oneOf(r.seafarers, SEAFARERS_SCENARIOS, 'Seafarers scenario'),
    citiesKnights: r.citiesKnights,
    scenarios: list(r.scenarios, SCENARIOS, 'scenarios'),
    variants: list(r.variants, VARIANTS, 'variants'),
    missions: list(r.missions, MISSIONS, 'missions'),
    targetPoints: 0,
    timer: oneOf(r.timer, TIMER_PRESETS, 'timer'),
    roundSeconds: oneOf(r.roundSeconds, ROUND_SECONDS, 'round length'),
    tableSize: r.tableSize,
    cpuLevel: oneOf(r.cpuLevel, CPU_LEVELS, 'CPU level'),
    balancedDice: r.balancedDice,
  };
  const reasons = restrictions(s);
  for (const key of [...s.scenarios, ...s.variants]) if (reasons[key]) fail(reasons[key]);
  const given = (raw as Partial<Settings>).targetPoints;
  s.targetPoints = given === undefined ? suggestedTarget(s) : Number(given);
  const max = maxTarget(s);
  if (!Number.isInteger(s.targetPoints) || s.targetPoints < TARGET_RANGE.min || s.targetPoints > max) {
    fail(`Choose a victory target from ${TARGET_RANGE.min} to ${max} for this setup.`);
  }
  return s;
}
