/** Procedural decor geometry shared by stage modules. Everything returns vertex-colored BufferGeometry for batching. */
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry, PlaneGeometry, TorusGeometry, type BufferGeometry, type ColorRepresentation } from 'three';
import { TAU, at, gradient, merge, mix, paint, rng } from './kit';

/** A toon cloud bank: overlapping lumps with bright tops and shaded undersides. */
export function puff(seed: number, width: number, height: number, top: ColorRepresentation, bottom: ColorRepresentation, lumps = 7, detail = 1): BufferGeometry {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < lumps; i++) {
    const t = lumps === 1 ? .5 : i / (lumps - 1), rad = height * (.45 + .55 * Math.sin(Math.PI * t)) * (.8 + r() * .35);
    parts.push(at(new IcosahedronGeometry(rad, detail), (t - .5) * width, rad * .55 + r() * height * .1, (r() - .5) * height * .6, 0, 1, .82, 1));
  }
  return gradient(merge(parts), top, bottom, -height * .2, height * 1.1);
}
/** A floating island: jittered inverted cone with a cap. */
export function island(seed: number, radius: number, depth: number, cap: ColorRepresentation, rock: ColorRepresentation, deep: ColorRepresentation, sides = 11) {
  const body = new CylinderGeometry(radius, radius * .12, depth, sides, 5).toNonIndexed(), p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = (y + depth / 2) / depth, a = Math.atan2(p.getZ(i), p.getX(i)), wob = 1 + (Math.sin(a * 3 + seed) * .08 + Math.sin(a * 7 + seed * 2) * .05) * (1 - k * .5);
    if (k < .99) { p.setX(i, p.getX(i) * wob); p.setZ(i, p.getZ(i) * wob); p.setY(i, y - Math.sin(a * 5 + seed) * depth * .06 * (1 - k)); }
  }
  body.translate(0, -depth / 2, 0); body.computeVertexNormals(); gradient(body, rock, deep, -depth, 0);
  return merge([body, paint(at(new CylinderGeometry(radius * 1.02, radius * .96, depth * .08, sides, 1), 0, -depth * .02, 0), cap)]);
}
/** A ridge outline for silhouettes: `count` peaks across [x0, x1] between heights lo..hi. */
export function ridge(seed: number, x0: number, x1: number, lo: number, hi: number, count: number, sharp = .5): [number, number][] {
  const r = rng(seed), out: [number, number][] = [[x0, lo]];
  for (let i = 0; i <= count; i++) {
    const x = x0 + (x1 - x0) * (i + r() * .4) / (count + .4), y = lo + (hi - lo) * (.35 + .65 * r());
    out.push([x - (x1 - x0) / count * .25 * sharp, lo + (y - lo) * (.5 + r() * .3)], [x, y]);
  }
  out.push([x1, lo]); return out.sort((a, b) => a[0] - b[0]);
}
/** A faceted crystal cluster rising from y = 0. */
export function crystals(seed: number, count: number, size: number, top: ColorRepresentation, bottom: ColorRepresentation) {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const h = size * (.6 + r() * .9), w = h * (.18 + r() * .1);
    parts.push(gradient(at(new OctahedronGeometry(1, 0), (r() - .5) * size * 1.2, h * .45, (r() - .5) * size * .6, (r() - .5) * .7, w, h, w), top, bottom, 0, h));
  }
  return merge(parts);
}
/** A city block row: boxes with lit windows baked as vertex colors (use with kit.flat or kit.lit). */
export function skyline(seed: number, x0: number, x1: number, base: number, lo: number, hi: number, z: number, body: ColorRepresentation, window: ColorRepresentation, lit = .45, depth = 3) {
  const r = rng(seed), parts: BufferGeometry[] = [];
  for (let x = x0; x < x1;) {
    const w = 2 + r() * 3.5, h = lo + r() * (hi - lo), c = mix(body, '#000', r() * .25);
    parts.push(paint(at(new BoxGeometry(w, h, depth), x + w / 2, base + h / 2, z), c));
    if (r() < .3) parts.push(paint(at(new BoxGeometry(w * .5, h * .12, depth * .6), x + w / 2, base + h + h * .06, z), c));
    const cols = Math.max(1, Math.floor(w / .9)), rows = Math.floor(h / 1.2);
    for (let i = 0; i < cols; i++) for (let j = 1; j < rows; j++) if (r() < lit) parts.push(paint(at(new PlaneGeometry(.42, .55), x + (i + .5) * w / cols, base + j * 1.2, z + depth / 2 + .02), mix(window, '#fff', r() * .3)));
    x += w + r() * .6;
  }
  return merge(parts);
}
/** A stylized tree: tapered trunk and a crown of toon lumps. */
export function tree(seed: number, height: number, trunk: ColorRepresentation, leaves: ColorRepresentation, leavesDark: ColorRepresentation, crown = 5, radius = height * .28) {
  const r = rng(seed), parts: BufferGeometry[] = [paint(at(new CylinderGeometry(height * .05, height * .08, height * .7, 7), 0, height * .35, 0), trunk)];
  for (let i = 0; i < crown; i++) {
    const a = i / crown * TAU + r(), d = radius * (.3 + r() * .5), s = radius * (.6 + r() * .4);
    parts.push(gradient(at(new IcosahedronGeometry(s, 1), Math.cos(a) * d, height * .72 + r() * radius * .5, Math.sin(a) * d * .6, 0, 1, .85, 1), leaves, leavesDark, height * .72 - s, height * .72 + s));
  }
  return merge(parts);
}
/** A palm or jungle tree: bent trunk and drooping fronds. */
export function palm(seed: number, height: number, trunk: ColorRepresentation, frond: ColorRepresentation, frondDark: ColorRepresentation) {
  const r = rng(seed), parts: BufferGeometry[] = [], lean = (r() - .5) * .5;
  for (let i = 0; i < 6; i++) parts.push(paint(at(new CylinderGeometry(height * .035, height * .045, height / 6 + .05, 6), lean * height * (i / 6) ** 2, height * (i + .5) / 6, 0), mix(trunk, '#000', (i % 2) * .15)));
  const tx = lean * height, ty = height;
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU + r() * .3;
    parts.push(gradient(at(new ConeGeometry(height * .06, height * .55, 4, 1), tx + Math.cos(a) * height * .22, ty - height * .06, Math.sin(a) * height * .12, Math.cos(a) > 0 ? -1.9 : 1.9, 1, 1, .35, 0, -a), frond, frondDark, ty - height * .3, ty));
  }
  return merge(parts);
}
/** A flat ring (halo, planetary ring, star ring) around the z axis. */
export const ring = (radius: number, tube: number, color: ColorRepresentation, segments = 64) => paint(new TorusGeometry(radius, tube, 4, segments), color);
