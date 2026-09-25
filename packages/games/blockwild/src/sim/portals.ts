/**
 * Nether portals on the server: frame detection and lighting, the portal index, the travel charge, and
 * arrival portals (an existing one near the mapped spot, else a new one at the safest place close by).
 */
import { B, blockOf, cellId, cellState, isFullCube, isLiquid, isReplaceable, makeCell, PORTAL_Z } from '../shared/blocks';
import type { CellReader } from '../shared/chunk';
import { EDIT_LIMIT_TOAST, HEIGHT, inNether, NETHER, WORLD } from '../shared/constants';
import { cellIndex, cellXYZ, FACES, type Vec3 } from '../shared/coords';
import { LAVA_SEA } from '../shared/nether';
import { bodyBox, regionTouches } from '../shared/physics';
import type { CellWrite } from '../shared/placement';
import { teleport } from './players';
import { addFx, toast, type Player, type State } from './state';
import { writeCell, writeCells } from './world';

/** Portal server state, created with the world (rebuilt from edits on load through onBlockChanged; not saved). */
export type PortalState = {
  /** Cell indices of nether_portal cells, for finding an existing portal near an arrival point. */
  cells: Set<number>;
  /** Fire cells written since the last tick: fire inside an empty frame lights it (checked in tickPortals). */
  fires: Set<number>;
};
export const newPortalState = (): PortalState => ({ cells: new Set(), fires: new Set() });

/** Seconds of standing in a portal before travelling. */
export const PORTAL_SECONDS = { survival: 4, creative: 1 } as const;
/** How far from the mapped point an existing portal is reused (horizontal blocks), and how far a new one may be built. */
const REUSE_RADIUS = { overworld: 128, nether: 16 } as const, BUILD_RADIUS = 16;

/** A frame's interior: its lowest cell nearest the axis origin, the axis (0 = spans X, 1 = spans Z), width and height. */
export type Frame = { x: number; y: number; z: number; axis: 0 | 1; w: number; h: number };
const AXES = [[1, 0], [0, 1]] as const;
const isObsidian = (cell: number) => cellId(cell) === B.obsidian;
const isPortal = (cell: number) => cellId(cell) === B.nether_portal;
const isEmpty = (cell: number) => cellId(cell) === B.air || cellId(cell) === B.fire;
const MAX = 21;

/** The empty obsidian frame around (x, y, z) in the plane `axis` (interior 2–21 wide, 3–21 tall; corners optional), or null. */
export function findFrame(get: CellReader, x: number, y: number, z: number, axis: 0 | 1): Frame | null {
  const [dx, dz] = AXES[axis];
  if (!isEmpty(get(x, y, z))) return null;
  let by = y;
  while (y - by < MAX && isEmpty(get(x, by - 1, z))) by--;
  const run = (sign: number) => {
    let n = 0;
    while (n <= MAX && isEmpty(get(x + dx * sign * (n + 1), by, z + dz * sign * (n + 1)))) n++;
    return n;
  };
  const left = run(-1), w = left + run(1) + 1;
  if (w < 2 || w > MAX) return null;
  const ox = x - dx * left, oz = z - dz * left, at = (i: number, j: number) => get(ox + dx * i, by + j, oz + dz * i);
  for (let i = 0; i < w; i++) if (!isObsidian(at(i, -1))) return null;
  for (let j = 0; j <= MAX; j++) {
    let top = 0;
    for (let i = 0; i < w; i++) if (isObsidian(at(i, j))) top++;
    if (top === w) return j >= 3 ? { x: ox, y: by, z: oz, axis, w, h: j } : null;
    if (top || j === MAX || !isObsidian(at(-1, j)) || !isObsidian(at(w, j))) return null;
    for (let i = 0; i < w; i++) if (!isEmpty(at(i, j))) return null;
  }
  return null;
}

/** Fill a frame's interior with portal cells. False when the edit limit is in the way. */
function light(state: State, f: Frame): boolean {
  const [dx, dz] = AXES[f.axis], portal = makeCell(B.nether_portal, f.axis ? PORTAL_Z : 0), writes: CellWrite[] = [];
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) writes.push([f.x + dx * i, f.y + j, f.z + dz * i, portal]);
  if (!writeCells(state, writes)) return false;
  addFx(state, 'portal', f.x + (dx ? f.w / 2 : 0.5), f.y + f.h / 2, f.z + (dz ? f.w / 2 : 0.5));
  return true;
}

