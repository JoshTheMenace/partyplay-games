import assert from 'node:assert/strict';
import test from 'node:test';
import { B, I, ITEM_LIST, type Slot } from '../src/shared/items';
import { PF, type PrivateView, type PubPlayer, type TradeOffer, type View } from '../src/shared/protocol';
import { awards, bubbles, dayPhase, itemDetails, itemHint, meterIcons, offerState, playerStatus, untilChange, wear, wornArmor } from '../src/client/ui/format';
import { GOALS, nextGoal, parseReached, serializeReached, shelterDue, type GoalContext } from '../src/client/ui/goals';
import { clickButton, stickVector } from '../src/client/ui/input';
import { filterRecipes, ingredientLabel, ingredientSummary, missingText } from '../src/client/ui/recipe-book';
import { recipeById } from '../src/shared/recipes';
import { defaultSettings, loadSettings, store } from '../src/client/store';
import { hud as hudStore } from '../src/client/game/hud';
import { isNightWarning, sanitizeSettings, updateSettings } from '../src/client/ui/state';

const inventory = (...stacks: Slot[]) => [...stacks, ...Array<Slot | null>(36 - stacks.length).fill(null)];
const ctx = (inv: (Slot | null)[], extra: Partial<GoalContext> = {}): GoalContext =>
  ({ inv, day: 0, time: 1000, placed: 0, armor: [null, null, null, null], nether: false, portal: false, village: false, ...extra });
const player = (patch: Partial<PubPlayer>): PubPlayer => ({ id: 'p', name: 'P', color: '#fff', x: 0, y: 70, z: 0, yaw: 0, pitch: 0, held: 0, swing: 0, hurt: 0, health: 20, flags: 0, armor: [0, 0, 0, 0], ...patch });
const pieces = (...ids: number[]) => ids.map(id => ({ id, n: 1 }));

test('meters show ten icons with half steps, bubbles only under water, durability only when worn', () => {
  assert.deepEqual(meterIcons(20), Array(10).fill('full'));
  assert.deepEqual(meterIcons(7).slice(0, 5), ['full', 'full', 'full', 'half', 'empty']);
  assert.deepEqual(meterIcons(0), Array(10).fill('empty'));
  assert.deepEqual(meterIcons(0.4).slice(0, 2), ['half', 'empty'], 'any damage-free sliver still shows');
  assert.equal(bubbles(300), null);
  assert.equal(bubbles(299), 10);
  assert.equal(bubbles(0), 0);
  assert.equal(wear({ id: I.stone_pickaxe, n: 1 }), null);
  assert.equal(wear({ id: B.stone, n: 64, d: 3 }), null, 'blocks never wear');
  assert.ok(Math.abs(wear({ id: I.wooden_pickaxe, n: 1, d: 59 / 2 })! - 0.5) < 1e-9);
});

test('next goal walks the survival progression and never steps backwards', () => {
  const reached = new Set<string>();
  assert.equal(nextGoal(ctx(inventory()), reached)?.id, 'wood');
  assert.equal(nextGoal(ctx(inventory({ id: B.oak_log, n: 3 })), reached)?.id, 'planks');
  assert.equal(nextGoal(ctx(inventory({ id: B.birch_planks, n: 8 })), reached)?.id, 'table');
  assert.equal(nextGoal(ctx(inventory({ id: B.crafting_table, n: 1 })), reached)?.id, 'pickaxe');
  // The table is placed (it leaves the inventory) and the planks spent: the helper remembers.
  assert.equal(nextGoal(ctx(inventory()), reached)?.id, 'pickaxe');
  assert.equal(nextGoal(ctx(inventory({ id: I.wooden_pickaxe, n: 1 })), reached)?.id, 'shelter', 'shelter comes right after the pickaxe');
  assert.equal(nextGoal(ctx(inventory({ id: I.wooden_pickaxe, n: 1 }), { placed: 30 }), reached)?.id, 'stone');
});

test('from dusk on the first night the shelter goal overrides everything until there is shelter progress', () => {
  assert.equal(shelterDue(ctx(inventory(), { time: 10999 })), false);
  assert.equal(shelterDue(ctx(inventory(), { time: 11000 })), true);
  assert.equal(shelterDue(ctx(inventory(), { time: 23500 })), false, 'dawn');
  assert.equal(nextGoal(ctx(inventory(), { time: 14000 }), new Set())?.id, 'shelter', 'even before the first log');
  assert.equal(nextGoal(ctx(inventory({ id: I.iron_ingot, n: 2 }), { time: 12000 }), new Set())?.id, 'shelter');
  assert.equal(nextGoal(ctx(inventory(), { time: 14000, placed: 24 }), new Set())?.id, 'wood', 'walls built');
  assert.equal(nextGoal(ctx(inventory(), { time: 14000 + 24000, day: 1 }), new Set())?.id, 'wood', 'first night survived');
});

