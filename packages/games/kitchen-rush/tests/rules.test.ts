import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { rules, type State } from '../src/server';
import {
  BELT_SECONDS, BURN_AT, BURN_WARN, CHEF_RADIUS, DEFAULT_SETTINGS, EVENT_LIMIT, FIRE_SPREAD_SECONDS, OVEN_SECONDS, PAN_SECONDS, POT_SECONDS, RECIPES,
  RESPAWN_SECONDS, RETURN_SECONDS, WALKABLE, WASH_SECONDS, matchRecipe, neutral,
  type EventType, type FoodState, type Ingredient, type Input, type Item, type Part, type RecipeId,
} from '../src/model';
import { LEVELS } from '../src/levels';
import { DT, find, press, setup, slot, standAt, step, walkTo, type Setup } from './helpers/kitchen';
import { botInput } from './helpers/bot';

// A compact kitchen with one of everything. Row 0 is the back wall.
const K = [
  '#ltoC#OOFV#',
  'R.........H',
  '#.........#',
  'D.@...@...X',
  '#.........W',
  '#pbdc##E#R#',
];
const T = (char: string, n = 0) => find(K, char, n);
const COUNTER = T('#', 1), SIDE = T('#', 3), BOARD = T('C'), POT = T('O'), POT2 = T('O', 1), PAN = T('F'), OVEN = T('V'), HATCH = T('H'), BIN = T('X'), SINK = T('W'), RACK = T('R'), RETURN = T('D');
const kitchen = (options: Setup = {}) => setup(K, { ...options, level: { recipes: ['salad'], ...options.level } });
const part = (food: Ingredient, state: FoodState = 'raw'): Part => ({ food, state });
const make = (s: State, kind: Item['kind'], parts: Part[] = [], extra: Partial<Item> = {}): Item => ({ id: s.nextId++, kind, parts, cook: 0, ...extra });
const food = (s: State, name: Ingredient, state: FoodState = 'raw') => make(s, 'food', [part(name, state)]);
const plate = (s: State, recipe?: RecipeId) => make(s, 'plate', recipe ? RECIPES[recipe].parts.map(p => ({ ...p })) : []);
const last = (s: State, type: EventType) => s.events.filter(event => event.type === type).at(-1);
const count = (s: State, type: EventType) => s.events.filter(event => event.type === type).length;
const view = (s: State) => rules.publicView(s, { nowMs: s.now, phase: 'playing' });
const place = (s: State, player: number, x: number, z: number, fx = 0, fz = 1) => { Object.assign(s.players[player], { x, z, fx, fz, vx: 0, vz: 0 }); step(s); return s.players[player]; };
/** Hand a chef an item (a function call, so TypeScript does not narrow `held` across ticks). */
const hold = (chef: { held: Item | null }, item: Item | null) => { chef.held = item; };
const H = (chef: { held: Item | null }): Item | null => chef.held;
const tileXZ = (s: State, tile: number) => s.map.tiles[tile];
const order = (s: State, recipe: RecipeId, id: number, seconds = 60) => ({ id, recipe, createdAt: s.now, expiresAt: s.now + seconds * 1000 });

// ── Contract parsing ────────────────────────────────────────────────────────
test('settings default from {}, accept every level and reject unknown keys or invalid values', () => {
  assert.deepEqual(rules.validateSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(rules.validateSettings({ level: LEVELS.length - 1, seconds: 240, relaxed: true }), { level: LEVELS.length - 1, seconds: 240, relaxed: true });
  for (const bad of [null, [], 'x', { extra: 1 }, { toString: 1 }, { level: -1 }, { level: LEVELS.length }, { level: .5 }, { seconds: 200 }, { seconds: '180' }, { relaxed: 'yes' }, { level: undefined }]) {
    assert.throws(() => rules.validateSettings(bad), Error, JSON.stringify(bad));
  }
});

test('input parsing is strict and clamps the movement vector to length 1', () => {
  const diagonal = rules.parseInput({ x: 1, y: -1, act: false, cmd: 'grab', seq: 3 });
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9 && diagonal.x > 0 && diagonal.y < 0);
  assert.deepEqual(rules.parseInput({ x: .3, y: -.4, act: true, cmd: null, seq: 0 }), { x: .3, y: -.4, act: true, cmd: null, seq: 0 });
  const base = { x: 0, y: 0, act: false, cmd: null, seq: 0 };
  for (const bad of [null, [], { ...base, extra: 1 }, { x: 0, y: 0, act: false, cmd: null }, { ...base, x: 1.5 }, { ...base, y: Number.NaN }, { ...base, act: 1 }, { ...base, cmd: 'jump' }, { ...base, seq: -1 }, { ...base, seq: 1.5 }]) {
    assert.throws(() => rules.parseInput(bad), Error, JSON.stringify(bad));
  }
  assert.deepEqual(rules.neutralInput(), neutral());
  assert.throws(() => rules.parseAction({}));
  assert.deepEqual(rules.parseLobbyChoice!(undefined, false), { character: 'chef' });
  assert.deepEqual(rules.parseLobbyChoice!({ character: 'axolotl' }, true), { character: 'axolotl' });
  for (const bad of [{ character: 'dragon' }, { character: 'cat', hat: 1 }, 'cat', []]) assert.throws(() => rules.parseLobbyChoice!(bad, true));
  const s = setup(K, { players: 2 });
  assert.equal(s.players[0].character, 'chef');
});

// ── Grab interaction table ──────────────────────────────────────────────────
test('grab with empty hands: crate, rack, return stack and surface items', () => {
  const s = kitchen(), c = s.players[0];
  standAt(s, 0, T('l')); press(s, 0, 'grab');
  assert.deepEqual([H(c)?.kind, H(c)?.parts], ['food', [part('lettuce')]]);
  assert.equal(last(s, 'pickup')?.player, 'p0');
  press(s, 0, 'grab');
  assert.equal(c.note, 'Hands are full');

  hold(c, null);
  const plates = slot(s, RACK).count;
  standAt(s, 0, RACK); press(s, 0, 'grab');
  assert.equal(H(c)?.kind, 'plate'); assert.equal(slot(s, RACK).count, plates - 1);
  press(s, 0, 'grab'); // A clean empty plate goes back on the rack.
  assert.equal(H(c), null); assert.equal(slot(s, RACK).count, plates);
  slot(s, RACK).count = 0; press(s, 0, 'grab');
  assert.equal(H(c), null); assert.match(c.note, /No clean plates/);

  slot(s, RETURN).count = 3;
  standAt(s, 0, RETURN); press(s, 0, 'grab');
  assert.deepEqual([H(c)?.kind, H(c)?.count, slot(s, RETURN).count], ['dirty', 3, 0]);

  hold(c, null);
  slot(s, BOARD).item = food(s, 'tomato'); slot(s, BOARD).progress = .4;
  standAt(s, 0, BOARD); press(s, 0, 'grab');
  assert.deepEqual(H(c)?.parts, [part('tomato')]);
  assert.deepEqual([slot(s, BOARD).item, slot(s, BOARD).progress], [null, 0], 'progress belongs to the tile and resets when its item leaves');
  press(s, 0, 'grab'); press(s, 0, 'grab');
  assert.equal(H(c)?.kind, 'food');
  hold(c, null); press(s, 0, 'grab');
  assert.equal(c.note, 'Put food here to chop it');
});

