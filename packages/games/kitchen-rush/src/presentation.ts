// Pure, browser-safe presentation helpers shared by the phone, HUD, results and tests.
import {
  BURN_AT, BURN_WARN, CHOPPABLE, INGREDIENTS, PAN_CAPACITY, PAN_FOODS, PLATE_CAPACITY, POT_CAPACITY, POT_FOODS, RECIPES, cookSeconds, matchRecipe, partLabel, tileLabel,
  type Chef, type ChefStats, type Ingredient, type Item, type Level, type Order, type Part, type RecipeId, type Tile, type TileState, type View,
} from './model';

export type Tone = 'idle' | 'work' | 'ready' | 'warn' | 'danger';
export type TileStatus = { label: string; detail: string; tone: Tone; progress?: number };
export type Process = 'chop' | 'boil' | 'fry' | 'bake';

export const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const patience = (order: Order, now: number) => Math.max(0, Math.min(1, (order.expiresAt - now) / Math.max(1, order.expiresAt - order.createdAt)));
export const patienceTone = (fraction: number) => fraction > .5 ? 'ok' : fraction > .25 ? 'warn' : 'urgent';

// ── Icons ───────────────────────────────────────────────────────────────────
export const foodIcon = (part: Part) => `food_${part.food}_${part.state}`;
const FOOD_GLYPH: Record<Ingredient, string> = { lettuce: '🥬', tomato: '🍅', onion: '🧅', patty: '🥩', bun: '🍞', dough: '🫓', cheese: '🧀' };
const DISH_GLYPH: Record<RecipeId, string> = { side_salad: '🥗', salad: '🥗', tomato_soup: '🍲', onion_soup: '🍲', burger: '🍔', cheeseburger: '🍔', deluxe_burger: '🍔', pizza: '🍕' };
const ITEM_GLYPH: Record<string, string> = { plate: '🍽️', plate_dirty: '🍽️', pot: '🍲', pan: '🍳', extinguisher: '🧯' };
/** Coloured chip used when an icon file is missing. */
export function iconFallback(name: string): { glyph: string; color: string } {
  const [kind, ...rest] = name.split('_'), key = rest.join('_');
  if (kind === 'food') { const food = rest[0] as Ingredient; return { glyph: FOOD_GLYPH[food] ?? '?', color: rest[1] === 'burnt' ? '#4a3a33' : INGREDIENTS[food]?.color ?? '#999' }; }
  if (kind === 'dish') return { glyph: DISH_GLYPH[key as RecipeId] ?? '🍽️', color: '#ffd24a' };
  if (kind === 'item') return { glyph: ITEM_GLYPH[key] ?? '?', color: key === 'plate_dirty' ? '#a39a7c' : '#e8eef5' };
  return { glyph: (key[0] ?? '?').toUpperCase(), color: '#b58aff' };
}
/** Main icon, contents shown as mini icons, and a stack count. */
export function itemIcons(item: Item | null | undefined): { main: string; parts: Part[]; count?: number } | null {
  if (!item) return null;
  if (item.kind === 'food') return { main: foodIcon(item.parts[0]), parts: [] };
  if (item.kind === 'dirty') return { main: 'item_plate_dirty', parts: [], count: item.count ?? 1 };
  if (item.kind === 'extinguisher') return { main: 'item_extinguisher', parts: [] };
  const recipe = matchRecipe(item);
  if (recipe) return { main: `dish_${recipe}`, parts: [] };
  return { main: `item_${item.kind}`, parts: item.parts };
}
/** Short label for tight phone and HUD slots; `itemLabel` stays the full accessible name. */
export function shortLabel(item: Item | null | undefined): string {
  if (!item) return 'Empty hands';
  if (item.kind === 'food') return partLabel(item.parts[0]);
  if (item.kind === 'dirty') return `${item.count ?? 1} dirty plate${(item.count ?? 1) > 1 ? 's' : ''}`;
  if (item.kind === 'extinguisher') return 'Extinguisher';
  const recipe = matchRecipe(item), name = item.kind === 'plate' ? 'Plate' : item.kind === 'pot' ? 'Pot' : 'Pan';
  if (recipe) return RECIPES[recipe].name;
  if (!item.parts.length) return item.kind === 'plate' ? 'Clean plate' : `Empty ${name.toLowerCase()}`;
  if (item.parts.some(part => part.state === 'burnt')) return `Burnt ${name.toLowerCase()}`;
  const first = partLabel(item.parts[0]).toLowerCase(), same = item.parts.every(part => partLabel(part).toLowerCase() === first);
  return same ? `${name}: ${item.parts.length > 1 ? `${item.parts.length}× ` : ''}${first}` : `${name} · ${item.parts.length} items`;
}