/**
 * Called when a player uses flint and steel, with (x, y, z) = the cell across the clicked face (where fire would go).
 * If that cell is inside an empty, valid obsidian frame (X plane first, like MC), light it and return true.
 */
export function tryIgnite(state: State, x: number, y: number, z: number): boolean {
  const frame = findFrame(state.get, x, y, z, 0) ?? findFrame(state.get, x, y, z, 1);
  return !!frame && light(state, frame);
}

/** Set while unlighting, so the portal cells being cleared do not start more flood fills. */
let unlighting = false;
/** Remove the whole connected portal containing (x, y, z), if any. */
function unlight(state: State, x: number, y: number, z: number) {
  if (!isPortal(state.get(x, y, z))) return;
  const seen = new Set([cellIndex(x, y, z)]), queue: Vec3[] = [[x, y, z]];
  for (let i = 0; i < queue.length && queue.length < 1024; i++) {
    const [cx, cy, cz] = queue[i]!;
    for (const [dx, dy, dz] of FACES) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz, index = cellIndex(nx, ny, nz);
      if (!seen.has(index) && isPortal(state.get(nx, ny, nz))) {
        seen.add(index);
        queue.push([nx, ny, nz]);
      }
    }
  }
  unlighting = true;
  for (const [px, py, pz] of queue) writeCell(state, px, py, pz, B.air);
  unlighting = false;
  addFx(state, 'break', x + 0.5, y + 0.5, z + 0.5, makeCell(B.nether_portal));
}

/**
 * Called after every cell write and once per saved edit while a world loads (old = the generated cell). Keeps the
 * portal index, unlights a whole portal when one of its frame or portal cells goes, and queues new fire for lighting.
 */
export function onBlockChanged(state: State, x: number, y: number, z: number, old: number, cell: number): void {
  const index = cellIndex(x, y, z), was = cellId(old), now = cellId(cell);
  if (now === B.nether_portal) state.portals.cells.add(index);
  else if (was === B.nether_portal) state.portals.cells.delete(index);
  if (now === B.fire && was !== B.fire) state.portals.fires.add(index);
  if (was === now || was !== B.obsidian && was !== B.nether_portal || unlighting) return;
  for (const [dx, dy, dz] of FACES) unlight(state, x + dx, y + dy, z + dz);
}

// ---------------------------------------------------------------------------------------------
// Travel

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/**
 * Where a portal at (x, z) leads (8:1): overworld → (3584 + x / 8, z / 8) inside the Nether's margin, Nether →
 * (8·(x − 3584), 8·z) inside the world's margin, nudged out of the Nether's own corner of the overworld.
 */
export function portalTarget(x: number, z: number): [number, number] {
  x = Math.floor(x);
  z = Math.floor(z);
  if (!inNether(x, z)) return [clamp(NETHER.x0 + Math.floor(x / 8), NETHER.x0 + 8, NETHER.x0 + 503), clamp(Math.floor(z / 8), 8, 503)];
  const tx = clamp(8 * (x - NETHER.x0), 16, WORLD - 17), tz = clamp(8 * z, 16, WORLD - 17);
  if (!inNether(tx, tz)) return [tx, tz];
  return tx - NETHER.x0 < NETHER.z0 + NETHER.size - tz ? [NETHER.x0 - 16, tz] : [tx, NETHER.z0 + NETHER.size + 16];
}

/** Where an arriving player stands (feet, inside the portal) and the yaw that faces out of it. */
type Arrival = { x: number; y: number; z: number; yaw: number };
/** Yaw looking along +normal (side 1) or −normal (side −1) of a portal plane. */
const facingYaw = (axis: number, side: number) => axis ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
const clear = (cell: number) => isReplaceable(cell) && !isLiquid(cell);
/** Open standing room (feet and head) with a full block below. */
const standable = (get: CellReader, x: number, y: number, z: number) => clear(get(x, y, z)) && clear(get(x, y + 1, z)) && isFullCube(get(x, y - 1, z));
/** Standing cells in a row from the portal cell (x, y, z) along (nx, nz), up to 6, each with `head` blocks of headroom. */
function room(get: CellReader, x: number, y: number, z: number, nx: number, nz: number, head = 2) {
  const ok = (px: number, pz: number) => standable(get, px, y, pz) && [2, 3, 4].every(j => j >= head || clear(get(px, y + j, pz)));
  let n = 0;
  while (n < 6 && ok(x + nx * (n + 1), z + nz * (n + 1))) n++;
  return n;
}
/** The side (1 along +normal, −1 against it) with more tall walking room, then more room: arrivals face out that way. */
function openSide(get: CellReader, x: number, y: number, z: number, nx: number, nz: number) {
  const score = (side: number) => room(get, x, y, z, nx * side, nz * side, 5) * 8 + room(get, x, y, z, nx * side, nz * side);
  return score(1) >= score(-1) ? 1 : -1;
}

