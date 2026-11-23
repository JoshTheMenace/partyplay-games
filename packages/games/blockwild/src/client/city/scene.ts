/**
 * Caper City on a screen: the pieces a Runtime adds when the world is the city. It owns the crowd and vehicle
 * renderers, the gig beacon, the local driving controller and its chase camera, and it publishes what the city HUD
 * needs (the prompt under the crosshair, who is being looked at, the vehicle being driven).
 */
import { AdditiveBlending, BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { isSolid } from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import { describe, cityPeople, type People } from '../../shared/city/people';
import { cityPlan, GROUND, type CityPlan } from '../../shared/city/plan';
import { newRide, RIDES, stepRide, type Ride, type RideInput } from '../../shared/city/vehicles';
import type { MoveIntent } from '../../shared/physics';
import { CITY_ID, CITY_PLAYER_ID, PF, type Fx, type PrivateView, type PubNpc, type Scene, type View } from '../../shared/protocol';
import { raycastBlocks } from '../../shared/raycast';
import type { Sfx } from '../audio/sfx';
import { lerp, lerpAngle, type Interpolator } from '../game/interp';
import type { Particles } from '../game/particles';
import { TINTS } from '../game/particles';
import { createStore } from '../store';
import { Crowd } from './crowd';
import { cityExtras, spotNear, type Extras, type Spot } from '../../shared/city/extras';
import { CHARACTERS, CITY_GUIDE, standings, stepOf } from '../../shared/city/story';
import { feed } from '../game/feed';
import { EV } from '../../shared/protocol';
import { Props, type Floater } from './props';
import { Rides, type Shown } from './rides';

type Light = (x: number, y: number, z: number, out: [number, number, number]) => readonly [number, number, number];
/** What the city HUD shows that only the scene knows. */
export type CityHud = {
  /** The thing the context button acts on: a vehicle to board or leave, a resident to talk to, a board to read. */
  context: { kind: 'enter' | 'exit' | 'talk' | 'shop' | 'board' | 'give' | 'spot'; id: number; label: string } | null;
  /** The resident under the crosshair: name and what they are doing. */
  focus: { name: string; line: string } | null;
  /** The vehicle driven: its kind and speed (blocks a second). */
  driving: { k: number; speed: number; seat: number } | null;
  /** Counts up whenever the local vehicle crashes (the HUD shakes its speedometer). */
  crashes: number;
  /** The spot the player is standing at or parked on (a race start, the spray pad…), when it is something to do from a driving seat. */
  spot: { id: number; label: string } | null;
};
export const cityHud = createStore<CityHud>({ context: null, focus: null, driving: null, crashes: 0, spot: null });
/** Colours of the things that go on in the city, by EV kind (for beacons, hovering marks and the map). */
export const EVENT_COLORS = [0x2fa69a, 0xffd24a, 0xff5748, 0xffd24a, 0x78d955, 0x6b7280, 0xff5748, 0xb58aff, 0xfff6e5];
/** Where the local player faces (their view on foot, the vehicle's nose when driving): the minimap's arrow reads it. */
export const cityLook = { yaw: 0 };
/** The spots of the city being drawn (the HUD looks a context button's spot up here). */
export const spots: { list: readonly Spot[] } = { list: [] };
/** Coins handed over by one press of Give. */
export const GIFT = 10;

export type CityDeps = { scene: Object3D; camera: PerspectiveCamera; seed: number; sfx: Sfx; particles: Particles; light: Light; getCell: CellReader };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The local player's own vehicle: the shared physics stepped at 60 Hz, with the pose before each step kept for smooth drawing. */
export class Drive {
  readonly ride: Ride;
  readonly render = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private readonly prev = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private acc = 0;
  private beat = 0;
  constructor(readonly id: number, readonly k: number, x: number, y: number, z: number, yaw: number) {
    this.ride = newRide(x, y, z, yaw);
    Object.assign(this.prev, { x, y, z, yaw });
    Object.assign(this.render, { x, y, z, yaw });
  }
  /** Snap to a server teleport (a rejected move, or the start). */
  reset(x: number, y: number, z: number) { Object.assign(this.ride, { x, y, z, speed: 0, vy: 0 }); Object.assign(this.prev, { x, y, z }); this.acc = 0; }
  /** Advance by a frame. Returns the hardest impact of the frame (m/s lost). */
  update(dt: number, intent: MoveIntent, getCell: CellReader, loaded: boolean, others: Rides, sfx: Sfx): number {
    const kind = RIDES[this.k]!, r = this.ride, input: RideInput = { throttle: intent.forward, steer: intent.strafe, brake: !kind.air && intent.jump, up: intent.jump, down: intent.sneak || intent.flyDown };
    let crash = 0;
    if (loaded) {
      this.acc = Math.min(this.acc + dt, 0.2);
      while (this.acc >= 1 / 60) {
        this.acc -= 1 / 60;
        Object.assign(this.prev, { x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch });
        stepRide(r, kind, input, 1 / 60, getCell);
        crash = Math.max(crash, r.crash);
        // Other vehicles are solid to this one: bounce off whatever it has driven into.
        const other = others.nearest(r.x, r.z, 0.4, this.id);
        if (other && Math.abs(other.y - r.y) < 2 && Math.hypot(other.x - r.x, other.z - r.z) < (Math.max(kind.w, kind.l) + Math.max(RIDES[other.k]!.w, RIDES[other.k]!.l)) * 0.36) {
          crash = Math.max(crash, Math.abs(r.speed));
          Object.assign(r, { x: this.prev.x, z: this.prev.z, speed: -r.speed * 0.25 });
        }
      }
    }
    const t = this.acc * 60;
    Object.assign(this.render, { x: lerp(this.prev.x, r.x, t), y: lerp(this.prev.y, r.y, t), z: lerp(this.prev.z, r.z, t), yaw: lerpAngle(this.prev.yaw, r.yaw, t), pitch: lerp(this.prev.pitch, r.pitch, t) });
    // The engine: one beat after another, quicker with speed.
    this.beat -= dt;
    if (this.beat <= 0 && (Math.abs(r.speed) > 0.5 || input.throttle || kind.air && !r.onGround)) {
      this.beat = 0.2 - Math.min(0.13, Math.abs(r.speed) / kind.top * 0.13);
      sfx.synth('putt', { volume: 0.2, pitch: (kind.wheels === 2 ? 1.5 : kind.air ? 0.8 : 1) * (0.8 + Math.abs(r.speed) / kind.top * 0.8), jitter: 0.03 });
    }
    return crash;
  }
}

export class CityScene {
  readonly plan: CityPlan;
  readonly people: People;
  readonly crowd: Crowd;
  readonly rides: Rides;
  readonly props: Props;
  readonly extras: Extras;
  /** What is going on in the city, as last told (the public view carries it about once a second). */
  events: number[][] = [];
  drive: Drive | null = null;
  private readonly beacon: Mesh;
  private readonly live: PubNpc[] = [];
  private readonly eye = new Vector3();
  /** Where the chase camera looks (the view keeps this heading when the player steps out). */
  heading = 0;
  private camYaw = 0;
  private camPitch = -0.28;
  private lookedAt = 0;
  private time = 0;
  /** Smoke still hanging (a puff's effect names how long). */
  private readonly clouds: { x: number; y: number; z: number; until: number }[] = [];
  private readonly feathers: (readonly [number, number, number])[] = [];
  private readonly marks: [number, number, number, number][] = [];
  private readonly fires: [number, number, number][] = [];
  /** Checkpoints to draw: the next flag of the local player's race ([x, z, yaw, colour]). */
  readonly gates: [number, number, number, number][] = [];
  /** Where a seat is on this screen right now (set by the Runtime: the gull rides its holder, a bounty hangs over a head). */
  seatAt: (seat: number) => { x: number; y: number; z: number; yaw: number } | null = () => null;
  races: number[][] = [];

  constructor(private readonly d: CityDeps) {
    this.plan = cityPlan(d.seed);
    this.people = cityPeople(d.seed);
    this.crowd = new Crowd(d.scene, this.people, d.light);
    this.rides = new Rides(d.scene, d.light);
    this.props = new Props(d.scene, d.light);
    this.extras = cityExtras(d.seed);
    this.crowd.guides = standings(d.seed);
    spots.list = this.extras.spots;
    // The gig beacon: a tall shaft of light over where to go.
    this.beacon = new Mesh(new BoxGeometry(1.6, 40, 1.6).translate(0, 20, 0), new MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, fog: false }));
    this.beacon.visible = false;
    this.beacon.renderOrder = 8;
    d.scene.add(this.beacon);
    cityHud.set({ context: null, focus: null, driving: null, spot: null });
  }

  /** What the button at a spot says right now. */
  spotLabel(spot: Spot, city: PrivateView['city'] | null | undefined): string {
    if (spot.kind === 'race') { const forming = this.races.find(race => race[1] === spot.a && race[2] === 0); return city?.race ? 'You are in: line up' : forming ? `Join the ${this.extras.courses[spot.a]!.name} (${forming[3]}s)` : spot.label; }
    if (city?.hold !== undefined && (spot.kind === 'vault' || spot.kind === 'alarm' || spot.kind === 'lock')) return spot.kind === 'vault' ? 'Stop cracking' : spot.kind === 'alarm' ? 'Let go of the bell' : 'Leave the lock';
    return spot.label;
  }
  /** The spot at (x, y, z) that can be used now: `driving` picks the ones worked from a vehicle. */
  spotAt(x: number, y: number, z: number, driving: boolean): Spot | null {
    const spot = spotNear(this.extras, x, y, z);
    return spot && (spot.kind === 'race' || spot.kind === 'paint') === driving ? spot : null;
  }

  /** Start, stop or resync the local vehicle from the private view (the server's teleport has already moved the body). */
  sync(pv: PrivateView, body: { x: number; y: number; z: number } | null, yaw: number, teleported: boolean) {
    const ride = pv.city?.ride;
    if (!ride || ride[2] !== 0 || !body) { this.drive = null; return; }
    if (this.drive?.id !== ride[0]) { this.drive = new Drive(ride[0], ride[1], body.x, body.y, body.z, yaw); this.camYaw = yaw; this.camPitch = -0.28; }
    else if (teleported) this.drive.reset(body.x, body.y, body.z);
  }

  /** The chase camera behind a vehicle at (x, y, z) heading `yaw`; `look` is this frame's mouse or thumb drag (radians). */
  chase(camera: PerspectiveCamera, x: number, y: number, z: number, yaw: number, k: number, speed: number, lookYaw: number, lookPitch: number, dt: number, fov: number) {
    const kind = RIDES[k]!;
    this.time += dt;
    if (lookYaw || lookPitch) this.lookedAt = this.time;
    this.camYaw += lookYaw;
    this.camPitch = Math.max(-1.2, Math.min(0.35, this.camPitch + lookPitch));
    // Left alone, the camera swings back behind the vehicle.
    if (this.time - this.lookedAt > 1.2) {
      const ease = 1 - Math.exp(-(Math.abs(speed) > 1 ? 4 : 1.2) * dt);
      this.camYaw += wrap(yaw - this.camYaw) * ease;
      this.camPitch += ((kind.air ? -0.36 : -0.26) - this.camPitch) * ease;
    }
    const target: [number, number, number] = [x, y + Math.min(2.2, kind.h) + 0.5, z], distance = kind.l * 0.9 + (kind.air ? 6.5 : 3.6);
    const cos = Math.cos(this.camPitch), back: [number, number, number] = [Math.sin(this.camYaw) * cos, -Math.sin(this.camPitch), Math.cos(this.camYaw) * cos];
    // Pull in when a wall would come between the camera and the vehicle.
    const hit = raycastBlocks(this.d.getCell, target, back, distance, isSolid), d = hit ? Math.max(1.2, hit.distance - 0.4) : distance;
    camera.position.set(target[0] + back[0] * d, target[1] + back[1] * d, target[2] + back[2] * d);
    camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
    this.heading = this.camYaw;
    const wide = fov + Math.min(14, Math.abs(speed) * 0.5);
    if (Math.abs(camera.fov - wide) > 0.05) { camera.fov += (wide - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix(); }
  }

  /**
   * Draw the city for this frame. `interp` holds the two scenes the entity renderer is between; `self`: where the
   * local player stands (null on the TV); `own`: the vehicle the local player drives, where their physics has it.
   */
  frame(dt: number, view: View | null, interp: Interpolator<Scene>, camera: PerspectiveCamera, range: number, self: { x: number; z: number } | null, own: Shown | null, gig: PrivateView['city'] | null, floaters: readonly Floater[], found: readonly number[] | null) {
    const a = interp.a, b = interp.b, t = interp.alpha, live = this.live, older = new Map((a?.npcs ?? []).map(npc => [npc.i, npc]));
    live.length = 0;
    for (const npc of b?.npcs ?? []) {
      const old = older.get(npc.i) ?? npc;
      live.push({ i: npc.i, x: lerp(old.x, npc.x, t), y: lerp(old.y, npc.y, t), z: lerp(old.z, npc.z, t), yaw: lerpAngle(old.yaw, npc.yaw, t), s: npc.s });
    }
    this.eye.copy(camera.position);
    if (view) this.crowd.update(dt, view.day, view.time, this.eye, range, live, self);
    this.rides.update(dt, a?.rides, b?.rides, t, own, self ? this.eye.set(self.x, 0, self.z) : this.eye);
    if (view?.city?.ev) { this.events = view.city.ev; this.races = view.city.races ?? []; }
    let gull: [number, number, number, number] | null = null;
    // Feathers not yet found (a playing seat only), the float of a line in the water, and a mark over whatever is going on near.
    const feathers = this.feathers, marks = this.marks, fires = this.fires, cx = camera.position.x, cz = camera.position.z;
    feathers.length = marks.length = fires.length = 0;
    if (found) this.extras.feathers.forEach((at, i) => { if (!(found[i >= 20 ? 1 : 0]! >> (i % 20) & 1) && (at[0] - cx) ** 2 + (at[2] - cz) ** 2 < 70 * 70) feathers.push(at); });
    // A mark over each character who still has an errand for this player (a playing seat only).
    const story = found ? feed.get().bag?.career?.story ?? 0 : -1;
    if (story >= 0) this.crowd.guides.forEach((at, who) => { if (stepOf(story, who) < CHARACTERS[who]!.errands.length && (at.x - cx) ** 2 + (at.z - cz) ** 2 < 60 * 60) marks.push([at.x, GROUND + 2.9, at.z, 0x78d955]); });
    for (const event of this.events) {
      const [k, x, z, , a] = event as [number, number, number, number, number];
      if ((x - cx) ** 2 + (z - cz) ** 2 > 110 * 110) continue;
      // The gull rides on its holder's head; a bounty hangs over the wanted one; the rest mark a place.
      const on = k === EV.GULL && a ? this.seatAt(a - 1) : k === EV.BOUNTY ? this.seatAt(event[5]!) : null;
      if (k === EV.GULL) gull = on ? [on.x, on.y + 2.25, on.z, on.yaw] : [x + 0.5, GROUND, z + 0.5, this.time * 0.4];
      // (A gull on a head is its own mark.)
      if (on) { if (k !== EV.GULL) marks.push([on.x, on.y + 3.2, on.z, EVENT_COLORS[k] ?? 0xffffff]); }
      else if (k !== EV.BOUNTY) marks.push([x, GROUND + (k === EV.FIRE ? 7 : 4.5), z, EVENT_COLORS[k] ?? 0xffffff]);
      // A fire: flames and smoke by how fierce it still is.
      if (k !== EV.FIRE) continue;
      fires.push([x + 0.5, z + 0.5, a]);
      for (let n = dt * (3 + a * 0.12); n > 0; n--) {
        if (n < 1 && Math.random() > n) break;
        const fx = x + (Math.random() - 0.5) * 3.4, fz = z + (Math.random() - 0.5) * 3.4;
        this.d.particles.flame(fx, GROUND + 1 + Math.random() * 2.2, fz);
        this.d.particles.smoke(fx, GROUND + 2.5 + Math.random() * 2, fz, 0.8, 'big');
      }
    }
    // A race: the next flag is a gate across the street, and the beacon stands on it.
    const race = gig?.race, course = race ? this.extras.courses[race[5]!] : undefined, flag = race && course ? course.points[race[1]!] : undefined;
    this.gates.length = 0;
    if (flag && course && race) {
      const from = race[1]! > 0 ? course.points[race[1]! - 1]! : [course.x, course.z];
      this.gates.push([flag[0], flag[1], Math.abs(flag[0] - from[0]!) > Math.abs(flag[1] - from[1]!) ? Math.PI / 2 : 0, race[1] === course.points.length - 1 ? 0xfff6e5 : 0xffd24a]);
    }
    const line = gig?.fish;
    this.props.update(dt, { floaters, feathers, float: line ? [line[1]!, line[2]!, line[0] === 2] : null, gates: this.gates, marks, fires, gull });
    for (const cloud of this.clouds) if (Math.random() < dt * 14) this.d.particles.smoke(cloud.x + (Math.random() - 0.5) * 5, cloud.y + Math.random() * 2 - 0.5, cloud.z + (Math.random() - 0.5) * 5, 0.9, 'big');
    while (this.clouds.length && this.time > this.clouds[0]!.until) this.clouds.shift();
    const target = gig?.gig ?? (flag ? { x: flag[0], z: flag[1] } : undefined);
    this.beacon.visible = !!target;
    if (target) {
      this.beacon.position.set(target.x, GROUND, target.z);
      (this.beacon.material as MeshBasicMaterial).opacity = 0.2 + 0.1 * Math.sin(this.time * 4);
    }
  }

  /** True when a cell lies in plot `index` (the one the player owns). */
  inPlot(index: number, x: number, y: number, z: number): boolean {
    const plot = this.plan.plots[index];
    return !!plot && x >= plot.x0 && x <= plot.x1 && z >= plot.z0 && z <= plot.z1 && y >= plot.y0 && y <= plot.y1;
  }
  /** Boxes the crosshair can hit: residents, vehicles and other players (to bonk where the room allows it, or to hand coins to). */
  *targets(players: Iterable<{ id: string; box: readonly number[]; flags: number }>, who: View['who'], selfId: string | null): Iterable<{ id: number; box: readonly [number, number, number, number, number, number] }> {
    yield* this.crowd.reach;
    yield* this.rides.reach;
    for (const player of players) {
      const seat = who.findIndex(([id]) => id === player.id);
      if (seat >= 0 && player.id !== selfId && !(player.flags & (PF.DEAD | PF.OFFLINE | PF.RIDING))) yield { id: CITY_PLAYER_ID + seat, box: player.box as [number, number, number, number, number, number] };
    }
  }

  /** What a target id is, for the HUD: a resident's name and doings, a vehicle's name, a player's name. */
  describe(id: number, who: View['who']): { name: string; line: string; kind: 'resident' | 'keeper' | 'ride' | 'player' } | null {
    if (id >= CITY_PLAYER_ID) return { name: who[id - CITY_PLAYER_ID]?.[1] ?? 'Player', line: 'Another player', kind: 'player' };
    if (id >= CITY_ID + CITY_GUIDE) { const character = CHARACTERS[id - CITY_ID - CITY_GUIDE]; return character ? { name: character.name, line: character.role, kind: 'resident' } : null; }
    if (id >= CITY_ID) {
      const i = id - CITY_ID, resident = this.crowd.resident(i), act = this.crowd.actOf(i);
      if (!resident) return { name: i - this.people.list.length >= 4096 ? 'Officer of the Watch' : 'Passer-by', line: '', kind: 'resident' };
      const place = resident.place >= 0 ? this.plan.places[resident.place] : undefined, serving = !!place && act === 2;
      return { name: resident.name, line: act < 0 ? JOB_LINE : describe(this.people, resident, act), kind: serving ? 'keeper' : 'resident' };
    }
    const ride = this.rides.shown.get(id);
    return ride ? { name: RIDES[ride.k]!.name, line: '', kind: 'ride' } : null;
  }

  /** Sound and particles for the city's effects. */
  fx(fx: Fx, isSelf: boolean) {
    const { sfx, particles } = this.d, at = [fx.x, fx.y, fx.z] as const;
    switch (fx.k) {
      case 'bonk': sfx.synth('bonk', { at, volume: 0.9 }); particles.burst(fx.x, fx.y, fx.z, TINTS.flame, 10, 2.4); return true;
      case 'splat': sfx.synth('splat', { at }); particles.burst(fx.x, fx.y, fx.z, TINTS.beam, 16, 3); return true;
      case 'coins': sfx.synth('coins', isSelf ? { volume: 0.8 } : { at, volume: 0.6 }); particles.burst(fx.x, fx.y, fx.z, TINTS.flame, 8, 2); return true;
      case 'siren': sfx.synth('siren', isSelf ? { volume: 0.7 } : { at, range: 48 }); return true;
      case 'gasp': sfx.synth('villager', { at, pitch: 1.6, volume: 0.7 }); return true;
      case 'horn': sfx.synth('horn', { at, range: 40, pitch: fx.a === 3 || fx.a === 2 ? 0.75 : fx.a === 0 || fx.a === 6 ? 1.3 : 1 }); return true;
      case 'crash': sfx.synth('crash', { at, range: 40 }); particles.burst(fx.x, fx.y, fx.z, TINTS.dark, 12, 3); return true;
      case 'bust': sfx.synth('bust', isSelf ? {} : { at }); return true;
      case 'water': sfx.synth('burst', { at }); particles.burst(fx.x, fx.y, fx.z, TINTS.splash, 22, 4, 0.09); return true;
      case 'slip': sfx.synth('slide', { at }); particles.burst(fx.x, fx.y, fx.z, TINTS.spark, 8, 2.5); return true;
      case 'smoke': sfx.synth('puff', { at }); this.clouds.push({ x: fx.x, y: fx.y, z: fx.z, until: this.time + (fx.a ?? 6) }); for (let k = 0; k < 14; k++) particles.smoke(fx.x + (Math.random() - 0.5) * 3, fx.y + Math.random() * 1.5 - 0.5, fx.z + (Math.random() - 0.5) * 3, 0.9, 'big'); return true;
      case 'toot': sfx.synth('toot', { at, range: 28, pitch: TUNE[(fx.a ?? 0) % TUNE.length]! }); particles.burst(fx.x, fx.y + 0.3, fx.z, TINTS.happy, 2, 1.2, 0.05); return true;
      case 'cast': sfx.synth('plop', { at }); particles.splash(fx.x, fx.y, fx.z); return true;
      case 'bite': sfx.synth('nibble', isSelf ? { volume: 0.9 } : { at, volume: 0.5 }); particles.splash(fx.x, fx.y, fx.z); return true;
      case 'reel': sfx.synth('reel', { at }); particles.splash(fx.x, fx.y, fx.z); return true;
      case 'chute': sfx.synth('flump', { at }); return true;
      case 'fanfare': sfx.synth('fanfare', isSelf ? {} : { at, range: 40 }); particles.burst(fx.x, fx.y + 1, fx.z, TINTS.spark, 24, 4); return true;
      case 'whistle': sfx.synth('whistle', { at, range: 60 }); return true;
      case 'alarm': sfx.synth('alarm', { at, range: 70 }); return true;
      case 'ding': sfx.synth('ding', isSelf ? { volume: 0.8 } : { at }); return true;
      case 'squawk': sfx.synth('squawk', { at, range: 50 }); return true;
      case 'hose': sfx.synth('hose', { at }); particles.burst(fx.x, fx.y, fx.z, TINTS.splash, 6, 2.5, 0.06); return true;
      case 'stamp': sfx.synth('stamp', isSelf ? {} : { at, volume: 0.5 }); particles.burst(fx.x, fx.y, fx.z, TINTS.happy, 12, 2.6); return true;
    }
    return false;
  }

  dispose() {
    this.crowd.dispose();
    this.rides.dispose();
    this.props.dispose();
    this.d.scene.remove(this.beacon);
    this.beacon.geometry.dispose();
    (this.beacon.material as MeshBasicMaterial).dispose();
    cityHud.set({ context: null, focus: null, driving: null, spot: null });
  }
}
const JOB_LINE = 'Rather busy right now';
/** The kazoo's tune as pitch ratios (a jaunty eight notes, round and round). */
const TUNE = [1, 1.26, 1.5, 1.26, 1.68, 1.5, 1.26, 1.12];
