/* Guards, dogs and civilians. Readable escalation: ? (suspicious) → ! (chase) → search → patrol. */
import { DAMAGE, SIGHT, SPEED, TIMING, type Noise, type Point } from '../model';
import { clearPath, findPath, isSolid, lineOfSight, moveCircle } from '../geometry';
import { angleDiff, dist, doorAt, effect, glassBetween, grids, hurt, random, relaxed, setDoor, turnToward, unhide, vulnerable, type Crew, type Npc, type State } from './state';

/** MAX_RATE: suspicion never fills faster than 0 → 1 in ~0.55 s, so the "?" always reads on the TV. LOSE: an unseen target is given up after this long. */
const TURN = 6, STARE_TURN = 2.5, RADIO = 10, SMELL = 1.6, BITE = .65, REACH = .2, MAX_RATE = 1.8, LOSE = 3000;
const alert = (n: Npc) => n.kind !== 'civilian' && n.state !== 'stunned' && n.state !== 'charmed';
/** Unaware: not stunned, charmed, chasing or panicking, and not already sure about a thief. */
export const unaware = (n: Npc) => ['patrol', 'investigate', 'search'].includes(n.state) || (n.state === 'suspicious' && n.suspicion < .5);
const pos = (p: Point): Point => ({ x: p.x, y: p.y });

/** Suspicion per second this NPC gains from thief p right now; 0 when it cannot perceive them. */
export function perceive(s: State, n: Npc, p: Crew): number {
  if (!vulnerable(p) || n.state === 'stunned' || n.state === 'charmed') return 0;
  const d = dist(n, p), { grid } = grids(s);
  if (n.kind === 'dog' && d <= SMELL) return lineOfSight(grid, n, p) ? 4 : 0;
  if (p.hidden && !p.witnesses.includes(n.id)) return 0;
  const range = n.kind === 'civilian' ? SIGHT.civilianRange : SIGHT.guardRange;
  if (d > range) return 0;
  const cone = angleDiff(n.facing, Math.atan2(p.y - n.y, p.x - n.x)) <= SIGHT.guardHalfAngle;
  if ((!cone && d > SIGHT.near) || !lineOfSight(grid, n, p, s.smoke, s.now)) return 0;
  const close = 1 - d / range, loud = p.running;
  let rate = (.4 + 2.4 * close * close) * (loud ? 1.5 : .5) * (cone ? 1 : .5);
  if (p.disguised && n.kind !== 'dog' && !(loud && d < 2)) rate *= .15;
  if (s.alarm) rate *= 1.5;
  if (n.kind === 'civilian') rate *= .8;
  return Math.min(MAX_RATE, rate) * (relaxed(s) ? .7 : 1);
}
/** A chaser keeps a target it can see roughly ahead, or anywhere close by. Never stricter than perceive(), or chases would restart in a loop. */
function tracks(s: State, n: Npc, p: Crew | undefined): p is Crew {
  if (!p || !vulnerable(p)) return false;
  const d = dist(n, p), { grid } = grids(s);
  if (n.kind === 'dog' && d <= SMELL) return lineOfSight(grid, n, p);
  if (p.hidden && !p.witnesses.includes(n.id)) return false;
  return d <= SIGHT.guardRange + 1 && (d <= 2.5 || angleDiff(n.facing, Math.atan2(p.y - n.y, p.x - n.x)) <= 1.4) && lineOfSight(grid, n, p, s.smoke, s.now);
}

