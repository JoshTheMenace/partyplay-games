/**
 * Section mesher: turns a padded chunk volume (cells + light) into quads for the opaque, cutout and translucent layers.
 *
 * Cube faces are culled against opaque neighbours and lit smoothly: each vertex averages the light of the four cells
 * touching that corner in front of the face, and darkens by ambient occlusion from the opaque ones (0fps.net style).
 * Partial shapes (slabs, stairs, doors, fences, pistons...) reuse the same lighting, interpolated to their vertex
 * positions. Small details (plants, torches, lever handles, redstone dust) take the flat light of their own cell.
 */
import {
  attachedFace, B, faceTexture, fenceConnects, LEVER_ON, leverFacing, pistonFacing, PISTON_EXTENDED, PORTAL_Z, REPEATER_POWERED, repeaterDelay, repeaterFacing,
  STAIRS_TOP, wirePower,
} from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import { CHUNK } from '../../shared/constants';
import { FACES, FACING, FACING_FACE } from '../../shared/coords';
import { WIRE_UP, wireShape } from '../../shared/redstone';
import { onFace, selectionBoxes, type Box } from '../../shared/shapes';
import { PA, PX, volumeIndex, type Volume } from './light';
import {
  OPAQUE_CELL, RENDER, S_BED, S_BUTTON, S_CACTUS, S_CAGE, S_CROP, S_CROSS, S_CUBE, S_DOOR, S_FARMLAND, S_FENCE, S_FIRE, S_LADDER, S_LANTERN, S_LEVER, S_LIQUID,
  S_PISTON, S_PISTON_HEAD, S_PLATE, S_PORTAL, S_REPEATER, S_SLAB, S_STAIRS, S_TORCH, S_WIRE, SHAPE,
} from './tables';
import { VF_FIRE, VF_LAVA, VF_LEAVES, VF_PLANT, VF_PORTAL, VF_SURFACE, VF_WATER, VF_WIRE, type LayerMesh, type Layers } from './types';

type V3 = readonly [number, number, number];
/** Full-face corners p0..p3 per face (0..5 = -X,+X,-Y,+Y,-Z,+Z), counter-clockwise seen from outside. */
const CORNERS: readonly (readonly V3[])[] = [
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
];
const NORMALS: readonly V3[] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Texture axes: u runs along p0→p1, v along p0→p3 (image y = 1 - v). */
const U_AXIS = CORNERS.map(c => minus(c[1]!, c[0]!)), V_AXIS = CORNERS.map(c => minus(c[3]!, c[0]!));
const offset = (d: V3) => d[0] + PX * d[2] + PA * d[1];
const N_OFF = NORMALS.map(offset), U_OFF = U_AXIS.map(offset), V_OFF = V_AXIS.map(offset);
/** Corner k's position along U and V (0 or 1). */
const DU = [0, 1, 1, 0], DV = [0, 0, 1, 1];
/** Directional shading: top brightest, bottom darkest, X sides darker than Z sides (MC-like). */
const FACE_SHADE = [0.64, 0.64, 0.52, 1, 0.8, 0.8];
/** Brightness by ambient-occlusion level (0 = corner fully enclosed, 3 = open). */
const AO_SHADE = [0.56, 0.72, 0.86, 1];
const px = (n: number) => n / 16;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/**
 * How a face's image turns so its top points towards direction `up` (a face index): TURN[up * 6 + face] = 0 unturned,
 * 1 upside down, 2 top along +U, 3 top along -U (faces facing along `up` stay unturned).
 */
const TURN = Uint8Array.from({ length: 36 }, (_, i) => {
  const up = NORMALS[i / 6 | 0]!, face = i % 6, su = dot(up, U_AXIS[face]!), sv = dot(up, V_AXIS[face]!);
  return sv < 0 ? 1 : su > 0 ? 2 : su < 0 ? 3 : 0;
});

const LEAVES = new Uint8Array(256);
LEAVES[B.oak_leaves] = LEAVES[B.birch_leaves] = LEAVES[B.spruce_leaves] = 1;
const JITTER = new Uint8Array(256);
for (const id of [B.short_grass, B.fern, B.dandelion, B.poppy, B.cornflower, B.dead_bush]) JITTER[id] = 1;
/** Cross shapes that never sway. */
const STILL = new Uint8Array(256);
for (const id of [B.sugar_cane, B.cobweb, B.red_mushroom, B.brown_mushroom]) STILL[id] = 1;

/** A box to draw plus a bit mask of which of its faces to emit. */
type Part = readonly [Box, number];
/**
 * Per-box drawing options: vertex flags, the direction image tops point towards on the faces in `upMask` (-1 = none),
 * a texture layer that replaces the cell's own (-1 = none) and whether faces are also drawn from inside (cages).
 */
