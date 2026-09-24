/* Tiny indexed-geometry accumulator used to build merged static meshes (one draw call per material). */
import * as THREE from 'three';

export class Geo {
  pos: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  private colored = false;
  get count() { return this.pos.length / 3; }
  v(x: number, y: number, z: number, u = 0, w = 0, color?: THREE.Color) {
    this.pos.push(x, y, z); this.uv.push(u, w);
    if (color) { this.colored = true; this.col.push(color.r, color.g, color.b); } else this.col.push(1, 1, 1);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  /** Quad a-b-c-d in counter-clockwise order (seen from the front). */
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  /**
   * Grid surface: `rows` × `cols` vertices from point(r, c, out[x, y, z, u, v]). Columns run left→right
   * as seen from the front, rows run away from the viewer, so faces point "up" for road-like strips.
   * `skip(r)` omits the quads between rows r and r + 1.
   */
  grid(rows: number, cols: number, point: (r: number, c: number, out: number[]) => void, skip?: (r: number) => boolean, color?: (r: number, c: number) => THREE.Color | undefined) {
    const o = [0, 0, 0, 0, 0], start = this.count;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { point(r, c, o); this.v(o[0], o[1], o[2], o[3], o[4], color?.(r, c)); }
    for (let r = 0; r < rows - 1; r++) {
      if (skip?.(r)) continue;
      for (let c = 0; c < cols - 1; c++) {
        const a = start + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        this.idx.push(a, b, d, b, e, d);
      }
    }
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.colored) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}
