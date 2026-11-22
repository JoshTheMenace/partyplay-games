import * as THREE from 'three';
import { createContext, withContext, rng, on, G } from '../upstream/src/core/ctx.js';
import { DEFAULT_SETTINGS, TEAM_PALETTES, mapNoBots } from '../upstream/src/config.js';
import { MAP_LAYOUTS } from '../upstream/src/world/maps.js';
import { Level } from '../upstream/src/world/level.js';
import { PaintSystem } from '../upstream/src/world/paint.js';
import { PropKit } from '../upstream/src/world/props.js';
import { dressingFor } from '../upstream/src/world/dressing.js';
import { layoutFor, inMode } from '../upstream/src/world/variants.js';
import { Physics } from '../upstream/src/game/physics.js';
import { NavGraph } from '../upstream/src/game/nav.js';
import { Match } from '../upstream/src/game/match.js';
import { BotBrain } from '../upstream/src/game/bots.js';
import { Projectiles } from '../upstream/src/game/weapons.js';
import { SubSystem } from '../upstream/src/game/subs.js';
import { SpecialSystem } from '../upstream/src/game/specials.js';
import { NetMatch, packActor } from '../upstream/src/net/netmatch.js';
import { packInk } from '../public/arenas.js';
import '../upstream/src/game/kits/index.js';

// Every event rides in two or three consecutive 20 Hz snapshots, so a screen that skips one still sees it once.
// A screen that falls further behind repaints from the next paint baseline instead (public/platform.js).
const EVENT_WINDOW = .11, BASELINE_EVERY = 2;
const r2 = value => Math.round(value * 100) / 100;

// Keep the original gameplay grid and collision code; a server has no paint atlas or character meshes.
let paintTemplate = null;
class ServerPaint extends PaintSystem {
  // Arenas of one room share a stage: the second and later grids copy the first one's buried-cell map instead of
  // probing a quarter of a million cells against the level again. The per-face layout already sits on the shared faces.
  _initGrid() {
    const template = paintTemplate; if (!template) return super._initGrid();
    this.grid = new Uint8Array(template.grid.length); this.dead = template.dead; this.turfTotal = template.turfTotal; this.turfArea = template.turfArea; this.counts = [0, 0];
  }
  _initGPU() {}
  _emitGrowth() {}
  splat(...args) { const area = super.splat(...args); this.growing.length = 0; return area; }
  flush(dt) {
    this.clock += dt;
    for (const job of this._floods) {
      job.t += dt;
      const fraction = Math.min(1, job.t / job.dur), radius = fraction === 1 ? Infinity : job.reach * (job.ease === 'linear' ? fraction : 1 - (1 - fraction) ** 2);
      while (job.i < job.prep.n && job.prep.dist[job.i] <= radius) {
        const cell = job.prep.order[job.i++], previous = this.grid[cell], value = job.team + 1;
        if (previous === value) continue;
        this.grid[cell] = value;
        if (previous) this.counts[previous - 1]--;
        if (value) this.counts[value - 1]++;
        this.version++;
      }
    }
    this._floods = this._floods.filter(job => job.t < job.dur);
  }
}
class ServerCharacter {
  root = new THREE.Group();
  setVisible(value) { this.root.visible = value; }
  getMuzzle(out) { return this.root.localToWorld(out.set(0, 1.2, .45)); }
  setWeapon() {} setSub() {} setColor() {} setHurt() {} trigger() {} update() {} dispose() {}
}
const silentLoop = { set() {}, stop() {}, playing: false };
const silent = new Proxy({}, { get: (_, key) => () => key === 'loop' ? silentLoop : undefined });