test('grab picks up a nearby loose item before the target tile and drops onto the floor with no target', () => {
  const s = kitchen(), c = s.players[0], mid = tileXZ(s, find(K, '.', 12));
  hold(c, food(s, 'onion'));
  place(s, 0, mid.x, mid.z, 0, 1); // Facing open floor: no target.
  assert.equal(c.target, -1);
  press(s, 0, 'grab');
  assert.equal(H(c), null); assert.equal(s.loose.length, 1); assert.equal(s.loose[0].y, 0);
  press(s, 0, 'grab');
  assert.deepEqual(H(c)?.parts, [part('onion')]); assert.equal(s.loose.length, 0);

  // Standing at the board with an onion at their feet: the closer loose item wins.
  press(s, 0, 'grab');
  slot(s, BOARD).item = food(s, 'lettuce');
  const drop = s.loose[0];
  standAt(s, 0, BOARD);
  Object.assign(drop, { x: c.x, z: c.z + .1 });
  press(s, 0, 'grab');
  assert.deepEqual(H(c)?.parts, [part('onion')]); assert.ok(slot(s, BOARD).item);
});

test('grab while holding: surface rules, combining into containers and adding food to a held plate', () => {
  const s = kitchen(), c = s.players[0];
  hold(c, plate(s));
  standAt(s, 0, BOARD); press(s, 0, 'grab');
  assert.equal(c.note, 'Boards are for food'); assert.equal(H(c)?.kind, 'plate');
  standAt(s, 0, SINK); press(s, 0, 'grab');
  assert.equal(c.note, 'The sink is for dirty plates');
  standAt(s, 0, OVEN); press(s, 0, 'grab');
  assert.match(c.note, /raw dough/);

  standAt(s, 0, COUNTER); press(s, 0, 'grab');
  assert.equal(slot(s, COUNTER).item?.kind, 'plate'); assert.equal(H(c), null); assert.equal(last(s, 'place')?.player, 'p0');
  hold(c, food(s, 'lettuce')); press(s, 0, 'grab');
  assert.equal(c.note, 'Needs chopping first');
  hold(c, food(s, 'lettuce', 'chopped')); press(s, 0, 'grab');
  assert.deepEqual(slot(s, COUNTER).item?.parts, [part('lettuce', 'chopped')]); assert.equal(H(c), null);
  hold(c, food(s, 'bun')); press(s, 0, 'grab');
  assert.equal(slot(s, COUNTER).item?.parts.length, 2, 'raw bun may be plated');

  slot(s, COUNTER).item = food(s, 'tomato', 'chopped');
  hold(c, make(s, 'plate', [part('lettuce', 'chopped')])); press(s, 0, 'grab');
  assert.equal(matchRecipe(H(c)), 'salad'); assert.equal(slot(s, COUNTER).item, null);

  slot(s, COUNTER).item = food(s, 'tomato', 'chopped');
  hold(c, food(s, 'onion', 'chopped')); press(s, 0, 'grab');
  assert.equal(c.note, 'Needs a plate');
  hold(c, make(s, 'plate', [part('lettuce', 'chopped'), part('lettuce', 'chopped'), part('lettuce', 'chopped'), part('lettuce', 'chopped')])); press(s, 0, 'grab');
  assert.equal(c.note, 'Plate is full');
  hold(c, make(s, 'plate', [part('lettuce', 'burnt')])); press(s, 0, 'grab');
  assert.equal(c.note, 'Bin the burnt food first');

  // A held pot scoops chopped soup vegetables off a counter.
  hold(c, make(s, 'pot')); press(s, 0, 'grab');
  assert.deepEqual(H(c)?.parts, [part('tomato', 'chopped')]); assert.equal(slot(s, COUNTER).item, null);
  // Dirty stacks merge.
  slot(s, COUNTER).item = make(s, 'dirty', [], { count: 2 }); hold(c, make(s, 'dirty', [], { count: 1 })); press(s, 0, 'grab');
  assert.equal(slot(s, COUNTER).item?.count, 3); assert.equal(H(c), null);
  // Holding a plate at a bun crate adds a bun.
  hold(c, plate(s)); standAt(s, 0, T('b')); press(s, 0, 'grab');
  assert.deepEqual(H(c)?.parts, [part('bun')]);
  standAt(s, 0, T('l')); press(s, 0, 'grab');
  assert.equal(c.note, 'Needs chopping first');
});

test('pouring works both ways and refuses empty, uncooked or burnt contents', () => {
  const s = kitchen(), c = s.players[0], pot = slot(s, POT).item!;
  pot.parts = [part('tomato', 'cooked'), part('tomato', 'cooked'), part('tomato', 'cooked')]; pot.cook = POT_SECONDS;
  hold(c, plate(s));
  standAt(s, 0, POT); press(s, 0, 'grab');
  assert.equal(matchRecipe(H(c)), 'tomato_soup'); assert.deepEqual([pot.parts, pot.cook], [[], 0]); assert.equal(c.stats.cooked, 1);
  hold(c, plate(s)); press(s, 0, 'grab');
  assert.equal(c.note, 'The pot is empty');
  pot.parts = [part('onion', 'chopped')]; press(s, 0, 'grab');
  assert.equal(c.note, 'Not cooked yet');
  pot.parts = [part('onion', 'burnt')]; press(s, 0, 'grab');
  assert.equal(c.note, 'Burnt! Bin it');

  // Held cooked pot onto a plate on a counter.
  slot(s, COUNTER).item = plate(s);
  hold(c, make(s, 'pot', [part('onion', 'cooked'), part('onion', 'cooked'), part('onion', 'cooked')], { cook: POT_SECONDS + 1 }));
  standAt(s, 0, COUNTER); press(s, 0, 'grab');
  assert.equal(matchRecipe(slot(s, COUNTER).item), 'onion_soup'); assert.deepEqual(H(c)?.parts, []);
  assert.equal(H(c)?.cook, 0);
});

test('bin destroys food, empties containers but keeps them, and refuses dirty plates or the extinguisher', () => {
  const s = kitchen(), c = s.players[0];
  standAt(s, 0, BIN);
  hold(c, food(s, 'tomato')); press(s, 0, 'grab');
  assert.equal(H(c), null);
  hold(c, plate(s, 'salad')); press(s, 0, 'grab');
  assert.deepEqual([H(c)?.kind, H(c)?.parts], ['plate', []]);
  press(s, 0, 'grab');
  assert.equal(c.note, 'Already empty');
  hold(c, make(s, 'pot', [part('tomato', 'burnt')], { cook: 20 })); press(s, 0, 'grab');
  assert.deepEqual([H(c)?.kind, H(c)?.parts, H(c)?.cook], ['pot', [], 0]);
  hold(c, make(s, 'dirty', [], { count: 2 })); press(s, 0, 'grab');
  assert.equal(c.note, 'Wash dirty plates in the sink'); assert.equal(H(c)?.kind, 'dirty');
  hold(c, make(s, 'extinguisher')); press(s, 0, 'grab');
  assert.equal(H(c)?.kind, 'extinguisher');
  hold(c, null); press(s, 0, 'grab');
  assert.equal(c.note, 'Nothing to take from the bin');
});