/** Stand in the middle of the existing portal containing cell (x, y, z), facing its roomier side. */
function arrivalIn(get: CellReader, x: number, y: number, z: number): Arrival {
  const axis = cellState(get(x, y, z)) & PORTAL_Z, [dx, dz] = AXES[axis], [nx, nz] = AXES[axis ^ 1];
  while (isPortal(get(x, y - 1, z))) y--;
  let a = 0, b = 0;
  while (a < MAX && isPortal(get(x - dx * (a + 1), y, z - dz * (a + 1)))) a++;
  while (b < MAX && isPortal(get(x + dx * (b + 1), y, z + dz * (b + 1)))) b++;
  const mid = (b - a + 1) / 2, cx = x + (dx ? mid : 0.5), cz = z + (dz ? mid : 0.5);
  return { x: cx, y, z: cz, yaw: facingYaw(axis, openSide(get, Math.floor(cx), y, Math.floor(cz), nx, nz)) };
}

/** The nearest indexed portal within `radius` (horizontally) of (tx, tz) in the same dimension, lowest first on ties. */
export function findPortal(state: State, tx: number, tz: number, radius: number): Vec3 | null {
  const nether = inNether(tx, tz);
  let best: Vec3 | null = null, bestD = radius * radius;
  for (const index of state.portals.cells) {
    const [x, y, z] = cellXYZ(index), d = (x - tx) ** 2 + (z - tz) ** 2;
    if (inNether(x, z) !== nether || d > bestD || d === bestD && best && y >= best[1]) continue;
    best = [x, y, z];
    bestD = d;
  }
  return best;
}

/** True if a 4 × 5 portal (interior bottom-left at x, y, z) fits on firm ground with open room on both sides. */
function fits(get: CellReader, x: number, y: number, z: number, axis: 0 | 1): boolean {
  const [dx, dz] = AXES[axis], [nx, nz] = AXES[axis ^ 1];
  for (let i = -1; i <= 2; i++) {
    const px = x + dx * i, pz = z + dz * i, ground = get(px, y - 1, pz);
    if (!isFullCube(ground) || blockOf(ground).hardness < 0) return false;
    for (let j = 0; j <= 3; j++) if (!clear(get(px, y + j, pz))) return false;
  }
  for (let i = 0; i <= 1; i++) for (const side of [1, -1]) if (!standable(get, x + dx * i + nx * side, y, z + dz * i + nz * side)) return false;
  return true;
}

/** Walking room (up to 6 cells) out of the roomier side of a portal at (x, y, z), counting cells with 5 blocks of headroom. */
function roominess(get: CellReader, x: number, y: number, z: number, axis: 0 | 1) {
  const [nx, nz] = AXES[axis ^ 1];
  return Math.max(room(get, x, y, z, nx, nz, 5), room(get, x, y, z, -nx, -nz, 5));
}

/** The cell writes for a portal (interior bottom-left at x, y, z): frame, interior, cleared room and a platform where it would float. */
function portalWrites(get: CellReader, x: number, y: number, z: number, axis: 0 | 1): CellWrite[] {
  const [dx, dz] = AXES[axis], [nx, nz] = AXES[axis ^ 1], portal = makeCell(B.nether_portal, axis ? PORTAL_Z : 0), writes: CellWrite[] = [];
  for (let i = -1; i <= 2; i++) for (const side of [1, -1]) {
    const px = x + dx * i + nx * side, pz = z + dz * i + nz * side;
    if (!isFullCube(get(px, y - 1, pz))) writes.push([px, y - 1, pz, B.obsidian]);
    if (i >= 0 && i <= 1) for (let j = 0; j <= 1; j++) if (!clear(get(px, y + j, pz))) writes.push([px, y + j, pz, B.air]);
  }
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const frame = i === -1 || i === 2 || j === -1 || j === 3;
    writes.push([x + dx * i, y + j, z + dz * i, frame ? B.obsidian : portal]);
  }
  return writes;
}

/** Highest spot above the ground (or water) of a column, for arrivals in the open overworld. */
function surfaceAbove(get: CellReader, x: number, z: number): number {
  let y = HEIGHT - 8;
  while (y > 1 && clear(get(x, y - 1, z))) y--;
  return y;
}