/** One arena: the original match, stage, paint grid and CPUs for up to eight seats, in a context of its own. */
export class Engine {
  /** `world` is another arena's `world` on the same stage and mode: collision, navigation and paint layout are static and shared. */
  constructor(roster, settings, seed, phase = 0, world = null) {
    this.settings = settings; this.roster = roster;
    this.context = createContext({ headless: true, random: rng(seed), settings: { ...DEFAULT_SETTINGS }, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), audio: silent, fx: silent, mode: 'match', time: 0 });
    this.events = []; this.sequence = 0; this.eventBase = 0; this.inkSequence = 0; this.ink = ''; this.baselines = 0; this.baselineAt = -1; this.ticks = 0;
    this.run(() => {
      G.teamHex = [TEAM_PALETTES[0].a, TEAM_PALETTES[0].b]; G.teamColors = G.teamHex.map(c => new THREE.Color(c));
      if (!world) {
        const props = new PropKit(null, { headless: true }), colliders = [];
        for (const item of dressingFor(settings.map)) if (inMode(item, settings.mode)) colliders.push(...props.add(item.type, item).colliders);
        const level = new Level(layoutFor(MAP_LAYOUTS[settings.map], settings.mode), colliders), physics = new Physics(level);
        world = { level, physics, nav: new NavGraph(level, physics), paint: null };
      }
      this.world = world; G.level = world.level; G.physics = world.physics; G.nav = world.nav;
      try { paintTemplate = world.paint; G.paint = new ServerPaint(null, G.level); } finally { paintTemplate = null; }
      world.paint ||= G.paint;
      G.projectiles = new Projectiles(G.scene); G.subs = new SubSystem(G.scene); G.specials = new SpecialSystem(G.scene);
      this.match = G.match = new Match({ roster, myId: 'server', host: true, CharacterClass: ServerCharacter, duration: settings.duration, difficulty: settings.difficulty, mode: settings.mode });
      this.match.setup(); this.match.controller = null;
      this.net = new NetMatch({ myId: 'server', isHost: true, _members: new Map([['server', {}]]) }, { map: settings.map }); this.net.bind(this.match);
      // [sequence, simulation time, ...the original event]: screens replay it on the same clock as the actors.
      this.net._rec = event => this.events.push([++this.sequence, r2(G.time), ...event]);
      // Hits are decided here, so a phone only learns of one from this: ['d', victim, attacker or -1, damage]. Enough for
      // its hit marker and the "ink from that side" flash; streams of damage (a storm, a vortex) merge into one a tenth of a second.
      const recent = new Map();
      on('damage', ({ victim, attacker, amount }) => {
        if (victim.nid === undefined || victim.isBot && (!attacker || attacker.isBot)) return;
        const key = victim.nid * 16 + (attacker?.nid ?? 15), last = recent.get(key);
        if (last && G.time - last[1] < .1) { last[5] = Math.round(last[5] + amount); return; }
        const event = [++this.sequence, r2(G.time), 'd', victim.nid, attacker?.nid ?? -1, Math.round(amount)];
        recent.set(key, event); this.events.push(event);
      });
      this.match.start(); this.snapshotInk(); this.baselineAt -= phase * BASELINE_EVERY;
    });
  }
  get result() { return this.match.result; }
  get state() { return this.match.state; }
  get time() { return this.match.time; }
  run(fn) { return withContext(this.context, fn); }
  snapshotInk() { this.ink = packInk(G.paint.grid); this.inkSequence = this.sequence; this.baselines++; this.baselineAt = G.time; }
  /** A fresh baseline right now, for a screen that is about to start watching this arena. */
  rebaseline() { this.run(() => this.snapshotInk()); }
  tick(inputs, dt, elapsed = dt) {
    this.run(() => {
      G.time += dt; this.ticks++;
      const skipped = Math.max(0, elapsed - dt);
      this.match.stateT += skipped;
      if (this.match.playing()) this.match.time = Math.max(0, this.match.time - skipped);
      for (const [index, actor] of this.match.actors.entries()) {
        if (actor.bot) continue;
        const input = inputs.get(this.roster[index].id);
        actor.intent.move.set(0, 0, 0);
        for (const key of ['fire', 'squid', 'jump', 'sub', 'special', 'cheer']) actor.intent[key] = this.match.playing() && !!input?.[key];
        if (!this.match.playing() || !input) continue;
        if (input.hasAim) { actor.aimYaw = input.yaw; actor.aimPitch = input.pitch; actor.aimPoint.set(input.aimX, input.aimY, input.aimZ); }
        const sy = Math.sin(actor.aimYaw), cy = Math.cos(actor.aimYaw), cp = Math.cos(actor.aimPitch);
        actor.intent.move.set(input.moveX, 0, input.moveY);
        actor.aimDir.set(sy * cp, Math.sin(actor.aimPitch), cy * cp);
      }
      this.match.update(dt); G.projectiles.update(dt); G.subs.update(dt); G.specials.update(dt); G.paint.flush(dt);
      if (G.time - this.baselineAt >= BASELINE_EVERY) this.snapshotInk();
      let stale = 0; while (stale < this.events.length && this.events[stale][1] < G.time - EVENT_WINDOW) stale++;
      if (stale) { this.eventBase = this.events[stale - 1][0]; this.events.splice(0, stale); }
    });
  }
  presence(id, connected) {
    this.run(() => {
      const actor = this.match.actors[this.roster.findIndex(p => p.id === id)]; if (!actor) return;
      if (!mapNoBots(this.settings.map)) { actor.bot = connected ? null : new BotBrain(actor, this.settings.difficulty); return; }
      // Keep the seat for reconnect, but never replace a Cargo Terminal human with a CPU.
      if (connected) actor.respawnTimer = 0;
      else { actor.alive = false; actor.respawnTimer = this.settings.duration + 600; actor.weaponRunner.reset(); actor.character.setVisible(false); }
    });
  }
  action(id, action) {
    this.run(() => {
      const actor = this.match.actors[this.roster.findIndex(player => player.id === id)];
      if (!actor?.alive || !this.match.playing()) throw new Error('Wait until you are back in play.');
      if (action.type === 'superjump') {
        const target = this.match.actors[action.target];
        if (!actor.canSuperJump() || action.target !== -1 && (!target?.alive || target === actor || target.team !== actor.team || target.superJumpState)) throw new Error('Choose a living teammate or your base.');
        actor.superJump(action.target === -1 ? G.level.spawnPads[actor.team].clone() : target);
      } else if (action.type === 'beacon') {
        const beacon = G.subs.beaconsFor(actor.team).find(item => item.gid === action.target);
        if (!actor.canSuperJump() || !beacon || !G.subs.jumpToBeacon(actor, beacon)) throw new Error('That beacon is no longer available.');
      } else {
        const special = actor.specialActive, bounds = G.level.bounds;
        if (special?.id !== 'strike' || !special.aiming || special.confirm) throw new Error('Vortex Strike is not targeting.');
        special.target.x = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, action.x)); special.target.z = Math.max(bounds.minZ + 2, Math.min(bounds.maxZ - 2, action.z));
        G.specials.aimConfirm(actor);
      }
    });
  }
  /** Per actor: turf, splats, splatted, specials, boss damage, weak-point hits, zone turf. */
  stats() { return this.match.actors.map(({ stats }) => [Math.round(stats.turf), stats.splats, stats.deaths, stats.specials, Math.round(stats.bossDmg || 0), stats.weakHits || 0, Math.round(stats.zoneTurf || 0)]); }
  coverage() { return this.run(() => G.paint.coverage().map(value => Math.round(value * 1e4) / 1e4)); }
  /** Everything a screen needs to draw this arena this snapshot. Built at most once per tick. */
  feed() {
    if (this.fed?.tick === this.ticks) return this.fed.feed;
    const feed = this.run(() => ({ t: Math.round(G.time * 1000) / 1000, actors: this.match.actors.map(packActor), events: this.events.slice(), eventBase: this.eventBase, beacons: G.subs.items.filter(item => item.state === 'beacon').map(item => [item.owner.nid, item.gid, ...item.pos.toArray(), ...item.normal.toArray(), item.uses]), time: r2(this.match.time), state: this.match.state, coverage: G.paint.coverage().map(value => Math.round(value * 1e4) / 1e4), zones: this.match.zones?.state() || null, boss: this.match.boss?.pack(true) || null, bossMoves: this.match.boss?.hz.moves.slice() || [], stats: this.stats(), result: this.match.result }));
    this.fed = { tick: this.ticks, feed };
    return feed;
  }
  dispose() { this.run(() => { this.net.dispose(); this.match.dispose(); G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.listeners.clear(); }); }
}
