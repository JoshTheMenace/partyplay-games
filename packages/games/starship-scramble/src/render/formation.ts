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
  const flagship = enemies.reduce<ShipSummary | null>((best, ship) => !best || ship.maxHull > best.maxHull ? ship : best, null);
  for (const [side, fleet] of [allies, enemies].entries()) {
    const columns = fleet.length > 3 ? 2 : 1, rows = Math.max(1, Math.ceil(fleet.length / columns)), gap = 14;
    const w = (540 - gap * (columns - 1)) / columns, h = (field - gap * (rows - 1)) / rows;
    fleet.forEach((ship, i) => slots.push({ shipId: ship.id, faction: ship.faction, x: (side ? 716 : 24) + i % columns * (w + gap), y: STAGE.top + Math.floor(i / columns) * (h + gap), w, h, label: side ? `E${i + 1}` : ship.name, flagship: !!side && fleet.length > 1 && ship === flagship }));
  }
  return slots;
}
export const overlaps = (a: Slot, b: Slot) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
