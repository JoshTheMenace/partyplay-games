/**
 * Custom platform and hazard art shared by stage modules. Platform pieces keep their walkable top exactly at
 * local y = 0 across ±width/2 (a slab), and hang decoration below or behind it.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, SphereGeometry, TorusGeometry, type BufferGeometry, type Material } from 'three';
import { at, gradient, merge, paint, rng, slabGeometry, type Kit } from '../kit';
import { puff } from '../decor';

const group = (...children: Mesh[]) => { const g = new Group(); g.add(...children); return g; };
export const slab = (width: number, material: Material, thickness = .3, taper = .22) => new Mesh(slabGeometry(width, { thickness, taper }), material);
/** Squeeze decoration hanging from a platform inside its ends and just below its line. */
export function under(g: BufferGeometry, width: number) {
  g.computeBoundingBox(); const b = g.boundingBox!, s = Math.min(1, (width - .04) / (b.max.x - b.min.x));
  return g.translate(-(b.min.x + b.max.x) / 2, 0, 0).scale(s, 1, 1).translate(0, Math.min(0, -.03 - b.max.y), 0);
}

/** A cloud you can stand on: a flat top with lumps hanging below. */
export function cloudPiece(k: Kit, width: number, material: Material, seed = 1) {
  const lumps = under(at(puff(seed, width * .8, .8, '#ffffff', '#c8d8f0', 5, k.low ? 0 : 1), 0, -.95, 0, 0, 1, .9, 1.2), width);
  return group(slab(width, material, .28, .1), new Mesh(k.own(lumps), k.lit()));
}
/** DK's barrel under a plank top. */
export function barrelPiece(k: Kit, width: number, material: Material) {
  const r = Math.min(.75, width / 2), parts: BufferGeometry[] = [gradient(at(new CylinderGeometry(r, r, 1.5, 16), 0, -r - .1, 0, 0, 1, 1, 1, Math.PI / 2), '#b86a32', '#6a3418', -2 * r, 0)];
  for (const z of [-.55, .55]) parts.push(paint(at(new TorusGeometry(r, .06, 5, 20), 0, -r - .1, z), '#3a3a44'));
  parts.push(paint(at(new BoxGeometry(.5, .35, .05), 0, -r - .1, .78), '#ffcf4a'));
  return group(slab(width, material, .18, .05), new Mesh(k.own(merge(parts)), k.lit()));
}
/** A rainbow band: seven stacked color strips, top strip flush with y = 0. */
export function rainbowPiece(k: Kit, width: number) {
  const colors = ['#ff5a5a', '#ff9f43', '#ffe45c', '#6ee06a', '#4fc3ff', '#6a7bff', '#b36bff'], t = .07;
  return group(new Mesh(k.own(merge(colors.map((c, i) => paint(at(new BoxGeometry(width - i * .06, t, 1.6), 0, -t / 2 - i * t, -.1), c)))), k.lit()));
}
/** An Arwing seen from the side under a thin standing slab. */
export function arwing(k: Kit, width: number, material?: Material) {
  const parts: BufferGeometry[] = [gradient(at(new ConeGeometry(.35, width * .9, 8), 0, -.35, 0, Math.PI / 2), '#f0f4ff', '#8a9ab8', -.7, 0)];
  parts.push(paint(at(new BoxGeometry(width * .45, .06, 2.4), -width * .08, -.4, 0, .05), '#e8eef8'), paint(at(new BoxGeometry(.5, .5, .06), -width * .3, -.52, .9, .5), '#3a6ae8'), paint(at(new BoxGeometry(.5, .5, .06), -width * .3, -.52, -.9, .5), '#3a6ae8'));
  parts.push(paint(at(new SphereGeometry(.22, 10, 8), width * .05, -.18, 0, 0, 1.6, .7, 1), '#5ad8ff'), paint(at(new ConeGeometry(.15, .5, 8), -width * .47, -.35, -1.3, Math.PI / 2), '#ff8a3a'));
  const g = group(new Mesh(k.own(merge(parts)), k.lit()));
  if (material) g.add(slab(width, material, .08, .02));
  return g;
}
/** Tingle's balloon: a red balloon whose top is the platform, with Tingle dangling below. */
export function balloonPiece(k: Kit, width: number, material: Material) {
  const r = width * .42, parts: BufferGeometry[] = [gradient(at(new SphereGeometry(r, 18, 12), 0, -r * .95, 0, 0, 1, .8, .8), '#ff5a5a', '#a02828', -r * 1.7, 0)];
  parts.push(paint(at(new CylinderGeometry(.015, .015, 1.2, 4), 0, -r * 1.7 - .6, 0), '#3a3a3a'), paint(at(new SphereGeometry(.28, 10, 8), 0, -r * 1.7 - 1.3, 0, 0, 1, 1.4, 1), '#4ab84a'), paint(at(new SphereGeometry(.16, 8, 6), 0, -r * 1.7 - .95, 0), '#ffd8a8'));
  return group(slab(width, material, .12, .04), new Mesh(k.own(merge(parts)), k.lit()));
}
/** Fourside's UFO: a chrome saucer with a glowing dome and rim lights; its top deck is the platform. */
export function ufoPiece(k: Kit, width: number, material: Material) {
  const parts: BufferGeometry[] = [gradient(at(new CylinderGeometry(width * .5, width * .18, .7, 28), 0, -.35, 0), '#e0e4f0', '#6a6a8a', -.7, 0),
    paint(at(new SphereGeometry(width * .18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, -.72, 0, 0, 1, -.8, 1), '#a4a2ff')];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; parts.push(paint(at(new SphereGeometry(.08, 6, 4), Math.cos(a) * width * .42, -.3, Math.sin(a) * width * .42), '#ffe890')); }
  return group(slab(width, material, .1, .02), new Mesh(k.own(merge(parts)), k.flat()));
}
/** A slab with posts and a back wall below it (huts, the Great Bay lab). */
export function housePiece(k: Kit, width: number, material: Material, height: number, wall: string, trim: string, roof?: string) {
  const parts: BufferGeometry[] = [gradient(at(new BoxGeometry(width * .92, height, .4), 0, -height / 2 - .2, -1.6), wall, trim, -height, 0)];
  for (const f of [-.45, .45]) parts.push(paint(at(new BoxGeometry(.18, height, .18), f * width, -height / 2, -.9), trim));
  for (let i = 0; i < 2; i++) parts.push(paint(at(new BoxGeometry(width * .18, height * .25, .05), (i - .5) * width * .45, -height * .5, -1.38), '#ffe8a0'));
  if (roof) parts.push(paint(at(new ConeGeometry(width * .62, 1.3, 4, 1), 0, -.68, -1.2, 0, 1, 1, .5, 0, Math.PI / 4), roof));
  return group(slab(width, material, .2, .05), new Mesh(k.own(merge(parts)), k.lit()));
}
/** A striped awning under its slab. */
export function awningPiece(k: Kit, width: number, a: string, b: string) {
  const n = Math.max(3, Math.round(width / .5)), parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) parts.push(paint(at(new BoxGeometry(width / n, .08, 1.5), -width / 2 + (i + .5) * width / n, -.04, -.1), i % 2 ? a : b));
  for (let i = 0; i < n; i++) parts.push(paint(at(new CylinderGeometry(width / n / 2, width / n / 2, .06, 8, 1, false, 0, Math.PI), -width / 2 + (i + .5) * width / n, -.12, .64, 0, 1, 1, 1, Math.PI / 2), i % 2 ? a : b));
  return group(new Mesh(k.own(merge(parts)), k.lit()));
}
/** A crane arm: a yellow lattice beam you stand on, with a cable rising out of frame. */
export function cranePiece(k: Kit, width: number, material: Material) {
  const parts: BufferGeometry[] = [paint(at(new CylinderGeometry(.03, .03, 30, 4), 0, 15, -1), '#2a2a3a')];
  for (let i = 0; i < 8; i++) parts.push(paint(at(new BoxGeometry(.06, .5, .06), -width / 2 + (i + .5) * width / 8, -.3, .4, i % 2 ? .6 : -.6), '#8a6a10'));
  return group(slab(width, material, .5, 0), new Mesh(k.own(merge(parts)), k.lit()));
}
/** A flying carpet with tassels. */
export function carpetPiece(k: Kit, width: number, material: Material) {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(paint(at(new ConeGeometry(.06, .3, 4), s * (width / 2 - .2), -.16, -.6 + i * .4, Math.PI), '#ffd24a'));
  return group(slab(width, material, .1, .02), new Mesh(k.own(merge(parts)), k.lit()));
}
/** A log bridge: a round log whose top is flat at y = 0. */
export function logPiece(k: Kit, width: number, material: Material) {
  const log = gradient(at(new CylinderGeometry(.5, .5, width, 14), 0, -.5, 0, Math.PI / 2, 1, 1, 1.4), '#b87838', '#5a3018', -1, 0);
  const rings = merge([-1, 1].map(s => paint(at(new CylinderGeometry(.48, .48, .04, 14), s * width / 2, -.5, 0, Math.PI / 2, 1, 1, 1.4), '#e8c080')));
  return group(slab(width, material, .12, .02), new Mesh(k.own(merge([log, rings])), k.lit()));
}

