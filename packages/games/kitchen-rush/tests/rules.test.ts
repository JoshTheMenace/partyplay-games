import { assertSerializable } from '../../../party-contract/src/serializable';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, walkable, type State } from '../src/server';
import { KITCHENS, RECIPES, layout, neutral, recipeFor, type Food, type Input, type Item, type Station } from '../src/model';
const create = (count = 2, kitchen = 0, practice = false) => rules.create({ roomId: 'kitchen', roundId: 'round', nowMs: 1000, seed: 42, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Chef-${i}-LongName`, color: '#abcdef' })) }, { kitchen, seconds: 180, practice });
function tick(state: State, inputs: Record<string, Input> = {}, seconds = 1 / 60) { const steps = Math.ceil(seconds * 60); for (let i = 0; i < steps; i++) rules.tick(state, new Map(Object.entries(inputs)), seconds / steps, state.now + seconds * 1000 / steps); }
function food(id: number, kind: Food['kind'], stage: Food['stage'] = 'raw'): Item { return { id, kind: 'food', food: [{ kind, stage }], dirty: false }; }
function at(state: State, station: Station, player = 0) { const chef = state.players[player]; const positions = [[0, 1.3], [0, -1.3], [1.3, 0], [-1.3, 0]]; for (const [dx, dz] of positions) if (walkable(state, station.x + dx, station.z + dz)) { chef.x = station.x + dx; chef.z = station.z + dz; chef.facingX = -dx / 1.3; chef.facingZ = -dz / 1.3; return chef; } throw new Error(`No approach to ${station.id}`); }
function use(state: State, player = 0, held = false) { const chef = state.players[player]; tick(state, { [chef.id]: { ...neutral(), command: 'use', seq: chef.commandSeq + 1, use: held } }); }
const station = (state: State, kind: Station['kind']) => state.stations.find(s => s.kind === kind)!;
test('full-floor disconnect cycles cannot issue new food; clearing an item reopens crates',()=>{
  const state=create(),chef=at(state,station(state,'crate'));
  state.loose=Array.from({length:80},(_,i)=>({item:food(1000+i,'tomato'),x:0,z:0,vx:0,vz:0,flight:0}));
  const nextId=state.nextId;
  for(let i=0;i<20;i++){use(state);assert.equal(chef.held,null);rules.onPresenceChange(state,chef.id,false,state.now);rules.onPresenceChange(state,chef.id,true,state.now);}
  assert.equal(state.loose.length,80);assert.equal(state.nextId,nextId);assert.match(chef.feedback,/Floor full/);
  chef.x=0;chef.z=0;use(state);assert.ok(chef.held);assert.equal(state.loose.length,79);
  at(state,station(state,'bin'));use(state);assert.equal(chef.held,null);
  at(state,station(state,'crate'));use(state);assert.equal((chef.held as Item|null)?.id,nextId);
  rules.onPresenceChange(state,chef.id,false,state.now);assert.equal(state.loose.length,80);assert.equal(chef.held,null);
});
test('tossed bun and cheese stay raw and can be recovered from a chopping board',()=>{
  for(const kind of ['bun','cheese'] as const){
    const state=create(2,4),chef=state.players[0],board=station(state,'board');
    at(state,state.stations.find(s=>s.ingredient===kind)!);use(state);const id=chef.held!.id;
    at(state,board);use(state);assert.equal(board.item,null);assert.equal(chef.held!.id,id);
    chef.x=board.x+4.4;chef.z=board.z;chef.facingX=-1;chef.facingZ=0;assert.ok(walkable(state,chef.x,chef.z));
    tick(state,{p0:{...neutral(),command:'toss',seq:chef.commandSeq+1}});tick(state,{},.6);
    assert.equal((board.item as Item|null)?.id,id);at(state,board);tick(state,{p0:{...neutral(),use:true}},3);
    assert.equal((board.item as Item|null)!.food[0].stage,'raw');use(state);assert.equal(chef.held!.id,id);assert.equal(chef.held!.food[0].stage,'raw');assert.equal(board.item,null);
  }
});
test('settings and malformed inputs reject without coercion', () => { assert.deepEqual(rules.validateSettings({}), { kitchen: 0, seconds: 180, practice: false }); for (const invalid of [{ seconds: 5 }, { kitchen: 10 }, { practice: 'yes' }, { other: 1 }]) assert.throws(() => rules.validateSettings(invalid)); for (const input of [null, {}, { ...neutral(), x: NaN }, { ...neutral(), seq: -1 }, { ...neutral(), command: 'serve' }]) assert.throws(() => rules.parseInput(input)); const parsed = rules.parseInput({ ...neutral(), x: 1, y: 1 }); assert.ok(Math.hypot(parsed.x, parsed.y) <= 1); });
test('all kitchens at every roster have clear spawns, no overlapping stations and an approach to every station', () => { for (let count = 1; count <= 10; count++) for (let kitchen = 0; kitchen < KITCHENS.length; kitchen++) { const state = create(count, kitchen); for (const chef of state.players) assert.ok(walkable(state, chef.x, chef.z), `${count}/${kitchen} ${chef.id}`); for (const a of state.stations) { at(state, a); for (const b of state.stations) if (a !== b) assert.ok(Math.abs(a.x - b.x) >= 1.8 || Math.abs(a.z - b.z) >= 1.8, `${count}/${kitchen}: ${a.id} overlaps ${b.id}`); } } });
test('one acknowledged command transfers once across repeats, neutral release and old replay', () => { const state = create(), crate = station(state, 'crate'), chef = at(state, crate); const command = { ...neutral(), command: 'use' as const, seq: 1 }; tick(state, { p0: command }); const id = chef.held!.id; tick(state, { p0: command }, .2); assert.equal((chef.held as Item | null)?.id, id); tick(state); tick(state, { p0: command }); assert.equal((chef.held as Item | null)?.id, id); assert.equal(chef.commandSeq, 1); });
test('two queued commands with separate acks both execute, stale seq cannot undo a newer command', () => { const state = create(), chef = at(state, station(state, 'crate')); use(state); const first = chef.held!.id; tick(state, { p0: { ...neutral(), command: 'drop', seq: 2 } }); assert.equal(state.loose[0].item.id, first); tick(state, { p0: { ...neutral(), command: 'use', seq: 1 } }); assert.equal(chef.held, null); use(state); assert.equal((chef.held as Item | null)?.id, first); });
test('chopping preserves interrupted work and two chefs cannot speed it up', () => { const state = create(), board = station(state, 'board'); board.item = food(100, 'tomato'); at(state, board); at(state, board, 1); tick(state, { p0: { ...neutral(), use: true }, p1: { ...neutral(), use: true } }, 1); assert.ok(board.progress > .4 && board.progress < .43); const progress = board.progress; tick(state, {}, 1); assert.equal(board.progress, progress); tick(state, { p1: { ...neutral(), use: true } }, 1.5); assert.equal(board.item.food[0].stage, 'chopped'); assert.equal(state.players[1].worked, 1); });
test('station contention conserves its single item', () => { const state = create(), board = station(state, 'board'); board.item = food(100, 'lettuce', 'chopped'); at(state, board); at(state, board, 1); tick(state, { p0: { ...neutral(), command: 'use', seq: 1 }, p1: { ...neutral(), command: 'use', seq: 1 } }); assert.equal(state.players.filter(p => p.held?.id === 100).length, 1); assert.equal(board.item, null); });
test('complete salad: crates, chopping, plate assembly, exact service, dirty return and wash', () => { const state = create(), chef = state.players[0], board = station(state, 'board'), counter = station(state, 'counter'); at(state, station(state, 'plates')); use(state); const plate = chef.held!; at(state, counter); use(state); for (const kind of ['lettuce', 'tomato'] as const) { at(state, state.stations.find(s => s.ingredient === kind)!); use(state); at(state, board); use(state, 0, true); tick(state, { p0: { ...neutral(), use: true } }, 2.5); use(state); at(state, counter); use(state); } assert.equal(counter.item?.id, plate.id); assert.equal(recipeFor(counter.item)?.id, 'salad'); use(state); at(state, station(state, 'serve')); use(state); assert.equal(state.served, 1); assert.ok(state.score >= 80); assert.equal(chef.held, null); use(state); assert.equal(state.served, 1); tick(state, {}, 5.1); assert.equal(state.dirtyPlates, 1); at(state, station(state, 'return')); use(state); assert.equal((chef.held as Item | null)?.id, plate.id); assert.equal((chef.held as Item | null)?.dirty, true); at(state, station(state, 'sink')); use(state, 0, true); tick(state, { p0: { ...neutral(), use: true } }, 2.6); use(state); assert.equal((chef.held as Item | null)?.dirty, false); assert.equal((chef.held as Item | null)?.id, plate.id); });
test('every recipe is exact, rejects partial/wrong/duplicate components and serves oldest matching ticket', () => { const state = create(4, 3), chef = at(state, station(state, 'serve')); for (const recipe of RECIPES) { chef.held = { id: 200, kind: 'plate', food: structuredClone(recipe.parts), dirty: false }; state.tickets = [{ id: 5, recipe: recipe.id, createdAt: state.now, expiresAt: state.now + 90000 }, { id: 6, recipe: recipe.id, createdAt: state.now, expiresAt: state.now + 90000 }]; use(state); assert.equal(state.tickets[0].id, 6); } assert.equal(state.served, 4); chef.held = { id: 201, kind: 'plate', food: [...RECIPES[0].parts, RECIPES[0].parts[0]], dirty: false }; use(state); assert.equal(state.served, 4); assert.ok(chef.held); });
test('stove cooks, burns, catches fire, extinguishes, and burnt food can be disposed', () => { const state = create(2,1), stove = station(state, 'stove'), chef = at(state, stove); chef.held = food(100, 'patty'); use(state); tick(state, {}, 6.1); assert.equal(stove.item!.food[0].stage, 'cooked'); tick(state, {}, 10); assert.equal(stove.item!.food[0].stage, 'burnt'); tick(state, {}, 5); assert.equal(stove.fire, 1); assert.equal(state.fires, 1); tick(state, { p0: { ...neutral(), use: true } }, 2.1); assert.equal(stove.fire, 0); use(state); at(state, station(state, 'bin')); use(state); assert.equal(chef.held, null); assert.equal(state.waste, 1); });
test('practice retains tickets and cooked food but still completes on time', () => { const state = create(2, 2, true), stove = station(state, 'stove'); stove.item = food(100, 'patty'); tick(state, {}, 110); assert.equal(stove.item.food[0].stage, 'cooked'); assert.equal(stove.fire, 0); assert.equal(state.missed, 0); assert.equal(state.hazard, 'calm'); rules.tick(state, new Map(), 1 / 60, state.endsAt); assert.equal(rules.outcome(state).complete, true); assert.equal(rules.outcome(state).winners.length, 0); });
test('disconnect drops held items once, preserves cooking, and reconnect keeps acknowledged sequence', () => { const state = create(2,1), chef = state.players[0]; chef.held = food(100, 'tomato'); chef.commandSeq = 22; station(state, 'stove').item = food(101, 'patty'); rules.onPresenceChange(state, chef.id, false, state.now); rules.onPresenceChange(state, chef.id, false, state.now); assert.equal(state.loose.length, 1); tick(state, {}, 6.1); assert.equal(station(state, 'stove').item!.food[0].stage, 'cooked'); rules.onPresenceChange(state, chef.id, true, state.now); assert.equal(chef.commandSeq, 22); assert.equal(chef.held, null); });
test('bridge closure telegraphs and safely clears chefs while permanent end crossings remain', () => { const state = create(10, 5), chef = state.players[0]; rules.tick(state, new Map(), 1 / 60, state.startedAt + 14000); assert.equal(state.hazard, 'warning'); chef.x = 0; chef.z = 0; rules.tick(state, new Map(), 1 / 60, state.startedAt + 18000); assert.equal(state.hazard, 'active'); assert.ok(Math.abs(chef.x) > 1.4); assert.equal(walkable(state, 0, 0), false); assert.equal(walkable(state, 0, -state.halfZ + 2.7), true); assert.equal(walkable(state, 0, state.halfZ - 2.7), true); });
test('movement slides at counters, respects bounds and dash recharges', () => { const state = create(), chef = state.players[0]; chef.x = 0; chef.z = 2; tick(state, { p0: { ...neutral(), x: 1, dash: true } }, .3); assert.ok(chef.x > 1.8); const ready = chef.dashReady; tick(state, { p0: { ...neutral(), x: 1, dash: true } }, 1); assert.equal(chef.dashReady, ready); tick(state, { p0: { ...neutral(), x: 1 } }, 20); assert.ok(chef.x < state.halfX); assert.ok(walkable(state, chef.x, chef.z)); });
test('plate disposal clears incorrect food without deleting its clean plate', () => { const state = create(), chef = at(state, station(state, 'bin')); chef.held = { id: 50, kind: 'plate', food: RECIPES[0].parts.slice(), dirty: false }; use(state); assert.equal((chef.held as Item | null)?.id, 50); assert.equal((chef.held as Item | null)?.food.length, 0); });
test('public projection is detached and excludes server-only queue/counters; team ties share rank', () => { const state = create(10); state.served = 2; state.score = 300; const view = rules.publicView(state, { phase: 'playing', nowMs: state.now }); view.players[0].x = 500; assert.notEqual(state.players[0].x, 500); assert.ok(!('returns' in view)); assert.ok(!('nextId' in view)); const result = rules.outcome(state); assert.equal(result.winners.length, 10); assert.ok(result.rows.every(row => row.rank === 1 && row.score === 300)); });
test('ticket expiry never creates submitted orders or negative score', () => { const state = create(); tick(state, {}, 125); assert.equal(state.served, 0); assert.equal(state.missed, 2); assert.equal(state.score, 0); });
test('layouts scale space and workstations for ten chefs', () => { assert.ok(layout(0, 10).length > layout(0, 2).length); assert.equal(create(10).cleanPlates, 12); assert.equal(create(10).tickets.length, 4); });

test('public snapshots satisfy the strict platform serializer at every kitchen and roster', () => { for (const count of [2, 10]) for (let kitchen = 0; kitchen < KITCHENS.length; kitchen++) { const state = create(count, kitchen); for (const phase of ['preparing', 'playing', 'results'] as const) { if (phase === 'results') rules.tick(state, new Map(), 1 / 60, state.endsAt); assert.doesNotThrow(() => assertSerializable(rules.publicView(state, { phase, nowMs: state.now }))); assert.doesNotThrow(() => assertSerializable(rules.playerView(state, state.players[0].id, { phase, nowMs: state.now }))); assert.doesNotThrow(() => assertSerializable(rules.outcome(state))); } } });
test('pizza requires whole-plate oven baking and preserves plate identity', () => { const state = create(2, 4), chef = state.players[0], oven = station(state, 'oven'); chef.held = { id: 100, kind: 'plate', food: [{ kind: 'dough', stage: 'raw' }, { kind: 'tomato', stage: 'chopped' }, { kind: 'cheese', stage: 'raw' }], dirty: false }; assert.equal(recipeFor(chef.held), undefined); at(state, oven); use(state); assert.equal(oven.item?.id, 100); tick(state, {}, 8.1); assert.equal(recipeFor(oven.item)?.id, 'pizza'); use(state); assert.equal((chef.held as Item | null)?.id, 100); assert.equal(oven.item, null); });
test('oven rejects incomplete plates and raw dough cannot bypass baking on a stove', () => { const state = create(2, 4), chef = at(state, station(state, 'oven')); chef.held = { id: 100, kind: 'plate', food: [{ kind: 'dough', stage: 'raw' }], dirty: false }; use(state); assert.equal(station(state, 'oven').item, null); chef.held = food(101, 'dough'); at(state, station(state, 'stove')); use(state); assert.equal(station(state, 'stove').item, null); });
test('conveyor moves each item one station per beat, cannot duplicate or overwrite a full end', () => { const state = create(10, 6), belts = state.stations.filter(s => s.kind === 'belt'); belts[0].item = food(100, 'tomato'); tick(state, {}, 3.1); assert.equal(belts[0].item, null); assert.equal(belts[1].item?.id, 100); belts[2].item = food(101, 'onion'); tick(state, {}, 3.1); assert.equal(belts[1].item?.id, 100); assert.equal((belts[2].item as Item | null)?.id, 101); belts[2].item = null; tick(state, {}, 3.1); assert.equal(belts[1].item, null); assert.equal((belts[2].item as Item | null)?.id, 100); });
test('power change is telegraphed; inactive cookers preserve heat and alternate fairly', () => { const state = create(2, 8), stoves = state.stations.filter(s => s.kind === 'stove'); rules.tick(state, new Map(), 1 / 60, state.startedAt + 15000); assert.equal(state.powerWarning, true); stoves[0].item = food(100, 'patty'); stoves[0].heat = 2; rules.tick(state, new Map(), 1 / 60, state.startedAt + 18000); assert.equal(stoves[0].powered, false); assert.equal(stoves[1].powered, true); assert.equal(stoves[0].heat, 2); tick(state, {}, 2); assert.equal(stoves[0].heat, 2); rules.tick(state, new Map(), 1 / 60, state.startedAt + 36000); assert.equal(stoves[0].powered, true); assert.ok(stoves[0].heat > 2); });
test('scarce-dish stage scales limited stocks for minimum and maximum crews', () => { assert.equal(create(2, 3).cleanPlates, 2); assert.equal(create(10, 3).cleanPlates, 5); assert.equal(create(10, 2).cleanPlates, 12); });
test('finale combines full menu, belts, power and announced wind; practice leaves cookers on', () => { const state = create(10, 9); assert.equal(KITCHENS[9].recipes, 4); assert.equal(state.stations.filter(s => s.kind === 'belt').length, 3); rules.tick(state, new Map(), 1 / 60, state.startedAt + 24000); assert.equal(state.hazard, 'active'); assert.ok(state.stations.some(s => !s.powered)); const practice = create(10, 9, true); rules.tick(practice, new Map(), 1 / 60, practice.startedAt + 24000); assert.equal(practice.hazard, 'calm'); assert.ok(practice.stations.every(s => s.powered)); });
test('disconnect cannot strand a held item when the normal floor-drop cap is reached', () => { const state = create(); state.loose = Array.from({ length: 80 }, (_, i) => ({ item: food(100 + i, 'tomato'), x: 0, z: 0, vx: 0, vz: 0, flight: 0 })); state.players[0].held = food(999, 'onion'); rules.onPresenceChange(state, 'p0', false, state.now); assert.equal(state.players[0].held, null); assert.equal(state.loose.filter(item => item.item.id === 999).length, 1); });
test('each stage has a connected walkable route from spawn to every essential station, including closed bridges', () => {
  for (const count of [2, 10]) for (let kitchen = 0; kitchen < KITCHENS.length; kitchen++) for (const active of [false, true]) {
    const state = create(count, kitchen); if (active) rules.tick(state, new Map(), 1 / 60, state.startedAt + 24000 - (kitchen === 5 ? 5000 : 0));
    const scale = 4, key = (x: number, z: number) => `${x},${z}`, first = state.players[0], queue: [number, number][] = [[Math.round(first.x * scale), Math.round(first.z * scale)]], seen = new Set<string>();
    for (let i = 0; i < queue.length; i++) { const [x, z] = queue[i]; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, name = key(nx, nz); if (!seen.has(name) && walkable(state, nx / scale, nz / scale)) { seen.add(name); queue.push([nx, nz]); } } }
    for (const station of state.stations) assert.ok(queue.some(([x, z]) => Math.hypot(x / scale - station.x, z / scale - station.z) <= 1.72), `${count} chefs / stage ${kitchen + 1} / ${state.hazard}: no route to ${station.id}`);
  }
});
test('busy multi-chef transfers preserve every plate and keep item ownership unique', () => {
  const state = create(10, 9), plateTotal = state.cleanPlates; let random = 7;
  for (let i = 0; i < 1500; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0; const player = random % 10, site = state.stations[(random >>> 8) % state.stations.length]; at(state, site, player); use(state, player, true);
    const items = [...state.players.flatMap(chef => chef.held ? [chef.held] : []), ...state.stations.flatMap(station => station.item ? [station.item] : []), ...state.loose.map(item => item.item), ...state.returns.map(entry => entry.item)];
    assert.equal(new Set(items.map(item => item.id)).size, items.length); assert.equal(items.filter(item => item.kind === 'plate').length + state.cleanPlates, plateTotal);
  }
});
test('tap-place, release, then a fresh hold starts and resumes chopping without picking raw food back up', () => { const state = create(), board = station(state, 'board'), chef = at(state, board); chef.held = food(100, 'tomato'); use(state); assert.equal(chef.held, null); tick(state); use(state, 0, true); assert.equal(chef.held, null); assert.equal(board.item?.id, 100); tick(state, { p0: { ...neutral(), use: true } }, 1); const interrupted = board.progress; tick(state, {}, .3); use(state, 0, true); assert.ok(board.progress > interrupted); tick(state, { p0: { ...neutral(), use: true } }, 1.5); assert.equal(board.item!.food[0].stage, 'chopped'); tick(state); use(state); assert.equal((chef.held as Item | null)?.id, 100); });
test('tap-place, release, then a fresh hold washes a dirty dish; only a clean dish is picked up', () => { const state = create(), sink = station(state, 'sink'), chef = at(state, sink); chef.held = { id: 100, kind: 'plate', food: [], dirty: true }; use(state); tick(state); use(state, 0, true); assert.equal(chef.held, null); tick(state, { p0: { ...neutral(), use: true } }, 2.6); assert.equal(sink.item?.dirty, false); tick(state); use(state); assert.equal((chef.held as Item | null)?.id, 100); });
test('a serve at the ticket deadline is rejected before expiry cleanup and preserves the dish', () => { const state = create(2, 1), chef = at(state, station(state, 'serve')); chef.held = { id: 100, kind: 'plate', food: structuredClone(RECIPES[0].parts), dirty: false }; const deadline = state.tickets[0].expiresAt; rules.tick(state, new Map([['p0', { ...neutral(), command: 'use' as const, seq: 1 }]]), 1 / 60, deadline); assert.equal(state.served, 0); assert.equal(chef.held?.id, 100); assert.equal(state.missed, 2); });
test('serving just before expiry remains valid, and practice accepts its non-expiring tickets', () => { for (const practice of [false, true]) { const state = create(2, 1, practice), chef = at(state, station(state, 'serve')); chef.held = { id: 100, kind: 'plate', food: structuredClone(RECIPES[0].parts), dirty: false }; rules.tick(state, new Map([['p0', { ...neutral(), command: 'use' as const, seq: 1 }]]), 1 / 60, state.tickets[0].expiresAt + (practice ? 100 : -1)); assert.equal(state.served, 1); assert.equal(chef.held, null); } });

test('solo service has a reachable star target, longer ticket patience, results and a fresh replay', () => {
  const solo=create(1), team=create(2);
  assert(solo.thresholds[0]<team.thresholds[0]); assert(solo.tickets[0].expiresAt>team.tickets[0].expiresAt);
  for(let i=0;i<2;i++) { const chef=at(solo,station(solo,'serve')); chef.held={id:100+i,kind:'plate',food:structuredClone(RECIPES[0].parts),dirty:false}; use(solo); }
  assert.equal(solo.served,2); assert(solo.stars>=1);
  rules.tick(solo,new Map(),1/60,solo.endsAt); assert(rules.outcome(solo).complete); assert.equal(create(1).score,0);
});

test('a stationary dash moves along facing for one burst, then stops', () => {
  const state = create(), chef = state.players[0]; chef.x = 0; chef.z = 2; chef.facingX = 1; chef.facingZ = 0;
  tick(state, { p0: { ...neutral(), dash: true } }); tick(state, {}, .4);
  assert.ok(chef.x > 2 && chef.x < 2.4, 'dash covers about 2.24 metres without held movement');
  assert.equal(chef.z, 2); const x = chef.x; tick(state, {}, .3); assert.equal(chef.x, x);
});
test('released dash commands execute once, acknowledge cooldown presses and preserve held food', () => {
  const state = create(), chef = state.players[0]; chef.x = 0; chef.z = 2; chef.facingX = 1; chef.facingZ = 0; chef.held = food(99, 'lettuce');
  const dash = rules.parseInput({ ...neutral(), command: 'dash', seq: 1 });
  tick(state, { p0: dash }, .2); assert.ok(chef.x > 1.1); assert.equal(chef.commandSeq, 1); assert.equal(chef.held?.id, 99);
  const ready = chef.dashReady;
  tick(state, { p0: { ...dash, seq: 2 } }, 1.8); assert.equal(chef.commandSeq, 2); assert.equal(chef.dashReady, ready, 'cooldown taps cannot queue a later dash');
  tick(state, { p0: dash }); assert.equal(chef.dashReady, ready, 'old commands cannot retrigger');
  chef.x = 0; tick(state, { p0: { ...dash, seq: 3 } }); assert.ok(chef.dashReady > ready); assert.ok(chef.x > 0);
});
test('dash normalizes a partial diagonal stick and cannot pass through a counter', () => {
  const state = create(), chef = state.players[0]; chef.x = 0; chef.z = 2;
  tick(state, { p0: { ...neutral(), x: .2, y: -.2, dash: true } }, .1);
  assert.ok(Math.abs(Math.hypot(chef.x, chef.z - 2) - .64) < .001, 'dash speed does not shrink with joystick deflection');
  const board = station(state, 'board'); at(state, board); const x = chef.x, z = chef.z; chef.dashReady = 0; tick(state); tick(state, { p0: { ...neutral(), dash: true } }, .4);
  assert.ok(walkable(state, chef.x, chef.z)); assert.ok(Math.hypot(chef.x - x, chef.z - z) < .3, 'counter blocks the burst');
});

test('disconnect cancels an active dash before the chef returns', () => {
  const state = create(), chef = state.players[0]; chef.x = 0; chef.z = 2; chef.facingX = 1; chef.facingZ = 0;
  tick(state, { p0: { ...neutral(), command: 'dash', seq: 1 } }); const x = chef.x;
  rules.onPresenceChange(state, chef.id, false, state.now); rules.onPresenceChange(state, chef.id, true, state.now);
  tick(state, {}, .4); assert.equal(chef.x, x); assert.equal(chef.dashUntil, 0);
});


test('cook choices are validated and survive round creation without delaying service', () => {
  for (const character of ['chef', 'chef_f', 'cat', 'dog', 'iguana', 'axolotl']) {
    const lobbyChoice = rules.parseLobbyChoice!({ character }, false);
    const state = rules.create({ roomId: 'kitchen', roundId: 'round', seed: 42, nowMs: 1000, players: [{ id: 'p0', name: 'Cook', color: '#abcdef', lobbyChoice }] }, { kitchen: 0, seconds: 180, practice: false });
    assert.equal(state.players[0].character, character);
    assert.equal(state.endsAt - state.startedAt, 180000);
    assertSerializable(rules.publicView(state, { phase: 'playing', nowMs: 1000 }));
  }
  for (const invalid of [{ character: 'unknown' }, { character: 'cat', speed: 99 }, [], 'cat']) assert.throws(() => rules.parseLobbyChoice!(invalid, false));
  assert.equal(create().players[0].character, 'chef');
});
