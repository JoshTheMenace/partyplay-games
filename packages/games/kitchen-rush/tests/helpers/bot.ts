// Kitchen Rush crew bot for balance sims, stress tests and live QA. It reads only the public View and answers with a
// phone-style Input. Every bot derives the same crew plan from the View (order demands → tasks → nearest free chef), so
// a crew splits the work without talking: no two bots chase one ingredient, crowd one board or claim one free counter.
import {
  BURN_WARN, CHOPPABLE, RECIPES, SURFACES, WALK_SPEED, WALKABLE, cookSeconds, matchRecipe, neutral, tileAt,
  type Chef, type Command, type Ingredient, type Input, type Item, type KitchenMap, type Order, type Part, type TileKind, type View,
} from '../../src/model';

const key = (part: Part) => `${part.food}:${part.state}`;
/** Raw dough on a plate is a pizza base on its way to the oven, so it counts as the recipe's baked dough. */
const norm = (part: Part): Part => part.food === 'dough' && part.state === 'raw' ? { food: 'dough', state: 'cooked' } : part;
const rawDough = (item: Item) => item.parts.some(part => part.food === 'dough' && part.state === 'raw');
const burnt = (item: Item) => item.parts.some(part => part.state === 'burnt');
const cookedAll = (item: Item) => item.parts.length > 0 && item.parts.every(part => part.state === 'cooked');

/** Parts of `recipe` still missing from `have`, or null when `have` is not a sub-multiset of the recipe. */
export function missing(recipe: readonly Part[], have: readonly Part[]): Part[] | null {
  const left = [...recipe];
  for (const part of have) {
    const i = left.findIndex(other => key(other) === key(part));
    if (i < 0) return null;
    left.splice(i, 1);
  }
  return left;
}

// ── Navigation: cached flow fields ──────────────────────────────────────────
/** Walk graph for one gate state. Stepping onto a portal pad lands on its pair, so an edge is [landing, tile to steer at]. */
type Nav = { ok: boolean[]; edges: [number, number][][]; back: number[][]; fields: Map<number, number[]> };
const navs = new WeakMap<KitchenMap, Nav[]>();
function around(map: KitchenMap, index: number): number[] {
  const { col, row } = map.tiles[index], out: number[] = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (col + dc >= 0 && row + dr >= 0 && col + dc < map.cols && row + dr < map.rows) out.push((row + dr) * map.cols + col + dc);
  return out;
}
function nav(map: KitchenMap, gates: boolean): Nav {
  let pair = navs.get(map);
  if (!pair) navs.set(map, pair = [false, true].map(open => {
    const ok = map.tiles.map(tile => tile.kind === 'gate' ? open : WALKABLE.has(tile.kind));
    const edges = map.tiles.map(tile => ok[tile.index] ? around(map, tile.index).filter(j => ok[j]).map(j => [map.tiles[j].pair ?? j, j] as [number, number]) : []);
    const back = map.tiles.map((): number[] => []);
    edges.forEach((list, i) => list.forEach(([land]) => back[land].push(i)));
    return { ok, edges, back, fields: new Map() };
  }));
  return pair[+gates];
}
/** Steps from every tile to a standing spot beside `goal` (never a portal pad; a drawbridge only when nothing else fits). */
function field(map: KitchenMap, gates: boolean, goal: number): number[] {
  const n = nav(map, gates);
  let f = n.fields.get(goal);
  if (!f) n.fields.set(goal, f = spread(map, n, goal));
  return f;
}
/** Breadth-first steps to the goal's standing spots over the walk graph, avoiding `blocked` tiles. */
function spread(map: KitchenMap, n: Nav, goal: number, blocked: ReadonlySet<number> = new Set()): number[] {
  const beside = around(map, goal).filter(i => n.ok[i] && map.tiles[i].kind !== 'portal' && !blocked.has(i)), calm = beside.filter(i => map.tiles[i].kind !== 'gate');
  const queue = calm.length ? calm : beside, dist = map.tiles.map(() => Infinity);
  for (const i of queue) dist[i] = 0;
  for (let h = 0; h < queue.length; h++) for (const i of n.back[queue[h]]) if (dist[i] === Infinity && !blocked.has(i)) { dist[i] = dist[queue[h]] + 1; queue.push(i); }
  return dist;
}
const pocketMaps = new WeakMap<KitchenMap, number[]>();
/** Which walkable pocket each tile belongs to with the bridges up (-1 for everything else). */
function pockets(map: KitchenMap): number[] {
  let id = pocketMaps.get(map);
  if (id) return id;
  const n = nav(map, false), ids = map.tiles.map(() => -1);
  let next = 0;
  for (const start of map.tiles) if (n.ok[start.index] && ids[start.index] < 0) {
    const queue = [start.index];
    ids[start.index] = next;
    for (let h = 0; h < queue.length; h++) for (const [land] of n.edges[queue[h]]) if (ids[land] < 0) { ids[land] = next; queue.push(land); }
    next++;
  }
  pocketMaps.set(map, ids);
  return ids;
}
/** Walking steps to use `goal`; with the bridges up, a crossing costs the wait. */
const steps = (map: KitchenMap, safe: boolean, here: number, goal: number) => {
  const closed = safe ? Infinity : field(map, false, goal)[here];
  return closed < Infinity ? closed : field(map, true, goal)[here] + (safe ? 0 : 12);
};

