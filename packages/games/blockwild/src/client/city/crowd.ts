/**
 * The residents of Caper City on screen. Every resident near the camera is drawn from the shared script
 * (shared/city/people.ts: a pure function of the clock), so the crowd costs no traffic; the few the server has knocked
 * off their script arrive as live tuples and are drawn in place of it. One instanced mesh per body part draws the
 * whole crowd in about a dozen draw calls. The figures are the game's own: toy-like box people in their own clothes.
 */
import { BoxGeometry, Color, DynamicDrawUsage, Euler, Float32BufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type BufferGeometry, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACT, residentAt, type Look, type People, type Pose, type Resident } from '../../shared/city/people';
import { GROUND } from '../../shared/city/plan';
import { CITY_ID, EXTRA_OFFICERS, NS, type PubNpc } from '../../shared/protocol';
import { CHARACTERS, CITY_GUIDE, type Standing } from '../../shared/city/story';

type Light = (x: number, y: number, z: number, out: [number, number, number]) => readonly [number, number, number];
/** A box of a part: size, centre (relative to the part's pivot) and a brightness for its vertices. */
type Piece = readonly [w: number, h: number, d: number, x: number, y: number, z: number, shade?: number];
const MAX = 176, STARS = 3;
/** Pivots (metres above the feet of a figure of height 1.62, before its own scale). */
const HIP = 0.54, SHOULDER = 1.0, NECK = 1.06, LEG_X = 0.115, ARM_X = 0.3;

function part(pieces: readonly Piece[]): BufferGeometry {
  const boxes = pieces.map(([w, h, d, x, y, z, shade = 1]) => {
    const box = new BoxGeometry(w, h, d).translate(x, y, z);
    box.setAttribute('color', new Float32BufferAttribute(new Float32Array(box.attributes.position!.count * 3).fill(shade), 3));
    return box;
  });
  const merged = mergeGeometries(boxes)!;
  for (const box of boxes) box.dispose();
  return merged;
}
const GEOMETRY = {
  torso: () => part([[0.46, 0.5, 0.26, 0, 0.25, 0], [0.4, 0.06, 0.22, 0, -0.02, 0, 0.7]]),
  leg: () => part([[0.19, 0.44, 0.21, 0, -0.22, 0], [0.2, 0.1, 0.27, 0, -0.49, -0.03, 0.32]]),
  sleeve: () => part([[0.13, 0.3, 0.17, 0, -0.13, 0]]),
  hand: () => part([[0.12, 0.2, 0.15, 0, -0.38, 0]]),
  // The face looks down −Z: two eyes, brows of shadow and a mouth.
  head: () => part([[0.42, 0.42, 0.42, 0, 0.21, 0], [0.07, 0.09, 0.02, -0.1, 0.24, -0.215, 0.12], [0.07, 0.09, 0.02, 0.1, 0.24, -0.215, 0.12], [0.14, 0.03, 0.02, 0, 0.1, -0.215, 0.45]]),
  hair1: () => part([[0.46, 0.1, 0.46, 0, 0.41, 0], [0.46, 0.2, 0.08, 0, 0.3, 0.2]]),
  hair2: () => part([[0.47, 0.11, 0.47, 0, 0.41, 0], [0.47, 0.34, 0.1, 0, 0.22, 0.2], [0.06, 0.3, 0.3, -0.215, 0.24, 0.06], [0.06, 0.3, 0.3, 0.215, 0.24, 0.06]]),
  hair3: () => part([[0.46, 0.1, 0.46, 0, 0.41, 0], [0.46, 0.14, 0.08, 0, 0.32, 0.2], [0.18, 0.18, 0.18, 0, 0.5, 0.14]]),
  hat1: () => part([[0.47, 0.11, 0.47, 0, 0.47, 0], [0.34, 0.04, 0.18, 0, 0.44, -0.31, 0.8]]),
  hat2: () => part([[0.5, 0.17, 0.5, 0, 0.5, 0], [0.58, 0.04, 0.58, 0, 0.43, 0, 0.85]]),
  hat3: () => part([[0.38, 0.1, 0.38, 0, 0.47, 0, 0.9], [0.46, 0.22, 0.46, 0, 0.62, 0]]),
  hat4: () => part([[0.7, 0.04, 0.7, 0, 0.44, 0], [0.42, 0.16, 0.42, 0, 0.54, 0, 0.9]]),
  hat5: () => part([[0.47, 0.17, 0.47, 0, 0.46, 0], [0.12, 0.1, 0.12, 0, 0.6, 0, 1.1]]),
  bib: () => part([[0.4, 0.4, 0.03, 0, 0.24, -0.142]]),
  star: () => part([[0.11, 0.11, 0.11, 0, 0, 0]]),
} as const;
type PartKey = keyof typeof GEOMETRY;
const HAIRS: readonly PartKey[] = ['hair1', 'hair2', 'hair3'], HATS: readonly PartKey[] = ['hat1', 'hat2', 'hat3', 'hat4', 'hat5'];
/** An officer's look for extras the roster does not hold, and a passer-by's by number. */
const OFFICER: Look = { skin: 0xe2b48c, hair: 0x2a1d12, cut: 1, top: 0x26386e, legs: 0x1c2648, hat: 1, hatColor: 0x1c2648, bib: 0xe6b93a, scale: 1 };
const EXTRA_TOPS = [0xd8403a, 0x3aa8dc, 0x6cc04f, 0xf2c23e, 0x9b6ee0, 0xe98f4c], EXTRA_SKIN = [0xf3d2b4, 0xc98f62, 0x7d4f2a, 0xe2b48c];

