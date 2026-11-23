/**
 * The loose things of Caper City that are neither a resident, a vehicle nor a block: parachute canopies over floating
 * players, and (as the city grows) feathers, rings, flames and floats. Each kind is one instanced mesh of plain boxes,
 * lit like the crowd, so a street full of them costs a draw call or two.
 */
import { BoxGeometry, Color, DynamicDrawUsage, Euler, Float32BufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type BufferGeometry, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Light = (x: number, y: number, z: number, out: [number, number, number]) => readonly [number, number, number];
/** A box: size, centre and a shade (0..1 of the instance colour; above 1 is a fixed pale trim). */
export type Piece = readonly [w: number, h: number, d: number, x: number, y: number, z: number, shade?: number];
export function pieces(list: readonly Piece[]): BufferGeometry {
  const boxes = list.map(([w, h, d, x, y, z, shade = 1]) => {
    const box = new BoxGeometry(w, h, d).translate(x, y, z);
    box.setAttribute('color', new Float32BufferAttribute(new Float32Array(box.attributes.position!.count * 3).fill(shade), 3));
    return box;
  });
  const merged = mergeGeometries(boxes)!;
  for (const box of boxes) box.dispose();
  return merged;
}
/** One kind of prop: an instanced mesh filled afresh every frame. */
export class Batch {
  readonly mesh: InstancedMesh;
  private n = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly color = new Color();
  constructor(private readonly parent: Object3D, geometry: BufferGeometry, cap: number, material: MeshLambertMaterial) {
    this.mesh = new InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
    parent.add(this.mesh);
  }
  begin() { this.n = 0; }
  put(x: number, y: number, z: number, yaw: number, hex: number, lit: readonly number[], scale = 1, pitch = 0, roll = 0) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.n, this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(pitch, yaw, roll)), this.s.set(scale, scale, scale)));
    this.color.setHex(hex);
    this.mesh.setColorAt(this.n++, this.color.setRGB(this.color.r * lit[0]!, this.color.g * lit[1]!, this.color.b * lit[2]!));
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { this.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

/** A canopy: a shallow dome of five panels in two colours with four lines down to the shoulders. */
const CANOPY: readonly Piece[] = [
  [1.3, 0.12, 1.3, 0, 3.5, 0], [0.7, 0.12, 1.3, -1.0, 3.38, 0, 0.72], [0.7, 0.12, 1.3, 1.0, 3.38, 0, 0.72], [1.3, 0.12, 0.7, 0, 3.38, -1.0, 0.86], [1.3, 0.12, 0.7, 0, 3.38, 1.0, 0.86],
  [0.03, 1.75, 0.03, -0.62, 2.48, -0.5, 4], [0.03, 1.75, 0.03, 0.62, 2.48, -0.5, 4], [0.03, 1.75, 0.03, -0.62, 2.48, 0.5, 4], [0.03, 1.75, 0.03, 0.62, 2.48, 0.5, 4],
];

/** A golden feather: a quill and a vane, small enough to have to look for. */
const FEATHER: readonly Piece[] = [[0.05, 0.5, 0.05, 0, 0.25, 0, 0.8], [0.24, 0.34, 0.04, 0.04, 0.42, 0], [0.16, 0.14, 0.04, 0.02, 0.66, 0, 1.15]];
/** A fishing float: a red cap on a white body with a stalk. */
const FLOAT: readonly Piece[] = [[0.2, 0.14, 0.2, 0, 0.07, 0, 3], [0.2, 0.12, 0.2, 0, 0.2, 0], [0.04, 0.22, 0.04, 0, 0.37, 0, 0.5]];
/** A checkpoint ring's post pair and banner, and a marker that hovers over where something is happening. */
const GATE: readonly Piece[] = [[0.3, 5, 0.3, -5, 2.5, 0, 0.8], [0.3, 5, 0.3, 5, 2.5, 0, 0.8], [10.3, 0.9, 0.2, 0, 5, 0]];
/** A tongue of flame: a fat base tapering up (drawn several to a fire, flickering). */
const FLAME: readonly Piece[] = [[0.9, 0.7, 0.9, 0, 0.35, 0], [0.62, 0.7, 0.62, 0, 1.0, 0, 1.15], [0.34, 0.6, 0.34, 0, 1.6, 0, 1.3]];
/** The Golden Gull: a plump white bird with grey wings, an orange bill and feet (the instance colour is the gold of its sheen). */
const GULL_BIRD: readonly Piece[] = [[0.5, 0.42, 0.7, 0, 0.36, 0], [0.34, 0.34, 0.34, 0, 0.72, -0.3], [0.12, 0.1, 0.22, 0, 0.7, -0.56, 0.75], [0.12, 0.3, 0.6, -0.31, 0.4, 0.05, 0.8], [0.12, 0.3, 0.6, 0.31, 0.4, 0.05, 0.8], [0.08, 0.16, 0.08, -0.12, 0.08, 0, 0.7], [0.08, 0.16, 0.08, 0.12, 0.08, 0, 0.7]];
const MARK: readonly Piece[] = [[0.7, 0.7, 0.7, 0, 0.5, 0], [0.4, 0.4, 0.4, 0, 0, 0, 0.8], [0.2, 0.3, 0.2, 0, -0.3, 0, 0.6]];

export type Floater = { x: number; y: number; z: number; yaw: number; color: string };
/** Things to draw this frame that the scene works out: `gates` are checkpoints ([x, z, yaw, colour]), `marks` hover over events ([x, y, z, colour]). */
export type PropFrame = { floaters: readonly Floater[]; feathers: readonly (readonly [number, number, number])[]; float: readonly [number, number, boolean] | null; gates: readonly (readonly [number, number, number, number])[]; marks: readonly (readonly [number, number, number, number])[];
  /** Fires: [x, z, strength 0..100]. */
  fires: readonly (readonly [number, number, number])[];
  /** The Golden Gull, where it sits or rides: [x, y, z, yaw]. */
  gull: readonly [number, number, number, number] | null };
export class Props {
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly canopies: Batch;
  private readonly feathers: Batch;
  private readonly floats: Batch;
  private readonly gates: Batch;
  private readonly marks: Batch;
  private readonly flames: Batch;
  private readonly gulls: Batch;
  private readonly fire = new MeshLambertMaterial({ vertexColors: true, emissive: 0xff7a1a, emissiveIntensity: 1.4 });
  private readonly glow = new MeshLambertMaterial({ vertexColors: true, emissive: 0xffc21a, emissiveIntensity: 0.55 });
  private readonly rgb: [number, number, number] = [1, 1, 1];
  private readonly tint = new Color();
  private time = 0;

  constructor(parent: Object3D, private readonly light: Light) {
    this.canopies = new Batch(parent, pieces(CANOPY), 24, this.material);
    this.feathers = new Batch(parent, pieces(FEATHER), 40, this.glow);
    this.floats = new Batch(parent, pieces(FLOAT), 2, this.material);
    this.gates = new Batch(parent, pieces(GATE), 4, this.glow);
    this.marks = new Batch(parent, pieces(MARK), 16, this.glow);
    this.flames = new Batch(parent, pieces(FLAME), 40, this.fire);
    this.gulls = new Batch(parent, pieces(GULL_BIRD), 2, this.material);
  }
  private lit(x: number, y: number, z: number) { const l = this.light(x, y, z, this.rgb); return [Math.max(0.1, l[0]), Math.max(0.1, l[1]), Math.max(0.1, l[2])] as const; }

  /** Draw this frame's props. `floaters`: everyone under a canopy (the local player too). */
  update(dt: number, frame: PropFrame) {
    this.time += dt;
    const t = this.time, bright = [1, 1, 1] as const;
    this.canopies.begin();
    for (const f of frame.floaters) this.canopies.put(f.x, f.y + Math.sin(t * 2.2 + f.x) * 0.05, f.z, f.yaw, this.tint.set(f.color).getHex(), this.lit(f.x, f.y + 3, f.z), 1, 0, Math.sin(t * 1.4 + f.z) * 0.06);
    this.canopies.end();
    this.feathers.begin();
    for (const [x, y, z] of frame.feathers) this.feathers.put(x, y + 0.35 + Math.sin(t * 2 + x) * 0.12, z, t * 1.6 + x, 0xffd24a, bright, 1.25, 0, 0.3);
    this.feathers.end();
    this.floats.begin();
    if (frame.float) this.floats.put(frame.float[0], 62.86 + (frame.float[2] ? -0.22 + Math.sin(t * 22) * 0.06 : Math.sin(t * 2.4) * 0.03), frame.float[1], t * 0.3, 0xf1ead6, this.lit(frame.float[0], 64, frame.float[1]));
    this.floats.end();
    this.gates.begin();
    for (const [x, z, yaw, color] of frame.gates) this.gates.put(x, 64, z, yaw, color, bright);
    this.gates.end();
    this.marks.begin();
    for (const [x, y, z, color] of frame.marks) this.marks.put(x, y + Math.sin(t * 3 + x) * 0.25, z, t * 1.2, color, bright, 1.3);
    this.marks.end();
    this.flames.begin();
    for (const [x, z, strength] of frame.fires) for (let k = 0; k < 5; k++) {
      // Five tongues in a ring, each with its own flicker; the fire shrinks as it is put out.
      const a = k * 1.2566 + x, size = (0.5 + strength / 130) * (0.8 + 0.3 * Math.sin(t * (7 + k * 1.3) + k * 2));
      this.flames.put(x + Math.cos(a) * (k ? 1.1 : 0), 64, z + Math.sin(a) * (k ? 1.1 : 0), t * 0.7 + k, k % 2 ? 0xffb02e : 0xff6a1a, bright, size * (k ? 1 : 1.5));
    }
    this.flames.end();
    this.gulls.begin();
    if (frame.gull) this.gulls.put(frame.gull[0], frame.gull[1] + Math.abs(Math.sin(t * 5)) * 0.06, frame.gull[2], frame.gull[3], 0xffe08a, this.lit(frame.gull[0], frame.gull[1] + 1, frame.gull[2]), 0.85, Math.sin(t * 2.5) * 0.1);
    this.gulls.end();
  }
  dispose() {
    for (const batch of [this.canopies, this.feathers, this.floats, this.gates, this.marks, this.flames, this.gulls]) batch.dispose();
    this.fire.dispose();
    this.material.dispose();
    this.glow.dispose();
  }
}