const silenced = (s: State, p: Point) => s.silence.some(z => z.until > s.now && dist(z, p) <= RADIO);
export function investigate(s: State, n: Npc, p: Point) {
  if (!alert(n) || n.state === 'chase') return;
  n.state = 'investigate'; n.lastKnown = pos(p); n.stateUntil = 0; n.goal = null; n.path = []; n.pauseUntil = 0; n.aimAt = 0; n.aim = null;
}
/** Emits a noise; guards and dogs within its radius come to check. */
export function noise(s: State, p: Point, radius: number, kind: Noise['kind'], crew: boolean) {
  s.noises.push({ x: p.x, y: p.y, radius, at: s.now, kind, crew });
  for (const n of s.npcs) if (dist(n, p) <= radius) investigate(s, n, p);
}
function radio(s: State, n: Npc, at: Point) {
  n.radioAt = s.now + 4000;
  if (silenced(s, n)) return;
  for (const g of s.npcs) if (g !== n && g.kind === 'guard' && dist(g, n) <= RADIO && !silenced(s, g)) investigate(s, g, at);
}
export function stun(s: State, n: Npc, ms: number) {
  const charmer = s.crew.find(p => p.id === n.charmedBy);
  if (charmer) charmer.charmReady = s.now + TIMING.charmCooldown;
  Object.assign(n, { state: 'stunned', stunUntil: s.now + ms, suspicion: 0, target: null, aimAt: 0, aim: null, charmedBy: null, flee: null, moving: false, path: [], goal: null });
}
function toPatrol(n: Npc) {
  Object.assign(n, { state: 'patrol', suspicion: 0, target: null, lastKnown: null, goal: null, path: [], pauseUntil: 0, aimAt: 0, aim: null, charmedBy: null, flee: null });
}
function toSearch(s: State, n: Npc, at: Point) {
  Object.assign(n, { state: 'search', target: null, lastKnown: pos(at), stateUntil: s.now + TIMING.search, goal: null, path: [], pauseUntil: 0, aimAt: 0, aim: null, suspicion: Math.min(n.suspicion, .6) });
}
function startChase(s: State, n: Npc, p: Crew) {
  Object.assign(n, { state: 'chase', target: p.id, suspicion: 1, lastKnown: pos(p), seenAt: s.now, goal: null, path: [], shotAt: Math.max(n.shotAt, s.now + 600) });
  s.stats[p.id].spotted++; p.disguised = false; p.seenAt = s.now;
  effect(s, p, 'spotted', n.kind === 'dog' ? 'Sniffed out!' : 'Spotted!');
  if (n.kind === 'dog') noise(s, n, 6, 'loud', false);
  else radio(s, n, p);
}
function startPanic(s: State, n: Npc, p: Crew) {
  Object.assign(n, { state: 'panic', suspicion: 1, lastKnown: pos(p), stateUntil: s.now + 15000, goal: null, path: [], flee: nearestGuard(s, n)?.id ?? null });
  s.stats[p.id].spotted++; p.seenAt = s.now;
  effect(s, p, 'spotted', 'Scream!');
  noise(s, n, 6, 'scream', false);
}
const nearestGuard = (s: State, from: Point) => s.npcs.filter(g => g.kind === 'guard' && g.state !== 'stunned' && g.state !== 'charmed').sort((a, b) => dist(a, from) - dist(b, from))[0];

/** Nearest walkable cell centre to p for this NPC (noise can come from a wall face). */
function walkable(s: State, n: Npc, p: Point): Point {
  const g = n.kind === 'dog' ? grids(s).grid : grids(s).guard;
  if (!isSolid(g, p.x, p.y)) return p;
  let best: Point = p, bd = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = { x: Math.floor(p.x) + dx + .5, y: Math.floor(p.y) + dy + .5 };
    if (!isSolid(g, c.x, c.y) && dist(c, n) < bd) { best = c; bd = dist(c, n); }
  }
  return best;
}
/** Steps toward goal along a cached A* path; guards open unlocked doors on the way. */
function moveTo(s: State, n: Npc, goal: Point, speed: number, dt: number): 'arrived' | 'moving' | 'blocked' {
  if (dist(n, goal) < REACH) return 'arrived';
  const { grid, guard } = grids(s), mask = n.kind === 'dog' ? grid : guard;
  let next = goal;
  if (!clearPath(mask, n, goal)) {
    const end = n.path[n.path.length - 1];
    if ((!n.goal || !end || dist(n.goal, goal) > .8 || dist(n, end) < REACH) && s.now >= n.pathAt) { n.path = findPath(grid, mask.solid, n, goal); n.goal = n.path.length ? pos(goal) : null; n.pathAt = s.now + 300; }
    while (n.path.length && dist(n, n.path[0]) < REACH) n.path.shift();
    if (!n.path.length) return s.now < n.pathAt && n.goal && dist(n.goal, goal) <= .8 ? 'moving' : 'blocked';
    next = n.path[0];
  }
  const d = dist(n, next);
  if (d < 1e-6) return 'arrived';
  const dx = (next.x - n.x) / d, dy = (next.y - n.y) / d, step = Math.min(d, speed * dt);
  if (n.kind !== 'dog') {
    const door = doorAt(s, n.x + dx * .8, n.y + dy * .8);
    if (door >= 0 && s.doors[door] === 'c' && isSolid(grid, n.x + dx * .8, n.y + dy * .8)) setDoor(s, door, 'o');
  }
  const to = moveCircle(grids(s).grid, n, dx * step, dy * step);
  n.moving = Math.abs(to.x - n.x) + Math.abs(to.y - n.y) > 1e-4; n.x = to.x; n.y = to.y;
  n.facing = turnToward(n.facing, Math.atan2(dy, dx), TURN * dt);
  if (n.moving || d < .05) return 'moving';
  n.path = [];
  return 'blocked';
}
/** Stand and look around: face `look`, then glance aside for the second half of the pause. */
function lookAround(s: State, n: Npc, dt: number) {
  n.facing = turnToward(n.facing, n.look + (s.now >= n.glanceAt ? n.glance : 0), 2.2 * dt);
}
function pause(s: State, n: Npc, seconds: number, look = n.facing + (random(s) - .5) * 2) {
  n.pauseUntil = s.now + seconds * 1000; n.look = look; n.glanceAt = s.now + seconds * 500; n.glance = seconds < 1 ? 0 : random(s) < .5 ? .8 : -.8;
}

