/* Server-only state, seeded randomness and shared helpers. Never import from browser code. */
import type { RoundContext } from '../../../../party-contract/src/index';
import { COINS_PER_CHARGE, DEFAULT_CHOICE, MAX_CHARGES, ROLES, SAFE_COINS, TOOLS, neutralInput, type Choice, type CrewStats, type Effect, type EffectKind, type HeistMap, type Input, type MissionId, type Noise, type NpcKind, type NpcState, type Phase, type Point, type Role, type Settings, type Shot, type Smoke, type Tool, type Work } from '../model';
import { buildGrid, cellIndex, doorObjects, type Grid } from '../geometry';
import { getMap } from '../maps';
import { getServerLevel, type NpcSpawn, type ServerLevel, type Stop } from '../server-levels';

export type Crew = Point & {
  id: string; name: string; color: string; seat: number; role: Role; tool: Tool;
  health: number; coins: number; charges: number; facing: number;
  moving: boolean; running: boolean; down: boolean; connected: boolean; suspended: boolean; hidden: boolean; disguised: boolean;
  work: Work | null; input: Input; absentAt: number | null;
  toolAt: number; stepAt: number; birdAt: number; charmReady: number;
  /** Earliest time any guard may take aim at (or dog bite) this thief again. */
  shotAt: number;
  /** Last time any guard, civilian or camera perceived this thief (Impostor disguise returns 6 s after). */
  seenAt: number;
  /** Set when hiding completes; the stick must be released (or pushed hard) before a push leaves the spot. */
  hideSpot: string | null; hideLatch: boolean; witnesses: string[];
  /** A lone thief's once-per-heist second wind, and when they went down. */
  wind: boolean; downAt: number;
};
export type Npc = Point & {
  id: string; kind: NpcKind; facing: number; state: NpcState; suspicion: number; moving: boolean;
  route: Stop[]; stop: number; pauseUntil: number; look: number; glance: number; glanceAt: number;
  path: Point[]; goal: Point | null; pathAt: number;
  target: string | null; lastKnown: Point | null; seenAt: number; stateUntil: number;
  aimAt: number; aim: Point | null; shotAt: number; radioAt: number; stunUntil: number;
  charmedBy: string | null; flee: string | null;
};
type Tagged<T> = T & { crew: boolean };
export type State = {
  heistId: string; mission: MissionId; settings: Settings; phase: Phase; message: string; messageAt: number;
  now: number; startedAt: number; wallAt: number; paused: number; pauseAt: number | null; elapsed: number; rng: number; endedAt: number | null;
  crew: Crew[]; npcs: Npc[];
  /** View.doors as a string (c o l b), one char per door/window object. */
  doors: string; doorBusy: number[]; broken: number[]; coins: string;
  /** Door states as the crew last saw them; the view sends these so unseen guards never show through doors. */
  seenDoors: string;
  /** Persisted work progress (0..1) by target id, so a teammate can finish it. */
  progress: Record<string, number>;
  spent: string[]; circuits: Record<string, number>; deviceOff: Record<string, number>; meters: Record<string, number>;
  objective: Point & { carrier: string | null; taken: boolean };
  smoke: Smoke[]; noises: Tagged<Noise>[]; shots: Tagged<Shot>[]; effects: Tagged<Effect>[]; nextEffect: number;
  decoys: (Point & { at: number })[]; silence: (Point & { until: number })[];
  alarm: (Point & { until: number }) | null; alarmAt: number;
  collected: number; totalLoot: number; stats: Record<string, CrewStats>;
  squad: NpcSpawn[]; squadDelay: number; squadAt: number | null;
};

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const angleDiff = (a: number, b: number) => Math.abs(wrap(a - b));
export const turnToward = (from: number, to: number, max: number) => { const d = wrap(to - from); return wrap(from + Math.max(-max, Math.min(max, d))); };
export const mapOf = (s: State): HeistMap => getMap(s.mission);
export const vulnerable = (p: Crew) => !p.down && !p.suspended;
export const relaxed = (s: State) => s.settings.difficulty === 'relaxed';
export const playing = (s: State) => s.phase === 'infiltrate' || s.phase === 'escape';
/** Distance from a point to the nearest point of cell (cx, cy). */
export const cellDist = (p: Point, cx: number, cy: number) => Math.hypot(p.x - Math.max(cx, Math.min(p.x, cx + 1)), p.y - Math.max(cy, Math.min(p.y, cy + 1)));

/** mulberry32 over the state's seed: every random decision replays exactly for an equal ctx.seed. */
export function random(s: State) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

