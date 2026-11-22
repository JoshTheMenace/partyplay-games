/* Wire form of a service: what server.ts sends and every screen decodes. Browser-safe, no rules in here.
 *
 * Every phone receives the public view twenty times a second, so a room's traffic grows with the square of its roster.
 * A ten-chef kitchen used to cost each phone about 9 KiB a snapshot as JSON; this form is about a tenth of that, which is
 * what lets 64 chefs (eight kitchens) cost each phone roughly what ten did.
 *  - What never changes in a service (settings, clock, line sizes, star targets, the roster) sits in `base`, and the end of
 *    service figures (per-chef stats, recipe tallies) in `final`. The platform's snapshot cache sends both once per socket:
 *    `rev` is 1 while cooking and 2 once `final` is attached. The room keeps sending snapshots while results are up, so
 *    the frozen kitchens move into `final` too (`final.k`) and `k` goes empty.
 *  - Everything that moves is packed as bytes and sent as base64url text in `k`, one length-prefixed block per kitchen.
 *    Positions travel in centimetres, velocities in 0.1 m/s, facing as one byte, times as offsets from the start.
 *  - Only events from the last two seconds travel (screens ignore older ones anyway), not the whole 32-event history.
 *  - A seat's command acknowledgement and note are private (model.ts `Own`), so they are not here at all.
 * decodeWire(wire) rebuilds one View per kitchen plus the restaurant totals, memoized per snapshot object. */
import {
  CHARACTERS, RECIPES, STAT_KEYS, rankScores, zeroStats,
  type Chef, type ChefStats, type EventType, type FoodState, type GameEvent, type Ingredient, type Item, type ItemKind, type Loose, type Order, type RecipeId, type Restaurant,
  type Settings, type TileState, type View, type Work,
} from './model';

const FOODS: readonly Ingredient[] = ['lettuce', 'tomato', 'onion', 'patty', 'bun', 'dough', 'cheese'];
const STATES: readonly FoodState[] = ['raw', 'chopped', 'cooked', 'burnt'];
const KINDS: readonly ItemKind[] = ['food', 'plate', 'dirty', 'pot', 'pan', 'extinguisher'];
const WORKS: readonly Work[] = ['none', 'chop', 'wash', 'spray'];
const EVENTS = ['serve', 'wrong', 'expire', 'chop', 'wash', 'done', 'warn', 'burn', 'fire', 'extinguish', 'throw', 'catch', 'land', 'splash', 'dash', 'fall', 'respawn', 'portal', 'gate',
  'pickup', 'place', 'star', 'order'] as const satisfies readonly EventType[];
// Compile-time guard: a new event type must be listed above, or it would not survive the trip.
const complete: [Exclude<EventType, typeof EVENTS[number]>] extends [never] ? true : never = true; void complete;
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];
/** Events older than this stay on the server. Screens only react to events younger than 1.5 s. */
export const EVENT_WINDOW_MS = 2000;
const NOBODY = 255, HEATED: readonly ItemKind[] = ['plate', 'pot', 'pan'];

export type Base = {
  settings: Settings; startedAt: number; endsAt: number;
  /** One entry per kitchen: its crew size and star targets. Chefs are listed in `roster` kitchen by kitchen. */
  lines: [size: number, one: number, two: number, three: number][];
  roster: [id: string, name: string, color: string, character: number][];
};
export type Final = { /** Per chef, in roster order and STAT_KEYS order. */ stats: number[][]; /** Per kitchen, dishes served in RECIPE_IDS order. */ recipes: number[][]; /** The kitchens as they stood at the bell. */ k: string };
export type Wire = { rev: number; base: Base; final: Final | null; now: number; k: string };