/**
 * Another chef. Chefs with `priority` (or `busy` working) block tiles; this bot sidesteps them and backs out of the way
 * of a moving one. Lower-priority chefs are left to step aside, which breaks the mirror-image dance of two polite bots.
 */
type Point = { x: number; z: number; vx?: number; vz?: number; priority?: boolean; busy?: boolean };
/** `dash` marks a clear straight run of at least three tiles ahead, already faced. */
type Way = { x: number; y: number; ready: boolean; reachable: boolean; dash?: boolean };

/**
 * Steering toward a standing spot beside `goal`, then facing it; `ready` once the chef targets the goal. Follows the flow
 * field (portals included), sidesteps occupied tiles, brakes early on ice, never steps onto a drawbridge that is closed or
 * about to close (`warning`) and hurries off one it stands on. A `shy` chef that is stuck against another backs off.
 */
export function travel(map: KitchenMap, gatesOpen: boolean, me: Pick<Chef, 'x' | 'z' | 'target'> & Partial<Pick<Chef, 'vx' | 'vz' | 'fx' | 'fz'>>, goal: number, others: readonly Point[] = [], warning = false, shy = false): Way {
  if (me.target === goal) return { x: 0, y: 0, ready: true, reachable: true };
  const here = tileAt(map, me.x, me.z)!.index, safe = gatesOpen && !warning, onGate = !safe && map.tiles[here].kind === 'gate';
  const closed = safe ? undefined : field(map, false, goal), useClosed = !!closed && closed[here] < Infinity;
  const n = nav(map, !useClosed), f = useClosed ? closed! : field(map, true, goal);
  if (f[here] === Infinity && !onGate) return { x: 0, y: 0, ready: false, reachable: false };
  const occupied = new Set(others.filter(o => o.priority !== false || o.busy).map(o => tileAt(map, o.x, o.z)!.index));
  const ice = map.tiles[here].kind === 'ice';
  let to = map.tiles[here], final = true;
  if (onGate) { // Off the bridge now: nearest solid neighbour, preferring the way to the goal.
    const off = around(map, here).filter(j => WALKABLE.has(map.tiles[j].kind) && map.tiles[j].kind !== 'gate').sort((a, b) => field(map, true, goal)[a] - field(map, true, goal)[b])[0];
    if (off === undefined) return { x: 0, y: 0, ready: false, reachable: true };
    to = map.tiles[off]; final = false;
  } else if (to.pair !== undefined && f[here] === f[to.pair] + 2 && Math.hypot(me.x - to.x, me.z - to.z) > .3 && (me.vx ?? 0) * (to.x - me.x) + (me.vz ?? 0) * (to.z - me.z) >= 0) {
    final = false; // Walked onto a pad we mean to use: carry on to its centre. A chef that just landed is walking off it.
  } else if (f[here] > 0) {
    // A crewmate on the direct route: detour around occupied tiles when that is not much longer. Checking the whole route
    // keeps neighbouring tiles agreeing on the choice, so a chef does not flip between detour and direct route.
    let g = f, at = here;
    while (f[at] > 0) {
      const step = n.edges[at].reduce<[number, number] | undefined>((a, e) => !a || f[e[0]] < f[a[0]] ? e : a, undefined);
      if (!step) break;
      if (occupied.has(step[1])) { const d = spread(map, n, goal, new Set([...occupied].filter(j => j !== here))); if (d[here] <= f[here] + 8) g = d; break; }
      at = step[0];
    }
    let best: [number, number] | undefined, cost = g[here] + 1; // sidestep an occupied tile only without losing ground
    for (const [land, via] of n.edges[here]) {
      const c = g[land] + (occupied.has(via) ? 2.5 : 0);
      if (c < cost) { best = [land, via]; cost = c; }
    }
    best ??= n.edges[here].reduce<[number, number] | undefined>((a, e) => !a || f[e[0]] < f[a[0]] ? e : a, undefined);
    if (!best || (!safe && map.tiles[best[1]].kind === 'gate')) return { x: 0, y: 0, ready: false, reachable: true }; // wait at the bridge
    to = map.tiles[best[1]]; final = f[best[0]] === 0 && best[0] === best[1];
  } else if (Math.hypot(me.x - to.x, me.z - to.z) < (ice ? .3 : .22)) { // On the spot: turn to face the goal.
    const g = map.tiles[goal], dx = g.x - me.x, dz = g.z - me.z, d = Math.hypot(dx, dz) || 1;
    return { x: dx / d * .3, y: dz / d * .3, ready: false, reachable: true };
  }
  const dx = to.x - me.x, dz = to.z - me.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
  const left = final ? d : d + f[here];
  let speed = final ? Math.min(1, .35 + d) : 1;
  if (ice) speed = Math.min(speed, Math.sqrt(10 * left) / WALK_SPEED);
  let side = 0;
  for (const o of others) {
    const ox = o.x - me.x, oz = o.z - me.z, od = Math.hypot(ox, oz);
    if (od < 1e-6 || od > .9 || (ox * ux + oz * uz) / od < .3) continue;
    const stuck = shy && Math.hypot(me.vx ?? 0, me.vz ?? 0) < .6 && (ox * ux + oz * uz) / od > .5;
    if (od < .75 && (stuck || (o.priority && Math.hypot(o.vx ?? 0, o.vz ?? 0) > .5))) { // Back off; at a dead end, step sideways.
      const bx = -ox / od, bz = -oz / od, open = (x: number, z: number) => { const t = tileAt(map, me.x + x * .6, me.z + z * .6); return !!t && n.ok[t.index]; };
      const [x, y] = open(bx, bz) ? [bx, bz] : open(-bz, bx) ? [-bz, bx] : open(bz, -bx) ? [bz, -bx] : [bx, bz];
      return { x, y, ready: false, reachable: true };
    }
    side = Math.max(side, 1.4 * (.9 - od) / .9 + .3);
  }
  const sl = Math.hypot(ux - uz * side, uz + ux * side);
  let x = (ux - uz * side) / sl * speed, y = (uz + ux * side) / sl * speed;
  if (ice) { x += x - (me.vx ?? 0) / WALK_SPEED; y += y - (me.vz ?? 0) / WALK_SPEED; } // cancel drift
  const l = Math.max(1, Math.hypot(x, y));
  return { x: x / l, y: y / l, ready: false, reachable: true, dash: !final && !side && f[here] >= 4 && straight(map, n, f, here, occupied, me) };
}
/** Three straight steps down the flow field from `here`, clear of chefs, ice and portals, in the direction the chef faces. */
function straight(map: KitchenMap, n: Nav, f: number[], here: number, occupied: ReadonlySet<number>, me: { fx?: number; fz?: number }) {
  let at = here, dc = 0, dr = 0;
  for (let i = 0; i < 3; i++) {
    const step = n.edges[at].find(([land, via]) => land === via && f[land] === f[at] - 1 && !occupied.has(land) && map.tiles[land].kind === 'floor');
    if (!step) return false;
    const c = map.tiles[step[0]].col - map.tiles[at].col, r = map.tiles[step[0]].row - map.tiles[at].row;
    if (i && (c !== dc || r !== dr)) return false;
    [dc, dr, at] = [c, r, step[0]];
  }
  return dc * (me.fx ?? 0) + dr * (me.fz ?? 0) > .95 && map.tiles[here].kind === 'floor';
}