function patrol(s: State, n: Npc, dt: number) {
  if (s.now < n.pauseUntil) return lookAround(s, n, dt);
  const [x, y, wait, look] = n.route[n.stop], speed = n.kind === 'guard' ? SPEED.guardPatrol : n.kind === 'dog' ? SPEED.guardSearch : SPEED.civilian;
  const status = n.route.length > 1 ? moveTo(s, n, { x: x + .5, y: y + .5 }, speed, dt) : 'arrived';
  if (status === 'moving') return;
  const r = random(s);
  if (wait) pause(s, n, wait * (.8 + r * .5), look);
  else if (r < .25 || status === 'blocked') pause(s, n, .6 + r * 2);
  n.stop = (n.stop + 1) % n.route.length; n.goal = null; n.path = [];
}
function wander(s: State, n: Npc, dt: number, speed: number) {
  if (s.now < n.pauseUntil) return lookAround(s, n, dt);
  if (!n.goal) {
    const at = n.lastKnown ?? n, g = n.kind === 'dog' ? grids(s).grid : grids(s).guard;
    for (let i = 0; i < 6 && !n.goal; i++) {
      const a = random(s) * Math.PI * 2, r = 1 + random(s) * 2.5, c = { x: Math.floor(at.x + Math.cos(a) * r) + .5, y: Math.floor(at.y + Math.sin(a) * r) + .5 };
      if (!isSolid(g, c.x, c.y) && lineOfSight(grids(s).grid, at, c)) n.goal = c;
    }
    if (!n.goal) return pause(s, n, 1);
  }
  if (moveTo(s, n, n.goal, speed, dt) !== 'moving') { n.goal = null; n.path = []; pause(s, n, .7 + random(s) * .9); }
}