/* ---------------- bytes ⇄ base64url ---------------- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', UN64 = new Uint8Array(128);
for (let i = 0; i < 64; i++) UN64[B64.charCodeAt(i)] = i;
let out = new Uint8Array(8192), at = 0;
/** Writes an integer, clamped to what `size` bytes hold. */
function put(value: number, size: number, signed = false) {
  const span = 2 ** (size * 8), low = signed ? -span / 2 : 0, v = Math.round(value), n = v < low ? low : v >= low + span ? low + span - 1 : v;
  if (at + size > out.length) { const grown = new Uint8Array(out.length * 2); grown.set(out); out = grown; }
  for (let shift = (size - 1) * 8, u = n < 0 ? n + span : n; shift >= 0; shift -= 8) out[at++] = Math.floor(u / 2 ** shift) & 255;
}
function text() {
  let s = '';
  for (let i = 0; i < at; i += 3) {
    const n = out[i] << 16 | (i + 1 < at ? out[i + 1] << 8 : 0) | (i + 2 < at ? out[i + 2] : 0);
    s += B64[n >> 18] + B64[n >> 12 & 63] + (i + 1 < at ? B64[n >> 6 & 63] : '') + (i + 2 < at ? B64[n & 63] : '');
  }
  at = 0;
  return s;
}
let src = new Uint8Array(0), rp = 0;
function open(s: string) {
  const n = Math.floor(s.length * 3 / 4), code = (i: number) => i < s.length ? UN64[s.charCodeAt(i) & 127] : 0;
  src = new Uint8Array(n); rp = 0;
  for (let i = 0, o = 0; i < s.length; i += 4) { const v = code(i) << 18 | code(i + 1) << 12 | code(i + 2) << 6 | code(i + 3); src[o++] = v >> 16; if (o < n) src[o++] = v >> 8 & 255; if (o < n) src[o++] = v & 255; }
}
function get(size: number, signed = false) {
  let n = 0;
  for (let i = 0; i < size; i++) n = n * 256 + src[rp++];
  return signed && n >= 2 ** (size * 8 - 1) ? n - 2 ** (size * 8) : n;
}

