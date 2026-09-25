/* Doors, circuits (cameras, lasers, terminals), alarm, reinforcements and short-lived world events. */
import { RADIUS, SIGHT, TIMING, cameraAngle, type MapObject, type Point } from '../model';
import { castRay, doorObjects, lineOfSight } from '../geometry';
import { angleDiff, cellDist, dist, effect, grids, mapOf, relaxed, say, setDoor, spawnNpc, vulnerable, type State } from './state';

const MESSAGE_MS = 7000;
import { investigate, noise } from './npc';

/** A camera or laser is live unless its circuit was hacked or an EMP hit it. */
export const deviceOn = (s: State, o: MapObject) => !((o.circuit && s.circuits[o.circuit] > s.now) || s.deviceOff[o.id] > s.now);
/** Laser beam end: from the emitter to the first opaque cell (closed doors included). */
export function beamEnd(s: State, o: MapObject): Point {
  const f = o.facing ?? 0, d = castRay(grids(s).grid, o.x, o.y, Math.cos(f), Math.sin(f), 64);
  return { x: o.x + Math.cos(f) * d, y: o.y + Math.sin(f) * d };
}
const segmentDist = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

export function raiseAlarm(s: State, at: Point, label: string) {
  const fresh = !s.alarm;
  s.alarm = { x: at.x, y: at.y, until: s.now + TIMING.alarm };
  if (!fresh && s.now - s.alarmAt < 1500) return;
  s.alarmAt = s.now; say(s, `Alarm! ${label} tripped. Guards are converging.`);
  s.noises.push({ x: at.x, y: at.y, radius: RADIUS.loudNoise, at: s.now, kind: 'alarm', crew: true });
  effect(s, at, 'alarm', label);
  for (const n of s.npcs) investigate(s, n, at);
}

function cameras(s: State, dt: number) {
  const { grid } = grids(s);
  for (const o of mapOf(s).objects) {
    if ((o.kind !== 'camera' && o.kind !== 'laser') || !deviceOn(s, o)) { s.meters[o.id] = 0; continue; }
    if (o.kind === 'laser') {
      const end = beamEnd(s, o), p = s.crew.find(p => vulnerable(p) && !p.hidden && segmentDist(p, o, end) < RADIUS.actor);
      if (p) raiseAlarm(s, p, o.label);
      continue;
    }
    const a = cameraAngle(o, s.now);
    let rate = 0, seen: Point | null = null;
    for (const p of s.crew) {
      if (!vulnerable(p) || p.hidden || dist(o, p) > SIGHT.cameraRange || angleDiff(a, Math.atan2(p.y - o.y, p.x - o.x)) > SIGHT.cameraHalfAngle || !lineOfSight(grid, o, p, s.smoke, s.now)) continue;
      const r = (p.disguised ? .15 : 1) * (relaxed(s) ? .7 : 1) / .8;
      p.seenAt = s.now;
      if (r > rate) { rate = r; seen = p; }
    }
    const meter = seen ? (s.meters[o.id] ?? 0) + rate * dt : Math.max(0, (s.meters[o.id] ?? 0) - dt * .6);
    s.meters[o.id] = meter >= 1 ? 0 : meter;
    if (meter >= 1 && seen) raiseAlarm(s, seen, o.label);
  }
}

function doors(s: State) {
  const eyes = s.crew.filter(p => !p.suspended), bodies = [...eyes, ...s.npcs], { grid } = grids(s);
  // The crew sees a door when a thief has line of sight to the nearest point of its cell.
  const seen = (o: Point) => eyes.some(p => {
    const cx = Math.floor(o.x), cy = Math.floor(o.y), q = { x: Math.max(cx, Math.min(cx + 1, p.x)), y: Math.max(cy, Math.min(cy + 1, p.y)) };
    return dist(p, q) <= RADIUS.crewSight && lineOfSight(grid, p, q, s.smoke, s.now);
  });
  doorObjects(mapOf(s)).forEach((o, i) => {
    if (s.seenDoors[i] !== s.doors[i] && seen(o)) s.seenDoors = s.seenDoors.slice(0, i) + s.doors[i] + s.seenDoors.slice(i + 1);
    if (o.kind !== 'door' || s.doors[i] !== 'o') return;
    const cx = Math.floor(o.x), cy = Math.floor(o.y);
    if (bodies.some(b => cellDist(b, cx, cy) < RADIUS.actor + .05)) s.doorBusy[i] = s.now;
    else if (s.now - s.doorBusy[i] >= TIMING.doorClose) setDoor(s, i, 'c');
  });
}

export function tickSecurity(s: State, dt: number) {
  doors(s);
  cameras(s, dt);
  if (s.alarm && s.alarm.until <= s.now) s.alarm = null;
  for (const d of s.decoys) if (d.at <= s.now) noise(s, d, RADIUS.decoyNoise, 'decoy', true);
  s.decoys = s.decoys.filter(d => d.at > s.now);
  if (s.squadAt !== null && s.now >= s.squadAt) {
    s.npcs.push(...s.squad.map((n, i) => spawnNpc(n, `${n.kind}-r${i}`, s.now)));
    s.squadAt = null; say(s, 'Reinforcements are sweeping the building. Move!');
  }
  if (s.message && s.now - s.messageAt >= MESSAGE_MS) s.message = '';
  s.smoke = s.smoke.filter(c => c.until > s.now);
  s.silence = s.silence.filter(z => z.until > s.now);
  s.noises = s.noises.filter(n => s.now - n.at < 1500).slice(-24);
  s.shots = s.shots.filter(n => s.now - n.at < 700);
  s.effects = s.effects.filter(e => s.now - e.at < 2500).slice(-24);
}
