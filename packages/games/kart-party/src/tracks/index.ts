import type { TrackDef, TrackId } from '../sim/types';
import { buildTrack, type Track } from '../sim/track';
import { palmBay } from './palm-bay';
import { mesaRally } from './mesa-rally';
import { neonDrive } from './neon-drive';
import { frostPeak } from './frost-peak';
import { rainbowRoad } from './rainbow-road';
/** Display order of the courses. */
export const TRACK_DEFS: Record<TrackId, TrackDef> = { 'palm-bay': palmBay, 'mesa-rally': mesaRally, 'neon-drive': neonDrive, 'frost-peak': frostPeak, 'rainbow-road': rainbowRoad };
export const TRACK_IDS = Object.keys(TRACK_DEFS) as TrackId[];
export const isTrackId = (id: unknown): id is TrackId => typeof id === 'string' && Object.hasOwn(TRACK_DEFS, id);
const cache = new Map<TrackId, Track>();
/** Built tracks are immutable and cached per process/page. */
export function getTrack(id: TrackId): Track {
  let track = cache.get(id);
  if (!track) cache.set(id, track = buildTrack(TRACK_DEFS[id]));
  return track;
}
