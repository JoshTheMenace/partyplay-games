import { ATTRIBUTES } from '../../fidelity/attributes';
import { FIGHTERS, ROSTER, type Costume, type FighterKind } from '../model';
/** Pure, browser-safe display data for the menus and HUD (no asset imports, so node tests can load it). */
export const SERIES = [
  { id: 'mario', label: 'Mario', fighters: ['mario', 'luigi', 'peach', 'bowser', 'dr-mario'] },
  { id: 'dk', label: 'Donkey Kong', fighters: ['donkey-kong'] },
  { id: 'zelda', label: 'Zelda', fighters: ['link', 'young-link', 'zelda', 'sheik', 'ganondorf'] },
  { id: 'metroid', label: 'Metroid', fighters: ['samus'] },
  { id: 'yoshi', label: 'Yoshi', fighters: ['yoshi'] },
  { id: 'kirby', label: 'Kirby', fighters: ['kirby'] },
  { id: 'starfox', label: 'Star Fox', fighters: ['fox', 'falco'] },
  { id: 'pokemon', label: 'Pokémon', fighters: ['pikachu', 'pichu', 'jigglypuff', 'mewtwo'] },
  { id: 'earthbound', label: 'EarthBound', fighters: ['ness'] },
  { id: 'ice', label: 'Ice Climber', fighters: ['popo', 'nana'] },
  { id: 'fzero', label: 'F-Zero', fighters: ['captain-falcon'] },
  { id: 'fe', label: 'Fire Emblem', fighters: ['marth', 'roy'] },
  { id: 'gw', label: 'Game & Watch', fighters: ['game-watch'] },
  { id: 'bonus', label: 'Bonus', fighters: ['giga-bowser', 'master-hand', 'crazy-hand', 'male-wireframe', 'female-wireframe', 'sandbag'] },
] as const satisfies readonly { id: string; label: string; fighters: readonly FighterKind[] }[];
export type SeriesId = typeof SERIES[number]['id'];
/** Every fighter exactly once, in series order (the order of the select screen). */
export const FIGHTER_ORDER: FighterKind[] = SERIES.flatMap(s => [...s.fighters]);
export const seriesOf = (kind: FighterKind) => SERIES.find(s => (s.fighters as readonly string[]).includes(kind))!;
export const DIRECTIONS = [{ label: 'Neutral', arrow: '●' }, { label: 'Side', arrow: '↔' }, { label: 'Up', arrow: '↑' }, { label: 'Down', arrow: '↓' }] as const;
/** Search by fighter, series or special name; empty query and 'all' match everything. */
export function filterFighters(query: string, series: SeriesId | 'all' = 'all') {
  const q = query.trim().toLowerCase();
  return FIGHTER_ORDER.filter(kind => (series === 'all' || seriesOf(kind).id === series)
    && (!q || [FIGHTERS[kind].name, seriesOf(kind).label, ...FIGHTERS[kind].specials].some(text => text.toLowerCase().includes(q))));
}
type Stat = 'weight' | 'speed' | 'air' | 'fall';
const RAW: Record<Stat, (a: typeof ATTRIBUTES[FighterKind]) => number> = {
  weight: a => a.weight, speed: a => a.dash_max_velocity, air: a => a.air_drift_max, fall: a => a.fast_fall_velocity,
};
const RANGE = Object.fromEntries((Object.keys(RAW) as Stat[]).map(k => { const v = ROSTER.map(id => RAW[k](ATTRIBUTES[id])); return [k, [Math.min(...v), Math.max(...v)]]; })) as Record<Stat, [number, number]>;
export const STAT_LABELS: Record<Stat, string> = { weight: 'Weight', speed: 'Run speed', air: 'Air speed', fall: 'Fall speed' };
/** Melee attributes on a 1–5 scale relative to the whole roster, plus the raw values worth printing. */
export function fighterStats(kind: FighterKind) {
  const a = ATTRIBUTES[kind], bars = {} as Record<Stat, number>;
  for (const k of Object.keys(RAW) as Stat[]) { const [lo, hi] = RANGE[k]; bars[k] = 1 + Math.round((RAW[k](a) - lo) / (hi - lo || 1) * 4); }
  const w = a.weight;
  return { bars, weight: w, jumps: a.max_jumps, height: FIGHTERS[kind].height, weightClass: w >= 108 ? 'Heavyweight' : w >= 95 ? 'Middleweight' : w >= 80 ? 'Lightweight' : 'Featherweight' };
}
/** Melee-style alternate colors, used until the model pipeline ships assets/costumes/<kind>.json. */
const ALTS = [['Red', '#e8453c'], ['Blue', '#3d7bf0'], ['Green', '#45b857']] as const;
export const fallbackCostumes = (kind: FighterKind): Costume[] => [{ name: 'Default', colors: { primary: FIGHTERS[kind].color } }, ...ALTS.map(([name, primary]) => ({ name, colors: { primary } }))];
/** First three colors of a costume for swatches and tinted cards. */
export function costumeColors(costume: Costume, kind: FighterKind) {
  const c = costume.colors, values = Object.values(c), primary = c.primary ?? values[0] ?? FIGHTERS[kind].color;
  return { primary, secondary: c.secondary ?? c.hair ?? values[1] ?? primary, accent: c.accent ?? c.trim ?? values[2] ?? primary };
}
/** White → yellow → orange → red → crimson as damage climbs, like Melee's percent readout. */
export function damageColor(damage: number) {
  const stops: [number, number[]][] = [[0, [255, 250, 240]], [40, [255, 232, 96]], [90, [255, 160, 44]], [150, [255, 70, 44]], [240, [190, 16, 36]]];
  const d = Math.max(0, damage); let i = 0; while (i < stops.length - 2 && d > stops[i + 1][0]) i++;
  const [a, ca] = stops[i], [b, cb] = stops[i + 1], t = Math.min(1, (d - a) / (b - a));
  return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(' ')})`;
}
export const formatClock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const TEAM_COLORS = ['#ff5748', '#28c6e7'] as const, TEAM_NAMES = ['Red team', 'Blue team'] as const;
export const CPU_LEVELS = { 1: 'Easy', 2: 'Normal', 3: 'Hard' } as const;
