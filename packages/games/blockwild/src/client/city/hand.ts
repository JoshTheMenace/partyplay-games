/**
 * Caper City's first-person hand: the same toy figure other players see (client/game/models.ts `citizen`: a sleeve in
 * the seat's colour ending in a mitten), reaching in from the lower right with whatever is held gripped in its fist.
 * It is the city's own design and its own motion: a bop that winds up and comes down, a lob for things thrown, a munch,
 * a rod held out over the water, a canopy's lines when floating. Survival and creative keep their own hand
 * (client/game/hand.ts); this one only shares its seat on the frame (a small scene drawn over the world).
 */
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, type BufferGeometry, type Object3D } from 'three';
import { I, itemOf } from '../../shared/items';
import { damp } from '../game/interp';
import type { HandPose } from '../game/hand';
import type { ItemModels } from '../game/sprites';

const SKIN = 0xe2b48c, CUFF = 0.82;
/** What the fist is doing with what it holds. */
type Grip = 'bat' | 'lob' | 'food' | 'rod' | 'block' | 'flat';
const gripOf = (id: number): Grip => id === I.bopper ? 'bat' : id === I.fishing_rod ? 'rod' : id === I.cream_pie || id === I.water_balloon || id === I.banana_peel || id === I.smoke_puff ? 'lob'
  : itemOf(id)?.food ? 'food' : id < 256 ? 'block' : 'flat';
const ease = (t: number) => t * t * (3 - 2 * t);

export class CityHand {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(62, 1, 0.05, 10);
  /** The whole arm hangs from `root` (sway and bob), bends at `elbow`, and the fist carries the item on `grip`. */
  private readonly root = new Group();
  private readonly elbow = new Group();
  private readonly grip = new Group();
  private readonly sleeve: MeshBasicMaterial;
  private readonly cuff: MeshBasicMaterial;
  private readonly skin = new MeshBasicMaterial({ color: SKIN });
  private readonly thumb = new MeshBasicMaterial({ color: SKIN });
  private readonly geometries: BufferGeometry[] = [];
  private item: Mesh | null = null;
  private itemId = 0;
  private pendingId = 0;
  private swingT = 1;
  private equipT = 1;
  private swayX = 0;
  private swayY = 0;
  private time = 0;
  private visible = false;
  private readonly shirt = new Color(1, 1, 1);
  private readonly lit = new Color(1, 1, 1);
  /** Set by the city scene: a canopy is open overhead (the hand holds its lines). */
  floating = false;