// ── Crew plan ───────────────────────────────────────────────────────────────
/** An item on a tile (chef -1) or in a chef's hands (tile -1). */
type Ref = { item: Item; tile: number; chef: number };
/** One open order: its plate and pot/pan (if any) and what the plate still lacks. Only `active` builds fetch ingredients. */
type Build = { order: Order; rank: number; active: boolean; plate?: Ref; box?: Ref; cook?: Ingredient; need: Part[]; boxNeed: number };
/** One ingredient an active build still needs delivered, matched to a food item already in play when there is one. */
type Demand = { build: Build; food: Ingredient; state: 'raw' | 'chopped'; into: 'plate' | 'box'; supply?: Ref };
type Task = { tiles: number[]; cmd: Command; hold: boolean; prio: number; rank: number; done?: boolean };
/** `yield` overrides steering while this chef moves with a knot of crewmates. */
type Goal = { tile: number; cmd: Command; hold: boolean; yield?: { x: number; y: number } };
type Crew = { id: string; index: number; here: number; held: Item | null };

/** Task priorities: lower runs first; within one priority the oldest order wins. */
const P = { fire: 0, serve: 1, rescue: 1, pour: 2, urgentWash: 2, bake: 2, binBurnt: 2, prep: 3, plate: 4, fetch: 5, wash: 6, tidy: 6, stove: 7 };