/**
 * Build an arrival portal near (tx, tz): the ring-nearest spot on firm, dry ground with room on both sides (closest to
 * the preferred height: the player's own in the Nether, the surface in the overworld), preferring spots and axes that
 * open onto 4+ blocks of tall floor so a first Nether arrival is not a cramped tunnel; else a portal carved in place at
 * the preferred height with an obsidian platform. Null when the edit limit is in the way.
 */
function buildPortal(state: State, tx: number, tz: number, preferredY: number): Arrival | null {
  const get = state.get, nether = inNether(tx, tz), low = nether ? LAVA_SEA + 2 : 6, high = nether ? 118 : HEIGHT - 8;
  let spot: [number, number, number, 0 | 1] | null = null;
  for (const need of [4, 0]) for (let r = 0; r <= BUILD_RADIUS && !spot; r++) {
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = tx + dx, z = tz + dz;
      if (inNether(x - 1, z - 1) !== nether || inNether(x + 3, z + 3) !== nether) continue;
      for (let y = high; y >= low; y--) {
        if (!isFullCube(get(x, y - 1, z)) || !clear(get(x, y, z)) || Math.abs(y - preferredY) >= bestD) continue;
        const [axis, score] = ([0, 1] as const).filter(a => fits(get, x, y, z, a)).map(a => [a, need ? roominess(get, x, y, z, a) : 0] as const).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
        if (axis === null || score < need) continue;
        spot = [x, y, z, axis];
        bestD = Math.abs(y - preferredY);
      }
    }
  }
  const [x, y, z, axis] = spot ?? [tx, clamp(preferredY, low + 2, high - 6), tz, 0];
  if (!writeCells(state, portalWrites(get, x, y, z, axis))) return null;
  const [nx, nz] = AXES[axis ^ 1];
  return { x: axis ? x + 0.5 : x + 1, y, z: axis ? z + 1 : z + 0.5, yaw: facingYaw(axis, openSide(get, x, y, z, nx, nz)) };
}

/** Send a player through the portal they stand in: to a portal near the mapped spot, building one if needed. */
function travel(state: State, player: Player) {
  const fromNether = inNether(player.x, player.z), [tx, tz] = portalTarget(player.x, player.z);
  const existing = findPortal(state, tx, tz, fromNether ? REUSE_RADIUS.overworld : REUSE_RADIUS.nether);
  const preferredY = fromNether ? surfaceAbove(state.get, tx, tz) : clamp(Math.floor(player.y), LAVA_SEA + 4, 100);
  const arrival = existing ? arrivalIn(state.get, ...existing) : buildPortal(state, tx, tz, preferredY);
  player.portal = 0;
  player.portalLock = true;
  if (!arrival) {
    toast(player, EDIT_LIMIT_TOAST);
    return;
  }
  addFx(state, 'travel', player.x, player.y + 1, player.z);
  teleport(state, player, arrival.x, arrival.y, arrival.z, arrival.yaw);
  player.mine = null;
  addFx(state, 'travel', arrival.x, arrival.y + 1, arrival.z);
  toast(player, fromNether ? 'Returning to the Overworld…' : 'Entering the Nether…');
}

/**
 * Every tick (after tickRedstone): light frames that caught fire, charge `player.portal` (0..1 over 4 s, 1 s in
 * creative) while standing in a portal, travel on full charge, and clear `player.portalLock` once the player is out.
 */
export function tickPortals(state: State, dt: number): void {
  if (state.portals.fires.size) {
    const fires = [...state.portals.fires];
    state.portals.fires.clear();
    for (const [x, y, z] of fires.map(cellXYZ)) if (cellId(state.get(x, y, z)) === B.fire && tryIgnite(state, x, y, z)) addFx(state, 'ignite', x + 0.5, y + 0.5, z + 0.5);
  }
  const seconds = PORTAL_SECONDS[state.settings.mode];
  for (const player of state.players) {
    if (!player.connected || player.dead || player.sleeping) {
      player.portal = 0;
      continue;
    }
    if (!regionTouches(state.get, ...bodyBox(player), isPortal)) {
      player.portal = 0;
      player.portalLock = false;
      continue;
    }
    if (player.portalLock) continue;
    if (player.portal === 0) addFx(state, 'portal', player.x, player.y + 1, player.z);
    player.portal = Math.min(1, player.portal + dt / seconds);
    if (player.portal >= 1) travel(state, player);
  }
}
