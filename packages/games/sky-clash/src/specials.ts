/**
 * Special-move kits for all 33 fighters (browser-safe data; the engine in src/sim/specials.ts runs them).
 * Each fighter's kit is keyed by slot (n, s, hi, lw) in roster order of its specials names (src/roster.ts).
 */
import type { FighterKind } from './model';
import { BONUS_KITS } from './specials/bonus';
import { CAST_KITS } from './specials/cast';
import { MARIO_KITS } from './specials/mario';
import { POKEMON_KITS } from './specials/pokemon';
import type { Kit } from './specials/types';
import { ZELDA_KITS } from './specials/zelda';

export * from './specials/types';
export const KITS = { ...MARIO_KITS, ...ZELDA_KITS, ...POKEMON_KITS, ...CAST_KITS, ...BONUS_KITS } as Record<FighterKind, Kit>;
