/**
 * Redstone simulation on the server. State changes are ordinary cell writes, so they save, sync and
 * render through edits.
 *
 * Model (MC Java, simplified): sources (levers, buttons, plates, lit torches, redstone blocks, powered repeaters) power the
 * components beside them. Solid opaque blocks (not pistons or redstone blocks) conduct: a block is *strongly* powered by
 * a lever/button attached to it, a plate on it, a lit torch under it or a repeater facing it, and *weakly* powered by dust
 * on it or pointing into it (a lone dot points everywhere). A lit torch's other sides power components, never blocks.
 * Consumers (lamps, doors, pistons, tnt) and torch/repeater inputs take either; dust only takes strong block power.
 *
 * Every write lands in `onBlockChanged`, which marks the cell dirty; `tickRedstone` runs due scheduled ticks, presses
 * plates and then re-evaluates the components within two blocks of each dirty cell, in rounds, until nothing changes.
 * Dust recomputes its whole connected network at once (bounded BFS), so power removal never counts down slowly.
 */
import {
  attachedFace, B, blockOf, BUTTON_PRESSED, cellId, cellState, DOOR_OPEN, DOOR_UPPER, isAir, isLiquid, LEVER_ON, makeCell, pistonFacing, PISTON_EXTENDED,
  PISTON_STICKY, PLATE_PRESSED, repeaterDelay, repeaterFacing, REPEATER_POWERED, wirePower, type Shape,
} from '../shared/blocks';
import type { CellReader } from '../shared/chunk';
import { bodyBox, regionCollides } from '../shared/physics';
import { cellIndex, cellXYZ, FACES, FACING_FACE, faceToFacing, inWorld, type Vec3 } from '../shared/coords';
import type { CellWrite } from '../shared/placement';
import { MOB, MOB_TYPES, mobBox } from '../shared/protocol';
import { conducts, isDust, wireLinks, wirePoints, wireShape } from '../shared/redstone';
import { explode, mobState } from './combat';
import { newMob } from './mobs';
import { teleport } from './players';
import { addFx, type Mob, type Player, type State } from './state';
import { breakBlock, isLoaded, settle, writeCell, writeCells } from './world';

/** Redstone server state, created with the world and not saved (loaded edits re-register through onBlockChanged). */
export type RedstoneState = {
  /** Cell index → game tick (`state.ticks`) of its scheduled update (torches, repeaters, buttons, plates, lamps, moving pistons). */
  scheduled: Map<number, number>;
  /** Game tick → cells due then (entries whose `scheduled` tick moved on are skipped). */
  queue: Map<number, number[]>;
  /** Changed cells: components within two blocks re-evaluate. `pulsed`: dust whose power changed (other dust ignores it). */
  dirty: Set<number>; pulsed: Set<number>;
  /** Dirty cells in chunks that were not loaded, retried every second. */
  waiting: Set<number>;
  /** Dust already settled by a network update in the current round. */
  settled: Set<number>;
  /** Lower door halves last seen powered: doors follow power edges only, so players can still use oak doors. */
  doors: Set<number>;
  /** Torch cell → game ticks of its recent toggles; burnt-out torch → the tick it may relight. */
  toggles: Map<number, number[]>; burnt: Map<number, number>;
};
export const newRedstoneState = (): RedstoneState => ({
  scheduled: new Map(), queue: new Map(), dirty: new Set(), pulsed: new Set(), waiting: new Set(), settled: new Set(), doors: new Set(), toggles: new Map(), burnt: new Map(),
});

/** Game ticks: torch inversion (1 redstone tick), lamp switch-off, plate hold after the last touch, stone/oak buttons, tnt fuse. */
const TORCH_DELAY = 2, LAMP_OFF = 4, PLATE_HOLD = 20, TNT_FUSE = 80, RETRY = 20, MOVE_TICKS = 2;
const BUTTON_TICKS: Readonly<Record<number, number>> = { [B.stone_button]: 20, [B.oak_button]: 30 };
/** A torch toggling more than 8 times within 60 ticks burns out for 3 s. */
const BURNOUT_TOGGLES = 8, BURNOUT_WINDOW = 60, BURNOUT_TICKS = 60;
const PUSH_LIMIT = 12, MAX_DUST = 8192, MAX_ROUNDS = 64;

