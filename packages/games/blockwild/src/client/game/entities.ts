/**
 * Remote players, mobs, dropped items and arrows, interpolated between authoritative snapshots (~100 ms behind)
 * and animated from their motion: walk cycles from speed, head look, attack arm raise, creeper swell and flash,
 * hurt flash, sheared sheep, baby scale, shirt tint and name tags; worn armor, villager outfits, the zombified
 * piglin's gold sword, ghast tentacles and faces, flashing primed TNT, flames on burning bodies, glowing fireballs
 * and the small mobs spinning inside spawner cages. Everything is pooled by entity id.
 * Rigs built before their GLB arrived (procedural stand-ins) are swapped for the real model once it loads.
 */
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, Group, Mesh, MeshLambertMaterial, NearestFilter, SRGBColorSpace, Sprite, SpriteMaterial,
  type BufferGeometry, type Material, type Object3D, type PerspectiveCamera, type Scene, type ShaderMaterial,
} from 'three';
import { cellIndex } from '../../shared/coords';
import { I } from '../../shared/items';
import { MOB_TYPES, MS, PF, type PubArrow, type PubItem, type PubMob, type PubPlayer, type View } from '../../shared/protocol';
import type { SharedUniforms } from '../engine/index';
import { flameGeometry, flameMaterial } from './effects';
import { byId, damp, Interpolator, lerp, lerpAngle } from './interp';
import { attach, detach, PROFESSIONS, villagerModel, wearArmor, type Attachment, type ModelKey, type ModelLibrary, type Pivot, type Rig } from './models';
import type { ItemModels } from './sprites';
import type { MobBox } from './targeting';

/** Linear light colour at a point (written into `out`). */
type Light = (x: number, y: number, z: number, out: [number, number, number]) => readonly [number, number, number];

/** Interpolated, animated state shared by players and mobs. */
export type Actor = {
  rig: Rig; seen: number; x: number; y: number; z: number; yaw: number; pitch: number; bodyYaw: number; speed: number;
  walk: number; swingSeen: number; swingAt: number; hurtSeen: number; hurtAt: number; deadAt: number; flags: number; state: number; height: number;
  box: [number, number, number, number, number, number];
};
/**
 * Extras every actor may carry: its model key, attached boxes (armor, outfits; `extraKey` describes them, 0 = none),
 * a held item and flames while burning.
 */
type Extras = { key: ModelKey; extra: Attachment | null; extraKey: number; held: number; heldMesh: Mesh | null; flames: Mesh | null };
type PlayerActor = Actor & Extras & { id: string; tag: Sprite | null; tagDistance: number; name: string; color: string; shirt: number; stepDistance: number };
type MobActor = Actor & Extras & { id: number; t: number };
type ItemVisual = { mesh: Mesh; seen: number; item: number; x: number; y: number; z: number };
/** `box`: a ghast fireball's hit box (about a block wide), so the crosshair can target it and a hit sends it back. */
type ArrowVisual = { root: Object3D; seen: number; k: number; id: number; box: [number, number, number, number, number, number] };
type Mini = { rig: Rig; t: number; x: number; y: number; z: number; scale: number; seen: number };

const SWING_SECONDS = 0.3, HURT_SECONDS = 0.45;
/** Glow lights handed to the engine each frame: up to this many, 7 numbers each (x, y, z, radius, r, g, b). */
export const MAX_GLOWS = 4;
const NO_ARMOR = [0, 0, 0, 0] as const, GOLD = 0xf6c840;
const newExtras = (key: ModelKey): Extras => ({ key, extra: null, extraKey: 0, held: -1, heldMesh: null, flames: null });
/** One number per worn set (item ids < 512), 0 when nothing is worn. */
const armorKey = (worn: readonly number[]) => ((worn[0]! * 512 + worn[1]!) * 512 + worn[2]!) * 512 + worn[3]!;
/** Name tags: world height at mid range, clamped to this many screen pixels; fade near and far; only the nearest few solid. */
const TAG_HEIGHT = 0.3, TAG_MIN_PX = 15, TAG_MAX_PX = 26, TAG_NEAR = [1.2, 2.4], TAG_FAR = [36, 48], TAG_SOLID = 4;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function newActor(rig: Rig, height: number): Actor {
  return { rig, seen: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bodyYaw: 0, speed: 0, walk: Math.random() * 6, swingSeen: -1, swingAt: -1e9, hurtSeen: -1, hurtAt: -1e9, deadAt: 0, flags: 0, state: 0, height, box: [0, 0, 0, 0, 0, 0] };
}

