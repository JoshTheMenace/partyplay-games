/* Allocation-free light cones (guard flashlights, security cameras) clipped by walls and smoke. Normal alpha
 * blending with per-vertex alpha: overlapping cones deepen the tint but never add up to white. */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, type Material } from 'three';
import { castRay, type Grid } from '../geometry';
import type { Smoke } from '../model';

export const CONE_RAYS = 44;
const VERTS = CONE_RAYS * 9 + 12, RIM = .05;
/** Distance to the nearest active smoke cloud along a unit ray, or Infinity (mirrors geometry.ts). */
export function smokeDistance(smoke: readonly Smoke[], now: number, ox: number, oy: number, dx: number, dy: number) {
  let best = Infinity;
  for (const s of smoke) {
    if (s.until <= now) continue;
    const fx = ox - s.x, fy = oy - s.y, b = fx * dx + fy * dy, c = fx * fx + fy * fy - s.radius * s.radius;
    if (c <= 0) return 0;
    const disc = b * b - c;
    if (disc >= 0 && -b - Math.sqrt(disc) > 0) best = Math.min(best, -b - Math.sqrt(disc));
  }
  return best;
}

export const coneMaterial = () => new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide });
export function coneMesh(material: Material) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(VERTS * 3), 3)); g.setAttribute('color', new BufferAttribute(new Float32Array(VERTS * 4), 4));
  const mesh = new Mesh(g, material); mesh.frustumCulled = false; mesh.renderOrder = 2;
  return mesh;
}

/** Fan from (ox, oy) between angles a0..a1: a soft fill (alpha `fill` at the origin, a fifth of it at full range)
 * inside a crisp RIM-wide outline of alpha `edge`. */
export function fillCone(mesh: Mesh, grid: Grid, smoke: readonly Smoke[], now: number, ox: number, oy: number, a0: number, a1: number, range: number, colour: Color, y: number, fill: number, edge: number) {
  const pos = mesh.geometry.attributes.position as BufferAttribute, col = mesh.geometry.attributes.color as BufferAttribute, p = pos.array as Float32Array, c = col.array as Float32Array;
  let n = 0, pd = 0, pdx = 0, pdy = 0, d0 = 0;
  const put = (d: number, dx: number, dy: number, a: number) => { p[n * 3] = ox + dx * d; p[n * 3 + 1] = y; p[n * 3 + 2] = oy + dy * d; c[n * 4] = colour.r; c[n * 4 + 1] = colour.g; c[n * 4 + 2] = colour.b; c[n * 4 + 3] = a; n++; };
  const soft = (d: number) => fill * (1 - d / range * .8);
  for (let i = 0; i <= CONE_RAYS; i++) {
    const a = a0 + (a1 - a0) * i / CONE_RAYS, dx = Math.cos(a), dy = Math.sin(a), d = Math.min(castRay(grid, ox, oy, dx, dy, range), smokeDistance(smoke, now, ox, oy, dx, dy));
    if (i > 0) {
      put(0, dx, dy, fill); put(d, dx, dy, soft(d)); put(pd, pdx, pdy, soft(pd));
      const di = Math.max(0, d - RIM), pi = Math.max(0, pd - RIM);
      put(d, dx, dy, edge); put(pd, pdx, pdy, edge); put(pi, pdx, pdy, edge); put(d, dx, dy, edge); put(pi, pdx, pdy, edge); put(di, dx, dy, edge);
    } else d0 = d;
    pd = d; pdx = dx; pdy = dy;
  }
  // Straight sides: thin quads from the origin along the first and last rays, offset toward the inside.
  const side = (a: number, d: number, s: number) => {
    const dx = Math.cos(a), dy = Math.sin(a), nx = -dy * s * RIM, ny = dx * s * RIM, ex = dx * d, ey = dy * d;
    put(0, 0, 0, edge); put(1, ex, ey, edge); put(1, ex + nx, ey + ny, edge); put(0, 0, 0, edge); put(1, ex + nx, ey + ny, edge); put(1, nx, ny, edge);
  };
  side(a0, d0, 1); side(a1, pd, -1);
  mesh.geometry.setDrawRange(0, n); pos.needsUpdate = true; col.needsUpdate = true;
}
