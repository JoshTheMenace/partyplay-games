// Per-seat fighter actor: a SkeletonUtils clone of the shared replacement model plus seat cues and move effects.
import { CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, SphereGeometry, type BufferGeometry, type Object3D, type Skeleton, type SkinnedMesh } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FIGHTERS, STAGE, type Fighter, type FighterKind } from './model';
import type { Platform } from './stages';
import { applyFlat, blendRate, captureRig, emptyFlat, mixFlat, targetPose, type ActorClock, type Flat, type Rig } from './animation';
export type Cache = { geo: Map<string, BufferGeometry>; own<T extends { dispose(): void }>(resource: T): T };
export const makeCache = (own: Cache['own']): Cache => ({ geo: new Map(), own });
const geo = <T extends BufferGeometry>(cache: Cache, key: string, make: () => T): T => { let item = cache.geo.get(key); if (!item) { item = cache.own(make()); cache.geo.set(key, item); } return item as T; };
const TOWARD = .32; // slight turn toward the camera so faces read in the 2.5D view
export class Actor {
  group = new Group(); turn = new Group(); rig: Rig; current = emptyFlat(); scratch: [Flat, Flat, Flat] = [emptyFlat(), emptyFlat(), emptyFlat()];
  clock: ActorClock = { modeSince: 0, landing: 0 }; mode = ''; pop = 0; yaw = 0; stateY = 0;
  seat: Mesh; halo: Mesh; shield: Mesh; reflector: Mesh; pulse: Mesh; disc: Mesh; shadow: Mesh; cue: Mesh; streak: Mesh; fire: Mesh; charge: Mesh; height: number; style: string;
  /** Models are authored at FIGHTERS.height already; only the effect meshes scale with the body. */
  constructor(readonly kind: FighterKind, readonly color: string, source: Object3D, cache: Cache) {
    const meta = FIGHTERS[kind], h = this.height = meta.height, s = h / STAGE.fighterHeight, w = meta.radius / STAGE.fighterRadius; this.style = meta.style;
    const model = cloneSkeleton(source); model.position.set(0, 0, 0); this.turn.add(model); this.group.add(this.turn); this.rig = captureRig(model);
    const basic = (opacity: number, tone = color, extra: Partial<MeshBasicMaterial> = {}) => cache.own(new MeshBasicMaterial({ color: tone, transparent: true, opacity, side: DoubleSide, depthWrite: false, ...extra }));
    const flat = (mesh: Mesh, y: number) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };
    this.seat = flat(new Mesh(geo(cache, 'seat', () => new RingGeometry(.3, .4, 32)), basic(.85)), .012); this.seat.scale.setScalar(w); this.group.add(this.seat);
    this.halo = flat(new Mesh(geo(cache, 'halo', () => new RingGeometry(.48, .6, 40)), basic(.8)), .02); this.group.add(this.halo);
    this.disc = flat(new Mesh(geo(cache, 'disc', () => new CircleGeometry(.8, 28)), basic(.55)), -.03); this.disc.scale.setScalar(w); this.group.add(this.disc);
    this.charge = flat(new Mesh(geo(cache, 'charge', () => new RingGeometry(.5, .75, 40)), basic(.7, '#ffd24a')), .015); this.group.add(this.charge);
    this.shield = new Mesh(geo(cache, 'bubble', () => new SphereGeometry(1, 20, 14)), basic(.32)); this.shield.position.y = h * .52; this.group.add(this.shield);
    // Down-special telegraph: pilots raise their hexagonal reflector; everyone else shows a colored pulse ring in front of the body.
    this.reflector = new Mesh(geo(cache, 'reflector', () => new CylinderGeometry(1.15, 1.15, .08, 6)), basic(.45, '#6fd8ff')); this.reflector.rotation.x = Math.PI / 2; this.reflector.position.y = h * .5; this.reflector.scale.setScalar(s); this.group.add(this.reflector);
    this.pulse = new Mesh(geo(cache, 'pulse', () => new RingGeometry(.7, .95, 40)), basic(.6)); this.pulse.position.y = h * .5; this.pulse.scale.setScalar(s); this.group.add(this.pulse);
    // Up-special aura: warm fire for the pilots, the fighter's own color for other reconstructed recoveries.
    this.fire = new Mesh(geo(cache, 'fire', () => new SphereGeometry(1.15, 18, 12)), basic(.5, meta.style === 'pilot' ? '#ff8a3d' : color)); this.fire.position.y = h * .5; this.fire.scale.setScalar(s); this.group.add(this.fire);
    this.streak = new Mesh(geo(cache, 'streak', () => new PlaneGeometry(2.2, .9)), basic(.45, color)); this.streak.position.set(-1.3 * s, h * .5, 0); this.streak.scale.setScalar(s); this.turn.add(this.streak);
    this.shadow = flat(new Mesh(geo(cache, 'shadow', () => new CircleGeometry(.55, 24)), basic(.34, '#1a1030')), 0); this.cue = flat(new Mesh(geo(cache, 'cue', () => new RingGeometry(.4, .55, 32)), basic(.7)), 0);
    for (const m of [this.halo, this.disc, this.charge, this.shield, this.reflector, this.pulse, this.fire, this.streak, this.cue]) m.visible = false;
  }
  /** Adds shadow and landing cue to the scene; they live in world space rather than under the actor. */
  attach(parent: Object3D) { parent.add(this.group, this.shadow, this.cue); }
  detach() { this.group.removeFromParent(); this.shadow.removeFromParent(); this.cue.removeFromParent(); }
  /** Removes the actor and frees the skeletons SkeletonUtils.clone created for it (bone textures). Shared geometry/materials are untouched. */
  dispose() {
    this.detach(); const skeletons = new Set<Skeleton>();
    this.turn.traverse(object => { const mesh = object as SkinnedMesh; if (mesh.isSkinnedMesh && mesh.skeleton) skeletons.add(mesh.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
  }
  /** `platforms` are the current authoritative surfaces (moving stages pass this frame's positions) used for the contact shadow and landing cue. */
  update(f: Fighter, x: number, y: number, seconds: number, dt: number, reduced: boolean, phase: string, platforms: readonly Pick<Platform, 'left' | 'right' | 'y'>[] = STAGE.platforms) {
    if (f.mode !== this.mode) { this.mode = f.mode; this.clock.modeSince = seconds; }
    const target = targetPose(f, this.clock, seconds, reduced, this.scratch), striking = f.mode === 'attack';
    const k = 1 - Math.exp(-dt * (striking ? 30 : f.mode === 'hurt' ? 26 : 15) * blendRate(this.style)); mixFlat(this.current, this.current, target, k); applyFlat(this.rig, this.current);
    this.pop = Math.max(0, this.pop - dt * 5);
    const facing = f.facing < 0 ? -1 : 1, yawTarget = facing > 0 ? Math.PI / 2 - TOWARD : -Math.PI / 2 + TOWARD; this.yaw += (yawTarget - this.yaw) * (1 - Math.exp(-dt * 16)); this.turn.rotation.y = this.yaw;
    this.group.position.set(x, y, this.group.position.z); this.turn.scale.setScalar(1 + this.pop * .12);
    // Whole-body flips/drills/travel pitch happen in the screen plane on the group, never on bones.
    let spin = this.current.spin * -facing;
    if (f.mode === 'attack' && f.move === 'rise' && (Math.abs(f.vx) > .5 || f.vy > .5)) spin = -facing * (90 - Math.atan2(Math.max(0, f.vy), Math.abs(f.vx)) * 180 / Math.PI) * Math.min(1, Math.hypot(f.vx, f.vy) / 8);
    this.group.rotation.z = spin * Math.PI / 180; this.group.rotation.y = this.current.yaw * Math.PI / 180 * facing;
    const alive = f.mode !== 'out'; this.group.visible = alive;
    this.turn.visible = alive && !(f.invulnerable && !reduced && phase === 'fight' && f.mode !== 'respawn' && Math.floor(seconds * 14) % 2 === 0);
    const shieldAmount = Math.max(.15, f.shield / 100), s = this.height / STAGE.fighterHeight;
    this.shield.visible = f.mode === 'shield'; this.shield.scale.setScalar((.7 + shieldAmount * .55 + (reduced ? 0 : Math.sin(seconds * 9) * .015)) * s);
    this.halo.visible = f.invulnerable && alive && f.mode !== 'respawn'; this.halo.scale.setScalar(reduced ? 1 : 1 + Math.sin(seconds * 6) * .08);
    this.disc.visible = f.mode === 'respawn'; this.disc.position.y = -.03 - (reduced ? 0 : Math.sin(seconds * 3) * .02);
    const charging = f.mode === 'attack' && f.charge > 0; this.charge.visible = charging; this.charge.scale.setScalar(.8 + f.charge / 60 * .6 + (reduced ? 0 : Math.sin(seconds * 18) * .04 * f.charge / 60)); (this.charge.material as MeshBasicMaterial).opacity = .3 + f.charge / 60 * .5;
    const down = f.mode === 'attack' && f.move === 'reflect', pilot = this.style === 'pilot';
    this.reflector.visible = down && pilot; this.reflector.rotation.z = reduced ? 0 : seconds * 2; this.reflector.scale.setScalar((1 + (reduced ? 0 : Math.sin(seconds * 10) * .04)) * s);
    this.pulse.visible = down && !pilot; this.pulse.scale.setScalar((.8 + .35 * (reduced ? .5 : (Math.sin(seconds * 8) + 1) / 2)) * s); (this.pulse.material as MeshBasicMaterial).opacity = reduced ? .5 : .35 + .3 * (Math.sin(seconds * 8) + 1) / 2;
    const rising = f.mode === 'attack' && f.move === 'rise'; this.fire.visible = rising; this.fire.scale.setScalar((.7 + (reduced ? 0 : Math.sin(seconds * 25) * .08) + Math.min(.5, Math.hypot(f.vx, f.vy) / 20)) * s); (this.fire.material as MeshBasicMaterial).opacity = rising && (Math.abs(f.vx) > .5 || Math.abs(f.vy) > .5) ? .55 : .3;
    this.streak.visible = f.mode === 'attack' && f.move === 'dash' && f.moveFrame > 2; this.streak.scale.x = Math.min(2, .6 + Math.abs(f.vx) / 8) * s;
    const landing = platforms.filter(p => x >= p.left - .1 && x <= p.right + .1 && p.y <= y + .05).sort((a, b) => b.y - a.y)[0];
    const airborne = !f.grounded && f.mode !== 'respawn';
    this.seat.visible = alive; this.shadow.visible = alive && !!landing && f.mode !== 'respawn'; this.cue.visible = false;
    if (landing) {
      const dist = Math.max(0, y - landing.y); this.shadow.position.set(x, landing.y + .015, 0); this.cue.position.set(x, landing.y + .02, 0);
      (this.shadow.material as MeshBasicMaterial).opacity = .36 / (1 + dist * .5); this.shadow.scale.setScalar(Math.max(.55, 1 - dist * .05));
      this.cue.visible = alive && airborne && dist > .3; this.cue.scale.setScalar(1 + Math.min(1.2, dist * .12)); (this.cue.material as MeshBasicMaterial).opacity = .35 + .45 / (1 + dist * .3);
    }
  }
}