// ── Recipes ─────────────────────────────────────────────────────────────────
export const processOf = (part: Part): Process | null =>
  part.state === 'chopped' ? 'chop' : part.state !== 'cooked' ? null : part.food === 'dough' ? 'bake' : part.food === 'patty' ? 'fry' : 'boil';
/** Recipe parts grouped by identical ingredient and state (three cooked tomatoes → one icon × 3). */
export function recipeSteps(recipe: RecipeId) {
  const steps: { part: Part; process: Process | null; count: number }[] = [];
  for (const part of RECIPES[recipe].parts) {
    const same = steps.find(step => step.part.food === part.food && step.part.state === part.state);
    if (same) same.count++; else steps.push({ part, process: processOf(part), count: 1 });
  }
  return steps;
}

// ── Targets ─────────────────────────────────────────────────────────────────
const IDLE_HINT: Partial<Record<Tile['kind'], string>> = {
  crate: 'Grab to take one', bin: 'Drop food to bin it', serve: 'Deliver finished plates', board: 'Put food here to chop', sink: 'Bring dirty plates',
  stove: 'Needs a pot or pan', oven: 'Bake a plate with dough', rack: 'Out of clean plates', return: 'No dirty plates yet', counter: 'Free space', belt: 'Put an item on the belt',
};
const heated = (tile: Tile, item: Item) => tile.kind === 'stove' && (item.kind === 'pot' || item.kind === 'pan') || tile.kind === 'oven';
/** What the phone says about the tile a chef is facing. */
export function tileStatus(tile: Tile | undefined, state: TileState | undefined, relaxed: boolean): TileStatus | null {
  if (!tile) return null;
  const label = tileLabel(tile), item = state?.item;
  if (state?.fire) return { label, detail: 'On fire! Spray it', tone: 'danger', progress: state.fire };
  if (item && heated(tile, item) && item.parts.length) {
    const need = cookSeconds(item.kind), verb = tile.kind === 'oven' ? 'Baking' : 'Cooking';
    if (item.parts.some(part => part.state === 'burnt')) return { label, detail: 'Burnt! Bin it', tone: 'danger', progress: 1 };
    if (item.cook < need) return { label, detail: `${verb} ${Math.floor(item.cook / need * 100)}%`, tone: 'work', progress: item.cook / need };
    if (!relaxed && item.cook >= need + BURN_WARN) return { label, detail: 'Burning soon!', tone: 'warn', progress: Math.max(0, 1 - (item.cook - need - BURN_WARN) / (BURN_AT - BURN_WARN)) };
    return { label, detail: tile.kind === 'oven' ? 'Baked! Grab it' : 'Ready! Bring a plate', tone: 'ready', progress: 1 };
  }
  if (item && state?.progress) return { label, detail: `${tile.kind === 'sink' ? 'Washing' : 'Chopping'} ${Math.floor(state.progress * 100)}%`, tone: 'work', progress: state.progress };
  if (item) return { label, detail: shortLabel(item), tone: 'idle' };
  if (state?.count) return { label, detail: `${state.count} plate${state.count > 1 ? 's' : ''}`, tone: 'idle' };
  return { label, detail: IDLE_HINT[tile.kind] ?? '', tone: 'idle' };
}
export type ActKind = 'chop' | 'wash' | 'spray' | 'throw' | 'none';
/** A button's label and, when a tap would be refused, the short reason (mirrors the server's notes). */
export type Hint = { label: string; ok: boolean };
/** Chop · Throw context; `reason` explains a disabled button. */
export type ActHint = { kind: ActKind; label: string; reason?: string };
const yes = (label: string): Hint => ({ label, ok: true }), no = (label: string): Hint => ({ label, ok: false });
const isBox = (item: Item) => item.kind === 'plate' || item.kind === 'pot' || item.kind === 'pan';
const choppable = (item?: Item) => item?.kind === 'food' && item.parts[0].state === 'raw' && CHOPPABLE.includes(item.parts[0].food);
const burnt = (part: Part) => part.state === 'burnt';
const lower = (food: Ingredient) => INGREDIENTS[food].name.toLowerCase();
/** Chop · Throw context in the server's act() order. Ongoing chopping or washing keeps its label. */
export function actHint(chef: Pick<Chef, 'held' | 'work'>, tile: Tile | undefined, state: TileState | undefined): ActHint {
  const item = state?.item, held = chef.held, usable = tile && !state?.fire;
  const is = (kind: ActKind, label: string) => ({ kind, label }), none = (label: string, reason: string): ActHint => ({ kind: 'none', label, reason });
  if (chef.work === 'chop' || usable && tile.kind === 'board' && choppable(item)) return is('chop', 'Chop');
  if (chef.work === 'wash' || usable && tile.kind === 'sink' && item?.kind === 'dirty') return is('wash', 'Wash');
  if (held?.kind === 'extinguisher') return is('spray', 'Spray');
  if (held?.kind === 'food') return is('throw', 'Throw');
  if (held) return none('Throw', 'Food only');
  if (state?.fire) return none('Spray', 'Get extinguisher');
  if (tile?.kind === 'board') return none('Chop', !item ? 'Add food' : item.kind === 'food' && item.parts[0].state === 'raw' ? 'Used whole' : 'All chopped');
  if (tile?.kind === 'sink') return none('Wash', 'No dishes');
  return none('Chop', 'Find a board');
}
/** Why a plate, pot or pan refuses a food part, or '' (short versions of the server's notes). */
function refusal(box: Item, part: Part): string {
  if (burnt(part)) return 'Bin burnt food';
  if (box.parts.some(burnt)) return 'Bin it first';
  if (box.kind === 'plate') return box.parts.length >= PLATE_CAPACITY ? 'Plate is full' : part.state === 'raw' && part.food !== 'bun' && part.food !== 'dough' ? 'Chop it first' : '';
  const pot = box.kind === 'pot';
  if (!(pot ? POT_FOODS : PAN_FOODS).includes(part.food)) return pot ? 'Tomato or onion' : 'Beef only';
  if (part.state !== 'chopped') return part.state === 'raw' ? 'Chop it first' : 'Already cooked';
  return box.parts.length >= (pot ? POT_CAPACITY : PAN_CAPACITY) ? `${pot ? 'Pot' : 'Pan'} is full` : '';
}
function pourHint(from: Item, plate: Item): Hint {
  const why = !from.parts.length ? `${from.kind === 'pot' ? 'Pot' : 'Pan'} is empty` : from.parts.some(burnt) ? 'Burnt! Bin it' : from.parts.some(part => part.state !== 'cooked') ? 'Still cooking'
    : plate.parts.some(burnt) ? 'Bin it first' : plate.parts.length + from.parts.length > PLATE_CAPACITY ? 'Plate is full' : '';
  return why ? no(why) : yes(from.kind === 'pot' ? 'Pour soup' : 'Plate beef');
}
function combineHint(held: Item, item: Item): Hint {
  const add = (box: Item, part: Part, label: string) => { const why = refusal(box, part); return why ? no(why) : yes(label); };
  if (held.kind === 'food') return isBox(item) ? add(item, held.parts[0], `Add to ${item.kind}`) : no(item.kind === 'food' ? 'Needs a plate' : 'Spot taken');
  if (isBox(held) && item.kind === 'food') return add(held, item.parts[0], held.kind === 'plate' ? 'Add to plate' : `Scoop into ${held.kind}`);
  if (held.kind === 'plate' && (item.kind === 'pot' || item.kind === 'pan')) return pourHint(item, held);
  if ((held.kind === 'pot' || held.kind === 'pan') && item.kind === 'plate') return pourHint(held, item);
  return held.kind === 'dirty' && item.kind === 'dirty' ? yes('Stack plates') : no('Spot taken');
}
const PLACE_REFUSAL: Partial<Record<Tile['kind'], [(item: Item) => boolean, string]>> = {
  board: [item => item.kind === 'food', 'Food only'], sink: [item => item.kind === 'dirty', 'Dirty plates only'],
  oven: [item => item.kind === 'plate' && item.parts.some(part => part.food === 'dough' && part.state === 'raw'), 'Needs raw dough'],
};
/** Grab label mirroring the server's grab(): what a tap does, or why it would be refused. */
export function grabHint(chef: Pick<Chef, 'held' | 'x' | 'z'>, tile: Tile | undefined, state: TileState | undefined, view: Pick<View, 'loose' | 'orders'> = { loose: [], orders: [] }): Hint {
  const held = chef.held, item = state?.item, reach = Math.min(.8, tile ? Math.hypot(tile.x - chef.x, tile.z - chef.z) : Infinity);
  if (!held && view.loose.some(drop => !drop.vx && !drop.vy && !drop.vz && Math.hypot(drop.x - chef.x, drop.z - chef.z) < reach)) return yes('Pick up');
  if (!tile) return held ? yes('Drop') : no('Nothing here');
  if (state?.fire && (held || item?.kind !== 'extinguisher')) return no('Too hot!');
  if (!held) switch (tile.kind) {
    case 'crate': return yes(`Take ${lower(tile.ingredient!)}`);
    case 'rack': return state?.count ? yes('Take plate') : no('No plates');
    case 'return': return state?.count ? yes('Take plates') : no('No plates yet');
    case 'serve': return no('Bring a dish');
    case 'bin': return no('Bin');
    default: return item ? yes('Pick up') : no('Nothing here');
  }
  switch (tile.kind) {
    case 'crate': { const why = held.kind === 'plate' ? refusal(held, { food: tile.ingredient!, state: 'raw' }) : 'Hands full'; return why ? no(why) : yes(`Add ${lower(tile.ingredient!)}`); }
    case 'rack': return held.kind === 'plate' && !held.parts.length ? yes('Return plate') : no('Clean plates only');
    case 'return': return held.kind === 'dirty' && state?.count ? yes('Stack plates') : no(held.kind === 'dirty' ? 'No plates yet' : 'Dirty plates only');
    case 'bin': return held.kind === 'food' ? yes('Bin it') : !isBox(held) ? no(held.kind === 'dirty' ? 'Wash first' : 'Keep it!') : held.parts.length ? yes('Empty it') : no('Already empty');
    case 'serve': {
      const recipe = matchRecipe(held);
      return held.kind !== 'plate' ? no('Plate it first') : !recipe ? no(held.parts.length ? 'Not on the menu' : 'Empty plate') : view.orders.some(order => order.recipe === recipe) ? yes('Serve!') : no('Not ordered');
    }
  }
  if (item) return combineHint(held, item);
  const rule = PLACE_REFUSAL[tile.kind];
  return rule && !rule[0](held) ? no(rule[1]) : yes('Put down');
}

