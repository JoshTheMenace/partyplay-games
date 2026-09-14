import type { Crew, RoomView } from '../contracts';
export type Rect = { x: number; y: number; w: number; h: number };
export type RoomRect = Rect & { id: string };
/** Minimum touch target the room buttons must reach; below this the list fallback is shown. */
export const MIN_TARGET = 44;
export type Fit = { tile: number; ox: number; oy: number; grid: { w: number; h: number }; rooms: RoomRect[]; meets44: boolean };
/** One geometry for art and hit targets. Rooms are positioned from authored tile rectangles and never from screenshots. */
export function fitInterior(rooms: Pick<RoomView, 'id' | 'x' | 'y' | 'w' | 'h'>[], stage: { w: number; h: number }, pad = 8): Fit {
  const grid = { w: Math.max(1, ...rooms.map(r => r.x + r.w)), h: Math.max(1, ...rooms.map(r => r.y + r.h)) };
  const tile = Math.max(1, Math.floor(Math.min((stage.w - pad * 2) / grid.w, (stage.h - pad * 2) / grid.h)));
  const ox = Math.round((stage.w - grid.w * tile) / 2), oy = Math.round((stage.h - grid.h * tile) / 2);
  const placed = rooms.map(r => ({ id: r.id, x: ox + r.x * tile, y: oy + r.y * tile, w: r.w * tile, h: r.h * tile }));
  return { tile, ox, oy, grid, rooms: placed, meets44: placed.every(r => r.w >= MIN_TARGET && r.h >= MIN_TARGET) };
}
export const crewPoint = (fit: Fit, crew: Pick<Crew, 'x' | 'y'>) => ({ x: fit.ox + crew.x * fit.tile, y: fit.oy + crew.y * fit.tile });
/** Groups crew per room so dense rooms show a bounded number of tokens plus an overflow count. */
export function crewClusters(fit: Fit, crew: Crew[], max = 6) {
  return fit.rooms.map(room => { const inside = crew.filter(c => c.roomId === room.id); return { roomId: room.id, shown: inside.slice(0, max), overflow: Math.max(0, inside.length - max) }; });
}
export const roomCenter = (room: Rect) => ({ x: room.x + room.w / 2, y: room.y + room.h / 2 });
