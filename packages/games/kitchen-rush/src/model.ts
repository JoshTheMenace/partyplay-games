// Shared, browser-safe vocabulary for rules, client and scene. No server-only logic or state lives here.

// ── Food ────────────────────────────────────────────────────────────────────
export type Ingredient = 'lettuce' | 'tomato' | 'onion' | 'patty' | 'bun' | 'dough' | 'cheese';
export type FoodState = 'raw' | 'chopped' | 'cooked' | 'burnt';
export type Part = { food: Ingredient; state: FoodState };
export const INGREDIENTS: Record<Ingredient, { name: string; color: string }> = {
  lettuce: { name: 'Lettuce', color: '#6fbf45' }, tomato: { name: 'Tomato', color: '#e9503c' }, onion: { name: 'Onion', color: '#c99bd6' },
  patty: { name: 'Beef', color: '#c0574f' }, bun: { name: 'Bun', color: '#e9ad5c' }, dough: { name: 'Dough', color: '#f1d49b' }, cheese: { name: 'Cheese', color: '#f7c948' },
};
/** Raw foods that a chopping board turns into `chopped`. Bun and dough are used whole. */
export const CHOPPABLE: readonly Ingredient[] = ['lettuce', 'tomato', 'onion', 'patty', 'cheese'];
/** Chopped foods a pot accepts (soups) and a pan accepts (fried beef). */
export const POT_FOODS: readonly Ingredient[] = ['tomato', 'onion'];
export const PAN_FOODS: readonly Ingredient[] = ['patty'];

// ── Items ───────────────────────────────────────────────────────────────────
/**
 * Every movable thing has an id and exactly one location (chef hands, a tile, the floor/air, or a pending return).
 * food: parts[0] is the ingredient. plate: parts are its contents. dirty: a stack of `count` dirty plates.
 * pot / pan: parts are the ingredients inside; `cook` is seconds of heat applied (kept when lifted off the stove).
 * A plate inside an oven uses `cook` for baking. extinguisher: no parts.
 */
export type ItemKind = 'food' | 'plate' | 'dirty' | 'pot' | 'pan' | 'extinguisher';
export type Item = { id: number; kind: ItemKind; parts: Part[]; cook: number; count?: number };
export const POT_CAPACITY = 3, PAN_CAPACITY = 1, PLATE_CAPACITY = 4;

// ── Recipes ─────────────────────────────────────────────────────────────────
export type RecipeId = 'side_salad' | 'salad' | 'tomato_soup' | 'onion_soup' | 'burger' | 'cheeseburger' | 'deluxe_burger' | 'pizza';
export type Recipe = { id: RecipeId; name: string; parts: Part[]; value: number };
const p = (food: Ingredient, state: FoodState): Part => ({ food, state });
export const RECIPES: Record<RecipeId, Recipe> = {
  side_salad: { id: 'side_salad', name: 'Side salad', value: 20, parts: [p('lettuce', 'chopped')] },
  salad: { id: 'salad', name: 'Garden salad', value: 30, parts: [p('lettuce', 'chopped'), p('tomato', 'chopped')] },
  tomato_soup: { id: 'tomato_soup', name: 'Tomato soup', value: 40, parts: [p('tomato', 'cooked'), p('tomato', 'cooked'), p('tomato', 'cooked')] },
  onion_soup: { id: 'onion_soup', name: 'Onion soup', value: 40, parts: [p('onion', 'cooked'), p('onion', 'cooked'), p('onion', 'cooked')] },
  burger: { id: 'burger', name: 'Burger', value: 40, parts: [p('bun', 'raw'), p('patty', 'cooked')] },
  cheeseburger: { id: 'cheeseburger', name: 'Cheeseburger', value: 50, parts: [p('bun', 'raw'), p('patty', 'cooked'), p('cheese', 'chopped')] },
  deluxe_burger: { id: 'deluxe_burger', name: 'Deluxe burger', value: 60, parts: [p('bun', 'raw'), p('patty', 'cooked'), p('lettuce', 'chopped'), p('tomato', 'chopped')] },
  pizza: { id: 'pizza', name: 'Margherita pizza', value: 60, parts: [p('dough', 'cooked'), p('tomato', 'chopped'), p('cheese', 'chopped')] },
};
const signature = (parts: readonly Part[]) => parts.map(part => `${part.food}:${part.state}`).sort().join('|');
const SIGNATURES = new Map(Object.values(RECIPES).map(recipe => [signature(recipe.parts), recipe.id]));
/** Exact multiset match of a clean plate's contents. */
export function matchRecipe(item: Item | null | undefined): RecipeId | undefined {
  return item?.kind === 'plate' && item.parts.length ? SIGNATURES.get(signature(item.parts)) : undefined;
}

