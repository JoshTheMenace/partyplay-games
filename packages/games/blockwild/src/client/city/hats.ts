/**
 * The hats of Caper City (shared/city/economy.ts `HATS`): boxes on a player's head, in the units the rig's attachments
 * use. Each is drawn here for a head two units wide and two tall, then scaled to the city figure's head.
 */
import type { Piece } from '../game/models';

/** [x0, y0, z0, x1, y1, z1, colour] with the head spanning −1..1 across and 0..2 up (the face looks down −z). */
type Box = readonly [number, number, number, number, number, number, number];
const HEAD = 4.75;
const hat = (boxes: readonly Box[]): Piece[] => boxes.map(([x0, y0, z0, x1, y1, z1, color]) => ({ pivot: 'head', box: [x0 * HEAD, y0 * HEAD, z0 * HEAD, x1 * HEAD, y1 * HEAD, z1 * HEAD], color }));
const BLACK = 0x23232a, WHITE = 0xf7f7f2, GOLD = 0xe6b93a;
export const HAT_PIECES: readonly Piece[][] = [
  [],
  /* top hat */ hat([[-1.35, 1.98, -1.35, 1.35, 2.16, 1.35, BLACK], [-0.92, 2.16, -0.92, 0.92, 3.5, 0.92, BLACK], [-0.95, 2.16, -0.95, 0.95, 2.46, 0.95, 0xd8403a]]),
  /* toque */ hat([[-0.98, 1.9, -0.98, 0.98, 2.5, 0.98, WHITE], [-1.2, 2.5, -1.2, 1.2, 3.4, 1.2, WHITE], [-1.0, 3.4, -1.0, 1.0, 3.6, 1.0, 0xe9e6da]]),
  /* party cone */ hat([[-0.7, 1.98, -0.7, 0.7, 2.5, 0.7, 0xe07ab0], [-0.5, 2.5, -0.5, 0.5, 3.05, 0.5, 0xf2c23e], [-0.3, 3.05, -0.3, 0.3, 3.6, 0.3, 0x3aa8dc], [-0.22, 3.6, -0.22, 0.22, 3.95, 0.22, WHITE]]),
  /* propeller beanie */ hat([[-1.04, 1.7, -1.04, 1.04, 2.2, 1.04, 0x3a7fd0], [-0.72, 2.2, -0.72, 0.72, 2.5, 0.72, 0xf2c23e], [-0.08, 2.5, -0.08, 0.08, 2.9, 0.08, BLACK], [-0.95, 2.9, -0.16, 0.95, 2.98, 0.16, 0xd8403a]]),
  /* wide brim */ hat([[-1.7, 1.98, -1.7, 1.7, 2.12, 1.7, 0xd9c27a], [-0.95, 2.12, -0.95, 0.95, 2.75, 0.95, 0xd9c27a], [-0.98, 2.12, -0.98, 0.98, 2.32, 0.98, 0x8a5a3a]]),
  /* hard hat */ hat([[-1.08, 1.8, -1.08, 1.08, 2.55, 1.08, 0xf2c23e], [-1.08, 1.8, -1.5, 1.08, 1.96, -1.08, 0xf2c23e], [-0.2, 2.55, -0.95, 0.2, 2.72, 0.95, 0xd9b24a]]),
  /* bobble hat */ hat([[-1.06, 1.6, -1.06, 1.06, 2.5, 1.06, 0x4f9d58], [-1.1, 1.6, -1.1, 1.1, 1.9, 1.1, WHITE], [-0.34, 2.5, -0.34, 0.34, 3.1, 0.34, WHITE]]),
  /* tricorn */ hat([[-1.45, 1.98, -1.45, 1.45, 2.14, 1.45, 0x2b2f3a], [-0.9, 2.14, -0.9, 0.9, 2.7, 0.9, 0x2b2f3a], [-1.45, 2.14, -1.45, 1.45, 2.55, -1.25, 0x2b2f3a], [-1.45, 2.14, -1.45, -1.25, 2.55, 1.45, 0x2b2f3a],
    [1.25, 2.14, -1.45, 1.45, 2.55, 1.45, 0x2b2f3a], [-0.2, 2.2, -1.5, 0.2, 2.5, -1.44, GOLD]]),
  /* golden crown */ hat([[-1.04, 1.9, -1.04, 1.04, 2.35, 1.04, GOLD], [-1.04, 2.35, -1.04, -0.6, 2.8, -0.6, GOLD], [0.6, 2.35, -1.04, 1.04, 2.8, -0.6, GOLD], [-1.04, 2.35, 0.6, -0.6, 2.8, 1.04, GOLD], [0.6, 2.35, 0.6, 1.04, 2.8, 1.04, GOLD],
    [-0.22, 2.35, -1.04, 0.22, 2.9, -0.6, GOLD], [-0.16, 2.02, -1.08, 0.16, 2.26, -1.02, 0xd8403a]]),
];