function chase(s: State, n: Npc, dt: number) {
  let p = s.crew.find(c => c.id === n.target), sees = tracks(s, n, p);
  if (!sees) { const other = s.crew.find(c => c !== p && tracks(s, n, c)); if (other) { p = other; n.target = other.id; sees = true; } }
  if (sees && p) {
    n.lastKnown = pos(p); n.seenAt = s.now; p.seenAt = s.now; p.disguised = false;
    if (n.kind === 'guard' && s.now >= n.radioAt) radio(s, n, p);
    if (p.hidden && dist(n, p) <= 1.1) { unhide(p); effect(s, p, 'spotted', 'Pulled out!'); }
  }
  const d = p ? dist(n, p) : Infinity;
  if (n.kind === 'dog' && sees && p && d <= BITE && s.now >= p.shotAt) { hurt(s, p, DAMAGE.bite); p.shotAt = s.now + TIMING.shotCooldown; }
  if (n.kind === 'guard') {
    if (n.aimAt) {
      if (sees && p) { n.aim = pos(p); n.facing = Math.atan2(p.y - n.y, p.x - n.x); }
      if (s.now - n.aimAt < TIMING.aim) return;
      // Glass stops the bullet and shatters, which also opens the guard a way through.
      const fired = sees && !!p && d <= SIGHT.shootRange + 1, hit = fired && !glassBetween(s, n, p!);
      if (fired) { s.shots.push({ from: pos(n), to: pos(p!), at: s.now, hit, kind: 'guard', crew: false }); p!.shotAt = s.now + TIMING.shotCooldown; }
      if (hit) hurt(s, p!, DAMAGE.shot);
      n.aimAt = 0; n.aim = null; n.shotAt = s.now + (fired ? TIMING.shotCooldown : 450);
      return;
    }
    // One gun at a time per thief, at one guard's pace: friends close in, but damage never stacks into an instant down.
    if (sees && p && d <= SIGHT.shootRange && s.now >= Math.max(n.shotAt, p.shotAt) && !p.down && !s.npcs.some(g => g.aimAt && g.target === p.id)) { n.aimAt = s.now; n.aim = pos(p); return; }
  }
  if (!n.lastKnown) return toSearch(s, n, n);
  const status = moveTo(s, n, walkable(s, n, n.lastKnown), n.kind === 'dog' ? SPEED.dog : SPEED.guardChase, dt);
  if (!sees && (status !== 'moving' || s.now - n.seenAt > LOSE)) toSearch(s, n, n.lastKnown);
}
function panic(s: State, n: Npc, dt: number) {
  if (s.now >= n.stateUntil) return toPatrol(n);
  let guard = s.npcs.find(g => g.id === n.flee);
  if (n.flee && (!guard || guard.state === 'stunned' || guard.state === 'charmed')) { guard = nearestGuard(s, n); n.flee = guard?.id ?? null; }
  if (!guard) return;
  const near = dist(n, guard) <= 1.3;
  if (near && n.lastKnown) investigate(s, guard, n.lastKnown);
  // Reached the guard, or can't: cower where they are for a few seconds.
  if (near || moveTo(s, n, guard, SPEED.panic, dt) === 'blocked') { n.flee = null; n.stateUntil = Math.min(n.stateUntil, s.now + 5000); }
}
function charmed(s: State, n: Npc, dt: number) {
  const face = s.crew.find(p => p.id === n.charmedBy);
  if (!face || !vulnerable(face) || s.now >= n.stateUntil) { if (face) face.charmReady = s.now + TIMING.charmCooldown; return toPatrol(n); }
  if (dist(n, face) > 1.4) moveTo(s, n, face, SPEED.guardSearch, dt);
  else n.facing = turnToward(n.facing, Math.atan2(face.y - n.y, face.x - n.x), TURN * dt);
}

function step(s: State, n: Npc, dt: number) {
  n.moving = false;
  if (n.state === 'stunned') {
    if (s.now < n.stunUntil) return;
    toSearch(s, n, n);
  }
  if (n.state === 'charmed') return charmed(s, n, dt);
  if (n.state === 'panic') return panic(s, n, dt);
  if (n.state === 'chase') return chase(s, n, dt);
  let best: Crew | null = null, rate = 0;
  for (const p of s.crew) { const r = perceive(s, n, p); if (r > 0) p.seenAt = s.now; if (r > rate) { rate = r; best = p; } }
  if (best) {
    n.suspicion = Math.min(1, n.suspicion + rate * dt); n.lastKnown = pos(best); n.seenAt = s.now;
    if (n.suspicion >= 1) return n.kind === 'civilian' ? startPanic(s, n, best) : startChase(s, n, best);
    n.state = 'suspicious';
  }
  switch (n.state) {
    case 'suspicious':
      if (best) { if (n.suspicion > .3 && n.lastKnown) n.facing = turnToward(n.facing, Math.atan2(n.lastKnown.y - n.y, n.lastKnown.x - n.x), STARE_TURN * dt); return; }
      n.suspicion = Math.max(0, n.suspicion - .25 * dt);
      if (!n.suspicion) toPatrol(n);
      else if (n.kind !== 'civilian' && n.suspicion > .3 && s.now - n.seenAt > 1200 && n.lastKnown) investigate(s, n, n.lastKnown);
      return;
    case 'investigate': {
      if (n.stateUntil) { if (s.now >= n.stateUntil) toPatrol(n); else lookAround(s, n, dt); return; }
      const status = moveTo(s, n, walkable(s, n, n.lastKnown ?? n), SPEED.guardSearch, dt);
      if (status !== 'moving') { n.stateUntil = s.now + 3000; pause(s, n, 3); }
      return;
    }
    case 'search':
      n.suspicion = Math.max(0, n.suspicion - .05 * dt);
      if (s.now >= n.stateUntil) return toPatrol(n);
      return wander(s, n, dt, SPEED.guardSearch);
    default: return patrol(s, n, dt);
  }
}
export function tickNpcs(s: State, dt: number) { for (const n of s.npcs) step(s, n, dt); }