test('burning tiles refuse every grab until the fire is out, except an empty hand rescuing the extinguisher', () => {
  const s = kitchen(), c = s.players[0];
  slot(s, COUNTER).item = food(s, 'tomato'); slot(s, COUNTER).fire = 1;
  standAt(s, 0, COUNTER); press(s, 0, 'grab');
  assert.equal(c.note, 'Put it out first!'); assert.equal(H(c), null);
  hold(c, food(s, 'onion')); press(s, 0, 'grab');
  assert.equal(c.note, 'Put it out first!'); assert.equal(H(c)?.parts[0].food, 'onion');
  slot(s, COUNTER).item = make(s, 'extinguisher'); press(s, 0, 'grab');
  assert.equal(H(c)?.parts[0].food, 'onion', 'full hands still cannot use a burning tile');
  hold(c, null); press(s, 0, 'grab');
  assert.equal(H(c)?.kind, 'extinguisher', 'fire spreading onto the extinguisher never locks it away');
});

// ── Chopping ────────────────────────────────────────────────────────────────
test('chopping starts with one tap, continues hands-free, cancels on walking away and keeps progress', () => {
  const s = kitchen(), c = s.players[0];
  hold(c, food(s, 'lettuce'));
  standAt(s, 0, BOARD); press(s, 0, 'grab');
  assert.match(c.note, /Chop/);
  press(s, 0, 'act');
  assert.equal(c.work, 'chop');
  step(s, {}, 1);
  const progress = slot(s, BOARD).progress;
  assert.ok(progress > .45 && progress < .52, `progress ${progress}`);
  step(s, { p0: { x: 0, y: .2 } }, .2); // A small nudge below the cancel threshold keeps chopping.
  assert.equal(c.work, 'chop');
  const kept = slot(s, BOARD).progress;
  step(s, { p0: { x: 0, y: 1 } }, .3); // Walk away.
  assert.equal(c.work, 'none'); assert.equal(slot(s, BOARD).progress, kept);
  standAt(s, 0, BOARD); press(s, 0, 'act');
  step(s, {}, 1.2);
  assert.equal(slot(s, BOARD).item?.parts[0].state, 'chopped'); assert.equal(c.work, 'none'); assert.equal(c.stats.chopped, 1);
  assert.equal(slot(s, BOARD).progress, 0); assert.equal(last(s, 'chop')?.player, 'p0');
  press(s, 0, 'act');
  assert.equal(c.note, 'Already chopped');
  slot(s, BOARD).item = food(s, 'bun'); press(s, 0, 'act');
  assert.equal(c.note, 'Bun is used whole'); assert.equal(c.work, 'none');
});

// ── Cooking, burning, fire ──────────────────────────────────────────────────
test('pot takes up to three chopped soup vegetables; late additions dilute the heat', () => {
  const s = kitchen(), c = s.players[0], pot = slot(s, POT).item!;
  standAt(s, 0, POT);
  for (const [item, note] of [[food(s, 'tomato'), 'Needs chopping first'], [food(s, 'lettuce', 'chopped'), 'Only tomato or onion go in a pot'], [food(s, 'tomato', 'cooked'), 'Already cooked']] as const) {
    hold(c, item); press(s, 0, 'grab');
    assert.equal(c.note, note); assert.equal(pot.parts.length, 0);
  }
  hold(c, food(s, 'tomato', 'chopped')); press(s, 0, 'grab');
  step(s, {}, 4.5);
  const one = pot.cook;
  hold(c, food(s, 'tomato', 'chopped')); press(s, 0, 'grab');
  assert.ok(Math.abs(pot.cook - (one + DT) / 2) < .05, `two parts halve the heat: ${pot.cook}`);
  const two = pot.cook;
  hold(c, food(s, 'tomato', 'chopped')); press(s, 0, 'grab');
  assert.ok(Math.abs(pot.cook - (two + DT) * 2 / 3) < .05, `three parts keep two thirds: ${pot.cook}`);
  hold(c, food(s, 'tomato', 'chopped')); press(s, 0, 'grab');
  assert.equal(c.note, 'Pot is full'); assert.equal(pot.parts.length, 3);

  step(s, {}, POT_SECONDS - pot.cook - .1);
  assert.ok(pot.parts.every(p => p.state === 'chopped'));
  step(s, {}, .2);
  assert.ok(pot.parts.every(p => p.state === 'cooked')); assert.ok(last(s, 'done'));
  step(s, {}, BURN_WARN);
  assert.ok(last(s, 'warn')); assert.equal(count(s, 'burn'), 0);
  step(s, {}, BURN_AT - BURN_WARN);
  assert.ok(pot.parts.every(p => p.state === 'burnt'));
  assert.equal(slot(s, POT).fire, 1); assert.ok(last(s, 'burn')); assert.ok(last(s, 'fire'));
});

test('heat is kept when a pot leaves the stove and a pan fries one chopped patty', () => {
  const s = kitchen(), c = s.players[0], pan = slot(s, PAN).item!;
  standAt(s, 0, PAN);
  hold(c, food(s, 'patty')); press(s, 0, 'grab');
  assert.equal(c.note, 'Needs chopping first');
  hold(c, food(s, 'tomato', 'chopped')); press(s, 0, 'grab');
  assert.equal(c.note, 'Only beef goes in a pan');
  hold(c, food(s, 'patty', 'chopped')); press(s, 0, 'grab');
  hold(c, food(s, 'patty', 'chopped')); press(s, 0, 'grab');
  assert.equal(c.note, 'Pan is full');
  hold(c, null);
  step(s, {}, 3);
  press(s, 0, 'grab'); // Lift the pan: it stops heating but keeps its heat.
  const kept = H(c)!.cook;
  step(s, {}, 2);
  assert.equal(H(c)!.cook, kept);
  press(s, 0, 'grab');
  step(s, {}, PAN_SECONDS - kept + .1);
  assert.equal(pan.parts[0].state, 'cooked');
  hold(c, make(s, 'plate', [part('bun')])); press(s, 0, 'grab');
  assert.equal(matchRecipe(H(c)), 'burger');
});

