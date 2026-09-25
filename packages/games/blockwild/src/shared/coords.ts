import { CHUNK, CHUNKS, HEIGHT, WORLD } from './constants';

export type Vec3 = [number, number, number];

/** Global linear cell index used by edits and saves: x + WORLD * (z + WORLD * y). Always < 2^31. */
export const cellIndex = (x: number, y: number, z: number) => x + WORLD * (z + WORLD * y);
export function cellXYZ(index: number): Vec3 {
  const x = index % WORLD, rest = (index - x) / WORLD, z = rest % WORLD;
  return [x, (rest - z) / WORLD, z];
}
export const isCellIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < WORLD * WORLD * HEIGHT;
export const inWorld = (x: number, y: number, z: number) => x >= 0 && x < WORLD && z >= 0 && z < WORLD && y >= 0 && y < HEIGHT;
export const inBounds = (x: number, z: number) => x >= 0 && x < WORLD && z >= 0 && z < WORLD;

/** Index inside a column chunk: lx + 16 * (lz + 16 * y). */
export const localIndex = (lx: number, y: number, lz: number) => lx + CHUNK * (lz + CHUNK * y);
export const chunkCoord = (v: number) => Math.floor(v / CHUNK);
/** Numeric chunk key (unique for chunks inside the world). */
export const chunkKey = (cx: number, cz: number) => cx + cz * CHUNKS;
export const chunkFromKey = (key: number): [number, number] => [key % CHUNKS, Math.floor(key / CHUNKS)];

/** Faces 0..5 = -X, +X, -Y, +Y, -Z, +Z. The opposite face is `face ^ 1`. */
export const FACES: readonly Readonly<Vec3>[] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
export const FACE_NAMES = ['west', 'east', 'down', 'up', 'north', 'south'] as const;
export const oppositeFace = (face: number) => face ^ 1;

/** Horizontal facings 0..3 = N (-Z), E (+X), S (+Z), W (-X) as [dx, dz]. */
export const FACING: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** Face index (0..5) that points in a horizontal facing. */
export const FACING_FACE = [4, 1, 5, 0] as const;
/** Horizontal facing for a side face (0,1,4,5); -1 for up/down. */
export const faceToFacing = (face: number) => [3, 1, -1, -1, 0, 2][face] ?? -1;

/**
 * Camera convention shared by physics, raycast and rendering (three.js Euler 'YXZ'):
 * yaw 0 looks north (-Z), positive yaw turns left (towards west); pitch > 0 looks up.
 */
export const lookVector = (yaw: number, pitch: number): Vec3 => {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
};
/** Horizontal facing (0..3) the player looks towards. */
export const facingFromYaw = (yaw: number) => ((Math.round(-yaw / (Math.PI / 2)) % 4) + 4) % 4;
/** Wrap an angle into [-PI, PI). */
export const wrapAngle = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
