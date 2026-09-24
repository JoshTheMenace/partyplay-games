/**
 * Shared display camera and presentation math, pure and unit tested in Node, plus a tiny three.js adapter.
 * A shot is the visible rectangle on the gameplay plane (z = 0): its center and half height.
 */
import type { PerspectiveCamera } from 'three';
import { STAGE_IDS, type StageId } from '../stages';
import type { FighterView, GameEvent, ProjectileView, Settings, View } from '../model';

export type Zone = { left: number; right: number; bottom: number; top: number };
/** The main floor: the widest solid block's top edge. */
export type Floor = { left: number; right: number; top: number };
export type Subject = { x: number; y: number; height: number; vx?: number; vy?: number; launch?: number };
export type Shot = { x: number; y: number; halfH: number };
export type Kick = { x: number; y: number; zoom: number };

export const CAMERA_FOV = 30;
/** Never frame less than this many meters of the gameplay plane horizontally. */
export const MIN_WIDTH = 9;
/** The main floor sits this fraction of the screen height above the bottom edge when nothing forces otherwise. */
export const FLOOR_AT = .3;
/** While anyone fights on the main floor it never drops below this fraction, clear of the HUD cards; higher fighters get the offscreen bubble. */
export const FLOOR_MIN = .24;
const TAN = Math.tan(CAMERA_FOV * Math.PI / 360), PITCH = .08;
const MARGIN = { side: 2.5, top: 1.8, bottom: 1.1 }, LEAD_FRAMES = 12, LEAD_MAX = 4, PUNCH_S = .6;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const distanceFor = (halfH: number) => halfH / TAN;
export const mainFloor = (blocks: readonly { left: number; right: number; top: number }[]): Floor =>
  blocks.reduce<Floor>((a, b) => b.right - b.left > a.right - a.left ? b : a, { left: -4, right: 4, top: 0 });

/** Keep a shot inside a zone: never larger than the zone, and centered so no edge crosses it. */
export function contain(shot: Shot, zone: Zone, aspect: number): Shot {
  const halfH = Math.min(shot.halfH, (zone.top - zone.bottom) / 2, (zone.right - zone.left) / 2 / aspect), halfW = halfH * aspect;
  return { halfH, x: clamp(shot.x, zone.left + halfW, zone.right - halfW), y: clamp(shot.y, zone.bottom + halfH, zone.top - halfH) };
}

/** Half the widest stretch of main floor the camera keeps in frame (whole Battlefield or FD; a window of Temple). */
const FLOOR_REACH = 5.5;
/** The ideal (unsmoothed) shot: every subject plus margin, fast launches led, the main floor near them kept, the floor low on screen. */
export function frameShot(zone: Zone, floor: Floor, subjects: readonly Subject[], aspect: number): Shot {
  const cx = subjects.length ? subjects.reduce((a, s) => a + s.x, 0) / subjects.length : (floor.left + floor.right) / 2;
  let minX = Math.max(floor.left - 1.2, Math.min(cx, floor.right) - FLOOR_REACH), maxX = Math.min(floor.right + 1.2, Math.max(cx, floor.left) + FLOOR_REACH);
  let minY = floor.top - 1.4, maxY = floor.top + 2.4;
  const add = (x: number, y0: number, y1: number) => {
    minX = Math.min(minX, x - MARGIN.side); maxX = Math.max(maxX, x + MARGIN.side);
    minY = Math.min(minY, y0 - MARGIN.bottom); maxY = Math.max(maxY, y1 + MARGIN.top);
  };
  for (const s of subjects) {
    add(s.x, s.y, s.y + s.height);
    if ((s.launch ?? 0) > .15) {
      const x = s.x + clamp((s.vx ?? 0) * LEAD_FRAMES, -LEAD_MAX, LEAD_MAX), y = s.y + clamp((s.vy ?? 0) * LEAD_FRAMES, -LEAD_MAX, LEAD_MAX);
      add(x, y, y + s.height);
    }
  }
  const halfH = Math.min(Math.max((maxY - minY) / 2, (maxX - minX) / 2 / aspect, MIN_WIDTH / 2 / aspect) * 1.05, (zone.top - zone.bottom) / 2, (zone.right - zone.left) / 2 / aspect), halfW = halfH * aspect;
  const x = clamp((minX + maxX) / 2, maxX - halfW, minX + halfW);
  // Floor in the lower third unless a subject above or below needs the room.
  let y = clamp(floor.top + (1 - FLOOR_AT * 2) * halfH, maxY - halfH, minY + halfH);
  if (subjects.some(s => s.x > floor.left - 1 && s.x < floor.right + 1 && s.y > floor.top - .5 && s.y < floor.top + 4)) y = Math.min(y, floor.top + (1 - FLOOR_MIN * 2) * halfH);
  return contain({ x, y, halfH }, zone, aspect);
}