/** Blocks whose change matters to redstone (plus any change of conductivity). */
const COMPONENTS = new Set<number>([B.redstone_wire, B.redstone_torch, B.redstone_torch_off, B.lever, B.stone_button, B.oak_button, B.stone_pressure_plate,
  B.oak_pressure_plate, B.redstone_block, B.redstone_lamp, B.redstone_lamp_lit, B.repeater, B.piston, B.sticky_piston, B.piston_head, B.oak_door, B.iron_door, B.tnt]);
/** Components that react to power (sources only emit). */
const REACTS = new Set<number>([B.redstone_wire, B.redstone_torch, B.redstone_torch_off, B.repeater, B.redstone_lamp, B.redstone_lamp_lit, B.piston, B.sticky_piston,
  B.oak_door, B.iron_door, B.tnt]);
/** Pistons cannot move these (nor extended pistons, unloaded chunks or the world edge). */
const IMMOVABLE = new Set<number>([B.bedrock, B.obsidian, B.chest, B.furnace, B.furnace_lit, B.monster_spawner, B.nether_portal, B.piston_head, B.barrier]);
/** Shapes a push breaks (dropping their items) instead of moving. */
const FRAGILE = new Set<Shape>(['cross', 'crop', 'torch', 'wire', 'lever', 'button', 'plate', 'fire', 'ladder', 'door', 'bed', 'lantern', 'repeater', 'cactus']);
/** Offsets within two steps: everything a change can power directly or through one block. */
const NEAR: readonly Vec3[] = (() => {
  const out: Vec3[] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2) out.push([dx, dy, dz]);
  return out;
})();

const isPiston = (id: number) => id === B.piston || id === B.sticky_piston;
const isPlate = (id: number) => id === B.stone_pressure_plate || id === B.oak_pressure_plate;
const immovable = (cell: number) => IMMOVABLE.has(cellId(cell)) || blockOf(cell).hardness < 0 || isPiston(cellId(cell)) && (cellState(cell) & PISTON_EXTENDED) !== 0;
const fragile = (cell: number) => FRAGILE.has(blockOf(cell).shape);
const boxOf = (mob: Mob) => mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) });
/** Face (0..5) from a redstone torch to the block it hangs on. */
const torchSupport = (state: number) => state === 0 ? 2 : FACING_FACE[(state - 1) & 3]! ^ 1;

// Power ---------------------------------------------------------------------------------------------------------------

/**
 * Power the component `cell` at (x, y, z) sends to its neighbour across `face`. `strong` counts only power that conducts
 * into a solid block: levers and buttons into their support, plates down, lit torches up, powered repeaters forward.
 */
