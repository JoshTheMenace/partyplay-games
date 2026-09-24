import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BURN_AT, BURN_WARN, POT_SECONDS, RECIPES, itemLabel, type Chef, type ChefStats, type Item, type Part, type Tile } from '../src/model';
import { rules, type State } from '../src/server';
import { find, press, setup, slot, standAt, step } from './helpers/kitchen';
import { LEVELS } from '../src/levels';
import { actHint, assignAwards, clock, grabHint, headline, iconFallback, itemIcons, levelTags, nextTip, patienceTone, recipeSteps, shortLabel, starGoal, tileStatus } from '../src/presentation';

const zero: ChefStats = { served: 0, chopped: 0, washed: 0, cooked: 0, thrown: 0, caught: 0, extinguished: 0, burnt: 0, dashes: 0, falls: 0 };
const chef = (id: string, stats: Partial<ChefStats> = {}) => ({ id, stats: { ...zero, ...stats } });
const tile = (kind: Tile['kind'], extra: Partial<Tile> = {}): Tile => ({ index: 1, col: 0, row: 0, x: 0, z: 0, kind, ...extra });
const food = (f: 'tomato' | 'lettuce' | 'bun', s: 'raw' | 'chopped' = 'raw'): Item => ({ id: 1, kind: 'food', parts: [{ food: f, state: s }], cook: 0 });

test('awards give every chef one distinct title where stats allow, favouring the best in each category', () => {
  const chefs = [
    chef('a', { served: 6, chopped: 9 }), chef('b', { chopped: 8 }), chef('c', { washed: 4 }), chef('d', { extinguished: 2 }), chef('e', { thrown: 5 }),
    chef('f', { caught: 3 }), chef('g', { cooked: 4 }), chef('h', { dashes: 30 }), chef('i', { falls: 2 }), chef('j'),
  ];
  const awards = assignAwards(chefs);
  assert.equal(awards.a.title, 'Star server'); assert.equal(awards.a.detail, '6 served');
  assert.equal(awards.b.title, 'Knife master', 'the runner-up chopper gets Knife master when the top chopper already has an award');
  assert.deepEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i'].map(id => awards[id].title), ['Dish hero', 'Firefighter', 'Pitcher', 'Safe hands', 'Sauce boss', 'Speedy', 'Butterfingers']);
  assert.equal(awards.j.title, 'Moral support');
  assert.equal(assignAwards([chef('x', { falls: 1 }), chef('y', { extinguished: 1 })]).y.detail, '1 fire out', 'one of a thing reads singular');
  assert.deepEqual(Object.values(assignAwards([chef('x', { served: 3, chopped: 4 }), chef('y', { served: 2, chopped: 3 }), chef('z', { chopped: 1 })])).map(award => award.title), ['Star server', 'Knife master', 'Prep cook'], 'runner-up titles before Moral support');
  assert.equal(new Set(Object.values(awards).map(award => award.title)).size, 10);
  assert.deepEqual(assignAwards([chef('x'), chef('y')]), { x: { title: 'Moral support', detail: 'Kept spirits high' }, y: { title: 'Moral support', detail: 'Kept spirits high' } });
  assert.equal(assignAwards([chef('x', { served: 2 }), chef('y', { served: 2 })]).x.title, 'Star server', 'ties favour the lower seat');
});

test('stove status moves through cooking, ready, burning soon and burnt; relaxed never warns; fire wins', () => {
  const stove = tile('stove'), pot = (cook: number, burnt = false): Item => ({ id: 2, kind: 'pot', parts: [{ food: 'tomato', state: burnt ? 'burnt' : cook >= POT_SECONDS ? 'cooked' : 'chopped' }], cook });
  assert.deepEqual(tileStatus(stove, { at: 1, item: pot(POT_SECONDS / 2) }, false), { label: 'Stove', detail: 'Cooking 50%', tone: 'work', progress: .5 });
  assert.equal(tileStatus(stove, { at: 1, item: pot(POT_SECONDS + 1) }, false)!.tone, 'ready');
  assert.equal(tileStatus(stove, { at: 1, item: pot(POT_SECONDS + BURN_WARN + 1) }, false)!.detail, 'Burning soon!');
  assert.equal(tileStatus(stove, { at: 1, item: pot(POT_SECONDS + BURN_WARN + 1) }, true)!.tone, 'ready');
  assert.equal(tileStatus(stove, { at: 1, item: pot(POT_SECONDS + BURN_AT, true) }, false)!.tone, 'danger');
  assert.equal(tileStatus(stove, { at: 1, item: pot(3), fire: .5 }, false)!.detail, 'On fire! Spray it');
  assert.equal(tileStatus(tile('board'), { at: 1, item: food('tomato'), progress: .45 }, false)!.detail, 'Chopping 45%');
  assert.equal(tileStatus(tile('crate', { ingredient: 'tomato' }), undefined, false)!.label, 'Tomato crate');
  assert.equal(tileStatus(tile('rack'), { at: 1, count: 3 }, false)!.detail, '3 plates');
  assert.equal(tileStatus(undefined, undefined, false), null);
});

