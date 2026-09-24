// Authoritative Kitchen Rush simulation, stepped at 60 Hz. Shared vocabulary lives in model.ts; this file is server-only.
import type { GameRules, Outcome, RoundContext } from '../../../party-contract/src/index';
import {
  ACCEL, BELT_SECONDS, BURN_AT, BURN_WARN, CHARACTERS, CHEF_RADIUS, CHOP_SECONDS, CHOPPABLE, DASH_COOLDOWN, DASH_SECONDS, DASH_SPEED,
  DEFAULT_SETTINGS, EVENT_LIMIT, EXTINGUISH_SECONDS, FIRE_SPREAD_SECONDS, FLAMMABLE, ICE_ACCEL, ICE_DRAG, INGREDIENTS, PAN_CAPACITY, PAN_FOODS,
  PLATE_CAPACITY, POT_CAPACITY, POT_FOODS, RECIPES, RESPAWN_SECONDS, RETURN_SECONDS, SURFACES, THROW_SECONDS, THROW_SPEED, WALK_SPEED, WALKABLE,
  WASH_SECONDS, cookSeconds, matchRecipe, neutral, tileAt,
  type CharacterId, type Chef, type ChefStats, type Command, type EventType, type GameEvent, type Input, type Item, type KitchenMap, type Level,
  type Loose, type Order, type Part, type RecipeId, type Settings, type Tile, type TileState, type View, type Work,
} from './model';
import { LEVELS, crewScale, kitchenMap, starThresholds } from './levels';
import { nextRandom, nextRecipe, openingOrders, orderCap, orderPatience } from './orders';

// ── Server-only state ───────────────────────────────────────────────────────
/** Runtime fields ride along on the public Chef; publicView projects explicitly so they never leak. */
type Cook = Chef & { dash: number; dashReady: number; dashQueued: boolean; spray: number; workTile: number; portalReady: number; onPortal: boolean };
type Slot = { item: Item | null; progress: number; fire: number; count: number; spread: number; sprayed: boolean };
/** Loose item plus flight bookkeeping. t < 0 means resting on the floor; (px, pz) is the last point above walkable floor. */
type Drop = Loose & { t: number; px: number; pz: number; portalReady: number };
type Pending = { at: number; tile: number; count: number };
/** Tile lookups derived once per map. */
type Kitchen = {
  surfaces: number[]; heaters: number[]; flammable: number[]; belts: number[]; shown: number[]; next: number[]; neighbours: number[][];
  rackFor: number[]; plateFor: number[]; plateHome: number; dirtyReturns: boolean;
};
export type State = {
  settings: Settings; map: KitchenMap; level: Level; kitchen: Kitchen;
  players: Cook[]; slots: Slot[]; loose: Drop[]; orders: Order[]; events: GameEvent[]; pending: Pending[];
  /** Home tile of pots, pans and extinguishers; chef who last put an item on a heater (burn blame). */
  homes: Map<number, number>; placedBy: Map<number, string>;
  startedAt: number; endsAt: number; now: number; complete: boolean;
  score: number; combo: number; served: number; failed: number; stars: number; bestStars: number; thresholds: [number, number, number];
  recipeCounts: Partial<Record<RecipeId, number>>; gatesOpen: boolean; gateWarning: boolean;
  rng: number; nextId: number; nextEvent: number; nextOrderAt: number; introduced: number; beltClock: number; patience: number;
};

