import type { Item, Race, Racer, SpeedClass, TrackId } from '../types';
import { DRIVERS } from '../types';
import { TRACKS, angleDelta, sample } from '../tracks';
import { ITEMS, ITEM_IDS } from '../items';
import { SPEED_CLASSES } from '../speed';

/** Multiplier applied to Racer.speed for the HUD readout. Tune alongside the sim's units. */
export const SPEED_SCALE = 3.6;
/** Racer.drift is seconds held. The sim caps it at 3.6 and pays out boost tiers at 0.6, 1.5, and 2.5 seconds. */
export const DRIFT_FULL = 3.6;
export const DRIFT_TIERS = [0.6, 1.5, 2.5] as const;
/** Heading error against the track direction, in radians, that counts as driving the wrong way. */
export const WRONG_WAY_RADIANS = 2;
export const WRONG_WAY_MIN_SPEED = 3;
export const ROOM_CODE_LENGTH = 6;
export const MAX_LAPS = 5;

type ItemMeta = (typeof ITEMS)[Item];
function itemMap<T>(pick: (meta: ItemMeta) => T): Record<Item, T> {
  const out = {} as Record<Item, T>;
  for (const id of ITEM_IDS) out[id] = pick(ITEMS[id]);
  return out;
}

/** Display names, colors, and blurbs come from game/items.ts so the UI and simulation never disagree. */
export const ITEM_LABEL: Record<Item, string> = itemMap((meta) => meta.name);
export const ITEM_COLOR: Record<Item, string> = itemMap((meta) => meta.color);
export const ITEM_DESCRIPTION: Record<Item, string> = itemMap((meta) => meta.description);

/** Short names that fit a phone button at 320px wide. */
export const ITEM_SHORT: Record<Item, string> = {
  boost: 'Comet',
  shell: 'Beetle',
  banana: 'Peel',
  shield: 'Bubble',
  pulse: 'Clap',
  triple: 'Brigade',
  oil: 'Jelly',
  frost: 'Snowball',
  magnet: 'Magnet',
  star: 'Crown',
  rocket: 'Rocket',
  decoy: 'Parcel',
};

export const DIFFICULTY_LABEL: Record<Race['difficulty'], { title: string; blurb: string }> = {
  easy: { title: 'Chill', blurb: 'Relaxed CPUs, generous items.' },
  normal: { title: 'Race', blurb: 'Fair CPUs, balanced items.' },
  hard: { title: 'Grand Prix', blurb: 'Sharp CPUs, no mercy.' },
};

export const TRACK_ORDER: TrackId[] = ['coast', 'canyon', 'midnight', 'rainbow'];

/** Plain-language race length for setup screens. Rounded to the minute and never presented as exact. */
export function formatEstimate(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`;
}

/** "100cc" style label for a speed class; falls back to the number for values the table does not know. */
export function speedLabel(value: SpeedClass) {
  return SPEED_CLASSES.find((option) => option.value === value)?.label ?? `${value}cc`;
}

export function driverOf(index: number) {
  return DRIVERS[((index % DRIVERS.length) + DRIVERS.length) % DRIVERS.length];
}

export function ordinal(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function ordinalSuffix(n: number) {
  return ordinal(n).slice(String(n).length);
}

export function formatTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--.---';
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.floor((total - Math.floor(total)) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatGap(seconds: number) {
  if (seconds < 60) return `+${seconds.toFixed(3)}`;
  return `+${formatTime(seconds)}`;
}

export function speedReadout(racer: Racer) {
  return Math.max(0, Math.round(Math.abs(racer.speed) * SPEED_SCALE));
}

/** Current lap for display, clamped to the race lap count. Racer.lap is treated as 1-based. */
export function displayLap(racer: Racer, race: Race) {
  return Math.max(1, Math.min(race.laps, racer.lap));
}

export function driftTier(racer: Racer): 0 | 1 | 2 | 3 {
  if (racer.drift >= DRIFT_TIERS[2]) return 3;
  if (racer.drift >= DRIFT_TIERS[1]) return 2;
  if (racer.drift >= DRIFT_TIERS[0]) return 1;
  return 0;
}

/** True when the kart is moving and pointed against the track direction at its current position. */
export function wrongWay(race: Race, racer: Racer) {
  if (racer.speed < WRONG_WAY_MIN_SPEED || racer.finishTime != null) return false;
  const ahead = sample(TRACKS[race.track], racer.s).heading;
  return Math.abs(angleDelta(racer.heading, ahead)) > WRONG_WAY_RADIANS;
}

export const DRIFT_TIER_COLOR = ['rgba(255,246,229,0.35)', '#28c6e7', '#ffb05b', '#b58aff'];

/** Final standings: finishers by time, then DNFs by their live rank. */
export function standings(race: Race): Racer[] {
  return [...race.racers].sort((a, b) => {
    if (a.finishTime != null && b.finishTime != null) return a.finishTime - b.finishTime;
    if (a.finishTime != null) return -1;
    if (b.finishTime != null) return 1;
    return a.rank - b.rank;
  });
}

export function humanRacers(race: Race, mode: string, playerId: string): Racer[] {
  if (mode === 'solo') return race.racers.filter((r) => r.id === playerId);
  return race.racers.filter((r) => !r.bot);
}

export function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}