/** One resident as drawn this frame. */
type Figure = { i: number; x: number; y: number; z: number; yaw: number; s: number; act: number; moving: boolean; walk: number; look: Look; scale: number; near: number; blend: number };
type Memory = { x: number; z: number; walk: number; seen: number; liveAt: number };

export class Crowd {
  /** Residents within reach of the crosshair this frame, as targeting boxes (ids from CITY_ID). */
  readonly reach: { id: number; box: [number, number, number, number, number, number] }[] = [];
  private readonly meshes = {} as Record<PartKey, InstancedMesh>;
  private readonly counts = {} as Record<PartKey, number>;
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly glow = new MeshLambertMaterial({ color: 0xffe066, emissive: 0xffc21a, emissiveIntensity: 0.9 });
  private readonly memory = new Map<number, Memory>();
  private readonly figures: Figure[] = [];
  private candidates: number[] = [];
  private scanned = -1;
  private time = 0;
  private readonly pose: Pose = { x: 0, z: 0, yaw: 0, act: 0, hidden: false, moving: false };
  private readonly root = new Matrix4();
  private readonly local = new Matrix4();
  private readonly out = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly color = new Color();
  private readonly rgb: [number, number, number] = [1, 1, 1];
  private readonly colors = new Map<number, Color>();
  /** The people with errands: where each stands (set once the seed is known). */
  guides: readonly Standing[] = [];

  constructor(private readonly parent: Object3D, private readonly people: People, private readonly light: Light) {
    for (const key of Object.keys(GEOMETRY) as PartKey[]) {
      const per = key === 'leg' || key === 'sleeve' || key === 'hand' ? 2 : key === 'star' ? STARS : 1;
      const mesh = new InstancedMesh(GEOMETRY[key](), key === 'star' ? this.glow : this.material, MAX * (key === 'star' ? 1 : per));
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
      this.meshes[key] = mesh;
      parent.add(mesh);
    }
  }

  private lookOf(i: number): Look {
    const resident = this.people.list[i];
    if (resident) return resident.look;
    if (i >= CITY_GUIDE) return CHARACTERS[i - CITY_GUIDE]?.look ?? OFFICER;
    const k = i - this.people.list.length;
    return k >= EXTRA_OFFICERS ? OFFICER : { skin: EXTRA_SKIN[k % 4]!, hair: 0x4a2f18, cut: 1 + k % 3, top: EXTRA_TOPS[k % 6]!, legs: 0x3a3f4a, hat: k % 4 === 0 ? 1 : 0, hatColor: 0x3a3f4a, bib: 0, scale: 1 };
  }
  private tint(hex: number) {
    let color = this.colors.get(hex);
    if (!color) this.colors.set(hex, color = new Color(hex));
    return color;
  }
  private put(key: PartKey, hex: number, lit: readonly number[]) {
    const mesh = this.meshes[key], n = this.counts[key]++;
    if (n >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(n, this.out.multiplyMatrices(this.root, this.local));
    const base = this.tint(hex);
    mesh.setColorAt(n, this.color.setRGB(base.r * lit[0]!, base.g * lit[1]!, base.b * lit[2]!));
  }
  /** A part hanging from a pivot, turned by (rx, rz) about it. */
  private limb(key: PartKey, hex: number, lit: readonly number[], x: number, y: number, z: number, rx = 0, rz = 0, ry = 0) {
    this.local.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(1, 1, 1));
    this.put(key, hex, lit);
  }

  /** The resident nearest the middle of the view within `range`, for the prompt and the talk card. */
  resident(i: number): Resident | undefined { return this.people.list[i]; }
  /** What resident `i` is doing right now (their script's act, or −1 when live). */
  actOf(i: number): number { return this.figures.find(figure => figure.i === i)?.act ?? -1; }