test('reached goals belong to one world id and reset for a fresh world', () => {
  const saved = serializeReached('42-abc', new Set(['wood', 'planks']));
  assert.deepEqual([...parseReached(saved, '42-abc')], ['wood', 'planks']);
  assert.equal(parseReached(saved, '42-new').size, 0, 'same seed, new world');
  assert.equal(parseReached('not json', '42-abc').size, 0);
  assert.equal(parseReached(null, '42-abc').size, 0);
  assert.deepEqual([...parseReached('{"world":"w","reached":["wood",3]}', 'w')], ['wood']);
});

test('the server dusk and nightfall toasts are recognised as night warnings', () => {
  assert.ok(isNightWarning('The sun is setting — find or build shelter'));
  assert.ok(isNightWarning('Night falls. Monsters roam in the dark.'));
  assert.ok(!isNightWarning('Everyone is asleep…'));
});

test('later items imply earlier goals, time-based goals are skipped without implying anything', () => {
  assert.equal(nextGoal(ctx(inventory({ id: I.iron_ingot, n: 2 })), new Set())?.id, 'iron_pickaxe');
  assert.equal(nextGoal(ctx(inventory({ id: B.furnace, n: 1 })), new Set())?.id, 'torches', 'later progress skips the shelter step by day');
  assert.equal(nextGoal(ctx(inventory({ id: I.wooden_pickaxe, n: 1 }), { day: 1 }), new Set())?.id, 'stone');
  assert.equal(nextGoal(ctx(inventory({ id: I.diamond_pickaxe, n: 1 })), new Set())?.id, 'portal');
  assert.equal(new Set(GOALS.map(goal => goal.id)).size, GOALS.length);
});

test('after the diamond pickaxe the chain leads through the Nether, then to the optional side goals', () => {
  const pick = inventory({ id: I.diamond_pickaxe, n: 1 }), reached = new Set<string>();
  assert.equal(nextGoal(ctx(pick), reached)?.id, 'portal');
  assert.match(nextGoal(ctx(pick), reached)!.hint, /water onto lava.*4×5.*flint and steel/);
  assert.equal(nextGoal(ctx(pick, { portal: true }), reached)?.id, 'nether', 'standing in a lit portal proves it is built');
  assert.equal(nextGoal(ctx(pick, { nether: true }), reached)?.id, 'quartz');
  assert.equal(nextGoal(ctx(inventory({ id: I.quartz, n: 1 })), reached)?.id, 'village');
  assert.equal(nextGoal(ctx(inventory(), { village: true }), reached)?.id, 'trade');
  reached.add('trade');
  assert.equal(nextGoal(ctx(inventory(), { armor: pieces(I.iron_helmet, I.iron_chestplate, I.iron_leggings, I.leather_boots) }), reached)?.id, 'iron_armor');
  assert.equal(nextGoal(ctx(inventory(), { armor: pieces(I.iron_helmet, I.diamond_chestplate, I.iron_leggings, I.iron_boots) }), reached)?.id, 'lamp', 'diamond is iron or better');
  assert.equal(nextGoal(ctx(inventory({ id: B.redstone_lamp, n: 1 })), reached), null);
  const early = new Set<string>();
  assert.equal(nextGoal(ctx(inventory({ id: B.redstone_lamp, n: 1 }), { village: true }), early)?.id, 'wood', 'side goals never skip the chain');
  assert.ok(early.has('lamp') && early.has('village') && !early.has('planks'), 'but they latch when reached early');
  assert.equal(nextGoal(ctx(inventory({ id: I.quartz, n: 1 })), early)?.id, 'trade', 'and are skipped later');
});

test('redstone items explain themselves in one line; armor shows its points', () => {
  const redstone = ITEM_LIST.filter(item => item.category === 'redstone' && !item.hidden);
  assert.ok(redstone.length >= 14);
  for (const item of redstone) assert.match(itemHint(item.id) ?? '', /^[A-Z][^\n]{8,70}[^.]$/, item.key);
  assert.equal(itemHint(B.lever), 'Toggles power on and off');
  assert.deepEqual(itemDetails({ id: B.lever, n: 1 }), ['Toggles power on and off']);
  assert.deepEqual(itemDetails({ id: I.iron_chestplate, n: 1, d: 40 }), ['+6 armor', 'Durability 200 / 240']);
});