type Style = { readonly flags: number; readonly up: number; readonly upMask: number; readonly layer: number; readonly twoSided: boolean };
const style = (flags = 0, up = -1, upMask = 0, layer = -1, twoSided = false): Style => ({ flags, up, upMask, layer, twoSided });
const PLAIN = style(), PORTAL_STYLE = style(VF_PORTAL), CAGE_STYLE = style(0, -1, 0, -1, true);
/** Beds and repeaters: the top image points along the facing. Pistons: every side stripe points towards the head. */
const TOP_TURN = FACING_FACE.map(face => style(0, face, 8));
const PISTON_STYLE = [0, 1, 2, 3, 4, 5].map(face => style(0, face, 63));

const ALL = 63, NO_TOP = ALL & ~8, NO_BOTTOM = ALL & ~4;
function edge(dir: number, t: number, y0: number, y1: number): Box {
  switch (dir & 3) {
    case 0: return [0, y0, 0, 1, y1, t];
    case 1: return [1 - t, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 1 - t, 1, y1, 1];
    default: return [0, y0, 0, t, y1, 1];
  }
}
const FULL: Box = [0, 0, 0, 1, 1, 1];
const SLAB_PARTS: readonly (readonly Part[])[] = [[[[0, 0, 0, 1, 0.5, 1], ALL]], [[[0, 0.5, 0, 1, 1, 1], ALL]], [[FULL, ALL]], [[FULL, ALL]]];
/** Stairs: the slab half, the raised half (facing = high side) and the exposed part of the slab's inner face. */
const STAIR_PARTS: readonly (readonly Part[])[] = Array.from({ length: 8 }, (_, state) => {
  const dir = state & 3;
  return state & STAIRS_TOP
    ? [[[0, 0.5, 0, 1, 1, 1], NO_BOTTOM], [edge(dir, 0.5, 0, 0.5), NO_TOP], [edge(dir + 2, 0.5, 0.5, 1), 4]]
    : [[[0, 0, 0, 1, 0.5, 1], NO_TOP], [edge(dir, 0.5, 0.5, 1), NO_BOTTOM], [edge(dir + 2, 0.5, 0, 0.5), 8]];
});
/** MC cactus: full-size top and bottom, sides inset by 1/16. */
const CACTUS_PARTS: readonly Part[] = [[FULL, 12], [[0, 0, px(1), 1, 1, px(15)], 48], [[px(1), 0, 0, px(15), 1, 1], 3]];
const LANTERN_PARTS: readonly Part[] = [[[px(5), 0, px(5), px(11), px(7), px(11)], ALL], [[px(6), px(7), px(6), px(10), px(9), px(10)], NO_BOTTOM]];
const FARMLAND_PARTS: readonly Part[] = [[[0, 0, 0, 1, px(15), 1], ALL]];
const BED_PARTS: readonly Part[] = [[[0, 0, 0, 1, px(9), 1], ALL]];
/** Ladders: one face 1/16 in front of the wall they hang on, facing away from it. */
const LADDER_PARTS: readonly (readonly Part[])[] = [0, 1, 2, 3].map(facing => [[edge(facing + 2, px(1), 0, 1), 1 << FACING_FACE[facing]]]);
/** Fences: the post plus two 2 px bars (MC heights 6–9 and 12–15) towards every connected side (bits N, E, S, W). */
const FENCE_PARTS: readonly (readonly Part[])[] = Array.from({ length: 16 }, (_, state) => {
  const parts: Part[] = [[[px(6), 0, px(6), px(10), 1, px(10)], ALL]];
  for (let dir = 0; dir < 4; dir++) if (fenceConnects(state, dir)) for (const [y0, y1] of [[6, 9], [12, 15]] as const) {
    const bars: Box[] = [[px(7), px(y0), 0, px(9), px(y1), px(6)], [px(10), px(y0), px(7), 1, px(y1), px(9)], [px(7), px(y0), px(10), px(9), px(y1), 1], [0, px(y0), px(7), px(6), px(y1), px(9)]];
    const bar = bars[dir]!;
    parts.push([bar, ALL & ~(1 << FACING_FACE[(dir + 2) % 4])]);
  }
  return parts;
});
/** Nether portal slabs by axis (state bit 0: the plane spans Z). */
const PORTAL_BOXES: readonly Box[] = [[0, 0, px(6), 1, 1, px(10)], [px(6), 0, 0, px(10), 1, 1]];
const REPEATER_BASE: Box = [0, 0, 0, 1, px(2), 1];
/** Lever bases (MC 6 × 8 × 3 px, long side along the handle's swing) by attached face + 6 × floor facing. */
const LEVER_BASE: readonly Box[] = Array.from({ length: 24 }, (_, i) => {
  const face = i % 6, alongX = (face === 2 || face === 3) && (i / 6 | 0) % 2 === 1;
  return alongX ? onFace(face, px(8), px(6), px(3)) : onFace(face, px(6), px(8), px(3));
});
/** The part of a piston rod inside an extended base (from the cut face to the cell edge), and the rod faces to draw. */
const ROD_IN: readonly Box[] = [0, 1, 2, 3, 4, 5].map(face => {
  const box = [px(6), px(6), px(6), px(10), px(10), px(10)], axis = face >> 1;
  box[axis] = face & 1 ? px(12) : 0;
  box[axis + 3] = face & 1 ? 1 : px(4);
  return box as unknown as Box;
});
const ROD_MASK = [0, 1, 2, 3, 4, 5].map(face => ALL & ~(3 << (face & 6)));
/** Redstone dust heights: the centre dot, then line pieces just above it (no z-fighting where they overlap). */
const DOT_Y = px(0.25), LINE_Y = px(0.4);
/** Half-cell dust pieces from the centre towards N, E, S, W: [x0, z0, x1, z1]. */
const WIRE_HALF = [[0, 0, 1, 0.5], [0.5, 0, 1, 1], [0, 0.5, 1, 1], [0, 0, 0.5, 1]] as const;
/** MC floor fire: 22.4 px tall planes 0.8 px either side of the centre, tilted 22.5° so they cross low and lean out. */
const FIRE_HEIGHT = 1.4, FIRE_TILT = Math.tan(Math.PI / 8), FIRE_PLANES = [[0.55, 1], [0.45, -1]] as const;

