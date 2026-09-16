export type Ingredient = 'lettuce' | 'tomato' | 'onion' | 'patty' | 'bun' | 'dough' | 'cheese';
export type Food = { kind: Ingredient; stage: 'raw' | 'chopped' | 'cooked' | 'burnt' };
export type Item = { id: number; kind: 'food' | 'plate'; food: Food[]; dirty: boolean };
export type StationKind = 'crate' | 'board' | 'stove' | 'oven' | 'belt' | 'counter' | 'plates' | 'return' | 'sink' | 'serve' | 'bin';
export type Station = { id: string; kind: StationKind; x: number; z: number; ingredient?: Ingredient; item: Item | null; progress: number; heat: number; fire: number; working: boolean; powered: boolean };
export type Chef = { id: string; name: string; color: string; x: number; z: number; facingX: number; facingZ: number; held: Item | null; connected: boolean; dashUntil: number; dashReady: number; worked: number; served: number; target: string | null; feedback: string; feedbackAt: number; commandSeq: number };
export type Input = { x: number; y: number; use: boolean; dash: boolean; command: 'use' | 'drop' | 'toss' | 'dash' | null; seq: number };
export type Settings = { kitchen: number; seconds: number; practice: boolean };
export type Recipe = { id: string; name: string; icon: string; parts: Food[]; value: number };
export const INGREDIENTS: Record<Ingredient, { name: string; icon: string; color: string }> = {
  lettuce: { name: 'Lettuce', icon: '🥬', color: '#77ba43' }, tomato: { name: 'Tomato', icon: '🍅', color: '#ed5e43' }, onion: { name: 'Onion', icon: '🧅', color: '#cda2cf' }, patty: { name: 'Patty', icon: '🥩', color: '#bb6660' }, bun: { name: 'Bun', icon: '🍞', color: '#eeb86d' }, dough: { name: 'Dough', icon: '🫓', color: '#edca8d' }, cheese: { name: 'Cheese', icon: '🧀', color: '#f7cd47' },
};
export const RECIPES: Recipe[] = [
  { id: 'salad', name: 'Garden salad', icon: '🥗', value: 80, parts: [{ kind: 'lettuce', stage: 'chopped' }, { kind: 'tomato', stage: 'chopped' }] },
  { id: 'soup', name: 'Tomato soup', icon: '🍲', value: 110, parts: [{ kind: 'tomato', stage: 'cooked' }, { kind: 'onion', stage: 'cooked' }] },
  { id: 'burger', name: 'House burger', icon: '🍔', value: 100, parts: [{ kind: 'patty', stage: 'cooked' }, { kind: 'lettuce', stage: 'chopped' }, { kind: 'bun', stage: 'raw' }] },
  { id: 'pizza', name: 'Garden pizza', icon: '🍕', value: 110, parts: [{ kind: 'dough', stage: 'cooked' }, { kind: 'tomato', stage: 'chopped' }, { kind: 'cheese', stage: 'raw' }] },
];
export type Level = { name: string; location: string; subtitle: string; detail: string; accent: string; floor: string; recipes: number; patience: number; theme: number; topology: 'open' | 'split' | 'bridge'; mechanic: 'none' | 'scarce' | 'conveyor' | 'gust' | 'power' | 'finale' };
const themes = [{ location: 'Sunrise Diner', accent: '#5dbcb0', floor: '#fff0cf' }, { location: 'Canal Canteen', accent: '#4aaecb', floor: '#e1eff0' }, { location: 'Clockwork Works', accent: '#c79359', floor: '#f7e4bf' }, { location: 'Rooftop Kitchen', accent: '#8c91c9', floor: '#efe6f0' }];
function level(name: string, theme: number, recipes: number, topology: Level['topology'], mechanic: Level['mechanic'], subtitle: string, detail: string, patience = 110): Level { return { name, ...themes[theme], theme, recipes, topology, mechanic, subtitle, detail, patience }; }
export const KITCHENS: Level[] = [
  level('Fresh Start', 0, 1, 'open', 'none', 'Learn the rhythm', 'Chop lettuce and tomato, combine on a clean plate, then serve. Serve fresh salads to earn your first star.', 120),
  level("Soup’s On", 0, 2, 'open', 'none', 'Turn up the heat', 'Chop tomato and onion, cook each on a stove, then plate. Watch the green cooking bar before food burns.', 120),
  level('Lunch Line', 1, 3, 'split', 'none', 'Meet in the middle', 'Burgers join the menu. Cook the patty, chop lettuce, add a bun. Split up and pass food across the island.'),
  level('Wash & Dash', 1, 3, 'split', 'scarce', 'Every plate matters', 'Half the usual dish stock. Keep the washing station busy; a dirty plate is your next order.', 120),
  level('Pizza Post', 2, 4, 'open', 'none', 'Bake the whole pie', 'Plate raw dough, chopped tomato and cheese, then put the whole plate in an oven. Bake eight seconds.', 125),
  level('Clockwork Crossing', 2, 4, 'bridge', 'none', 'Plan the crossing', 'The centre bridge closes after a warning. Permanent end crossings stay open; toss food across the canal.', 125),
  level('Conveyor Club', 2, 4, 'split', 'conveyor', 'Keep the line moving', 'The three centre belts pass items toward the front every three seconds. Clear the end belt to keep deliveries moving.', 120),
  level('Rooftop Gusts', 3, 4, 'open', 'gust', 'Take the outside lane', 'Ventilation warns for five seconds, then slows the centre. Work the perimeter during each gust.', 115),
  level('Power Lunch', 3, 4, 'split', 'power', 'Share the power', 'Cooking banks alternate every eighteen seconds. Amber warns of a switch; paused food keeps its heat.', 125),
  level('Grand Opening', 3, 4, 'split', 'finale', 'All hands on deck', 'Full menu, moving food belts, alternating cooker power and rooftop gusts. Assign a prep, cook, runner and dish crew.', 125),
];
export const hasPower = (level: Level) => level.mechanic === 'power' || level.mechanic === 'finale';
export const hasGust = (level: Level) => level.mechanic === 'gust' || level.mechanic === 'finale';
export const hasBelt = (level: Level) => level.mechanic === 'conveyor' || level.mechanic === 'finale';
export type Ticket = { id: number; recipe: string; createdAt: number; expiresAt: number };
export type LooseItem = { item: Item; x: number; z: number; vx: number; vz: number; flight: number };
export type View = { players: Chef[]; stations: Station[]; loose: LooseItem[]; tickets: Ticket[]; settings: Settings; halfX: number; halfZ: number; startedAt: number; endsAt: number; now: number; complete: boolean; score: number; served: number; missed: number; waste: number; fires: number; combo: number; cleanPlates: number; dirtyPlates: number; thresholds: number[]; stars: number; event: string; eventAt: number; hazard: 'calm' | 'warning' | 'active'; recipeCounts: Record<string, number>; powerBank: number; powerWarning: boolean };
export const SPEED = 3.6, RADIUS = .36, REACH = 1.72, CHOP_SECONDS = 2.4, COOK_SECONDS = 6, WASH_SECONDS = 2.5;
export const neutral = (): Input => ({ x: 0, y: 0, use: false, dash: false, command: null, seq: 0 });
export const foodLabel = (food: Food) => `${food.stage === 'raw' ? '' : food.stage + ' '}${INGREDIENTS[food.kind].name}`;
export const itemLabel = (item: Item | null) => !item ? 'Empty hands' : item.kind === 'plate' ? item.dirty ? 'Dirty plate' : item.food.length ? `Plate: ${[...new Set(item.food.map(foodLabel))].map(label=>{const count=item.food.filter(f=>foodLabel(f)===label).length;return `${count>1?count+'× ':''}${label}`;}).join(' + ')}` : 'Clean plate' : foodLabel(item.food[0]);
export const stationLabel = (station: Station) => station.kind === 'crate' ? INGREDIENTS[station.ingredient!].name : ({ board: 'Chopping board', stove: 'Stove', oven: 'Pizza oven', belt: 'Conveyor pass', counter: 'Pass counter', plates: 'Clean plates', return: 'Dirty dishes', sink: 'Wash sink', serve: 'Serve orders', bin: 'Food bin' } as const)[station.kind];
export function dimensions(count: number) { return { halfX: count > 7 ? 14 : count > 4 ? 12 : 9, halfZ: count > 7 ? 8 : count > 4 ? 7 : 6 }; }
export function layout(kitchen: number, count: number): Station[] {
  const { halfX: x, halfZ: z } = dimensions(count), result: Station[] = [];
  const add = (kind: StationKind, px: number, pz: number, ingredient?: Ingredient) => result.push({ id: `${kind}-${result.length}`, kind, x: px, z: pz, ...(ingredient ? { ingredient } : {}), item: null, progress: 0, heat: 0, fire: 0, working: false, powered: true });
  const ingredients = [...new Set(RECIPES.slice(0, KITCHENS[kitchen].recipes).flatMap(recipe => recipe.parts.map(part => part.kind)))];
  ingredients.forEach((ingredient, i) => add('crate', -x + 1.2 + i * 2.25, -z + 1.1, ingredient));
  const banks = count > 7 ? 3 : 2;
  for (let i = 0; i < banks; i++) { add('board', -x + 1.2 + i * 2.4, .1); add(kitchen===0?'board':'stove', x - 1.2 - i * 2.4, .1); }
  add('plates', -3.8, z - 1.1); add('serve', x - 1.2, z - 1.1); add('sink', 1, z - 1.1); add('return', -1.4, z - 1.1); add('bin', -x + 1.2, z - 1.1);
  if (KITCHENS[kitchen].topology === 'open') { add('counter', -1.2, .1); add('counter', 1.2, .1); }
  add('counter', x - 3.6, z - 1.1);
  if (count > 4) { add('board', -x + 1.2, -2.5); add('sink', -x + 5.8, z - 1.1); add(kitchen===0?'board':'stove', x - 1.2, 2.7); }
  if (KITCHENS[kitchen].topology === 'split') for (const pz of [-2.2, 0, 2.2]) add(hasBelt(KITCHENS[kitchen]) ? 'belt' : 'counter', 0, pz);
  if (KITCHENS[kitchen].recipes === 4) { add('oven', x - 1.2, -z + 3.5); if (count > 4) add('oven', x - 3.6, -z + 3.5); }
  return result;
}
export function unbakedPizza(item: Item | null) { return item?.kind === 'plate' && !item.dirty && item.food.length === 3 && ['dough:raw', 'tomato:chopped', 'cheese:raw'].every(part => item.food.some(food => `${food.kind}:${food.stage}` === part)); }
export function recipeFor(item: Item | null): Recipe | undefined { if (!item || item.kind !== 'plate' || item.dirty) return; const signature = (parts: Food[]) => parts.map(p => `${p.kind}:${p.stage}`).sort().join('|'); return RECIPES.find(recipe => signature(recipe.parts) === signature(item.food)); }
export function interpolate(a: View, b: View, alpha: number): View { return { ...b, players: b.players.map(player => { const old = a.players.find(p => p.id === player.id); return old ? { ...player, x: old.x + (player.x - old.x) * alpha, z: old.z + (player.z - old.z) * alpha } : player; }) }; }

export function choppable(item: Item | null) { const food=item?.food[0]; return item?.kind==='food' && food?.stage==='raw' && !['bun','cheese'].includes(food.kind); }