function emits(get: CellReader, cell: number, x: number, y: number, z: number, face: number, strong: boolean): number {
  const s = cellState(cell);
  switch (cellId(cell)) {
    // LEVER_ON and BUTTON_PRESSED are the same bit.
    case B.lever: case B.stone_button: case B.oak_button: return s & LEVER_ON && (!strong || face === (attachedFace(s) ^ 1)) ? 15 : 0;
    case B.stone_pressure_plate: case B.oak_pressure_plate: return s & PLATE_PRESSED && (!strong || face === 2) ? 15 : 0;
    case B.redstone_block: return strong ? 0 : 15;
    case B.redstone_torch: return face === torchSupport(s) || strong && face !== 3 ? 0 : 15;
    case B.repeater: return s & REPEATER_POWERED && face === FACING_FACE[repeaterFacing(s)] ? 15 : 0;
    case B.redstone_wire:
      if (strong || face === 3) return 0;
      return face === 2 || wirePoints(wireShape(get, x, y, z)) >> faceToFacing(face) & 1 ? wirePower(s) : 0;
  }
  return 0;
}
/** Power in the solid block at (x, y, z): strong only, or with `weak` also from dust on it or pointing into it. */
function blockPower(get: CellReader, x: number, y: number, z: number, weak: boolean): number {
  let best = 0;
  for (let f = 0; f < 6 && best < 15; f++) {
    const [dx, dy, dz] = FACES[f]!, nx = x + dx, ny = y + dy, nz = z + dz, n = get(nx, ny, nz);
    best = Math.max(best, emits(get, n, nx, ny, nz, f ^ 1, !(weak && isDust(n))));
  }
  return best;
}
/** Power reaching a component at (x, y, z) through its face `f`. Dust (`dust`) ignores other dust and weakly powered blocks. */
function inputFrom(get: CellReader, x: number, y: number, z: number, f: number, dust = false): number {
  const [dx, dy, dz] = FACES[f]!, nx = x + dx, ny = y + dy, nz = z + dz, n = get(nx, ny, nz);
  if (conducts(n)) return blockPower(get, nx, ny, nz, !dust);
  return dust && isDust(n) ? 0 : emits(get, n, nx, ny, nz, f ^ 1, false);
}
/** Strongest input over every face but `skip` (a piston ignores its front). */
function received(get: CellReader, x: number, y: number, z: number, skip = -1, dust = false): number {
  let best = 0;
  for (let f = 0; f < 6 && best < 15; f++) if (f !== skip) best = Math.max(best, inputFrom(get, x, y, z, f, dust));
  return best;
}
/** What dust at (x, y, z) should carry given its neighbours: its own input, or linked dust − 1. */
const dustTarget = (get: CellReader, x: number, y: number, z: number) =>
  wireLinks(get, x, y, z).reduce((best, [lx, ly, lz]) => Math.max(best, wirePower(cellState(get(lx, ly, lz))) - 1), received(get, x, y, z, -1, true));
const repeaterInput = (get: CellReader, x: number, y: number, z: number, s: number) => inputFrom(get, x, y, z, FACING_FACE[repeaterFacing(s)]! ^ 1) > 0;
const torchWants = (state: State, x: number, y: number, z: number, s: number) =>
  !inputFrom(state.getLoaded, x, y, z, torchSupport(s)) && !((state.redstone.burnt.get(cellIndex(x, y, z)) ?? -1) > state.ticks);

// Scheduling ----------------------------------------------------------------------------------------------------------

/** Run the cell's scheduled update `delay` ticks from now; an already scheduled cell keeps its tick unless `replace`. */
function schedule(state: State, index: number, delay: number, replace = false) {
  const rs = state.redstone;
  if (!replace && rs.scheduled.has(index)) return;
  const at = state.ticks + Math.max(1, delay);
  rs.scheduled.set(index, at);
  const due = rs.queue.get(at);
  if (due) due.push(index);
  else rs.queue.set(at, [index]);
}

