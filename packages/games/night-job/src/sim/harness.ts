/* Server-only test and QA harness: fixed-step heists and path-following bots. Never import from browser code. */
import { SIGHT, neutralInput, type Choice, type Input, type Point, type Settings } from '../model';
import { cellIndex, doorObjects, findPath, lineOfSight } from '../geometry';
import type { ServerLevel } from '../server-levels';
import { rules } from '../server';
import { angleDiff, create, dist, grids, mapOf, type Crew, type State } from './state';
import { beamEnd, deviceOn } from './security';

export const STEP = 1 / 30;
export type Heist = { s: State; wall: number; step(inputs?: Record<string, Input>, ticks?: number): void; tool(id: string): void };
/** A heist with `players` thieves (ids p0…), stepped at the real 30 Hz. */
export function heist(players = 1, o: { level?: ServerLevel; settings?: Partial<Settings>; choices?: Partial<Choice>[]; seed?: number } = {}): Heist {
  const settings = rules.validateSettings({ mission: 'velvet', difficulty: 'normal', ...o.settings });
  const ctx = { roomId: 'r', roundId: 'h1', seed: o.seed ?? 7, nowMs: 1000, players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Thief ${i}`, color: '#ff5748', lobbyChoice: o.choices?.[i] })) };
  const h: Heist = {
    s: create(ctx, settings, o.level), wall: 1000,
    step(inputs = {}, ticks = 1) {
      for (let i = 0; i < ticks; i++) { h.wall += 1000 * STEP; rules.tick(h.s, new Map(Object.entries(inputs)), STEP, h.wall); }
    },
    tool(id) { rules.applyAction(h.s, id, { type: 'tool', heistId: h.s.heistId }, h.wall); },
  };
  return h;
}
/** Cells a thief can eventually cross: floor plus every door (closed ones open, locked ones get picked). */
function crewMask(s: State) {
  const map = mapOf(s), mask = grids(s).guard.solid.slice();
  for (const d of doorObjects(map)) if (d.kind === 'door') mask[cellIndex(map, d)] = 0;
  return mask;
}
/** Stick input that walks p toward goal along an A* path; null once within `near`. */
export function steer(s: State, p: Crew, goal: Point, sneak = false, near = .2): Input | null {
  if (dist(p, goal) < near) return null;
  const next = findPath(grids(s).grid, crewMask(s), p, goal)[0] ?? goal, d = dist(p, next) || 1;
  return { x: (next.x - p.x) / d * (sneak ? .5 : 1), y: (next.y - p.y) / d * (sneak ? .5 : 1), sneak };
}
/** Push straight into a target point. */
export const push = (p: Point, at: Point, sneak = false): Input => { const d = dist(p, at) || 1; return { x: (at.x - p.x) / d, y: (at.y - p.y) / d, sneak }; };
export const idle = neutralInput;

/**
 * Sneaking bot: Dijkstra over cells with live camera/laser coverage costed, then each tick picks the
 * step that makes progress while staying out of NPC view cones. Uses full server knowledge (a test oracle).
 */
export function stealthBot(s: State, p: Crew) {
  const map = mapOf(s), W = map.width, doors = doorObjects(map);
  const covered = (q: Point) => map.objects.some(o => {
    if ((o.kind !== 'camera' && o.kind !== 'laser') || !deviceOn(s, o)) return false;
    if (o.kind === 'laser') { const e = beamEnd(s, o); return Math.abs((q.x - o.x) * (e.y - o.y) - (q.y - o.y) * (e.x - o.x)) / (dist(o, e) || 1) < .9 && dist(o, q) <= dist(o, e) + .5; }
    return dist(o, q) <= SIGHT.cameraRange + .8 && angleDiff(o.facing ?? 0, Math.atan2(q.y - o.y, q.x - o.x)) <= SIGHT.cameraSweep + SIGHT.cameraHalfAngle + .15 && lineOfSight(grids(s).grid, o, q);
  });
  const field = (goal: Point) => {
    const mask = grids(s).guard.solid.slice(), f = new Float32Array(W * map.height).fill(1e9), open = [cellIndex(map, goal)];
    const cost = Float32Array.from(f, (_, i) => mask[i] || !covered({ x: i % W + .5, y: Math.floor(i / W) + .5 }) ? 1 : 40);
    doors.forEach((d, i) => { if (d.kind === 'door' && s.doors[i] === 'l') mask[cellIndex(map, d)] = 0; });
    f[open[0]] = 0;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0], x = cur % W, y = Math.floor(cur / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = (y + dy) * W + x + dx;
        if ((!dx && !dy) || mask[n] || (dx && dy && (mask[y * W + x + dx] || mask[(y + dy) * W + x]))) continue;
        const v = f[cur] + cost[n] * (dx && dy ? 1.414 : 1);
        if (v < f[n]) { if (f[n] === 1e9) open.push(n); f[n] = v; }
      }
    }
    return f;
  };
  const risk = (q: Point) => s.npcs.reduce((r, n) => {
    if (n.state === 'stunned' || n.state === 'charmed' || dist(n, q) > 9) return r;
    const d = dist(n, q), inCone = angleDiff(n.facing, Math.atan2(q.y - n.y, q.x - n.x)) < 1.15 || d < 1.8;
    return r + (inCone && lineOfSight(grids(s).grid, n, q, s.smoke, s.now) ? 15 - d : 0) + Math.max(0, 2.2 - d) * 3;
  }, 0);
  let f = new Float32Array(0), key = '';
  return (goal: Point, target: Point | null): Input => {
    const k = `${goal.x},${goal.y},${Math.floor(s.now / 1000)},${s.doors}`;
    if (k !== key) { f = field(goal); key = k; }
    const cur = cellIndex(map, p), x = cur % W, y = Math.floor(cur / W);
    if (cur === cellIndex(map, goal)) return target ? push(p, target, true) : { x: 0, y: 0, sneak: true };
    let next = cur;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = (y + dy) * W + x + dx; if (f[n] < f[next] && !(dx && dy && (f[y * W + x + dx] >= 1e9 || f[(y + dy) * W + x] >= 1e9))) next = n; }
    const want = push(p, { x: next % W + .5, y: Math.floor(next / W) + .5 });
    let best = -Infinity, input: Input = { x: 0, y: 0, sneak: true };
    for (let i = -1; i < 16; i++) {
      const dir = i < 0 ? { x: 0, y: 0 } : { x: Math.cos(i * Math.PI / 8), y: Math.sin(i * Math.PI / 8) }, score = 2 * (dir.x * want.x + dir.y * want.y) - risk({ x: p.x + dir.x * .8, y: p.y + dir.y * .8 });
      if (score > best) { best = score; input = { ...dir, sneak: true }; }
    }
    return input;
  };
}
