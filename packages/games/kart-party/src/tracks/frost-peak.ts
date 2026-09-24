import type { TrackDef } from '../sim/types';
import { course } from './course';

/** Mountain pass (clockwise): pine esses out of the village, three switchback legs with the cliff on the
 * valley side and glazed ice round the top hairpin, the summit turn, then a cliff-side downhill to a
 * boosted ski jump and the frozen lake (mind the snowmen) before the village straight. */
const c = course([
  { go: 60, w: 18, runoffL: 6, runoffR: 6, y: 0, mark: 'start' },
  { turn: -90, r: 36, bank: 6, mark: 't1' },
  { go: 30, w: 16, y: 1, mark: 'foothill' },
  { turn: 30, r: 55, y: 2, mark: 'pines' },
  { turn: -60, r: 50, bank: 5, y: 3.5 },
  { turn: 30, r: 55, y: 5 },
  { go: 30, y: 6 },
  { turn: -90, r: 30, bank: 6, y: 7 },
  { go: 15, y: 8, mark: 'leg1' },
  { go: 65, y: 11, runoffR: 3, edgeR: 'drop' },
  { turn: 180, r: 25, bank: -8, w: 17, runoffR: 5, edgeR: 'wall', y: 13, mark: 'sb1' },
  { go: 15, w: 15, y: 14, mark: 'leg2' },
  { go: 65, runoffL: 3, edgeL: 'drop', y: 17 },
  { turn: -180, r: 25, bank: 8, w: 17, runoffL: 6, edgeL: 'wall', y: 19, mark: 'sb2' },
  { go: 15, w: 16, y: 20, mark: 'leg3' },
  { go: 70, runoffR: 3, edgeR: 'drop', y: 22 },
  { go: 25, runoffR: 5, edgeR: 'wall', y: 23 },
  { turn: -90, r: 40, bank: 7, runoffR: 6, y: 24, mark: 'summit' },
  { go: 20, y: 23.3, mark: 'downhill' },
  { fit: true, runoffL: 5, edgeL: 'drop', y: 21 },
  { turn: 45, r: 55, runoffL: 6, edgeL: 'wall', y: 16, mark: 'sweep' },
  { turn: -45, r: 55, bank: 6, y: 11 },
  { go: 60, y: 3.5, mark: 'jump' },
  { go: 25, y: 0 },
  { go: 50, w: 18, mark: 'lake' },
  { turn: -90, r: 36, bank: 6, mark: 'last' },
  { fit: true, mark: 'village' },
]);

export const frostPeak: TrackDef = {
  id: 'frost-peak', name: 'Frost Peak', theme: 'snow', tagline: 'Icy switchbacks down the mountain.',
  points: c.points,
  boostPads: [
    { at: c.at('leg1', 40), lat: -4 },                         // uphill lane away from the cliff
    { at: c.at('leg3', 55), lat: 4 },                          // cliff-side lane: the brave line
    { at: c.at('jump', 10), lat: 0, width: 5 },                // launches the ski jump
  ],
  ramps: [{ at: c.at('jump', 22), lat: 0, width: 9, height: 1.8 }],
  itemRows: [{ at: c.at('foothill', 15) }, { at: c.at('leg2', 30) }, { at: c.at('downhill', 20) }, { at: c.at('lake', 40) }],
  gaps: [],
  zones: [
    { from: c.at('sb2', 14), to: c.at('sb2', 66), latMin: -14.5, latMax: -3.5, surface: 'ice' },
    { from: c.at('lake', -8), to: c.at('lake', 52), latMin: -15, latMax: 15, surface: 'ice' },
  ],
  obstacles: [
    { at: c.at('lake', 22), lat: -5, radius: 1.2, kind: 'snowman' },
    { at: c.at('lake', 22), lat: 5, radius: 1.2, kind: 'snowman' },
  ],
  landmarks: [
    { kind: 'cabin', at: c.at('start', 30), side: -1, offset: 5, yaw: 10 },
    { kind: 'cabin', at: c.at('village', 30), side: -1, offset: 6, yaw: -15 },
    { kind: 'cabin', at: c.at('village', 55), side: 1, offset: 6, yaw: 5, scale: 1.1 },
    { kind: 'snowman', at: c.at('t1', 28), side: -1, offset: 3 },
    { kind: 'pine_a', at: c.at('pines', 20), side: 1, offset: 4, scale: 1.3 },
    { kind: 'pine_b', at: c.at('pines', 60), side: -1, offset: 4, scale: 1.2 },
    { kind: 'pine_a', at: c.at('pines', 110), side: 1, offset: 4.5, scale: 1.4 },
    { kind: 'pine_b', at: c.at('leg1', 25), side: -1, offset: 5, scale: 1.3 },
    { kind: 'snow_rock', at: c.at('sb1', 39), side: -1, offset: 9, scale: 2 },
    { kind: 'pine_a', at: c.at('leg2', 45), side: 1, offset: 4, scale: 1.4 },
    { kind: 'ice_crystal', at: c.at('sb2', 39), side: 1, offset: 10, scale: 2.2 },
    { kind: 'snow_rock', at: c.at('leg3', 30), side: -1, offset: 5.5, scale: 1.5 },
    { kind: 'pine_b', at: c.at('leg3', 85), side: -1, offset: 5, scale: 1.3 },
    { kind: 'flag_pole', at: c.at('summit', 31), side: 1, offset: 5 },
    { kind: 'ice_crystal', at: c.at('summit', 45), side: 1, offset: 6, scale: 1.4 },
    { kind: 'pine_a', at: c.at('downhill', 25), side: 1, offset: 4, scale: 1.2 },
    { kind: 'pine_b', at: c.at('sweep', 50), side: 1, offset: 5, scale: 1.3 },
    { kind: 'flag_pole', at: c.at('jump', 15), side: 1, offset: 3 },
    { kind: 'ice_crystal', at: c.at('lake', 15), side: 1, offset: 5, scale: 1.3 },
    { kind: 'ice_crystal', at: c.at('lake', 40), side: -1, offset: 6 },
    { kind: 'snowman', at: c.at('last', 30), side: 1, offset: 4.5 },
  ],
};
