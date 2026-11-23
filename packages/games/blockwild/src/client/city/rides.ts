/**
 * Vehicles on screen: code-defined box models, instanced per kind (painted parts take the vehicle's colour, trim keeps
 * its own), with wheels, rotors, a rider on two-wheelers and a flashing light on the Watch's cruisers. Remote vehicles
 * are interpolated between the scenes the server sends; parked ones arrive once a second and are kept in between; the
 * vehicle the local player drives is drawn where their own physics has it.
 */
import { BoxGeometry, Color, DynamicDrawUsage, Euler, Float32BufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paintOf, RIDES } from '../../shared/city/vehicles';
import { RF, type PubRide } from '../../shared/protocol';
import { lerp, lerpAngle } from '../game/interp';

type Light = (x: number, y: number, z: number, out: [number, number, number]) => readonly [number, number, number];
/** A box: size (w, h, l), centre (x right, y up, z back; the nose points down −Z) and a colour (0 = the vehicle's paint). */
type Box = readonly [w: number, h: number, l: number, x: number, y: number, z: number, color: number];
const GLASS = 0x1b2633, DARK = 0x2a2d33, CHROME = 0xb9bfc7, LAMP = 0xfff3c4, TAIL = 0xc62f2a, TYRE = 0x18191c;
/** A four-wheeler: a low body, a glassed cabin under a painted roof, bumpers and lamps. */
function car(w: number, l: number, body: number, cabin: number, cabinL: number, cabinZ: number, extra: readonly Box[] = []): Box[] {
  const h = l / 2, y = 0.3;
  return [
    [w, body, l, 0, y + body / 2, 0, 0], [w - 0.16, cabin, cabinL, 0, y + body + cabin / 2, cabinZ, GLASS], [w - 0.12, 0.09, cabinL + 0.06, 0, y + body + cabin + 0.045, cabinZ, 0],
    [0.1, cabin, 0.12, -(w / 2 - 0.1), y + body + cabin / 2, cabinZ - cabinL / 2 + 0.06, 0], [0.1, cabin, 0.12, w / 2 - 0.1, y + body + cabin / 2, cabinZ - cabinL / 2 + 0.06, 0],
    [0.1, cabin, 0.12, -(w / 2 - 0.1), y + body + cabin / 2, cabinZ + cabinL / 2 - 0.06, 0], [0.1, cabin, 0.12, w / 2 - 0.1, y + body + cabin / 2, cabinZ + cabinL / 2 - 0.06, 0],
    [w + 0.06, 0.16, 0.16, 0, y + 0.12, -h, DARK], [w + 0.06, 0.16, 0.16, 0, y + 0.12, h, DARK],
    [0.34, 0.15, 0.06, -(w / 2 - 0.3), y + body - 0.14, -h - 0.02, LAMP], [0.34, 0.15, 0.06, w / 2 - 0.3, y + body - 0.14, -h - 0.02, LAMP],
    [0.3, 0.13, 0.06, -(w / 2 - 0.28), y + body - 0.14, h + 0.02, TAIL], [0.3, 0.13, 0.06, w / 2 - 0.28, y + body - 0.14, h + 0.02, TAIL], ...extra,
  ];
}
/** A two-wheeler: frame, tank or footboard, seat, bars and a headlamp. */
const bike = (l: number, tank: number): Box[] => [
  [0.2, 0.22, l - 0.5, 0, 0.5, 0, 0], [0.34, tank, 0.6, 0, 0.62 + tank / 2, -0.15, 0], [0.3, 0.1, 0.62, 0, 0.84, 0.4, DARK], [0.62, 0.06, 0.08, 0, 1.08, -l / 2 + 0.42, CHROME],
  [0.08, 0.5, 0.08, 0, 0.85, -l / 2 + 0.4, CHROME], [0.18, 0.16, 0.08, 0, 0.92, -l / 2 + 0.3, LAMP], [0.14, 0.1, 0.06, 0, 0.72, l / 2 - 0.2, TAIL],
];
const SHAPES: readonly (readonly Box[])[] = [
  /* zipster */ [...bike(1.9, 0.18), [0.42, 0.5, 0.06, 0, 0.72, -0.62, 0], [0.4, 0.06, 0.5, 0, 0.42, -0.2, 0]],
  /* pebble */ car(1.8, 3.6, 0.52, 0.5, 1.9, 0.25),
  /* mule */ car(1.9, 4.4, 0.6, 0.56, 1.4, -0.75, [[1.9, 0.34, 0.1, 0, 1.07, 2.15, 0], [0.1, 0.34, 2.0, -0.9, 1.07, 1.15, 0], [0.1, 0.34, 2.0, 0.9, 1.07, 1.15, 0], [1.7, 0.06, 2.0, 0, 0.93, 1.15, DARK]]),
  /* breadbox */ [...car(2.0, 4.6, 0.62, 0.6, 1.1, -1.55), [2.0, 1.25, 3.0, 0, 1.545, 0.75, 0], [1.7, 0.5, 0.05, 0, 1.3, 2.27, 0xe9e6da]],
  /* hopper */ car(1.8, 4.0, 0.54, 0.5, 2.1, 0.2, [[0.5, 0.16, 0.24, 0, 1.52, 0.2, 0xfff6e5], [1.82, 0.12, 2.6, 0, 0.62, 0.1, 0x23232a]]),
  /* comet */ car(1.8, 4.0, 0.42, 0.4, 1.4, 0.35, [[1.7, 0.06, 0.34, 0, 0.98, 1.85, 0], [0.08, 0.2, 0.08, -0.7, 0.86, 1.85, DARK], [0.08, 0.2, 0.08, 0.7, 0.86, 1.85, DARK], [0.5, 0.05, 1.2, 0, 0.74, -1.2, DARK]]),
  /* hornet */ [...bike(2.2, 0.3), [0.26, 0.12, 0.5, 0, 0.9, 0.7, 0], [0.1, 0.1, 0.6, 0.2, 0.4, 0.6, CHROME]],
  /* cruiser */ car(1.9, 4.2, 0.56, 0.5, 2.0, 0.2, [[1.92, 0.2, 1.3, 0, 0.72, 0.2, 0xf1ead6], [1.0, 0.1, 0.3, 0, 1.47, 0.2, DARK]]),
  /* dragonfly */ [[1.9, 1.5, 2.4, 0, 1.25, -0.6, GLASS], [2.0, 0.5, 2.5, 0, 0.6, -0.6, 0], [1.2, 0.22, 2.3, 0, 2.1, -0.4, 0], [0.5, 0.5, 2.6, 0, 1.5, 1.9, 0], [0.12, 0.9, 0.5, 0, 1.9, 3.0, 0],
    [0.1, 0.1, 2.6, -0.95, 0.05, -0.5, CHROME], [0.1, 0.1, 2.6, 0.95, 0.05, -0.5, CHROME], [0.08, 0.36, 0.08, -0.95, 0.2, -1.2, CHROME], [0.08, 0.36, 0.08, 0.95, 0.2, -1.2, CHROME],
    [0.08, 0.36, 0.08, -0.95, 0.2, 0.3, CHROME], [0.08, 0.36, 0.08, 0.95, 0.2, 0.3, CHROME], [0.2, 0.3, 0.2, 0, 2.3, -0.4, DARK]],
  /* jumper */ [[1.1, 1.0, 4.6, 0, 0.95, 0.1, 0], [0.9, 0.5, 1.1, 0, 1.5, -0.5, GLASS], [7.4, 0.12, 1.3, 0, 1.55, -0.3, 0], [2.6, 0.1, 0.8, 0, 1.2, 2.3, 0], [0.12, 0.9, 0.9, 0, 1.75, 2.3, 0],
    [0.7, 0.7, 0.5, 0, 0.95, -2.3, DARK], [0.1, 0.6, 0.1, -0.7, 0.3, -0.9, CHROME], [0.1, 0.6, 0.1, 0.7, 0.3, -0.9, CHROME], [0.24, 0.4, 0.4, -0.7, 0.2, -0.9, TYRE], [0.24, 0.4, 0.4, 0.7, 0.2, -0.9, TYRE], [0.16, 0.3, 0.3, 0, 0.15, 2.2, TYRE]],
  /* clunker */ [[0.08, 0.08, 1.2, 0, 0.62, 0, 0], [0.08, 0.5, 0.08, 0, 0.82, 0.35, 0], [0.3, 0.08, 0.36, 0, 1.08, 0.38, DARK], [0.08, 0.6, 0.08, 0, 0.85, -0.55, CHROME], [0.56, 0.06, 0.08, 0, 1.16, -0.58, CHROME],
    [0.3, 0.22, 0.3, 0, 1.0, -0.86, 0xb5803a], [0.08, 0.34, 0.08, 0, 0.47, 0.6, 0]],
  /* trundler */ [...car(2.4, 7.6, 0.7, 0.2, 1.0, -3.0), [2.4, 1.6, 7.4, 0, 1.8, 0, 0], [2.42, 0.62, 6.6, 0, 1.95, 0.1, GLASS], [2.3, 0.7, 0.06, 0, 1.9, -3.72, GLASS], [1.2, 0.3, 0.06, 0, 2.42, -3.73, 0xfff6e5],
    [2.44, 0.14, 7.2, 0, 1.2, 0, 0xfff6e5], [0.1, 0.62, 0.1, -1.18, 1.95, -1.6, 0], [0.1, 0.62, 0.1, 1.18, 1.95, -1.6, 0], [0.1, 0.62, 0.1, -1.18, 1.95, 0.6, 0], [0.1, 0.62, 0.1, 1.18, 1.95, 0.6, 0]],
  /* squirt */ [...car(2.3, 6.2, 0.75, 0.7, 1.5, -2.1), [2.3, 1.1, 3.8, 0, 1.6, 0.95, 0], [2.32, 0.2, 3.8, 0, 1.25, 0.95, 0xf2c23e], [0.3, 0.14, 4.4, -0.7, 2.3, 0.7, CHROME], [0.3, 0.14, 4.4, 0.7, 2.3, 0.7, CHROME],
    [1.4, 0.08, 0.14, 0, 2.3, -0.9, CHROME], [1.4, 0.08, 0.14, 0, 2.3, 0.2, CHROME], [1.4, 0.08, 0.14, 0, 2.3, 1.3, CHROME], [1.4, 0.08, 0.14, 0, 2.3, 2.4, CHROME], [0.5, 0.4, 0.5, 0, 2.2, 2.7, DARK], [0.9, 0.14, 0.3, 0, 1.86, -2.1, DARK]],
  /* patch */ [...car(2.0, 4.8, 0.62, 0.6, 1.2, -1.55), [2.0, 1.3, 3.1, 0, 1.57, 0.8, 0], [2.02, 0.3, 3.1, 0, 1.3, 0.8, 0xd8403a], [0.5, 0.14, 0.06, 0, 1.9, 2.37, 0xd8403a], [0.14, 0.5, 0.06, 0, 1.9, 2.37, 0xd8403a], [0.9, 0.12, 0.3, 0, 2.28, -0.4, DARK]],
  /* dinghy */ [[1.5, 0.3, 3.0, 0, 0.3, 0, 0], [0.12, 0.34, 3.0, -0.69, 0.6, 0, 0], [0.12, 0.34, 3.0, 0.69, 0.6, 0, 0], [1.5, 0.34, 0.12, 0, 0.6, 1.5, 0], [1.1, 0.34, 0.3, 0, 0.6, -1.55, 0], [1.26, 0.08, 0.3, 0, 0.52, 0.3, 0xb5803a],
    [1.26, 0.08, 0.3, 0, 0.52, -0.7, 0xb5803a], [0.3, 0.5, 0.3, 0, 0.6, 1.72, DARK]],
  /* skipjack */ [[1.9, 0.5, 4.4, 0, 0.35, 0.1, 0], [1.5, 0.5, 0.5, 0, 0.35, -2.3, 0], [1.9, 0.12, 4.6, 0, 0.66, 0, 0xf1ead6], [1.5, 0.5, 0.1, 0, 1.0, -0.7, GLASS], [1.6, 0.3, 1.4, 0, 0.8, 0.8, 0xb5803a], [0.5, 0.7, 0.5, 0, 0.75, 2.3, DARK],
    [0.1, 0.5, 0.1, -0.7, 1.0, -0.65, CHROME], [0.1, 0.5, 0.1, 0.7, 1.0, -0.65, CHROME]],
];
/** Wheel centres per kind (x, z; all at y 0.3), and the spinning parts of the aircraft. */
const wheelsOf = (k: number): readonly (readonly [number, number])[] => {
  const kind = RIDES[k]!;
  return kind.wheels === 4 ? [[-(kind.w / 2 - 0.08), -(kind.l / 2 - 0.75)], [kind.w / 2 - 0.08, -(kind.l / 2 - 0.75)], [-(kind.w / 2 - 0.08), kind.l / 2 - 0.75], [kind.w / 2 - 0.08, kind.l / 2 - 0.75]]
    : kind.wheels === 2 ? [[0, -(kind.l / 2 - 0.3)], [0, kind.l / 2 - 0.3]] : [];
};
const CAP = 48, WHEELS = 220;