function crewPlan(view: View, map: KitchenMap): Map<string, Goal> {
  const { tiles } = map, plan = new Map<string, Goal>(), claimed = new Set<number>(), safe = view.gatesOpen && !view.gateWarning;
  const states = new Map(view.tiles.map(state => [state.at, state]));
  const itemAt = (i: number) => states.get(i)?.item, fire = (i: number) => (states.get(i)?.fire ?? 0) > 0, kind = (i: number) => tiles[i].kind;
  const of = (test: (i: number) => boolean) => tiles.filter(tile => test(tile.index)).map(tile => tile.index);
  const kinds = (...list: TileKind[]) => of(i => list.includes(kind(i)));
  const crew: Crew[] = view.players.flatMap((chef, index) => chef.connected && !chef.respawnAt ? [{ id: chef.id, index, here: tileAt(map, chef.x, chef.z)!.index, held: chef.held }] : []);
  const dist = (c: Crew, goal: number) => steps(map, safe, c.here, goal);
  const nearest = (c: Crew, list: number[], bias: (i: number) => number = () => 0) => {
    let best = -1, bestD = Infinity;
    for (const i of list) { const d = dist(c, i) + bias(i); if (d < bestD) { best = i; bestD = d; } }
    return best;
  };
  const manhattan = (a: number, b: number) => Math.abs(tiles[a].col - tiles[b].col) + Math.abs(tiles[a].row - tiles[b].row);
  const free = (i: number) => !itemAt(i) && !fire(i) && !claimed.has(i);
  const fires = of(fire), hatches = kinds('serve'), bins = kinds('bin'), racks = kinds('rack'), sinks = kinds('sink'), boards = kinds('board');
  const rackCount = racks.reduce((sum, i) => sum + (states.get(i)?.count ?? 0), 0);
  const next = (i: number) => { const d = tiles[i].dir, col = tiles[i].col + (d?.x ?? 0), row = tiles[i].row + (d?.z ?? 0), j = row * map.cols + col; return d && col >= 0 && row >= 0 && col < map.cols && row < map.rows && SURFACES.has(kind(j)) ? j : -1; };
  const beltEnd = (i: number) => { let j = i; for (let n = 0; kind(j) === 'belt' && next(j) >= 0 && n < tiles.length; n++) j = next(j); return j; };
  /** Food riding a belt that can still move is in transit: nobody grabs it. */
  const riding = (i: number) => kind(i) === 'belt' && next(i) >= 0 && !itemAt(next(i));

  // Everything in play, then the builds (open orders, oldest first) and the plates and pots assigned to them.
  const refs: Ref[] = view.tiles.filter(state => state.item && !fire(state.at)).map(state => ({ item: state.item!, tile: state.at, chef: -1 }));
  for (const c of crew) if (c.held) refs.push({ item: c.held, tile: -1, chef: c.index });
  const own = (c: Crew) => refs.find(ref => ref.chef === c.index)!;
  const used = new Set<Ref>(), active = Math.min(view.orders.length, Math.max(2, crew.length + 1));
  const pick = (list: Ref[], score: (ref: Ref) => number) => list.filter(ref => !used.has(ref)).sort((a, b) => score(b) - score(a))[0];
  const builds: Build[] = view.orders.map((order, rank) => {
    const recipe = RECIPES[order.recipe].parts;
    const plate = pick(refs.filter(ref => ref.item.kind === 'plate' && !burnt(ref.item) && missing(recipe, ref.item.parts.map(norm))), ref => ref.item.parts.length);
    if (plate) used.add(plate);
    const need = plate ? missing(recipe, plate.item.parts.map(norm))! : [...recipe], cooked = need.filter(part => part.state === 'cooked' && part.food !== 'dough');
    const cook = cooked[0]?.food, boxKind = cook === 'patty' ? 'pan' : 'pot';
    const box = cook && pick(refs.filter(ref => ref.item.kind === boxKind && ref.item.parts.length <= cooked.length && ref.item.parts.every(part => part.food === cook && part.state !== 'burnt')),
      ref => ref.item.parts.length * 4 + ref.item.cook / 10 + (ref.tile >= 0 && kind(ref.tile) === 'stove' ? 1 : 0));
    if (box) used.add(box);
    return { order, rank, active: rank < active, plate, box: box || undefined, cook, need, boxNeed: box ? cooked.length - box.item.parts.length : 0 };
  });
  const demands: Demand[] = [];
  for (const build of builds.filter(b => b.active)) {
    for (const part of build.need) if (part.state === 'chopped' || part.food === 'bun' || part.food === 'dough') demands.push({ build, food: part.food, state: part.state === 'chopped' ? 'chopped' : 'raw', into: 'plate' });
    for (let i = 0; i < build.boxNeed; i++) demands.push({ build, food: build.cook!, state: 'chopped', into: 'box' });
  }
  // Match loose food to demands: exact state first, then raw food that still needs chopping. Held food is committed, so it goes first.
  const foods = refs.filter(ref => ref.item.kind === 'food' && !burnt(ref.item)).sort((a, b) => b.chef - a.chef), supplied = new Map<Ref, Demand>();
  for (const exact of [true, false]) for (const d of demands) if (!d.supply) {
    const ref = foods.find(r => !supplied.has(r) && r.item.parts[0].food === d.food && (exact ? r.item.parts[0].state === d.state : d.state === 'chopped' && r.item.parts[0].state === 'raw'));
    if (ref) { d.supply = ref; supplied.set(ref, d); }
  }
  const dest = (d: Demand) => (d.into === 'box' ? d.build.box : d.build.plate)?.tile ?? -1;
  const boxReady = (b: Build) => !!b.box && b.boxNeed === 0 && b.box.item.cook >= cookSeconds(b.box.item.kind) - 4;
  const boxes = refs.filter(ref => ref.tile >= 0 && (ref.item.kind === 'pot' || ref.item.kind === 'pan') && !burnt(ref.item));
  const wanted = (box: Item) => view.orders.some(order => missing(RECIPES[order.recipe].parts, box.parts));
  /** A plate on a tile that a cooked pot or pan could be poured onto, one pour per plate. */
  const pours = new Set<number>(), plateFor = (box: Item) => builds.find(b => (b.plate?.tile ?? -1) >= 0 && !pours.has(b.plate!.tile) && kind(b.plate!.tile) !== 'oven' && missing(b.need, box.parts));

  const go = (tile: number, cmd: Command = 'grab', hold = false, claim = false): Goal | undefined => {
    if (tile < 0) return undefined;
    if (claim) claimed.add(tile);
    return { tile, cmd, hold };
  };
  /** A free counter (or other surface kind) near the chef, nudged toward `toward`. */
  const putDown = (c: Crew, list: TileKind[] = ['counter'], toward = -1) => go(nearest(c, of(i => list.includes(kind(i)) && free(i)), i => toward >= 0 ? manhattan(i, toward) * .6 : 0), 'grab', false, true);
  const hatch = hatches[0] ?? -1;

  // Chefs already holding something: the held item decides the goal.
  function holding(c: Crew, held: Item): Goal | undefined {
    const ref = own(c), bin = () => go(nearest(c, bins));
    switch (held.kind) {
      case 'extinguisher': return fires.length ? go(nearest(c, fires), 'act', true) : putDown(c);
      case 'dirty': return go(nearest(c, sinks.filter(i => !fire(i) && (!itemAt(i) || itemAt(i)!.kind === 'dirty'))));
      case 'pot': case 'pan': {
        if (burnt(held)) return bin();
        if (cookedAll(held)) { const b = plateFor(held); if (b) pours.add(b.plate!.tile); return b ? go(b.plate!.tile) : putDown(c); }
        return go(nearest(c, of(i => kind(i) === 'stove' && free(i))), 'grab', false, true) ?? putDown(c);
      }
      case 'plate': {
        const recipe = matchRecipe(held);
        if (recipe && view.orders.some(order => order.recipe === recipe)) return go(nearest(c, hatches));
        const build = builds.find(b => b.plate === ref);
        if (!build) return held.parts.length ? bin() : go(nearest(c, racks));
        if (!build.need.length) return go(nearest(c, of(i => kind(i) === 'oven' && free(i))), 'grab', false, true) ?? putDown(c, ['counter'], nearest(c, kinds('oven')));
        // Ready sources first; an empty plate takes any cooked pot or pan an order wants.
        const sources: number[] = [];
        for (const part of build.need) {
          if (part.state === 'chopped') sources.push(...foods.filter(r => r.tile >= 0 && !claimed.has(r.tile) && !riding(r.tile) && key(r.item.parts[0]) === key(part)).map(r => r.tile));
          else if (part.food === 'bun' || part.food === 'dough') sources.push(...of(i => tiles[i].ingredient === part.food));
        }
        sources.push(...boxes.filter(r => cookedAll(r.item) && (missing(build.need, r.item.parts) || (!held.parts.length && wanted(r.item)))).map(r => r.tile));
        const box = build.box && build.box.tile >= 0 ? build.box.tile : -1;
        return go(nearest(c, sources), 'grab', false, true) ?? (boxReady(build) ? go(box) : putDown(c, ['counter'], box >= 0 && build.box!.item.parts.length ? box : hatch));
      }
      case 'food': {
        const part = held.parts[0], demand = supplied.get(ref);
        if (part.state === 'burnt' || !demand) return bin();
        if (part.state === 'raw' && CHOPPABLE.includes(part.food)) return go(nearest(c, boards.filter(free)), 'grab', false, true) ?? putDown(c, ['counter'], nearest(c, boards));
        // No drop-off for its own demand (say the plate is in someone's hands): serve another demand for the same food.
        const to = [demand, ...demands.filter(d => d.food === demand.food && d.state === demand.state)].map(dest).find(i => i >= 0) ?? -1;
        return to < 0 ? putDown(c) : belt(c, to) ?? go(to);
      }
    }
  }
  /** Hand food to a crewmate over a belt when that saves a real walk. */
  function belt(c: Crew, to: number): Goal | undefined {
    const direct = dist(c, to);
    for (const i of kinds('belt')) {
      const end = beltEnd(i);
      if (end === i || !free(i) || itemAt(end) || dist(c, i) + 3 >= direct || manhattan(end, to) + 2 >= direct) continue;
      if (crew.some(o => o !== c && dist(o, end) + 2 < direct)) return go(i, 'grab', false, true);
    }
  }
  for (const c of crew) if (c.held) { const goal = holding(c, c.held); if (goal) plan.set(c.id, goal); }
  for (const chef of view.players) if (chef.work === 'chop' || chef.work === 'wash') claimed.add(chef.target);

  // Tasks for empty hands.
  const tasks: Task[] = [];
  const add = (list: number | number[], prio: number, rank = 0, cmd: Command = 'grab', hold = false) => {
    const open = [list].flat().filter(i => i >= 0 && !claimed.has(i));
    if (open.length) tasks.push({ tiles: open, cmd, hold, prio, rank });
  };
  if (fires.length && !crew.some(c => c.held?.kind === 'extinguisher'))
    refs.filter(ref => ref.item.kind === 'extinguisher' && ref.tile >= 0).slice(0, fires.length > 2 ? 2 : 1).forEach(ref => add(ref.tile, P.fire));
  for (const ref of refs) if (ref.tile >= 0) {
    const item = ref.item, recipe = matchRecipe(item), heater = kind(ref.tile) === 'stove' || kind(ref.tile) === 'oven';
    if (recipe && view.orders.some(order => order.recipe === recipe)) add(ref.tile, P.serve);
    else if (burnt(item)) add(ref.tile, P.binBurnt);
    else if (heater && (kind(ref.tile) === 'oven' ? !rawDough(item) : cookedAll(item)) && item.cook >= cookSeconds(item.kind) + BURN_WARN / 2) add(ref.tile, P.rescue);
    else if ((item.kind === 'pot' || item.kind === 'pan') && !heater && item.parts.length && !cookedAll(item)) add(ref.tile, P.prep);
    else if (item.kind === 'plate' && item.parts.length && !builds.some(b => b.plate === ref)) add(ref.tile, P.tidy);
    else if ((item.kind === 'pot' || item.kind === 'pan') && !heater && !item.parts.length && of(i => kind(i) === 'stove' && free(i)).length) add(ref.tile, P.stove);
  }
  for (const box of boxes) { const b = cookedAll(box.item) && plateFor(box.item); if (b) { pours.add(b.plate!.tile); add(box.tile, P.pour, b.rank); } }
  for (const b of builds) {
    const plateTile = b.plate?.tile ?? -1;
    if (plateTile >= 0 && kind(plateTile) !== 'oven' && !b.need.length && rawDough(b.plate!.item)) add(plateTile, P.bake, b.rank);
  }
  for (const [ref, d] of supplied) {
    if (ref.tile < 0 || riding(ref.tile)) continue;
    const part = ref.item.parts[0];
    if (part.state === 'raw' && CHOPPABLE.includes(part.food)) {
      if (kind(ref.tile) === 'board') add(ref.tile, P.prep, d.build.rank, 'act');
      else if (boards.some(free)) add(ref.tile, P.prep, d.build.rank);
    } else if (dest(d) >= 0 && dest(d) !== ref.tile) add(ref.tile, P.prep, d.build.rank);
  }
  let plates = rackCount;
  for (const b of builds) if (b.active && !b.plate && plates > 0) {
    const wants = b.need.some(part => part.food === 'bun' || part.food === 'dough') || boxReady(b)
      || demands.some(d => d.build === b && d.into === 'plate' && d.supply?.item.parts[0].state === 'chopped');
    if (wants) { add(racks.filter(i => (states.get(i)?.count ?? 0) > 0), P.plate, b.rank); plates--; }
  }
  const lowPlates = rackCount < 2 && builds.some(b => b.active && !b.plate);
  for (const i of sinks) if (itemAt(i)?.kind === 'dirty' && !fire(i)) add(i, lowPlates ? P.urgentWash : P.wash, 0, 'act');
  if (sinks.some(i => !itemAt(i) && !fire(i))) add(kinds('return').filter(i => (states.get(i)?.count ?? 0) > 0), lowPlates ? P.urgentWash : P.wash);
  // Fetch only as much raw food as the free boards can take.
  let room = boards.filter(free).length + 1 - foods.filter(r => r.item.parts[0].state === 'raw' && CHOPPABLE.includes(r.item.parts[0].food) && (r.tile < 0 || kind(r.tile) !== 'board')).length;
  for (const d of demands) if (!d.supply && d.state === 'chopped' && room-- > 0) add(of(i => tiles[i].ingredient === d.food), P.fetch, d.build.rank);
  if (room <= 0) for (const ref of foods) if (ref.tile >= 0 && kind(ref.tile) === 'board' && !supplied.has(ref)) add(ref.tile, P.tidy); // clear a board of leftovers

  // Nearest free chef per task, most urgent first: work reachable now, then work across a raised bridge. The last chef on
  // the side of a cooking heater stays on that side. Urgent work nobody can take makes the nearest busy chef put its load down.
  tasks.sort((a, b) => a.prio - b.prio || a.rank - b.rank);
  const idle = crew.filter(c => !c.held && view.players[c.index].work === 'none');
  const blocked = (c: Crew, i: number) => !safe && field(map, false, i)[c.here] === Infinity;
  const pocket = pockets(map), sides = (i: number) => around(map, i).map(j => pocket[j]).filter(p => p >= 0), guard = new Map<Crew, number>();
  if (tiles.some(tile => tile.kind === 'gate')) for (const ref of refs) if (ref.tile >= 0 && (kind(ref.tile) === 'stove' || kind(ref.tile) === 'oven') && ref.item.parts.length && !burnt(ref.item)) {
    const near = crew.filter(c => sides(ref.tile).includes(pocket[c.here]));
    if (near.length === 1) guard.set(near[0], pocket[near[0].here]);
  }
  const allowed = (c: Crew, i: number, wait: boolean) => !claimed.has(i) && (wait || !blocked(c, i)) && (!guard.has(c) || sides(i).includes(guard.get(c)!));
  for (const wait of [false, true]) for (const task of tasks) if (!task.done) {
    let who: Crew | undefined, tile = -1, best = Infinity;
    for (const c of idle) if (!plan.has(c.id)) for (const i of task.tiles) { const d = dist(c, i); if (d < best && allowed(c, i, wait)) { who = c; tile = i; best = d; } }
    if (who) { task.done = true; plan.set(who.id, go(tile, task.cmd, task.hold, true)!); }
  }
  const dropping = new Set<Crew>();
  for (const task of tasks) if (!task.done && task.prio <= P.rescue) {
    const busy = crew.filter(c => c.held && c.held.kind !== 'extinguisher' && c.held.kind !== 'plate' && !dropping.has(c) && !blocked(c, task.tiles[0]))
      .sort((a, b) => dist(a, task.tiles[0]) - dist(b, task.tiles[0]))[0];
    if (busy) { dropping.add(busy); const goal = putDown(busy); if (goal) plan.set(busy.id, goal); }
  }
  untangle(view, map, crew, plan, safe);
  return plan;
}

