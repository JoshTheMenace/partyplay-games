/** Names and colour meta for everything the UI prints. No rules live here. */
import type {
  AwardId, CargoKind, CpuLevel, DevKind, Emote, Good, MapKind, Mission, Mode, PieceKind, PublicView,
  SeafarersScenario, Scenario, SeatStatus, Settings, Terrain, TimerPreset, Track, Variant,
} from '../../model';

/** Modes whose engine profile turns dev cards (and so Largest Army) off. */
const NO_DEV_CARDS = new Set(['cities-knights', 'explorers', 'barbarian-attack']);
export const hasDevCards = (pub: PublicView) => !pub.modules.some(m => NO_DEV_CARDS.has(m));

/** "road-building" → "Road Building". */
export const titleCase = (text: string) =>
  text.replace(/[-_/]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** UI card colours (EXPERIENCE §1.2): brighter than the terrain. deep is the pressed/outline shade. */
export const GOOD_META: Record<Good, { label: string; color: string; deep: string }> = {
  wood: { label: 'Wood', color: '#2f9a5f', deep: '#1f6b43' },
  brick: { label: 'Brick', color: '#d8683f', deep: '#a1472a' },
  wool: { label: 'Wool', color: '#a3dc6f', deep: '#6faa47' },
  grain: { label: 'Grain', color: '#f0c24d', deep: '#bf8f2b' },
  ore: { label: 'Ore', color: '#9aa1b8', deep: '#5f657c' },
  paper: { label: 'Paper', color: '#efe3bf', deep: '#a8935f' },
  cloth: { label: 'Cloth', color: '#cf95dc', deep: '#8a4f9c' },
  coin: { label: 'Coin', color: '#ffd24a', deep: '#b58a15' },
};

/** Terrain names and map colours (EXPERIENCE §1.2 top/side). */
export const TERRAIN_META: Record<Terrain, { label: string; top: string; side: string }> = {
  wood: { label: 'Forest', top: '#3f7d4e', side: '#2c5a39' },
  brick: { label: 'Hills', top: '#b8633f', side: '#8a4630' },
  wool: { label: 'Pasture', top: '#8fbf5f', side: '#6a9446' },
  grain: { label: 'Fields', top: '#d4a843', side: '#a8822c' },
  ore: { label: 'Mountains', top: '#8d93a6', side: '#646a7e' },
  desert: { label: 'Desert', top: '#dcc590', side: '#b39d68' },
  gold: { label: 'Gold field', top: '#e39a2e', side: '#b3741a' },
  sea: { label: 'Sea', top: '#2b86b8', side: '#1f6590' },
  fog: { label: 'Unexplored', top: '#2a3e5c', side: '#1d2b40' },
  lake: { label: 'Lake', top: '#3b8fc9', side: '#25689a' },
  oasis: { label: 'Oasis', top: '#7fbf9e', side: '#4d8f74' },
  castle: { label: 'Castle', top: '#b3a489', side: '#7d7360' },
  quarry: { label: 'Quarry', top: '#a99d95', side: '#766e68' },
  glassworks: { label: 'Glassworks', top: '#b7d8e8', side: '#8097a2' },
  spice: { label: 'Spice island', top: '#c9694f', side: '#9a4b37' },
  shoal: { label: 'Fish shoal', top: '#4fa3c9', side: '#35718d' },
  council: { label: 'Council island', top: '#c9b98a', side: '#8d8161' },
};

export const TRACK_META: Record<Track, { label: string; color: string; metropolis: string; good: Good }> = {
  science: { label: 'Science', color: '#78d955', metropolis: 'Aqueduct', good: 'paper' },
  trade: { label: 'Trade', color: '#ffd24a', metropolis: 'Market', good: 'cloth' },
  politics: { label: 'Politics', color: '#28c6e7', metropolis: 'Fortress', good: 'coin' },
};

export const DEV_META: Record<DevKind, { label: string; blurb: string }> = {
  knight: { label: 'Knight', blurb: 'Move the robber and steal 1 card. Counts toward Largest Army.' },
  'road-building': { label: 'Road Building', blurb: 'Place 2 free roads or ships now.' },
  plenty: { label: 'Year of Plenty', blurb: 'Take any 2 resources from the bank.' },
  monopoly: { label: 'Monopoly', blurb: 'Name a resource. Everyone gives you all of theirs.' },
  victory: { label: 'Victory point', blurb: 'A hidden point that counts at the end.' },
};

export const PIECE_LABEL: Record<PieceKind, string> = {
  road: 'Road', ship: 'Ship', settlement: 'Settlement', city: 'City', harbor: 'Harbor settlement',
  wall: 'City wall', knight: 'Knight', bridge: 'Bridge', metropolis: 'Metropolis', guard: 'Guard',
  expedition: 'Expedition ship', wagon: 'Wagon', camel: 'Camel', raider: 'Raider', barbarian: 'Barbarian',
};

export const CARGO_LABEL: Record<CargoKind, string> = {
  settler: 'Settler', crew: 'Crew', fish: 'Fish haul', spice: 'Spice', tools: 'Tools', sand: 'Sand',
  marble: 'Marble', glass: 'Glass',
};

export const AWARD_LABEL: Record<AwardId, string> = {
  'longest-road': 'Longest Road', 'largest-army': 'Largest Army', harbormaster: 'Harbormaster',
  wealthiest: 'Wealthiest settler', 'old-boot': 'Old boot',
};

export const MAP_NAMES: Record<MapKind, string> = {
  base: 'Base island', seafarers: 'Seafarers', explorers: 'Explorers & Pirates',
};
export const SEAFARERS_NAMES: Record<SeafarersScenario, string> = {
  'new-shores': 'New Shores', 'four-islands': 'Four Islands', 'fog-islands': 'Fog Islands',
};
export const SCENARIO_NAMES: Record<Scenario, string> = {
  fishing: 'Fishing', rivers: 'Rivers', caravans: 'Caravans', 'barbarian-attack': 'Barbarian Attack',
  deliveries: 'Deliveries',
};
export const VARIANT_NAMES: Record<Variant, string> = {
  'friendly-robber': 'Friendly Robber', harbormaster: 'Harbormaster',
};
export const MISSION_NAMES: Record<Mission, string> = {
  lairs: 'Pirate lairs', fish: 'Fish for the council', spices: 'Spice trade',
};
export const MODE_NAMES: Record<Mode, string> = { standard: 'Standard turns', connect: 'Connect rounds' };
export const TIMER_NAMES: Record<TimerPreset, string> = { off: 'Off', relaxed: 'Relaxed', brisk: 'Brisk' };
export const CPU_NAMES: Record<CpuLevel, string> = { easy: 'Easy', normal: 'Normal', sharp: 'Sharp' };

/** Seat rail line 3 and phone waiting text. */
export const STATUS_TEXT: Record<SeatStatus, string> = {
  idle: '', placing: 'Placing…', rolling: 'Rolling…', acting: 'Playing', paired: 'Build turn',
  discarding: 'Discarding', choosing: 'Choosing…', robbing: 'Choosing a hex', moving: 'Moving…',
  thinking: 'Thinking…', ready: 'Done', offline: 'Offline',
};

export const EMOTE_LABEL: Record<Emote, string> = {
  nice: 'Nice!', ouch: 'Ouch', deal: 'Deal?', 'no-way': 'No way', hurry: 'Hurry up', gg: 'Good game',
};

/** One line naming the chosen systems: "Seafarers: Fog Islands + Cities & Knights + Fishing". */
export function describeSettings(s: Settings) {
  const map = s.map === 'seafarers' ? `Seafarers: ${SEAFARERS_NAMES[s.seafarers]}` : MAP_NAMES[s.map];
  return [map, ...(s.citiesKnights ? ['Cities & Knights'] : []), ...s.scenarios.map(k => SCENARIO_NAMES[k]),
    ...s.variants.map(k => VARIANT_NAMES[k])].join(' + ');
}
