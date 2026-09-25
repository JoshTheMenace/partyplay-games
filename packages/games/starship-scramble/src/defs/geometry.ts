import type { DoorDef, HullDef, RoomDef, SystemId } from '../contracts';

/**
 * Sprite convention shared by Blender renders, the TV renderer and phone hit targets:
 * a hull sprite spans (gridW + 2*SPRITE_MARGIN_X) × (gridH + 2*SPRITE_MARGIN_Y) cells, nose facing +x,
 * with grid cell (0,0) at (SPRITE_MARGIN_X, SPRITE_MARGIN_Y). Renders use SPRITE_PPC pixels per cell.
 */
export const SPRITE_MARGIN_X = 2, SPRITE_MARGIN_Y = 1.5, SPRITE_PPC = 64;

/** Parse an ASCII deck plan. Each letter is one rectangular room; '.' is empty space. */
export function parseLayout(rows: string[], legend: Record<string, SystemId | null>): Pick<HullDef, 'gridW' | 'gridH' | 'rooms' | 'doors'> {
  const gridH = rows.length, gridW = Math.max(...rows.map(row => row.length)), seen = new Map<string, RoomDef>();
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    if (!(ch in legend)) throw new Error(`Unknown room letter ${ch}`);
    const room = seen.get(ch);
    if (!room) { const system = legend[ch]; seen.set(ch, { id: system ?? `bay-${ch.toLowerCase()}`, x, y, w: 1, h: 1, system }); return; }
    const right = Math.max(room.x + room.w, x + 1), bottom = Math.max(room.y + room.h, y + 1);
    room.x = Math.min(room.x, x); room.y = Math.min(room.y, y); room.w = right - room.x; room.h = bottom - room.y;
  }));
  const rooms = [...seen.values()];
  for (const room of rooms) for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++)
    if (roomAt(rooms, x, y) !== room || rows[y][x] === '.') throw new Error(`Room ${room.id} is not rectangular`);
  const doors: DoorDef[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) { const door = sharedEdge(rooms[i], rooms[j]); if (door) doors.push(door); }
  const reach = new Set([rooms[0].id]), queue = [rooms[0].id];
  while (queue.length) { const id = queue.shift()!; for (const door of doors) { const next = door.a === id ? door.b : door.b === id ? door.a : null; if (next && !reach.has(next)) { reach.add(next); queue.push(next); } } }
  if (reach.size !== rooms.length) throw new Error('Deck plan is not connected');
  return { gridW, gridH, rooms, doors };
}
export const roomAt = (rooms: readonly RoomDef[], x: number, y: number) => rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ?? null;
function sharedEdge(a: RoomDef, b: RoomDef): DoorDef | null {
  for (const [p, q] of [[a, b], [b, a]] as const) {
    if (p.x + p.w === q.x) { const lo = Math.max(p.y, q.y), hi = Math.min(p.y + p.h, q.y + q.h); if (hi > lo) return { a: a.id, b: b.id, x: q.x, y: Math.floor((lo + hi - 1) / 2) + .5, vertical: true }; }
    if (p.y + p.h === q.y) { const lo = Math.max(p.x, q.x), hi = Math.min(p.x + p.w, q.x + q.w); if (hi > lo) return { a: a.id, b: b.id, x: Math.floor((lo + hi - 1) / 2) + .5, y: q.y, vertical: false }; }
  }
  return null;
}
/** Crew stand on cell centers; capacity is the cell count. */
export const roomSlots = (room: RoomDef) => Array.from({ length: room.w * room.h }, (_, i) => ({ x: room.x + (i % room.w) + .5, y: room.y + Math.floor(i / room.w) + .5 }));
export const neighbors = (hull: HullDef, roomId: string) => hull.doors.flatMap(d => d.a === roomId ? [d.b] : d.b === roomId ? [d.a] : []);
/** Shortest room path from a to b, excluding a. */
export function roomPath(hull: HullDef, from: string, to: string): string[] {
  const prev = new Map<string, string>([[from, from]]), queue = [from];
  while (queue.length) { const id = queue.shift()!; if (id === to) break; for (const next of neighbors(hull, id)) if (!prev.has(next)) { prev.set(next, id); queue.push(next); } }
  if (!prev.has(to)) return [];
  const path: string[] = []; for (let id = to; id !== from; id = prev.get(id)!) path.unshift(id);
  return path;
}
export const doorBetween = (hull: HullDef, a: string, b: string) => hull.doors.find(d => d.a === a && d.b === b || d.a === b && d.b === a) ?? null;

export type Box = { x: number; y: number; w: number; h: number };
export type ShipLayout = { cell: number; facing: 1 | -1; hull: HullDef; sprite: Box; grid: Box; rooms: Record<string, Box> };
/** Fit a hull (including its sprite margins) into a screen box, centered. facing -1 mirrors horizontally (enemies). */
export function shipLayout(hull: HullDef, box: Box, facing: 1 | -1 = 1, maxCell = Infinity): ShipLayout {
  const spriteW = hull.gridW + 2 * SPRITE_MARGIN_X, spriteH = hull.gridH + 2 * SPRITE_MARGIN_Y;
  const cell = Math.min(box.w / spriteW, box.h / spriteH, maxCell);
  const sprite = { x: box.x + (box.w - spriteW * cell) / 2, y: box.y + (box.h - spriteH * cell) / 2, w: spriteW * cell, h: spriteH * cell };
  const grid = { x: sprite.x + SPRITE_MARGIN_X * cell, y: sprite.y + SPRITE_MARGIN_Y * cell, w: hull.gridW * cell, h: hull.gridH * cell };
  const layout: ShipLayout = { cell, facing, hull, sprite, grid, rooms: {} };
  for (const room of hull.rooms) { const p = toScreen(layout, room.x, room.y), q = toScreen(layout, room.x + room.w, room.y + room.h); layout.rooms[room.id] = { x: Math.min(p.x, q.x), y: p.y, w: Math.abs(q.x - p.x), h: q.y - p.y }; }
  return layout;
}
/** Grid cell coordinates → screen pixels, honoring mirroring. */
export const toScreen = (layout: ShipLayout, cx: number, cy: number) => ({ x: layout.facing === 1 ? layout.grid.x + cx * layout.cell : layout.grid.x + (layout.hull.gridW - cx) * layout.cell, y: layout.grid.y + cy * layout.cell });
export const roomAtPoint = (layout: ShipLayout, px: number, py: number) => Object.entries(layout.rooms).find(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)?.[0] ?? null;
