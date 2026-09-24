import type { TrackDef } from '../sim/types';
import { course } from './course';

/** Night-city figure eight: the skyway loop (hairpin, viaduct chicane) runs 9 m up and crosses over
 * downtown; the off-ramp dives into tight 90° blocks and a boulevard split by a median (pad lane or
 * kicker ramp), and the street passes under the bridge before the on-ramp climbs back to the grid. */
const c = course([
  { go: 55, w: 15, runoffL: 3, runoffR: 3, y: 9, mark: 'start' },
  { turn: 90, r: 24, bank: -6, mark: 't1' },
  { go: 50, w: 14, mark: 'skyway' },
  { turn: -20, r: 60, mark: 'kink' },
  { turn: 20, r: 60 },
  { go: 58 },
  { turn: 180, r: 22, bank: -7, w: 16, mark: 'hairpin' },
  { go: 38, w: 14, mark: 'skyway2' },
  { turn: -90, r: 22, bank: 6, mark: 't3' },
  { go: 10, mark: 'viaduct' },
  { turn: 45, r: 30 },
  { turn: -90, r: 28, bank: 5 },
  { turn: 45, r: 30 },
  { go: 60, mark: 'overpass' },
  { go: 15, y: 8.5, mark: 'offramp' },
  { go: 50, y: 0.5 },
  { go: 15, y: 0 },
  { turn: -90, r: 22, bank: 5, mark: 'neon' },
  { go: 90, w: 17, mark: 'boulevard' },
  { turn: -90, r: 24, w: 15, mark: 'corner' },
  { go: 40, w: 14, mark: 'blocks' },
  { turn: -90, r: 20 },
  { go: 20 },
  { turn: 90, r: 20 },
  { go: 20 },
  { turn: -90, r: 22, mark: 'avenue' },
  { fit: true, w: 15, mark: 'street' },
  { go: 15, y: 0.5, mark: 'onramp' },
  { go: 50, y: 8.5 },
  { go: 15, y: 9 },
  { turn: 90, r: 24, bank: -6, mark: 't4' },
  { fit: true, mark: 'final' },
]);

export const neonDrive: TrackDef = {
  id: 'neon-drive', name: 'Neon Drive', theme: 'city', tagline: 'Tight corners under city lights.',
  points: c.points,
  boostPads: [
    { at: c.at('kink', 30), lat: -4 },                         // skyway kink: pad on the inside
    { at: c.at('boulevard', 44), lat: 4.5 },                   // boulevard: pad lane on the right of the median...
    { at: c.at('overpass', 4), lat: 4 },                       // viaduct exit: pad on the outside, over the crossing
  ],
  ramps: [{ at: c.at('boulevard', 42), lat: -4.5, width: 6 }], // ...or the kicker ramp on the left
  itemRows: [{ at: c.at('skyway', 25) }, { at: c.at('overpass', 40) }, { at: c.at('boulevard', 78) }, { at: c.at('street', 20) }],
  gaps: [], zones: [],
  obstacles: [
    { at: c.at('boulevard', 36), lat: 0, radius: 1, kind: 'tire_stack' },
    { at: c.at('boulevard', 46), lat: 0, radius: 1, kind: 'tire_stack' },
    { at: c.at('boulevard', 56), lat: 0, radius: 1, kind: 'tire_stack' },
  ],
  landmarks: [
    { kind: 'building_c', at: c.at('start', 20), side: 1, offset: 9, scale: 1.2 },
    { kind: 'billboard', at: c.at('final', 20), side: -1, offset: 7, yaw: 25 },
    { kind: 'neon_sign', at: c.at('t1', 19), side: 1, offset: 4.5 },
    { kind: 'building_a', at: c.at('skyway', 20), side: 1, offset: 10, scale: 1.1 },
    { kind: 'building_b', at: c.at('kink', 50), side: 1, offset: 9 },
    { kind: 'building_c', at: c.at('skyway', 120), side: 1, offset: 9, scale: 1.3 },
    { kind: 'billboard', at: c.at('hairpin', 35), side: -1, offset: 11 },
    { kind: 'neon_sign', at: c.at('t3', 17), side: -1, offset: 4.5 },
    { kind: 'building_a', at: c.at('viaduct', 40), side: 1, offset: 10 },
    { kind: 'building_b', at: c.at('viaduct', 60), side: -1, offset: 9, scale: 1.2 },
    { kind: 'neon_sign', at: c.at('neon', 17), side: -1, offset: 5, scale: 1.2 },
    { kind: 'parked_car', at: c.at('boulevard', 50), side: -1, offset: 4, yaw: 90 },
    { kind: 'parked_car', at: c.at('boulevard', 58), side: -1, offset: 4, yaw: 90 },
    { kind: 'building_c', at: c.at('boulevard', 70), side: -1, offset: 9, scale: 1.1 },
    { kind: 'building_b', at: c.at('corner', 19), side: -1, offset: 10, scale: 1.3 },
    { kind: 'neon_sign', at: c.at('blocks', 20), side: 1, offset: 4.5 },
    { kind: 'building_a', at: c.at('avenue', 17), side: -1, offset: 10 },
    { kind: 'billboard', at: c.at('street', 30), side: -1, offset: 7, yaw: -20 },
    { kind: 'parked_car', at: c.at('onramp', 5), side: 1, offset: 4, yaw: 90 },
  ],
};