const R = CHEF_RADIUS, PROBE = .75, REACH = 1.3, CONE = Math.cos(35 * Math.PI / 180), PICKUP = .8, CATCH = .5, WORK_CANCEL = .35;
const GRAVITY = 18, HAND = 1.1, LAND = .9, THROW_LIFT = (LAND - HAND + GRAVITY * THROW_SECONDS ** 2 / 2) / THROW_SECONDS;
const MAX_LOOSE = 40, FIRE_REGROW = .2, DASH_BUFFER = 150, NEUTRAL = neutral();
const COMMANDS: readonly Command[] = ['grab', 'act', 'dash'], INPUT_KEYS = ['x', 'y', 'act', 'cmd', 'seq'];
const HIGHLIGHTS: [keyof ChefStats, string, number][] = [
  ['served', 'served', 3], ['extinguished', 'fires out', 3], ['washed', 'washed', 2], ['cooked', 'cooked', 2], ['caught', 'caught', 2],
  ['chopped', 'chopped', 1.5], ['thrown', 'thrown', 1], ['dashes', 'dashes', .1],
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const where = (p: { x: number; z: number }) => ({ x: r3(p.x), z: r3(p.z) });
const standing = (c: Cook) => c.connected && !c.respawnAt;
const isBox = (item: Item) => item.kind === 'plate' || item.kind === 'pot' || item.kind === 'pan';
const choppable = (item: Item) => item.kind === 'food' && item.parts[0].state === 'raw' && CHOPPABLE.includes(item.parts[0].food);
const usable = (tile: Tile) => !WALKABLE.has(tile.kind) && tile.kind !== 'void';

function rand(s: State) { const [value, next] = nextRandom(s.rng); s.rng = next; return value; }
function say(s: State, c: Cook, note: string) { c.note = note; c.noteAt = s.now; }
function emit(s: State, type: EventType, extra: Omit<GameEvent, 'id' | 'at' | 'type'> = {}) {
  s.events.push({ id: s.nextEvent++, at: s.now, type, ...extra });
  if (s.events.length > EVENT_LIMIT) s.events.shift();
}

// ── Map analysis ────────────────────────────────────────────────────────────
const kitchens = new WeakMap<KitchenMap, Kitchen>();
function analyse(map: KitchenMap): Kitchen {
  const cached = kitchens.get(map);
  if (cached) return cached;
  const { tiles, cols, rows } = map, of = (test: (tile: Tile) => boolean) => tiles.filter(test).map(tile => tile.index);
  const at = (col: number, row: number) => col < 0 || row < 0 || col >= cols || row >= rows ? undefined : tiles[row * cols + col];
  const nearest = (from: Tile, list: number[]) => {
    let best = -1, bestD = Infinity;
    for (const i of list) { const d = Math.hypot(tiles[i].x - from.x, tiles[i].z - from.z); if (d < bestD) { best = i; bestD = d; } }
    return best;
  };
  const racks = of(tile => tile.kind === 'rack'), returns = of(tile => tile.kind === 'return');
  const dirtyReturns = returns.length > 0 && tiles.some(tile => tile.kind === 'sink'), plateTiles = dirtyReturns ? returns : racks;
  const next = tiles.map(tile => { const to = tile.dir && at(tile.col + tile.dir.x, tile.row + tile.dir.z); return to && SURFACES.has(to.kind) ? to.index : -1; });
  // Belts resolve from the front of a chain backward: sort by distance to the chain's end (loops are capped).
  const depth = (i: number) => { let d = 0; for (let j = next[i]; j >= 0 && tiles[j].kind === 'belt' && d < tiles.length; j = next[j]) d++; return d; };
  const kitchen: Kitchen = {
    surfaces: of(tile => SURFACES.has(tile.kind)), heaters: of(tile => tile.kind === 'stove' || tile.kind === 'oven'), flammable: of(tile => FLAMMABLE.has(tile.kind)),
    belts: of(tile => tile.kind === 'belt').sort((a, b) => depth(a) - depth(b) || a - b), next,
    shown: of(tile => SURFACES.has(tile.kind) || FLAMMABLE.has(tile.kind) || tile.kind === 'rack' || tile.kind === 'return'),
    neighbours: tiles.map(tile => [at(tile.col + 1, tile.row), at(tile.col - 1, tile.row), at(tile.col, tile.row + 1), at(tile.col, tile.row - 1)]
      .filter((n): n is Tile => !!n && FLAMMABLE.has(n.kind)).map(n => n.index)),
    rackFor: tiles.map(tile => nearest(tile, racks)), plateFor: tiles.map(tile => nearest(tile, plateTiles)), plateHome: plateTiles[0] ?? -1, dirtyReturns,
  };
  kitchens.set(map, kitchen);
  return kitchen;
}

// ── Setup ───────────────────────────────────────────────────────────────────
const character = (choice: unknown): CharacterId => {
  const id = (choice as { character?: unknown } | undefined)?.character;
  return CHARACTERS.find(item => item.id === id)?.id ?? 'chef';
};
const zeroStats = (): ChefStats => ({ served: 0, chopped: 0, washed: 0, cooked: 0, thrown: 0, caught: 0, extinguished: 0, burnt: 0, dashes: 0, falls: 0 });

/** Builds a round on any map (tests pass custom maps from parseMap). */
export function createState(ctx: RoundContext, settings: Settings, map: KitchenMap, level: Level): State {
  const kitchen = analyse(map), count = ctx.players.length, now = ctx.nowMs, spawns = map.spawns.length ? map.spawns : [{ x: 0, z: 0 }];
  const players = ctx.players.map((player, i): Cook => {
    const spawn = spawns[i % spawns.length], lap = Math.floor(i / spawns.length);
    return {
      id: player.id, name: player.name, color: player.color, character: character(player.lobbyChoice),
      x: spawn.x + lap * .2, z: spawn.z, vx: 0, vz: 0, fx: 0, fz: 1, held: null, work: 'none', target: -1, dashing: false, respawnAt: 0,
      connected: true, seq: 0, note: '', noteAt: 0, stats: zeroStats(),
      dash: 0, dashReady: 0, dashQueued: false, spray: 0, workTile: -1, portalReady: 0, onPortal: false,
    };
  });
  const s: State = {
    settings: { ...settings }, map, level, kitchen, players, loose: [], orders: [], events: [], pending: [], homes: new Map(), placedBy: new Map(),
    slots: map.tiles.map(() => ({ item: null, progress: 0, fire: 0, count: 0, spread: 0, sprayed: false })),
    startedAt: now, endsAt: now + settings.seconds * 1000, now, complete: false,
    score: 0, combo: 1, served: 0, failed: 0, stars: 0, bestStars: 0, thresholds: starThresholds(settings.level, count, settings.seconds),
    recipeCounts: {}, gatesOpen: true, gateWarning: false,
    rng: ctx.seed >>> 0, nextId: 1, nextEvent: 1, nextOrderAt: now, introduced: 0, beltClock: 0, patience: orderPatience(level.patience, count),
  };
  for (const tile of map.tiles) if (tile.start) {
    const item: Item = { id: s.nextId++, kind: tile.start, parts: [], cook: 0 };
    s.slots[tile.index].item = item;
    s.homes.set(item.id, tile.index);
  }
  const racks = map.tiles.filter(tile => tile.kind === 'rack');
  for (let i = 0; racks.length && i < count + 3; i++) s.slots[racks[i % racks.length].index].count++;
  for (let i = 0; i < openingOrders(count); i++) addOrder(s);
  s.nextOrderAt = now + orderGap(s);
  for (const c of players) { collide(s, c); c.target = aim(s, c); }
  return s;
}

// ── Movement and collision ──────────────────────────────────────────────────
function solid(s: State, col: number, row: number) {
  const { map } = s;
  if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return true;
  const kind = map.tiles[row * map.cols + col].kind;
  return kind === 'gate' ? !s.gatesOpen : !WALKABLE.has(kind);
}
const floorAt = (s: State, x: number, z: number) => !solid(s, Math.floor(x + s.map.halfX), Math.floor(z + s.map.halfZ));

/** Pushes a chef's circle out of every blocked tile box around it and removes velocity into walls (sliding). */
function collide(s: State, c: Cook) {
  const { halfX, halfZ } = s.map;
  for (let pass = 0; pass < 2; pass++) {
    const col = Math.floor(c.x + halfX), row = Math.floor(c.z + halfZ);
    for (let r = row - 1; r <= row + 1; r++) for (let q = col - 1; q <= col + 1; q++) {
      if (!solid(s, q, r)) continue;
      const left = q - halfX, top = r - halfZ;
      let nx = c.x - clamp(c.x, left, left + 1), nz = c.z - clamp(c.z, top, top + 1);
      const d = Math.hypot(nx, nz);
      if (d >= R) continue;
      if (d < 1e-9) { // Centre inside the box: leave by the nearest face.
        const out = [c.x - left, left + 1 - c.x, c.z - top, top + 1 - c.z], m = Math.min(...out);
        if (m === out[0]) c.x = left - R; else if (m === out[1]) c.x = left + 1 + R; else if (m === out[2]) c.z = top - R; else c.z = top + 1 + R;
        continue;
      }
      nx /= d; nz /= d;
      c.x += nx * (R - d); c.z += nz * (R - d);
      const into = c.vx * nx + c.vz * nz;
      if (into < 0) { c.vx -= into * nx; c.vz -= into * nz; }
    }
  }
}

function move(s: State, c: Cook, input: Input, dt: number) {
  const length = Math.hypot(input.x, input.y), ice = tileAt(s.map, c.x, c.z)?.kind === 'ice';
  if (length > .2) { c.fx = input.x / length; c.fz = input.y / length; }
  if (c.dash > 0) { // Dash impulse along facing, decaying back to walking speed.
    const speed = WALK_SPEED + (DASH_SPEED - WALK_SPEED) * c.dash / DASH_SECONDS;
    c.vx = c.fx * speed; c.vz = c.fz * speed; c.dash = Math.max(0, c.dash - dt);
  } else {
    const limit = (ice ? ICE_ACCEL : ACCEL) * dt, dx = input.x * WALK_SPEED - c.vx, dz = input.y * WALK_SPEED - c.vz, d = Math.hypot(dx, dz), k = d > limit ? limit / d : 1;
    c.vx += dx * k; c.vz += dz * k;
    if (ice) { const drag = Math.exp(-ICE_DRAG * dt); c.vx *= drag; c.vz *= drag; }
    if (Math.abs(c.vx) < 1e-4 && Math.abs(c.vz) < 1e-4) c.vx = c.vz = 0;
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(c.vx, c.vz) * dt / .15));
  for (let i = 0; i < steps; i++) { c.x += c.vx * dt / steps; c.z += c.vz * dt / steps; collide(s, c); }
  c.dashing = c.dash > 0;
}