/** Critically damped spring step: no overshoot from rest. Returns [position, velocity]. */
export function damp(current: number, target: number, velocity: number, omega: number, dt: number): [number, number] {
  const k = omega * dt, e = 1 / (1 + k + .48 * k * k + .235 * k * k * k), change = current - target, temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * e, (velocity - omega * temp) * e];
}

/** Smooth follow camera: pans and zooms out briskly, zooms in gently, punches toward a KO. */
export class CameraDirector {
  shot: Shot;
  private v = { x: 0, y: 0, h: 0 };
  private punchLeft = 0;
  private punchPower = 0;
  private punchAt = { x: 0, y: 0 };
  constructor(private zone: Zone, private floor: Floor, aspect = 16 / 9) { this.shot = frameShot(zone, floor, [], aspect); }
  /** Snap without easing: a new stage, a resize or a resumed tab. */
  reset(zone: Zone, floor: Floor, aspect: number, subjects: readonly Subject[] = []) {
    this.zone = zone; this.floor = floor; this.shot = frameShot(zone, floor, subjects, aspect); this.v = { x: 0, y: 0, h: 0 }; this.punchLeft = 0;
  }
  /** A brief zoom toward a point: power 1 is a KO. */
  punch(x: number, y: number, power = 1) {
    if (this.punchLeft > 0 && power < this.punchPower) return;
    this.punchPower = clamp(power, 0, 1); this.punchLeft = PUNCH_S; this.punchAt = { x, y };
  }
  update(subjects: readonly Subject[], aspect: number, dt: number, kick: Kick = { x: 0, y: 0, zoom: 0 }): Shot {
    const target = frameShot(this.zone, this.floor, subjects, aspect), s = this.shot;
    dt = clamp(dt, 0, .1);
    [s.x, this.v.x] = damp(s.x, target.x, this.v.x, 4, dt);
    [s.y, this.v.y] = damp(s.y, target.y, this.v.y, 4, dt);
    [s.halfH, this.v.h] = damp(s.halfH, target.halfH, this.v.h, target.halfH > s.halfH ? 5.5 : 2.6, dt);
    // Subjects stay in view while easing: widen at once if the spring lags a fast zoom-out.
    if (s.halfH < target.halfH * .85) { s.halfH = target.halfH * .85; this.v.h = Math.max(this.v.h, 0); }
    Object.assign(s, contain(s, this.zone, aspect));
    this.punchLeft = Math.max(0, this.punchLeft - dt);
    const age = PUNCH_S - this.punchLeft, p = this.punchLeft > 0 ? Math.min(1, age / .08) * Math.min(1, this.punchLeft / .35) * this.punchPower : 0;
    const halfH = Math.max(MIN_WIDTH / 2 / aspect, s.halfH * (1 - .12 * p) * (1 - clamp(kick.zoom, -.2, .2)));
    const pull = .22 * p, x = s.x + (clamp(this.punchAt.x, s.x - s.halfH * aspect, s.x + s.halfH * aspect) - s.x) * pull, y = s.y + (clamp(this.punchAt.y, s.y - s.halfH, s.y + s.halfH) - s.y) * pull;
    return contain({ x: x + kick.x, y: y + kick.y, halfH }, this.zone, aspect);
  }
}

