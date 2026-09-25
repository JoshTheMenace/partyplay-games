/** Core rule switches. Core code reads these; modules set them in registry order (ENGINE §14.2). */
import type { BuildingKind, RouteKind, Settings } from '../model';

export type Profile = {
  devCards: boolean;
  largestArmy: boolean;
  longestRoad: boolean;
  robber: boolean;
  pirate: boolean;
  /** Cities & Knights: no robber until the first barbarian attack. */
  robberWaitsForFirstAttack: boolean;
  bankRate: 3 | 4;
  ports: boolean;
  routeKinds: RouteKind[];
  commodities: boolean;
  /** A movement command locks building and trading for the rest of the opportunity. */
  movementLocksBuilding: boolean;
  /** Buildings placed in setup rounds 1 and 2. */
  setupPieces: [BuildingKind, BuildingKind];
  /**
   * Barbarian Attack with C&K (official combination): coastal invaders replace the barbarian ship
   * track, and castle guards replace the C&K vertex knights.
   */
  coastalBarbarians: boolean;
  /** Settlements may become cities (Explorers & Pirates has none unless Cities & Knights joins). */
  cities: boolean;
  /** Multiplies the round-limit safety net (Cities & Knights plays more rolls to its higher target). */
  roundLimitScale: number;
};

export const baseProfile = (): Profile => ({
  devCards: true, largestArmy: true, longestRoad: true, robber: true, pirate: false,
  robberWaitsForFirstAttack: false, bankRate: 4, ports: true, routeKinds: ['road'],
  commodities: false, movementLocksBuilding: false, setupPieces: ['settlement', 'settlement'],
  coastalBarbarians: false, cities: true, roundLimitScale: 1,
});

type WithProfile = { profile?(p: Profile, s: Settings): void };

export function buildProfile(settings: Settings, modules: readonly WithProfile[]): Profile {
  const p = baseProfile();
  for (const m of modules) m.profile?.(p, settings);
  return p;
}