// Staged quad (4 vertices) and corner lighting scratch.
const QX = new Float64Array(4), QY = new Float64Array(4), QZ = new Float64Array(4), QU = new Float64Array(4), QV = new Float64Array(4);
const QS = new Float64Array(4), QB = new Float64Array(4), QA = new Float64Array(4), QF = new Uint16Array(4);
const CS = new Float64Array(4), CB = new Float64Array(4), CA = new Float64Array(4);
const ORDER = [0, 1, 2, 3], FLIPPED = [1, 2, 3, 0], REVERSED = [3, 2, 1, 0];

/** Growable vertex arrays for one render layer. */
class Builder {
  pos = new Float32Array(12 * 1024);
  uvl = new Uint16Array(16 * 1024);
  lt = new Uint8Array(16 * 1024);
  quads = 0;
  minY = Infinity;
  maxY = -Infinity;
  /** Appends the staged quad (`tint` goes to lt.w). Splits along the brighter diagonal so AO gradients stay symmetric. */
  add(layer: number, reverse: boolean, tint = 0) {
    if ((this.quads + 1) * 12 > this.pos.length) this.grow();
    const order = reverse ? REVERSED : QA[0]! + QA[2]! > QA[1]! + QA[3]! ? FLIPPED : ORDER;
    const { pos, uvl, lt } = this, p = this.quads * 12, t = this.quads * 16;
    for (let j = 0; j < 4; j++) {
      const k = order[j]!, y = QY[k]!;
      pos[p + j * 3] = QX[k]!;
      pos[p + j * 3 + 1] = y;
      pos[p + j * 3 + 2] = QZ[k]!;
      uvl[t + j * 4] = Math.round(QU[k]! * 4096);
      uvl[t + j * 4 + 1] = Math.round(QV[k]! * 4096);
      uvl[t + j * 4 + 2] = layer;
      uvl[t + j * 4 + 3] = QF[k]!;
      lt[t + j * 4] = Math.round(QS[k]! * 17);
      lt[t + j * 4 + 1] = Math.round(QB[k]! * 17);
      lt[t + j * 4 + 2] = Math.round(QA[k]! * 255);
      lt[t + j * 4 + 3] = tint;
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
    }
    this.quads++;
  }
  private grow() {
    const pos = new Float32Array(this.pos.length * 2), uvl = new Uint16Array(this.uvl.length * 2), lt = new Uint8Array(this.lt.length * 2);
    pos.set(this.pos);
    uvl.set(this.uvl);
    lt.set(this.lt);
    Object.assign(this, { pos, uvl, lt });
  }
  /** Copies out the finished mesh (null when empty) and resets. */
  take(): LayerMesh | null {
    const { quads } = this;
    const mesh = quads ? { pos: this.pos.slice(0, quads * 12), uvl: this.uvl.slice(0, quads * 16), lt: this.lt.slice(0, quads * 16), quads, minY: this.minY, maxY: this.maxY } : null;
    this.quads = 0;
    this.minY = Infinity;
    this.maxY = -Infinity;
    return mesh;
  }
}

/** Joins section meshes of one layer into a single column mesh (or null). */
export function joinLayers(parts: readonly (LayerMesh | null)[]): LayerMesh | null {
  let quads = 0, minY = Infinity, maxY = -Infinity;
  for (const part of parts) if (part) {
    quads += part.quads;
    minY = Math.min(minY, part.minY);
    maxY = Math.max(maxY, part.maxY);
  }
  if (!quads) return null;
  const mesh: LayerMesh = { pos: new Float32Array(quads * 12), uvl: new Uint16Array(quads * 16), lt: new Uint8Array(quads * 16), quads, minY, maxY };
  let at = 0;
  for (const part of parts) if (part) {
    mesh.pos.set(part.pos, at * 12);
    mesh.uvl.set(part.uvl, at * 16);
    mesh.lt.set(part.lt, at * 16);
    at += part.quads;
  }
  return mesh;
}