/** A scheduled tick: torches invert, repeaters switch, lamps go dark, buttons and plates release, moved pistons settle. */
function run(state: State, index: number) {
  const [x, y, z] = cellXYZ(index), rs = state.redstone;
  if (!isLoaded(state, x, z)) return schedule(state, index, RETRY);
  const get = state.getLoaded, cell = get(x, y, z), id = cellId(cell), s = cellState(cell);
  switch (id) {
    case B.redstone_torch: case B.redstone_torch_off: {
      if ((rs.burnt.get(index) ?? Infinity) <= state.ticks) rs.burnt.delete(index);
      const lit = id === B.redstone_torch;
      if (torchWants(state, x, y, z, s) !== lit && writeCell(state, x, y, z, makeCell(lit ? B.redstone_torch_off : B.redstone_torch, s))) burnout(state, index, lit);
      return;
    }
    case B.repeater: {
      const on = (s & REPEATER_POWERED) !== 0, input = repeaterInput(get, x, y, z, s);
      // Like MC, a pulse shorter than the delay still comes out: an unpowered repeater always switches on, then off.
      if (on && !input) writeCell(state, x, y, z, makeCell(id, s & ~REPEATER_POWERED));
      else if (!on && writeCell(state, x, y, z, makeCell(id, s | REPEATER_POWERED)) && !input) schedule(state, index, repeaterDelay(s) * 2);
      return;
    }
    case B.redstone_lamp_lit: if (!received(get, x, y, z)) writeCell(state, x, y, z, B.redstone_lamp); return;
    case B.stone_button: case B.oak_button:
      if (s & BUTTON_PRESSED && writeCell(state, x, y, z, makeCell(id, s & ~BUTTON_PRESSED))) addFx(state, 'button', x + 0.5, y + 0.5, z + 0.5, 0);
      return;
    case B.stone_pressure_plate: case B.oak_pressure_plate:
      if (s & PLATE_PRESSED && writeCell(state, x, y, z, makeCell(id, s & ~PLATE_PRESSED))) addFx(state, 'button', x + 0.5, y, z + 0.5, 0);
      return;
    case B.piston: case B.sticky_piston: updatePiston(state, x, y, z, cell); return;
  }
}
/** Count a torch toggle; turning off after more than 8 toggles in 60 ticks burns it out for 3 s. */
function burnout(state: State, index: number, turnedOff: boolean) {
  const rs = state.redstone, now = state.ticks, recent = (rs.toggles.get(index) ?? []).filter(at => now - at < BURNOUT_WINDOW);
  recent.push(now);
  rs.toggles.set(index, recent);
  if (!turnedOff || recent.length <= BURNOUT_TOGGLES) return;
  rs.toggles.delete(index);
  rs.burnt.set(index, now + BURNOUT_TICKS);
  schedule(state, index, BURNOUT_TICKS, true);
}

// Reactions -----------------------------------------------------------------------------------------------------------

/** Re-evaluate the component at (x, y, z) after something within two blocks changed. */
function react(state: State, x: number, y: number, z: number) {
  const get = state.getLoaded, cell = get(x, y, z), s = cellState(cell), index = cellIndex(x, y, z);
  switch (cellId(cell)) {
    case B.redstone_wire: return updateDust(state, x, y, z);
    case B.redstone_torch: case B.redstone_torch_off:
      if (torchWants(state, x, y, z, s) !== (cellId(cell) === B.redstone_torch)) schedule(state, index, TORCH_DELAY);
      return;
    case B.repeater: if (repeaterInput(get, x, y, z, s) !== ((s & REPEATER_POWERED) !== 0)) schedule(state, index, repeaterDelay(s) * 2); return;
    case B.redstone_lamp: if (received(get, x, y, z) && writeCell(state, x, y, z, B.redstone_lamp_lit)) addFx(state, 'lamp', x + 0.5, y + 0.5, z + 0.5); return;
    case B.redstone_lamp_lit: if (!received(get, x, y, z)) schedule(state, index, LAMP_OFF); return;
    case B.oak_door: case B.iron_door: return updateDoor(state, x, y, z, cell);
    case B.piston: case B.sticky_piston: return updatePiston(state, x, y, z, cell);
    case B.tnt: if (received(get, x, y, z)) primeTnt(state, x, y, z); return;
  }
}

/**
 * Settle the dust network through (x, y, z). A locally consistent dust is correct (power only falls by one per link),
 * so only an inconsistent one collects its network (≤ 8192 cells), floods power from the inputs and writes the changes.
 */
