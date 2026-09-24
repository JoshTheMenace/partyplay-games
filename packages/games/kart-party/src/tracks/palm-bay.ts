import type { TrackDef } from '../sim/types';
import { course } from './course';

/** Beginner seaside loop (clockwise): a wide promenade, boardwalk esses above the surf, the pier straight,
 * a climb to the lighthouse hairpin on the headland, a cliff road with a kicker ramp, the cove sweeper,
 * and a last hairpin whose sandy inside can be cut with the boost pad on its edge (or a nitro). */
const c = course([
  { go: 70, w: 20, runoffL: 8, runoffR: 8, mark: 'start' },
  { turn: -90, r: 34, bank: 6, w: 18, mark: 't1' },
  { go: 30, w: 16, runoffL: 7, runoffR: 6, y: 0.5, mark: 'row1' },
  { turn: 50, r: 45, y: 1, mark: 'boardwalk' },
  { turn: -100, r: 40, bank: 5, y: 1.5 },
  { turn: 50, r: 45 },
  { fit: true, y: 4, mark: 'pier' },
  { turn: -20, r: 80, w: 17, y: 6.5, mark: 'headland' },
  { go: 35, y: 8 },
  { turn: -180, r: 25, bank: 7, w: 18, mark: 'lighthouse' },
  { go: 35, w: 17 },
  { turn: 110, r: 35, y: 6.5, mark: 'crest' },
  { go: 100, y: 2.5, mark: 'cliffroad' },
  { turn: -140, r: 48, bank: 5, y: 1, runoffR: 12, mark: 'cove' },
  { go: 10, y: 0.5, runoffR: 6 },
  { turn: 80, r: 36, bank: -5, y: 0, mark: 'palms' },
  { go: 55, mark: 'dunes' },
  { go: 25, runoffR: 10 },
  { turn: -120, r: 30, bank: 6, w: 18, runoffR: 16, mark: 't4' },
  { fit: true, w: 20, runoffL: 8, runoffR: 8, mark: 'final' },
], 90);

export const palmBay: TrackDef = {
  id: 'palm-bay', name: 'Palm Bay', theme: 'beach', tagline: 'Sunny sweepers along the boardwalk.',
  points: c.points,
  boostPads: [
    { at: c.at('pier', 30), lat: 4.5 },                        // pier: pad lane on the inland side, apex line on the surf side
    { at: c.at('cliffroad', 30), lat: 4.5 },                   // cliff road: pad on the right or the dune kicker on the left
    { at: c.at('t4', -4), lat: 8.5, width: 5, length: 8 },       // last corner: aim at the pad and cut across the sand
  ],
  ramps: [{ at: c.at('cliffroad', 26), lat: -4, width: 7 }],
  itemRows: [{ at: c.at('row1', 15) }, { at: c.at('headland', 45) }, { at: c.at('cliffroad', 78) }, { at: c.at('dunes', 25) }],
  gaps: [],
  zones: [{ from: c.at('boardwalk'), to: c.at('headland'), latMin: -30, latMax: -8.5, surface: 'water' }],
  obstacles: [],
  landmarks: [
    { kind: 'lifeguard_tower', at: c.at('lighthouse', 39), side: 1, offset: 9.5, scale: 1.4 },
    { kind: 'rock_beach', at: c.at('lighthouse', 20), side: -1, offset: 8, scale: 2.4 },
    { kind: 'rock_beach', at: c.at('lighthouse', 62), side: -1, offset: 7.5, scale: 2 },
    { kind: 'rock_beach', at: c.at('headland', 10), side: -1, offset: 8, scale: 2.6 },
    { kind: 'boat', at: c.at('boardwalk', 30), side: -1, offset: 18, yaw: 70 },
    { kind: 'boat', at: c.at('pier', 50), side: -1, offset: 24, yaw: -40, scale: 1.3 },
    { kind: 'umbrella', at: c.at('row1', 5), side: -1, offset: 4 },
    { kind: 'beach_hut', at: c.at('boardwalk', 45), side: 1, offset: 5, yaw: 10 },
    { kind: 'beach_hut', at: c.at('boardwalk', 120), side: 1, offset: 6, yaw: -8 },
    { kind: 'lamp_post', at: c.at('pier', 10), side: -1, offset: 2 },
    { kind: 'lamp_post', at: c.at('pier', 55), side: -1, offset: 2 },
    { kind: 'palm_b', at: c.at('crest', 30), side: 1, offset: 4, scale: 1.3 },
    { kind: 'palm_a', at: c.at('cliffroad', 55), side: 1, offset: 4, scale: 1.2 },
    { kind: 'umbrella', at: c.at('cove', 40), side: 1, offset: 4 },
    { kind: 'umbrella', at: c.at('cove', 70), side: 1, offset: 4 },
    { kind: 'beach_hut', at: c.at('cove', 60), side: -1, offset: 7, yaw: 5 },
    { kind: 'palm_a', at: c.at('palms', 20), side: -1, offset: 4, scale: 1.3 },
    { kind: 'palm_b', at: c.at('palms', 40), side: 1, offset: 3, scale: 1.2 },
    { kind: 'palm_a', at: c.at('t4', 31), side: 1, offset: 4.5, scale: 1.3 },
    { kind: 'lifeguard_tower', at: c.at('final', 40), side: -1, offset: 9 },
  ],
};