type Grids = { key: string; grid: Grid; guard: Grid };
const gridCache = new WeakMap<State, Grids>(), doorCells = new WeakMap<HeistMap, Map<number, number>>();
/** Current occupancy. `guard` also treats closed unlocked doors as walkable, since guards open them. */
export function grids(s: State): Grids {
  const key = s.doors + s.broken.length;
  let c = gridCache.get(s);
  if (c?.key !== key) {
    const map = mapOf(s), grid = buildGrid(map, s.doors, s.broken), solid = grid.solid.slice();
    doorObjects(map).forEach((o, i) => { if (o.kind === 'door' && s.doors[i] === 'c') solid[cellIndex(map, o)] = 0; });
    c = { key, grid, guard: { ...grid, solid } }; gridCache.set(s, c);
  }
  return c;
}
/** Index into State.doors for the door/window at this cell, or -1. */
export function doorAt(s: State, x: number, y: number) {
  const map = mapOf(s);
  let cells = doorCells.get(map);
  if (!cells) { cells = new Map(doorObjects(map).map((o, i) => [cellIndex(map, o), i])); doorCells.set(map, cells); }
  return cells.get(Math.floor(y) * map.width + Math.floor(x)) ?? -1;
}
export function setDoor(s: State, i: number, state: string) {
  s.doors = s.doors.slice(0, i) + state + s.doors.slice(i + 1); s.doorBusy[i] = s.now;
}

/** A world event. Effects placed on a thief concern that thief (phones vibrate on them). */
export function effect(s: State, p: Point, kind: EffectKind, label = '', crew = true, player = 'role' in p ? (p as Crew).id : undefined) {
  s.effects.push({ x: p.x, y: p.y, id: s.nextEffect++, kind, label, at: s.now, crew, ...(player ? { player } : {}) });
}
/** Banner text for the TV; it clears itself after a few seconds (see tickSecurity). */
export function say(s: State, message: string) { s.message = message; s.messageAt = s.now; }
/** Shatters intact glass or a window at cell (x, y). True when something broke. */
export function shatter(s: State, x: number, y: number) {
  const map = mapOf(s), c = map.tiles[y]?.[x], i = y * map.width + x, door = doorAt(s, x + .5, y + .5);
  if (c === '=' && !s.broken.includes(i)) s.broken.push(i);
  else if (c === 'w' && door >= 0 && s.doors[door] !== 'b') setDoor(s, door, 'b');
  else return false;
  effect(s, { x: x + .5, y: y + .5 }, 'break', 'Shattered');
  return true;
}
/** Shatters every pane between a and b (a guard shot or dart stops there). True when glass was in the way. */
export function glassBetween(s: State, a: Point, b: Point) {
  let hit = false;
  for (let i = 0, n = Math.ceil(dist(a, b) / .1); i <= n; i++) hit = shatter(s, Math.floor(a.x + (b.x - a.x) * i / n), Math.floor(a.y + (b.y - a.y) * i / n)) || hit;
  return hit;
}
export function credit(s: State, p: Crew, amount: number) {
  const before = Math.floor(p.coins / COINS_PER_CHARGE);
  p.coins += amount; s.collected += amount; s.stats[p.id].coins += amount;
  const gained = Math.floor(p.coins / COINS_PER_CHARGE) - before;
  if (gained && p.charges < MAX_CHARGES) { p.charges = Math.min(MAX_CHARGES, p.charges + gained); effect(s, p, 'charge', `+1 ${TOOLS[p.tool].name}`); }
}
export function unhide(p: Crew) { p.hidden = p.hideLatch = false; p.hideSpot = null; p.witnesses = []; }
export function drop(s: State, p: Crew) {
  if (s.objective.carrier !== p.id) return;
  s.objective = { x: p.x, y: p.y, carrier: null, taken: true };
  say(s, `The ${mapOf(s).objectiveKind} was dropped. Grab it!`);
}
export function hurt(s: State, p: Crew, amount: number) {
  if (!vulnerable(p)) return;
  p.health = Math.max(0, Math.round(p.health - amount * (relaxed(s) ? .5 : 1)));
  p.disguised = false; p.seenAt = s.now; unhide(p);
  effect(s, p, 'hurt', `${p.name} hit`);
  if (p.health > 0) return;
  p.down = true; p.work = null; p.running = p.moving = false; p.downAt = s.now; s.stats[p.id].downs++;
  drop(s, p); effect(s, p, 'down', `${p.name} is down`);
  say(s, s.crew.some(q => q !== p && !q.suspended) ? `${p.name} is down. Push into them to revive.` : `${p.name} is down. Lie low for a second wind.`);
}
export function revive(s: State, p: Crew, health: number, by: Crew) {
  p.down = false; p.health = Math.max(p.health, health); p.seenAt = s.now;
  if (by !== p) s.stats[by.id].revives++;
  effect(s, p, 'rescue', `${p.name} is back up`);
}