export class Mesher {
  private faceLayers = new Int32Array(65536 * 6).fill(-1);
  private builders = [new Builder(), new Builder(), new Builder()] as const;
  private readonly waterLayer: number;
  private readonly lavaLayer: number;
  private readonly torchOn: number;
  private readonly torchOff: number;
  private readonly leverStyle: Style;
  /** The volume being meshed, read in chunk-local coordinates (for the shared redstone dust rules). */
  private volume: Volume | null = null;
  private readonly read: CellReader = (x, y, z) => this.volume!.cells[volumeIndex(x, y, z)]!;
  constructor(private layerOf: (key: string) => number) {
    this.waterLayer = layerOf('water');
    this.lavaLayer = layerOf('lava');
    this.torchOn = layerOf('redstone_torch');
    this.torchOff = layerOf('redstone_torch_off');
    this.leverStyle = style(0, -1, 0, layerOf('cobblestone'));
  }

  /** Texture layer of a cell face (memoised per cell value). */
  private texture(cell: number, face: number) {
    const key = cell * 6 + face;
    let layer = this.faceLayers[key]!;
    if (layer < 0) layer = this.faceLayers[key] = this.layerOf(faceTexture(cell, face));
    return layer;
  }

  /** Meshes section `sy` (y = 16·sy .. 16·sy+15) of a volume. `wx, wz` = the chunk's world origin (plant jitter). */
  section(volume: Volume, sy: number, wx = 0, wz = 0): Layers {
    const { cells } = volume, builders = this.builders;
    this.volume = volume;
    for (let y = sy * CHUNK; y < sy * CHUNK + CHUNK; y++) for (let z = 0; z < CHUNK; z++) {
      let i = volumeIndex(0, y, z);
      for (let x = 0; x < CHUNK; x++, i++) {
        const cell = cells[i]!, id = cell & 255;
        if (!id) continue;
        const render = RENDER[id]!;
        if (!render) continue;
        const out = builders[render - 1]!, state = cell >> 8;
        switch (SHAPE[id]) {
          case S_CUBE: this.cube(volume, i, cell, x, y, z, out); break;
          case S_LIQUID: this.liquid(volume, i, id, x, y, z, out); break;
          case S_CROSS: this.cross(volume, i, cell, x, y, z, out, JITTER[id] ? wx + x : null, wz + z); break;
          case S_CROP: this.crop(volume, i, cell, x, y, z, out); break;
          case S_TORCH: this.torch(volume, i, cell, x, y, z, out); break;
          case S_SLAB: this.parts(volume, i, cell, x, y, z, SLAB_PARTS[state & 3]!, out); break;
          case S_STAIRS: this.parts(volume, i, cell, x, y, z, STAIR_PARTS[state & 7]!, out); break;
          case S_LADDER: this.parts(volume, i, cell, x, y, z, LADDER_PARTS[state & 3]!, out); break;
          case S_DOOR: case S_BUTTON: case S_PLATE: this.box(volume, i, cell, x, y, z, selectionBoxes(cell)[0]!, ALL, out); break;
          case S_BED: this.parts(volume, i, cell, x, y, z, BED_PARTS, out, TOP_TURN[state & 3]); break;
          case S_CACTUS: this.parts(volume, i, cell, x, y, z, CACTUS_PARTS, out); break;
          case S_LANTERN: this.parts(volume, i, cell, x, y, z, LANTERN_PARTS, out); break;
          case S_FARMLAND: this.parts(volume, i, cell, x, y, z, FARMLAND_PARTS, out); break;
          case S_FENCE: this.parts(volume, i, cell, x, y, z, FENCE_PARTS[state & 15]!, out); break;
          case S_PORTAL: this.box(volume, i, cell, x, y, z, PORTAL_BOXES[state & PORTAL_Z]!, ALL, out, PORTAL_STYLE); break;
          case S_CAGE: this.box(volume, i, cell, x, y, z, FULL, ALL, out, CAGE_STYLE); break;
          case S_FIRE: this.fire(volume, i, cell, x, y, z, out); break;
          case S_WIRE: this.wire(volume, i, cell, x, y, z, out); break;
          case S_LEVER: this.lever(volume, i, cell, x, y, z, out); break;
          case S_REPEATER: this.repeater(volume, i, cell, x, y, z, out); break;
          case S_PISTON: case S_PISTON_HEAD: this.piston(volume, i, cell, x, y, z, out); break;
          // Shapes without a dedicated mesh are drawn from their selection boxes.
          default: for (const box of selectionBoxes(cell)) this.box(volume, i, cell, x, y, z, box, ALL, out);
        }
      }
    }
    return [builders[0].take(), builders[1].take(), builders[2].take()];
  }

