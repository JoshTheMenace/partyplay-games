/** Pure presentation helpers for the Blockwild HUD, TV overlay and journal. No React, DOM or art imports. */
import { DAY_TICKS, inNether, MAX_AIR } from '../../shared/constants';
import { countItem } from '../../shared/inventory';
import { armorOf, B, durabilityOf, I, itemOf, type Slot } from '../../shared/items';
import { PF, type JournalEntry, type PubPlayer, type TradeOffer } from '../../shared/protocol';

export type MeterIcon = 'full' | 'half' | 'empty';
/** Ten hearts/shanks for a 0..max value; each icon is two points (MC half hearts). */
export function meterIcons(value: number, max = 20): MeterIcon[] {
  const points = Math.max(0, Math.min(max, Math.ceil(value)));
  return Array.from({ length: max / 2 }, (_, i): MeterIcon => points >= i * 2 + 2 ? 'full' : points === i * 2 + 1 ? 'half' : 'empty');
}
/** Air bubbles left (0..10); null when the player has full air and the meter should hide. */
export const bubbles = (air: number): number | null => air >= MAX_AIR ? null : Math.max(0, Math.ceil(air / (MAX_AIR / 10)));

/** Remaining durability fraction 0..1 for a worn tool, or null when no bar should show. */
export function wear(slot: Slot | null): number | null {
  const max = slot ? durabilityOf(slot.id) : 0;
  if (!slot || !max || !slot.d) return null;
  return Math.max(0, Math.min(1, 1 - slot.d / max));
}
/** Bar colour: green when fresh, through yellow to red when nearly broken (MC style). */
export const wearColor = (fraction: number) => `hsl(${Math.round(fraction * 120)} 90% 50%)`;

/** One-line explanations for items whose use is not obvious (tooltips and the selected-item label). */
const HINTS: Partial<Record<number, string>> = {
  [I.redstone]: 'Lays wire that carries power up to 15 blocks', [B.redstone_torch]: 'Powers wire and the block above; turns off when its block is powered',
  [B.lever]: 'Toggles power on and off', [B.stone_button]: 'Powers things for 1 second when pressed', [B.oak_button]: 'Powers things for 1.5 seconds when pressed',
  [B.stone_pressure_plate]: 'Powers while a player or mob stands on it', [B.oak_pressure_plate]: 'Powers while anything, even an item, is on it',
  [B.redstone_lamp]: 'Lights up while powered', [I.repeater]: 'Sends a full signal forward after a delay; use it to change the delay',
  [B.piston]: 'Pushes up to 12 blocks when powered', [B.sticky_piston]: 'Pushes blocks and pulls the front one back', [B.tnt]: 'Explodes 4 s after it is lit or powered',
  [B.redstone_block]: 'Always powers what it touches', [I.iron_door]: 'Opens only with redstone power', [I.flint_and_steel]: 'Lights fires, TNT and Nether portals',
};
export const itemHint = (id: number): string | undefined => HINTS[id];

/** Human-readable details shown in item tooltips. */
export function itemDetails(slot: Slot): string[] {
  const item = itemOf(slot.id);
  if (!item) return [];
  const lines = HINTS[slot.id] ? [HINTS[slot.id]!] : [];
  if (item.armor) lines.push(`+${item.armor.points} armor`);
  if (item.tool && item.tool.kind !== 'shears') lines.push(`${item.tool.damage} attack damage`);
  if (item.food) lines.push(`Restores ${item.food.hunger / 2} food`);
  const max = durabilityOf(slot.id);
  if (max) lines.push(`Durability ${max - (slot.d ?? 0)} / ${max}`);
  if (item.fuel) lines.push(`Fuel: ${item.fuel} s`);
  return lines;
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
/** Tick 0 sunrise, 6000 noon, 12000 sunset, 13000–23000 night. */
export function dayPhase(time: number): DayPhase {
  const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  return t < 1000 ? 'dawn' : t < 11500 ? 'day' : t < 13000 ? 'dusk' : t < 23000 ? 'night' : 'dawn';
}
export const PHASE_LABEL: Record<DayPhase, string> = { dawn: 'Sunrise', day: 'Daytime', dusk: 'Sunset', night: 'Night' };
/** Whole real-time minutes until the next sunset (by day) or sunrise (by night), at 20 ticks per second. */
export function untilChange(time: number): { label: string; minutes: number } {
  const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS, night = t >= 13000 && t < 23000;
  const ticks = night ? 23000 - t : (13000 - t + DAY_TICKS) % DAY_TICKS;
  return { label: night ? 'Dawn' : 'Nightfall', minutes: Math.max(1, Math.ceil(ticks / 20 / 60)) };
}
/** Sun (or moon) position on a half-circle dial: angle 0 = left horizon, 180 = right horizon. */
export function skyAngle(time: number): { body: 'sun' | 'moon'; angle: number } {
  const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS, half = DAY_TICKS / 2;
  return t < half ? { body: 'sun', angle: (t / half) * 180 } : { body: 'moon', angle: ((t - half) / half) * 180 };
}

/** One-word activity for a player card on the TV (location words when idle: caving, in the nether). */
export function playerStatus(player: PubPlayer): string {
  if (player.flags & PF.OFFLINE) return 'offline';
  if (player.flags & PF.DEAD) return 'down';
  if (player.flags & PF.BURNING) return 'on fire';
  if (player.flags & PF.SLEEPING) return 'sleeping';
  if (player.mine) return 'mining';
  if (player.flags & PF.USING) return itemOf(player.held)?.food ? 'eating' : 'aiming';
  if (player.flags & PF.FLYING) return 'flying';
  if (inNether(player.x, player.z)) return 'in the nether';
  if (player.y < 52) return 'caving';
  if (player.health <= 6) return 'hurt';
  return 'exploring';
}

/** Armor points (0..20) from a public player's worn item ids. */
export const wornArmor = (player: PubPlayer) => player.armor.reduce((sum, id) => sum + (armorOf(id)?.points ?? 0), 0);

/** A trade offer is sold out, short of payment, or ready. */
export function offerState(offer: TradeOffer, inv: readonly (Slot | null)[]): 'sold' | 'short' | 'ready' {
  if (offer.left <= 0) return 'sold';
  return [offer.buy, offer.buyB].every(pay => !pay || countItem(inv, pay.id) >= pay.n) ? 'ready' : 'short';
}

export type { JournalEntry };
export { awards, type Award } from '../../shared/awards';
export const formatDistance = (metres: number) => metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
