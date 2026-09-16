import type { ShipSummary, WeaponFamily } from '../contracts';
import { hulls, weapons } from '../definitions/presentation';
import { fitCutaway, type CutawayFit } from './cutaway';
import type { Slot } from './formation';
export const weaponFamily = (id: string): WeaponFamily => weapons.find(w => w.id === id)?.family ?? 'laser';
export const weaponColor: Record<WeaponFamily, string> = { laser: '#ff6952', beam: '#ffe48a', missile: '#ffb05b', flak: '#ffc27a', ion: '#6cdfff', plasma: '#c493ff', boarding: '#ff9461', support: '#8aefb4' };
/** Six rim hardpoints stay outside the room targets and inside the shared art margins. */
export function weaponMount(fit: CutawayFit, index: number, faction: ShipSummary['faction']) {
  const direction = faction === 'enemy' ? -1 : 1, scale = Math.min(fit.tile / 16, fit.grid.w * fit.tile * .24 / 43);
  const x = fit.ox + fit.grid.w * (faction === 'enemy' ? [.22, .46, .72] : [.78, .54, .28])[Math.floor(index / 2) % 3] * fit.tile;
  const y = fit.oy + (index % 2 ? fit.grid.h + .65 : -.65) * fit.tile;
  return { x, y, scale, direction, muzzle: { x: x + direction * 28 * scale, y } };
}
export function fleetFit(ship: ShipSummary, slot: Slot) {
  return fitCutaway(hulls.find(h => h.id === ship.hullId)?.rooms ?? [], { w: slot.w, h: slot.h - 70 }, ship.hullId, 6);
}