// ── Hazard objects (centered on their zone; +x faces the direction of travel) ──
export function bulletBill(k: Kit, length: number, height: number) {
  const r = height / 2, parts: BufferGeometry[] = [paint(at(new CylinderGeometry(r, r, length * .7, 18), -length * .15, 0, 0, Math.PI / 2), '#1a1a22'), paint(at(new SphereGeometry(r, 18, 10, 0, Math.PI), length * .2, 0, 0, -Math.PI / 2), '#1a1a22')];
  parts.push(paint(at(new CylinderGeometry(r * 1.08, r * 1.08, .12, 18), -length * .5, 0, 0, Math.PI / 2), '#3a3a44'));
  for (const z of [-r * .7, r * .7]) parts.push(paint(at(new SphereGeometry(r * .22, 8, 6), length * .22, r * .25, z), '#ffffff'));
  for (const y of [-r * .5, r * .5]) parts.push(paint(at(new BoxGeometry(length * .15, .06, r * 2.2), -length * .42, y, 0), '#1a1a22'));
  return new Mesh(k.own(merge(parts)), k.lit());
}
export function carBody(k: Kit, length: number, height: number, body: string, glass = '#9ad8ff') {
  const parts: BufferGeometry[] = [gradient(at(new BoxGeometry(length, height * .45, 1.8), 0, -height * .22, 0), body, '#2a2a3a', -height * .45, 0),
    paint(at(new BoxGeometry(length * .55, height * .35, 1.6), -length * .05, height * .18, 0), glass)];
  for (const x of [-length * .32, length * .32]) parts.push(paint(at(new CylinderGeometry(height * .2, height * .2, 1.9, 12), x, -height * .45, 0, 0, 1, 1, 1, Math.PI / 2), '#1a1a22'));
  parts.push(paint(at(new BoxGeometry(.1, .18, 1.2), length / 2, -height * .15, 0), '#fff4b0'));
  return new Mesh(k.own(merge(parts)), k.lit());
}
export function racer(k: Kit, length: number, body: string, stripe: string) {
  const parts: BufferGeometry[] = [gradient(at(new ConeGeometry(.55, length, 6), 0, 0, 0, -Math.PI / 2, 1, 1, .5), body, '#2a2a3a', -.5, .5),
    paint(at(new BoxGeometry(length * .3, .1, 2.4), -length * .2, -.1, 0), stripe), paint(at(new SphereGeometry(.25, 8, 6), 0, .25, 0, 0, 1.8, .6, 1), '#9ad8ff'),
    paint(at(new CylinderGeometry(.22, .3, .4, 10), -length * .52, 0, 0, Math.PI / 2), '#ff9a3a')];
  return new Mesh(k.own(merge(parts)), k.lit());
}
export function beam(k: Kit, length: number, color: string) { return new Mesh(k.own(paint(new BoxGeometry(length, .14, .14), color)), k.flat({ additive: true })); }
export function bombBlock(k: Kit, size: number) {
  const parts: BufferGeometry[] = [paint(new BoxGeometry(size, size, size), '#3a3a4a'), paint(at(new SphereGeometry(size * .32, 12, 8), 0, 0, size * .5), '#1a1a22'), paint(at(new CylinderGeometry(.04, .04, size * .3, 4), size * .2, size * .25, size * .6, -.6), '#ffd24a')];
  return new Mesh(k.own(merge(parts)), k.lit());
}
export function egg(k: Kit, size: number) { return new Mesh(k.own(merge([gradient(at(new SphereGeometry(size / 2, 14, 10), 0, 0, 0, 0, 1, 1.25, 1), '#ffffff', '#e0d8d0', -size, size), paint(at(new SphereGeometry(size * .12, 6, 4), size * .2, size * .2, size * .38), '#ff5a8a')])), k.lit()); }
export function jaws(k: Kit, width: number, color: string) {
  const r = rng(3), parts: BufferGeometry[] = [gradient(at(new SphereGeometry(width / 2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, -width * .1, 0, 0, 1, .7, .6), color, '#1a3a1a', -width * .2, width * .3)];
  for (let i = 0; i < 8; i++) parts.push(paint(at(new ConeGeometry(.08, .25, 4), (i / 7 - .5) * width * .8, -width * .08, width * .28, Math.PI), '#ffffff'));
  parts.push(paint(at(new SphereGeometry(width * .08, 8, 6), -width * .2, width * .22 + r() * .01, width * .1), '#ffe45c'), paint(at(new SphereGeometry(width * .08, 8, 6), width * .2, width * .22, width * .1), '#ffe45c'));
  return new Mesh(k.own(merge(parts)), k.lit());
}
export function tool(k: Kit, size: number) {
  return new Mesh(k.own(merge([paint(at(new BoxGeometry(size * .12, size, .1), 0, 0, 0, .5), '#2a342a'), paint(at(new BoxGeometry(size * .5, size * .22, .12), Math.sin(.5) * -size * .45, size * .42, 0, .5), '#2a342a')])), k.flat());
}
export const crystal = (size: number, color: string) => paint(new IcosahedronGeometry(size, 0), color);