  constructor(private readonly world: Scene, private readonly main: PerspectiveCamera, private readonly models: ItemModels, shirt: string) {
    this.sleeve = new MeshBasicMaterial();
    this.cuff = new MeshBasicMaterial();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: MeshBasicMaterial, parent: Object3D) => {
      const geometry = new BoxGeometry(w, h, d).translate(x, y, z);
      this.geometries.push(geometry);
      parent.add(new Mesh(geometry, material));
    };
    // A forearm along +y from the elbow: sleeve, a darker cuff, then the mitten with a stub of a thumb.
    box(0.2, 0.46, 0.24, 0, 0.23, 0, this.sleeve, this.elbow);
    box(0.22, 0.07, 0.26, 0, 0.47, 0, this.cuff, this.elbow);
    box(0.18, 0.24, 0.22, 0, 0.62, 0, this.skin, this.elbow);
    box(0.07, 0.11, 0.1, -0.12, 0.6, -0.03, this.thumb, this.elbow);
    this.grip.position.set(0, 0.66, -0.02);
    this.elbow.add(this.grip);
    this.root.add(this.elbow);
    this.scene.add(this.root);
    this.setShirt(shirt);
    // Drawn after the world over a cleared depth buffer, so it never pokes through a wall.
    world.onAfterRender = renderer => {
      if (!this.visible) return;
      const { autoClear } = renderer, { autoReset } = renderer.info;
      renderer.autoClear = renderer.info.autoReset = false;
      renderer.clearDepth();
      renderer.render(this.scene, this.camera);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    };
  }

  /** The scene drawn over the world (screen overlays share it). */
  get overlay(): Object3D { return this.scene; }
  setItem(id: number) {
    if (id === this.pendingId) return;
    this.pendingId = id;
    this.equipT = 0;
  }
  swing() { if (this.swingT > 0.45) this.swingT = 0; }
  setShirt(color: string) { this.shirt.set(color); }

  private apply(id: number) {
    this.itemId = id;
    if (this.item) { this.grip.remove(this.item); this.item = null; }
    const model = id ? this.models.model(id) : null;
    if (!model) return;
    this.item = new Mesh(model.geometry as BufferGeometry, this.models.material(1));
    const grip = gripOf(id);
    // Sprites are a unit square in the xy plane (centred, facing the eye); cubes are unit cubes from their corner.
    // The forearm leans in and away, so what it holds is turned back upright to face the player.
    if (model.cube) { this.item.scale.setScalar(0.3); this.item.position.set(-0.15, 0.04, -0.15); this.item.rotation.set(0.5, 0.5, -0.3); }
    else if (grip === 'bat' || grip === 'rod') {
      // Drawn handle-down from one corner to the other: turned so the head leans over the view, handle in the fist.
      const size = grip === 'rod' ? 0.95 : 0.66;
      this.item.scale.setScalar(size);
      this.item.rotation.set(grip === 'rod' ? 0.1 : 0.35, 0, 0.935);
      this.item.position.set(-0.093 * size, 0.6 * size, 0.02);
    } else { this.item.scale.setScalar(0.42); this.item.position.set(0, 0.2, 0.03); this.item.rotation.set(0.45, 0, -0.3); }
    this.grip.add(this.item);
  }

  update(dt: number, pose: HandPose) {
    this.time += dt;
    this.visible = pose.visible;
    if (!pose.visible) return;
    if (this.camera.aspect !== this.main.aspect) { this.camera.aspect = this.main.aspect; this.camera.updateProjectionMatrix(); }
    const grip = gripOf(this.itemId), slow = grip === 'bat' ? 0.34 : 0.3;
    this.swingT = Math.min(1, this.swingT + dt / slow);
    if (pose.mining && this.swingT >= 1) this.swingT = 0;
    this.equipT = Math.min(1, this.equipT + dt / 0.22);
    if (this.equipT >= 0.5 && this.pendingId !== this.itemId) this.apply(this.pendingId);
    this.swayX += (Math.max(-1, Math.min(1, pose.yawSpeed * 0.08)) - this.swayX) * damp(9, dt);
    this.swayY += (Math.max(-1, Math.min(1, pose.pitchSpeed * 0.08)) - this.swayY) * damp(9, dt);
    // Lit by the world where the player stands.
    const [r, g, b] = pose.light, lr = Math.max(0.12, Math.min(1, r)), lg = Math.max(0.12, Math.min(1, g)), lb = Math.max(0.12, Math.min(1, b));
    this.sleeve.color.copy(this.shirt).multiply(this.lit.setRGB(lr, lg, lb));
    this.cuff.color.copy(this.shirt).multiply(this.lit.setRGB(lr * CUFF, lg * CUFF, lb * CUFF));
    this.skin.color.setHex(SKIN).multiply(this.lit.setRGB(lr, lg, lb));
    this.thumb.color.setHex(SKIN).multiply(this.lit.setRGB(lr * 0.9, lg * 0.9, lb * 0.9));
    if (this.item) this.item.material = this.models.material(Math.max(lr, lg, lb));

    const s = this.swingT < 1 ? this.swingT : 0, dip = Math.sin(this.equipT * Math.PI) * 0.5, bob = pose.bobAmount, phase = pose.bobPhase, breathe = Math.sin(this.time * 1.7) * 0.012;
    // Rest: the elbow off the bottom right corner, forearm leaning in and away.
    let x = 0.6, y = -0.78 - dip, z = -0.98, rx = -0.5, ry = 0.25, rz = 0.3;
    if (this.floating) { x = 0.42; y = -0.42; rx = 0.25; rz = 0.1; }
    else if (pose.eating >= 0) {
      // To the mouth, with a little nibble.
      const lift = ease(Math.min(1, (1 - pose.eating) * 6 + 0.35));
      x = 0.6 - 0.4 * lift; y = -0.78 + 0.2 * lift + Math.abs(Math.sin(this.time * 13)) * 0.03 * lift; rx = -0.5 - 0.35 * lift; rz = 0.3 + 0.55 * lift; ry = 0.25 - 0.5 * lift;
    } else if (grip === 'rod') { rx = -0.95; rz = 0.12; y -= 0.05; }
    if (s > 0) {
      if (grip === 'lob') {
        // An underarm lob: back, then a long swing through.
        const wind = Math.sin(Math.min(1, s / 0.3) * Math.PI / 2), go = s < 0.3 ? 0 : ease((s - 0.3) / 0.7);
        rx += 0.5 * wind - 1.5 * Math.sin(go * Math.PI);
        y += 0.16 * Math.sin(go * Math.PI);
        z -= 0.22 * Math.sin(go * Math.PI);
      } else if (grip === 'rod') rx += -0.7 * Math.sin(s * Math.PI);
      else {
        // A bop: up over the shoulder, then down across the view with a bounce at the bottom.
        const wind = Math.sin(Math.min(1, s / 0.28) * Math.PI / 2), go = s < 0.28 ? 0 : (s - 0.28) / 0.72, hit = go < 0.45 ? ease(go / 0.45) : 1 - 0.25 * Math.sin((go - 0.45) / 0.55 * Math.PI);
        rx += 0.55 * wind - 1.75 * (go > 0 ? hit : 0) * (1 - Math.max(0, go - 0.7) / 0.3);
        rz += 0.35 * (go > 0 ? hit : 0) * (1 - Math.max(0, go - 0.7) / 0.3);
        x -= 0.2 * (go > 0 ? hit : 0) * (1 - Math.max(0, go - 0.7) / 0.3);
        y += 0.12 * wind;
      }
    }
    this.root.position.set(x + Math.sin(phase) * 0.022 * bob - this.swayX * 0.05, y - Math.abs(Math.cos(phase)) * 0.03 * bob + breathe + this.swayY * 0.04, z);
    this.root.rotation.set(0, ry - this.swayX * 0.08, 0);
    this.elbow.rotation.set(rx + this.swayY * 0.06, 0, rz, 'YXZ');
  }

  dispose() {
    this.world.onAfterRender = () => {};
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of [this.sleeve, this.cuff, this.skin, this.thumb]) material.dispose();
  }
}