/** Soft circle separation between standing chefs. Disconnected chefs are ghosts others walk through, so a dropped phone never walls off a walkway. */
function separate(s: State) {
  const chefs = s.players, min = 2 * R;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < chefs.length; i++) for (let j = i + 1; j < chefs.length; j++) {
      const a = chefs[i], b = chefs[j];
      if (!standing(a) || !standing(b)) continue;
      let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-6) { const angle = (i * 7 + j) * 2.39996; dx = Math.cos(angle); dz = Math.sin(angle); d = 0; } else { dx /= d; dz /= d; }
      const push = (min - d) / 2;
      a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
    }
    for (const c of chefs) if (standing(c)) collide(s, c);
  }
}

function portal(s: State, c: Cook) {
  const tile = tileAt(s.map, c.x, c.z);
  if (tile?.kind !== 'portal' || tile.pair === undefined) { c.onPortal = false; return; }
  if (c.onPortal || s.now < c.portalReady || Math.hypot(c.x - tile.x, c.z - tile.z) > .35) return;
  const to = s.map.tiles[tile.pair];
  c.x = to.x; c.z = to.z; c.onPortal = true; c.portalReady = s.now + 1000;
  emit(s, 'portal', { ...where(to), player: c.id });
}

/** The tile 0.75 m ahead, or the best usable neighbour within a 70° cone. */
function aim(s: State, c: Cook): number {
  const { map } = s, probe = tileAt(map, c.x + c.fx * PROBE, c.z + c.fz * PROBE);
  if (probe && usable(probe)) return probe.index;
  const col = Math.floor(c.x + map.halfX), row = Math.floor(c.z + map.halfZ);
  let best = -1, bestScore = Infinity;
  for (let r = row - 1; r <= row + 1; r++) for (let q = col - 1; q <= col + 1; q++) {
    if (q < 0 || r < 0 || q >= map.cols || r >= map.rows) continue;
    const tile = map.tiles[r * map.cols + q], dx = tile.x - c.x, dz = tile.z - c.z, d = Math.hypot(dx, dz);
    if (!usable(tile) || d > REACH || d < 1e-6) continue;
    const cos = (dx * c.fx + dz * c.fz) / d, score = d * (2 - cos);
    if (cos >= CONE && score < bestScore) { best = tile.index; bestScore = score; }
  }
  return best;
}

// ── Gates, falls and lost items ─────────────────────────────────────────────
function updateGates(s: State) {
  const gates = s.level.gates;
  if (!gates) return;
  const t = ((s.now - s.startedAt) / 1000) % (gates.open + gates.closed), open = t < gates.open;
  s.gateWarning = open && t >= gates.open - gates.warn;
  if (open === s.gatesOpen) return;
  s.gatesOpen = open;
  emit(s, 'gate', { value: open ? 1 : 0 });
  if (open) return;
  for (const c of s.players) if (!c.respawnAt && tileAt(s.map, c.x, c.z)?.kind === 'gate') fall(s, c);
  for (let i = s.loose.length - 1; i >= 0; i--) {
    const drop = s.loose[i];
    if (drop.t < 0 && tileAt(s.map, drop.x, drop.z)?.kind === 'gate') { s.loose.splice(i, 1); lose(s, drop.item, drop); }
  }
}

function fall(s: State, c: Cook) {
  c.respawnAt = s.now + RESPAWN_SECONDS * 1000;
  c.vx = c.vz = c.dash = c.spray = 0; c.dashing = c.dashQueued = false; c.work = 'none'; c.target = -1; c.stats.falls++;
  emit(s, 'fall', { ...where(c), player: c.id });
  if (c.held) { lose(s, c.held, c); c.held = null; }
}

function respawn(s: State, c: Cook) {
  // The spawn farthest from any standing chef.
  let best = s.map.spawns[0] ?? { x: 0, z: 0 }, bestD = -1;
  for (const spawn of s.map.spawns) {
    let d = Infinity;
    for (const other of s.players) if (other !== c && !other.respawnAt) d = Math.min(d, Math.hypot(other.x - spawn.x, other.z - spawn.z));
    if (d > bestD) { best = spawn; bestD = d; }
  }
  c.x = best.x; c.z = best.z; c.respawnAt = 0; c.onPortal = false;
  emit(s, 'respawn', { ...where(c), player: c.id });
}