// ── Score and results ───────────────────────────────────────────────────────
/** What the next serve's tip is multiplied by (the server multiplies by the combo before raising it). */
export const nextTip = (combo: number) => `Next tip ×${Math.max(1, Math.min(4, combo))}`;
const ORDINAL = ['first', 'second', 'third'];
/** Coins still needed for the next star, or null with all three. */
export function starGoal(score: number, thresholds: readonly number[]): string | null {
  const next = thresholds.findIndex(target => score < target);
  return next < 0 ? null : `${thresholds[next] - score} more coin${thresholds[next] - score === 1 ? '' : 's'} for the ${ORDINAL[next]} star`;
}
export function headline({ stars, served, failed, score, thresholds }: Pick<View, 'stars' | 'served' | 'failed' | 'score' | 'thresholds'>): string {
  if (stars >= 3) return failed ? 'Three-star kitchen!' : 'Flawless three-star service!';
  if (stars === 2) return 'Great service!';
  if (stars === 1) return served >= 8 ? 'Busy night, one star!' : 'First star earned!';
  if (!served) return 'Kitchen’s still warming up';
  return score >= thresholds[0] * .7 ? 'So close to a star!' : served === 1 ? 'First plate out!' : `${served} plates out. Good start!`;
}

// ── Levels ──────────────────────────────────────────────────────────────────
/** Gimmick tags derived from the authored maps, most distinctive first. */
export function levelTags(level: Level): string[] {
  const text = level.small.join('') + level.large.join(''), tags: string[] = [];
  if (/T/.test(text)) tags.push('Portals');
  if (level.gates || /g/.test(text)) tags.push('Drawbridges');
  if (/\*/.test(text)) tags.push('Ice');
  if (/[<>^v]/.test(text)) tags.push('Conveyors');
  return tags.length ? tags : [/W/.test(text) ? 'Dishwashing' : 'Classic'];
}

