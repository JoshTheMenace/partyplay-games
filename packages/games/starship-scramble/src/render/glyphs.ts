/** Original vector system icons in a 24-unit box, stroked as neon line art over an ink halo. */
import type { SystemId } from '../contracts';

const PATHS: Record<SystemId, string> = {
  helm: 'M12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14ZM12 10a2 2 0 1 1 0 4a2 2 0 1 1 0-4ZM12 2v8M12 14v8M3.3 7l6.9 4M13.8 13l6.9 4M3.3 17l6.9-4M13.8 11l6.9-4',
  engines: 'M4 5.5l6.5 6.5L4 18.5M11.5 5.5L18 12l-6.5 6.5M20.5 9v6',
  shields: 'M12 2.5l8 3v6c0 5-3.4 8.6-8 10c-4.6-1.4-8-5-8-10v-6ZM12 7v9.5',
  weapons: 'M12 5.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13ZM12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6M12 11.6v.8',
  oxygen: 'M8.5 10a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9ZM16.5 3.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6ZM17.5 14.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z',
  medbay: 'M9 3.5h6V9h5.5v6H15v5.5H9V15H3.5V9H9Z',
  teleporter: 'M5 19a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0M7.5 15.5V7M12 15.5V3M16.5 15.5V7',
  cloak: 'M2.5 12c2.6-4.4 5.8-6.5 9.5-6.5s6.9 2.1 9.5 6.5c-2.6 4.4-5.8 6.5-9.5 6.5S5.1 16.4 2.5 12ZM12 9.3a2.7 2.7 0 1 1 0 5.4a2.7 2.7 0 1 1 0-5.4ZM4 20L20 4',
  defense: 'M3.5 19.5h17M6.5 19.5a5.5 5.5 0 0 1 11 0M12 14l6-7.5M15 3.5a6.5 6.5 0 0 1 5.5 5.5',
};
/** Identity hue per system when healthy; state colors override it. */
export const SYSTEM_COLORS: Record<SystemId, string> = {
  helm: '#fff1c9', engines: '#ffc04a', shields: '#4fd8ff', weapons: '#ff8a66', oxygen: '#9fe8ff', medbay: '#7fe36b', teleporter: '#c6a0ff', cloak: '#a9b8ff', defense: '#ff8fc7',
};
const cache = new Map<SystemId, Path2D>();
export function drawGlyph(ctx: CanvasRenderingContext2D, system: SystemId, cx: number, cy: number, size: number, color: string) {
  let path = cache.get(system); if (!path) cache.set(system, path = new Path2D(PATHS[system]));
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24); ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(5,7,26,.9)'; ctx.lineWidth = 5.6; ctx.stroke(path);
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke(path);
  ctx.restore();
}