test('the oven bakes a plate with raw dough into a pizza', () => {
  const s = kitchen(), c = s.players[0];
  hold(c, plate(s));
  standAt(s, 0, T('d')); press(s, 0, 'grab');
  slot(s, COUNTER).item = food(s, 'tomato', 'chopped');
  standAt(s, 0, COUNTER); press(s, 0, 'grab');
  slot(s, COUNTER).item = food(s, 'cheese', 'chopped'); press(s, 0, 'grab');
  standAt(s, 0, OVEN); press(s, 0, 'grab');
  assert.equal(H(c), null);
  step(s, {}, OVEN_SECONDS + .1);
  assert.ok(last(s, 'done'));
  press(s, 0, 'grab');
  assert.equal(matchRecipe(H(c)), 'pizza'); assert.equal(c.stats.cooked, 1);
});

test('fire spreads to a flammable neighbour on schedule and the extinguisher cone puts everything out', () => {
  const spread = (seed: number) => {
    const s = kitchen({ seed }), pot = slot(s, POT).item!;
    pot.parts = [part('tomato', 'chopped')]; pot.cook = POT_SECONDS + BURN_AT - .05;
    step(s, {}, .1);
    assert.equal(slot(s, POT).fire, 1);
    step(s, {}, FIRE_SPREAD_SECONDS - .2);
    assert.equal(count(s, 'fire'), 1);
    step(s, {}, .2);
    assert.equal(count(s, 'fire'), 2);
    return s;
  };
  const s = spread(3), c = s.players[0], burning = () => s.slots.filter(t => t.fire > 0).length;
  assert.deepEqual(spread(3).slots.map(t => t.fire > 0), s.slots.map(t => t.fire > 0), 'seeded spread is deterministic');
  assert.ok([COUNTER, POT2].some(i => slot(s, i).fire === 1), 'spreads to an orthogonal flammable neighbour');
  standAt(s, 0, T('E')); press(s, 0, 'grab');
  assert.equal(H(c)?.kind, 'extinguisher');
  standAt(s, 0, POT);
  press(s, 0, 'act');
  assert.equal(c.work, 'spray');
  step(s, { p0: { act: true } }, 1.3);
  assert.equal(burning(), 0); assert.ok(c.stats.extinguished >= 2); assert.ok(last(s, 'extinguish'));
  step(s, {}, .1);
  assert.equal(c.work, 'none');
  press(s, 0, 'grab');
  assert.equal(c.note, 'Something is already here', 'the burnt pot is safe but still occupies the stove');
});

// ── Serving and orders ──────────────────────────────────────────────────────
test('serving pays value plus a combo-multiplied tip and fulfils the oldest matching order', () => {
  const s = kitchen({ settings: { seconds: 240 }, level: { recipes: ['salad', 'side_salad'] } }), c = s.players[0];
  s.orders = [order(s, 'salad', 100), order(s, 'side_salad', 101), order(s, 'salad', 102)];
  standAt(s, 0, HATCH);
  hold(c, plate(s, 'salad')); press(s, 0, 'grab');
  assert.deepEqual(s.orders.map(o => o.id), [101, 102]);
  assert.deepEqual([s.score, s.combo, s.served, c.stats.served, s.recipeCounts.salad, H(c)], [38, 2, 1, 1, 1, null]);
  assert.deepEqual([last(s, 'serve')?.value, last(s, 'serve')?.recipe], [38, 'salad']);
  hold(c, plate(s, 'side_salad')); press(s, 0, 'grab');
  assert.equal(s.score, 38 + 20 + 16); assert.equal(s.combo, 3);
  step(s, {}, 30); // Half the patience has drained on order 102.
  hold(c, plate(s, 'salad')); press(s, 0, 'grab');
  assert.equal(s.score, 74 + 30 + 4 * 3); assert.equal(s.combo, 4);
});

test('wrong dishes are refused at the hatch and stay in hand', () => {
  const s = kitchen(), c = s.players[0];
  s.orders = [order(s, 'salad', 100)];
  standAt(s, 0, HATCH);
  for (const [held, note] of [
    [make(s, 'plate', [part('onion', 'chopped')]), 'That is not on the menu'], [plate(s, 'tomato_soup'), 'No one ordered tomato soup'],
    [plate(s), 'The plate is empty'], [food(s, 'lettuce', 'chopped'), 'Serve dishes on a plate'],
  ] as const) {
    hold(c, held); press(s, 0, 'grab');
    assert.equal(c.note, note); assert.equal(H(c), held); assert.equal(s.score, 0);
  }
  assert.equal(count(s, 'wrong'), 3); assert.equal(last(s, 'wrong')?.player, 'p0'); assert.equal(s.orders.length, 1);
});

test('orders open, arrive on a seeded schedule without flooding, and expire for a penalty', () => {
  const s = setup(K, { players: 2, level: { recipes: ['salad', 'side_salad', 'tomato_soup'], patience: 52 } });
  assert.deepEqual(s.orders.map(o => o.recipe), ['salad', 'side_salad']);
  assert.equal(s.orders[0].expiresAt - s.orders[0].createdAt, 52 * 1.25 * 1000);
  step(s, {}, 52 * 1.25 / 2.6 + .1);
  assert.deepEqual(s.orders.map(o => o.recipe), ['salad', 'side_salad', 'tomato_soup'], 'each recipe is introduced once first');
  assert.equal(setup(K, { players: 6 }).orders.length, 3);
  for (let i = 0; i < 400; i++) { // Never more than two identical open orders.
    step(s, {}, 1);
    for (const id of ['salad', 'side_salad', 'tomato_soup']) assert.ok(s.orders.filter(o => o.recipe === id).length <= 2);
    assert.ok(s.orders.length <= 4);
    if (s.complete) break;
  }
  const e = kitchen(), before = e.orders.length;
  e.score = 3; e.combo = 3; e.orders[0].expiresAt = e.now + 100;
  step(e, {}, .2);
  assert.deepEqual([e.failed, e.score, e.combo, e.orders.length], [1, 0, 1, before - 1]);
  assert.equal(last(e, 'expire')?.recipe, 'salad');
  e.score = 50; e.orders[0].expiresAt = e.now + 50;
  step(e, {}, .1);
  assert.equal(e.score, 45);
  // The rail never runs dry: below the opening count, the next order arrives within 2.5 s, whatever the schedule says.
  const r = kitchen(); r.orders.splice(1); r.nextOrderAt = r.now + 60000;
  step(r, {}, 2.4); assert.equal(r.orders.length, 1);
  step(r, {}, .2); assert.equal(r.orders.length, 2);
});

test('relaxed mode never burns food or expires orders', () => {
  const s = kitchen({ settings: { relaxed: true } }), pot = slot(s, POT).item!;
  pot.parts = [part('onion', 'chopped')];
  step(s, {}, POT_SECONDS + BURN_AT + 5);
  assert.equal(pot.parts[0].state, 'cooked'); assert.equal(pot.cook, POT_SECONDS); assert.equal(slot(s, POT).fire, 0);
  assert.equal(count(s, 'warn') + count(s, 'burn') + count(s, 'fire'), 0);
  step(s, {}, 120);
  assert.equal(s.failed, 0); assert.ok(s.orders.length >= 2);
});

