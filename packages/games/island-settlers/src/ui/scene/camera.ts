/**
 * Fixed orthographic camera (EXPERIENCE §2): looks north, tilted 32° from straight down, fitted to
 * the land inside the board window from layout constants. Pure math, so tests and the bridge share it.
 * Think of it as a picture frame: the board window is the frame, and the land is scaled to fill it.
 */
import { SQRT3 } from '../../geometry';
import type { Board, Terrain } from '../../model';
import type { ScreenPoint } from '../shared/bridge';
import { regions, toPx, type Rect } from '../shared/layout';
import { TILT } from './constants';

export type Stage = { width: number; height: number };
/** Frustum in camera-plane units, plus stage px per wu (`scale`). */
export type Fit = { left: number; right: number; top: number; bottom: number; scale: number; window: Rect };

const MARGIN = 0.9, PIECE_HEIGHT = 0.6;
const COS = Math.cos(TILT), SIN = Math.sin(TILT);
export const WATER: ReadonlySet<Terrain> = new Set<Terrain>(['sea', 'shoal']);

/** Land (fog included) extents in world units: tile centres plus the hex half-extents. */
export function landBox(board: Board) {
  const land = board.tiles.filter(t => !WATER.has(t.terrain));
  const tiles = land.length ? land : board.tiles;
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  return {
    minX: Math.min(...xs) - SQRT3 / 2, maxX: Math.max(...xs) + SQRT3 / 2,
    minY: Math.min(...ys) - 1, maxY: Math.max(...ys) + 1,
  };
}

/** Camera-plane coordinates of a scene point (x east, y up, z south). */
const plane = (x: number, y: number, z: number) => ({ sx: x, sy: y * SIN - z * COS });

export function fitCamera(board: Board, stage: Stage, host: boolean): Fit {
  const box = landBox(board), window = toPx(regions(stage, host).board!, stage);
  const x0 = box.minX - MARGIN, x1 = box.maxX + MARGIN;
  const y0 = plane(0, 0, box.maxY + MARGIN).sy, y1 = plane(0, PIECE_HEIGHT, box.minY - MARGIN).sy;
  const scale = Math.max(1e-3, Math.min(window.width / (x1 - x0), window.height / (y1 - y0)));
  const left = (x0 + x1) / 2 - (window.left + window.width / 2) / scale;
  const top = (y0 + y1) / 2 + (window.top + window.height / 2) / scale;
  return { left, right: left + stage.width / scale, top, bottom: top - stage.height / scale, scale, window };
}

/** Scene point → stage px. */
export function project(fit: Fit, x: number, y: number, z: number): ScreenPoint {
  const { sx, sy } = plane(x, y, z);
  return { x: (sx - fit.left) * fit.scale, y: (fit.top - sy) * fit.scale };
}

/** Stage px → the scene point on the horizontal plane at height y. */
export function unproject(fit: Fit, px: number, py: number, y: number) {
  const sx = fit.left + px / fit.scale, sy = fit.top - py / fit.scale;
  return { x: sx, z: (y * SIN - sy) / COS };
}

/** Camera position direction: south and up, so lookAt(origin) gives the tilted view. */
export const CAMERA_DIR = { x: 0, y: COS, z: SIN };
