/**
 * Remote players, mobs, dropped items and arrows, interpolated between authoritative snapshots (~100 ms behind)
 * and animated from their motion: walk cycles from speed, head look, attack arm raise, creeper swell and flash,
 * hurt flash, sheared sheep, baby scale, shirt tint and name tags; worn armor, villager outfits, the zombified
 * piglin's gold sword, ghast tentacles and faces, flashing primed TNT, flames on burning bodies, glowing fireballs
 * and the small mobs spinning inside spawner cages. Endgame: blazes (spinning rods, smoke, glow), endermen (glowing
 * eyes, a dropping, shaking jaw when angry), silverfish, the Ender Dragon (banking flight, beating jointed wings, a neck
 * and tail that trail the body smoothly, jaw, glowing eyes, death beams and dissolve), end crystals (turning frames and
 * a healing beam to the dragon), blaze and dragon fireballs, eyes of ender and pearls. Everything is pooled by entity id.
 * Rigs built before their GLB arrived (procedural stand-ins) are swapped for the real model once it loads.
 */
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, NearestFilter, SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
  type BufferGeometry, type Material, type Object3D, type PerspectiveCamera, type Scene, type ShaderMaterial,
} from 'three';
import { cellIndex } from '../../shared/coords';
import { I } from '../../shared/items';
import { wrapAngle } from '../../shared/coords';
import { DRAGON_PARTS, DRAGON_PHASE, MOB, MOB_TYPES, MS, PF, PK, type PubArrow, type PubItem, type PubMob, type PubPlayer, type View } from '../../shared/protocol';
import type { SharedUniforms } from '../engine/index';
import { flameGeometry, flameMaterial } from './effects';
import { byId, damp, Interpolator, lerp, lerpAngle } from './interp';
import { attach, detach, PROFESSIONS, villagerModel, wearArmor, type Attachment, type ModelKey, type ModelLibrary, type Pivot, type Rig } from './models';
import type { ItemModels } from './sprites';
import { dragonBoxes, type MobBox } from './targeting';

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
/** The dragon's animation state: eased pitch, bank and wing angles, the trailing tail, its last phase and death time. */
type DragonPose = {
  roll: number; flap: number; wing: number; tip: number; jaw: number; dip: number; lastYaw: number; phase: number; dyingAt: number;
  tailYaw: Float64Array; tailPitch: Float64Array; beams: Group | null;
};
/** `parts`: the dragon's posed hit boxes (attack.part order); `beam`: an end crystal's healing beam. */
type MobActor = Actor & Extras & { id: number; t: number; parts: MobBox[] | null; pose: DragonPose | null; beam: Group | null };
/** Particle and sound hooks for what entities give off each frame (the runtime turns them into particles). */
export type EntityEmit = 'blaze' | 'ender' | 'smallFireball' | 'eye' | 'pearl' | 'acidball' | 'breath' | 'dying' | 'vanish';
/** Dragon moments the runtime turns into sound and screen shake. */
export type DragonCue = 'flap' | 'roar' | 'land';
type ItemVisual = { mesh: Mesh; seen: number; item: number; x: number; y: number; z: number };
/** `box`: a ghast fireball's hit box (about a block wide), so the crosshair can target it and a hit sends it back. */
type ArrowVisual = { root: Object3D; seen: number; k: number; id: number; box: [number, number, number, number, number, number] };
type Mini = { rig: Rig; t: number; x: number; y: number; z: number; scale: number; seen: number };

