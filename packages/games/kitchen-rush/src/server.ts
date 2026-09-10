import {chooseRecipe} from './orders';
import type { GameRules } from '../../../party-contract/src/index';
import { choppable, CHOP_SECONDS, COOK_SECONDS, KITCHENS, RADIUS, REACH, SPEED, WASH_SECONDS, dimensions, hasBelt, hasGust, hasPower, layout, neutral, recipeFor, unbakedPizza, type Chef, type Food, type Input, type Item, type Settings, type Station, type View } from './model';
export type State = View & { orderSeed:number; nextId: number; nextOrderAt: number; orderIndex: number; returns: { item: Item; at: number }[]; lastDash: Record<string, boolean>; nextBeltAt: number };
const FLOOR_LIMIT = 80;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function say(state: State, chef: Chef, text: string) { chef.feedback = text; chef.feedbackAt = state.now; }
function event(state: State, text: string) { state.event = text; state.eventAt = state.now; }
function ingredient(state: State, kind: Food['kind']): Item { return { id: state.nextId++, kind: 'food', food: [{ kind, stage: 'raw' }], dirty: false }; }
function drop(state: State, chef: Chef, toss = false, force = false) {
  if (!chef.held) return;
  if (toss && chef.held.kind === 'plate') { say(state, chef, 'Carry plates safely. Drop to put one down.'); return; }
  if (!force && state.loose.length >= FLOOR_LIMIT) { say(state, chef, 'Floor full. Use the food bin.'); return; }
  state.loose.push({ item: chef.held, x: chef.x, z: chef.z, vx: toss ? chef.facingX * 8 : 0, vz: toss ? chef.facingZ * 8 : 0, flight: toss ? .55 : 0 });
  chef.held = null; say(state, chef, toss ? 'Catch!' : 'Placed on the floor');
}
export function target(state: View, chef: Chef): Station | undefined {
  return state.stations.map(station => { const dx = station.x - chef.x, dz = station.z - chef.z, distance = Math.hypot(dx, dz); return { station, distance, score: distance - (dx * chef.facingX + dz * chef.facingZ) * .08 }; }).filter(item => item.distance <= REACH).sort((a, b) => a.score - b.score || a.station.id.localeCompare(b.station.id))[0]?.station;
}
function transfer(state: State, chef: Chef, station: Station) {
  if (station.fire > 0) { say(state, chef, chef.held ? 'Set food down, then hold Use to extinguish' : 'Hold Use to extinguish'); return; }
  if (station.kind === 'crate') { if (!chef.held) { if (state.loose.length >= FLOOR_LIMIT) { say(state, chef, 'Floor full. Pick up or bin dropped food before taking more.'); return; } chef.held = ingredient(state, station.ingredient!); say(state, chef, 'Ingredient ready'); } else say(state, chef, 'Your hands are full'); return; }
  if (station.kind === 'plates') { if (!chef.held && state.cleanPlates > 0) { state.cleanPlates--; chef.held = { id: state.nextId++, kind: 'plate', food: [], dirty: false }; } else if (chef.held?.kind === 'plate' && !chef.held.food.length && !chef.held.dirty) { chef.held = null; state.cleanPlates++; } else say(state, chef, 'Wash returned dishes for more plates'); return; }
  if (station.kind === 'return') { if (!chef.held && state.dirtyPlates > 0) { const returned = state.returns.find(entry => entry.at <= state.now); if (returned) { state.returns.splice(state.returns.indexOf(returned), 1); chef.held = returned.item; state.dirtyPlates--; } } else say(state, chef, 'Dirty dishes return five seconds after serving'); return; }
  if (station.kind === 'bin') { if (chef.held) { if (chef.held.food.length) state.waste++; if (chef.held.kind === 'plate') { chef.held.food = []; say(state, chef, 'Plate emptied'); } else { chef.held = null; say(state, chef, 'Food cleared'); } } return; }
  if (station.kind === 'serve') {
    const recipe = recipeFor(chef.held), ticket = recipe && state.tickets.find(t => t.recipe === recipe.id && (state.settings.practice || t.expiresAt > state.now));
    if (!ticket || !recipe) { say(state, chef, recipe ? 'No active order needs this dish. Keep it for the next ticket.' : 'Needs a clean plate matching an order exactly'); return; }
    state.tickets.splice(state.tickets.indexOf(ticket), 1); state.combo++; const tips = Math.round(30 * clamp((ticket.expiresAt - state.now) / (ticket.expiresAt - ticket.createdAt), 0, 1));
    const earned = recipe.value + tips + Math.min(5, state.combo - 1) * 5; state.score += earned; state.served++; chef.served++; state.recipeCounts[recipe.id] = (state.recipeCounts[recipe.id] ?? 0) + 1;
    const plate = chef.held!; plate.food = []; plate.dirty = true; state.returns.push({ item: plate, at: state.now + 5000 }); chef.held = null;
    event(state, `${recipe.name} served! +${earned}`); say(state, chef, `Served! +${earned}`); state.nextOrderAt = Math.min(state.nextOrderAt, state.now + 1500); return;
  }
  if (station.item && chef.held) {
    const plate = station.item.kind === 'plate' ? station.item : chef.held.kind === 'plate' ? chef.held : null;
    const food = station.item.kind === 'food' ? station.item : chef.held.kind === 'food' ? chef.held : null;
    if (plate && food && !plate.dirty && plate.food.length < 3 && !food.food.some(part => part.stage === 'burnt')) {
      plate.food.push(...food.food); if (plate === chef.held) station.item = null; else chef.held = null; station.progress = 0; station.heat = 0; say(state, chef, 'Added to plate');
    } else say(state, chef, 'Station occupied. Use a clear counter.');
    return;
  }
  if (!chef.held && station.item && ((station.kind === 'board' && choppable(station.item)) || (station.kind === 'sink' && station.item.dirty))) { say(state, chef, 'Hold Use to finish the job'); return; }
  if (!chef.held && station.item) { chef.held = station.item; station.item = null; station.progress = 0; station.heat = 0; say(state, chef, 'Picked up'); return; }
  if (chef.held && !station.item) {
    const food = chef.held.food[0];
    if (station.kind === 'board' && !choppable(chef.held)) { say(state, chef, 'Chop raw vegetables, patty or dough here'); return; }
    if (station.kind === 'stove' && (chef.held.kind !== 'food' || !(food.kind === 'patty' ? ['raw', 'chopped'].includes(food.stage) : food.stage === 'chopped') || ['lettuce', 'bun', 'cheese', 'dough'].includes(food.kind))) { say(state, chef, 'Cook chopped tomato/onion or a raw patty'); return; }
    if (station.kind === 'oven' && !unbakedPizza(chef.held)) { say(state, chef, 'Oven needs a plate of raw dough + chopped tomato + cheese'); return; }
    if (station.kind === 'sink' && (chef.held.kind !== 'plate' || !chef.held.dirty)) { say(state, chef, 'Only dirty plates need washing'); return; }
    station.item = chef.held; chef.held = null; station.progress = 0; station.heat = 0; say(state, chef, station.kind === 'board' || station.kind === 'sink' ? 'Hold Use to finish the job' : 'Placed');
  }
}
function use(state: State, chef: Chef) {
  // A floor item closer than any station wins. Stable array order resolves equal-distance contention.
  const station = target(state, chef), loose = state.loose.filter(item => !item.flight && Math.hypot(item.x - chef.x, item.z - chef.z) < .95).sort((a, b) => Math.hypot(a.x - chef.x, a.z - chef.z) - Math.hypot(b.x - chef.x, b.z - chef.z))[0];
  if (!chef.held && loose && (!station || Math.hypot(loose.x - chef.x, loose.z - chef.z) < Math.hypot(station.x - chef.x, station.z - chef.z) - .2)) { chef.held = loose.item; state.loose.splice(state.loose.indexOf(loose), 1); say(state, chef, 'Picked up from floor'); }
  else if (station) transfer(state, chef, station);
  else if (chef.held) drop(state, chef);
  else say(state, chef, 'Move closer to a station or dropped item');
}
export function walkable(state: View, x: number, z: number) {
  if (Math.abs(x) > state.halfX - RADIUS || Math.abs(z) > state.halfZ - RADIUS) return false;
  if (KITCHENS[state.settings.kitchen].topology === 'bridge' && !state.settings.practice && Math.abs(x) < 1.05 + RADIUS && Math.abs(z) < state.halfZ - 3 && (state.hazard === 'active' || Math.abs(z) > 1.05 - RADIUS)) return false;
  return !state.stations.some(station => Math.abs(x - station.x) < .9 + RADIUS && Math.abs(z - station.z) < .9 + RADIUS);
}
function addTicket(state: State) {
  const recipe = chooseRecipe(state.orderSeed,state.orderIndex++,KITCHENS[state.settings.kitchen].recipes,state.tickets);
  state.tickets.push({ id: state.nextId++, recipe: recipe.id, createdAt: state.now, expiresAt: state.now + (KITCHENS[state.settings.kitchen].patience + (state.players.length === 1 ? 45 : state.players.length > 4 ? 15 : 0)) * 1000 });
}
export const rules: GameRules<State, Input, never, Settings, View, null> = {
  validateSettings(raw) { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Settings must be an object.'); const value = raw as Partial<Settings>; if (Object.keys(value).some(key => !['kitchen', 'seconds', 'practice'].includes(key))) throw new Error('Unknown kitchen setting.'); const settings = { kitchen: value.kitchen ?? 0, seconds: value.seconds ?? 180, practice: value.practice ?? false }; if ((!Number.isInteger(settings.kitchen) || settings.kitchen < 0 || settings.kitchen >= KITCHENS.length) || ![180, 240, 300].includes(settings.seconds) || typeof settings.practice !== 'boolean') throw new Error('Choose a kitchen, 3–5 minute service and practice setting.'); return settings; },
  parseInput(raw) { const value = raw as Input; if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['x', 'y', 'use', 'dash', 'command', 'seq'].includes(key)) || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1 || Math.abs(value.y) > 1 || typeof value.use !== 'boolean' || typeof value.dash !== 'boolean' || ![null, 'use', 'drop', 'toss'].includes(value.command) || !Number.isSafeInteger(value.seq) || value.seq < 0) throw new Error('Invalid kitchen input.'); const length = Math.max(1, Math.hypot(value.x, value.y)); return { ...value, x: value.x / length, y: value.y / length }; },
  neutralInput: neutral, parseAction() { throw new Error('Kitchen Rush uses acknowledged input commands.'); }, applyAction() {},
  create(ctx, settings) {
    const size = dimensions(ctx.players.length), targetScore = Math.round((settings.seconds / 180) * (ctx.players.length === 1 ? 110 : 160 + ctx.players.length * 35) * (1 + settings.kitchen * .09));
    const state: State = { ...size, orderSeed:ctx.seed, settings: { ...settings }, players: ctx.players.map((player, index) => ({ ...player, x: -size.halfX + 2 + index * (2 * size.halfX - 4) / Math.max(1, ctx.players.length - 1), z: size.halfZ - 3, facingX: 0, facingZ: -1, held: null, connected: true, dashUntil: 0, dashReady: 0, worked: 0, served: 0, target: null, feedback: 'Pick up an ingredient. Follow the tickets.', feedbackAt: ctx.nowMs, commandSeq: 0 })), stations: layout(settings.kitchen, ctx.players.length), loose: [], tickets: [], startedAt: ctx.nowMs, endsAt: ctx.nowMs + settings.seconds * 1000, now: ctx.nowMs, complete: false, score: 0, served: 0, missed: 0, waste: 0, fires: 0, combo: 0, cleanPlates: KITCHENS[settings.kitchen].mechanic === 'scarce' ? Math.max(2, Math.ceil(ctx.players.length / 2)) : ctx.players.length + 2, dirtyPlates: 0, thresholds: [targetScore, targetScore * 2, targetScore * 3], stars: 0, event: 'Service open! Follow the first ticket.', eventAt: ctx.nowMs, hazard: 'calm', recipeCounts: {}, powerBank: 0, powerWarning: false, nextId: 1, nextOrderAt: ctx.nowMs + 15000, orderIndex: 0, returns: [], lastDash: {}, nextBeltAt: ctx.nowMs + 3000 };
    for (const chef of state.players) { if (!walkable(state, chef.x, chef.z)) { for (let z = size.halfZ - 2.5; z > -size.halfZ; z -= .5) if (walkable(state, chef.x, z)) { chef.z = z; break; } } }
    for (let i = 0; i < (ctx.players.length > 7 ? 4 : ctx.players.length > 4 ? 3 : 2); i++) addTicket(state);
    return state;
  },
  tick(state, inputs, dt, now) {
    if (state.complete) return; state.now = now;
    if (now >= state.endsAt) { state.complete = true; event(state, state.served ? 'Service complete. Thank you, chefs!' : 'Service complete. No orders served.'); return; }
    const level = KITCHENS[state.settings.kitchen], elapsed = (now - state.startedAt) / 1000, cycle = elapsed % (level.topology === 'bridge' ? 24 : 30), previousHazard = state.hazard;
    state.hazard = state.settings.practice ? 'calm' : level.topology === 'bridge' ? cycle >= 17 ? 'active' : cycle >= 13 ? 'warning' : 'calm' : hasGust(level) ? cycle >= 23 ? 'active' : cycle >= 18 ? 'warning' : 'calm' : 'calm';
    state.powerBank = Math.floor(elapsed / 18) % 2; state.powerWarning = !state.settings.practice && hasPower(level) && elapsed % 18 >= 14;
    state.stations.filter(station => station.kind === 'stove' || station.kind === 'oven').forEach((station, index) => { station.powered = state.settings.practice || !hasPower(level) || index % 2 === state.powerBank; });
    if (level.topology === 'bridge' && state.hazard === 'active' && previousHazard !== 'active') for (const chef of state.players) if (Math.abs(chef.x) < 1.42 && Math.abs(chef.z) < state.halfZ - 3) chef.x = chef.x < 0 ? -1.43 : 1.43;
    if (hasBelt(level) && now >= state.nextBeltAt) { const belts = state.stations.filter(station => station.kind === 'belt'); for (let i = belts.length - 2; i >= 0; i--) if (belts[i].item && !belts[i + 1].item) { belts[i + 1].item = belts[i].item; belts[i].item = null; } state.nextBeltAt = now + 3000; }
    for (const station of state.stations) station.working = false;
    const workers = new Set<string>();
    for (const chef of state.players) {
      if (!chef.connected) continue; const input = inputs.get(chef.id) ?? neutral();
      if (input.dash && !state.lastDash[chef.id] && now >= chef.dashReady) { chef.dashUntil = now + 350; chef.dashReady = now + 1600; } state.lastDash[chef.id] = input.dash;
      const length = Math.hypot(input.x, input.y); if (length > .1) { chef.facingX = input.x / length; chef.facingZ = input.y / length; }
      const gust = hasGust(level) && state.hazard === 'active' && Math.abs(chef.z) < 1.8;
      const speed = (now < chef.dashUntil ? 6.4 : SPEED) * (gust ? .5 : 1), nextX = chef.x + input.x * speed * dt, nextZ = chef.z + input.y * speed * dt;
      if (walkable(state, nextX, chef.z)) chef.x = nextX; if (walkable(state, chef.x, nextZ)) chef.z = nextZ;
      if (input.command && input.seq > chef.commandSeq) { chef.commandSeq = input.seq; if (input.command === 'use') use(state, chef); else drop(state, chef, input.command === 'toss'); }
      const station = target(state, chef); chef.target = station?.id ?? null;
      if (input.use && station && !chef.held && !workers.has(station.id)) {
        workers.add(station.id);
        if (station.fire > 0) { station.working = true; station.fire = Math.max(0, station.fire - dt / 2); if (!station.fire) say(state, chef, 'Fire out. Bin the burnt food.'); }
        else if (station.item && ((station.kind === 'board' && choppable(station.item)) || (station.kind === 'sink' && station.item.dirty))) {
          station.working = true; station.progress = Math.min(1, station.progress + dt / (station.kind === 'board' ? CHOP_SECONDS : WASH_SECONDS));
          if (station.progress >= 1) { if (station.kind === 'board') station.item.food[0].stage = 'chopped'; else station.item.dirty = false; chef.worked++; say(state, chef, station.kind === 'board' ? 'Chopped! Tap Use to collect.' : 'Clean! Tap Use to collect.'); }
        }
      }
    }
    for (const station of state.stations) if ((station.kind === 'stove' || station.kind === 'oven') && station.item && !station.fire && station.powered) {
      const duration = station.kind === 'oven' ? 8 : COOK_SECONDS; station.heat += dt; station.progress = Math.min(1, station.heat / duration);
      if (station.heat >= duration) for (const part of station.item.food) if (part.stage !== 'burnt' && (station.kind === 'stove' || part.kind === 'dough')) part.stage = 'cooked';
      if (!state.settings.practice && station.heat >= duration + 10) for (const part of station.item.food) part.stage = 'burnt';
      if (!state.settings.practice && station.heat >= duration + 15) { station.fire = 1; state.fires++; station.heat = 0; event(state, 'Kitchen fire! Empty your hands and hold Use.'); }
    }
    for (const item of state.loose) if (item.flight > 0) {
      item.x = clamp(item.x + item.vx * dt, -state.halfX + .5, state.halfX - .5); item.z = clamp(item.z + item.vz * dt, -state.halfZ + .5, state.halfZ - .5); item.flight = Math.max(0, item.flight - dt);
      const catcher = state.players.find(chef => chef.connected && !chef.held && Math.hypot(chef.x - item.x, chef.z - item.z) < .55 && item.flight < .42);
      if (catcher) { catcher.held = item.item; state.loose.splice(state.loose.indexOf(item), 1); say(state, catcher, 'Nice catch!'); }
      else if (!item.flight) { const counter = state.stations.find(station => ['counter', 'board', 'belt'].includes(station.kind) && !station.item && Math.hypot(station.x - item.x, station.z - item.z) < 1); if (counter) { counter.item = item.item; state.loose.splice(state.loose.indexOf(item), 1); } else if (!walkable(state, item.x, item.z)) { const points = state.players.filter(chef => Math.hypot(chef.x - item.x, chef.z - item.z) < 6); const near = points.sort((a, b) => Math.hypot(a.x - item.x, a.z - item.z) - Math.hypot(b.x - item.x, b.z - item.z))[0]; if (near) { item.x = near.x; item.z = near.z; } else { item.z = state.halfZ - 3; item.x = clamp(item.x, -state.halfX + 2, state.halfX - 2); } } }
    }
    state.dirtyPlates = state.returns.filter(entry => entry.at <= now).length;
    if (!state.settings.practice) for (const ticket of state.tickets.slice()) if (ticket.expiresAt <= now) { state.tickets.splice(state.tickets.indexOf(ticket), 1); state.missed++; state.combo = 0; state.score = Math.max(0, state.score - 20); event(state, 'Order missed. Fresh tickets are coming.'); }
    const capacity = state.players.length > 7 ? 4 : state.players.length > 4 ? 3 : 2;
    if (now >= state.nextOrderAt && state.tickets.length < capacity) { addTicket(state); state.nextOrderAt = now + 1500; }
    state.stars = state.thresholds.filter(score => state.score >= score).length;
  },
  onPresenceChange(state, id, connected) { const chef = state.players.find(player => player.id === id); if (!chef) return; chef.connected = connected; if (!connected) { drop(state, chef, false, true); state.lastDash[id] = false; } },
  publicView(state) { const { orderSeed:_orderSeed,nextId: _nextId, nextOrderAt: _nextOrderAt, orderIndex: _orderIndex, returns: _returns, lastDash: _lastDash, nextBeltAt: _nextBeltAt, ...view } = state; return structuredClone(view); }, playerView: () => null,
  outcome(state) { return { complete: state.complete, winners: state.served ? state.players.map(player => player.id) : [], rows: state.players.map(player => ({ playerId: player.id, score: state.score, rank: 1, label: `${player.served} served · ${player.worked} jobs` })) }; }, dispose() {},
};
export default rules;
