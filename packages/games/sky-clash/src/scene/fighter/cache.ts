/** Geometry and textures shared by every fighter actor in one scene. Own it in the scene's ResourceScope. */
import { BufferGeometry, CircleGeometry, DataTexture, IcosahedronGeometry, LinearFilter, PlaneGeometry, RGBAFormat, RingGeometry, Shape, ShapeGeometry, TorusGeometry, type Texture } from 'three';
import { toonGradient } from './materials';

function radial(size = 64): Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - size / 2 + .5, y - size / 2 + .5) / (size / 2), a = Math.max(0, 1 - d) ** 1.6, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  const tex = new DataTexture(data, size, size, RGBAFormat); tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true;
  return tex;
}
function star(points = 5, outer = 1, inner = .45) {
  const s = new Shape();
  for (let i = 0; i <= points * 2; i++) { const r = i % 2 ? inner : outer, a = Math.PI / 2 + i * Math.PI / points; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  return new ShapeGeometry(s);
}
function zed() {
  const s = new Shape(), p: [number, number][] = [[-.5, .5], [.5, .5], [.5, .3], [-.18, -.3], [.5, -.3], [.5, -.5], [-.5, -.5], [-.5, -.3], [.18, .3], [-.5, .3]];
  p.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
  return new ShapeGeometry(s);
}

export class FighterCache {
  readonly gradient = toonGradient();
  readonly soft = radial();
  readonly plane: BufferGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  readonly ring: BufferGeometry = new RingGeometry(.8, 1, 48).rotateX(-Math.PI / 2);
  readonly sphere: BufferGeometry = new IcosahedronGeometry(1, 4);
  readonly halo: BufferGeometry = new TorusGeometry(1, .07, 8, 48).rotateX(Math.PI / 2);
  readonly disc: BufferGeometry = new CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  readonly star: BufferGeometry = star();
  readonly zed: BufferGeometry = zed();
  dispose() { for (const g of [this.plane, this.ring, this.sphere, this.halo, this.disc, this.star, this.zed]) g.dispose(); this.gradient.dispose(); this.soft.dispose(); }
}