function updateDust(state: State, x: number, y: number, z: number) {
  const get = state.getLoaded, rs = state.redstone, start = cellIndex(x, y, z);
  if (rs.settled.has(start) || dustTarget(get, x, y, z) === wirePower(cellState(get(x, y, z)))) return;
  const nodes: Vec3[] = [[x, y, z]], ids = new Map([[start, 0]]), links: number[][] = [];
  let overflow = false;
  for (let i = 0; i < nodes.length; i++) {
    const [nx, ny, nz] = nodes[i]!, adjacent: number[] = [];
    for (const link of wireLinks(get, nx, ny, nz)) {
      const key = cellIndex(...link);
      let id = ids.get(key);
      if (id === undefined) {
        if (nodes.length >= MAX_DUST) { overflow = true; continue; }
        ids.set(key, id = nodes.length);
        nodes.push(link);
      }
      adjacent.push(id);
    }
    links.push(adjacent);
  }
  if (overflow) console.warn(`blockwild redstone: dust network at ${x},${y},${z} exceeds ${MAX_DUST} cells; updated the first ${MAX_DUST}`);
  const power = nodes.map(([nx, ny, nz]) => received(get, nx, ny, nz, -1, true)), levels: number[][] = Array.from({ length: 16 }, () => []);
  power.forEach((p, i) => { if (p) levels[p]!.push(i); });
  for (let p = 15; p > 1; p--) for (const i of levels[p]!) {
    if (power[i] !== p) continue;
    for (const j of links[i]!) if (power[j]! < p - 1) { power[j] = p - 1; levels[p - 1]!.push(j); }
  }
  for (const [key, i] of ids) {
    rs.settled.add(key);
    const [nx, ny, nz] = nodes[i]!;
    if (wirePower(cellState(get(nx, ny, nz))) !== power[i]) writeCell(state, nx, ny, nz, makeCell(B.redstone_wire, power[i]));
  }
}

/** Doors open on a rising power edge (either half powered) and close on a falling one. */
function updateDoor(state: State, x: number, y: number, z: number, cell: number) {
  const get = state.getLoaded, rs = state.redstone, id = cellId(cell), lowerY = cellState(cell) & DOOR_UPPER ? y - 1 : y, key = cellIndex(x, lowerY, z);
  const lower = get(x, lowerY, z), upper = get(x, lowerY + 1, z);
  if (cellId(lower) !== id || cellId(upper) !== id) return;
  const powered = received(get, x, lowerY, z) > 0 || received(get, x, lowerY + 1, z) > 0;
  if (powered === rs.doors.has(key)) return;
  if (powered) rs.doors.add(key);
  else rs.doors.delete(key);
  if (((cellState(lower) & DOOR_OPEN) !== 0) === powered) return;
  const flip = (half: number) => half ^ DOOR_OPEN << 8;
  if (writeCells(state, [[x, lowerY, z, flip(lower)], [x, lowerY + 1, z, flip(upper)]])) addFx(state, 'door', x + 0.5, lowerY + 1, z + 0.5, powered ? 1 : 0);
}

/** Pistons follow their power (ignoring the front face); a moving piston re-checks once its 2-tick move is done. */
function updatePiston(state: State, x: number, y: number, z: number, cell: number) {
  const index = cellIndex(x, y, z), s = cellState(cell);
  if (state.redstone.scheduled.has(index)) return;
  const powered = received(state.getLoaded, x, y, z, pistonFacing(s)) > 0;
  if (powered === ((s & PISTON_EXTENDED) !== 0)) return;
  if (powered ? extend(state, x, y, z, cell) : retract(state, x, y, z, cell)) schedule(state, index, MOVE_TICKS);
}

/**
 * Push up to 12 blocks (with their states) one cell along the piston's facing and place the head. Fails on immovable
 * blocks, unloaded chunks, the world edge or a longer chain. The first fragile block (plants, torches, dust...) breaks.
 */