test('trade offers are ready, short or sold out; TV cards read armor, fire and the Nether', () => {
  const offer: TradeOffer = { buy: { id: I.emerald, n: 5 }, buyB: { id: I.book, n: 1 }, sell: { id: B.bookshelf, n: 1 }, left: 3 };
  assert.equal(offerState(offer, inventory({ id: I.emerald, n: 3 }, { id: I.emerald, n: 2 }, { id: I.book, n: 1 })), 'ready', 'counts across stacks');
  assert.equal(offerState(offer, inventory({ id: I.emerald, n: 5 })), 'short');
  assert.equal(offerState({ ...offer, buyB: undefined }, inventory({ id: I.emerald, n: 5 })), 'ready');
  assert.equal(offerState({ ...offer, left: 0 }, inventory({ id: I.emerald, n: 64 }, { id: I.book, n: 9 })), 'sold');
  assert.equal(wornArmor(player({ armor: [I.iron_helmet, I.diamond_chestplate, 0, I.leather_boots] })), 11);
  assert.equal(playerStatus(player({ x: 3700, z: 100, y: 40 })), 'in the nether', 'not caving');
  assert.equal(playerStatus(player({ x: 3700, z: 100, mine: [1, 2, 3, 4] })), 'mining');
  assert.equal(playerStatus(player({ flags: PF.BURNING, mine: [1, 2, 3, 4] })), 'on fire');
});