/** An item fell into a gap: food is gone, plates come back through returns, containers go home empty. */
function lose(s: State, item: Item, at: { x: number; z: number }) {
  emit(s, 'splash', where(at));
  if (item.kind === 'food') return;
  if (item.kind === 'plate' || item.kind === 'dirty') {
    if (s.kitchen.plateHome >= 0) s.pending.push({ at: s.now + RETURN_SECONDS * 1000, tile: s.kitchen.plateHome, count: item.kind === 'dirty' ? item.count ?? 1 : 1 });
    return;
  }
  item.parts = []; item.cook = 0;
  const home = s.homes.get(item.id) ?? -1, from = home >= 0 ? s.map.tiles[home] : { x: 0, z: 0 };
  let best = -1, bestD = Infinity;
  for (const i of s.kitchen.surfaces) {
    const tile = s.map.tiles[i], slot = s.slots[i];
    if (slot.item || slot.fire > 0 || placeRefusal(tile, item)) continue;
    const d = i === home ? -1 : Math.hypot(tile.x - from.x, tile.z - from.z);
    if (d < bestD) { best = i; bestD = d; }
  }
  if (best >= 0) { s.slots[best].item = item; emit(s, 'place', where(s.map.tiles[best])); return; }
  const spawn = s.map.spawns[0] ?? { x: 0, z: 0 };
  addLoose(s, rest(item, spawn.x, spawn.z));
}

// ── Loose items ─────────────────────────────────────────────────────────────
const rest = (item: Item, x: number, z: number): Drop => ({ item, x, y: 0, z, vx: 0, vy: 0, vz: 0, t: -1, px: x, pz: z, portalReady: 0 });
function addLoose(s: State, drop: Drop) {
  s.loose.push(drop);
  if (s.loose.length <= MAX_LOOSE) return;
  const old = s.loose.findIndex(other => other.t < 0 && other.item.kind === 'food');
  if (old >= 0) emit(s, 'splash', where(s.loose.splice(old, 1)[0]));
}

function fly(s: State, dt: number) {
  const { map } = s, edgeX = map.halfX - .05, edgeZ = map.halfZ - .05;
  for (let i = s.loose.length - 1; i >= 0; i--) {
    const drop = s.loose[i];
    if (drop.t < 0) continue;
    drop.t += dt; drop.x += drop.vx * dt; drop.z += drop.vz * dt; drop.vy -= GRAVITY * dt; drop.y += drop.vy * dt;
    if (Math.abs(drop.x) > edgeX) { drop.x = clamp(drop.x, -edgeX, edgeX); drop.vx = 0; }
    if (Math.abs(drop.z) > edgeZ) { drop.z = clamp(drop.z, -edgeZ, edgeZ); drop.vz = 0; }
    let tile = tileAt(map, drop.x, drop.z)!;
    if (tile.kind === 'portal' && tile.pair !== undefined && s.now >= drop.portalReady && Math.hypot(drop.x - tile.x, drop.z - tile.z) < .45) {
      const to = map.tiles[tile.pair];
      drop.x += to.x - tile.x; drop.z += to.z - tile.z; drop.portalReady = s.now + 500; tile = to;
      emit(s, 'portal', where(to));
    }
    if (floorAt(s, drop.x, drop.z)) { drop.px = drop.x; drop.pz = drop.z; }
    const catcher = s.players.find(c => standing(c) && !c.held && (c.id !== drop.by || drop.t > .2) && Math.hypot(c.x - drop.x, c.z - drop.z) < CATCH);
    if (catcher) {
      catcher.held = drop.item; catcher.stats.caught++; s.loose.splice(i, 1);
      say(s, catcher, 'Nice catch!');
      emit(s, 'catch', { ...where(catcher), player: catcher.id });
    } else if (drop.t >= THROW_SECONDS) land(s, i, tile);
  }
}

/** Thrown food lands: into an accepting container, onto an empty surface, on the floor, or lost in a gap. */
function land(s: State, i: number, tile: Tile) {
  const drop = s.loose[i], item = drop.item, slot = s.slots[tile.index];
  const gone = () => { s.loose.splice(i, 1); emit(s, 'splash', where(drop)); };
  const settle = () => { s.loose.splice(i, 1); emit(s, 'land', where(tile)); };
  if (tile.kind === 'void' || tile.kind === 'bin' || (tile.kind === 'gate' && !s.gatesOpen)) return gone();
  if (SURFACES.has(tile.kind) && slot.fire <= 0) {
    if (!slot.item && !placeRefusal(tile, item)) { slot.item = item; slot.progress = 0; return settle(); }
    if (slot.item && isBox(slot.item) && !refusal(slot.item, item.parts[0])) { addPart(slot.item, item.parts[0]); return settle(); }
  }
  // Floor, or bounced off a station it cannot rest on: settle at the last floor point along the flight.
  const onFloor = WALKABLE.has(tile.kind);
  Object.assign(drop, rest(item, onFloor ? drop.x : drop.px, onFloor ? drop.z : drop.pz));
  delete drop.by;
  emit(s, 'land', where(drop));
}

// ── Interactions ────────────────────────────────────────────────────────────
/** Why a plate, pot or pan refuses a food part, or '' when it fits. */
function refusal(box: Item, part: Part): string {
  if (part.state === 'burnt') return 'Burnt food goes in the bin';
  if (box.parts.some(p => p.state === 'burnt')) return 'Bin the burnt food first';
  if (box.kind === 'plate') {
    if (box.parts.length >= PLATE_CAPACITY) return 'Plate is full';
    return part.state === 'raw' && part.food !== 'bun' && part.food !== 'dough' ? 'Needs chopping first' : '';
  }
  const pot = box.kind === 'pot';
  if (!(pot ? POT_FOODS : PAN_FOODS).includes(part.food)) return pot ? 'Only tomato or onion go in a pot' : 'Only beef goes in a pan';
  if (part.state === 'raw') return 'Needs chopping first';
  if (part.state !== 'chopped') return 'Already cooked';
  return box.parts.length >= (pot ? POT_CAPACITY : PAN_CAPACITY) ? `${pot ? 'Pot' : 'Pan'} is full` : '';
}
/** Late ingredients dilute the heat already in a pot, so the whole batch needs more time. */
function addPart(box: Item, part: Part) {
  box.parts.push({ food: part.food, state: part.state });
  if (box.kind !== 'plate') box.cook *= (box.parts.length - 1) / box.parts.length;
}
function placeRefusal(tile: Tile, item: Item): string {
  if (tile.kind === 'board' && item.kind !== 'food') return 'Boards are for food';
  if (tile.kind === 'sink' && item.kind !== 'dirty') return 'The sink is for dirty plates';
  if (tile.kind === 'oven' && !(item.kind === 'plate' && item.parts.some(p => p.food === 'dough' && p.state === 'raw'))) return 'The oven bakes a plate with raw dough';
  return '';
}