function extend(state: State, x: number, y: number, z: number, cell: number): boolean {
  const get = state.getLoaded, facing = pistonFacing(cellState(cell)), [dx, dy, dz] = FACES[facing]!, chain: CellWrite[] = [];
  let crush: Vec3 | null = null;
  for (let i = 1; ; i++) {
    const cx = x + dx * i, cy = y + dy * i, cz = z + dz * i, c = get(cx, cy, cz);
    if (!inWorld(cx, cy, cz)) return false;
    if (isAir(c) || isLiquid(c)) break;
    if (immovable(c)) return false;
    if (fragile(c)) { crush = [cx, cy, cz]; break; }
    if (chain.length === PUSH_LIMIT) return false;
    chain.push([cx, cy, cz, c]);
  }
  const head = makeCell(B.piston_head, facing | (cellId(cell) === B.sticky_piston ? PISTON_STICKY : 0));
  const moved: CellWrite[] = [...chain.map(([cx, cy, cz, c]): CellWrite => [cx + dx, cy + dy, cz + dz, c]).reverse(), [x + dx, y + dy, z + dz, head]];
  if (!state.world.canEdit([...moved, [x, y, z, cell | PISTON_EXTENDED << 8]])) return false;
  if (crush) breakBlock(state, ...crush);
  for (const [wx, wy, wz, value] of moved) writeCell(state, wx, wy, wz, value);
  writeCell(state, x, y, z, cell | PISTON_EXTENDED << 8);
  shove(state, moved, dx, dy, dz);
  settle(state, moved.map(([wx, wy, wz]): Vec3 => [wx, wy, wz]));
  addFx(state, 'piston', x + 0.5, y + 0.5, z + 0.5, facing + 8 * chain.length);
  return true;
}
/** Remove the head; a sticky piston pulls back the movable block in front of it. */
function retract(state: State, x: number, y: number, z: number, cell: number): boolean {
  const get = state.getLoaded, facing = pistonFacing(cellState(cell)), [dx, dy, dz] = FACES[facing]!, hx = x + dx, hy = y + dy, hz = z + dz;
  // The base is written first, so the head's removal does not break it (see detach).
  const writes: CellWrite[] = [[x, y, z, cell & ~(PISTON_EXTENDED << 8)]], head = get(hx, hy, hz), far = get(hx + dx, hy + dy, hz + dz);
  let pulled = 0;
  if (cellId(head) === B.piston_head && pistonFacing(cellState(head)) === facing) {
    const pull = cellId(cell) === B.sticky_piston && inWorld(hx + dx, hy + dy, hz + dz) && !isAir(far) && !isLiquid(far) && !immovable(far) && !fragile(far);
    writes.push(pull ? [hx, hy, hz, far] : [hx, hy, hz, B.air]);
    if (pull) { writes.push([hx + dx, hy + dy, hz + dz, B.air]); pulled = 1; }
  }
  if (!writeCells(state, writes)) return false;
  settle(state, writes.slice(1).map(([wx, wy, wz]): Vec3 => [wx, wy, wz]));
  addFx(state, 'piston', x + 0.5, y + 0.5, z + 0.5, (facing ^ 1) + 8 * pulled);
  return true;
}
/**
 * Move players, mobs and items overlapping the cells a piston just filled one block along the push, when they fit
 * there; a body with a wall behind it stays put (MC), so a piston can never shove anyone into bedrock.
 */
function shove(state: State, cells: readonly CellWrite[], dx: number, dy: number, dz: number) {
  const inside = (box: readonly number[]) => cells.some(([x, y, z]) => box[0]! < x + 1 && box[3]! > x && box[1]! < y + 1 && box[4]! > y && box[2]! < z + 1 && box[5]! > z);
  const moves = (box: readonly number[]) => inside(box) && !regionCollides(state.get, box[0]! + dx, box[1]! + dy, box[2]! + dz, box[3]! + dx, box[4]! + dy, box[5]! + dz, 0.05);
  for (const p of state.players) if (p.connected && !p.dead && moves(bodyBox(p))) teleport(state, p, p.x + dx, p.y + dy, p.z + dz);
  for (const body of [...state.mobs.filter(mob => moves(boxOf(mob))), ...state.items.filter(i => moves([i.x - 0.125, i.y, i.z - 0.125, i.x + 0.125, i.y + 0.25, i.z + 0.125]))]) {
    body.x += dx;
    body.y += dy;
    body.z += dz;
  }
}