/** Place a perspective camera so its z = 0 view matches a shot, looking slightly down onto floor tops. */
export function applyShot(camera: PerspectiveCamera, shot: Shot) {
  const d = distanceFor(shot.halfH);
  camera.fov = CAMERA_FOV; camera.near = Math.max(.5, d * .05); camera.far = 2400;
  camera.position.set(shot.x, shot.y + d * PITCH, d); camera.lookAt(shot.x, shot.y, 0); camera.updateProjectionMatrix();
}

// ── Presentation: blending 30 Hz snapshots and timing their events ──
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Farther than this between two snapshots is a teleport (KO, respawn, ledge snap), never a slide. */
export const TELEPORT = 2.5;
/** True when a fighter cannot be drawn sliding from a to b. */
export const jumped = (a: FighterView, b: FighterView) => a.stocks !== b.stocks || a.state === 'out' || b.state === 'out' || (a.state === 'respawn') !== (b.state === 'respawn') || Math.hypot(b.x - a.x, b.y - a.y) > TELEPORT;
const blendFighter = (a: FighterView | undefined, b: FighterView, k: number): FighterView => !a || jumped(a, b) ? b
  : { ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), vx: lerp(a.vx, b.vx, k), vy: lerp(a.vy, b.vy, k), shield: lerp(a.shield, b.shield, k), charge: lerp(a.charge, b.charge, k) };
const blendShot = (a: ProjectileView | undefined, b: ProjectileView, k: number): ProjectileView => !a || Math.hypot(b.x - a.x, b.y - a.y) > TELEPORT ? b : { ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
/** SnapshotBuffer interpolator: positions and the stage clock glide; states, hits and events come from the newer snapshot. */
export function blendView(a: View, b: View, k: number): View {
  if (a.turnId !== b.turnId || a.stageId !== b.stageId) return b;
  const f = new Map(a.fighters.map(x => [x.id, x])), p = new Map(a.projectiles.map(x => [x.id, x]));
  return { ...b, frame: lerp(a.frame, b.frame, k), stageTick: lerp(a.stageTick, b.stageTick, k),
    fighters: b.fighters.map(x => blendFighter(f.get(x.id), x, k)), projectiles: b.projectiles.map(x => blendShot(p.get(x.id), x, k)) };
}
/** The stage to build before the first snapshot: the host's fixed pick, else the leading lobby vote, else Battlefield. */
export function predictStage(settings: Pick<Settings, 'stage'> | null | undefined, players: readonly { lobbyChoice?: unknown }[]): StageId {
  const valid = (s: unknown): s is StageId => (STAGE_IDS as readonly unknown[]).includes(s), pick = settings?.stage;
  if (valid(pick)) return pick;
  if (pick === 'random') return 'battlefield';
  const votes = players.map(p => (p.lobbyChoice as { stage?: unknown } | undefined)?.stage).filter(valid), count = (s: StageId) => votes.filter(v => v === s).length;
  return votes.reduce<StageId | null>((best, s) => best && count(best) >= count(s) ? best : s, null) ?? 'battlefield';
}
/** Fires each event id once, when presentation reaches its frame, so sparks land with the interpolated contact. Stale ones drop. */
export class EventClock {
  private queue: GameEvent[] = [];
  private last = -Infinity;
  add(events: readonly GameEvent[]) { for (const e of events) if (e.id > this.last) { this.last = e.id; this.queue.push(e); } }
  due(frame: number, staleFrames = 30): GameEvent[] {
    const out = this.queue.filter(e => e.frame <= frame && e.frame >= frame - staleFrames);
    this.queue = this.queue.filter(e => e.frame > frame);
    return out;
  }
}
