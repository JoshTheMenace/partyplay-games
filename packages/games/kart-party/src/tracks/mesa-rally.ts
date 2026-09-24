import type { TrackDef } from '../sim/types';
import { course } from './course';

/** Desert canyon rally (anticlockwise): a rim road climbing above the drop, a hairpin round the butte,
 * a crest on the mesa top, a narrow canyon dive, the full-width ramp jump across the chasm, a rocky wash
 * with a tucked-away pad, and a banked climbing hairpin onto the long finish straight. */
const c = course([
  { go: 70, w: 17, runoffL: 6, runoffR: 6, y: 10, mark: 'start' },
  { turn: 90, r: 38, bank: -6, y: 11, mark: 't1' },
  { go: 20, w: 16, y: 11.6, mark: 'rim' },
  { fit: true, runoffR: 3, edgeR: 'drop', y: 13 },
  { turn: -30, r: 70, y: 16 },
  { turn: 60, r: 55, bank: -5, y: 20, mark: 'rim2' },
  { turn: -30, r: 70, y: 23 },
  { go: 50, y: 25 },
  { turn: 180, r: 24, bank: -8, w: 15, runoffR: 5, edgeR: 'wall', mark: 'butte' },
  { go: 70, w: 18, runoffL: 5, y: 26, mark: 'mesa' },
  { go: 4, mark: 'crest' },
  { go: 9, y: 27.4 },
  { go: 9, y: 26.2 },
  { go: 6, y: 25.3 },
  { turn: -90, r: 34, bank: 5, w: 15, y: 22, mark: 'dropin' },
  { turn: 60, r: 26, w: 14, runoffL: 3, runoffR: 3, y: 19.3, mark: 'canyon' },
  { turn: -120, r: 24, bank: 6, y: 15 },
  { turn: 60, r: 26, y: 13 },
  { turn: 90, r: 38, bank: -6, y: 11, mark: 'exit' },
  { go: 12, y: 10.7, mark: 'ledge' },
  { go: 28, runoffL: 2, runoffR: 2, edgeL: 'drop', edgeR: 'drop', y: 10 },
  { go: 18, y: 7.5, mark: 'chasm' },
  { go: 45, y: 6, mark: 'landing' },
  { turn: -30, r: 70, w: 19, runoffL: 6, runoffR: 6, edgeL: 'wall', edgeR: 'wall', y: 5.5, mark: 'wash' },
  { go: 30, y: 6.5, mark: 'rocks' },
  { turn: 120, r: 28, bank: -8, w: 17, y: 10, mark: 'climb' },
  { fit: true, mark: 'grid' },
]);

export const mesaRally: TrackDef = {
  id: 'mesa-rally', name: 'Mesa Rally', theme: 'desert', tagline: 'Big air over the red canyon.',
  points: c.points,
  boostPads: [
    { at: c.at('rim', 60), lat: 4.5 },                         // rim straight: pad lane on the cliff side
    { at: c.at('ledge', 18), lat: 0, width: 6 },               // launch pad for the chasm jump
    { at: c.at('rocks', 6), lat: -5.5 },                        // wash: tucked in behind a boulder
  ],
  ramps: [{ at: c.at('ledge', 30.5), lat: 0, width: 14, height: 2 }],
  itemRows: [{ at: c.at('rim', 25) }, { at: c.at('mesa', 12) }, { at: c.at('canyon', 18) }, { at: c.at('landing', 30) }],
  gaps: [{ from: c.at('ledge', 40), to: c.at('chasm', 16.5) }],
  zones: [],
  obstacles: [
    { at: c.at('wash', 14), lat: -6, radius: 1.8, kind: 'rock_red_a' },
    { at: c.at('wash', 30), lat: -4, radius: 1.6, kind: 'rock_red_b' },
    { at: c.at('rocks', 22), lat: 4, radius: 1.5, kind: 'rock_red_b' },
  ],
  landmarks: [
    { kind: 'water_tower', at: c.at('start', 30), side: 1, offset: 9 },
    { kind: 'windmill', at: c.at('grid', 20), side: 1, offset: 12 },
    { kind: 'cactus_a', at: c.at('start', 55), side: -1, offset: 3 },
    { kind: 'mesa', at: c.at('rim', 40), side: -1, offset: 45, scale: 1.6 },
    { kind: 'cactus_b', at: c.at('t1', 20), side: 1, offset: 4 },
    { kind: 'cactus_a', at: c.at('rim', 90), side: -1, offset: 3.5, scale: 1.2 },
    { kind: 'rock_red_a', at: c.at('rim2', 30), side: -1, offset: 6, scale: 1.4 },
    { kind: 'rock_red_b', at: c.at('butte', 37), side: -1, offset: 11, scale: 1.5 },
    { kind: 'cactus_b', at: c.at('mesa', 40), side: -1, offset: 3.5 },
    { kind: 'windmill', at: c.at('mesa', 60), side: 1, offset: 9 },
    { kind: 'rock_red_a', at: c.at('dropin', 30), side: 1, offset: 10, scale: 1.6 },
    { kind: 'rock_red_b', at: c.at('canyon', 40), side: 1, offset: 9, scale: 1.4 },
    { kind: 'rock_red_a', at: c.at('canyon', 75), side: -1, offset: 7.5, scale: 1.5 },
    { kind: 'rock_red_b', at: c.at('canyon', 115), side: 1, offset: 9, scale: 1.3 },
    { kind: 'cactus_a', at: c.at('wash', 30), side: 1, offset: 4 },
    { kind: 'cactus_b', at: c.at('climb', 30), side: -1, offset: 9, scale: 1.2 },
    { kind: 'mesa', at: c.at('rocks', 15), side: 1, offset: 36, scale: 1.3 },
  ],
};