/** Players and mobs press stone plates; oak plates also feel items and primed tnt. A plate releases 1 s after the last touch. */
function pressPlates(state: State) {
  const get = state.getLoaded;
  const touch = (x0: number, y0: number, z0: number, x1: number, z1: number, living: boolean) => {
    const y = Math.floor(y0 + 0.01);
    if (y0 - y > 0.25) return;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
      if (x1 <= x + 1 / 16 || x0 >= x + 15 / 16 || z1 <= z + 1 / 16 || z0 >= z + 15 / 16) continue;
      const cell = get(x, y, z), id = cellId(cell);
      if (id !== B.oak_pressure_plate && (id !== B.stone_pressure_plate || !living)) continue;
      if (!(cellState(cell) & PLATE_PRESSED)) {
        if (!writeCell(state, x, y, z, cell | PLATE_PRESSED << 8)) continue;
        addFx(state, 'button', x + 0.5, y, z + 0.5, 1);
      }
      schedule(state, cellIndex(x, y, z), PLATE_HOLD, true);
    }
  };
  for (const p of state.players) if (p.connected && !p.dead) touch(p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.z + 0.3, true);
  for (const mob of state.mobs) {
    if (mob.health <= 0) continue;
    const [x0, y0, z0, x1, , z1] = boxOf(mob);
    touch(x0, y0, z0, x1, z1, MOB_TYPES[mob.t]!.kind !== 'object');
  }
  for (const item of state.items) touch(item.x - 0.125, item.y, item.z - 0.125, item.x + 0.125, item.z + 0.125, false);
}

/** Re-evaluate around dirty cells in rounds (each round's writes feed the next) until quiet; leftovers wait for the next tick. */
function flush(state: State) {
  const rs = state.redstone, get = state.getLoaded;
  for (let round = 0; round < MAX_ROUNDS && (rs.dirty.size || rs.pulsed.size); round++) {
    const todo = new Set<number>(), collect = (cells: Set<number>, dust: boolean) => {
      for (const index of cells) {
        const [x, y, z] = cellXYZ(index);
        if (!isLoaded(state, x, z)) { rs.waiting.add(index); continue; }
        for (const [dx, dy, dz] of NEAR) {
          const cell = get(x + dx, y + dy, z + dz);
          if (REACTS.has(cellId(cell)) && (dust || !isDust(cell))) todo.add(cellIndex(x + dx, y + dy, z + dz));
        }
      }
    };
    collect(rs.dirty, true);
    collect(rs.pulsed, false);
    rs.dirty = new Set();
    rs.pulsed = new Set();
    rs.settled.clear();
    for (const index of todo) react(state, ...cellXYZ(index));
  }
}

// Hooks ---------------------------------------------------------------------------------------------------------------

/**
 * Called after every cell write and for each saved edit on load (old = generated cell). Marks redstone-relevant changes
 * dirty, schedules the release of pressed buttons and plates, and removes the other half of a piston whose base or head went.
 */
export function onBlockChanged(state: State, x: number, y: number, z: number, old: number, cell: number): void {
  const rs = state.redstone, index = cellIndex(x, y, z), oldId = cellId(old), id = cellId(cell);
  if (oldId !== id) detach(state, x, y, z, old, id);
  if (id === B.redstone_wire && oldId === id) { rs.pulsed.add(index); return; }
  if (!COMPONENTS.has(oldId) && !COMPONENTS.has(id) && conducts(old) === conducts(cell)) return;
  rs.dirty.add(index);
  if (BUTTON_TICKS[id] && cellState(cell) & BUTTON_PRESSED) schedule(state, index, BUTTON_TICKS[id]);
  if (isPlate(id) && cellState(cell) & PLATE_PRESSED) schedule(state, index, PLATE_HOLD);
}
/** Clean up after a replaced component: piston halves go together; door and (unless it just toggled) torch memories are forgotten. */
function detach(state: State, x: number, y: number, z: number, old: number, id: number) {
  const rs = state.redstone, s = cellState(old), [dx, dy, dz] = FACES[pistonFacing(s)]!, index = cellIndex(x, y, z);
  if (isPiston(cellId(old)) && s & PISTON_EXTENDED) {
    const head = state.get(x + dx, y + dy, z + dz);
    if (cellId(head) === B.piston_head && pistonFacing(cellState(head)) === pistonFacing(s)) writeCell(state, x + dx, y + dy, z + dz, B.air);
  } else if (cellId(old) === B.piston_head) {
    const base = state.get(x - dx, y - dy, z - dz);
    if (isPiston(cellId(base)) && cellState(base) & PISTON_EXTENDED && pistonFacing(cellState(base)) === pistonFacing(s)) breakBlock(state, x - dx, y - dy, z - dz);
  }
  rs.doors.delete(index);
  rs.doors.delete(cellIndex(x, y - 1, z));
  if (id === B.redstone_torch || id === B.redstone_torch_off) return;
  rs.toggles.delete(index);
  rs.burnt.delete(index);
}