  /** Whether a boundary face towards neighbour `n` is hidden. */
  private hidden(cell: number, n: number, face: number) {
    if (OPAQUE_CELL[n]) return true;
    const id = cell & 255;
    if ((n & 255) !== id) return false;
    const vertical = face === 2 || face === 3;
    switch (SHAPE[id]) {
      case S_CUBE: return !LEAVES[id];
      case S_LIQUID: case S_FENCE: case S_PORTAL: return true;
      case S_SLAB: return !vertical && ((cell ^ n) >> 8 & 3) === 0;
      case S_BED: case S_FARMLAND: return !vertical;
      case S_DOOR: return vertical && ((cell ^ n) >> 8 & 7) === 0;
      case S_CACTUS: return vertical;
    }
    return false;
  }

  /**
   * Smooth light and AO at the four corners of face `face`, sampled in the layer `plane` (an index offset:
   * the neighbour in front for boundary faces, 0 = the cell's own layer for inset faces).
   */
  private corners(volume: Volume, i: number, plane: number, face: number) {
    const { cells, sky, block } = volume, front = i + plane, u = U_OFF[face]!, v = V_OFF[face]!;
    for (let k = 0; k < 4; k++) {
      const side1 = front + (DU[k] ? u : -u), side2 = front + (DV[k] ? v : -v), corner = side1 + side2 - front;
      const o1 = OPAQUE_CELL[cells[side1]!]!, o2 = OPAQUE_CELL[cells[side2]!]!, oc = OPAQUE_CELL[cells[corner]!]!;
      let s = sky[front]!, b = block[front]!, n = 1;
      if (!o1) { s += sky[side1]!; b += block[side1]!; n++; }
      if (!o2) { s += sky[side2]!; b += block[side2]!; n++; }
      if (!oc && !(o1 && o2)) { s += sky[corner]!; b += block[corner]!; n++; }
      CS[k] = s / n;
      CB[k] = b / n;
      CA[k] = AO_SHADE[o1 && o2 ? 0 : 3 - o1 - o2 - oc]!;
    }
  }