const SWING_SECONDS = 0.3, HURT_SECONDS = 0.45;
/** The dragon's body centre above its position (protocol mobBoxes), death length, and the crystal heal range. */
const DRAGON_LIFT = 2, DEATH_SECONDS = 8, TAIL = 10, NECK = 5, BEAMS = 14;
const PERCHED = DRAGON_PHASE.PERCHED, DYING = DRAGON_PHASE.DYING, DRAGON_LEGS = ['leg_fl', 'leg_fr', 'leg_bl', 'leg_br'] as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A pivot's rest height (captured the first time it is animated, so bobbing never drifts). */
const restY = (node: Object3D) => (node.userData.restY ??= node.position.y) as number;
const FIRE_LOOK = [['rgba(255,220,120,0.95)', 'rgba(255,130,40,0.55)', 'rgba(255,60,10,0)'], ['#3a0d06', '#7a1c0a', '#c2410f', '#f07a1a', '#ffc24a']] as const;
const ACID_LOOK = [['rgba(255,190,255,0.95)', 'rgba(190,70,255,0.55)', 'rgba(110,20,200,0)'], ['#1e0630', '#4a0f6e', '#8a26c4', '#c860f0', '#f4c0ff']] as const;
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

/** A fireball's glow (soft additive halo) and core (an 8×8 pixel charge) in a palette (fire, or the dragon's acid). */
function fireballMaterials([stops, ramp]: typeof FIRE_LOOK | typeof ACID_LOOK): [SpriteMaterial, SpriteMaterial] {
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
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.35, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const core = canvas(8, ctx => {
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
  private acidLook: [SpriteMaterial, SpriteMaterial] | null = null;
  /** Additive light shafts: the dying dragon's beams and the crystals' healing beams (a faint sheath round a bright core). */
  private readonly beamGeometry = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  private readonly beamMaterials = [0xffd8ff, 0xd070ff, 0xffffff].map(color => new MeshBasicMaterial({ color, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  private readonly scratch = new Vector3();
  private readonly minis = new Map<number, Mini>();
  private generation = 0;
  private time = 0;
  private readonly rgb: [number, number, number] = [1, 1, 1];
  private readonly tagged: PlayerActor[] = [];
  /** This frame's glow lights (see MAX_GLOWS) for `engine.setGlows`. */
  readonly glows = new Float32Array(MAX_GLOWS * 7);
  glowCount = 0;
  /** Squared distance of each glow slot from the viewer, and the viewer (the camera, set before each update). */
  private glowFar = new Float64Array(MAX_GLOWS);
  viewer: readonly [number, number, number] = [0, 0, 0];
  /** Called when a remote player lands a footstep (feet position). */
  onStep: (x: number, y: number, z: number) => void = () => {};
  /** Called when a creeper starts its fuse. */
  onFuse: (x: number, y: number, z: number) => void = () => {};
  /** Called every frame for each flying fireball (for its smoke trail). */
  onFireball: (x: number, y: number, z: number, dt: number) => void = () => {};
  /** Called every frame for what entities give off (smoke, motes, trails, acid breath, the dying dragon). */
  onEmit: (kind: EntityEmit, x: number, y: number, z: number, dt: number) => void = () => {};
  /** Called on dragon wing beats, roars and landings (at its body centre). */
  onDragon: (cue: DragonCue, x: number, y: number, z: number) => void = () => {};
  /** The Ender Dragon being drawn, if any (for the boss-fight camera juice). */
  dragon: { x: number; y: number; z: number } | null = null;

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
    for (const mob of this.mobs.values()) {
      if (mob.deadAt || mob.pose?.dyingAt) continue;
      if (mob.parts) yield* mob.parts;
      else yield mob;
    }
    for (const arrow of this.arrows.values()) if (arrow.k === PK.GHAST_FIREBALL) yield arrow;
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
    this.dragon = null;
    for (const m of b.mobs) this.updateMob(m, olderMobs.get(m.id) ?? m, t, dt, gen);
    this.healBeams(gen);
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
  /** World light and hurt flash on an actor's materials; `lit` raises the light floor (blazes glow), glow materials light themselves. */
  private tint(actor: Actor, shirt: number | null, flash = 0, lit = 0) {
    const hurt = Math.max(0, 1 - (this.time - actor.hurtAt) / HURT_SECONDS);
    const [r, g, b] = this.light(actor.x, actor.y + actor.height * 0.7, actor.z, this.rgb);
    for (const { material, base, shirt: isShirt, glow } of actor.rig.materials) {
      if (isShirt && shirt !== null) material.color.setHex(shirt);
      else material.color.copy(base);
      if (!glow) {
        material.color.r *= Math.max(0.06, r, lit);
        material.color.g *= Math.max(0.06, g, lit);
        material.color.b *= Math.max(0.06, b, lit);
      }
      material.color.g *= 1 - hurt * 0.55;
      material.color.b *= 1 - hurt * 0.55;
      if (glow) material.emissive.copy(base).multiplyScalar(0.8);
      else material.emissive.setRGB(hurt * 0.5 + flash, flash, flash);
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
  /** Offer a glow light: the MAX_GLOWS nearest the viewer win (a farther one is replaced), so far crystals never starve near fire. */
  private glow(x: number, y: number, z: number, radius: number, r: number, g: number, b: number) {
    const [vx, vy, vz] = this.viewer, d = (x - vx) ** 2 + (y - vy) ** 2 + (z - vz) ** 2, far = this.glowFar;
    let slot = this.glowCount;
    if (slot < MAX_GLOWS) this.glowCount++;
    else {
      slot = far.indexOf(Math.max(...far));
      if (d >= far[slot]!) return;
    }
    far[slot] = d;
    const o = slot * 7, glows = this.glows;
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
      actor.rig.materials.push({ material: tinted, base: new Color(GOLD), shirt: false, glow: false });
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
      actor = { ...newActor(rig, type.h), ...newExtras(key), id: m.id, t: m.t, parts: null, pose: null, beam: null };
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
    // a = 3 is a lit fuse only for creepers and TNT (endermen stare, crystals beam and blazes charge with it).
    if (m.a === 3 && actor.state !== 3 && !firstFrame && (type.key === 'creeper' || type.key === 'tnt')) this.onFuse(actor.x, actor.y, actor.z);
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
    if (kind === 'dragon') { this.animateDragon(actor, m, old, t, dt); return; }
    let lit = 0;
    if (kind === 'humanoid') this.animateHumanoid(actor, false, false, type.key === 'zombie' || type.key === 'zombified_piglin' && !!(s & MS.ANGRY), m.a === 2 && type.key === 'skeleton');
    else if (kind === 'enderman') {
      this.animateHumanoid(actor, false, false, false);
      // Angry (or staring back): the jaw drops and the head trembles.
      const angry = !!(s & MS.ANGRY) || m.a === 3, head = pivots.head;
      if (pivots.jaw) pivots.jaw.rotation.x += ((angry ? -0.55 : 0) - pivots.jaw.rotation.x) * damp(12, dt);
      if (head) {
        const rest = restY(head), shake = angry ? 0.025 : 0;
        head.position.set((Math.random() - 0.5) * shake, rest + (angry ? 0.07 : 0) + (Math.random() - 0.5) * shake, 0);
      }
      if (Math.random() < dt * 5 && actor.rig.root.visible) this.onEmit('ender', actor.x + (Math.random() - 0.5) * 0.9, actor.y + Math.random() * 2.9, actor.z + (Math.random() - 0.5) * 0.9, dt);
    } else if (kind === 'blaze') {
      // Three rings of rods turning against each other around a hovering, glowing head; flames and a hotter glow while firing.
      for (let i = 0; i < 3; i++) {
        const ring = pivots[`rods_ring_${i}` as Pivot];
        if (!ring) continue;
        ring.rotation.y = this.time * (1.4 + i * 0.35) * (i === 1 ? -1 : 1);
        ring.position.y = restY(ring) + Math.sin(this.time * 2.2 + i * 2.1) * 0.06;
      }
      actor.rig.root.children[0]!.position.y = Math.sin(this.time * 1.6 + m.id) * 0.12;
      lit = 0.85;
      const firing = m.a >= 2;
      this.glow(actor.x, actor.y + 1, actor.z, firing ? 6 : 4.5, firing ? 1.1 : 0.7, firing ? 0.55 : 0.38, 0.1);
      if (Math.random() < dt * 7 && actor.rig.root.visible) this.onEmit('blaze', actor.x + (Math.random() - 0.5) * 0.8, actor.y + 0.2 + Math.random() * 1.4, actor.z + (Math.random() - 0.5) * 0.8, dt);
    } else if (kind === 'silverfish') {
      // Segments wriggle side to side, faster and wider while scurrying.
      const wiggle = 0.12 + Math.min(1, actor.speed / 2) * 0.3;
      for (let i = 0; i < 4; i++) {
        const seg = pivots[`seg_${i}` as Pivot];
        if (seg) seg.rotation.y = Math.sin(this.time * 16 - i * 1.2) * wiggle;
      }
    } else if (kind === 'crystal') {
      // Two frames turning on different axes around a counter-spinning core, bobbing over the base.
      const spin = this.time * 1.7 + m.id, { frame_outer: outer, frame_inner: inner, core } = pivots;
      if (outer) {
        outer.rotation.set(0.62, spin, 0.62);
        outer.position.y = restY(outer) + Math.sin(this.time * 2 + m.id) * 0.2;
      }
      inner?.rotation.set(spin * 1.3, 0.62, 0.3);
      core?.rotation.set(0.62, -spin * 1.6, 0.62);
      actor.rig.root.rotation.y = 0;
      this.glow(actor.x, actor.y + 1.3, actor.z, 5, 0.55, 0.22, 0.5);
    } else if (kind === 'ghast') {
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
    this.burning(actor, (!!(s & MS.BURNING) || kind === 'blaze' && m.a >= 2) && actor.rig.root.visible, type.w * scale, type.h * scale);
    this.tint(actor, shirt, flash, lit);
  }

  /**
   * The Ender Dragon: placed at its body centre and turned by yaw, pitch and a bank into its turns. Wings beat (faster
   * climbing, gliding in dives, half-folded when perched), the neck dips to land and breathe, the tail trails the body
   * segment by segment, the jaw opens to breathe and roar. Phase 5 is the death: rising light beams, a growing glow,
   * shaking, then the body dissolves.
   */
  private animateDragon(actor: MobActor, m: PubMob, old: PubMob, t: number, dt: number) {
    const time = this.time, phase = m.ph ?? 0, pitch = lerp(old.pt ?? 0, m.pt ?? 0, t), { pivots } = actor.rig, root = actor.rig.root, model = root.children[0]!;
    // The dragon is a silhouette against the sky from across the island, not hidden in the terrain's fog (also after a rig swap).
    if (actor.rig.materials[0]?.material.fog) for (const { material } of actor.rig.materials) { material.fog = false; material.needsUpdate = true; }
    const pose = actor.pose ??= {
      roll: 0, flap: 0, wing: 0, tip: 0, jaw: 0, dip: 0, lastYaw: actor.yaw, phase, dyingAt: 0, tailYaw: new Float64Array(TAIL).fill(actor.yaw), tailPitch: new Float64Array(TAIL).fill(pitch), beams: null,
    };
    const parts = actor.parts ??= DRAGON_PARTS.map((_, part) => ({ id: actor.id, part, box: [0, 0, 0, 0, 0, 0] }));
    dragonBoxes(actor.x, actor.y, actor.z, actor.yaw, pitch, parts);
    for (let i = 0; i < 6; i++) actor.box[i] = parts[2]!.box[i]!;
    const cx = actor.x, cy = actor.y + DRAGON_LIFT, cz = actor.z, k = damp(6, dt);
    this.dragon = actor;
    actor.pitch = pitch;
    actor.bodyYaw = actor.yaw;
    const turn = dt > 0 ? wrapAngle(actor.yaw - pose.lastYaw) / dt : 0;
    pose.lastYaw = actor.yaw;
    pose.roll += (clamp(turn * 0.45, -0.6, 0.6) - pose.roll) * damp(3, dt);
    if (phase !== pose.phase) {
      if (phase === PERCHED) this.onDragon('land', cx, cy, cz);
      if (phase === DRAGON_PHASE.STRAFING || phase === DRAGON_PHASE.TAKING_OFF || phase === PERCHED) this.onDragon('roar', cx, cy, cz);
      pose.phase = phase;
    }
    root.position.set(cx, cy, cz);
    root.rotation.set(pitch, actor.yaw, pose.roll, 'YXZ');
    root.scale.setScalar(1);
    // It flies over the void and far across the island: never hidden for an unloaded column.
    root.visible = true;
    model.position.set(0, -DRAGON_LIFT, 0);

    // Wings: angle up (+) per side; tips trail the beat.
    const perched = phase === PERCHED, dying = phase === DYING, beat = perched ? 0 : dying ? 2.5 : pitch > 0.15 ? 7.5 : pitch < -0.25 ? 2 : 4.4;
    const before = Math.floor(pose.flap / (Math.PI * 2));
    pose.flap += dt * beat;
    if (beat > 2.2 && Math.floor(pose.flap / (Math.PI * 2)) > before) this.onDragon('flap', cx, cy, cz);
    const swing = Math.sin(pose.flap), amp = pitch < -0.25 && !dying ? 0.18 : 0.8;
    const wing = perched ? 0.3 + Math.sin(time * 1.4) * 0.06 : 0.12 + swing * amp, tip = perched ? -1.1 : Math.sin(pose.flap - 0.9) * amp * 0.6 - 0.1;
    pose.wing += (wing - pose.wing) * damp(14, dt);
    pose.tip += (tip - pose.tip) * damp(14, dt);
    if (pivots.wing_l) pivots.wing_l.rotation.z = -pose.wing;
    if (pivots.wing_r) pivots.wing_r.rotation.z = pose.wing;
    if (pivots.wingtip_l) pivots.wingtip_l.rotation.z = -pose.tip;
    if (pivots.wingtip_r) pivots.wingtip_r.rotation.z = pose.tip;
    // Neck dips to land and breathe, leans into turns; the head stays level-ish and looks ahead.
    pose.dip += ((perched ? -0.2 : phase === DRAGON_PHASE.LANDING ? -0.1 : 0) - pose.dip) * k;
    for (let i = 0; i < NECK; i++) {
      const neck = pivots[`neck_${i}` as Pivot];
      if (neck) neck.rotation.set(pose.dip + Math.sin(time * 1.3 + i * 0.7) * 0.04, clamp(turn * 0.05, -0.08, 0.08), 0);
    }
    if (pivots.head) pivots.head.rotation.x = -pose.dip * 2.5 - pitch * 0.3;
    pose.jaw += ((dying ? 0.8 : perched ? 0.3 + Math.max(0, Math.sin(time * 2.5)) * 0.35 : m.a === 2 ? 0.7 : 0.06) - pose.jaw) * damp(8, dt);
    if (pivots.jaw) pivots.jaw.rotation.x = -pose.jaw;
    if (perched && pose.jaw > 0.4 && pivots.head) {
      const at = pivots.head.getWorldPosition(this.scratch);
      this.onEmit('breath', at.x, at.y, at.z, dt);
    }
    // Tail: each segment eases towards the direction of the one before it, so turns ripple down to the tip.
    let parentYaw = actor.yaw, parentPitch = pitch;
    for (let i = 0; i < TAIL; i++) {
      const follow = damp(9 - i * 0.5, dt);
      pose.tailYaw[i] = pose.tailYaw[i]! + wrapAngle(parentYaw - pose.tailYaw[i]!) * follow;
      pose.tailPitch[i] = pose.tailPitch[i]! + (parentPitch - pose.tailPitch[i]!) * follow;
      const seg = pivots[`tail_${i}` as Pivot];
      if (seg) seg.rotation.set(clamp(pose.tailPitch[i]! - parentPitch, -0.5, 0.5) + Math.sin(time * 1.7 - i * 0.6) * 0.03, clamp(wrapAngle(pose.tailYaw[i]! - parentYaw), -0.5, 0.5) + Math.sin(time * 1.2 - i * 0.5) * 0.05, 0);
      parentYaw = pose.tailYaw[i]!;
      parentPitch = pose.tailPitch[i]!;
    }
    for (const name of DRAGON_LEGS) {
      const leg = pivots[name];
      if (leg) leg.rotation.x += ((perched || phase === DRAGON_PHASE.LANDING ? 0 : 0.95) - leg.rotation.x) * k;
    }

    let flash = 0;
    if (dying) {
      if (!pose.dyingAt) {
        pose.dyingAt = time;
        for (const { material } of actor.rig.materials) material.transparent = true;
      }
      const d = time - pose.dyingAt, fade = 1 - clamp((d - DEATH_SECONDS * 0.7) / (DEATH_SECONDS * 0.3), 0, 1);
      flash = Math.min(0.9, d / 6);
      model.position.set((Math.random() - 0.5) * 0.3 * Math.min(1, d), -DRAGON_LIFT + (Math.random() - 0.5) * 0.3 * Math.min(1, d), (Math.random() - 0.5) * 0.3);
      for (const { material } of actor.rig.materials) material.opacity = fade;
      this.deathBeams(actor, pose, d, fade);
      this.glow(cx, cy, cz, 10 + d * 2.5, 0.9, 0.55, 1);
      if (root.visible) this.onEmit('dying', cx, cy, cz, dt);
    } else if (pose.dyingAt) {
      pose.dyingAt = 0;
      if (pose.beams) pose.beams.visible = false;
      for (const { material } of actor.rig.materials) { material.transparent = false; material.opacity = 1; }
    }
    this.tint(actor, null, flash);
  }

  /** The dying dragon's light shafts: more of them, longer and brighter over the death, turning slowly. */
  private deathBeams(actor: MobActor, pose: DragonPose, d: number, fade: number) {
    if (!pose.beams) {
      pose.beams = new Group();
      for (let i = 0; i < BEAMS; i++) {
        const beam = new Mesh(this.beamGeometry, this.beamMaterials[i % 2]!), u = Math.random() * 1.6 - 0.4;
        beam.rotation.set(-Math.asin(u), Math.random() * Math.PI * 2, 0, 'YXZ');
        pose.beams.add(beam);
      }
      actor.rig.root.add(pose.beams);
    }
    const beams = pose.beams;
    beams.visible = true;
    beams.rotation.y = d * 0.5;
    beams.children.forEach((beam, i) => {
      beam.visible = i < 1 + d * 2.2;
      beam.scale.set(0.35 + d * 0.06, 0.35 + d * 0.06, 6 + d * 4 + (i % 3) * 3);
    });
    for (let i = 0; i < 2; i++) this.beamMaterials[i]!.opacity = Math.min(1, d / 2) * 0.55 * fade;
  }

  /** End crystals: the one the server marks healing (a = 3) is joined by a pulsing beam to the dragon's body. */
  private healBeams(gen: number) {
    const dragon = this.dragon as MobActor | null, alive = dragon && !dragon.pose?.dyingAt;
    let best: MobActor | null = null;
    for (const crystal of this.mobs.values()) {
      if (crystal.t !== MOB.end_crystal) continue;
      if (crystal.beam) crystal.beam.visible = false;
      if (alive && crystal.seen === gen && crystal.state === 3) best = crystal;
    }
    if (!best || !dragon) return;
    const bestDistance = (best.x - dragon.x) ** 2 + (best.y + 1.3 - dragon.y - DRAGON_LIFT) ** 2 + (best.z - dragon.z) ** 2;
    let beam = best.beam;
    if (!beam) {
      beam = best.beam = new Group();
      for (const [size, material] of [[0.5, this.beamMaterials[1]!], [0.16, this.beamMaterials[2]!]] as const) {
        const mesh = new Mesh(this.beamGeometry, material);
        mesh.scale.set(size, size, 1);
        beam.add(mesh);
      }
      this.group.add(beam);
    }
    beam.visible = true;
    beam.position.set(best.x, best.y + 1.3, best.z);
    beam.lookAt(this.scratch.set(dragon.x, dragon.y + DRAGON_LIFT, dragon.z));
    beam.scale.set(1, 1, Math.sqrt(bestDistance));
    this.beamMaterials[2]!.opacity = 0.65 + Math.sin(this.time * 9) * 0.25;
    if (!dragon.pose?.dyingAt) this.beamMaterials[1]!.opacity = 0.3 + Math.sin(this.time * 5) * 0.1;
  }
  /** A mob missing from the latest snapshot: play its death tip-over if it was hurt recently, then remove it. */
  private fadeMob(id: number, m: MobActor) {
    if (!m.deadAt) m.deadAt = this.time;
    const t = this.time - m.deadAt, kind = m.rig.kind;
    if (this.time - m.hurtAt > 1 || t > 0.8 || kind === 'dragon' || kind === 'crystal') {
      // The dragon dissolves at the end of its death (one last burst); crystals vanish in their explosion.
      if (kind === 'dragon' && m.pose?.dyingAt) this.onEmit('vanish', m.x, m.y + DRAGON_LIFT, m.z, 0);
      if (m.beam) this.group.remove(m.beam);
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
      if (k === PK.GHAST_FIREBALL || k === PK.BLAZE_FIREBALL || k === PK.DRAGON_FIREBALL) {
        // Fireballs: a pixel charge inside an additive glow, always facing the camera (small for blazes, purple for the dragon).
        const look = k === PK.DRAGON_FIREBALL ? this.acidLook ??= fireballMaterials(ACID_LOOK) : this.fireballLook ??= fireballMaterials(FIRE_LOOK);
        const size = k === PK.BLAZE_FIREBALL ? 0.4 : k === PK.DRAGON_FIREBALL ? 1.3 : 1, halo = new Sprite(look[0]), ball = new Sprite(look[1]);
        halo.scale.setScalar(1.6 * size);
        ball.scale.setScalar(0.85 * size);
        root.add(halo, ball);
      } else if (k === PK.EYE || k === PK.PEARL) {
        // A thrown eye of ender or pearl: its item model, spinning.
        const model = this.itemModels.model(k === PK.EYE ? I.ender_eye : I.ender_pearl);
        if (model) {
          const mesh = new Mesh(model.geometry, this.itemModels.material(1));
          mesh.scale.setScalar(0.32);
          root.add(mesh);
        }
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
    const { x, y, z } = visual.root.position;
    if (k === PK.GHAST_FIREBALL) {
      const box = visual.box;
      box[0] = x - 0.5; box[1] = y - 0.5; box[2] = z - 0.5; box[3] = x + 0.5; box[4] = y + 0.5; box[5] = z + 0.5;
      this.glow(x, y, z, 6, 1.1, 0.55, 0.18);
      this.onFireball(x, y, z, dt);
      return;
    }
    if (k === PK.BLAZE_FIREBALL || k === PK.DRAGON_FIREBALL) {
      const acid = k === PK.DRAGON_FIREBALL;
      this.glow(x, y, z, acid ? 7 : 3.5, acid ? 0.6 : 1, acid ? 0.2 : 0.5, acid ? 0.9 : 0.15);
      this.onEmit(acid ? 'acidball' : 'smallFireball', x, y, z, dt);
      return;
    }
    if (k === PK.EYE || k === PK.PEARL) {
      visual.root.rotation.set(0, this.time * 5, 0);
      const mesh = visual.root.children[0] as Mesh | undefined, [r, g, b] = this.light(x, y, z, this.rgb);
      if (mesh) mesh.material = this.itemModels.material(Math.max(k === PK.EYE ? 0.8 : 0, (r + g + b) / 3));
      this.onEmit(k === PK.EYE ? 'eye' : 'pearl', x, y, z, dt);
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
    for (const m of [...this.fireballLook ?? [], ...this.acidLook ?? []]) { m.map?.dispose(); m.dispose(); }
    this.beamGeometry.dispose();
    for (const m of this.beamMaterials) m.dispose();
    this.group.removeFromParent();
    this.players.clear();
    this.mobs.clear();
  }
}