test('Chop · Throw mirrors the server act() priority with a reason when nothing would happen', () => {
  const board = tile('board'), sink = tile('sink'), me = (held: Item | null, work: Chef['work'] = 'none') => ({ held, work });
  const dirty: Item = { id: 3, kind: 'dirty', parts: [], cook: 0, count: 2 }, extinguisher: Item = { id: 4, kind: 'extinguisher', parts: [], cook: 0 };
  const act = (...args: Parameters<typeof actHint>) => { const hint = actHint(...args); return hint.reason ? `${hint.label}: ${hint.reason}` : hint.label; };
  assert.equal(act(me(null), board, { at: 1, item: food('tomato') }), 'Chop');
  assert.equal(act(me(food('lettuce')), board, { at: 1, item: food('tomato') }), 'Chop', 'chopping beats throwing');
  assert.equal(act(me(extinguisher), board, { at: 1, item: food('tomato') }), 'Chop', 'the board comes before the extinguisher, as on the server');
  assert.equal(act(me(extinguisher), board, { at: 1, item: food('tomato'), fire: .5 }), 'Spray', 'a burning board cannot be chopped');
  assert.equal(act(me(null), sink, { at: 1, item: dirty }), 'Wash');
  assert.equal(act(me(extinguisher), tile('counter'), undefined), 'Spray');
  assert.equal(act(me(food('tomato', 'chopped')), tile('counter'), undefined), 'Throw');
  assert.equal(act(me(null, 'wash'), undefined, undefined), 'Wash', 'ongoing work keeps its label');
  assert.equal(act(me(null), board, { at: 1, item: food('bun') }), 'Chop: Used whole');
  assert.equal(act(me(null), board, { at: 1, item: food('tomato', 'chopped') }), 'Chop: All chopped');
  assert.equal(act(me(null), board, undefined), 'Chop: Add food');
  assert.equal(act(me(null), sink, undefined), 'Wash: No dishes');
  assert.equal(act(me({ id: 5, kind: 'plate', parts: [], cook: 0 }), board, undefined), 'Throw: Food only');
  assert.equal(act(me(null), tile('stove'), { at: 1, fire: 1 }), 'Spray: Get extinguisher');
  assert.equal(act(me(null), tile('counter'), undefined), 'Chop: Find a board');
  assert.equal(actHint(me(null), tile('counter'), undefined).kind, 'none');
});

