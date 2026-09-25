/* Server-only NPC layouts. Never import from client code. */
import type { MissionId, NpcKind } from '../model';
import { ferry } from './ferry';
import { glasshouse } from './glasshouse';
import { velvet } from './velvet';

/** Route stops are cell coordinates [x, y, pauseSeconds?, lookAngleRadians?]. The NPC starts at the first stop and loops. */
export type Stop = [number, number, number?, number?];
export type NpcSpawn = { kind: NpcKind; route: Stop[] };
export type ServerLevel = { npcs: NpcSpawn[]; reinforcements?: { delay: number; npcs: NpcSpawn[] } };
const LEVELS: Record<MissionId, ServerLevel> = { velvet, glasshouse, ferry };
export const getServerLevel = (id: MissionId): ServerLevel => structuredClone(LEVELS[id]);