export function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Expected an object.');
  return raw as Record<string, unknown>;
}
/** A seat's lobby draft; absent fields take the defaults. */
export function parseChoice(raw: unknown): Choice {
  if (raw == null) return { ...DEFAULT_CHOICE };
  const v = record(raw), role = v.role ?? DEFAULT_CHOICE.role, tool = v.tool ?? DEFAULT_CHOICE.tool;
  if (Object.keys(v).some(k => k !== 'role' && k !== 'tool') || typeof role !== 'string' || !Object.hasOwn(ROLES, role) || typeof tool !== 'string' || !Object.hasOwn(TOOLS, tool)) throw Error('Choose a specialist and tool.');
  return { role, tool } as Choice;
}

export function spawnNpc(spawn: NpcSpawn, id: string, now: number): Npc {
  const [x, y, , look] = spawn.route[0];
  return {
    id, kind: spawn.kind, x: x + .5, y: y + .5, facing: look ?? 0, state: 'patrol', suspicion: 0, moving: false,
    route: spawn.route, stop: 0, pauseUntil: 0, look: look ?? 0, glance: 0, glanceAt: 0, path: [], goal: null, pathAt: 0,
    target: null, lastKnown: null, seenAt: 0, stateUntil: 0, aimAt: 0, aim: null, shotAt: now, radioAt: 0, stunUntil: 0, charmedBy: null, flee: null,
  };
}

/** Fresh heist. `level` overrides the server NPC layout (tests use this to prove routes). */
export function create(ctx: RoundContext, settings: Settings, level: ServerLevel = getServerLevel(settings.mission)): State {
  const map = getMap(settings.mission), now = ctx.nowMs, doors = doorObjects(map);
  const safes = map.objects.filter(o => o.kind === 'safe').length, objective = map.objects.find(o => o.kind === 'objective')!;
  const s: State = {
    heistId: ctx.roundId, mission: settings.mission, settings: { ...settings }, phase: 'infiltrate', message: map.briefing, messageAt: now,
    now, startedAt: now, wallAt: now, paused: 0, pauseAt: null, elapsed: 0, rng: ctx.seed >>> 0, endedAt: null,
    crew: ctx.players.map((p, seat) => {
      const { role, tool } = parseChoice(p.lobbyChoice), spawn = map.spawns[seat % map.spawns.length];
      return {
        id: p.id, name: p.name, color: p.color, seat, role, tool, x: spawn.x, y: spawn.y, facing: -Math.PI / 2,
        health: 100, coins: 0, charges: 2, moving: false, running: false, down: false, connected: true, suspended: false, hidden: false, disguised: role === 'impostor',
        work: null, input: neutralInput(), absentAt: null, toolAt: 0, stepAt: 0, birdAt: 0, charmReady: 0, shotAt: 0, seenAt: now, hideSpot: null, hideLatch: false, witnesses: [], wind: true, downAt: 0,
      };
    }),
    npcs: level.npcs.map((n, i) => spawnNpc(n, `${n.kind}-${i}`, now)),
    doors: doors.map(o => o.locked ? 'l' : 'c').join(''), seenDoors: doors.map(o => o.locked ? 'l' : 'c').join(''), doorBusy: doors.map(() => now), broken: [], coins: '1'.repeat(map.coins.length),
    progress: {}, spent: [], circuits: {}, deviceOff: {}, meters: {},
    objective: { x: objective.x, y: objective.y, carrier: null, taken: false },
    smoke: [], noises: [], shots: [], effects: [], nextEffect: 1, decoys: [], silence: [], alarm: null, alarmAt: 0,
    collected: 0, totalLoot: map.coins.length + safes * SAFE_COINS, stats: Object.fromEntries(ctx.players.map(p => [p.id, { coins: 0, spotted: 0, takedowns: 0, revives: 0, downs: 0, tools: 0 }])),
    squad: level.reinforcements?.npcs ?? [], squadDelay: (level.reinforcements?.delay ?? 0) * 1000, squadAt: null,
  };
  for (const n of s.npcs) n.pauseUntil = now + random(s) * 1500;
  return s;
}
