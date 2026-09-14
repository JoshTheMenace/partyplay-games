import type { ShipSummary } from '../contracts';
/** TV composition authored at 1280x620 logical pixels; the canvas scales uniformly. */
export const STAGE = { w: 1280, h: 620, top: 56, bottom: 48 } as const;
export type Slot = { shipId: string; faction: ShipSummary['faction']; x: number; y: number; w: number; h: number; label: string; flagship: boolean };
const rank = (ships: ShipSummary[]) => [...ships].sort((a, b) => a.formation - b.formation || a.id.localeCompare(b.id));
/** Enemy labels come from the stable formation order and never renumber after a kill. */
export const enemyLabel = (ship: ShipSummary, ships: ShipSummary[]) => `E${rank(ships.filter(s => s.faction === 'enemy')).findIndex(s => s.id === ship.id) + 1}`;
export function formation(ships: ShipSummary[]): Slot[] {
  const allies = rank(ships.filter(s => s.faction === 'allied')), enemies = rank(ships.filter(s => s.faction === 'enemy'));
  const field = STAGE.h - STAGE.top - STAGE.bottom, slots: Slot[] = [];
  const allyH = 116, allyGap = 12, allyTop = STAGE.top + (field - (allies.length * allyH + (allies.length - 1) * allyGap)) / 2;
  allies.forEach((ship, i) => slots.push({ shipId: ship.id, faction: 'allied', x: 40, y: allyTop + i * (allyH + allyGap), w: 360, h: allyH, label: ship.name, flagship: false }));
  const columns = enemies.length > 3 ? 2 : 1, rows = Math.ceil(enemies.length / columns), h = 150, gap = 12, w = 250, colGap = 20;
  const top = STAGE.top + (field - (rows * h + (rows - 1) * gap)) / 2, left = 1240 - (columns * w + (columns - 1) * colGap);
  const flagshipIndex = enemies.reduce((best, ship, i) => ship.maxHull > (enemies[best]?.maxHull ?? 0) ? i : best, -1);
  enemies.forEach((ship, i) => {
    const column = columns === 1 ? 0 : i % 2, row = columns === 1 ? i : Math.floor(i / 2);
    slots.push({ shipId: ship.id, faction: 'enemy', x: left + column * (w + colGap), y: top + row * (h + gap), w, h, label: `E${i + 1}`, flagship: enemies.length > 1 && i === flagshipIndex });
  });
  return slots;
}
export const overlaps = (a: Slot, b: Slot) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
