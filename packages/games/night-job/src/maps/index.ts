import type { HeistMap, LevelSource, MissionId } from '../model';
import { parseLevel } from '../level';
import { ferry } from './ferry';
import { glasshouse } from './glasshouse';
import { velvet } from './velvet';

const cache = new Map<MissionId, HeistMap>();
export const LEVELS: Record<MissionId, LevelSource> = { velvet, glasshouse, ferry };
/** Parsed public layout for a mission. Throws on an unknown id. */
export function getMap(id: MissionId): HeistMap {
  let map = cache.get(id);
  if (!map) {
    if (!Object.hasOwn(LEVELS, id)) throw Error(`Unknown Night Job mission "${id}".`);
    map = parseLevel(LEVELS[id]); cache.set(id, map);
  }
  return map;
}