/**
 * Every tick, before portals and mobs: wake dirty cells whose chunk loaded, run due scheduled ticks, press plates under
 * players, mobs and (oak) items, then settle everything dirty (player edits this tick included).
 */
export function tickRedstone(state: State, _dt: number): void {
  const rs = state.redstone, now = state.ticks;
  if (now % RETRY === 0) for (const index of rs.waiting) {
    const [x, , z] = cellXYZ(index);
    if (isLoaded(state, x, z)) { rs.waiting.delete(index); rs.dirty.add(index); }
  }
  const due = rs.queue.get(now);
  rs.queue.delete(now);
  for (const index of due ?? []) if (rs.scheduled.get(index) === now) { rs.scheduled.delete(index); run(state, index); }
  pressPlates(state);
  flush(state);
}

/** A player's `use` on a lever (toggle), button (press; it releases itself) or repeater (cycle the delay 1–4). */
export function useRedstoneBlock(state: State, _player: Player, x: number, y: number, z: number): boolean {
  const cell = state.get(x, y, z), s = cellState(cell), at = [x + 0.5, y + 0.5, z + 0.5] as const;
  switch (cellId(cell)) {
    case B.lever:
      if (!writeCell(state, x, y, z, cell ^ LEVER_ON << 8)) return false;
      addFx(state, 'lever', ...at, s & LEVER_ON ? 0 : 1);
      return true;
    case B.stone_button: case B.oak_button:
      if (s & BUTTON_PRESSED) return true;
      if (!writeCell(state, x, y, z, cell | BUTTON_PRESSED << 8)) return false;
      addFx(state, 'button', ...at, 1);
      return true;
    case B.repeater:
      if (!writeCell(state, x, y, z, makeCell(B.repeater, s & ~12 | ((s >> 2) + 1 & 3) << 2))) return false;
      addFx(state, 'button', ...at, 1);
      return true;
  }
  return false;
}

/**
 * Replace the tnt block at (x, y, z) with a primed `tnt` mob (fuse in game ticks: 80, or a short random fuse when an
 * explosion chain-primes it). Called by redstone power, flint and steel, explosions and fire. False when there is no tnt.
 */
export function primeTnt(state: State, x: number, y: number, z: number, fuse = TNT_FUSE): boolean {
  if (cellId(state.get(x, y, z)) !== B.tnt || !writeCell(state, x, y, z, B.air)) return false;
  const angle = state.rand() * Math.PI * 2;
  state.mobs.push(Object.assign(newMob(state, MOB.tnt, x + 0.5, y, z + 0.5), { fuse, a: Math.ceil(fuse / 4), vx: Math.sin(angle) * 0.4, vy: 4, vz: Math.cos(angle) * 0.4, yaw: 0 }));
  addFx(state, 'tnt', x + 0.5, y + 0.5, z + 0.5);
  settle(state, [[x, y, z]]);
  return true;
}

/** Every tick per primed tnt: burn the fuse (`a` = ticks left / 4, for the flash), then explode with power 4. */
export function thinkTnt(state: State, mob: Mob, dt: number): [number, number] | null {
  mob.fuse -= dt * 20;
  mob.a = Math.max(0, Math.ceil(mob.fuse / 4));
  if (mob.fuse > 0.5) return [0, 0];
  mob.health = 0;
  explode(state, mob.x, mob.y + 0.49, mob.z, 4, 'was blown up by TNT');
  return null;
}
