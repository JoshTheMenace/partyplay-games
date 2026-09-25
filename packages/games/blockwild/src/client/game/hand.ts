/**
 * First-person viewmodel, MC style. It lives in its own scene with a fixed 70° camera and is drawn after the world
 * over a cleared depth buffer, so it never clips into walls or the near plane and ignores the sprint FOV kick.
 * The empty hand is a textured arm (skin plus a sleeve in the player's colour); held items use MC's first-person
 * transforms. Poses follow MC's ItemInHandRenderer: swing, mining loop, equip dip, eating and bow draw, plus walk
 * bob and a little look lag. Everything is lit by the world light where the player stands.
 */
import { BoxGeometry, Color, DataTexture, Matrix4, Mesh, NearestFilter, Object3D, PerspectiveCamera, RGBAFormat, Scene, ShaderMaterial, SRGBColorSpace, type BufferGeometry, type Texture } from 'three';
import { I } from '../../shared/items';
import { hash } from '../art/pixels';
import { damp } from './interp';
import type { ItemModels } from './sprites';

const SWING_SECONDS = 0.3, EQUIP_SECONDS = 0.2, EAT_TICKS = 32, DEG = Math.PI / 180;
const SKIN = [0xb88467, 0xc48f70, 0xcc9878], SLEEVE_ROWS = 7;

export type HandPose = {
  mining: boolean; eating: number; drawing: number; bobPhase: number; bobAmount: number;
  yawSpeed: number; pitchSpeed: number; light: readonly [number, number, number]; visible: boolean;
};