function nameTag(name: string, color: string): Sprite {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  canvas.width = 256;
  canvas.height = 64;
  ctx.font = 'bold 34px Nunito, system-ui, sans-serif';
  const width = Math.min(248, ctx.measureText(name).width + 36);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect((256 - width) / 2, 8, width, 48, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect((256 - width) / 2 + 12, 26, 10, 12);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128 + 8, 33, 210);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Depth-tested, so terrain hides the tag; no depth write, so tags never cut each other.
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthWrite: false, transparent: true }));
  sprite.scale.set(TAG_HEIGHT * 4, TAG_HEIGHT, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** The fireball's glow (soft additive halo) and core (an 8×8 pixel fire charge). */
function fireballMaterials(): [SpriteMaterial, SpriteMaterial] {
  const canvas = (size: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!);
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  const halo = canvas(64, ctx => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,220,120,0.95)');
    g.addColorStop(0.35, 'rgba(255,130,40,0.55)');
    g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const core = canvas(8, ctx => {
    const ramp = ['#3a0d06', '#7a1c0a', '#c2410f', '#f07a1a', '#ffc24a'];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const d = Math.hypot(x - 3.5, y - 3.5);
      if (d > 3.9) continue;
      const speck = (x * 7 + y * 13) % 5;
      ctx.fillStyle = ramp[Math.max(0, Math.min(4, Math.round(4 - d + (speck - 2) * 0.6)))]!;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  core.magFilter = core.minFilter = NearestFilter;
  return [
    new SpriteMaterial({ map: halo, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    new SpriteMaterial({ map: core, transparent: true, alphaTest: 0.5, fog: false }),
  ];
}

export class Entities {
  readonly interp = new Interpolator<View>(100);
  readonly players = new Map<string, PlayerActor>();
  readonly mobs = new Map<number, MobActor>();
  private readonly items = new Map<number, ItemVisual>();
  private readonly arrows = new Map<number, ArrowVisual>();
  private readonly group = new Group();
  private readonly arrowGeometry = [new BoxGeometry(0.04, 0.04, 0.55), new BoxGeometry(0.12, 0.12, 0.08)];
  private readonly arrowMaterials = [new MeshLambertMaterial({ color: 0x8a6a45 }), new MeshLambertMaterial({ color: 0xf0f0f0 })];
  private readonly flameGeometry: BufferGeometry | null;
  private readonly flameMaterial: ShaderMaterial | null;
  private fireballLook: [SpriteMaterial, SpriteMaterial] | null = null;
  private readonly minis = new Map<number, Mini>();
  private generation = 0;
  private time = 0;
  private readonly rgb: [number, number, number] = [1, 1, 1];
  private readonly tagged: PlayerActor[] = [];
  /** This frame's glow lights (see MAX_GLOWS) for `engine.setGlows`. */
  readonly glows = new Float32Array(MAX_GLOWS * 7);
  glowCount = 0;
  /** Called when a remote player lands a footstep (feet position). */
  onStep: (x: number, y: number, z: number) => void = () => {};
  /** Called when a creeper starts its fuse. */
  onFuse: (x: number, y: number, z: number) => void = () => {};
  /** Called every frame for each flying fireball (for its smoke trail). */
  onFireball: (x: number, y: number, z: number, dt: number) => void = () => {};

  /**
   * `loaded` hides entities standing in columns the world has not streamed in yet (no mobs floating over the void).
   * `shared` (the engine's atlas uniforms) enables flames on burning bodies.
   */
  constructor(scene: Scene, private readonly models: ModelLibrary, private readonly itemModels: ItemModels, private readonly light: Light, private readonly loaded: (x: number, z: number) => boolean, private readonly selfId: string | null, shared: SharedUniforms | null = null) {
    scene.add(this.group);
    this.flameGeometry = shared ? flameGeometry() : null;
    this.flameMaterial = shared ? flameMaterial(shared) : null;
  }

  push(view: View, serverTime: number, arrivalMs: number) { this.interp.push(serverTime, view, arrivalMs); }

  /** Interpolated mob and fireball boxes for targeting (live objects; do not keep). The server's `attack` takes either id. */
  *mobBoxes(): Iterable<MobBox> {
    for (const mob of this.mobs.values()) if (!mob.deadAt) yield mob;
    for (const arrow of this.arrows.values()) if (arrow.k === 1) yield arrow;
  }
  /** Boxes of every rendered body (players and mobs), for placement overlap checks. */
  *bodyBoxes(): Iterable<readonly number[]> {
    for (const p of this.players.values()) if (!(p.flags & (PF.DEAD | PF.OFFLINE))) yield p.box;
    for (const m of this.mobs.values()) if (!m.deadAt) yield m.box;
  }

  update(serverNowMs: number, dt: number) {
    this.time += dt;
    this.glowCount = 0;
    this.updateMinis();
    if (!this.interp.sample(serverNowMs)) return;
    const a = this.interp.a!, b = this.interp.b!, t = this.interp.alpha, gen = ++this.generation;
    const olderPlayers = byId(a.players), olderMobs = byId(a.mobs), olderItems = byId(a.items), olderArrows = byId(a.arrows);
    for (const p of b.players) if (p.id !== this.selfId) this.updatePlayer(p, olderPlayers.get(p.id) ?? p, t, dt, gen);
    for (const m of b.mobs) this.updateMob(m, olderMobs.get(m.id) ?? m, t, dt, gen);
    for (const item of b.items) this.updateItem(item, olderItems.get(item.id) ?? item, t, gen);
    for (const arrow of b.arrows) this.updateArrow(arrow, olderArrows.get(arrow.id) ?? arrow, t, gen, dt);
    for (const [id, p] of this.players) if (p.seen !== gen) { this.removeActor(p); p.tag?.material.map?.dispose(); p.tag?.material.dispose(); this.players.delete(id); }
    for (const [id, m] of this.mobs) if (m.seen !== gen) this.fadeMob(id, m);
    for (const [id, item] of this.items) if (item.seen !== gen) { this.group.remove(item.mesh); this.items.delete(id); }
    for (const [id, arrow] of this.arrows) if (arrow.seen !== gen) { this.group.remove(arrow.root); this.arrows.delete(id); }
  }

  /** Common motion: interpolate position, derive speed/walk phase, ease the body towards the head. */
  private move(actor: Actor, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, dt: number) {
    const x = lerp(ax, bx, t), y = lerp(ay, by, t), z = lerp(az, bz, t);
    const moved = actor.seen ? Math.hypot(x - actor.x, z - actor.z) : 0;
    actor.speed += ((dt > 0 ? moved / dt : 0) - actor.speed) * damp(10, dt);
    if (actor.speed < 0.05) actor.speed = 0;
    actor.walk += moved * 2.6;
    actor.x = x;
    actor.y = y;
    actor.z = z;
    return moved;
  }
  private place(actor: Actor, scale: number) {
    const root = actor.rig.root;
    root.position.set(actor.x, actor.y, actor.z);
    root.rotation.set(0, actor.bodyYaw, 0, 'YXZ');
    root.scale.setScalar(scale);
  }
  private tint(actor: Actor, shirt: number | null, flash = 0) {
    const hurt = Math.max(0, 1 - (this.time - actor.hurtAt) / HURT_SECONDS);
    const [r, g, b] = this.light(actor.x, actor.y + actor.height * 0.7, actor.z, this.rgb);
    for (const { material, base, shirt: isShirt } of actor.rig.materials) {
      if (isShirt && shirt !== null) material.color.setHex(shirt);
      else material.color.copy(base);
      material.color.r *= Math.max(0.06, r);
      material.color.g *= Math.max(0.06, g);
      material.color.b *= Math.max(0.06, b);
      material.color.g *= 1 - hurt * 0.55;
      material.color.b *= 1 - hurt * 0.55;
      material.emissive.setRGB(hurt * 0.5 + flash, flash, flash);
    }
  }
  private triggers(actor: Actor, swing: number, hurt: number) {
    if (actor.swingSeen >= 0 && swing !== actor.swingSeen) actor.swingAt = this.time;
    if (actor.hurtSeen >= 0 && hurt !== actor.hurtSeen) actor.hurtAt = this.time;
    actor.swingSeen = swing;
    actor.hurtSeen = hurt;
  }

  /** Swap a stand-in rig for the model that has since loaded (or another model: a villager's profession); attachments are rebuilt. */
  private refreshRig(actor: Actor & Extras, key: ModelKey) {
    if (actor.rig.version === this.models.version && actor.key === key) return false;
    actor.key = key;
    const children = actor.rig.root.children.slice(1);
    this.removeActor(actor);
    actor.rig = this.models.instance(key);
    // Keep what rides on the root (the name tag, flames).
    for (const child of children) actor.rig.root.add(child);
    this.group.add(actor.rig.root);
    actor.extra = null;
    actor.extraKey = 0;
    actor.held = -1;
    actor.heldMesh = null;
    return true;
  }
  /** Replace the attached boxes (call only when their description `key` changed). */
  private outfit(actor: Actor & Extras, key: number, extra: Attachment | null) {
    detach(actor.rig, actor.extra);
    actor.extra = extra;
    actor.extraKey = key;
  }
  /** Flames around a burning body (w × h box, unscaled), plus a warm glow on the ground around it. */
  private burning(actor: Actor & Extras, on: boolean, w: number, h: number) {
    if (actor.flames) actor.flames.visible = on;
    if (!on || !this.flameGeometry || !this.flameMaterial) return;
    if (!actor.flames) {
      actor.flames = new Mesh(this.flameGeometry, this.flameMaterial);
      actor.flames.renderOrder = 6;
      actor.rig.root.add(actor.flames);
    }
    actor.flames.scale.set(w * 1.15, h * 1.05, w * 1.15);
    this.glow(actor.x, actor.y + h * 0.5, actor.z, 4, 0.55, 0.28, 0.08);
  }
  private glow(x: number, y: number, z: number, radius: number, r: number, g: number, b: number) {
    if (this.glowCount >= MAX_GLOWS) return;
    const o = this.glowCount++ * 7, glows = this.glows;
    glows[o] = x; glows[o + 1] = y; glows[o + 2] = z; glows[o + 3] = radius; glows[o + 4] = r; glows[o + 5] = g; glows[o + 6] = b;
  }

  private updatePlayer(p: PubPlayer, old: PubPlayer, t: number, dt: number, gen: number) {
    let actor = this.players.get(p.id);
    if (!actor) {
      const rig = this.models.instance('player');
      actor = { ...newActor(rig, 1.8), ...newExtras('player'), id: p.id, tag: null, tagDistance: 0, name: '', color: '', shirt: 0xffffff, stepDistance: 0 };
      this.players.set(p.id, actor);
      this.group.add(rig.root);
    }
    this.refreshRig(actor, 'player');
    const armor = p.armor ?? NO_ARMOR, worn = armorKey(armor);
    if (worn !== actor.extraKey) this.outfit(actor, worn, worn ? wearArmor(actor.rig, armor) : null);
    if (actor.name !== p.name || actor.color !== p.color) {
      if (actor.tag) { actor.rig.root.remove(actor.tag); actor.tag.material.map?.dispose(); actor.tag.material.dispose(); }
      actor.tag = nameTag(p.name, p.color);
      actor.rig.root.add(actor.tag);
      actor.name = p.name;
      actor.color = p.color;
      actor.shirt = parseInt(p.color.slice(1), 16) || 0xffffff;
    }
    const firstFrame = !actor.seen;
    const moved = this.move(actor, old.x, old.y, old.z, p.x, p.y, p.z, t, dt);
    actor.seen = gen;
    actor.yaw = lerpAngle(old.yaw, p.yaw, t);
    actor.pitch = lerp(old.pitch, p.pitch, t);
    actor.flags = p.flags;
    this.triggers(actor, p.swing, p.hurt);
    // The body follows the head, lagging up to ~45°, like MC.
    const lag = Math.atan2(Math.sin(actor.yaw - actor.bodyYaw), Math.cos(actor.yaw - actor.bodyYaw));
    actor.bodyYaw = firstFrame ? actor.yaw : actor.bodyYaw + (Math.abs(lag) > 0.8 ? lag - Math.sign(lag) * 0.8 : lag * damp(actor.speed > 0.3 ? 8 : 1.5, dt));
    const sneaking = !!(p.flags & PF.SNEAKING), dead = !!(p.flags & PF.DEAD), sleeping = !!(p.flags & PF.SLEEPING);
    actor.deadAt = dead ? actor.deadAt || this.time : 0;
    const h = sneaking ? 1.5 : 1.8;
    actor.box[0] = actor.x - 0.3; actor.box[1] = actor.y; actor.box[2] = actor.z - 0.3; actor.box[3] = actor.x + 0.3; actor.box[4] = actor.y + h; actor.box[5] = actor.z + 0.3;
    this.place(actor, 1);
    const root = actor.rig.root;
    root.visible = !(p.flags & PF.OFFLINE) && !(dead && this.time - actor.deadAt > 1.4) && this.loaded(actor.x, actor.z);
    if (sleeping) { root.rotation.x = -Math.PI / 2; root.position.y += 0.35; }
    if (dead) root.rotation.z = Math.min(1, (this.time - actor.deadAt) / 0.45) * Math.PI / 2;
    this.animateHumanoid(actor, sneaking, !!(p.flags & PF.USING), false);
    if (actor.tag) {
      actor.tag.visible = !sneaking && !dead;
      actor.tag.position.set(0, sleeping ? 0.8 : 2.15, 0);
    }
    if (p.held !== actor.held) this.setHeld(actor, p.held);
    this.burning(actor, !!(p.flags & PF.BURNING) && root.visible, 0.6, h);
    this.tint(actor, actor.shirt);
    if (actor.heldMesh) actor.heldMesh.material = this.itemModels.material((this.rgb[0] + this.rgb[1] + this.rgb[2]) / 3);
    // Footsteps for remote players walking on the ground.
    if (!(p.flags & PF.FLYING) && Math.abs(p.y - old.y) < 0.2 && !dead) {
      actor.stepDistance += moved;
      if (actor.stepDistance > 1.8) { actor.stepDistance = 0; this.onStep(actor.x, actor.y, actor.z); }
    }
  }

  /** Put an item in the right hand (`gold`: a gold-tinted, light-tinted copy, the zombified piglin's sword). */
  private setHeld(actor: Actor & Extras, item: number, gold = false) {
    actor.held = item;
    const arm = actor.rig.pivots.arm_r;
    if (actor.heldMesh) { actor.heldMesh.parent?.remove(actor.heldMesh); actor.heldMesh = null; }
    const model = item ? this.itemModels.model(item) : null;
    if (!model || !arm) return;
    let material: Material = this.itemModels.material(1);
    if (gold) {
      const tinted = new MeshLambertMaterial({ map: this.itemModels.sheet.texture, vertexColors: true, alphaTest: 0.5, color: GOLD });
      actor.rig.materials.push({ material: tinted, base: new Color(GOLD), shirt: false });
      material = tinted;
    }
    const mesh = new Mesh(model.geometry, material);
    mesh.scale.setScalar(model.cube ? 0.28 : 0.45);
    mesh.position.set(0, -0.62, -0.12);
    mesh.rotation.set(model.cube ? 0 : -Math.PI / 2 + 0.3, model.cube ? Math.PI / 4 : Math.PI / 2, 0);
    arm.add(mesh);
    actor.heldMesh = mesh;
  }

  private animateHumanoid(actor: Actor, sneaking: boolean, using: boolean, undead: boolean, attacking = false) {
    const { pivots } = actor.rig, amp = Math.min(1, actor.speed / 4.3) * 0.9, swing = Math.sin(actor.walk) * amp;
    const since = this.time - actor.swingAt, swingT = since < SWING_SECONDS ? Math.sin(since / SWING_SECONDS * Math.PI) : 0;
    if (pivots.leg_l) pivots.leg_l.rotation.x = swing;
    if (pivots.leg_r) pivots.leg_r.rotation.x = -swing;
    if (pivots.arm_l) pivots.arm_l.rotation.set(undead ? Math.PI / 2 : -swing * 0.8, using ? 0.35 : 0, 0);
    if (pivots.arm_r) pivots.arm_r.rotation.set(undead ? Math.PI / 2 + swingT * 0.6 : swing * 0.8 + swingT * 1.5 + (using ? 1.2 : 0), -swingT * 0.3, 0);
    if (attacking && pivots.arm_r && pivots.arm_l) {
      pivots.arm_r.rotation.x = Math.PI / 2 + Math.sin(this.time * 12) * 0.25;
      pivots.arm_l.rotation.x = Math.PI / 2 - Math.sin(this.time * 12) * 0.25;
    }
    if (pivots.head) pivots.head.rotation.set(actor.pitch, actor.yaw - actor.bodyYaw, 0, 'YXZ');
    if (pivots.body) pivots.body.rotation.x = sneaking ? -0.4 : 0;
    actor.rig.root.children[0]!.position.y = sneaking ? -0.15 : 0;
  }

  private updateMob(m: PubMob, old: PubMob, t: number, dt: number, gen: number) {
    const type = MOB_TYPES[m.t] ?? MOB_TYPES[0], key = type.key === 'villager' ? villagerModel(m.p ?? 0) : type.key;
    let actor = this.mobs.get(m.id);
    if (!actor) {
      const rig = this.models.instance(key);
      actor = { ...newActor(rig, type.h), ...newExtras(key), id: m.id, t: m.t };
      this.mobs.set(m.id, actor);
      this.group.add(rig.root);
    }
    this.refreshRig(actor, key);
    const firstFrame = !actor.seen;
    this.move(actor, old.x, old.y, old.z, m.x, m.y, m.z, t, dt);
    actor.seen = gen;
    actor.deadAt = 0;
    actor.yaw = lerpAngle(old.yaw, m.yaw, t);
    actor.bodyYaw = firstFrame ? actor.yaw : lerpAngle(actor.bodyYaw, actor.yaw, damp(10, dt));
    if (m.a === 3 && actor.state !== 3 && !firstFrame) this.onFuse(actor.x, actor.y, actor.z);
    actor.state = m.a;
    this.triggers(actor, 0, m.hurt);
    const baby = !!((m.s ?? 0) & MS.BABY), scale = baby ? 0.5 : 1, half = type.w * scale / 2;
    actor.box[0] = actor.x - half; actor.box[1] = actor.y; actor.box[2] = actor.z - half; actor.box[3] = actor.x + half; actor.box[4] = actor.y + type.h * scale; actor.box[5] = actor.z + half;
    this.place(actor, scale);
    actor.rig.root.visible = this.loaded(actor.x, actor.z);
    const { pivots, kind } = actor.rig, amp = Math.min(1, actor.speed / 2.5) * 0.8, phase = actor.walk * 1.3, s = m.s ?? 0;
    let flash = 0, shirt: number | null = null;
    // Stand-in rigs get the profession outfit and the piglin's sword; the GLBs come dressed and armed.
    if (type.key === 'villager' && actor.rig.fallback) {
      const job = PROFESSIONS[m.p ?? 0] ?? PROFESSIONS[0]!, key = 1 + (m.p ?? 0);
      if (key !== actor.extraKey) this.outfit(actor, key, attach(actor.rig, job.pieces));
      shirt = job.robe;
    }
    if (type.key === 'zombified_piglin' && actor.held < 0) {
      if (actor.rig.fallback) this.setHeld(actor, I.iron_sword, true);
      else actor.held = 0;
    }
    if (kind === 'humanoid') this.animateHumanoid(actor, false, false, type.key === 'zombie' || type.key === 'zombified_piglin' && !!(s & MS.ANGRY), m.a === 2 && type.key === 'skeleton');
    else if (kind === 'ghast') {
      // Tentacles sway out of step; the face opens (crying red eyes, open mouth) while charging or firing.
      const shooting = m.a >= 2;
      if (pivots.face_idle) pivots.face_idle.visible = !shooting;
      if (pivots.face_shoot) pivots.face_shoot.visible = shooting;
      for (let i = 0; i < 9; i++) {
        const tentacle = pivots[`leg_${i}` as Pivot];
        if (tentacle) tentacle.rotation.set(0.25 + Math.sin(this.time * 1.7 + i * 1.9) * 0.28, 0, Math.cos(this.time * 1.3 + i * 2.3) * 0.12);
      }
      actor.rig.root.children[0]!.position.y = Math.sin(this.time * 1.1 + m.id) * 0.12;
    } else if (kind === 'block') {
      // Primed TNT: flashes white every quarter second (MC: fuse / 5 even) and swells over its last half second.
      const ticks = m.a * 4, swell = ticks < 10 ? (1 - Math.max(0, ticks) / 10) ** 4 : 0;
      actor.rig.root.rotation.y = 0;
      actor.rig.root.scale.setScalar(scale * (1 + swell * 0.3));
      flash = Math.floor(ticks / 5) % 2 === 0 ? 0.6 : 0;
      if (flash) this.glow(actor.x, actor.y + 0.5, actor.z, 3.5, 0.45, 0.45, 0.4);
    } else if (kind === 'spider') {
      for (let i = 0; i < 8; i++) {
        const leg = pivots[`leg_${i}` as Pivot];
        if (!leg) continue;
        const side = i < 4 ? 1 : -1, p = phase * 1.4 + (i % 2) * Math.PI;
        leg.rotation.set(0, Math.sin(p) * 0.35 * amp * side, (0.3 + Math.abs(Math.cos(p)) * 0.3 * amp) * side);
      }
    } else {
      const swing = Math.sin(phase) * amp;
      for (const [name, sign] of [['leg_fl', 1], ['leg_br', 1], ['leg_fr', -1], ['leg_bl', -1], ['leg_l', 1], ['leg_r', -1]] as const) {
        const leg = pivots[name];
        if (leg) leg.rotation.x = swing * sign;
      }
      if (kind === 'chicken') {
        const flap = Math.abs(m.y - old.y) > 0.01 || actor.speed > 2 ? Math.abs(Math.sin(this.time * 18)) * 1.1 : 0;
        if (pivots.arm_l) pivots.arm_l.rotation.z = -flap;
        if (pivots.arm_r) pivots.arm_r.rotation.z = flap;
      }
      if (pivots.head) pivots.head.rotation.x = m.a === 2 ? 0.3 : Math.sin(this.time * 0.7 + m.id) * 0.08;
      if (pivots.wool) pivots.wool.visible = !((m.s ?? 0) & MS.SHEARED);
      if (kind === 'creeper' && m.a === 3) {
        // Fuse: swell and flash white, faster as it builds.
        const pulse = Math.sin(this.time * 16);
        actor.rig.root.scale.set(scale * (1.08 + pulse * 0.05), scale * (1.02 + pulse * 0.03), scale * (1.08 + pulse * 0.05));
        flash = pulse > 0 ? 0.6 : 0;
      }
    }
    this.burning(actor, !!(s & MS.BURNING) && actor.rig.root.visible, type.w * scale, type.h * scale);
    this.tint(actor, shirt, flash);
  }
  /** A mob missing from the latest snapshot: play its death tip-over if it was hurt recently, then remove it. */
  private fadeMob(id: number, m: MobActor) {
    if (!m.deadAt) m.deadAt = this.time;
    const t = this.time - m.deadAt;
    if (this.time - m.hurtAt > 1 || t > 0.8) {
      this.removeActor(m);
      this.mobs.delete(id);
      return;
    }
    m.rig.root.rotation.z = Math.min(1, t / 0.4) * Math.PI / 2;
    this.tint(m, null);
  }
  private removeActor(actor: Actor) {
    this.group.remove(actor.rig.root);
    this.models.release(actor.rig);
  }

  private updateItem(item: PubItem, old: PubItem, t: number, gen: number) {
    let visual = this.items.get(item.id);
    const model = this.itemModels.model(item.item);
    if (!model) return;
    if (!visual || visual.item !== item.item) {
      if (visual) this.group.remove(visual.mesh);
      const mesh = new Mesh(model.geometry, this.itemModels.material(1));
      mesh.scale.setScalar(model.cube ? 0.25 : 0.4);
      visual = { mesh, seen: 0, item: item.item, x: item.x, y: item.y, z: item.z };
      this.items.set(item.id, visual);
      this.group.add(mesh);
    }
    visual.seen = gen;
    visual.x = lerp(old.x, item.x, t);
    visual.y = lerp(old.y, item.y, t);
    visual.z = lerp(old.z, item.z, t);
    const mesh = visual.mesh, spin = this.time * 1.6 + item.id;
    mesh.position.set(visual.x, visual.y + 0.18 + Math.sin(this.time * 2.2 + item.id) * 0.06, visual.z);
    mesh.visible = this.loaded(visual.x, visual.z);
    mesh.rotation.set(0, spin, 0);
    const [r, g, b] = this.light(visual.x, visual.y + 0.3, visual.z, this.rgb);
    mesh.material = this.itemModels.material((r + g + b) / 3);
  }

  private updateArrow(arrow: PubArrow, old: PubArrow, t: number, gen: number, dt: number) {
    let visual = this.arrows.get(arrow.id);
    const k = arrow.k ?? 0;
    if (visual && visual.k !== k) { this.group.remove(visual.root); visual = undefined; }
    if (!visual) {
      const root = new Group();
      if (k === 1) {
        // Ghast fireball: a pixel fire charge inside an additive glow, always facing the camera.
        const [glow, core] = this.fireballLook ??= fireballMaterials(), halo = new Sprite(glow), ball = new Sprite(core);
        halo.scale.setScalar(1.6);
        ball.scale.setScalar(0.85);
        root.add(halo, ball);
      } else {
        const shaft = new Mesh(this.arrowGeometry[0], this.arrowMaterials[0]), fletch = new Mesh(this.arrowGeometry[1], this.arrowMaterials[1]);
        fletch.position.z = 0.24;
        root.add(shaft, fletch);
      }
      root.rotation.order = 'YXZ';
      visual = { root, seen: 0, k, id: arrow.id, box: [0, 0, 0, 0, 0, 0] };
      this.arrows.set(arrow.id, visual);
      this.group.add(root);
    }
    visual.seen = gen;
    visual.root.position.set(lerp(old.x, arrow.x, t), lerp(old.y, arrow.y, t), lerp(old.z, arrow.z, t));
    if (k === 1) {
      const { x, y, z } = visual.root.position;
      visual.box.splice(0, 6, x - 0.5, y - 0.5, z - 0.5, x + 0.5, y + 0.5, z + 0.5);
      this.glow(x, y, z, 6, 1.1, 0.55, 0.18);
      this.onFireball(x, y, z, dt);
      return;
    }
    const speed = Math.hypot(arrow.vx, arrow.vz);
    // Stuck arrows (no velocity) keep their last orientation.
    if (speed + Math.abs(arrow.vy) > 0.01) visual.root.rotation.set(Math.atan2(arrow.vy, speed), Math.atan2(-arrow.vx, -arrow.vz), 0);
  }

  /**
   * Name tags after the camera has moved: a capped on-screen size, fading within ~2 blocks and beyond ~48,
   * and only the nearest few fully opaque so a crowd stays readable. `viewHeight` is the canvas height in pixels.
   */
  labels(camera: PerspectiveCamera, viewHeight: number) {
    const tagged = this.tagged, c = camera.position;
    tagged.length = 0;
    for (const p of this.players.values()) {
      if (!p.tag?.visible || !p.rig.root.visible) continue;
      p.tagDistance = Math.hypot(p.x - c.x, p.y + p.tag.position.y - c.y, p.z - c.z);
      tagged.push(p);
    }
    tagged.sort((a, b) => a.tagDistance - b.tagDistance);
    const pixel = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, viewHeight);
    tagged.forEach((p, rank) => {
      const d = p.tagDistance, tag = p.tag!, material = tag.material;
      const h = Math.min(TAG_MAX_PX * pixel * d, Math.max(TAG_MIN_PX * pixel * d, TAG_HEIGHT));
      material.opacity = smoothstep(TAG_NEAR[0]!, TAG_NEAR[1]!, d) * (1 - smoothstep(TAG_FAR[0]!, TAG_FAR[1]!, d)) * (rank < TAG_SOLID ? 1 : 0.4);
      tag.visible = material.opacity > 0.02;
      tag.scale.set(h * 4, h, 1);
    });
  }

  /**
   * Spawner cages near the camera, flattened [x, y, z, mob type] per cage: each shows its mob small and spinning
   * (MC: scaled to fit a 0.53-block cube) until it leaves the list.
   */
  setSpawners(list: readonly number[]) {
    const gen = ++this.generation;
    for (let i = 0; i + 3 < list.length; i += 4) {
      const x = list[i]!, y = list[i + 1]!, z = list[i + 2]!, t = list[i + 3]!, key = cellIndex(x, y, z), type = MOB_TYPES[t];
      if (!type) continue;
      let mini = this.minis.get(key);
      if (mini && (mini.t !== t || mini.rig.version !== this.models.version)) { this.removeMini(key, mini); mini = undefined; }
      if (!mini) {
        const rig = this.models.instance(type.key);
        this.minis.set(key, mini = { rig, t, x, y, z, scale: 0.53 / Math.max(1, type.w, type.h), seen: gen });
        this.group.add(rig.root);
      }
      mini.seen = gen;
    }
    for (const [key, mini] of this.minis) if (mini.seen !== gen) this.removeMini(key, mini);
  }
  private updateMinis() {
    for (const [key, mini] of this.minis) {
      const type = MOB_TYPES[mini.t]!, root = mini.rig.root;
      root.position.set(mini.x + 0.5, mini.y + 0.5 - type.h * mini.scale / 2, mini.z + 0.5);
      root.rotation.set(0, this.time * 1.6 + key % 7, 0);
      root.scale.setScalar(mini.scale);
      const [r, g, b] = this.light(mini.x + 0.5, mini.y + 0.5, mini.z + 0.5, this.rgb);
      for (const { material, base } of mini.rig.materials) material.color.setRGB(base.r * Math.max(0.06, r), base.g * Math.max(0.06, g), base.b * Math.max(0.06, b));
    }
  }
  private removeMini(key: number, mini: Mini) {
    this.group.remove(mini.rig.root);
    this.models.release(mini.rig);
    this.minis.delete(key);
  }

  dispose() {
    for (const p of this.players.values()) { this.models.release(p.rig); p.tag?.material.map?.dispose(); p.tag?.material.dispose(); }
    for (const m of this.mobs.values()) this.models.release(m.rig);
    for (const [key, mini] of this.minis) this.removeMini(key, mini);
    for (const g of this.arrowGeometry) g.dispose();
    for (const m of this.arrowMaterials) m.dispose();
    this.flameGeometry?.dispose();
    this.flameMaterial?.dispose();
    for (const m of this.fireballLook ?? []) { m.map?.dispose(); m.dispose(); }
    this.group.removeFromParent();
    this.players.clear();
    this.mobs.clear();
  }
}