test('recipe book filters by tab, search, craftability and table access', () => {
  const inv = inventory({ id: B.oak_log, n: 1 }, { id: B.oak_planks, n: 4 });
  const all = filterRecipes(inv, { tab: 'all', query: '', craftableOnly: false, nearTable: false });
  assert.ok(all.length > 40);
  const firstLocked = all.findIndex(entry => !entry.craftable);
  assert.ok(firstLocked > 0 && all.slice(firstLocked).every(entry => !entry.craftable), 'craftable recipes come first');
  const craftable = filterRecipes(inv, { tab: 'all', query: '', craftableOnly: true, nearTable: false }).map(entry => entry.recipe.id);
  assert.ok(craftable.includes('oak_planks') && craftable.includes('stick') && craftable.includes('crafting_table'));
  assert.ok(!craftable.includes('wooden_pickaxe'), '3×3 recipes need a table');
  const tools = filterRecipes(inv, { tab: 'tools', query: '', craftableOnly: false, nearTable: true });
  assert.ok(tools.length && tools.every(entry => entry.recipe.category === 'tools'));
  assert.equal(tools.find(entry => entry.recipe.id === 'wooden_pickaxe')?.needsTable, false);
  const search = filterRecipes(inv, { tab: 'all', query: 'Pickaxe', craftableOnly: false, nearTable: false }).map(entry => entry.recipe.id);
  assert.deepEqual(search, ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe']);
  assert.ok(filterRecipes(inv, { tab: 'all', query: 'coal', craftableOnly: false, nearTable: false }).some(entry => entry.recipe.id === 'torch'), 'search matches ingredients');
  assert.deepEqual(filterRecipes(inv, { tab: 'food', query: 'zzz', craftableOnly: false, nearTable: false }), []);
  const tab = (id: 'redstone' | 'combat' | 'blocks') => filterRecipes(inv, { tab: id, query: '', craftableOnly: false, nearTable: true }).map(entry => entry.recipe.id);
  assert.ok(['lever', 'piston', 'sticky_piston', 'repeater', 'redstone_lamp', 'tnt', 'iron_door'].every(id => tab('redstone').includes(id)), 'redstone tab');
  assert.ok(['iron_chestplate', 'diamond_boots', 'leather_helmet'].every(id => tab('combat').includes(id)), 'armor under combat');
  assert.ok(!tab('blocks').includes('lever'));
});

test('ingredient summaries group alternatives and explain what is missing', () => {
  const pickaxe = recipeById('stone_pickaxe')!, inv = inventory({ id: B.cobblestone, n: 1 }, { id: I.stick, n: 5 });
  assert.deepEqual(ingredientSummary(pickaxe, inv).map(need => [need.n, need.have]), [[3, 1], [2, 5]]);
  assert.equal(missingText(pickaxe, inv, false), '2 × Cobblestone, a crafting table');
  assert.equal(missingText(recipeById('stick')!, inventory({ id: B.spruce_planks, n: 2 }), false), '');
  assert.equal(ingredientLabel([B.oak_planks, B.birch_planks, B.spruce_planks]), 'Any Planks');
  assert.equal(ingredientLabel([I.coal, I.charcoal]), 'Coal or Charcoal');
});

test('slot gestures map to MC click buttons', () => {
  const mouse = (button: number, shift = false) => ({ pointer: 'mouse', button, shift, longPress: false });
  assert.equal(clickButton(mouse(0), false), 0);
  assert.equal(clickButton(mouse(0, true), false), 2);
  assert.equal(clickButton(mouse(2), false), 1);
  assert.equal(clickButton(mouse(1), false), null, 'middle click does nothing');
  assert.equal(clickButton({ pointer: 'touch', button: 0, shift: false, longPress: false }, false), 0);
  assert.equal(clickButton({ pointer: 'touch', button: 0, shift: false, longPress: false }, true), 2, 'quick move toggle = shift');
  assert.equal(clickButton({ pointer: 'touch', button: 0, shift: false, longPress: true }, true), 1, 'long press = split');
  assert.equal(clickButton({ pointer: 'keyboard', button: 0, shift: true, longPress: false }, false), 2);
});

test('joystick has a dead zone, forward is up, and sprints only when pushed forward past the rim', () => {
  assert.deepEqual(stickVector(3, -2, 50).move, [0, 0]);
  const forward = stickVector(0, -50, 50);
  assert.deepEqual(forward.move, [0, 1]);
  assert.equal(forward.sprint, true);
  assert.equal(stickVector(0, -40, 50).sprint, false);
  assert.equal(stickVector(50, 0, 50).sprint, false, 'strafing at the rim does not sprint');
  const far = stickVector(0, 120, 50);
  assert.deepEqual(far.knob, [0, 50], 'knob stays on the rim');
  assert.deepEqual(far.move, [0, -1]);
});

test('settings are clamped, persisted to localStorage and published through the store', () => {
  const data = new Map<string, string>();
  const fake = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
  try {
    assert.deepEqual(sanitizeSettings(defaultSettings(), { fov: 500, sensitivity: -3, renderDistance: 5 as 6 }), { ...defaultSettings(), fov: 110, sensitivity: 0.2, renderDistance: 6 });
    updateSettings({ renderDistance: 8, invertY: true, showGoals: false, fov: 90.4 });
    assert.equal(store.get().settings.renderDistance, 8);
    const saved = JSON.parse(data.get('blockwild.settings')!);
    assert.equal(saved.fov, 90);
    const loaded = loadSettings();
    assert.equal(loaded.invertY, true);
    assert.equal(loaded.showGoals, false);
    assert.equal(loaded.renderDistance, 8);
    data.set('blockwild.settings', '{"renderDistance":7,"fov":"wide","sensitivity":9}');
    assert.deepEqual({ ...loadSettings(), muted: false }, { ...defaultSettings(), muted: false });
    data.set('blockwild.settings', 'not json');
    assert.equal(loadSettings().fov, defaultSettings().fov);
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('journal awards need a minimum, ties share, and a solo player gets at most two titles', () => {
  const entry = (id: string, mined: number, deaths: number) => ({ id, mined, placed: 0, crafted: 0, mobs: 0, deaths, distance: id === 'b' ? 500 : 100 });
  const won = awards([entry('a', 30, 0), entry('b', 30, 2), entry('c', 3, 0)]);
  assert.deepEqual(won.find(a => a.key === 'mined')?.ids, ['a', 'b']);
  assert.equal(won.find(a => a.key === 'placed'), undefined, 'nobody placed anything');
  assert.deepEqual(won.find(a => a.key === 'distance')?.ids, ['b']);
  assert.deepEqual(won.find(a => a.key === 'survivor')?.ids, ['a', 'c']);
  assert.equal(awards([entry('a', 12, 0), entry('b', 12, 0)]).find(a => a.key === 'mined'), undefined, 'below the minimum');
  assert.deepEqual(awards([{ ...entry('b', 60, 0), placed: 40 }]).map(a => a.title), ['Miner', 'Builder']);
  assert.deepEqual(awards([]), []);
});

test('day clock and player status read the public view', () => {
  assert.equal(dayPhase(500), 'dawn');
  assert.equal(dayPhase(6000), 'day');
  assert.equal(dayPhase(12500), 'dusk');
  assert.equal(dayPhase(18000 + 24000 * 3), 'night');
  assert.deepEqual(untilChange(1000), { label: 'Nightfall', minutes: 10 });
  assert.deepEqual(untilChange(22000), { label: 'Dawn', minutes: 1 });
  assert.equal(playerStatus(player({})), 'exploring');
  assert.equal(playerStatus(player({ mine: [1, 2, 3, 4] })), 'mining');
  assert.equal(playerStatus(player({ flags: 4 | 2 })), 'down');
  assert.equal(playerStatus(player({ flags: 32, mine: [1, 2, 3, 4] })), 'offline');
  assert.equal(playerStatus(player({ y: 20 })), 'caving');
});

const view = (players: number): View => ({
  seed: 42, worldId: '42-test', mode: 'survival', difficulty: 'normal', time: 14000, day: 2, revision: 1, edits: [], mobs: [], items: [], arrows: [], fx: [], sleeping: 0,
  stats: { mined: 1234, placed: 56, crafted: 7, mobs: 8, deaths: 1, days: 2 },
  players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Explorer_${String(i).padStart(2, '0')}_long`, color: '#ff5748', x: 0, y: 64, z: 0, yaw: 0, pitch: 0, held: i ? B.torch : 0, swing: 0, hurt: 0, health: 13, flags: i === 3 ? 32 : 0, armor: [0, 0, 0, 0] })),
});
test('views render complete markup for a full roster', async () => {
  const { renderToString: render } = await import('react-dom/server');
  const renderToString = (node: Parameters<typeof render>[0]) => render(node).replace(/<!-- -->/g, '');
  const { createElement } = await import('react');
  // client.tsx imports CSS, which Node cannot load; render the same view modules it wires up.
  const [{ DisplayView }, { ControllerView }, { ResultsView, SettingsView }] = await Promise.all([import('../src/client/ui/display'), import('../src/client/ui/controller'), import('../src/client/ui/lobby')]);
  const client = { DisplayView, ControllerView, ResultsView, SettingsView };
  const base = { roomId: 'r', roundId: 'x', viewRole: 'display' as const, isHost: false, privateView: null, serverNowMs: () => 0, setInput() {}, sendAction: async () => ({ accepted: true }), assetsReady() {} };
  const tv = renderToString(createElement(client.DisplayView, { ...base, playerId: null, publicView: view(10) }));
  assert.equal(tv.match(/class="bw-card"/g)?.length, 10);
  assert.match(tv, /Explorer_09_long/);
  assert.match(tv, /Day 3/);
  assert.match(tv, /data-compact="true"/, 'big rosters use the side column');
  assert.match(renderToString(createElement(client.DisplayView, { ...base, playerId: null, publicView: view(5) })), /data-compact="false"/);
  const pv: PrivateView = { ack: 0, tp: { n: 0, x: 0, y: 0, z: 0 }, imp: { n: 0, vx: 0, vy: 0, vz: 0 }, inv: inventory({ id: I.stone_pickaxe, n: 1, d: 40 }, { id: B.dirt, n: 32 }), cursor: null,
    grid: [null, null, null, null], out: null, screen: null, health: 7, food: 20, saturation: 5, air: 300, dead: false, spawn: [0, 0, 0], mode: 'survival', keepInventory: false, protectedTicks: 40,
    armor: [null, null, null, null], armorPoints: 0, dimension: 'overworld' };
  store.set({ inv: pv.inv });
  const hud = renderToString(createElement(client.ControllerView, { ...base, viewRole: 'controller', playerId: 'p0', publicView: view(2), privateView: pv }));
  assert.equal(hud.match(/bw-slot bw-hot/g)?.length, 9);
  assert.match(hud, /Health 3\.5 of 10 hearts/);
  assert.match(hud, /bw-wear/);
  assert.match(hud, /Protected/);
  const drowning = renderToString(createElement(client.ControllerView, { ...base, viewRole: 'controller', playerId: 'p0', publicView: view(2), privateView: { ...pv, air: 90 } }));
  assert.equal(drowning.match(/bw-sprite-bubble"[^>]*visibility:hidden/g)?.length, 7, 'spent bubbles pop, three remain');
  const asleep = { ...view(2), players: view(2).players.map((p, i) => i ? p : { ...p, flags: 2 }), sleeping: 1 };
  assert.match(renderToString(createElement(client.ControllerView, { ...base, viewRole: 'controller', playerId: 'p0', publicView: asleep, privateView: pv })), /Leave bed/);
  const dead = renderToString(createElement(client.ControllerView, { ...base, viewRole: 'controller', playerId: 'p0', publicView: view(2), privateView: { ...pv, dead: true } }));
  assert.match(dead, /items were dropped/);
  const results = renderToString(createElement(client.ResultsView, { outcome: { complete: true, winners: ['p0'], rows: [{ playerId: 'p0', label: 'Mined 4' }] }, publicView: view(1), playerId: 'p0' }));
  assert.match(results, /2 days in the wild/);
  const settings = renderToString(createElement(client.SettingsView, { settings: { mode: 'survival', seed: 260923, difficulty: 'normal', keepInventory: true }, onChange() {}, disabled: false }));
  assert.match(settings, /value="260923"/);
  const random = renderToString(createElement(client.SettingsView, { settings: { mode: 'survival', seed: 0, difficulty: 'normal', keepInventory: true }, onChange() {}, disabled: false }));
  assert.match(random, /aria-checked="true"[^>]*>Random each world/);
  assert.doesNotMatch(random, /id="bw-seed"/, 'no number field until a fixed seed is chosen');

  // Expansion: HUD armor bar, inventory armor column and preview, trade screen, TV armor and Nether cards.
  const armored: PrivateView = { ...pv, armor: [{ id: I.iron_helmet, n: 1 }, null, null, null], armorPoints: 7 };
  const controller = (privateView: PrivateView) => renderToString(createElement(client.ControllerView, { ...base, viewRole: 'controller', playerId: 'p0', publicView: view(2), privateView }));
  const withArmor = controller(armored);
  assert.match(withArmor, /Armor 7 of 20/);
  assert.equal(withArmor.match(/bw-sprite-armor/g)?.length, 10);
  assert.doesNotMatch(hud, /bw-sprite-armor/, 'no armor bar without armor');
  try {
    store.set({ screen: 'inventory' });
    hudStore.set({ armor: armored.armor });
    const inv = controller(armored);
    assert.equal(inv.match(/aria-label="(Helmet|Chestplate|Leggings|Boots): /g)?.length, 4);
    assert.match(inv, /aria-label="Helmet: Iron Helmet"/);
    assert.match(inv, /aria-label="Boots: empty"/);
    assert.match(inv, /bw-doll-art/);
    store.set({ screen: 'trade', inv: inventory({ id: I.emerald, n: 12 }) });
    hudStore.set({ screen: { kind: 'trade', x: 0, y: 64, z: 0, slots: [], villager: 7, profession: 2, offers: [
      { buy: { id: I.emerald, n: 5 }, sell: { id: I.iron_helmet, n: 1 }, left: 3 },
      { buy: { id: I.emerald, n: 30 }, buyB: { id: I.book, n: 1 }, sell: { id: I.diamond_chestplate, n: 1 }, left: 1 },
      { buy: { id: I.coal, n: 15 }, sell: { id: I.emerald, n: 1 }, left: 0 },
    ] } });
    const trade = controller(armored);
    assert.match(trade, /<h2>Armorer<\/h2>/);
    assert.match(trade, /aria-label="Trade 5 Emerald for 1 Iron Helmet"/);
    assert.match(trade, /3 left/);
    assert.match(trade, /Sold out/);
    assert.equal(trade.match(/<button[^>]*disabled=""/g)?.length, 4, 'short and sold-out offers disable Trade and All');
    assert.equal(trade.match(/data-short="true"/g)?.length, 2, 'both missing payments are marked');
    assert.match(trade, /You have/);
  } finally {
    store.set({ screen: null });
    hudStore.set({ screen: null, armor: [null, null, null, null] });
  }
  const netherView = { ...view(10), players: view(10).players.map((p, i) => i === 1 ? { ...p, x: 3700, z: 50, y: 40, armor: [I.iron_helmet, I.iron_chestplate, I.iron_leggings, I.iron_boots] as PubPlayer['armor'] } : p) };
  const tvNether = renderToString(createElement(client.DisplayView, { ...base, playerId: null, publicView: netherView }));
  assert.match(tvNether, /in the nether/);
  assert.equal(tvNether.match(/data-nether="true"/g)?.length, 1);
  assert.match(tvNether, /aria-label="Armor 15"/);
  assert.equal(tv.match(/bw-card-armor/g), null, 'no armor badge without armor');
});