function command(s: State, c: Cook, cmd: Command) {
  if (cmd === 'dash') { if (s.now >= c.dashReady) startDash(s, c); else if (c.dashReady - s.now <= DASH_BUFFER) c.dashQueued = true; }
  else if (cmd === 'grab') grab(s, c);
  else act(s, c);
}
function startDash(s: State, c: Cook) {
  c.dashQueued = false; c.dash = DASH_SECONDS; c.dashReady = s.now + DASH_COOLDOWN * 1000; c.work = 'none'; c.stats.dashes++;
  emit(s, 'dash', { ...where(c), player: c.id });
}

function grab(s: State, c: Cook) {
  const tile = c.target >= 0 ? s.map.tiles[c.target] : undefined;
  if (!c.held) {
    const near = nearbyLoose(s, c, tile);
    if (near >= 0) {
      const [drop] = s.loose.splice(near, 1);
      c.held = drop.item;
      emit(s, 'pickup', { ...where(drop), player: c.id });
      return;
    }
  }
  if (!tile) return c.held ? putOnFloor(s, c) : say(s, c, 'Nothing in reach');
  const slot = s.slots[tile.index];
  // An empty hand may still snatch the extinguisher off a burning counter, or one fire could lock it away for good.
  if (slot.fire > 0 && (c.held || slot.item?.kind !== 'extinguisher')) return say(s, c, 'Put it out first!');
  const holding = !!c.held;
  if (holding ? give(s, c, tile, slot) : take(s, c, tile, slot)) emit(s, holding ? 'place' : 'pickup', { ...where(tile), player: c.id });
}