/* ---------------- encode ---------------- */
function putItem(item: Item) {
  put(item.id, 2); put(KINDS.indexOf(item.kind) | item.parts.length << 3, 1);
  for (const part of item.parts) put(FOODS.indexOf(part.food) << 2 | STATES.indexOf(part.state), 1);
  if (HEATED.includes(item.kind)) put(item.cook * 10, 1);
  if (item.kind === 'dirty') put(item.count ?? 1, 1);
}
function putLine(view: View) {
  const start = at, tick = (ms: number, unit: number) => Math.max(0, (ms - view.startedAt) / unit), seat = (id: string | undefined) => { const i = id ? view.players.findIndex(chef => chef.id === id) : -1; return i < 0 ? NOBODY : i; };
  put(0, 2); put(view.score, 2); put(view.combo, 1); put(view.served, 2); put(view.failed, 2); put(+view.gatesOpen | +view.gateWarning << 1, 1);
  for (const chef of view.players) {
    put(chef.x * 100, 2, true); put(chef.z * 100, 2, true); put(chef.vx * 10, 1, true); put(chef.vz * 10, 1, true); put(Math.round(Math.atan2(chef.fx, chef.fz) / (Math.PI * 2) * 256) & 255, 1);
    put(WORKS.indexOf(chef.work) | +chef.dashing << 2 | +chef.connected << 3 | +!!chef.held << 4 | +(chef.respawnAt > 0) << 5, 1); put(chef.target, 2, true);
    if (chef.respawnAt > 0) put(tick(chef.respawnAt, 20), 2);
    if (chef.held) putItem(chef.held);
  }
  const tiles = view.tiles.slice(0, 255); put(tiles.length, 1);
  for (const tile of tiles) {
    put(tile.at, 2); put(+!!tile.item | +!!tile.progress << 1 | +!!tile.fire << 2 | +!!tile.count << 3, 1);
    if (tile.item) putItem(tile.item);
    if (tile.progress) put(tile.progress * 255, 1);
    if (tile.fire) put(Math.max(1, tile.fire * 255), 1);
    if (tile.count) put(tile.count, 1);
  }
  put(view.loose.length, 1);
  for (const drop of view.loose) { putItem(drop.item); put(drop.x * 100, 2, true); put(drop.y * 100, 2, true); put(drop.z * 100, 2, true); put(drop.vx * 10, 1, true); put(drop.vy * 10, 1, true); put(drop.vz * 10, 1, true); put(seat(drop.by), 1); }
  put(view.orders.length, 1);
  for (const order of view.orders) { put(order.id, 2); put(RECIPE_IDS.indexOf(order.recipe), 1); put(tick(order.createdAt, 100), 2); put(tick(order.expiresAt, 100), 2); }
  const events = view.events.filter(event => view.now - event.at < EVENT_WINDOW_MS); put(events.length, 1);
  for (const event of events) {
    const where = event.x !== undefined && event.z !== undefined;
    put(event.id, 2); put(EVENTS.indexOf(event.type), 1); put(tick(event.at, 100), 2); put(+where | +(event.player !== undefined) << 1 | +(event.value !== undefined) << 2 | +(event.recipe !== undefined) << 3, 1);
    if (where) { put(event.x! * 100, 2, true); put(event.z! * 100, 2, true); }
    if (event.player !== undefined) put(seat(event.player), 1);
    if (event.value !== undefined) put(event.value, 2);
    if (event.recipe !== undefined) put(RECIPE_IDS.indexOf(event.recipe), 1);
  }
  const length = at - start - 2;
  out[start] = length >> 8; out[start + 1] = length & 255;
}
/** Pack the kitchens of one service (line views in line order). `final` rides along once the service is complete. */
export function encodeWire(lines: readonly View[]): Wire {
  const first = lines[0], done = first.complete;
  for (const line of lines) putLine(line);
  const packed = text();
  return {
    rev: done ? 2 : 1, now: first.now, k: done ? '' : packed,
    base: {
      settings: { ...first.settings }, startedAt: first.startedAt, endsAt: first.endsAt, lines: lines.map(line => [line.players.length, ...line.thresholds]),
      roster: lines.flatMap(line => line.players.map((chef): Base['roster'][number] => [chef.id, chef.name, chef.color, CHARACTERS.findIndex(item => item.id === chef.character)])),
    },
    final: done ? { stats: lines.flatMap(line => line.players.map(chef => STAT_KEYS.map(key => chef.stats[key]))), recipes: lines.map(line => RECIPE_IDS.map(id => line.recipeCounts[id] ?? 0)), k: packed } : null,
  };
}