  private cube(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const flags = LEAVES[cell & 255] ? VF_LEAVES : 0;
    for (let face = 0; face < 6; face++) {
      if (this.hidden(cell, volume.cells[i + N_OFF[face]!]!, face)) continue;
      this.corners(volume, i, N_OFF[face]!, face);
      const corners = CORNERS[face]!, shade = FACE_SHADE[face]!;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!;
        QX[k] = x + c[0];
        QY[k] = y + c[1];
        QZ[k] = z + c[2];
        QU[k] = DU[k]!;
        QV[k] = 1 - DV[k]!;
        QS[k] = CS[k]!;
        QB[k] = CB[k]!;
        QA[k] = shade * CA[k]!;
        QF[k] = flags;
      }
      out.add(this.texture(cell, face), false);
    }
  }

  private parts(volume: Volume, i: number, cell: number, x: number, y: number, z: number, parts: readonly Part[], out: Builder, look = PLAIN) {
    for (const [box, mask] of parts) this.box(volume, i, cell, x, y, z, box, mask, out, look);
  }

  /** Emits the faces in `mask` of a box inside the cell, with smooth light interpolated to each vertex. */
  private box(volume: Volume, i: number, cell: number, x: number, y: number, z: number, box: Box, mask: number, out: Builder, look = PLAIN) {
    for (let face = 0; face < 6; face++) {
      if (!(mask & 1 << face)) continue;
      const axis = face >> 1, positive = face & 1, boundary = positive ? box[axis + 3] === 1 : box[axis] === 0;
      if (boundary && this.hidden(cell, volume.cells[i + N_OFF[face]!]!, face)) continue;
      this.corners(volume, i, boundary ? N_OFF[face]! : 0, face);
      const corners = CORNERS[face]!, origin = corners[0]!, U = U_AXIS[face]!, V = V_AXIS[face]!, shade = FACE_SHADE[face]!;
      const turn = look.upMask & 1 << face ? TURN[look.up * 6 + face]! : 0;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!;
        const bx = c[0] ? box[3] : box[0], by = c[1] ? box[4] : box[1], bz = c[2] ? box[5] : box[2];
        const ox = bx - origin[0], oy = by - origin[1], oz = bz - origin[2];
        const du = ox * U[0] + oy * U[1] + oz * U[2], dv = ox * V[0] + oy * V[1] + oz * V[2];
        const w0 = (1 - du) * (1 - dv), w1 = du * (1 - dv), w2 = du * dv, w3 = (1 - du) * dv;
        QX[k] = x + bx;
        QY[k] = y + by;
        QZ[k] = z + bz;
        QS[k] = CS[0]! * w0 + CS[1]! * w1 + CS[2]! * w2 + CS[3]! * w3;
        QB[k] = CB[0]! * w0 + CB[1]! * w1 + CB[2]! * w2 + CB[3]! * w3;
        QA[k] = shade * (CA[0]! * w0 + CA[1]! * w1 + CA[2]! * w2 + CA[3]! * w3);
        QF[k] = look.flags;
        // Image coordinates, turned so the top of the picture points along `look.up` (bed heads, piston stripes).
        QU[k] = turn === 0 ? du : turn === 1 ? 1 - du : turn === 2 ? 1 - dv : dv;
        QV[k] = turn === 0 ? 1 - dv : turn === 1 ? dv : turn === 2 ? 1 - du : du;
      }
      const layer = look.layer >= 0 ? look.layer : this.texture(cell, face);
      out.add(layer, false);
      if (look.twoSided) out.add(layer, true);
    }
  }

  /** Stages a vertical plane from (x0, z0) to (x1, z1) with flat light; top vertices get `topFlags` and lean by (leanX, leanZ). */
  private plane(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, sky: number, block: number, topFlags: number, baseFlags = 0, leanX = 0, leanZ = 0) {
    QX[0] = x0;
    QZ[0] = z0;
    QX[1] = x1;
    QZ[1] = z1;
    QX[2] = x1 + leanX;
    QZ[2] = z1 + leanZ;
    QX[3] = x0 + leanX;
    QZ[3] = z0 + leanZ;
    QY[0] = QY[1] = y0;
    QY[2] = QY[3] = y1;
    QU[0] = QU[3] = 0;
    QU[1] = QU[2] = 1;
    QV[0] = QV[1] = 1;
    QV[2] = QV[3] = 0;
    QS.fill(sky);
    QB.fill(block);
    QA[0] = QA[1] = 0.78;
    QA[2] = QA[3] = 1;
    QF[0] = QF[1] = baseFlags;
    QF[2] = QF[3] = topFlags;
  }

  /** Two diagonal planes, both sides. Grass and flowers are nudged by a per-column hash like MC. */
  private cross(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder, jitterX: number | null, jitterZ: number) {
    let ox = 0, oz = 0;
    if (jitterX !== null) {
      const h = Math.imul(jitterX, 73856093) ^ Math.imul(jitterZ, 19349663);
      ox = ((h & 15) / 15 - 0.5) * 0.375;
      oz = ((h >> 4 & 15) / 15 - 0.5) * 0.375;
    }
    const layer = this.texture(cell, 4), sway = STILL[cell & 255] ? 0 : VF_PLANT, a = 0.1464, b = 0.8536;
    const sky = volume.sky[i]!, block = volume.block[i]!;
    x += ox;
    z += oz;
    for (const [x0, z0, x1, z1] of [[a, a, b, b], [a, b, b, a]] as const) {
      this.plane(x + x0, z + z0, x + x1, z + z1, y, y + 1, sky, block, sway);
      out.add(layer, false);
      out.add(layer, true);
    }
  }

  /** Four planes in a # pattern, sunk 1/16 into the farmland below. */
  private crop(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const layer = this.texture(cell, 4), sky = volume.sky[i]!, block = volume.block[i]!, y0 = y - px(1), y1 = y + px(15);
    for (const [x0, z0, x1, z1] of [[0.25, 0, 0.25, 1], [0.75, 0, 0.75, 1], [0, 0.25, 1, 0.25], [0, 0.75, 1, 0.75]] as const) {
      this.plane(x + x0, z + z0, x + x1, z + z1, y0, y1, sky, block, VF_PLANT);
      out.add(layer, false);
      out.add(layer, true);
    }
  }

  /** Fire (MC's floor fire): four tall planes crossing near the centre and leaning outwards, both faces, flickering and glowing. */
  private fire(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const layer = this.texture(cell, 4), sky = volume.sky[i]!, block = volume.block[i]!, top = y + FIRE_HEIGHT, flicker = VF_FIRE | VF_PLANT;
    for (const [at, sign] of FIRE_PLANES) {
      // Tilted about the cell's mid-height: the foot sits `tilt / 2` inward, the top leans out by `tilt × height`.
      const foot = at - sign * FIRE_TILT * 0.5, lean = sign * FIRE_TILT * FIRE_HEIGHT;
      this.plane(x, z + foot, x + 1, z + foot, y, top, sky, block, flicker, VF_FIRE, 0, lean);
      out.add(layer, false);
      out.add(layer, true);
      this.plane(x + foot, z + 1, x + foot, z, y, top, sky, block, flicker, VF_FIRE, lean, 0);
      out.add(layer, false);
      out.add(layer, true);
    }
  }

  /** A 2×10 px stick; wall torches lean away from the wall they are fixed to. */
  private torch(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const state = cell >> 8, layer = this.texture(cell, 4), sky = volume.sky[i]!, block = volume.block[i]!;
    const [dx, dz] = state ? FACING[(state - 1) & 3]! : [0, 0];
    const baseX = x + 0.5 - dx * 0.4375, baseY = y + (state ? px(3) : 0), baseZ = z + 0.5 - dz * 0.4375, lean = 0.42, w = px(1), h = px(10);
    for (let face = 0; face < 6; face++) {
      if (face === 2 && !state) continue;
      const corners = CORNERS[face]!;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!, ox = c[0] ? w : -w, oy = c[1] ? h : 0, oz = c[2] ? w : -w;
        QX[k] = baseX + ox + dx * lean * oy;
        QY[k] = baseY + oy;
        QZ[k] = baseZ + oz + dz * lean * oy;
        QU[k] = px(7) + DU[k]! * px(2);
        // Sides show the stick (rows 6..16), the top the flame tip (rows 6..8), the bottom the stick end.
        QV[k] = face < 2 || face > 3 ? px(6) + (1 - DV[k]!) * px(10) : (face === 3 ? px(6) : px(14)) + (1 - DV[k]!) * px(2);
        QS[k] = sky;
        QB[k] = block;
        QA[k] = 1;
        QF[k] = 0;
      }
      out.add(layer, false);
    }
  }

  /**
   * A 2×2 px stick from base point b along the unit axis a, `rows` px long, with torch-style UVs (the texture's centre
   * two columns from row 6 down; the top shows rows 6–8). Lever handles and repeater torches.
   */
  private stick(bx: number, by: number, bz: number, ax: number, ay: number, az: number, rows: number, layer: number, sky: number, block: number, out: Builder) {
    // Cross-section axes P ⟂ a (horizontal unless a is vertical) and Q = P × a, so (P, a, Q) keeps the cube's winding.
    let qx = -az, qz = ax;
    const flat = Math.hypot(qx, qz);
    if (flat < 1e-3) { qx = 1; qz = 0; } else { qx /= flat; qz /= flat; }
    const w = px(1), length = px(rows), rx = -qz * ay, ry = qz * ax - qx * az, rz = qx * ay;
    for (let face = 0; face < 6; face++) {
      const corners = CORNERS[face]!;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!, sp = c[0] ? w : -w, sa = c[1] ? length : 0, sq = c[2] ? w : -w;
        QX[k] = bx + qx * sp + ax * sa + rx * sq;
        QY[k] = by + ay * sa + ry * sq;
        QZ[k] = bz + qz * sp + az * sa + rz * sq;
        QU[k] = px(7) + DU[k]! * px(2);
        QV[k] = face < 2 || face > 3 ? px(6) + (1 - DV[k]!) * px(rows) : (face === 3 ? px(6) : px(14)) + (1 - DV[k]!) * px(2);
        QS[k] = sky;
        QB[k] = block;
        QA[k] = FACE_SHADE[face]! * 0.2 + 0.8;
        QF[k] = 0;
      }
      out.add(layer, false);
    }
  }

  /** Lever: a cobblestone base on the supporting face and a handle tilted 45° one way when off, the other when on. */
  private lever(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const state = cell >> 8, face = attachedFace(state), facing = leverFacing(state), floorLike = face === 2 || face === 3;
    this.box(volume, i, cell, x, y, z, LEVER_BASE[face + 6 * (floorLike ? facing : 0)]!, ALL, out, this.leverStyle);
    const [nx, ny, nz] = FACES[face]!, [fx, fz] = FACING[facing]!, s = (state & LEVER_ON ? -1 : 1) * Math.SQRT1_2;
    // The handle swings along the floor facing (floor and ceiling levers) or up and down (wall levers).
    const ax = nx * Math.SQRT1_2 + (floorLike ? fx * s : 0), ay = ny * Math.SQRT1_2 + (floorLike ? 0 : s), az = nz * Math.SQRT1_2 + (floorLike ? fz * s : 0);
    const base = 0.5 - px(1);
    this.stick(x + 0.5 - nx * base, y + 0.5 - ny * base, z + 0.5 - nz * base, ax, ay, az, 10, this.texture(cell, 3), volume.sky[i]!, volume.block[i]!, out);
  }

  /** Repeater: a 2 px slab (top turned to its output) with a fixed torch near the output and one set back by the delay. */
  private repeater(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const state = cell >> 8, facing = repeaterFacing(state), torch = state & REPEATER_POWERED ? this.torchOn : this.torchOff, sky = volume.sky[i]!, block = volume.block[i]!;
    this.box(volume, i, cell, x, y, z, REPEATER_BASE, ALL, out, TOP_TURN[facing]);
    // MC model coordinates face north (output at -Z): torch centres at z = 3 px and 5 + 2 × delay px, turned to the facing.
    for (let t = 0; t < 2; t++) {
      const along = px(t ? 5 + 2 * repeaterDelay(state) : 3);
      const tx = facing === 1 ? 1 - along : facing === 3 ? along : 0.5, tz = facing === 0 ? along : facing === 2 ? 1 - along : 0.5;
      this.stick(x + tx, y + px(2), z + tz, 0, 1, 0, 5, torch, sky, block, out);
    }
  }

  /** Piston bases (full, or cut back with the rod showing when extended) and heads (plate plus rod). */
  private piston(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const state = cell >> 8, face = pistonFacing(state), look = PISTON_STYLE[face]!, boxes = selectionBoxes(cell);
    if ((cell & 255) === B.piston_head) {
      this.box(volume, i, cell, x, y, z, boxes[0]!, ALL, out, look);
      this.box(volume, i, cell, x, y, z, boxes[1]!, ROD_MASK[face]!, out, look);
      return;
    }
    this.box(volume, i, cell, x, y, z, boxes[0]!, ALL, out, look);
    if (state & PISTON_EXTENDED) this.box(volume, i, cell, x, y, z, ROD_IN[face]!, ROD_MASK[face]!, out, look);
  }

  /** Stages a flat quad on top of the cell at height h over [x0, x1] × [z0, z1]; the image's u runs along X, or along Z unless `alongX`. */
  private flat(x: number, y: number, z: number, x0: number, z0: number, x1: number, z1: number, h: number, alongX: boolean, sky: number, block: number) {
    for (let k = 0; k < 4; k++) {
      const lx = DU[k] ? x1 : x0, lz = DV[k] ? z0 : z1;
      QX[k] = x + lx;
      QY[k] = y + h;
      QZ[k] = z + lz;
      // The dust line texture runs along u (rows 6–9).
      QU[k] = alongX ? lx : lz;
      QV[k] = alongX ? lz : lx;
      QS[k] = sky;
      QB[k] = block;
      QA[k] = 1;
      QF[k] = VF_WIRE;
    }
  }

  /**
   * Redstone dust, joined by the shared MC rules (`wireShape`): a lone dot, a straight line, or a dot with arms, plus a
   * strip up the side of a block where it climbs. lt.w carries the power for the shader's dark-to-bright red tint.
   */
  private wire(volume: Volume, i: number, cell: number, x: number, y: number, z: number, out: Builder) {
    const links = wireShape(this.read, x, y, z);
    const power = wirePower(cell >> 8) * 17, sky = volume.sky[i]!, block = volume.block[i]!, line = this.texture(cell, 0), flat = links & 15;
    if (flat && !(flat & 10) || flat && !(flat & 5)) {
      this.flat(x, y, z, 0, 0, 1, 1, LINE_Y, !(flat & 5), sky, block);
      out.add(line, false, power);
    } else {
      this.flat(x, y, z, 0, 0, 1, 1, DOT_Y, false, sky, block);
      out.add(this.texture(cell, 3), false, power);
      for (let dir = 0; dir < 4; dir++) if (flat & 1 << dir) {
        const [x0, z0, x1, z1] = WIRE_HALF[dir]!;
        this.flat(x, y, z, x0, z0, x1, z1, LINE_Y, (dir & 1) === 1, sky, block);
        out.add(line, false, power);
      }
    }
    for (let dir = 0; dir < 4; dir++) if (links & WIRE_UP << dir) {
      // Up the face of the neighbour: that face's corners seen from this cell, pulled 1/4 px off the block.
      const face = FACING_FACE[(dir + 2) % 4], axis = face >> 1, corners = CORNERS[face]!;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!, along = c[axis] ? px(0.25) : 1 - px(0.25);
        QX[k] = x + (axis === 0 ? along : c[0]);
        QY[k] = y + c[1];
        QZ[k] = z + (axis === 2 ? along : c[2]);
        // The line runs up the block: u along the face's vertical axis.
        QU[k] = DV[k]!;
        QV[k] = DU[k]!;
        QS[k] = sky;
        QB[k] = block;
        QA[k] = 0.85;
        QF[k] = VF_WIRE;
      }
      out.add(line, false, power);
    }
  }

  /**
   * Source water and lava: surface at 14/16 unless covered by the same liquid (or ice on water); faces only towards
   * other cells that are neither the same liquid nor opaque. Lava is animated, glows and wobbles slowly.
   */
  private liquid(volume: Volume, i: number, id: number, x: number, y: number, z: number, out: Builder) {
    const { cells, sky, block } = volume, above = cells[i + PA]! & 255, lava = id === B.lava;
    const covered = above === id || !lava && above === B.ice, top = covered ? 1 : px(14), layer = lava ? this.lavaLayer : this.waterLayer, flags = lava ? VF_LAVA : VF_WATER;
    for (let face = 0; face < 6; face++) {
      const n = cells[i + N_OFF[face]!]!;
      if ((n & 255) === id || OPAQUE_CELL[n] || face === 3 && covered) continue;
      const front = i + N_OFF[face]!, corners = CORNERS[face]!, vertical = face === 2 || face === 3;
      for (let k = 0; k < 4; k++) {
        const c = corners[k]!, cy = c[1] ? top : 0;
        QX[k] = x + c[0];
        QY[k] = y + cy;
        QZ[k] = z + c[2];
        QU[k] = DU[k]!;
        QV[k] = vertical ? 1 - DV[k]! : 1 - cy;
        QS[k] = sky[front]!;
        QB[k] = block[front]!;
        QA[k] = FACE_SHADE[face]!;
        QF[k] = flags | (c[1] && !covered ? VF_SURFACE : 0);
      }
      out.add(layer, false);
      // The surface is also seen from below while swimming.
      if (face === 3) out.add(layer, true);
    }
  }
}
