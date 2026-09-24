/* Characters, kart bodies and speed classes. Differences stay small (a few percent) so any pick can win;
 * they change feel more than outcome. */
import type { Difficulty, KartBodyId, SpeedClass } from './types';

export type Weight = 'light' | 'medium' | 'heavy';
export type Character = { name: string; species: string; weight: Weight; color: string; accent: string };
export const CHARACTERS: readonly Character[] = [
  { name: 'Mochi', species: 'hamster', weight: 'light', color: '#ffb347', accent: '#fff1d6' },
  { name: 'Pepper', species: 'fox', weight: 'medium', color: '#ff6a3d', accent: '#fff4ea' },
  { name: 'Bruno', species: 'bear', weight: 'heavy', color: '#8a5a3c', accent: '#f0d2a8' },
  { name: 'Ribbit', species: 'frog', weight: 'light', color: '#5fd35f', accent: '#f4ffd6' },
  { name: 'Luna', species: 'cat', weight: 'medium', color: '#9b7bff', accent: '#f3edff' },
  { name: 'Waddles', species: 'penguin', weight: 'medium', color: '#2f3d5c', accent: '#ffffff' },
  { name: 'Coco', species: 'bunny', weight: 'light', color: '#ff8fc8', accent: '#fff0f8' },
  { name: 'Rex', species: 'dino', weight: 'heavy', color: '#2fb89a', accent: '#e8fff6' },
];
export type KartBody = { id: KartBodyId; name: string; blurb: string };
export const KART_BODIES: readonly KartBody[] = [
  { id: 'zoomer', name: 'Zoomer', blurb: 'Balanced all-rounder' },
  { id: 'bolt', name: 'Bolt', blurb: 'Highest top speed, twitchy grip' },
  { id: 'tank', name: 'Tank', blurb: 'Quick off the line, shrugs off dirt' },
];
export const isKartBody = (id: unknown): id is KartBodyId => KART_BODIES.some(k => k.id === id);

/** Multipliers around 1 (weight is a collision mass). */
export type KartStats = { speed: number; accel: number; handling: number; weight: number; traction: number };
const WEIGHT: Record<Weight, KartStats> = {
  light: { speed: .98, accel: 1.08, handling: 1.06, weight: .8, traction: 1 },
  medium: { speed: 1, accel: 1, handling: 1, weight: 1, traction: 1 },
  heavy: { speed: 1.025, accel: .93, handling: .95, weight: 1.25, traction: 1 },
};
const BODY: Record<KartBodyId, KartStats> = {
  zoomer: { speed: 1, accel: 1, handling: 1, weight: 1, traction: 1 },
  bolt: { speed: 1.03, accel: .95, handling: .95, weight: 1.05, traction: .95 },
  tank: { speed: .98, accel: 1.08, handling: 1, weight: 1.1, traction: 1.25 },
};
export function kartStats(character: number, kart: KartBodyId): KartStats {
  const w = WEIGHT[CHARACTERS[character]?.weight ?? 'medium'], b = BODY[kart] ?? BODY.zoomer;
  return { speed: w.speed * b.speed, accel: w.accel * b.accel, handling: w.handling * b.handling, weight: w.weight * b.weight, traction: w.traction * b.traction };
}
/** Base top speed in m/s per class. Laps are designed for ~35–45 s at 100cc. */
export const TOP_SPEED: Record<SpeedClass, number> = { 50: 23, 100: 29, 150: 35, 200: 41 };
export const SPEED_CLASSES: readonly SpeedClass[] = [50, 100, 150, 200];
export const isSpeedClass = (n: unknown): n is SpeedClass => SPEED_CLASSES.includes(n as SpeedClass);
/** CPU pace relative to a perfect human line (rubber-banding adjusts around this). */
export const CPU_SKILL: Record<Difficulty, number> = { easy: .88, normal: .95, hard: .985 };