/** One-line card pitches; the full authored blurb stays available as the card's tooltip. */
const PITCH: Record<string, string> = {
  'first-shift': 'Chop, plate, serve. Plates come back clean.', 'soup-kitchen': 'Three per pot, passed over the wall. Wash up!',
  'burger-bar': 'Fry the beef, add a bun. A tight grill line.', 'conveyor-cafe': 'A wall splits the crew. Belts carry the food.',
  'slippery-summit': 'Soup on ice. Crevasses swallow thrown food.', 'drawbridge-deli': 'Bridges lift every half minute. Throw across!',
  'portal-pizzeria': 'Three islands, two portals, one hot oven.', 'grand-opening': 'Full menu, three stations, belts and a portal.',
};
export const levelPitch = (level: Level) => PITCH[level.id] ?? level.blurb;

// ── Awards ──────────────────────────────────────────────────────────────────
export type Award = { title: string; detail: string };
/** Titles per stat, best first: big crews hand out runner-up titles before anyone falls back to Moral support. */
const AWARDS: { titles: string[]; stat: keyof ChefStats; unit: string; one?: string }[] = [
  { titles: ['Star server', 'Runner', 'Hatch hero'], stat: 'served', unit: 'served' },
  { titles: ['Knife master', 'Prep cook', 'Dicer'], stat: 'chopped', unit: 'chopped' },
  { titles: ['Dish hero', 'Bubbles', 'Scrubber'], stat: 'washed', unit: 'washed' },
  { titles: ['Firefighter', 'Fire marshal'], stat: 'extinguished', unit: 'fires out', one: 'fire out' },
  { titles: ['Pitcher', 'Quarterback'], stat: 'thrown', unit: 'thrown' },
  { titles: ['Safe hands', 'Catcher'], stat: 'caught', unit: 'caught' },
  { titles: ['Sauce boss', 'Line cook', 'Stove minder'], stat: 'cooked', unit: 'cooked' },
  { titles: ['Speedy', 'Zoomer', 'Road runner'], stat: 'dashes', unit: 'dashes', one: 'dash' },
  { titles: ['Butterfingers', 'Daredevil'], stat: 'falls', unit: 'falls', one: 'fall' },
];
/**
 * One award per chef where possible: tier by tier, each title (in priority order) goes to the chef without an award
 * who has the highest non-zero stat (ties favour the lower seat). Chefs left over get a friendly fallback.
 */
export function assignAwards(chefs: readonly Pick<Chef, 'id' | 'stats'>[]): Record<string, Award> {
  const result: Record<string, Award> = {};
  for (let tier = 0; tier < 3; tier++) for (const award of AWARDS) {
    const title = award.titles[tier];
    if (!title) continue;
    let best: Pick<Chef, 'id' | 'stats'> | undefined;
    for (const chef of chefs) if (!result[chef.id] && chef.stats[award.stat] > 0 && (!best || chef.stats[award.stat] > best.stats[award.stat])) best = chef;
    const n = best?.stats[award.stat];
    if (best) result[best.id] = { title, detail: `${n} ${n === 1 ? award.one ?? award.unit : award.unit}` };
  }
  for (const chef of chefs) result[chef.id] ??= { title: 'Moral support', detail: 'Kept spirits high' };
  return result;
}