function nearbyLoose(s: State, c: Cook, tile: Tile | undefined) {
  let best = -1, bestD = Math.min(PICKUP, tile ? Math.hypot(tile.x - c.x, tile.z - c.z) : Infinity);
  for (let i = 0; i < s.loose.length; i++) {
    const drop = s.loose[i], d = Math.hypot(drop.x - c.x, drop.z - c.z);
    if (drop.t < 0 && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

function putOnFloor(s: State, c: Cook) {
  const x = c.x + c.fx * .35, z = c.z + c.fz * .35, ok = floorAt(s, x, z);
  addLoose(s, rest(c.held!, ok ? x : c.x, ok ? z : c.z));
  c.held = null;
  emit(s, 'place', { ...where(c), player: c.id });
}

/** Empty-handed Grab on a tile. Returns true when something was picked up. */
function take(s: State, c: Cook, tile: Tile, slot: Slot): boolean {
  switch (tile.kind) {
    case 'crate': c.held = { id: s.nextId++, kind: 'food', parts: [{ food: tile.ingredient!, state: 'raw' }], cook: 0 }; return true;
    case 'rack':
      if (!slot.count) return say(s, c, s.kitchen.dirtyReturns ? 'No clean plates. Wash some!' : 'Plates are on their way back'), false;
      slot.count--; c.held = { id: s.nextId++, kind: 'plate', parts: [], cook: 0 }; return true;
    case 'return':
      if (!slot.count) return say(s, c, 'No dirty plates yet'), false;
      c.held = { id: s.nextId++, kind: 'dirty', parts: [], cook: 0, count: slot.count }; slot.count = 0; return true;
    case 'serve': return say(s, c, 'Bring a finished dish here'), false;
    case 'bin': return say(s, c, 'Nothing to take from the bin'), false;
  }
  if (!slot.item) return say(s, c, tile.kind === 'board' ? 'Put food here to chop it' : tile.kind === 'sink' ? 'Dirty plates get washed here' : 'Nothing here'), false;
  const item = c.held = slot.item;
  slot.item = null; slot.progress = 0;
  if (item.parts.some(p => p.state === 'burnt')) say(s, c, 'Burnt! Take it to the bin');
  else if (tile.kind === 'oven' && item.parts.some(p => p.food === 'dough' && p.state === 'cooked')) c.stats.cooked++;
  else if (item.kind !== 'plate' && item.parts.length && item.parts.every(p => p.state === 'cooked')) say(s, c, 'Pour it onto a plate');
  return true;
}

/** Grab while holding something. Returns true when the held item or the tile changed. */
function give(s: State, c: Cook, tile: Tile, slot: Slot): boolean {
  const held = c.held!;
  switch (tile.kind) {
    case 'crate': {
      const part: Part = { food: tile.ingredient!, state: 'raw' }, why = held.kind === 'plate' ? refusal(held, part) : 'Hands are full';
      if (why) return say(s, c, why), false;
      addPart(held, part);
      return true;
    }
    case 'rack':
      if (held.kind !== 'plate' || held.parts.length) return say(s, c, 'Only clean empty plates go here'), false;
      slot.count++; c.held = null; return true;
    case 'return':
      if (held.kind !== 'dirty') return say(s, c, 'Dirty plates come back here'), false;
      if (!slot.count) return say(s, c, 'No dirty plates yet'), false;
      held.count = (held.count ?? 1) + slot.count; slot.count = 0; return true;
    case 'bin': return bin(s, c, held);
    case 'serve': return serve(s, c, tile, held);
  }
  if (slot.item) return combine(s, c, slot, held);
  const why = placeRefusal(tile, held);
  if (why) return say(s, c, why), false;
  slot.item = held; slot.progress = 0; c.held = null;
  if (tile.kind === 'stove' || tile.kind === 'oven') s.placedBy.set(held.id, c.id);
  if (tile.kind === 'board' && choppable(held)) say(s, c, 'Tap Chop to chop it');
  else if (tile.kind === 'sink') say(s, c, 'Tap Wash to wash');
  return true;
}

function combine(s: State, c: Cook, slot: Slot, held: Item): boolean {
  const box = slot.item!;
  const addTo = (target: Item, part: Part) => { const why = refusal(target, part); if (why) say(s, c, why); else addPart(target, part); return !why; };
  if (held.kind === 'food') {
    if (!isBox(box)) return say(s, c, box.kind === 'food' ? 'Needs a plate' : 'Something is already here'), false;
    if (!addTo(box, held.parts[0])) return false;
    c.held = null;
    return true;
  }
  if ((held.kind === 'plate' || held.kind === 'pot' || held.kind === 'pan') && box.kind === 'food') {
    if (!addTo(held, box.parts[0])) return false;
    slot.item = null; slot.progress = 0;
    return true;
  }
  if (held.kind === 'plate' && (box.kind === 'pot' || box.kind === 'pan')) return pour(s, c, box, held);
  if ((held.kind === 'pot' || held.kind === 'pan') && box.kind === 'plate') return pour(s, c, held, box);
  if (held.kind === 'dirty' && box.kind === 'dirty') { box.count = (box.count ?? 1) + (held.count ?? 1); c.held = null; return true; }
  return say(s, c, 'Something is already here'), false;
}

function pour(s: State, c: Cook, from: Item, plate: Item): boolean {
  const why = !from.parts.length ? `The ${from.kind} is empty`
    : from.parts.some(p => p.state === 'burnt') ? 'Burnt! Bin it'
    : from.parts.some(p => p.state !== 'cooked') ? 'Not cooked yet'
    : plate.parts.some(p => p.state === 'burnt') ? 'Bin the burnt food first'
    : plate.parts.length + from.parts.length > PLATE_CAPACITY ? 'Plate is full' : '';
  if (why) return say(s, c, why), false;
  plate.parts.push(...from.parts);
  from.parts = []; from.cook = 0; c.stats.cooked++;
  return true;
}

function bin(s: State, c: Cook, held: Item): boolean {
  if (held.kind === 'food') { c.held = null; return true; }
  if (!isBox(held)) return say(s, c, held.kind === 'dirty' ? 'Wash dirty plates in the sink' : 'Keep the extinguisher!'), false;
  if (!held.parts.length) return say(s, c, 'Already empty'), false;
  held.parts = []; held.cook = 0;
  return true;
}

function serve(s: State, c: Cook, tile: Tile, held: Item): boolean {
  if (held.kind !== 'plate') return say(s, c, 'Serve dishes on a plate'), false;
  const recipe = matchRecipe(held), order = recipe && s.orders.find(o => o.recipe === recipe);
  if (!recipe || !order) {
    emit(s, 'wrong', { ...where(tile), player: c.id, ...(recipe ? { recipe } : {}) });
    return say(s, c, !held.parts.length ? 'The plate is empty' : recipe ? `No one ordered ${RECIPES[recipe].name.toLowerCase()}` : 'That is not on the menu'), false;
  }
  const left = clamp((order.expiresAt - s.now) / (order.expiresAt - order.createdAt), 0, 1), value = RECIPES[recipe].value + Math.round(8 * left) * s.combo;
  s.orders.splice(s.orders.indexOf(order), 1);
  s.score += value; s.combo = Math.min(4, s.combo + 1); s.served++; s.recipeCounts[recipe] = (s.recipeCounts[recipe] ?? 0) + 1;
  c.stats.served++; c.held = null;
  const home = s.kitchen.plateFor[tile.index];
  if (home >= 0) s.pending.push({ at: s.now + RETURN_SECONDS * 1000, tile: home, count: 1 });
  say(s, c, `Served! +${value}`);
  emit(s, 'serve', { ...where(tile), player: c.id, value, recipe });
  return false; // The serve event replaces the generic place event.
}

function act(s: State, c: Cook) {
  const tile = c.target >= 0 ? s.map.tiles[c.target] : undefined, slot = tile && s.slots[tile.index], item = slot?.item, held = c.held;
  if (tile && slot && item && slot.fire <= 0) {
    if (tile.kind === 'board' && choppable(item)) return startWork(c, 'chop', tile.index);
    if (tile.kind === 'sink' && item.kind === 'dirty') return startWork(c, 'wash', tile.index);
  }
  if (held?.kind === 'extinguisher') { c.spray = .35; c.work = 'spray'; return; }
  if (held?.kind === 'food') return throwFood(s, c, held);
  if (held) return say(s, c, held.kind === 'plate' || held.kind === 'dirty' ? 'Plates are too precious to throw' : `Carry the ${held.kind}, don't throw it`);
  if (slot && slot.fire > 0) return say(s, c, 'Grab an extinguisher!');
  if (tile?.kind === 'board') {
    const part = item?.kind === 'food' ? item.parts[0] : undefined;
    return say(s, c, !item ? 'Put raw food here, then chop' : part?.state === 'raw' ? `${INGREDIENTS[part.food].name} is used whole` : 'Already chopped');
  }
  if (tile?.kind === 'sink') return say(s, c, 'Put dirty plates in the sink first');
  say(s, c, 'Chop at a board, wash at a sink, or throw food');
}
/** Starting work also clears the hint that asked for it. */
function startWork(c: Cook, work: Work, tile: number) { c.work = work; c.workTile = tile; c.note = ''; }

function throwFood(s: State, c: Cook, item: Item) {
  c.held = null; c.stats.thrown++;
  addLoose(s, { item, x: c.x + c.fx * .3, y: HAND, z: c.z + c.fz * .3, vx: c.fx * THROW_SPEED, vy: THROW_LIFT, vz: c.fz * THROW_SPEED, by: c.id, t: 0, px: c.x, pz: c.z, portalReady: 0 });
  emit(s, 'throw', { ...where(c), player: c.id });
}

/** Continues chopping, washing and spraying; walking away or leaving reach cancels (progress stays on the tile). */
function work(s: State, c: Cook, input: Input, dt: number) {
  if (c.held?.kind === 'extinguisher' && (input.act || c.spray > 0)) { c.work = 'spray'; c.spray = Math.max(0, c.spray - dt); spray(s, c, dt); return; }
  if (c.work === 'spray') c.work = 'none';
  if (c.work !== 'chop' && c.work !== 'wash') return;
  const slot = s.slots[c.workTile], item = slot.item, chop = c.work === 'chop';
  const spot = s.map.tiles[c.workTile];
  // A bump from a passing chef keeps work going; only walking away or stepping out of reach cancels.
  if (Math.hypot(input.x, input.y) > WORK_CANCEL || Math.hypot(spot.x - c.x, spot.z - c.z) > REACH + .15 || !item || slot.fire > 0 || (chop ? !choppable(item) : item.kind !== 'dirty')) { c.work = 'none'; return; }
  slot.progress += dt / (chop ? CHOP_SECONDS : WASH_SECONDS);
  if (slot.progress < 1) return;
  const tile = spot;
  slot.progress = chop ? 0 : slot.progress - 1;
  if (chop) {
    item.parts[0].state = 'chopped'; c.work = 'none'; c.stats.chopped++;
    emit(s, 'chop', { ...where(tile), player: c.id });
    return;
  }
  item.count = (item.count ?? 1) - 1; c.stats.washed++;
  const rack = s.kitchen.rackFor[tile.index];
  if (rack >= 0) s.slots[rack].count++;
  if (item.count <= 0) { slot.item = null; slot.progress = 0; c.work = 'none'; }
  emit(s, 'wash', { ...where(tile), player: c.id });
}

function spray(s: State, c: Cook, dt: number) {
  for (const i of s.kitchen.flammable) {
    const slot = s.slots[i];
    if (slot.fire <= 0) continue;
    const tile = s.map.tiles[i], dx = tile.x - c.x, dz = tile.z - c.z, d = Math.hypot(dx, dz);
    if (i !== c.target && (d > 2.6 || (dx * c.fx + dz * c.fz) / d < .6)) continue;
    slot.sprayed = true; slot.fire -= dt / EXTINGUISH_SECONDS;
    if (slot.fire > 0) continue;
    slot.fire = 0; slot.spread = 0; c.stats.extinguished++;
    emit(s, 'extinguish', { ...where(tile), player: c.id });
  }
}

// ── Stations over time ──────────────────────────────────────────────────────
function heat(s: State, dt: number) {
  for (const i of s.kitchen.heaters) {
    const slot = s.slots[i], item = slot.item, tile = s.map.tiles[i];
    if (!item || slot.fire > 0 || !item.parts.length || item.parts[0].state === 'burnt') continue;
    const oven = tile.kind === 'oven';
    if (oven ? item.kind !== 'plate' || !item.parts.some(p => p.food === 'dough') : item.kind !== 'pot' && item.kind !== 'pan') continue;
    const done = cookSeconds(item.kind), before = item.cook, after = s.settings.relaxed ? Math.min(done, before + dt) : before + dt;
    const crossed = (mark: number) => before < mark && after >= mark;
    item.cook = after;
    if (after >= done) for (const part of item.parts) if (oven ? part.food === 'dough' && part.state === 'raw' : part.state === 'chopped') part.state = 'cooked';
    if (crossed(done)) emit(s, 'done', where(tile));
    if (s.settings.relaxed) continue;
    if (crossed(done + BURN_WARN)) emit(s, 'warn', where(tile));
    if (!crossed(done + BURN_AT)) continue;
    for (const part of item.parts) part.state = 'burnt';
    slot.fire = 1; slot.spread = 0;
    const owner = s.players.find(c => c.id === s.placedBy.get(item.id));
    if (owner) owner.stats.burnt++;
    emit(s, 'burn', where(tile));
    emit(s, 'fire', where(tile));
  }
}

function fires(s: State, dt: number) {
  for (const i of s.kitchen.flammable) {
    const slot = s.slots[i];
    if (slot.fire <= 0) continue;
    if (!slot.sprayed) slot.fire = Math.min(1, slot.fire + FIRE_REGROW * dt);
    slot.sprayed = false;
    if ((slot.spread += dt) < FIRE_SPREAD_SECONDS) continue;
    slot.spread -= FIRE_SPREAD_SECONDS;
    const options = s.kitchen.neighbours[i].filter(j => s.slots[j].fire <= 0);
    if (!options.length) continue;
    const j = options[Math.floor(rand(s) * options.length)];
    s.slots[j].fire = 1; s.slots[j].spread = 0;
    emit(s, 'fire', where(s.map.tiles[j]));
  }
}

function belts(s: State, dt: number) {
  const { kitchen } = s;
  if (!kitchen.belts.length || (s.beltClock += dt) < BELT_SECONDS) return;
  s.beltClock -= BELT_SECONDS;
  const moved = new Set<number>();
  for (const i of kitchen.belts) {
    const slot = s.slots[i], to = kitchen.next[i], item = slot.item;
    if (to < 0 || !item || slot.fire > 0 || moved.has(i)) continue;
    const dest = s.slots[to];
    if (dest.item || dest.fire > 0 || placeRefusal(s.map.tiles[to], item)) continue;
    dest.item = item; dest.progress = 0; slot.item = null; slot.progress = 0;
    moved.add(to);
  }
}

// ── Orders and scoring ──────────────────────────────────────────────────────
// Order stream matches the star maths in levels.ts: authored patience, faster with bigger crews.
const orderGap = (s: State) => s.level.patience / 2.6 / crewScale(s.players.length) * 1000;
function addOrder(s: State) {
  const recipe = nextRecipe(s.level.recipes, s.introduced, s.orders, rand(s));
  s.introduced++;
  s.orders.push({ id: s.nextId++, recipe, createdAt: s.now, expiresAt: s.now + Math.round(s.patience * 1000) });
  emit(s, 'order', { recipe });
}

function updateOrders(s: State) {
  if (!s.settings.relaxed) for (let i = 0; i < s.orders.length; i++) {
    const order = s.orders[i];
    if (order.expiresAt > s.now) continue;
    s.orders.splice(i--, 1);
    s.failed++; s.score = Math.max(0, s.score - 5); s.combo = 1;
    emit(s, 'expire', { recipe: order.recipe });
  }
  if (s.now >= s.nextOrderAt) {
    if (s.orders.length < orderCap(s.players.length)) addOrder(s);
    s.nextOrderAt = s.now + (s.orders.length < orderCap(s.players.length) ? orderGap(s) : 3000);
  }
  // Never let the rail run dry: top up to the opening count, one order every 2.5 s.
  if (s.orders.length < openingOrders(s.players.length)) s.nextOrderAt = Math.min(s.nextOrderAt, s.now + 2500);
  let stars = 0;
  for (const threshold of s.thresholds) if (s.score >= threshold) stars++;
  s.stars = stars;
  while (s.bestStars < stars) emit(s, 'star', { value: ++s.bestStars });
}

// ── Projection ──────────────────────────────────────────────────────────────
const itemView = (item: Item): Item => ({
  id: item.id, kind: item.kind, parts: item.parts.map(part => ({ food: part.food, state: part.state })), cook: Math.round(item.cook * 100) / 100,
  ...(item.count !== undefined ? { count: item.count } : {}),
});
const chefView = (c: Cook): Chef => ({
  id: c.id, name: c.name, color: c.color, character: c.character, x: r3(c.x), z: r3(c.z), vx: r3(c.vx), vz: r3(c.vz), fx: r3(c.fx), fz: r3(c.fz),
  held: c.held && itemView(c.held), work: c.work, target: c.target, dashing: c.dashing, respawnAt: c.respawnAt, connected: c.connected, seq: c.seq,
  note: c.note, noteAt: c.noteAt, stats: { ...c.stats },
});
const looseView = (drop: Drop): Loose => ({
  item: itemView(drop.item), x: r3(drop.x), y: r3(drop.y), z: r3(drop.z), vx: r3(drop.vx), vy: r3(drop.vy), vz: r3(drop.vz), ...(drop.by ? { by: drop.by } : {}),
});
function highlight(stats: ChefStats) {
  let best = HIGHLIGHTS[0], top = 0;
  for (const entry of HIGHLIGHTS) if (stats[entry[0]] * entry[2] > top) { best = entry; top = stats[entry[0]] * entry[2]; }
  return top ? `${stats[best[0]]} ${best[1]}` : 'Warming up';
}

// ── Rules ───────────────────────────────────────────────────────────────────
export const rules: GameRules<State, Input, never, Settings, View, null> = {
  parseLobbyChoice(raw) {
    if (raw === undefined || raw === null) return { character: 'chef' };
    const value = raw as { character?: unknown };
    if (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => key !== 'character') || !CHARACTERS.some(item => item.id === value.character)) throw new Error('Choose one of the six cooks.');
    return { character: value.character };
  },
  validateSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Settings must be an object.');
    if (Object.keys(raw).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw new Error('Unknown kitchen setting.');
    const { level, seconds, relaxed } = { ...DEFAULT_SETTINGS, ...raw } as Settings;
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS.length) throw new Error('Choose a kitchen.');
    if (![150, 180, 240].includes(seconds)) throw new Error('Service lasts 2.5, 3 or 4 minutes.');
    if (typeof relaxed !== 'boolean') throw new Error('Relaxed mode is on or off.');
    return { level, seconds, relaxed };
  },
  parseInput(raw) {
    const value = raw as Input;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== INPUT_KEYS.length || INPUT_KEYS.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid kitchen input.');
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1 || Math.abs(value.y) > 1 || typeof value.act !== 'boolean'
      || (value.cmd !== null && !COMMANDS.includes(value.cmd)) || !Number.isSafeInteger(value.seq) || value.seq < 0) throw new Error('Invalid kitchen input.');
    const length = Math.max(1, Math.hypot(value.x, value.y));
    return { x: value.x / length, y: value.y / length, act: value.act, cmd: value.cmd, seq: value.seq };
  },
  neutralInput: neutral,
  parseAction() { throw new Error('Kitchen Rush uses acknowledged input commands.'); },
  applyAction() {},
  create: (ctx, settings) => createState(ctx, settings, kitchenMap(settings.level, ctx.players.length), LEVELS[settings.level]),
  tick(s, inputs, dt, now) {
    if (s.complete) return;
    s.now = now;
    if (now >= s.endsAt) { s.complete = true; return; }
    updateGates(s);
    for (const c of s.players) {
      const input = inputs.get(c.id) ?? NEUTRAL;
      if (input.seq > c.seq) { c.seq = input.seq; if (input.cmd && standing(c)) command(s, c, input.cmd); }
      if (c.respawnAt && now >= c.respawnAt) respawn(s, c);
      if (!standing(c)) continue;
      if (c.dashQueued && now >= c.dashReady) startDash(s, c);
      move(s, c, input, dt);
    }
    separate(s);
    for (const c of s.players) if (standing(c)) { portal(s, c); c.target = aim(s, c); work(s, c, inputs.get(c.id) ?? NEUTRAL, dt); }
    heat(s, dt); fires(s, dt); fly(s, dt); belts(s, dt);
    for (let i = s.pending.length - 1; i >= 0; i--) if (now >= s.pending[i].at) { s.slots[s.pending[i].tile].count += s.pending[i].count; s.pending.splice(i, 1); }
    updateOrders(s);
  },
  onPresenceChange(s, playerId, connected) {
    const c = s.players.find(player => player.id === playerId);
    if (!c) return;
    c.connected = connected;
    if (connected) return;
    c.vx = c.vz = c.dash = c.spray = 0; c.dashing = c.dashQueued = false; c.work = 'none';
    if (c.held && !c.respawnAt) { addLoose(s, rest(c.held, c.x, c.z)); c.held = null; emit(s, 'place', { ...where(c), player: c.id }); }
  },
  publicView(s) {
    const tiles: TileState[] = [];
    for (const i of s.kitchen.shown) {
      const slot = s.slots[i];
      if (!slot.item && slot.progress <= 0 && slot.fire <= 0 && !slot.count) continue;
      const tile: TileState = { at: i };
      if (slot.item) tile.item = itemView(slot.item);
      if (slot.progress > 0) tile.progress = r3(slot.progress);
      if (slot.fire > 0) tile.fire = r3(slot.fire);
      if (slot.count) tile.count = slot.count;
      tiles.push(tile);
    }
    return {
      settings: { ...s.settings }, players: s.players.map(chefView), tiles, loose: s.loose.map(looseView), orders: s.orders.map(order => ({ ...order })), events: s.events.slice(),
      startedAt: s.startedAt, endsAt: s.endsAt, now: s.now, complete: s.complete, score: s.score, combo: s.combo, served: s.served, failed: s.failed,
      stars: s.stars, thresholds: [...s.thresholds], recipeCounts: { ...s.recipeCounts }, gatesOpen: s.gatesOpen, gateWarning: s.gateWarning,
    };
  },
  playerView: () => null,
  outcome: (s): Outcome => ({
    complete: s.complete, winners: s.served ? s.players.map(c => c.id) : [],
    rows: s.players.map(c => ({ playerId: c.id, score: s.score, rank: 1, label: highlight(c.stats) })),
  }),
  dispose() {},
};
export default rules;
