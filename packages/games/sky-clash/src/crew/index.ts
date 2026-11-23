/** Every built crew fighter. Browser-safe data: the renderer animates from it and src/moveset.ts compiles its frame data for the simulation. */
import type { CrewKind } from './roster';
import type { CrewDef } from './types';
import { KES } from './kes/index';
import { SOLA } from './sola/index';
import { TOLL } from './toll/index';
import { VESPER } from './vesper/index';
export * from './roster';
export type * from './types';
export const CREW_DEFS: Record<CrewKind, CrewDef> = { sola: SOLA, toll: TOLL, kes: KES, vesper: VESPER };