/**
 * Chains of three or more touching chefs cannot be sorted out pair by pair. In such a knot the lowest-index chef that wants
 * to move leads, and every member heading against it (or idling in front of it, even in a pair) steps sideways out of its
 * line, or backs along its heading in a one-wide corridor, until the knot opens.
 */
function untangle(view: View, map: KitchenMap, crew: Crew[], plan: Map<string, Goal>, safe: boolean) {
  const chef = (c: Crew) => view.players[c.index], ok = nav(map, safe).ok, open = (x: number, z: number) => { const t = tileAt(map, x, z); return !!t && ok[t.index]; };
  const moving = crew.filter(c => chef(c).work === 'none'), seen = new Set<Crew>();
  const want = new Map(moving.map(c => { const goal = plan.get(c.id); return [c, goal ? travel(map, safe, chef(c), goal.tile) : { x: 0, y: 0 }]; }));
  for (const start of moving) if (!seen.has(start)) {
    const knot = [start];
    seen.add(start);
    for (let h = 0; h < knot.length; h++) for (const c of moving) if (!seen.has(c) && Math.hypot(chef(c).x - chef(knot[h]).x, chef(c).z - chef(knot[h]).z) < .8) { seen.add(c); knot.push(c); }
    const lead = knot.sort((a, b) => a.index - b.index).find(c => Math.hypot(want.get(c)!.x, want.get(c)!.y) > .5);
    if (knot.length < 2 || !lead) continue;
    const d = want.get(lead)!, dl = Math.hypot(d.x, d.y), ux = d.x / dl, uz = d.y / dl, L = chef(lead);
    for (const c of knot) {
      const w = want.get(c)!, m = chef(c), ahead = (m.x - L.x) * ux + (m.z - L.z) * uz > .2;
      if (c === lead || (plan.has(c.id) ? knot.length < 3 || w.x * ux + w.y * uz >= 0 : !ahead)) continue; // idle chefs clear the way too
      const lean = Math.sign((m.x - L.x) * -uz + (m.z - L.z) * ux) || 1;
      const way = [[-uz * lean, ux * lean], [uz * lean, -ux * lean], [ux, uz]].find(([sx, sz]) => open(m.x + sx * .7, m.z + sz * .7));
      if (way) plan.set(c.id, { ...(plan.get(c.id) ?? { tile: -1, cmd: 'grab', hold: false }), yield: { x: way[0], y: way[1] } });
    }
  }
}

