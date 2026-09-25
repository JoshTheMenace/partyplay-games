/**
 * Armor on the server. Worn pieces live in `player.armor` (head, chest, legs, feet).
 * Combat and heat damage is reduced by Minecraft's armor formula and wears every worn piece; falls, drowning,
 * starvation and magma go straight through.
 */
import { B } from '../shared/blocks';
import { equipArmor } from '../shared/inventory';
import { armorOf, armorPoints, armorToughness, durabilityOf, itemName } from '../shared/items';
import { addFx, toast, type DamageCause, type Player, type State } from './state';

const REDUCED: ReadonlySet<DamageCause> = new Set<DamageCause>(['mob', 'arrow', 'fireball', 'explosion', 'cactus', 'fire', 'lava']);
/** The block whose break chips and sound stand in for a broken piece of each material (leather, gold, iron, diamond). */
const CHIPS = { leather: B.terracotta, golden: B.gold_block, iron: B.iron_block, diamond: B.diamond_block } as const;

/** Minecraft's formula: damage × (1 − min(20, max(points / 5, points − damage / (2 + toughness / 4))) / 25). */
export const afterArmor = (damage: number, points: number, toughness: number) =>
  damage * (1 - Math.min(20, Math.max(points / 5, points - damage / (2 + toughness / 4))) / 25);

/** Damage left after armor, for a hit that already passed invulnerability (combat.damagePlayer calls this for every cause). */
export function reduceDamage(_state: State, player: Player, amount: number, cause: DamageCause): number {
  return REDUCED.has(cause) ? afterArmor(amount, armorPoints(player.armor), armorToughness(player.armor)) : amount;
}

/** Right after reduceDamage with the same raw amount: every worn piece loses max(1, ⌊damage / 4⌋) durability and may break. */
export function damageArmor(state: State, player: Player, amount: number, cause: DamageCause): void {
  if (!REDUCED.has(cause) || state.settings.mode !== 'survival') return;
  const wear = Math.max(1, Math.floor(amount / 4));
  player.armor.forEach((piece, i) => {
    if (!piece) return;
    const d = (piece.d ?? 0) + wear;
    if (d < durabilityOf(piece.id)) { player.armor[i] = { id: piece.id, n: 1, d }; return; }
    player.armor[i] = null;
    toast(player, `Your ${itemName(piece.id)} broke!`);
    addFx(state, 'break', player.x - 0.5, player.y + 0.4, player.z - 0.5, CHIPS[armorOf(piece.id)!.material]);
  });
}

/** A `useItem` command with armor in hotbar slot `slot`: put it on, swapping with the worn piece (the client predicts the same swap). */
export function equip(state: State, player: Player, slot: number): boolean {
  const id = player.inv[slot]?.id ?? 0;
  if (!equipArmor(player.inv, player.armor, slot)) return false;
  player.swing++;
  addFx(state, 'pickup', player.x, player.y + 1, player.z, id);
  return true;
}
