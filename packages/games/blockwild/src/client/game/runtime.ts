/**
 * The per-frame game loop behind the SceneView. One Runtime per mounted scene: a first-person game for controller
 * seats, a cinematic spectator for the watching display. It owns the command queue flush and the single setInput
 * call, applies private views (acks, teleports, impulses, predicted containers) and plays authoritative effects.
 */
import { Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { SceneViewProps } from '../../../../../party-ui/src/index';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { B, blockOf, cellId, cellState, faceTexture, isAir, isSolid, makeCell, pistonFacing, PISTON_STICKY, PORTAL_Z, wirePower } from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import { DAY_TICKS, EYE_HEIGHT, REACH } from '../../shared/constants';
import { cellIndex, FACES, inWorld, wrapAngle, type Vec3 } from '../../shared/coords';
import { I } from '../../shared/items';
import { eyeInWater, newBody, type Body } from '../../shared/physics';
import { MOB_TYPES, PF, type Fx, type PrivateView, type Settings, type View } from '../../shared/protocol';
import { raycastBlocks } from '../../shared/raycast';
import { collisionBoxes, selectionBoxes } from '../../shared/shapes';
import { surfaceHeight } from '../../shared/worldgen';
import { crackStage } from '../../shared/mining';
import { store } from '../store';
import type { Crack, VoxelEngine } from '../engine/index';
import type { HostMusic } from '../audio/host-music';
import type { Sfx } from '../audio/sfx';
import { IMPACT_PITCH, impactSound, mobPitch, mobSynth, mobVoice, stepSound } from '../audio/sounds';
import { reducedMotion, Spectator, ViewEffects, type Subject, type ViewState } from './camera';
import { Controls } from './controls';
import { ScreenFx } from './effects';
import { Entities } from './entities';
import { Hand, type HandPose } from './hand';
import { hud } from './hud';
import { Interaction, type Frame } from './interact';
import type { ModelLibrary } from './models';
import { buildInput, NetSync } from './net';
import { EditOverlay } from './overlay';
import { Particles } from './particles';
import { LocalPlayer } from './player';
import { configurePrediction, sendCommand, setServerView } from './predict';
import type { ItemModels, SpriteSheet } from './sprites';
import { pickTarget, sameTarget } from './targeting';

export type Props = SceneViewProps<Settings, View, PrivateView>;
export type RuntimeDeps = {
  scene: Scene; camera: PerspectiveCamera; canvas: HTMLCanvasElement; engine: VoxelEngine;
  sheet: SpriteSheet; items: ItemModels; models: ModelLibrary; sfx: Sfx; music: HostMusic | null;
  scope: ResourceScope;
  /** The world seed the engine was built for (the view's real seed). */
  seed: number;
  /** Estimated world spawn (feet), the spectator's flyover centre before anyone plays. */
  spawn: Vec3;
  props(): Props;
};

const INPUT_MS = 50, BODY_PUBLISH_MS = 250, EMITTER_SCAN = 0.5, STEP_DISTANCE = 1.7, FX_DEDUPE_MS = 1500;
/** Blocks that give off particles (and a few ambient sounds) near the camera. */
const EMITTERS = new Set<number>([B.torch, B.furnace_lit, B.lantern, B.jack_o_lantern, B.redstone_torch, B.redstone_wire, B.fire, B.monster_spawner, B.lava, B.nether_portal]);
/** Emitters kept per scan, and how many lava surfaces and portal cells among them (sampled evenly from the area). */
const MAX_EMITTERS = 256, MAX_SAMPLED = 48, MAX_SPAWNERS = 6;
/** Seconds a piston move takes on screen (MC: 2 game ticks, plus a little so the eye catches it). */
const PISTON_SLIDE = 0.14;

export class Runtime {
  readonly overlay = new EditOverlay();
  readonly entities: Entities;
  readonly particles: Particles;
  private readonly controller: boolean;
  private readonly net = new NetSync();
  private readonly effects = new ViewEffects();
  private readonly spectator: Spectator;
  private readonly controls: Controls | null = null;
  private readonly hand: Hand | null = null;
  private readonly interaction: Interaction | null = null;
  private player: LocalPlayer | null = null;
  private view: View | null = null;
  private pv: PrivateView | null = null;
  private viewTime = 0;
  private viewAt = 0;
  private sentRevision = -1;
  private sentOverlay = -1;
  private lastFx = -1;
  private readonly recent = new Map<number, number>();
  private lastSend = -Infinity;
  private wake = false;
  private lastBodyPublish = 0;
  private stepDistance = 0;
  private swimDistance = 0;
  private wasOnGround = true;
  private wasInWater = false;
  private fallSpeed = 0;
  private emitterWait = 0;
  private readonly emitters: number[] = [];
  /** Lava surfaces and portal cells, reservoir-sampled so a lava sea never crowds out everything else. */
  private readonly sampled: number[] = [];
  private readonly spawners: number[] = [];
  private readonly emitterLists = [this.emitters, this.sampled] as const;
  private readonly light = (x: number, y: number, z: number) => this.d.engine.lightAt(x, y, z);
  private portalSound = 0;
  private screen: ScreenFx | null = null;
  private editsView: View | null = null;
  private readonly editValues = new Map<number, number>();
  private readonly cracks: Crack[] = [];
  private readonly subjects: Subject[] = [];
  private renderDistance = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private shirt = '';
  private leavingBed = false;
  private readonly eye: Vec3 = [0, 0, 0];
  private readonly dir: Vec3 = [0, 0, -1];
  // Per-frame parameter objects, reused so the loop allocates nothing.
  private readonly viewState: ViewState = { walked: 0, onGround: false, sprinting: false, flying: false, underwater: false, dead: false, sleeping: false, baseFov: 75, portal: 0 };
  private readonly handLight: [number, number, number] = [1, 1, 1];
  private readonly pose: HandPose = { mining: false, eating: -1, drawing: -1, bobPhase: 0, bobAmount: 0, yawSpeed: 0, pitchSpeed: 0, light: this.handLight, visible: true };
  private readonly frameState: Frame = { dt: 0, mode: 'survival', body: newBody(0, 0, 0), yaw: 0, pitch: 0, eye: this.eye, dir: this.dir, target: null, held: 0, slot: 0, food: 20, hasArrows: false };
  private readonly facing = new Vector3();
  private readonly scratch = new Vector3();
  private readonly getCell: CellReader;
  private readonly still = reducedMotion();

  constructor(private readonly d: RuntimeDeps) {
    const props = d.props();
    // A cached engine may come from an earlier Runtime: clear its edge-triggered player visuals (the HUD resets below).
    d.engine.setUnderwater(false);
    d.engine.visuals.outline(null);
    this.spectator = new Spectator({ x: d.spawn[0], z: d.spawn[2] });
    this.controller = props.viewRole === 'controller' && !!props.playerId;
    const world = d.engine.world;
    // The engine writes authoritative edits and the overlay into these cells synchronously in setEdits.
    this.getCell = (x, y, z) => world.getCell(x, y, z);
    this.entities = new Entities(d.scene, d.models, d.items, (x, y, z, out) => d.engine.lightRgb(x, y, z, out), (x, z) => d.engine.world.isLoaded(x, z), this.controller ? props.playerId : null, d.engine.shared);
    this.entities.onStep = (x, y, z) => this.footstep(x, y, z, 0.35, false);
    this.entities.onFuse = (x, y, z) => d.sfx.play('fuse', { at: [x, y + 1, z], volume: 0.9 });
    this.entities.onFireball = (x, y, z, dt) => {
      if (Math.random() < dt * 24) this.particles.smoke(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4, 0.8, 'poof');
      if (Math.random() < dt * 10) this.particles.flame(x, y, z);
    };
    this.particles = new Particles(d.sheet.texture, d.sheet.white, (rect, rand, out) => d.sheet.chip(rect, rand, out));
    d.scene.add(this.particles.mesh);
    d.scope.defer(() => { this.entities.dispose(); this.particles.dispose(); d.scene.remove(this.particles.mesh); });
    if (this.controller) {
      this.controls = new Controls(d.scope, d.canvas, { creative: () => this.view?.mode === 'creative' });
      this.hand = new Hand(d.scene, d.camera, d.items, props.players.find(p => p.id === props.playerId)?.color ?? '#ffffff');
      this.screen = new ScreenFx(this.hand.overlay, d.engine.shared, this.still);
      d.scope.defer(() => { this.screen?.dispose(); this.hand?.dispose(); });
      this.interaction = new Interaction({
        getCell: this.getCell, overlay: this.overlay, sfx: d.sfx, particles: this.particles, hand: this.hand,
        tileOf: (cell, face) => d.sheet.tile(faceTexture(cell, face)), itemRect: id => d.sheet.item(id),
        light: (x, y, z) => d.engine.lightAt(x, y, z), bodies: () => this.entities.bodyBoxes(),
        predicted: (x, y, z) => this.recent.set(cellIndex(x, y, z), performance.now()),
      });
      configurePrediction({ nearTable: () => this.nearTable(), wake: () => { this.wake = true; } });
      d.scope.defer(() => configurePrediction(null));
      store.set({ body: null, target: null, mining: 0, screen: null, queue: [], selected: 0 });
      hud.set({ hurt: 0, underwater: false, using: 0, screen: null });
    }
  }

  frame(_now: number, dt: number) {
    const p = this.d.props();
    // The private view first: its ack prunes the overlay before the same snapshot's edits are applied.
    if (p.privateView && p.privateView !== this.pv) this.onPrivate(p.privateView);
    if (p.publicView && p.publicView !== this.view) this.onView(p.publicView, p.snapshotTime ?? p.serverNowMs());
    this.syncEdits();
    const serverNow = p.serverNowMs();
    this.d.music?.update(this.view?.time, p.connected);
    if (this.view) this.d.engine.setTime((this.viewTime + Math.min(40, Math.max(0, (performance.now() - this.viewAt) / 50))) % DAY_TICKS);
    const distance = store.get().settings.renderDistance;
    if (distance !== this.renderDistance) { this.renderDistance = distance; this.d.engine.setRenderDistance(distance); }
    if (this.controller) this.updateLocal(dt, p);
    else this.updateSpectator(dt);
    if (this.loading !== hud.get().loading) hud.set({ loading: this.loading });
    this.entities.update(serverNow, dt);
    this.d.engine.setGlows(this.entities.glows, this.entities.glowCount);
    this.entities.labels(this.d.camera, this.d.canvas.clientHeight);
    this.updateCracks();
    this.updateEmitters(dt);
    this.particles.update(dt, this.getCell);
    this.d.engine.update(this.d.camera, dt);
    // Listener yaw from the view direction (the spectator camera is not in YXZ order, so rotation.y is not its yaw).
    const c = this.d.camera, facing = c.getWorldDirection(this.facing);
    this.d.sfx.setListener(c.position.x, c.position.y, c.position.z, Math.atan2(-facing.x, -facing.z));
  }

  // Snapshots -------------------------------------------------------------------------------------------------
  private onView(view: View, serverTime: number) {
    const first = !this.view;
    this.view = view;
    this.viewTime = view.time;
    this.viewAt = performance.now();
    this.entities.push(view, serverTime, performance.now());
    if (first) this.lastFx = view.fx.reduce((max, fx) => Math.max(max, fx.id), -1);
    else for (const fx of view.fx) if (fx.id > this.lastFx) { this.lastFx = fx.id; this.playFx(fx); }
    const self = this.self();
    if (self && self.color !== this.shirt) { this.shirt = self.color; this.hand?.setShirt(self.color); }
  }

  /** True while a playing seat waits for the world around it: frozen, sending no position. */
  get loading() { return this.controller && !this.player; }
  private self() { return this.controller ? this.view?.players.find(pl => pl.id === this.d.props().playerId) : undefined; }

  /** Before the player appears: watch from its server position so the engine streams that area, then spawn there. */
  private waitForWorld() {
    const self = this.self();
    if (!self || !this.pv) return;
    this.d.camera.position.set(self.x, self.y + EYE_HEIGHT, self.z);
    this.d.camera.rotation.set(self.pitch, self.yaw, 0, 'YXZ');
    if (!this.d.engine.meshedAround(self.x, self.z)) return;
    this.player = new LocalPlayer(self.x, self.y, self.z);
    this.controls!.yaw = self.yaw;
    this.controls!.pitch = self.pitch;
  }

  private onPrivate(pv: PrivateView) {
    const previous = this.pv;
    this.pv = pv;
    const events = this.net.receive(pv, this.player?.body ?? null);
    if (this.overlay.prune(pv.ack) || events.first) this.sentRevision = -1;
    setServerView(pv);
    if (events.teleport) {
      this.player?.snap();
      this.interaction?.cancel();
      if (pv.tp.yaw !== undefined && this.controls) this.controls.yaw = pv.tp.yaw;
    }
    if (previous && pv.health < previous.health && !pv.dead && pv.mode === 'survival') {
      hud.set(state => ({ hurt: state.hurt + 1 }));
      this.effects.hurt();
      this.d.sfx.synth('hurt', { volume: 0.7 });
    }
    if (pv.dead && !previous?.dead) this.interaction?.cancel();
    const state = store.get();
    if (state.health !== pv.health || state.food !== pv.food) store.set({ health: pv.health, food: pv.food });
  }

  /** Send authoritative edits plus the overlay to the engine only when either changed. */
  private syncEdits() {
    if (!this.view) return;
    if (this.view.revision === this.sentRevision && this.overlay.version === this.sentOverlay) return;
    this.sentRevision = this.view.revision;
    this.sentOverlay = this.overlay.version;
    this.d.engine.setEdits(this.view.edits, this.overlay.values);
  }

  // Local player ----------------------------------------------------------------------------------------------
  private updateLocal(dt: number, p: Props) {
    const controls = this.controls!, player = this.player, pv = this.pv, view = this.view, state = store.get();
    const sleeping = !!(this.selfFlags() & PF.SLEEPING);
    const intent = controls.sample((pv?.food ?? 20) > 6 || view?.mode === 'creative');
    // In bed the server ignores movement; jumping or sneaking asks to get up (MC's "Leave bed").
    if (sleeping && !this.leavingBed && state.screen === null && (intent.jump || intent.sneak)) {
      this.leavingBed = true;
      sendCommand({ t: 'wake' });
    }
    if (!sleeping) this.leavingBed = false;
    const blocked = state.screen !== null || !pv || pv.dead || sleeping;
    if (blocked) {
      intent.forward = intent.strafe = 0;
      intent.jump = intent.sneak = intent.flyDown = intent.sprint = false;
      controls.sprinting = false;
      this.interaction!.cancel();
    }
    const mode = view?.mode ?? 'survival';
    if (!player || !pv) {
      this.waitForWorld();
      this.sendInput(p, null);
      return;
    }
    const body = player.body;
    if (controls.flyToggle) {
      controls.flyToggle = false;
      if (mode === 'creative' && !blocked) {
        body.flying = !body.flying;
        if (body.flying) body.vy = Math.max(body.vy, 2);
      }
    }
    const loaded = this.d.engine.world.isLoaded(body.x, body.z);
    const vyBefore = body.vy;
    if (!pv.dead && !sleeping) player.update(dt, intent, this.getCell, mode, loaded, state.settings.autoJump);
    this.fallSpeed = Math.min(this.fallSpeed, vyBefore);
    this.movementSounds(player, body);

    // Camera.
    const yaw = controls.yaw, pitch = controls.pitch, eyeY = player.eyeY();
    const underwater = eyeInWater(this.getCell, body), look = this.viewState;
    look.walked = player.walked;
    look.onGround = body.onGround;
    look.sprinting = controls.sprinting;
    look.flying = body.flying;
    look.underwater = underwater;
    look.dead = pv.dead;
    look.sleeping = sleeping;
    look.baseFov = state.settings.fov;
    look.portal = pv.dead ? 0 : pv.portal ?? 0;
    this.screen!.update(dt, !!pv.burning && !pv.dead, look.portal, this.d.camera.aspect);
    this.effects.apply(this.d.camera, player.render.x, eyeY, player.render.z, player.render.y, yaw, pitch, look, dt);
    if (underwater !== hud.get().underwater) { hud.set({ underwater }); this.d.engine.setUnderwater(underwater); }

    // Targeting: blocks through their selection boxes and mob boxes, nearest wins.
    const c = this.d.camera.position, eye = this.eye, dir = this.dir, reach = REACH[mode];
    eye[0] = c.x; eye[1] = c.y; eye[2] = c.z;
    dir[0] = -Math.sin(yaw) * Math.cos(pitch); dir[1] = Math.sin(pitch); dir[2] = -Math.cos(yaw) * Math.cos(pitch);
    const target = blocked ? null : pickTarget(raycastBlocks(this.getCell, eye, dir, reach), this.entities.mobBoxes(), eye, dir, reach);
    if (!sameTarget(target, state.target)) { store.set({ target }); this.d.engine.visuals.outline(target?.kind === 'block' ? target : null); }

    // Interaction.
    const inv = state.inv, held = inv[state.selected]?.id ?? 0, i = this.interaction!;
    if (!blocked) {
      const f = this.frameState;
      f.dt = dt; f.mode = mode; f.body = body; f.yaw = yaw; f.pitch = pitch; f.target = target; f.held = held; f.slot = state.selected; f.food = pv.food;
      f.hasArrows = held === I.bow && inv.some(slot => slot?.id === I.arrow);
      i.update(f, controls);
    }
    const using = i.useProgress();
    const mining = i.mine ? Math.round(i.progress * 10) / 10 : 0;
    if (mining !== state.mining) store.set({ mining });
    if (using !== hud.get().using) hud.set({ using: Math.round(using * 20) / 20 });

    // Hand.
    const pose = this.pose;
    pose.yawSpeed = dt > 0 ? wrapAngle(yaw - this.lastYaw) / dt : 0;
    pose.pitchSpeed = dt > 0 ? (pitch - this.lastPitch) / dt : 0;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    pose.mining = !!i.mine;
    pose.eating = i.using === 'eat' ? using : -1;
    pose.drawing = i.using === 'bow' ? using : -1;
    pose.bobPhase = this.effects.bobPhase;
    pose.bobAmount = this.still ? 0 : this.effects.bobAmount;
    this.d.engine.lightRgb(body.x, eyeY, body.z, this.handLight);
    pose.visible = !pv.dead && !sleeping;
    this.hand!.setItem(held);
    this.hand!.update(dt, pose);

    const now = performance.now();
    if (now - this.lastBodyPublish > BODY_PUBLISH_MS) { this.lastBodyPublish = now; store.set({ body: { ...body } }); }
    this.sendInput(p, body);
  }

  private selfFlags() { return this.view?.players.find(pl => pl.id === this.d.props().playerId)?.flags ?? 0; }

  private sendInput(p: Props, body: Body | null) {
    const now = performance.now();
    if (!this.wake && now - this.lastSend < INPUT_MS) return;
    this.wake = false;
    this.lastSend = now;
    const state = store.get(), i = this.interaction;
    p.setInput(buildInput({
      body, yaw: this.controls?.yaw ?? 0, pitch: this.controls?.pitch ?? 0, sprint: this.controls?.sprinting ?? false,
      using: !!i?.using, swinging: !!i?.swinging, dead: !!this.pv?.dead, slot: state.selected, mine: i?.mine ?? null,
      tpAck: this.net.tpAck, queue: state.queue,
    }));
  }

  /** Footsteps, landing dust and water splashes for the local player. */
  private movementSounds(player: LocalPlayer, body: Body) {
    if (body.onGround && !this.wasOnGround && this.fallSpeed < -7) {
      this.footstep(body.x, body.y, body.z, 0.7, true);
      this.stepDistance = 0;
    }
    if (body.onGround) this.fallSpeed = 0;
    this.wasOnGround = body.onGround;
    if (body.inWater && !this.wasInWater && body.vy < -3) {
      this.d.sfx.play('splash', { at: [body.x, body.y, body.z], volume: 0.8 });
      this.particles.splash(body.x, body.y + 0.2, body.z);
    }
    this.wasInWater = body.inWater;
    if (body.inWater && !body.onGround) {
      this.swimDistance += Math.hypot(body.vx, body.vz) * (1 / 60) + player.walked;
      if (this.swimDistance > 2.4) { this.swimDistance = 0; this.d.sfx.play('splash', { at: [body.x, body.y, body.z], volume: 0.15, pitch: 1.3 }); }
      return;
    }
    this.stepDistance += player.walked;
    if (this.stepDistance >= (body.sneaking ? 1.1 : STEP_DISTANCE)) {
      this.stepDistance = 0;
      this.footstep(body.x, body.y, body.z, body.sneaking ? 0.2 : 0.45, this.controls!.sprinting);
    }
  }

  /** Step sound (and optional dust) from the block under a pair of feet. */
  private footstep(x: number, y: number, z: number, volume: number, dust: boolean) {
    let cell = this.getCell(Math.floor(x), Math.floor(y - 0.05), Math.floor(z));
    if (!isSolid(cell)) cell = this.getCell(Math.floor(x), Math.floor(y - 0.6), Math.floor(z));
    if (!isSolid(cell) || cellId(cell) === B.barrier) return;
    this.d.sfx.play(stepSound(blockOf(cell).sound, Math.random() * 3), { at: [x, y, z], volume });
    if (dust) this.particles.dust(x, y, z, this.d.sheet.tile(faceTexture(cell, 3)), this.d.engine.lightAt(x, y + 0.5, z), 4);
  }

  /** True if a crafting table is within 4 blocks of the player (3×3 recipe-book crafts). */
  private nearTable(): boolean {
    const body = this.player?.body;
    if (!body) return false;
    const bx = Math.floor(body.x), by = Math.floor(body.y + 1), bz = Math.floor(body.z);
    for (let y = by - 4; y <= by + 4; y++) for (let z = bz - 4; z <= bz + 4; z++) for (let x = bx - 4; x <= bx + 4; x++) {
      if (cellId(this.getCell(x, y, z)) === B.crafting_table) return true;
    }
    return false;
  }

  // Display ---------------------------------------------------------------------------------------------------
  private updateSpectator(dt: number) {
    let count = 0;
    for (const actor of this.entities.players.values()) {
      if (actor.flags & (PF.DEAD | PF.OFFLINE)) continue;
      const s = this.subjects[count] ??= { key: '', x: 0, y: 0, z: 0, yaw: 0 };
      s.key = actor.id; s.x = actor.x; s.y = actor.y; s.z = actor.z; s.yaw = actor.yaw;
      count++;
    }
    this.subjects.length = count;
    const seed = this.d.seed;
    this.spectator.update(this.d.camera, this.subjects, this.getCell, (x, z) => this.groundY(seed, x, z), dt);
  }
  private groundY(seed: number, x: number, z: number) {
    const world = this.d.engine.world, bx = Math.floor(x), bz = Math.floor(z);
    if (world.isLoaded(bx, bz)) for (let y = 127; y > 0; y--) if (collisionBoxes(world.getCell(bx, y, bz)).length) return y + 1;
    return surfaceHeight(seed, bx, bz);
  }

  // World effects ---------------------------------------------------------------------------------------------
  /** Crack overlays: the local player's progress plus every remote player's reported stage. */
  private updateCracks() {
    let count = 0;
    const add = (x: number, y: number, z: number, stage: number) => {
      const crack = this.cracks[count++] ??= { x: 0, y: 0, z: 0, stage: 0 };
      crack.x = x; crack.y = y; crack.z = z; crack.stage = stage;
    };
    const mine = this.interaction?.mine;
    if (mine && this.interaction!.progress > 0) add(mine[0], mine[1], mine[2], crackStage(this.interaction!.progress));
    const self = this.d.props().playerId;
    if (this.view) for (const pl of this.view.players) if (pl.mine && pl.id !== self) add(pl.mine[0], pl.mine[1], pl.mine[2], pl.mine[3]);
    this.cracks.length = count;
    this.d.engine.visuals.cracks(this.cracks);
  }

  /** Rescan the blocks around the camera for particle emitters and spawner cages (twice a second). */
  private scanEmitters() {
    const c = this.d.camera.position, cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z), { emitters, sampled, spawners } = this;
    emitters.length = sampled.length = spawners.length = 0;
    let seen = 0;
    for (let y = cy - 6; y <= cy + 6; y++) for (let z = cz - 10; z <= cz + 10; z++) for (let x = cx - 10; x <= cx + 10; x++) {
      const cell = this.getCell(x, y, z), id = cellId(cell);
      if (!EMITTERS.has(id) || id === B.redstone_wire && !wirePower(cellState(cell))) continue;
      if (id === B.lava || id === B.nether_portal) {
        if (id === B.lava && !isAir(this.getCell(x, y + 1, z))) continue;
        // Reservoir sampling: every candidate has the same chance of being kept.
        const slot = seen++ < MAX_SAMPLED ? seen - 1 : Math.floor(Math.random() * seen);
        if (slot < MAX_SAMPLED) sampled.splice(slot * 4, 4, x, y, z, cell);
      } else if (emitters.length < MAX_EMITTERS * 4) emitters.push(x, y, z, cell);
      if (id === B.monster_spawner && spawners.length < MAX_SPAWNERS * 4) spawners.push(x, y, z, cellState(cell));
    }
    this.entities.setSpawners(spawners);
    // The portal hum, now and then, from a portal cell nearby.
    const portal = sampled.findIndex((_, i) => i % 4 === 3 && cellId(sampled[i]!) === B.nether_portal);
    if (portal >= 0 && (this.portalSound -= EMITTER_SCAN) <= 0) {
      this.portalSound = 4 + Math.random() * 6;
      this.d.sfx.synth('portal', { at: [sampled[portal - 3]! + 0.5, sampled[portal - 2]! + 0.5, sampled[portal - 1]! + 0.5], volume: 0.25 });
    }
  }

  /** Flames, smoke, redstone dust, portal motes and lava pops near the camera. */
  private updateEmitters(dt: number) {
    this.emitterWait -= dt;
    if (this.emitterWait <= 0) {
      this.emitterWait = EMITTER_SCAN;
      this.scanEmitters();
    }
    const { particles, light } = this, { sfx } = this.d;
    for (const list of this.emitterLists) for (let i = 0; i < list.length; i += 4) {
      const x = list[i]!, y = list[i + 1]!, z = list[i + 2]!, cell = list[i + 3]!, id = cellId(cell), r = Math.random();
      switch (id) {
        case B.torch: case B.redstone_torch: {
          const box = selectionBoxes(cell)[0];
          if (!box) continue;
          const fx = x + (box[0] + box[3]) / 2, fy = y + box[4] + 0.08, fz = z + (box[2] + box[5]) / 2;
          if (id === B.redstone_torch) { if (r < dt * 2.5) particles.redstone(fx, fy, fz); continue; }
          if (r < dt * 4) particles.flame(fx, fy, fz);
          if (Math.random() < dt * 0.9) particles.smoke(fx, fy + 0.08, fz, light(fx, fy, fz));
          break;
        }
        case B.furnace_lit: if (r < dt * 1.2) particles.smoke(x + 0.3 + Math.random() * 0.4, y + 1.02, z + 0.3 + Math.random() * 0.4, light(x + 0.5, y + 1.5, z + 0.5)); break;
        case B.redstone_wire: {
          const power = wirePower(cellState(cell)) / 15;
          if (r < dt * 1.6 * power) particles.redstone(x + 0.2 + Math.random() * 0.6, y + 0.1, z + 0.2 + Math.random() * 0.6, power);
          break;
        }
        case B.fire:
          if (r < dt * 2) particles.smoke(x + Math.random(), y + 0.9 + Math.random() * 0.3, z + Math.random(), 0.6);
          if (Math.random() < dt * 0.25) sfx.play('fire', { at: [x + 0.5, y + 0.5, z + 0.5], volume: 0.25, jitter: 0.25 });
          break;
        case B.monster_spawner:
          if (r < dt * 5) particles.flame(x + 0.2 + Math.random() * 0.6, y + 0.15 + Math.random() * 0.7, z + 0.2 + Math.random() * 0.6);
          if (Math.random() < dt * 2) particles.smoke(x + Math.random(), y + Math.random(), z + Math.random(), light(x + 0.5, y + 0.5, z + 0.5));
          break;
        case B.lava:
          if (r < dt * 0.2) {
            particles.pop(x + Math.random(), y + 0.9, z + Math.random());
            if (Math.random() < 0.3) sfx.synth('fizz', { at: [x + 0.5, y + 1, z + 0.5], volume: 0.1, pitch: 1.8 });
          }
          break;
        case B.nether_portal:
          // Motes right at the eye (standing in a portal) would fill the view: only farther cells emit.
          if (r < dt * 3 && this.d.camera.position.distanceToSquared(this.scratch.set(x + 0.5, y + 0.5, z + 0.5)) > 4) {
            // Motes drift in from either side of the portal plane.
            const across = cellState(cell) & PORTAL_Z, side = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.8), px = x + 0.5, py = y + Math.random(), pz = z + 0.5;
            const along = Math.random() - 0.5;
            particles.portal(px + (across ? side : along), py + (Math.random() - 0.5) * 0.6, pz + (across ? along : side), px + (across ? 0 : along), py, pz + (across ? along : 0));
          }
          break;
      }
    }
  }

  /** New values of the latest snapshot's edits (built only when an effect needs them, once per snapshot). */
  private editValue(x: number, y: number, z: number) {
    if (this.view && this.editsView !== this.view) {
      this.editsView = this.view;
      this.editValues.clear();
      for (const [index, value] of this.view.edits) this.editValues.set(index, value);
    }
    return this.editValues.get(cellIndex(x, y, z)) ?? this.getCell(x, y, z);
  }

  /**
   * Piston effect: a = moved direction + 8 × moved blocks, at the base. Extending, the head and pushed blocks slide out
   * one cell; retracting, the head slides back in (and a sticky piston's block with it). The world already holds the
   * result (this snapshot's edits), so the moving copies cover their veiled destination cells until they arrive.
   */
  private pistonSlide(fx: Fx) {
    const x = Math.floor(fx.x), y = Math.floor(fx.y), z = Math.floor(fx.z), a = fx.a ?? 0, dir = a & 7, moved = a >> 3, base = this.getCell(x, y, z), id = cellId(base);
    if (id !== B.piston && id !== B.sticky_piston || dir > 5) return;
    const [dx, dy, dz] = FACES[dir]!, facing = pistonFacing(cellState(base)), engine = this.d.engine;
    const slide = (tx: number, ty: number, tz: number, cell = this.editValue(tx, ty, tz), veil = true) => { if (inWorld(tx, ty, tz)) engine.slide(tx, ty, tz, cell, dx, dy, dz, PISTON_SLIDE, veil); };
    if (facing === dir) for (let k = 1; k <= moved + 1; k++) slide(x + dx * k, y + dy * k, z + dz * k);
    else {
      slide(x, y, z, makeCell(B.piston_head, facing | (id === B.sticky_piston ? PISTON_STICKY : 0)), false);
      if (moved) slide(x - dx, y - dy, z - dz);
    }
  }

  /** Play one authoritative effect (skipping the ones this client already predicted). */
  private playFx(fx: Fx) {
    const { sfx, sheet, engine } = this.d, at = [fx.x, fx.y, fx.z] as const, now = performance.now(), particles = this.particles;
    // Block effects sit at the cell centre: match them to predictions by the cell they are in.
    const cx = Math.floor(fx.x), cy = Math.floor(fx.y), cz = Math.floor(fx.z), index = inWorld(cx, cy, cz) ? cellIndex(cx, cy, cz) : -1;
    const predicted = index >= 0 && now - (this.recent.get(index) ?? -Infinity) < FX_DEDUPE_MS;
    if (this.recent.size > 64) for (const [k, t] of this.recent) if (now - t > FX_DEDUPE_MS) this.recent.delete(k);
    const mob = MOB_TYPES[fx.a ?? -1]?.key;
    const voice = (volume: number, pitch: number) => {
      if (!mob) return;
      const sample = mobVoice(mob, Math.random() * 3), synth = mobSynth(mob), range = mob === 'ghast' ? 48 : undefined;
      if (sample) sfx.play(sample, { at, volume, pitch: pitch * mobPitch(mob) });
      else if (synth) sfx.synth(synth, range ? { at, volume, pitch, range } : { at, volume, pitch });
    };
    switch (fx.k) {
      case 'break': case 'place': {
        if (predicted) return;
        const cell = fx.a ?? 0, block = blockOf(cell);
        sfx.play(impactSound(block.sound, Math.random() * 3), { at: [fx.x + 0.5, fx.y + 0.5, fx.z + 0.5], pitch: IMPACT_PITCH[fx.k] });
        if (fx.k === 'break') this.particles.breakBlock(fx.x, fx.y, fx.z, sheet.tile(faceTexture(cell, 4)), engine.lightAt(fx.x + 0.5, fx.y + 0.5, fx.z + 0.5));
        return;
      }
      case 'door': if (!predicted) sfx.play(cellState(fx.a ?? 0) & 4 ? 'open' : 'close', { at }); return;
      case 'hit': sfx.play(`impact-hit-${Math.floor(Math.random() * 3)}`, { at, volume: 0.8 }); return;
      case 'explode':
        sfx.play('explode', { at, volume: 1.2 });
        this.particles.explosion(fx.x, fx.y, fx.z);
        if (this.player && Math.hypot(this.player.body.x - fx.x, this.player.body.y - fx.y, this.player.body.z - fx.z) < 10) this.effects.hurt();
        return;
      case 'mob': voice(0.6, 1); return;
      case 'hurtMob':
        sfx.play(`impact-hit-${Math.floor(Math.random() * 3)}`, { at, volume: 0.7 });
        voice(0.6, 1.3);
        return;
      case 'die': {
        voice(0.7, 0.75);
        for (let i = 0; i < 8; i++) this.particles.smoke(fx.x + (Math.random() - 0.5) * 0.8, fx.y + Math.random(), fx.z + (Math.random() - 0.5) * 0.8, engine.lightAt(fx.x, fx.y + 0.5, fx.z), 'poof');
        return;
      }
      case 'pickup': sfx.play('pickup', { at, volume: 0.5, pitch: 1.2, jitter: 0.3 }); return;
      case 'eat': if (!this.isSelf(fx)) sfx.synth('eat', { at }); return;
      case 'splash': sfx.play('splash', { at }); this.particles.splash(fx.x, fx.y, fx.z); return;
      case 'bow': sfx.play('bow', { at }); return;
      case 'chest': sfx.play(fx.a === 0 ? 'chest-close' : 'chest-open', { at }); return;
      case 'furnace': sfx.play('fire', { at, volume: 0.35 }); return;
      case 'craft': sfx.play('craft', { at, volume: 0.6 }); return;
      case 'levelup': sfx.synth('levelup', { at }); return;
      case 'portal':
        sfx.synth('portal', { at, volume: 0.6 });
        for (let i = 0; i < 16; i++) particles.portal(fx.x + (Math.random() - 0.5) * 3, fx.y + (Math.random() - 0.5) * 3, fx.z + (Math.random() - 0.5) * 3, fx.x, fx.y, fx.z);
        return;
      case 'travel':
        sfx.synth('travel', { at, volume: 0.8 });
        if (this.isSelf(fx)) this.screen?.flash();
        return;
      case 'ignite':
        if (!predicted) sfx.synth('scrape', { at, volume: 0.8 });
        sfx.play('fire', { at, volume: 0.5 });
        for (let i = 0; i < 4; i++) particles.flame(fx.x + (Math.random() - 0.5) * 0.6, fx.y - 0.3, fx.z + (Math.random() - 0.5) * 0.6);
        return;
      case 'fizz':
        sfx.synth('fizz', { at, volume: 0.8 });
        for (let i = 0; i < 8; i++) particles.smoke(fx.x + (Math.random() - 0.5) * 0.8, fx.y + Math.random() * 0.4, fx.z + (Math.random() - 0.5) * 0.8, 1, 'poof');
        return;
      case 'lever': if (!predicted) sfx.synth('click', { at, pitch: fx.a ? 0.75 : 0.65, volume: 0.9 }); return;
      case 'button': if (!predicted || !fx.a) sfx.synth('click', { at, pitch: fx.a ? 0.95 : 0.8, volume: 0.8 }); return;
      case 'lamp': sfx.synth('click', { at, pitch: 1.5, volume: 0.3 }); return;
      case 'piston': sfx.synth('piston', { at, volume: 0.8 }); this.pistonSlide(fx); return;
      case 'tnt': sfx.play('fuse', { at, volume: 1 }); return;
      case 'trade': sfx.synth('villager', { at, pitch: 1.3 }); particles.happy(fx.x, fx.y, fx.z); return;
      case 'spawner':
        sfx.play('fire', { at, volume: 0.35, pitch: 1.3 });
        for (let i = 0; i < 12; i++) particles.flame(fx.x + (Math.random() - 0.5) * 2, fx.y + Math.random(), fx.z + (Math.random() - 0.5) * 2);
        return;
      case 'ghast': sfx.synth('ghast', { at, range: 48 }); return;
      case 'fireball': sfx.synth('shriek', { at, range: 48 }); sfx.play('fire', { at, volume: 0.6 }); return;
    }
  }
  private isSelf(fx: Fx) {
    const body = this.player?.body;
    return !!body && Math.hypot(body.x - fx.x, body.z - fx.z) < 1.5;
  }
}