test('stars follow the thresholds and each new star emits once', () => {
  const s = kitchen(), c = s.players[0];
  s.score = s.thresholds[1] - 10;
  step(s);
  assert.equal(s.stars, 1); assert.equal(count(s, 'star'), 1);
  s.orders = [order(s, 'salad', 900)];
  standAt(s, 0, HATCH); hold(c, plate(s, 'salad')); press(s, 0, 'grab');
  assert.equal(s.stars, 2); assert.deepEqual(s.events.filter(e => e.type === 'star').map(e => e.value), [1, 2]);
});

// ── Plates ──────────────────────────────────────────────────────────────────
test('served plates return dirty after RETURN_SECONDS and wash one by one into the nearest rack', () => {
  const s = kitchen(), c = s.players[0], nearRack = T('R', 1), racks = slot(s, nearRack).count;
  assert.equal(slot(s, RACK).count + slot(s, nearRack).count, 1 + 3, 'players + 3 clean plates split between racks');
  s.orders = [order(s, 'salad', 100), order(s, 'salad', 101)];
  standAt(s, 0, HATCH);
  hold(c, plate(s, 'salad')); press(s, 0, 'grab');
  hold(c, plate(s, 'salad')); press(s, 0, 'grab');
  step(s, {}, RETURN_SECONDS - .2);
  assert.equal(slot(s, RETURN).count, 0);
  step(s, {}, .3);
  assert.equal(slot(s, RETURN).count, 2);
  standAt(s, 0, RETURN); press(s, 0, 'grab');
  standAt(s, 0, SINK); press(s, 0, 'grab');
  assert.equal(slot(s, SINK).item?.count, 2); assert.match(c.note, /Wash/);
  press(s, 0, 'act');
  assert.equal(c.work, 'wash');
  step(s, {}, WASH_SECONDS);
  assert.equal(slot(s, nearRack).count, racks + 1); assert.equal(slot(s, SINK).item?.count, 1); assert.equal(c.work, 'wash', 'washing continues through the stack');
  step(s, {}, WASH_SECONDS);
  assert.equal(slot(s, nearRack).count, racks + 2); assert.equal(slot(s, SINK).item, null);
  assert.deepEqual([c.work, c.stats.washed, count(s, 'wash')], ['none', 2, 2]);
});

test('kitchens without a sink return plates clean to a rack', () => {
  const rows = ['#lC#H#', 'R.@..#', '######'], s = setup(rows, { level: { recipes: ['side_salad'] } }), c = s.players[0], rack = find(rows, 'R');
  s.orders = [order(s, 'side_salad', 100)];
  slot(s, rack).count = 0;
  standAt(s, 0, rack); press(s, 0, 'grab');
  assert.equal(c.note, 'Plates are on their way back');
  hold(c, plate(s, 'side_salad'));
  standAt(s, 0, find(rows, 'H')); press(s, 0, 'grab');
  assert.equal(s.served, 1);
  step(s, {}, RETURN_SECONDS + .1);
  assert.equal(slot(s, rack).count, 1);
});

// ── Throwing ────────────────────────────────────────────────────────────────
test('thrown food is caught by an empty-handed teammate', () => {
  const s = kitchen({ players: 2 }), [a, b] = s.players, row2 = tileXZ(s, find(K, '.', 9));
  place(s, 1, row2.x + 3, row2.z);
  place(s, 0, row2.x, row2.z, 1, 0);
  hold(a, food(s, 'tomato'));
  press(s, 0, 'act');
  assert.equal(H(a), null); assert.equal(s.loose.length, 1); assert.equal(s.loose[0].by, 'p0'); assert.ok(s.loose[0].y > .9);
  step(s, {}, .4);
  assert.deepEqual(H(b)?.parts, [part('tomato')]); assert.equal(s.loose.length, 0);
  assert.deepEqual([a.stats.thrown, b.stats.caught, last(s, 'catch')?.player], [1, 1, 'p1']);
  hold(b, plate(s)); press(s, 1, 'act');
  assert.equal(b.note, 'Plates are too precious to throw'); assert.equal(H(b)?.kind, 'plate');
});

test('thrown food lands in an accepting pot, on an empty counter, on the floor, or rests beside a blocked station', () => {
  const s = kitchen(), c = s.players[0], below = (tile: number, rows: number) => { const t = tileXZ(s, tile); return place(s, 0, t.x, t.z + rows, 0, -1); };
  below(POT, 4); hold(c, food(s, 'tomato', 'chopped')); press(s, 0, 'act');
  step(s, {}, .5);
  assert.deepEqual(slot(s, POT).item?.parts, [part('tomato', 'chopped')]); assert.equal(s.loose.length, 0); assert.ok(last(s, 'land'));
  below(COUNTER, 4); hold(c, food(s, 'lettuce', 'chopped')); press(s, 0, 'act');
  step(s, {}, .5);
  assert.deepEqual(slot(s, COUNTER).item?.parts, [part('lettuce', 'chopped')]);
  hold(c, food(s, 'onion')); press(s, 0, 'act'); // Counter is now occupied.
  step(s, {}, .5);
  assert.equal(s.loose.length, 1); assert.equal(s.loose[0].y, 0); assert.equal(s.loose[0].by, undefined);
  const resting = s.loose[0], floor = s.map.tiles.find(t => t.col === 5 && t.row === 1)!;
  assert.ok(WALKABLE.has(s.map.tiles.find(t => Math.abs(t.x - resting.x) < .5 && Math.abs(t.z - resting.z) < .5)!.kind) && Math.abs(resting.x - floor.x) < .5);
  const left = tileXZ(s, SIDE);
  place(s, 0, left.x + 1, left.z, 1, 0); hold(c, food(s, 'cheese')); press(s, 0, 'act');
  step(s, {}, .5);
  assert.equal(s.loose.length, 2); assert.equal(s.loose[1].y, 0); assert.equal(s.loose[1].vx, 0);
});

test('food thrown into a gap splashes; chefs are stopped at the edge of the void', () => {
  const rows = ['#######', '#@..~~#', '#######'], s = setup(rows), c = s.players[0];
  hold(c, food(s, 'tomato'));
  place(s, 0, c.x, c.z, 1, 0); press(s, 0, 'act');
  step(s, {}, .5);
  assert.equal(s.loose.length, 0); assert.ok(last(s, 'splash'));
  step(s, { p0: { x: 1, y: 0 } }, 2);
  const edge = s.map.tiles[find(rows, '~')].x - .5;
  assert.ok(c.x <= edge - CHEF_RADIUS + 1e-6, `chef at ${c.x}, void edge ${edge}`);
  press(s, 0, 'dash', { x: 1 }); step(s, { p0: { x: 1 } }, .5);
  assert.ok(c.x <= edge - CHEF_RADIUS + 1e-6);
});