  /**
   * Draw this frame's crowd. `eye`: the camera; `range`: how far figures are drawn; `live`: residents off their script
   * (already interpolated); `watcher`: where the local player stands (figures at rest turn to look).
   */
  update(dt: number, day: number, time: number, eye: Vector3, range: number, live: readonly PubNpc[], watcher: { x: number; z: number } | null) {
    this.time += dt;
    const people = this.people, list = people.list, now = this.time, figures = this.figures, pose = this.pose;
    // Twice a second, find who is anywhere near; every frame, place only those.
    if (Math.floor(now * 2) !== this.scanned) {
      this.scanned = Math.floor(now * 2);
      this.candidates.length = 0;
      const far = (range + 12) ** 2;
      for (const resident of list) {
        residentAt(people, resident, day, time, pose);
        if (!pose.hidden && (pose.x - eye.x) ** 2 + (pose.z - eye.z) ** 2 < far) this.candidates.push(resident.i);
      }
      for (const [i, memory] of this.memory) if (now - memory.seen > 3) this.memory.delete(i);
    }
    figures.length = 0;
    const lives = new Set<number>();
    const add = (i: number, x: number, y: number, z: number, yaw: number, s: number, act: number, moving: boolean, isLive: boolean) => {
      const near = (x - eye.x) ** 2 + (z - eye.z) ** 2;
      if (near > range * range) return;
      let memory = this.memory.get(i);
      if (!memory) this.memory.set(i, memory = { x, z, walk: i * 1.7, seen: now, liveAt: -9 });
      // Just back on the script after being live: glide from where the server left them.
      if (isLive) memory.liveAt = now;
      const blend = isLive ? 1 : Math.min(1, (now - memory.liveAt) / 0.6);
      if (blend < 1) { x = memory.x + (x - memory.x) * Math.min(1, dt * 6); z = memory.z + (z - memory.z) * Math.min(1, dt * 6); }
      const step = Math.hypot(x - memory.x, z - memory.z);
      if (step < 3) memory.walk += step * 3.1;
      memory.x = x;
      memory.z = z;
      memory.seen = now;
      const look = this.lookOf(i);
      figures.push({ i, x, y, z, yaw, s, act, moving: moving || step > dt * 0.4, walk: memory.walk, look, scale: look.scale * 1.06, near, blend });
    };
    for (const npc of live) { lives.add(npc.i); add(npc.i, npc.x, npc.y, npc.z, npc.yaw, npc.s, -1, false, true); }
    // The characters stand where they always stand, day and night.
    this.guides.forEach((at, k) => add(CITY_GUIDE + k, at.x, GROUND, at.z, at.yaw, NS.STAND, ACT.REST, false, false));
    for (const i of this.candidates) {
      if (lives.has(i)) continue;
      residentAt(people, list[i]!, day, time, pose);
      if (!pose.hidden) add(i, pose.x, GROUND, pose.z, pose.yaw, pose.moving ? NS.WALK : NS.STAND, pose.act, pose.moving, false);
    }
    if (figures.length > MAX) { figures.sort((a, b) => a.near - b.near); figures.length = MAX; }
    for (const key of Object.keys(this.counts) as PartKey[]) this.counts[key] = 0;
    for (const key of Object.keys(GEOMETRY) as PartKey[]) this.counts[key] = 0;
    this.reach.length = 0;
    for (const f of figures) this.draw(f, watcher);
    for (const key of Object.keys(GEOMETRY) as PartKey[]) {
      const mesh = this.meshes[key];
      mesh.count = Math.min(this.counts[key], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private draw(f: Figure, watcher: { x: number; z: number } | null) {
    const { look, s } = f, t = this.time + f.i * 0.37, dizzy = s === NS.DIZZY, running = s === NS.FLEE || s === NS.CHASE || s === NS.ANGRY || s === NS.DODGE;
    const lit = this.light(f.x, f.y + 1, f.z, this.rgb), l = [Math.max(0.07, lit[0]), Math.max(0.07, lit[1]), Math.max(0.07, lit[2])];
    // Lying flat on their back with stars overhead, or upright (bobbing a little as they walk).
    const pace = f.moving || running ? 1 : 0, swing = Math.sin(f.walk) * (running ? 1.15 : 0.62) * pace, bob = Math.abs(Math.sin(f.walk)) * 0.04 * pace;
    let yaw = f.yaw, headYaw = 0, headPitch = 0;
    if (!f.moving && !dizzy && watcher && f.near < 400) {
      // At rest they glance at whoever comes close.
      const turn = Math.atan2(-(watcher.x - f.x), -(watcher.z - f.z)) - yaw, d = Math.hypot(watcher.x - f.x, watcher.z - f.z);
      if (d < 5) headYaw = Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(turn), Math.cos(turn))));
    }
    if (s === NS.DODGE) yaw += t * 9;
    this.root.compose(this.v.set(f.x, f.y + bob + (dizzy ? 0.24 : 0), f.z), this.q.setFromEuler(this.e.set(dizzy ? -Math.PI / 2 : running ? -0.16 : 0, yaw, 0)), this.s.set(f.scale, f.scale, f.scale));
    let armL = -swing * 0.85, armR = swing * 0.85, armZ = 0.05 + Math.sin(t * 1.6) * 0.02;
    if (s === NS.FLEE || s === NS.DODGE) { armL = armR = -2.7 + Math.sin(t * 14) * 0.25; armZ = 0.35; }
    else if (s === NS.GRAB || s === NS.ANGRY) { armL = armR = -1.45 + Math.sin(t * 11) * 0.2; }
    else if (s === NS.HAIL) { armR = -2.9 + Math.sin(t * 7) * 0.3; }
    else if (dizzy) { armL = armR = -0.3; armZ = 0.9; }
    else if (f.act === ACT.BUSK) { armL = -1.1 + Math.sin(t * 8) * 0.25; armR = -0.9 + Math.cos(t * 8) * 0.3; headPitch = Math.sin(t * 2) * 0.12; }
    else if (f.act === ACT.ROUND && !f.moving) { armL = armR = -0.9 + Math.sin(t * 5) * 0.3; }
    else if (f.act === ACT.WORK && !f.moving) { armR = -0.5 + Math.sin(t * 1.3) * 0.25; }
    else if (f.act === ACT.LUNCH && !f.moving) { armR = -1.5 + Math.sin(t * 3) * 0.2; }
    else if (!f.moving) headPitch = Math.sin(t * 0.7) * 0.05;
    this.limb('leg', look.legs, l, -LEG_X, HIP, 0, dizzy ? 0.15 : swing);
    this.limb('leg', look.legs, l, LEG_X, HIP, 0, dizzy ? -0.1 : -swing);
    this.limb('torso', look.top, l, 0, HIP, 0);
    if (look.bib) this.limb('bib', look.bib, l, 0, HIP, 0);
    this.limb('sleeve', look.top, l, -ARM_X, SHOULDER, 0, armL, -armZ);
    this.limb('sleeve', look.top, l, ARM_X, SHOULDER, 0, armR, armZ);
    this.limb('hand', look.skin, l, -ARM_X, SHOULDER, 0, armL, -armZ);
    this.limb('hand', look.skin, l, ARM_X, SHOULDER, 0, armR, armZ);
    this.limb('head', look.skin, l, 0, NECK, 0, headPitch, 0, headYaw);
    if (look.cut > 0) this.limb(HAIRS[Math.min(2, look.cut - 1)]!, look.hair, l, 0, NECK, 0, headPitch, 0, headYaw);
    if (look.hat > 0) this.limb(HATS[Math.min(4, look.hat - 1)]!, look.hatColor, l, 0, NECK, 0, headPitch, 0, headYaw);
    if (dizzy) {
      // Three stars circle over the head (which lies towards the back of where they stood).
      const hx = f.x + Math.sin(f.yaw) * 1.3 * f.scale, hz = f.z + Math.cos(f.yaw) * 1.3 * f.scale, mesh = this.meshes.star;
      for (let k = 0; k < STARS; k++) {
        const a = t * 5 + k * Math.PI * 2 / STARS, n = this.counts.star++;
        if (n >= mesh.instanceMatrix.count) break;
        mesh.setMatrixAt(n, this.out.compose(this.v.set(hx + Math.cos(a) * 0.38, f.y + 0.85 + Math.sin(t * 3 + k) * 0.06, hz + Math.sin(a) * 0.38), this.q.setFromEuler(this.e.set(a, a * 1.3, 0)), this.s.set(1, 1, 1)));
      }
    }
    if (f.near < 100) this.reach.push({ id: CITY_ID + f.i, box: dizzy ? [f.x - 0.8, f.y, f.z - 0.8, f.x + 0.8, f.y + 0.6, f.z + 0.8] : [f.x - 0.32, f.y, f.z - 0.32, f.x + 0.32, f.y + 1.72 * f.scale, f.z + 0.32] });
  }

  dispose() {
    for (const mesh of Object.values(this.meshes)) { this.parent.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); }
    this.material.dispose();
    this.glow.dispose();
  }
}