// ── Timing and movement (seconds, metres; one tile = 1 m) ───────────────────
export const CHOP_SECONDS = 2.1, WASH_SECONDS = 1.6;
export const POT_SECONDS = 9, PAN_SECONDS = 6, OVEN_SECONDS = 9;
/** After food is done: warning begins at +BURN_WARN, food burns and the station ignites at +BURN_AT. */
export const BURN_WARN = 5, BURN_AT = 9;
export const FIRE_SPREAD_SECONDS = 4, EXTINGUISH_SECONDS = 1.1;
export const RETURN_SECONDS = 6, BELT_SECONDS = 1.1;
export const CHEF_RADIUS = 0.34, WALK_SPEED = 4.4, ACCEL = 40, ICE_ACCEL = 7, ICE_DRAG = 0.8;
export const DASH_SPEED = 11, DASH_SECONDS = 0.18, DASH_COOLDOWN = 0.55;
export const THROW_SPEED = 9, THROW_SECONDS = 0.45, RESPAWN_SECONDS = 3;
export const COUNTER_HEIGHT = 0.9;
/** Heat needed for a container to finish. A pot needs full time for any number of ingredients. */
export const cookSeconds = (kind: ItemKind) => kind === 'pot' ? POT_SECONDS : kind === 'pan' ? PAN_SECONDS : OVEN_SECONDS;

// ── Kitchen maps ────────────────────────────────────────────────────────────
/**
 * Maps are authored as equal-length rows. Row 0 is the back wall (far from camera); +X is right, +Z is toward the camera.
 * Tile (col,row) is centred at x = col + .5 - cols/2, z = row + .5 - rows/2.
 *
 *  .  floor              @  floor + chef spawn       *  ice floor          ~  void (gap/water, never walkable)
 *  g  drawbridge floor (walkable only while gates are open)                 T  portal pad (pairs in reading order)
 *  #  counter            E  counter holding an extinguisher                 C  chopping board
 *  O  stove with a pot   F  stove with a frying pan  V  oven               W  sink
 *  R  clean plate rack   D  dirty plate return       H  serving hatch       X  bin
 *  l t o p b d c   ingredient crates: lettuce tomato onion patty bun dough cheese
 *  > < ^ v  conveyor belt counters moving their item one tile that way every BELT_SECONDS
 */