// ── Gimmicks ────────────────────────────────────────────────────────────────
test('conveyors resolve from the front of a chain and wait when blocked', () => {
  const rows = ['#>>>#C', '#.@..#', '######'], s = setup(rows), belt = (n: number) => slot(s, find(rows, '>', n)), end = slot(s, find(rows, '#', 1));
  belt(0).item = food(s, 'tomato'); belt(1).item = food(s, 'onion'); belt(2).item = food(s, 'lettuce');
  step(s, {}, BELT_SECONDS + DT);
  assert.deepEqual([belt(0).item, belt(1).item?.parts[0].food, belt(2).item?.parts[0].food, end.item?.parts[0].food], [null, 'tomato', 'onion', 'lettuce'], 'the whole chain advances one tile');
  step(s, {}, BELT_SECONDS);
  assert.deepEqual([belt(1).item?.parts[0].food, belt(2).item?.parts[0].food], ['tomato', 'onion'], 'a blocked chain waits');
  end.item = null;
  step(s, {}, BELT_SECONDS);
  assert.deepEqual([belt(1).item, belt(2).item?.parts[0].food, slot(s, find(rows, '#', 1)).item?.parts[0].food], [null, 'tomato', 'onion']);
});

test('ice keeps momentum: slower to start and much longer to stop than floor', () => {
  const rows = ['############', '#@.........#', '#@*********#', '############'], s = setup(rows, { players: 2 }), [a, b] = s.players;
  place(s, 0, a.x, a.z, 1, 0); place(s, 1, b.x + 1, b.z, 1, 0);
  step(s, { p0: { x: 1 }, p1: { x: 1 } }, .25);
  assert.ok(Math.abs(a.vx - 4.4) < 1e-6 && b.vx < 2.5, `floor ${a.vx} ice ${b.vx}`);
  step(s, { p0: { x: 1 }, p1: { x: 1 } }, .5);
  const [ax, bx] = [a.x, b.x];
  step(s, {}, 2);
  assert.ok(a.x - ax < .4 && b.x - bx > 3 * (a.x - ax), `stop: floor ${a.x - ax} ice ${b.x - bx}`);
});

test('dash is an impulse with a cooldown and a short input buffer', () => {
  const rows = ['##############', '#@...........#', '##############'], s = setup(rows), c = s.players[0];
  place(s, 0, c.x, c.z, 1, 0);
  press(s, 0, 'dash');
  assert.ok(c.dashing && c.vx > 10, `vx ${c.vx}`); assert.equal(c.stats.dashes, 1); assert.ok(last(s, 'dash'));
  step(s, {}, .2);
  assert.ok(!c.dashing);
  press(s, 0, 'dash'); // Within cooldown but beyond the buffer: ignored.
  assert.equal(c.stats.dashes, 1);
  step(s, {}, .25);
  press(s, 0, 'dash'); // Within 150 ms of ready: buffered.
  assert.equal(c.stats.dashes, 1);
  step(s, {}, .15);
  assert.equal(c.stats.dashes, 2);
});

test('drawbridges drop chefs and their items into the gap; plates and pots come home; chefs respawn', () => {
  const rows = ['######', 'R@g.W#', 'O@g.D#', '######'], s = setup(rows, { players: 2, level: { gates: { open: 4, closed: 3, warn: 1 } } }), [a, b] = s.players;
  const gate = (n: number) => tileXZ(s, find(rows, 'g', n));
  standAt(s, 0, find(rows, 'R')); press(s, 0, 'grab');
  standAt(s, 1, find(rows, 'O')); press(s, 1, 'grab');
  assert.deepEqual([H(a)?.kind, H(b)?.kind], ['plate', 'pot']);
  H(b)!.parts = [part('tomato', 'chopped')];
  place(s, 0, gate(0).x, gate(0).z); place(s, 1, gate(1).x, gate(1).z);
  step(s, {}, 3.1 - (s.now - s.startedAt) / 1000);
  assert.ok(s.gateWarning && s.gatesOpen);
  step(s, {}, 1);
  assert.ok(!s.gatesOpen); assert.equal(last(s, 'gate')?.value, 0);
  assert.ok(a.respawnAt > 0 && b.respawnAt > 0); assert.deepEqual([H(a), H(b), a.target], [null, null, -1]);
  assert.equal(count(s, 'fall'), 2); assert.equal(a.stats.falls, 1);
  assert.deepEqual(slot(s, find(rows, 'O')).item && [slot(s, find(rows, 'O')).item!.kind, slot(s, find(rows, 'O')).item!.parts], ['pot', []], 'pot goes home empty');
  press(s, 0, 'grab'); // Commands from a fallen chef are acknowledged but ignored.
  assert.equal(a.seq, 2); assert.equal(H(a), null);
  step(s, {}, RESPAWN_SECONDS);
  assert.equal(a.respawnAt, 0); assert.equal(count(s, 'respawn'), 2);
  assert.ok(s.map.spawns.some(p => p.x === a.x && p.z === a.z) || Math.hypot(a.x - s.map.spawns[0].x, a.z - s.map.spawns[0].z) < .8);
  step(s, {}, RETURN_SECONDS - RESPAWN_SECONDS);
  assert.equal(slot(s, find(rows, 'D')).count, 1, 'the lost plate returns as a dirty plate');
  while (s.gatesOpen) step(s);
  step(s, { p0: { x: 1 }, p1: { x: 1 } }, 1);
  assert.ok(s.players.every(c => c.x < gate(0).x - .5 - CHEF_RADIUS + 1e-6), 'closed gates block walking');
});

test('portals move chefs (keeping momentum) and thrown food to their pair', () => {
  const rows = ['#########', '#@.T#T..#', '#########'], s = setup(rows), c = s.players[0], [from, to] = [tileXZ(s, find(rows, 'T')), tileXZ(s, find(rows, 'T', 1))];
  step(s, { p0: { x: 1 } }, .6);
  assert.ok(c.x > to.x, `chef at ${c.x}`); assert.ok(c.vx > 4); assert.equal(last(s, 'portal')?.player, 'p0');
  step(s, { p0: { x: -1 } }, 1.3);
  assert.ok(c.x < from.x, 'walking back through the pair returns'); assert.equal(count(s, 'portal'), 2);
  const start = tileXZ(s, find(rows, '@'));
  place(s, 0, start.x, start.z, 1, 0); hold(c, food(s, 'tomato', 'chopped'));
  press(s, 0, 'act'); step(s, {}, .5);
  assert.equal(s.loose.length, 1); assert.ok(s.loose[0].x > to.x + 1 && s.loose[0].y === 0, 'the tomato flew on from the paired portal');
  assert.equal(count(s, 'portal'), 3);
});

