import type { TrackDef } from '../sim/types';
import { course } from './course';

/** The grand finale (clockwise): a starlit launch straight past the ringed planet, a hairpin that drops into the Comet
 * Corkscrew (1¼ banked turns spiralling down under the start straight), the low-gravity Moon Hop (floating crest, spring
 * pads, rings on the air lines), the walled Pinball Nebula (sliding star bumpers round a central asteroid), the Hyperspace
 * Gap (ramp over the void onto a lower ribbon, ring in the flight path), the Warp Stretch (centre boost lane between open
 * drops, rings over the line) and the banked Aurora Esses climbing back up to the start. */
const c = course([
  { go: 100, w: 18, runoffL: 2, runoffR: 2, edgeL: 'wall', edgeR: 'wall', y: 32, mark: 'start' },   // railed: falling off a plain straight is no fun
  { turn: -180, r: 24, bank: 9, w: 16, edgeL: 'wall', edgeR: 'wall', y: 31, mark: 'hairpin' },
  { go: 40, w: 15, y: 27, mark: 'dive' },
  { turn: -450, r: 30, bank: 10, w: 16, y: 12, mark: 'corkscrew' },
  { go: 30, w: 18, runoffL: 3, runoffR: 3, edgeL: 'drop', edgeR: 'drop', y: 11, mark: 'exit' },
  { go: 10, w: 20, runoffL: 4, runoffR: 4, mark: 'moon' },
  { go: 12, y: 12.2, mark: 'crest' },
  { go: 12, y: 11 },
  { go: 75 },
  { go: 104, mark: 'springs' },
  { turn: 90, r: 40, bank: -8, runoffL: 2, runoffR: 2, edgeL: 'wall', edgeR: 'wall', mark: 'nebula-in' },
  { go: 125, mark: 'nebula' },
  { go: 30, w: 16, edgeL: 'drop', edgeR: 'drop', mark: 'launchpad' },
  { go: 16, y: 7.6, mark: 'gap' },
  { go: 80, w: 15, runoffL: 3, runoffR: 3, edgeL: 'wall', edgeR: 'wall', y: 6, mark: 'lower' },
  { turn: 90, r: 30, bank: -8, runoffL: 2, runoffR: 2, mark: 'warp-in' },
  { fit: true, w: 14, runoffL: 3.5, runoffR: 3.5, edgeL: 'drop', edgeR: 'drop', y: 8, mark: 'warp' },
  { go: 18, w: 12, runoffL: 1, runoffR: 1, edgeL: 'wall', edgeR: 'wall', mark: 'loop-in' },  // guard rails funnel the Warp into the loop lane
  { go: 40, mark: 'loop' },                                  // the loop's footprint: the ribbon rises into the loop-the-loop here
  { go: 22, mark: 'loop-out' },
  { turn: 90, r: 40, bank: -8, w: 16, runoffL: 2, runoffR: 2, edgeL: 'wall', edgeR: 'wall', y: 12, mark: 'aurora' },
  { turn: -50, r: 50, bank: 7, y: 16.5, mark: 'esses' },
  { turn: 100, r: 40, bank: -9, y: 23, mark: 'esses2' },
  { turn: -50, r: 50, bank: 7, y: 28, mark: 'esses3' },
  { fit: true, w: 17, edgeL: 'wall', edgeR: 'wall', y: 34, mark: 'final' },
  { go: 50, w: 18, mark: 'grid' },
]);

export const rainbowRoad: TrackDef = {
  id: 'rainbow-road', name: 'Rainbow Road', theme: 'space', tagline: 'Ride the rainbow among the stars.',
  points: c.points,
  boostPads: [
    { at: c.at('exit', 12), lat: -4.5 },                       // corkscrew exit: pad on the inside line
    { at: c.at('launchpad', 6), lat: 0, width: 6 },            // run-up to the Hyperspace Gap
    { at: c.at('final', 6), lat: 4.5 },                        // Aurora exit pad: a clean line out of the esses boosts up the final climb
  ],
  ramps: [{ at: c.at('launchpad', 20), lat: 0, width: 16, height: 2 }],
  itemRows: [{ at: c.at('start', 60) }, { at: c.at('crest', 50) }, { at: c.at('nebula', 5) }, { at: c.at('lower', 32) }],
  gaps: [{ from: c.at('launchpad', 30), to: c.at('gap', 16) }],
  zones: [{ from: c.at('warp', 10), to: c.at('warp', 60), latMin: -1.75, latMax: 1.75, surface: 'boost' }],
  obstacles: [{ at: c.at('nebula', 50), lat: 0, radius: 2.6, kind: 'asteroid_a' }],
  loops: [{ at: c.at('loop'), length: 40, radius: 13, tilt: 32 }],   // end of the Warp Stretch: 12 m lane, so the halves pass ≥ 1 m apart
  landmarks: [
    { kind: 'planet_ringed', at: c.at('start', 55), side: 1, offset: 135 },
    { kind: 'star_crystal', at: c.at('grid', 20), side: -1, offset: 14, scale: 1.4 },
    { kind: 'satellite', at: c.at('corkscrew', 0), side: 1, offset: 20 },            // hangs in the corkscrew's core
    { kind: 'asteroid_b', at: c.at('moon', 30), side: -1, offset: 16, scale: 1.3 },
    { kind: 'asteroid_a', at: c.at('springs', 50), side: 1, offset: 20, scale: 1.2 },
    { kind: 'star_crystal', at: c.at('nebula', 30), side: -1, offset: 8, scale: 1.2 },
    { kind: 'star_crystal', at: c.at('nebula', 90), side: 1, offset: 8, scale: 1.2 },
    { kind: 'asteroid_b', at: c.at('gap', 5), side: 1, offset: 22 },
    { kind: 'space_station', at: c.at('warp', 60), side: 1, offset: 70 },
    { kind: 'satellite', at: c.at('esses2', 30), side: 1, offset: 16, scale: 1.2 },
    { kind: 'asteroid_a', at: c.at('final', 40), side: 1, offset: 24, scale: 1.5 },
  ],
  springs: [
    { at: c.at('springs', 0), lat: -5, power: 12 },
    { at: c.at('springs', 0), lat: 5, power: 12 },
  ],
  rings: [
    { at: c.at('springs', 32), lat: -5, height: 6.2 },         // apex of each spring arc
    { at: c.at('springs', 32), lat: 7, height: 6.2 },          // ...the right one wants a nudge in the air
    { at: c.at('crest', 20), lat: -2, height: 3.5 },            // over the floating crest's air line
    { at: c.at('launchpad', 42), lat: 0, height: 6.9, radius: 4 },  // Hyperspace Gap flight path
    { at: c.at('warp', 72), lat: -2.5, height: 3.5 },           // Warp Stretch: rings over the racing line
    { at: c.at('warp', 94), lat: -2, height: 3.5 },
  ],
  gravity: [{ from: c.at('moon', 0), to: c.at('springs', 70), scale: .45 }],
  movers: [
    { at: c.at('nebula', 20), lat: 0, amp: 6.5, period: 2.8, radius: 1.6, kind: 'star_bumper' },
    { at: c.at('nebula', 78), lat: -4.5, amp: 3.5, period: 2.4, radius: 1.6, kind: 'star_bumper' },
    { at: c.at('nebula', 78), lat: 4.5, amp: 3.5, period: 2.4, radius: 1.6, kind: 'star_bumper' },
    { at: c.at('nebula', 100), lat: 0, amp: 6.5, period: 2.8, phase: .5, radius: 1.6, kind: 'star_bumper' },
  ],
};