export type TileKind = 'floor' | 'ice' | 'void' | 'gate' | 'portal' | 'counter' | 'board' | 'stove' | 'oven' | 'sink' | 'rack' | 'return' | 'serve' | 'bin' | 'crate' | 'belt';
export type Tile = { index: number; col: number; row: number; x: number; z: number; kind: TileKind; ingredient?: Ingredient; dir?: { x: number; z: number }; pair?: number; start?: 'pot' | 'pan' | 'extinguisher' };
export type KitchenMap = { cols: number; rows: number; halfX: number; halfZ: number; tiles: Tile[]; spawns: { x: number; z: number }[] };
export const WALKABLE: ReadonlySet<TileKind> = new Set(['floor', 'ice', 'gate', 'portal']);
/** Counters and stations that can hold an item (crates, racks, returns, hatch and bin never hold one). */
export const SURFACES: ReadonlySet<TileKind> = new Set(['counter', 'board', 'stove', 'oven', 'sink', 'belt']);
/** Surfaces that catch fire when a neighbouring station burns. */
export const FLAMMABLE: ReadonlySet<TileKind> = new Set(['counter', 'board', 'stove', 'oven', 'belt', 'crate']);
const CRATES: Record<string, Ingredient> = { l: 'lettuce', t: 'tomato', o: 'onion', p: 'patty', b: 'bun', d: 'dough', c: 'cheese' };
const BELTS: Record<string, { x: number; z: number }> = { '>': { x: 1, z: 0 }, '<': { x: -1, z: 0 }, '^': { x: 0, z: -1 }, v: { x: 0, z: 1 } };
const KINDS: Record<string, TileKind> = { '.': 'floor', '@': 'floor', '*': 'ice', '~': 'void', g: 'gate', T: 'portal', '#': 'counter', E: 'counter', C: 'board', O: 'stove', F: 'stove', V: 'oven', W: 'sink', R: 'rack', D: 'return', H: 'serve', X: 'bin' };
export function parseMap(rows: readonly string[]): KitchenMap {
  const cols = rows[0].length, tiles: Tile[] = [], spawns: KitchenMap['spawns'] = [], portals: number[] = [];
  if (rows.some(row => row.length !== cols)) throw new Error('Kitchen map rows must have equal length.');
  rows.forEach((line, row) => [...line].forEach((char, col) => {
    const kind = CRATES[char] ? 'crate' : BELTS[char] ? 'belt' : KINDS[char];
    if (!kind) throw new Error(`Unknown kitchen map tile "${char}" at ${col},${row}.`);
    const tile: Tile = { index: tiles.length, col, row, x: col + .5 - cols / 2, z: row + .5 - rows.length / 2, kind };
    if (CRATES[char]) tile.ingredient = CRATES[char];
    if (BELTS[char]) tile.dir = BELTS[char];
    if (char === 'O') tile.start = 'pot'; else if (char === 'F') tile.start = 'pan'; else if (char === 'E') tile.start = 'extinguisher';
    if (char === '@') spawns.push({ x: tile.x, z: tile.z });
    if (kind === 'portal') portals.push(tile.index);
    tiles.push(tile);
  }));
  for (let i = 0; i + 1 < portals.length; i += 2) { tiles[portals[i]].pair = portals[i + 1]; tiles[portals[i + 1]].pair = portals[i]; }
  return { cols, rows: rows.length, halfX: cols / 2, halfZ: rows.length / 2, tiles, spawns };
}
export function tileAt(map: KitchenMap, x: number, z: number): Tile | undefined {
  const col = Math.floor(x + map.halfX), row = Math.floor(z + map.halfZ);
  return col < 0 || row < 0 || col >= map.cols || row >= map.rows ? undefined : map.tiles[row * map.cols + col];
}

// ── Levels (data authored in levels.ts) ─────────────────────────────────────
export type Theme = 'diner' | 'harbor' | 'alpine' | 'canyon' | 'market' | 'grand';
export type Level = {
  id: string; name: string; location: string; blurb: string; theme: Theme; recipes: RecipeId[];
  /** Maps for 1–4 chefs and 5–10 chefs. Each needs at least 4 / 10 spawns. */
  small: readonly string[]; large: readonly string[];
  /** Seconds a fresh order waits (before roster/relaxed adjustments). */
  patience: number;
  /** Score for one, two and three stars with two chefs over 180 seconds; starThresholds() scales it. */
  stars: [number, number, number];
  /** Most a crew can score relative to two chefs when the kitchen itself, not the crew, is the limit (caps star scaling). */
  crowd?: number;
  gates?: { open: number; closed: number; warn: number };
};

// ── Chefs and input ─────────────────────────────────────────────────────────
export const CHARACTERS = [{ id: 'chef', name: 'Chef' }, { id: 'chef_f', name: 'Head chef' }, { id: 'cat', name: 'Cat' }, { id: 'dog', name: 'Dog' }, { id: 'iguana', name: 'Iguana' }, { id: 'axolotl', name: 'Axolotl' }] as const;
export type CharacterId = typeof CHARACTERS[number]['id'];
export type ChefStats = { served: number; chopped: number; washed: number; cooked: number; thrown: number; caught: number; extinguished: number; burnt: number; dashes: number; falls: number };
export type Work = 'none' | 'chop' | 'wash' | 'spray';
export type Chef = {
  id: string; name: string; color: string; character: CharacterId;
  x: number; z: number; vx: number; vz: number; fx: number; fz: number;
  held: Item | null; work: Work; /** Tile index the chef is facing and would use, or -1. */ target: number;
  dashing: boolean; /** Server time when a fallen chef reappears; 0 while standing. */ respawnAt: number;
  connected: boolean; /** Highest command sequence the server has applied (acknowledgement for the phone). */ seq: number;
  note: string; noteAt: number; stats: ChefStats;
};
/**
 * Complete held state plus one queued command. The phone resends the oldest unacknowledged command with its
 * sequence until `Chef.seq` catches up, so quick taps survive input coalescing.
 * grab: pick up / put down / combine. act: start chopping or washing the faced tile, otherwise throw held food.
 * `act` (held) keeps an extinguisher spraying.
 */