test('Grab hint mirrors the server grab() result', () => {
  const plate = (...parts: Item['parts']): Item => ({ id: 5, kind: 'plate', parts, cook: 0 }), salad = plate({ food: 'lettuce', state: 'chopped' });
  const pot = (state: 'chopped' | 'cooked' | 'burnt', n = 3): Item => ({ id: 6, kind: 'pot', parts: Array.from({ length: n }, () => ({ food: 'tomato' as const, state })), cook: 0 });
  const dirty: Item = { id: 7, kind: 'dirty', parts: [], cook: 0, count: 2 };
  const at = (held: Item | null, t: Tile | undefined, state?: Omit<NonNullable<Parameters<typeof grabHint>[2]>, 'at'>, view?: Parameters<typeof grabHint>[3]) => {
    const hint = grabHint({ held, x: 0, z: 1 }, t, state && { at: 1, ...state }, view);
    return `${hint.ok ? '' : '✗ '}${hint.label}`;
  };
  const orders = { loose: [], orders: [{ id: 1, recipe: 'side_salad' as const, createdAt: 0, expiresAt: 9e9 }] };
  assert.equal(at(null, tile('crate', { ingredient: 'lettuce' })), 'Take lettuce');
  assert.equal(at(plate(), tile('crate', { ingredient: 'bun' })), 'Add bun', 'a held plate takes a bun straight from its crate');
  assert.equal(at(plate(), tile('crate', { ingredient: 'tomato' })), '✗ Chop it first');
  assert.equal(at(food('tomato'), tile('crate', { ingredient: 'tomato' })), '✗ Hands full');
  assert.equal(at(null, tile('rack'), { count: 2 }), 'Take plate');
  assert.equal(at(null, tile('rack')), '✗ No plates');
  assert.equal(at(null, tile('return'), { count: 3 }), 'Take plates');
  assert.equal(at(food('tomato'), tile('counter')), 'Put down');
  assert.equal(at(plate(), tile('board')), '✗ Food only');
  assert.equal(at(salad, tile('sink')), '✗ Dirty plates only');
  assert.equal(at(dirty, tile('sink')), 'Put down');
  assert.equal(at(food('tomato', 'chopped'), tile('counter'), { item: plate() }), 'Add to plate');
  assert.equal(at(food('tomato', 'chopped'), tile('stove'), { item: pot('chopped', 1) }), 'Add to pot');
  assert.equal(at(food('lettuce', 'chopped'), tile('stove'), { item: pot('chopped', 1) }), '✗ Tomato or onion');
  assert.equal(at(food('tomato', 'chopped'), tile('stove'), { item: pot('chopped') }), '✗ Pot is full');
  assert.equal(at(food('tomato'), tile('counter'), { item: food('lettuce') }), '✗ Needs a plate');
  assert.equal(at(plate(), tile('counter'), { item: food('lettuce', 'chopped') }), 'Add to plate');
  assert.equal(at(plate(), tile('stove'), { item: pot('cooked') }), 'Pour soup');
  assert.equal(at(plate(), tile('stove'), { item: pot('chopped') }), '✗ Still cooking');
  assert.equal(at(pot('cooked'), tile('counter'), { item: plate() }), 'Pour soup', 'a cooked pot pours onto a plate on the counter');
  assert.equal(at(plate(), tile('stove'), { item: pot('burnt') }), '✗ Burnt! Bin it');
  assert.equal(at(dirty, tile('bin')), '✗ Wash first');
  assert.equal(at(food('tomato'), tile('bin')), 'Bin it');
  assert.equal(at(pot('burnt'), tile('bin')), 'Empty it');
  assert.equal(at(salad, tile('serve'), undefined, orders), 'Serve!');
  assert.equal(at(salad, tile('serve')), '✗ Not ordered');
  assert.equal(at(plate({ food: 'tomato', state: 'chopped' }), tile('serve'), undefined, orders), '✗ Not on the menu');
  assert.equal(at(food('tomato'), tile('serve')), '✗ Plate it first');
  assert.equal(at(plate(), tile('rack')), 'Return plate');
  assert.equal(at(food('tomato'), tile('stove'), { fire: 1 }), '✗ Too hot!');
  const extinguisher: Item = { id: 8, kind: 'extinguisher', parts: [], cook: 0 };
  assert.equal(at(null, tile('counter'), { fire: 1, item: extinguisher }), 'Pick up', 'an empty hand rescues the extinguisher from a fire');
  assert.equal(at(null, tile('counter'), { fire: 1, item: food('tomato') }), '✗ Too hot!');
  assert.equal(at(food('tomato'), undefined), 'Drop');
  assert.equal(at(null, tile('counter')), '✗ Nothing here');
  const loose = { loose: [{ item: food('bun'), x: .2, y: 0, z: 1, vx: 0, vy: 0, vz: 0 }], orders: [] };
  assert.equal(at(null, tile('crate', { ingredient: 'lettuce' }), undefined, loose), 'Pick up', 'a resting item closer than the tile is picked up first');
  assert.equal(at(null, tile('crate', { ingredient: 'lettuce' }), undefined, { ...loose, loose: [{ ...loose.loose[0], vy: 2 }] }), 'Take lettuce', 'flying food is not grabbed');
});

test('score and results copy: next tip, star goal and headline', () => {
  assert.deepEqual([1, 3, 9].map(nextTip), ['Next tip ×1', 'Next tip ×3', 'Next tip ×4']);
  assert.equal(starGoal(65, [100, 200, 320]), '35 more coins for the first star');
  assert.equal(starGoal(199, [100, 200, 320]), '1 more coin for the second star');
  assert.equal(starGoal(320, [100, 200, 320]), null);
  const base = { stars: 0, served: 0, failed: 0, score: 0, thresholds: [100, 200, 320] as [number, number, number] };
  assert.equal(headline(base), 'Kitchen’s still warming up');
  assert.equal(headline({ ...base, served: 1, score: 20 }), 'First plate out!');
  assert.equal(headline({ ...base, served: 3, score: 40 }), '3 plates out. Good start!');
  assert.equal(headline({ ...base, served: 3, score: 80 }), 'So close to a star!');
  assert.equal(headline({ ...base, stars: 1, served: 4, score: 120 }), 'First star earned!');
  assert.equal(headline({ ...base, stars: 3, served: 12, failed: 0, score: 400 }), 'Flawless three-star service!');
  assert.equal(headline({ ...base, stars: 3, served: 12, failed: 1, score: 400 }), 'Three-star kitchen!');
});