// ── Collision and crowding ──────────────────────────────────────────────────
const inside = (s: State) => {
  const { map } = s;
  for (const c of s.players) if (!c.respawnAt) {
    for (const tile of map.tiles) {
      if (WALKABLE.has(tile.kind) && (tile.kind !== 'gate' || s.gatesOpen)) continue;
      const px = Math.max(tile.x - .5, Math.min(c.x, tile.x + .5)), pz = Math.max(tile.z - .5, Math.min(c.z, tile.z + .5));
      if (Math.hypot(c.x - px, c.z - pz) < CHEF_RADIUS - 1e-6) return `${c.id} overlaps ${tile.kind} at ${tile.col},${tile.row}`;
    }
    if (Math.abs(c.x) > map.halfX - CHEF_RADIUS + 1e-6 || Math.abs(c.z) > map.halfZ - CHEF_RADIUS + 1e-6) return `${c.id} out of bounds`;
  }
  return '';
};
const random = (seed: number) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 4294967296);

test('random walking and dashing never lets a chef enter a station, the void or leave the map', () => {
  for (const rows of [K, ['#########', '#@.~~.@.#', '#..~C..*#', '#@**.~..#', '#########']]) {
    const s = setup(rows, { players: 4 }), roll = random(11);
    const inputs: Record<string, Partial<Input>> = {};
    for (let t = 0; t < 20 * 60; t++) {
      if (t % 20 === 0) for (const c of s.players) inputs[c.id] = { x: roll() * 2 - 1, y: roll() * 2 - 1, ...(roll() < .3 ? { cmd: 'dash' as const, seq: c.seq + 1 } : {}) };
      step(s, inputs);
      const problem = inside(s);
      assert.equal(problem, '', `tick ${t}: ${problem}`);
    }
  }
});

test('ten chefs crowding one spot never overlap deeply, stay on the floor, and can walk apart', () => {
  const s = setup(null, { players: 10 }), centre = { x: 0, z: s.map.tiles.find(t => WALKABLE.has(t.kind))!.z };
  let minGap = Infinity;
  for (let t = 0; t < 5 * 60; t++) {
    const inputs: Record<string, Partial<Input>> = {};
    for (const c of s.players) { const dx = centre.x - c.x, dz = centre.z - c.z, d = Math.hypot(dx, dz) || 1; inputs[c.id] = { x: dx / d, y: dz / d, ...(t % 30 === 0 ? { cmd: 'dash' as const, seq: c.seq + 1 } : {}) }; }
    step(s, inputs);
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) minGap = Math.min(minGap, Math.hypot(s.players[i].x - s.players[j].x, s.players[i].z - s.players[j].z));
    assert.equal(inside(s), '');
  }
  assert.ok(minGap > CHEF_RADIUS, `closest pair ${minGap}`);
  const before = s.players.map(c => ({ x: c.x, z: c.z }));
  for (let t = 0; t < 2 * 60; t++) step(s, Object.fromEntries(s.players.map((c, i) => [c.id, { x: Math.cos(i * 2.4), y: Math.sin(i * 2.4) }])));
  const moved = s.players.filter((c, i) => Math.hypot(c.x - before[i].x, c.z - before[i].z) > .3).length;
  assert.ok(moved >= 8, `${moved} of 10 chefs walked free`);
});

// ── Presence and commands ───────────────────────────────────────────────────
test('disconnecting drops anything held, freezes the chef as a ghost others walk through, and reconnect restores them', () => {
  const s = kitchen({ players: 2 }), [a, b] = s.players;
  hold(a, food(s, 'tomato')); hold(b, make(s, 'extinguisher'));
  step(s, { p0: { x: 1 } }, .2);
  rules.onPresenceChange(s, 'p0', false, s.now); rules.onPresenceChange(s, 'p1', false, s.now);
  assert.deepEqual([H(a), H(b), a.connected, a.vx, s.loose.map(drop => drop.item.kind)], [null, null, false, 0, ['food', 'extinguisher']]);
  const { x, z } = a;
  press(s, 0, 'grab'); step(s, { p0: { x: 1 } }, .5);
  assert.deepEqual([a.x, a.z, H(a)], [x, z, null], 'disconnected chefs are frozen');
  rules.onPresenceChange(s, 'p0', true, s.now);
  assert.equal(s.players.length, 2); assert.ok(a.connected);
  step(s, { p0: { x: -1 } }, .2);
  assert.ok(a.x < x);
  // p1 is still away: p0 walks straight through them and leaves them where they froze.
  const ghost = { x: b.x, z: b.z };
  place(s, 0, b.x - 1, b.z); step(s, { p0: { x: 1 } }, .5);
  assert.ok(a.x > ghost.x + .8, `walked through (${a.x} vs ${ghost.x})`);
  assert.deepEqual([b.x, b.z], [ghost.x, ghost.z]);
});

test('commands apply once per sequence number; resends are ignored and new sequences apply', () => {
  const s = kitchen(), c = s.players[0];
  standAt(s, 0, T('l'));
  const tap: Partial<Input> = { cmd: 'grab', seq: 1 };
  step(s, { p0: tap }, .5); // The phone keeps resending until the ack arrives.
  assert.equal(c.seq, 1); assert.equal(H(c)?.kind, 'food'); assert.equal(count(s, 'pickup'), 1);
  step(s, { p0: tap });
  assert.equal(H(c)?.kind, 'food');
  step(s, { p0: { cmd: 'grab', seq: 5 } });
  assert.equal(c.seq, 5); assert.equal(c.note, 'Hands are full');
  step(s, { p0: { cmd: null, seq: 6 } });
  assert.equal(c.seq, 6);
  step(s, { p0: { cmd: 'grab', seq: 4 } });
  assert.equal(c.seq, 6);
});

// ── Projection, outcome, determinism ────────────────────────────────────────
test('public views are lean, sparse and pass the live transport check at 1 and 10 chefs', () => {
  for (const players of [1, 10]) {
    const s = setup(null, { players });
    step(s, Object.fromEntries(s.players.map(c => [c.id, { x: .7, y: .3, cmd: 'dash' as const, seq: 1 }])), 1);
    const v = view(s);
    assertSerializable(v); assertSerializable(rules.outcome(s)); assert.equal(rules.playerView(s, 'p0', { nowMs: s.now, phase: 'playing' }), null);
    assert.equal(v.players.length, players);
    assert.ok(v.tiles.every(t => t.item || t.progress || t.fire || t.count), 'only tiles with something to show');
    assert.ok(v.players.every(c => [c.x, c.z, c.vx, c.vz, c.fx, c.fz].every(n => Math.round(n * 1000) / 1000 === n)), 'positions are rounded');
    assert.ok(JSON.stringify(v).length < (players === 1 ? 6000 : 14000), `snapshot ${JSON.stringify(v).length} bytes`);
  }
  for (let level = 0; level < LEVELS.length; level++) for (const players of [1, 10]) {
    const s = setup(null, { players, settings: { level } });
    step(s, Object.fromEntries(s.players.map(c => [c.id, { x: -.5, y: .8 }])), .5);
    assertSerializable(view(s));
    assert.equal(inside(s), '', `level ${level} with ${players} chefs spawns on the floor`);
  }
  const busy = kitchen({ players: 2 }), c = busy.players[0];
  slot(busy, BOARD).item = food(busy, 'lettuce'); slot(busy, BOARD).progress = .3; slot(busy, COUNTER).fire = .5; slot(busy, RETURN).count = 2;
  busy.players[1].held = make(busy, 'dirty', [], { count: 2 });
  hold(c, food(busy, 'tomato')); place(busy, 0, c.x, c.z, 1, 0); press(busy, 0, 'act');
  const v = view(busy);
  assertSerializable(v);
  assert.equal(v.loose.length, 1); assert.equal(v.loose[0].by, 'p0');
  assert.ok(v.tiles.some(t => t.progress === .3) && v.tiles.some(t => t.fire! > .49) && v.tiles.some(t => t.count === 2));
  assert.equal(v.events.at(-1)?.type, 'throw');
  for (let i = 0; i < EVENT_LIMIT + 10; i++) { press(busy, 1, 'dash'); step(busy, {}, .6); }
  assert.equal(view(busy).events.length, EVENT_LIMIT);
  const ids = view(busy).events.map(e => e.id);
  assert.ok(ids.every((id, i) => !i || id > ids[i - 1]));
});