export type Command = 'grab' | 'act' | 'dash';
export type Input = { x: number; y: number; act: boolean; cmd: Command | null; seq: number };
export const neutral = (): Input => ({ x: 0, y: 0, act: false, cmd: null, seq: 0 });
export type Settings = { level: number; seconds: 150 | 180 | 240; relaxed: boolean };
export const DEFAULT_SETTINGS: Settings = { level: 0, seconds: 180, relaxed: false };

// ── Public view ─────────────────────────────────────────────────────────────
/** Dynamic state of one tile; only tiles with something to show are listed. */
export type TileState = { at: number; item?: Item; /** Chop or wash progress 0–1. */ progress?: number; /** Fire intensity 0–1. */ fire?: number; /** Plates stacked on a rack or return. */ count?: number };
/** A thrown or dropped item. y is height above the floor; resting items have y = 0 and no velocity. */
export type Loose = { item: Item; x: number; y: number; z: number; vx: number; vy: number; vz: number; by?: string };
export type Order = { id: number; recipe: RecipeId; createdAt: number; expiresAt: number };
export type EventType = 'serve' | 'wrong' | 'expire' | 'chop' | 'wash' | 'done' | 'warn' | 'burn' | 'fire' | 'extinguish' | 'throw' | 'catch' | 'land' | 'splash' | 'dash' | 'fall' | 'respawn' | 'portal' | 'gate' | 'pickup' | 'place' | 'star' | 'order';
/** Recent happenings for effects and sound. Ids increase; clients react to ids they have not seen. */
export type GameEvent = { id: number; at: number; type: EventType; x?: number; z?: number; player?: string; value?: number; recipe?: RecipeId };
export type View = {
  settings: Settings; players: Chef[]; tiles: TileState[]; loose: Loose[]; orders: Order[]; events: GameEvent[];
  startedAt: number; endsAt: number; now: number; complete: boolean;
  score: number; combo: number; served: number; failed: number; stars: number; thresholds: [number, number, number];
  recipeCounts: Partial<Record<RecipeId, number>>;
  gatesOpen: boolean; gateWarning: boolean;
};
export const EVENT_LIMIT = 32;

// ── Labels shared by phone, display and tests ───────────────────────────────
export const partLabel = (part: Part) => `${part.state === 'raw' ? '' : part.state[0].toUpperCase() + part.state.slice(1) + ' '}${part.state === 'raw' ? INGREDIENTS[part.food].name : INGREDIENTS[part.food].name.toLowerCase()}`;
export function itemLabel(item: Item | null | undefined): string {
  if (!item) return 'Empty hands';
  if (item.kind === 'food') return partLabel(item.parts[0]);
  if (item.kind === 'dirty') return `${item.count ?? 1} dirty plate${(item.count ?? 1) > 1 ? 's' : ''}`;
  if (item.kind === 'extinguisher') return 'Extinguisher';
  const recipe = matchRecipe(item), name = item.kind === 'plate' ? 'Plate' : item.kind === 'pot' ? 'Pot' : 'Pan';
  if (recipe) return RECIPES[recipe].name;
  return item.parts.length ? `${name}: ${item.parts.map(partLabel).join(' + ')}` : `Empty ${name.toLowerCase()}`;
}
export const TILE_LABELS: Record<TileKind, string> = {
  floor: 'Floor', ice: 'Ice', void: 'Gap', gate: 'Drawbridge', portal: 'Portal', counter: 'Counter', board: 'Chopping board', stove: 'Stove', oven: 'Oven',
  sink: 'Sink', rack: 'Clean plates', return: 'Dirty plates', serve: 'Serving hatch', bin: 'Bin', crate: 'Crate', belt: 'Conveyor',
};
export const tileLabel = (tile: Tile) => tile.kind === 'crate' ? `${INGREDIENTS[tile.ingredient!].name} crate` : TILE_LABELS[tile.kind];