function merge(boxes: readonly Box[], painted: boolean): BufferGeometry | null {
  const parts = boxes.filter(box => (box[6] === 0) === painted).map(([w, h, l, x, y, z, hex]) => {
    const geometry = new BoxGeometry(w, h, l).translate(x, y, z), c = new Color(hex || 0xffffff), n = geometry.attributes.position!.count, colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts)!;
  for (const geometry of parts) geometry.dispose();
  return merged;
}

/** A vehicle as drawn this frame. */
export type Shown = { id: number; k: number; x: number; y: number; z: number; yaw: number; pt: number; paint: number; f: number; v: number; spin: number; seen: number; lot?: number };

/** Past the range the server lists parked vehicles in (96 blocks): one this far is forgotten. */
const FAR = 120;
/** How long without a parked list before the screen asks for one (the server sends one a second unasked). */
const ASK_MS = 2500;

export class Rides {
  /** Every vehicle drawn, by id. */
  readonly shown = new Map<number, Shown>();
  /** Vehicles within reach of the crosshair (ids are the server's entity ids). */
  readonly reach: { id: number; box: [number, number, number, number, number, number] }[] = [];
  private readonly paint: (InstancedMesh | null)[] = [];
  private readonly trim: (InstancedMesh | null)[] = [];
  private readonly wheels: InstancedMesh;
  private readonly rotors: InstancedMesh;
  private readonly riders: InstancedMesh;
  private readonly beacons: InstancedMesh;
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** Unlit, so the cruiser's lights show at night. */
  private readonly lit = new MeshBasicMaterial({ color: 0xffffff });
  private readonly m = new Matrix4();
  private readonly local = new Matrix4();
  private readonly out = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly color = new Color();
  private readonly rgb: [number, number, number] = [1, 1, 1];
  private time = 0;
  /** Counts the parked lists taken (see `park`), and when the last one came (ms). */
  private lot = 0;
  private listAt = -Infinity;

  constructor(private readonly parent: Object3D, private readonly light: Light) {
    const instanced = (geometry: BufferGeometry, count: number, material: Material = this.material) => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
      parent.add(mesh);
      return mesh;
    };
    SHAPES.forEach((boxes, k) => {
      const painted = merge(boxes, true), fixed = merge(boxes, false);
      this.paint[k] = painted && instanced(painted, CAP);
      this.trim[k] = fixed && instanced(fixed, CAP);
    });
    this.wheels = instanced(merge([[0.24, 0.6, 0.6, 0, 0, 0, TYRE], [0.26, 0.24, 0.24, 0, 0, 0, CHROME]], false)!, WHEELS);
    // A rotor (two crossed blades) for the helicopter, reused small as the plane's propeller.
    this.rotors = instanced(merge([[7.2, 0.06, 0.34, 0, 0, 0, DARK], [0.34, 0.06, 7.2, 0, 0, 0, DARK]], false)!, 24);
    this.riders = instanced(merge([[0.42, 0.5, 0.26, 0, 1.3, 0.25, 0x3a3f4a], [0.36, 0.36, 0.36, 0, 1.76, 0.2, 0xd8403a], [0.12, 0.44, 0.14, -0.26, 1.2, -0.05, 0x3a3f4a], [0.12, 0.44, 0.14, 0.26, 1.2, -0.05, 0x3a3f4a],
      [0.16, 0.5, 0.2, -0.14, 0.8, 0.3, 0x2b3f73], [0.16, 0.5, 0.2, 0.14, 0.8, 0.3, 0x2b3f73]], false)!, 24);
    this.beacons = instanced(new BoxGeometry(0.4, 0.16, 0.26), 32, this.lit);
  }

  /**
   * Parked vehicles are sent once a second, in a snapshot a slow screen may never be drawing between, so they are
   * taken here as each scene arrives. A scene that lists any lists every one in range: it replaces the last list.
   */
  park(rides: readonly PubRide[] | undefined) {
    if (!rides?.some(ride => ride.f & RF.ASLEEP)) return;
    this.lot++;
    this.listAt = performance.now();
    for (const ride of rides) if (ride.f & RF.ASLEEP) this.shown.set(ride.id, Object.assign(this.shown.get(ride.id) ?? { spin: 0 }, { id: ride.id, k: ride.k, x: ride.x, y: ride.y, z: ride.z, yaw: ride.yaw, pt: ride.pt ?? 0, paint: ride.paint, f: ride.f, v: 0, seen: this.time, lot: this.lot }));
  }

  /**
   * No parked list for a while (a screen too slow to catch the one a second, or a street with nothing parked): the
   * input says so (IF.PARKED) and the server puts the list in its next scene.
   */
  get asking() { return performance.now() - this.listAt > ASK_MS; }

  /**
   * Take this frame's moving vehicles from the two scenes the interpolator brackets (the parked ones: see `park`).
   * `own`: the vehicle the local player drives; `eye`: where the screen is looking from.
   */
  update(dt: number, a: readonly PubRide[] | undefined, b: readonly PubRide[] | undefined, alpha: number, own: Shown | null, eye: Vector3) {
    this.time += dt;
    const now = this.time, older = new Map((a ?? []).map(ride => [ride.id, ride]));
    for (const ride of b ?? []) {
      if (ride.id === own?.id) continue;
      const old = older.get(ride.id) ?? ride;
      let shown = this.shown.get(ride.id);
      if (!shown) this.shown.set(ride.id, shown = { id: ride.id, k: ride.k, x: ride.x, y: ride.y, z: ride.z, yaw: ride.yaw, pt: 0, paint: ride.paint, f: ride.f, v: 0, spin: 0, seen: now });
      Object.assign(shown, { k: ride.k, x: lerp(old.x, ride.x, alpha), y: lerp(old.y, ride.y, alpha), z: lerp(old.z, ride.z, alpha), yaw: lerpAngle(old.yaw, ride.yaw, alpha), pt: lerp(old.pt ?? 0, ride.pt ?? 0, alpha), paint: ride.paint, f: ride.f, v: ride.v, seen: now });
    }
    if (own) this.shown.set(own.id, Object.assign(this.shown.get(own.id) ?? own, own, { seen: now }));
    const counts = SHAPES.map(() => 0);
    let wheels = 0, rotors = 0, riders = 0, beacons = 0;
    this.reach.length = 0;
    for (const [id, ride] of this.shown) {
      // A parked vehicle stays until a newer list leaves it out or it is far behind; a moving one is in every scene
      // (the grace covers the second between a vehicle stopping and the next parked list).
      if (ride.f & RF.ASLEEP ? ride.lot !== this.lot || Math.hypot(ride.x - eye.x, ride.z - eye.z) > FAR : now - ride.seen > 1.3) { this.shown.delete(id); continue; }
      const kind = RIDES[ride.k], n = counts[ride.k]!;
      if (!kind || n >= CAP) continue;
      counts[ride.k] = n + 1;
      ride.spin += ride.v * dt / 0.3;
      const lit = this.light(ride.x, ride.y + 1, ride.z, this.rgb), l0 = Math.max(0.08, lit[0]), l1 = Math.max(0.08, lit[1]), l2 = Math.max(0.08, lit[2]);
      this.m.compose(this.v.set(ride.x, ride.y, ride.z), this.q.setFromEuler(this.e.set(ride.pt, ride.yaw, 0)), this.one);
      const paint = this.color.setHex(paintOf(ride.k, ride.paint));
      paint.setRGB(paint.r * l0, paint.g * l1, paint.b * l2);
      this.paint[ride.k]?.setMatrixAt(n, this.m);
      this.paint[ride.k]?.setColorAt(n, paint);
      this.trim[ride.k]?.setMatrixAt(n, this.m);
      this.trim[ride.k]?.setColorAt(n, this.color.setRGB(l0, l1, l2));
      const part = (mesh: InstancedMesh, at: number, x: number, y: number, z: number, rx: number, ry: number, scale = 1) => {
        if (at >= mesh.instanceMatrix.count) return;
        this.local.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, 0)), this.one);
        if (scale !== 1) this.local.scale(this.v.set(scale, scale, scale));
        mesh.setMatrixAt(at, this.out.multiplyMatrices(this.m, this.local));
        mesh.setColorAt(at, this.color.setRGB(l0, l1, l2));
      };
      for (const [x, z] of wheelsOf(ride.k)) part(this.wheels, wheels++, x, 0.3, z, -ride.spin, 0);
      const busy = (ride.f & (RF.DRIVEN | RF.TRAFFIC)) !== 0;
      if (kind.air === 'heli') part(this.rotors, rotors++, 0, 2.5, -0.4, 0, busy ? now * 22 : 0.5);
      if (kind.air === 'plane') part(this.rotors, rotors++, 0, 0.95, -2.62, Math.PI / 2, busy ? now * 30 : 0.4, 0.22);
      if ((kind.wheels === 2 || kind.sea) && busy) part(this.riders, riders++, 0, kind.sea ? -0.55 : 0, kind.sea ? 0.4 : 0, 0, 0);
      if (ride.f & RF.SIREN && beacons < 31) {
        const high = (kind.h > 2 ? kind.h - 0.3 : 1.55), back = kind.h > 2 ? -kind.l / 2 + 1.4 : 0.2;
        // Red and blue by turns.
        for (const side of [-1, 1]) {
          this.local.compose(this.v.set(side * 0.28, high, back), this.q.identity(), this.one);
          this.beacons.setMatrixAt(beacons, this.out.multiplyMatrices(this.m, this.local));
          this.beacons.setColorAt(beacons++, Math.floor(now * 5) % 2 === (side > 0 ? 0 : 1) ? this.color.setHex(side > 0 ? 0xff3a3a : 0x3a6bff) : this.color.setHex(0x15171c));
        }
      }
      if (ride.id !== own?.id && (ride.x - eye.x) ** 2 + (ride.z - eye.z) ** 2 < 144) {
        const r = Math.max(kind.w, kind.l) / 2 * 0.86;
        this.reach.push({ id, box: [ride.x - r, ride.y, ride.z - r, ride.x + r, ride.y + Math.min(kind.h, 1.9), ride.z + r] });
      }
    }
    const done = (mesh: InstancedMesh | null | undefined, count: number) => { if (!mesh) return; mesh.count = Math.min(count, mesh.instanceMatrix.count); mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; };
    SHAPES.forEach((_, k) => { done(this.paint[k], counts[k]!); done(this.trim[k], counts[k]!); });
    done(this.wheels, wheels);
    done(this.rotors, rotors);
    done(this.riders, riders);
    done(this.beacons, beacons);
  }

  /** The nearest vehicle to (x, z) within `range` other than `skip`. */
  nearest(x: number, z: number, range: number, skip = 0): Shown | null {
    let best: Shown | null = null, bestD = range;
    for (const ride of this.shown.values()) { const d = Math.hypot(ride.x - x, ride.z - z) - Math.max(RIDES[ride.k]!.w, RIDES[ride.k]!.l) / 2; if (ride.id !== skip && d < bestD) { best = ride; bestD = d; } }
    return best;
  }

  dispose() {
    for (const mesh of [...this.paint, ...this.trim, this.wheels, this.rotors, this.riders, this.beacons]) if (mesh) { this.parent.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); }
    this.material.dispose();
    this.lit.dispose();
  }
}