test('outcome: everyone wins together once anything is served, each chef labelled with a highlight', () => {
  const s = kitchen({ players: 2 }), [a, b] = s.players;
  assert.deepEqual(rules.outcome(s).winners, []);
  s.orders = [order(s, 'salad', 100)];
  hold(a, plate(s, 'salad')); standAt(s, 0, HATCH); press(s, 0, 'grab');
  b.stats.chopped = 4;
  step(s, {}, s.settings.seconds);
  const outcome = rules.outcome(s);
  assert.equal(outcome.complete, true); assert.deepEqual(outcome.winners, ['p0', 'p1']);
  assert.deepEqual(outcome.rows.map(r => [r.score, r.rank, r.label]), [[s.score, 1, '1 served'], [s.score, 1, '4 chopped']]);
  const frozen = JSON.stringify(view(s));
  step(s, { p0: { x: 1 } }, 1);
  assert.equal(JSON.stringify(view(s)), frozen, 'a complete round no longer changes');
});

test('same seed and inputs give identical rounds', () => {
  const run = () => {
    const s = setup(null, { players: 4, seed: 99 }), roll = random(5), inputs: Record<string, Partial<Input>> = {};
    for (let t = 0; t < 40 * 60; t++) {
      if (t % 15 === 0) for (const c of s.players) inputs[c.id] = { x: roll() * 2 - 1, y: roll() * 2 - 1, act: roll() < .2, cmd: (['grab', 'act', 'dash'] as const)[Math.floor(roll() * 3)], seq: c.seq + 1 };
      step(s, inputs);
    }
    return JSON.stringify(view(s));
  };
  assert.equal(run(), run());
});

// ── End to end ──────────────────────────────────────────────────────────────
/** Scripted chef: fetch, chop, cook and plate `recipe` using only walking inputs and taps. */
function cookAndServe(s: State, recipe: RecipeId) {
  const tiles = s.map.tiles, c = s.players[0], score = s.score;
  const reachable = (i: number) => s.map.tiles.some(t => WALKABLE.has(t.kind) && Math.abs(t.col - tiles[i].col) + Math.abs(t.row - tiles[i].row) === 1);
  const where = (test: (i: number) => boolean) => tiles.filter(t => test(t.index) && reachable(t.index)).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0].index;
  const empty = (kind: string) => where(i => tiles[i].kind === kind && !s.slots[i].item && s.slots[i].fire <= 0);
  const chop = (name: Ingredient) => {
    walkTo(s, 0, where(i => tiles[i].ingredient === name)); press(s, 0, 'grab');
    const board = empty('board');
    walkTo(s, 0, board); press(s, 0, 'grab'); press(s, 0, 'act');
    step(s, {}, 2.3);
    assert.equal(s.slots[board].item?.parts[0].state, 'chopped');
    press(s, 0, 'grab');
  };
  walkTo(s, 0, where(i => tiles[i].kind === 'rack' && s.slots[i].count > 0)); press(s, 0, 'grab');
  const plateAt = empty('counter');
  walkTo(s, 0, plateAt); press(s, 0, 'grab');
  const cooked = RECIPES[recipe].parts.filter(p => p.state === 'cooked'), pot = cooked.length ? where(i => s.slots[i].item?.kind === 'pot') : -1;
  for (const p of cooked) { chop(p.food); walkTo(s, 0, pot); press(s, 0, 'grab'); }
  for (const p of RECIPES[recipe].parts.filter(p => p.state !== 'cooked')) {
    if (p.state === 'chopped') chop(p.food); else { walkTo(s, 0, where(i => tiles[i].ingredient === p.food)); press(s, 0, 'grab'); }
    walkTo(s, 0, plateAt); press(s, 0, 'grab');
  }
  if (pot >= 0) {
    step(s, {}, POT_SECONDS);
    walkTo(s, 0, plateAt); press(s, 0, 'grab');
    walkTo(s, 0, pot); press(s, 0, 'grab');
  } else { walkTo(s, 0, plateAt); press(s, 0, 'grab'); }
  assert.equal(matchRecipe(H(c)), recipe);
  walkTo(s, 0, where(i => tiles[i].kind === 'serve')); press(s, 0, 'grab');
  assert.equal(H(c), null); assert.equal(s.recipeCounts[recipe], 1); assert.ok(s.score > score);
}

test('end to end: a salad from crate to hatch on level 0, then a soup on a custom kitchen', () => {
  const s = setup(null, { players: 2 }), first = s.orders[0].recipe;
  assert.ok(RECIPES[first].parts.every(p => p.state !== 'cooked'), `level 0 opens with a prep-only dish (${first})`);
  cookAndServe(s, first);
  assert.equal(last(s, 'serve')?.recipe, first);
  const soup = setup(['#tt#C#OO#', 'R.......H', '#.@...@.#', 'D.......W', '####X####'], { level: { recipes: ['tomato_soup'], patience: 120 } });
  cookAndServe(soup, 'tomato_soup');
});

/** Runs bots through a whole service and returns the finished state. */
function service(s: State) {
  for (let guard = 0; !s.complete && guard < 300 * 60; guard++) {
    const v = view(s);
    rules.tick(s, new Map(s.players.map(c => [c.id, botInput(v, s.map, c.id)])), DT, s.now + DT * 1000);
  }
  return s;
}

test('two bots serve several orders in a 180 s service on level 0', () => {
  const s = service(setup(null, { players: 2, seed: 21 }));
  assert.ok(s.served >= 3, `served ${s.served}, failed ${s.failed}, score ${s.score}`);
});

test('two bots cook and serve soup on a pot kitchen', () => {
  const rows = ['#tt#CC#OO#', 'R........H', 'E.@....@.#', 'D........W', '####X#####'];
  const s = service(setup(rows, { players: 2, seed: 5, level: { recipes: ['tomato_soup'], patience: 90 } }));
  assert.ok(s.served >= 2, `served ${s.served}, failed ${s.failed}`);
});