test('recipes, items and levels have readable, compact presentation', () => {
  assert.deepEqual(recipeSteps('tomato_soup').map(step => [step.part.food, step.process, step.count]), [['tomato', 'boil', 3]]);
  assert.deepEqual(recipeSteps('pizza').map(step => step.process), ['bake', 'chop', 'chop']);
  assert.deepEqual(recipeSteps('burger').map(step => step.process), [null, 'fry']);
  for (const id of Object.keys(RECIPES)) assert.ok(recipeSteps(id as keyof typeof RECIPES).length > 0);
  assert.deepEqual(itemIcons({ id: 1, kind: 'plate', parts: [{ food: 'lettuce', state: 'chopped' }, { food: 'tomato', state: 'chopped' }], cook: 0 }), { main: 'dish_salad', parts: [] });
  assert.deepEqual(itemIcons({ id: 1, kind: 'dirty', parts: [], cook: 0, count: 4 }), { main: 'item_plate_dirty', parts: [], count: 4 });
  assert.equal(itemIcons(null), null);
  assert.equal(shortLabel({ id: 1, kind: 'pot', parts: Array(3).fill({ food: 'tomato', state: 'chopped' }), cook: 0 }), 'Pot: 3× chopped tomato');
  assert.equal(shortLabel({ id: 1, kind: 'plate', parts: [], cook: 0 }), 'Clean plate');
  assert.equal(iconFallback('food_tomato_chopped').color, '#e9503c');
  assert.equal(iconFallback('character_cat').glyph, 'C');
  for (const level of LEVELS) assert.ok(levelTags(level).length > 0, level.id);
  assert.equal(clock(95_000), '1:35'); assert.equal(clock(-5), '0:00'); assert.equal(clock(59_001), '1:00');
  assert.deepEqual([.9, .4, .1].map(patienceTone), ['ok', 'warn', 'urgent']);
});

test('hints agree with the real server for every held item × station × contents combination', () => {
  const K = ['#lbC#OFV#', 'R.......H', '#.@.....X', 'D.......W', '#########'];
  const P = (food: Part['food'], state: Part['state']): Part => ({ food, state }), pot = (kind: 'pot' | 'pan', parts: Part[], cook = 0): Item => ({ id: 0, kind, parts, cook });
  const ITEMS: (Item | null)[] = [
    null, food('tomato'), food('tomato', 'chopped'), food('bun'), food('lettuce', 'chopped'), { id: 0, kind: 'plate', parts: [], cook: 0 },
    { id: 0, kind: 'plate', parts: [P('lettuce', 'chopped')], cook: 0 }, { id: 0, kind: 'plate', parts: [P('dough', 'raw')], cook: 0 },
    pot('pot', []), pot('pot', [P('tomato', 'chopped')], 2), pot('pot', Array(3).fill(P('tomato', 'cooked')), POT_SECONDS + 1), pot('pot', [P('onion', 'burnt')], 30),
    pot('pan', [P('patty', 'cooked')], 7), { id: 0, kind: 'dirty', parts: [], cook: 0, count: 2 }, { id: 0, kind: 'extinguisher', parts: [], cook: 0 },
  ];
  const TARGETS = ['#1', 'C', 'O', 'V', 'W', 'R', 'D', 'H', 'X', 'l', 'b'].map(char => find(K, char[0], Number(char[1] ?? 0)));
  const clone = (item: Item | null, s: State) => item && { ...structuredClone(item), id: s.nextId++ };
  const shape = (item: Item | null | undefined) => item && { id: item.id, kind: item.kind, parts: item.parts, count: item.count };
  let checked = 0;
  for (const target of TARGETS) for (const held of ITEMS) for (const content of ITEMS) for (const count of [0, 2]) for (const cmd of ['grab', 'act'] as const) {
    const s = setup(K, { settings: { relaxed: true } }), kind = s.map.tiles[target].kind, surface = ['counter', 'board', 'stove', 'oven', 'sink'].includes(kind);
    if (content && !surface || count && kind !== 'rack' && kind !== 'return') continue;
    s.orders = [{ id: 999, recipe: 'side_salad', createdAt: s.now, expiresAt: s.now + 60_000 }];
    const chef = standAt(s, 0, target), spot = slot(s, target);
    spot.item = clone(content, s); spot.count = count; chef.held = clone(held, s); step(s);
    const v = rules.publicView(s, { nowMs: s.now, phase: 'playing' }), me = v.players[0], state = v.tiles.find(entry => entry.at === target);
    const snap = () => JSON.stringify([shape(chef.held), shape(spot.item), spot.count, s.score, s.loose.length]);
    const before = snap(), label = `${cmd} ${held ? itemLabel(held) : 'nothing'} → ${kind} ${content ? itemLabel(content) : ''} ×${count}`;
    press(s, 0, cmd);
    if (cmd === 'grab') assert.equal(grabHint(me, s.map.tiles[target], state, v).ok, snap() !== before, label);
    else assert.equal(actHint(me, s.map.tiles[target], state).kind !== 'none', chef.work !== 'none' || s.loose.length > 0, label);
    checked++;
  }
  assert.ok(checked > 500, `${checked} combinations`);
});