// ── Input ───────────────────────────────────────────────────────────────────
const plans = new WeakMap<View, Map<string, Goal>>();
/** The crew plan for a view (goal tile, command and any yield per chef id); handy for QA overlays and traces. */
export function crewGoals(view: View, map: KitchenMap): ReadonlyMap<string, Goal> {
  let plan = plans.get(view);
  if (!plan) plans.set(view, plan = crewPlan(view, map));
  return plan;
}
/** How well a bot plays: `speed` scales its walking (1 = full stick), `dash` lets it dash on long straight runs. */
export type BotSkill = { speed?: number; dash?: boolean };
/** A slower, dash-free crew used as a stand-in for casual human players when checking order patience. */
export const CASUAL: BotSkill = { speed: .7, dash: false };
/** One tick of bot input. Pass the latest public view; the bot acknowledges commands through `Chef.seq`. */
export function botInput(view: View, map: KitchenMap, id: string, skill: BotSkill = {}): Input {
  const input = play(view, map, id, skill.dash ?? true), k = skill.speed ?? 1;
  return k === 1 ? input : { ...input, x: input.x * k, y: input.y * k };
}
function play(view: View, map: KitchenMap, id: string, dash: boolean): Input {
  const index = view.players.findIndex(chef => chef.id === id), me = view.players[index];
  if (!me || !me.connected || me.respawnAt || me.work === 'chop' || me.work === 'wash') return neutral();
  const goal = crewGoals(view, map).get(id), others = view.players.flatMap((chef, i) => chef === me || chef.respawnAt ? [] : [{ ...chef, priority: i < index, busy: chef.work !== 'none' }]);
  const here = tileAt(map, me.x, me.z)!;
  if (goal?.yield) return { ...neutral(), x: goal.yield.x, y: goal.yield.y };
  if (!goal) { // Idle: just keep off a closing drawbridge.
    if (here.kind !== 'gate' || (view.gatesOpen && !view.gateWarning)) return neutral();
    const off = around(map, here.index).find(j => WALKABLE.has(map.tiles[j].kind) && map.tiles[j].kind !== 'gate');
    const dx = off === undefined ? 0 : map.tiles[off].x - me.x, dz = off === undefined ? 0 : map.tiles[off].z - me.z, d = Math.hypot(dx, dz) || 1;
    return { ...neutral(), x: dx / d, y: dz / d };
  }
  // Knots of stuck chefs untie because each backs off in its own time slots (a stateless, Ethernet-style backoff).
  const way = travel(map, view.gatesOpen, me, goal.tile, others, view.gateWarning, Math.floor(view.now / 350 + index * 1.37) % 3 === 0);
  if (!way.ready) return dash && way.dash && !me.dashing ? { ...neutral(), x: way.x, y: way.y, cmd: 'dash', seq: me.seq + 1 } : { ...neutral(), x: way.x, y: way.y };
  const spraying = goal.hold && me.work === 'spray';
  return { x: 0, y: 0, act: goal.hold, cmd: spraying ? null : goal.cmd, seq: spraying ? me.seq : me.seq + 1 };
}