const VERTEX = /* glsl */`
varying vec2 vUv; varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = /* glsl */`
uniform sampler2D map; uniform vec3 light;
varying vec2 vUv; varying vec3 vNormal;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  // MC-like item lighting in view space: a key light from the upper left front, undersides darkest.
  vec3 n = normalize(vNormal);
  float shade = 0.5 + 0.5 * max(dot(n, vec3(-0.36, 0.75, 0.55)), 0.0) + 0.12 * max(dot(n, vec3(0.5, 0.3, -0.8)), 0.0);
  gl_FragColor = vec4(t.rgb * light * min(shade, 1.0), 1.0);
  #include <colorspace_fragment>
}`;

/** Chainable pose-stack helper (MC's PoseStack: every call post-multiplies). */
class Pose {
  readonly m = new Matrix4();
  private readonly t = new Matrix4();
  reset() { this.m.identity(); return this; }
  move(x: number, y: number, z: number) { this.m.multiply(this.t.makeTranslation(x, y, z)); return this; }
  rx(deg: number) { this.m.multiply(this.t.makeRotationX(deg * DEG)); return this; }
  ry(deg: number) { this.m.multiply(this.t.makeRotationY(deg * DEG)); return this; }
  rz(deg: number) { this.m.multiply(this.t.makeRotationZ(deg * DEG)); return this; }
  scale(x: number, y = x, z = x) { this.m.multiply(this.t.makeScale(x, y, z)); return this; }
}

/** 4×16 arm skin: rows 0–3 the end caps, rows 4–15 the side from the shoulder (sleeve) to the fist. */
function paintArm(data: Uint8Array, shirt: Color) {
  const sleeve = shirt.clone().convertLinearToSRGB();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) {
    const i = (y * 4 + x) * 4, n = hash(x, y, 41), inSleeve = y >= 4 && y < 4 + SLEEVE_ROWS;
    if (inSleeve) {
      // Sleeve with a darker hem where it meets the skin.
      const f = (y === 3 + SLEEVE_ROWS ? 0.72 : 0.9 + n * 0.14) * 255;
      data[i] = Math.min(255, sleeve.r * f); data[i + 1] = Math.min(255, sleeve.g * f); data[i + 2] = Math.min(255, sleeve.b * f);
    } else {
      const c = SKIN[Math.floor(n * 2.99)]!;
      data[i] = c >> 16; data[i + 1] = c >> 8 & 255; data[i + 2] = c & 255;
    }
    data[i + 3] = 255;
  }
}

export class Hand {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.05, 10);
  private readonly light = { value: new Color(1, 1, 1) };
  private readonly armData = new Uint8Array(4 * 16 * 4);
  private readonly armTexture = new DataTexture(this.armData, 4, 16, RGBAFormat);
  private readonly armGeometry: BoxGeometry;
  private readonly armMaterial: ShaderMaterial;
  private readonly itemMaterial: ShaderMaterial;
  /** Arm: `holder` carries the MC pose, `shoulder` the arm pivot and its idle sway. */
  private readonly holder = new Object3D();
  private readonly shoulder = new Object3D();
  private readonly arm: Mesh;
  private readonly itemHolder = new Object3D();
  private item: Mesh | null = null;
  private itemId = 0;
  private cube = false;
  private swingT = 1;
  private equipT = 1;
  private pendingId = 0;
  private swayX = 0;
  private swayY = 0;
  private time = 0;
  private visible = false;
  private readonly pose = new Pose();
  private readonly shirt = new Color(1, 1, 1);

  constructor(private readonly world: Scene, private readonly main: PerspectiveCamera, private readonly models: ItemModels, shirt: string) {
    const material = (map: Texture) => new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { map: { value: map }, light: this.light } });
    this.armTexture.magFilter = this.armTexture.minFilter = NearestFilter;
    this.armTexture.colorSpace = SRGBColorSpace;
    this.armMaterial = material(this.armTexture);
    this.itemMaterial = material(models.sheet.texture);
    // MC's right arm: a 4×12×4 px box hanging from its pivot at (-5, 2, 0) px, in model space (y runs to the fist).
    this.armGeometry = new BoxGeometry(4 / 16, 12 / 16, 4 / 16).translate(-1 / 16, 4 / 16, 0);
    const uv = this.armGeometry.getAttribute('uv');
    for (let v = 0; v < uv.count; v++) {
      const side = (v >> 2) !== 2 && (v >> 2) !== 3;
      uv.setY(v, side ? 0.25 + uv.getY(v) * 0.75 : uv.getY(v) * 0.25);
    }
    this.arm = new Mesh(this.armGeometry, this.armMaterial);
    this.shoulder.position.set(-5 / 16, 2 / 16, 0);
    this.shoulder.add(this.arm);
    this.holder.add(this.shoulder);
    for (const node of [this.holder, this.itemHolder]) { node.matrixAutoUpdate = false; this.scene.add(node); }
    this.setShirt(shirt);
    // Draw after the world: keep its colour, clear its depth, render the viewmodel on top (adding to the frame's stats).
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

  /** The viewmodel scene, drawn over the world with its own camera: screen overlays (flames, portal swirl) go here too. */
  get overlay(): Object3D { return this.scene; }

  /** Change the held item (with the MC equip dip). */
  setItem(id: number) {
    if (id === this.pendingId) return;
    this.pendingId = id;
    this.equipT = 0;
  }
  swing() { this.swingT = this.swingT > 0.5 ? 0 : this.swingT; }

  private applyItem(id: number) {
    this.itemId = id;
    if (this.item) { this.itemHolder.remove(this.item); this.item = null; }
    const model = id ? this.models.model(id) : null;
    this.holder.visible = !model;
    if (!model) return;
    if (!model.geometry.getAttribute('normal')) model.geometry.computeVertexNormals();
    this.cube = model.cube;
    this.item = new Mesh(model.geometry as BufferGeometry, this.itemMaterial);
    this.itemHolder.add(this.item);
  }

  update(dt: number, pose: HandPose) {
    this.time += dt;
    this.visible = pose.visible;
    if (!pose.visible) return;
    if (this.camera.aspect !== this.main.aspect) { this.camera.aspect = this.main.aspect; this.camera.updateProjectionMatrix(); }
    this.swingT = Math.min(1, this.swingT + dt / SWING_SECONDS);
    if (pose.mining && this.swingT >= 1) this.swingT = 0;
    this.equipT = Math.min(1, this.equipT + dt / EQUIP_SECONDS);
    if (this.equipT >= 0.5 && this.pendingId !== this.itemId) this.applyItem(this.pendingId);
    this.swayX += (Math.max(-1, Math.min(1, pose.yawSpeed * 0.08)) - this.swayX) * damp(10, dt);
    this.swayY += (Math.max(-1, Math.min(1, pose.pitchSpeed * 0.08)) - this.swayY) * damp(10, dt);
    this.light.value.setRGB(...pose.light);

    const s = this.swingT < 1 ? this.swingT : 0, sq = Math.sqrt(s), equip = Math.sin(this.equipT * Math.PI);
    // View bob (MC bobView) and look lag, shared by the arm and the item.
    const bob = pose.bobAmount * 0.06, phase = pose.bobPhase, p = this.pose.reset();
    p.move(Math.sin(phase) * bob * 0.5, -Math.abs(Math.cos(phase) * bob), 0).rz(Math.sin(phase) * bob * 3).rx(Math.abs(Math.cos(phase - 0.2) * bob) * 5);
    p.rx(-this.swayY * 4).ry(-this.swayX * 4);

    if (!this.item) {
      // renderPlayerArm: a quick down-and-in arc that stays in the lower right corner.
      p.move(-0.3 * Math.sin(sq * Math.PI) + 0.64, 0.4 * Math.sin(sq * Math.PI * 2) - 0.6 - equip * 0.6, -0.4 * Math.sin(s * Math.PI) - 0.72)
        .ry(45).ry(Math.sin(sq * Math.PI) * 70).rz(Math.sin(s * s * Math.PI) * -20)
        .move(-1, 3.6, 3.5).rz(120).rx(200).ry(-135).move(5.6, 0, 0);
      this.holder.matrix.copy(p.m);
      this.shoulder.rotation.z = Math.cos(this.time * 1.8) * 0.05 + 0.05;
      return;
    }
    if (pose.eating >= 0) {
      // applyEatTransform: bring the food to the mouth and bob while chewing.
      const ticks = (1 - pose.eating) * EAT_TICKS, left = ticks / EAT_TICKS, lift = 1 - left ** 27;
      if (left < 0.8) p.move(0, Math.abs(Math.cos(ticks / 4 * Math.PI) * 0.1), 0);
      p.move(lift * 0.6, lift * -0.5, 0).ry(lift * 90).rx(lift * 10).rz(lift * 30);
      p.move(0.56, -0.52 - equip * 0.6, -0.72);
    } else if (pose.drawing >= 0 && this.itemId === I.bow) {
      // Bow draw: pull the bow in and tremble once fully drawn.
      const pull = Math.min(1, (pose.drawing ** 2 + pose.drawing * 2) / 3);
      p.move(0.56, -0.52 - equip * 0.6, -0.72).move(-0.2785682, 0.18344387, 0.15731531).rx(-13.935).ry(35.3).rz(-9.785);
      if (pull >= 1) p.move(0, Math.sin(this.time * 26) * 0.0036, 0);
      p.move(0, 0, pull * 0.04).scale(1, 1, 1 + pull * 0.2).ry(-45);
    } else {
      // Default: swing offset, applyItemArmTransform, applyItemArmAttackTransform.
      p.move(-0.4 * Math.sin(sq * Math.PI), 0.2 * Math.sin(sq * Math.PI * 2), -0.2 * Math.sin(s * Math.PI));
      p.move(0.56, -0.52 - equip * 0.6, -0.72);
      const f = Math.sin(s * s * Math.PI), f1 = Math.sin(sq * Math.PI);
      p.ry(45 + f * -20).rz(f1 * -20).rx(f1 * -80).ry(-45);
    }
    // Item model display transforms (first person, right hand): blocks and flat items.
    if (this.cube) p.ry(45).scale(0.4);
    else p.move(1.13 / 16, 3.2 / 16, 1.13 / 16).ry(-90).rz(25).scale(0.68);
    this.itemHolder.matrix.copy(p.m);
  }

  /** Shirt colour of the local player's sleeve. */
  setShirt(color: string) {
    this.shirt.set(color);
    paintArm(this.armData, this.shirt);
    this.armTexture.needsUpdate = true;
  }

  dispose() {
    this.world.onAfterRender = () => {};
    this.armGeometry.dispose();
    this.armTexture.dispose();
    this.armMaterial.dispose();
    this.itemMaterial.dispose();
  }
}