/* ---------------- decode ---------------- */
const NO_STATS: ChefStats = Object.freeze(zeroStats());
function getItem(): Item {
  const id = get(2), head = get(1), kind = KINDS[head & 7], parts: Item['parts'] = [];
  for (let i = head >> 3; i > 0; i--) { const part = get(1); parts.push({ food: FOODS[part >> 2], state: STATES[part & 3] }); }
  const item: Item = { id, kind, parts, cook: HEATED.includes(kind) ? get(1) / 10 : 0 };
  if (kind === 'dirty') item.count = get(1);
  return item;
}
function getLine(wire: Wire, line: number, first: number): View {
  const { base, final } = wire, [size, ...thresholds] = base.lines[line], time = (unit: number) => base.startedAt + get(2) * unit;
  const score = get(2), combo = get(1), served = get(2), failed = get(2), flags = get(1), players: Chef[] = [];
  const name = (seat: number) => seat === NOBODY ? undefined : base.roster[first + seat]?.[0];
  for (let i = 0; i < size; i++) {
    const [id, called, color, character] = base.roster[first + i], x = get(2, true) / 100, z = get(2, true) / 100, vx = get(1, true) / 10, vz = get(1, true) / 10, facing = get(1) / 256 * Math.PI * 2, bits = get(1), target = get(2, true);
    const stats = final?.stats[first + i];
    players.push({
      id, name: called, color, character: (CHARACTERS[character] ?? CHARACTERS[0]).id, x, z, vx, vz, fx: Math.sin(facing), fz: Math.cos(facing), work: WORKS[bits & 3], dashing: !!(bits & 4), connected: !!(bits & 8), target,
      respawnAt: bits & 32 ? time(20) : 0, held: bits & 16 ? getItem() : null, seq: 0, note: '', noteAt: 0,
      stats: stats ? Object.fromEntries(STAT_KEYS.map((key, n) => [key, stats[n] ?? 0])) as ChefStats : NO_STATS,
    });
  }
  const tiles: TileState[] = [];
  for (let i = get(1); i > 0; i--) {
    const tile: TileState = { at: get(2) }, bits = get(1);
    if (bits & 1) tile.item = getItem();
    if (bits & 2) tile.progress = get(1) / 255;
    if (bits & 4) tile.fire = get(1) / 255;
    if (bits & 8) tile.count = get(1);
    tiles.push(tile);
  }
  const loose: Loose[] = [];
  for (let i = get(1); i > 0; i--) {
    const drop: Loose = { item: getItem(), x: get(2, true) / 100, y: get(2, true) / 100, z: get(2, true) / 100, vx: get(1, true) / 10, vy: get(1, true) / 10, vz: get(1, true) / 10 }, by = name(get(1));
    if (by) drop.by = by;
    loose.push(drop);
  }
  const orders: Order[] = [];
  for (let i = get(1); i > 0; i--) orders.push({ id: get(2), recipe: RECIPE_IDS[get(1)], createdAt: time(100), expiresAt: time(100) });
  const events: GameEvent[] = [];
  for (let i = get(1); i > 0; i--) {
    const event: GameEvent = { id: get(2), type: EVENTS[get(1)], at: time(100) }, bits = get(1);
    if (bits & 1) { event.x = get(2, true) / 100; event.z = get(2, true) / 100; }
    if (bits & 2) { const player = name(get(1)); if (player) event.player = player; }
    if (bits & 4) event.value = get(2);
    if (bits & 8) event.recipe = RECIPE_IDS[get(1)];
    events.push(event);
  }
  const recipeCounts: View['recipeCounts'] = {};
  final?.recipes[line]?.forEach((count, i) => { if (count) recipeCounts[RECIPE_IDS[i]] = count; });
  return {
    settings: base.settings, players, tiles, loose, orders, events, startedAt: base.startedAt, endsAt: base.endsAt, now: wire.now, complete: wire.rev > 1,
    score, combo, served, failed, stars: thresholds.filter(target => score >= target).length, thresholds: thresholds as View['thresholds'], recipeCounts,
    gatesOpen: !!(flags & 1), gateWarning: !!(flags & 2), line, first,
  };
}
const decoded = new WeakMap<Wire, Restaurant>();
/** Every kitchen of the service and the restaurant's shared score (the sum of its kitchens against the sum of their targets). */
export function decodeWire(wire: Wire): Restaurant {
  let restaurant = decoded.get(wire);
  if (restaurant) return restaurant;
  open(wire.final?.k ?? wire.k);
  const lines: View[] = [];
  for (let line = 0, first = 0; line < wire.base.lines.length; first += wire.base.lines[line++][0]) { const end = get(2) + rp; lines.push(getLine(wire, line, first)); rp = end; }
  const sum = (pick: (view: View) => number) => lines.reduce((total, view) => total + pick(view), 0), score = sum(view => view.score);
  const thresholds = [0, 1, 2].map(i => sum(view => view.thresholds[i])) as Restaurant['thresholds'];
  restaurant = { lines, score, thresholds, stars: thresholds.filter(target => score >= target).length, served: sum(view => view.served), failed: sum(view => view.failed), ranks: rankScores(lines.map(view => view.score)) };
  decoded.set(wire, restaurant);
  return restaurant;
}
/** The kitchen a player cooks in (the first one for a watching display). */
export function kitchenOf(restaurant: Restaurant, playerId: string | null): View {
  return (playerId && restaurant.lines.find(view => view.players.some(chef => chef.id === playerId))) || restaurant.lines[0];
}
