import * as THREE from 'three';
import { createContext, withContext, rng, G } from '../upstream/src/core/ctx.js';
import { DEFAULT_SETTINGS, TEAM_PALETTES, WEAPON_ORDER, mapNoBots } from '../upstream/src/config.js';
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
import '../upstream/src/game/kits/index.js';

// Keep the original gameplay grid and collision code; a server has no paint atlas or character meshes.
class ServerPaint extends PaintSystem {
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

export class Engine {
  constructor(players, settings, seed, roundId = '') {
    this.settings = settings; this.roundId = roundId;
    this.context = createContext({ headless: true, random: rng(seed), settings: { ...DEFAULT_SETTINGS }, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), audio: silent, fx: silent, mode: 'match', time: 0 });
    this.events = []; this.sequence = 0; this.revision = 0; this.inkSequence = 0; this.ink = ''; this.baselineAt = -1;
    this.run(() => {
      G.teamHex = [TEAM_PALETTES[0].a, TEAM_PALETTES[0].b]; G.teamColors = G.teamHex.map(c => new THREE.Color(c));
      const props = new PropKit(null, { headless: true }), colliders = [];
      for (const item of dressingFor(settings.map)) if (inMode(item, settings.mode)) colliders.push(...props.add(item.type, item).colliders);
      G.level = new Level(layoutFor(MAP_LAYOUTS[settings.map], settings.mode), colliders);
      G.physics = new Physics(G.level); G.nav = new NavGraph(G.level, G.physics); G.paint = new ServerPaint(null, G.level);
      G.projectiles = new Projectiles(G.scene); G.subs = new SubSystem(G.scene); G.specials = new SpecialSystem(G.scene);
      this.roster = Array.from({ length: mapNoBots(settings.map) ? players.length : 8 }, (_, index) => {
        const player = players[index], choice = player?.lobbyChoice || {};
        return { nid: index, owner: 'server', bot: !player, team: settings.mode === 'boss' ? 0 : index % 2, slot: settings.mode === 'boss' ? index : Math.floor(index / 2), id: player?.id || `bot-${index}`, name: player?.name || `CPU ${index + 1}`, weapon: choice.weapon || WEAPON_ORDER[index % WEAPON_ORDER.length], sub: choice.sub || null, special: choice.special || null, style: choice.style || {} };
      });
      this.match = G.match = new Match({ roster: this.roster, myId: 'server', host: true, CharacterClass: ServerCharacter, duration: settings.duration, difficulty: settings.difficulty, mode: settings.mode });
      this.match.setup(); this.match.controller = null;
      this.net = new NetMatch({ myId: 'server', isHost: true, _members: new Map([['server', {}]]) }, { map: settings.map }); this.net.bind(this.match);
      this.net._rec = event => this.events.push([++this.sequence, ...event]);
      this.match.start(); this.snapshotInk();
    });
  }
  run(fn) { return withContext(this.context, fn); }
  snapshotInk() {
    const grid = G.paint.grid, packed = Buffer.alloc(Math.ceil(grid.length / 4));
    for (let i = 0; i < grid.length; i++) packed[i >> 2] |= grid[i] << ((i % 4) * 2);
    this.ink = packed.toString('base64'); this.inkSequence = this.sequence; this.revision++; this.baselineAt = G.time;
  }
  tick(inputs, dt, elapsed = dt) {
    this.run(() => {
      G.time += dt;
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
      if (G.time - this.baselineAt >= 1) this.snapshotInk();
      this.events = this.events.filter(event => event[0] > this.inkSequence || event[0] > this.sequence - 128);
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
  view() {
    return this.run(() => ({ roundId: this.roundId, settings: this.settings, boss: this.match.boss?.pack(true) || null, bossMoves: this.match.boss?.hz.moves || [], roster: this.roster, colors: G.teamHex, teams: TEAM_PALETTES[0].names, actors: this.match.actors.map(packActor), events: this.events, beacons: G.subs.items.filter(item => item.state === 'beacon').map(item => [item.owner.nid, item.gid, ...item.pos.toArray(), ...item.normal.toArray(), item.uses]), revision: this.revision, ink: this.ink, inkSequence: this.inkSequence, time: this.match.time, state: this.match.state, coverage: G.paint.coverage(), zones: this.match.zones?.state() || null, stats: this.match.actors.map(a => ({ ...a.stats })), result: this.match.result }));
  }
  dispose() { this.run(() => { this.net.dispose(); this.match.dispose(); G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.listeners.clear(); }); }
}
