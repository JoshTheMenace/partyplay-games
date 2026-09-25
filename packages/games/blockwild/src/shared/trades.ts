/**
 * Villager trades: profession tables and each villager's offers, derived only from its
 * profession and seed so the client could show them too. Everything runs on emeralds: a villager buys common goods
 * for one emerald and sells useful things for a few (prices follow Minecraft's).
 */
import { B, I, type Slot } from './items';
import { createRng, rngInt, type Rng } from './noise';

export const PROFESSIONS = ['Farmer', 'Librarian', 'Armorer', 'Toolsmith', 'Cleric'] as const;
/** One offer: pay `buy` (and `buyB`) for `sell`, at most `max` times between restocks. */
export type Offer = { buy: Slot; buyB?: Slot; sell: Slot; max: number };

/** [item, count] or [item, [min, max]] (the price is rolled per villager). */
type Pay = readonly [number, number | readonly [number, number]];
type Deal = { buy: Pay; buyB?: Pay; sell: Pay; max: number };
/** buys: the villager pays emeralds; sells: it takes emeralds; rare: a diamond deal a few villagers carry. */
type Table = { buys: readonly Deal[]; sells: readonly Deal[]; rare?: readonly Deal[] };

const E = I.emerald, BUY = 16, SELL = 12, RARE = 3;
const buys = (item: number, n: number | readonly [number, number]): Deal => ({ buy: [item, n], sell: [E, 1], max: BUY });
const sells = (price: number | readonly [number, number], item: number, n = 1, max = SELL): Deal => ({ buy: [E, price], sell: [item, n], max });

const TABLES: readonly Table[] = [
  { // Farmer
    buys: [buys(I.wheat, 20), buys(I.potato, 26), buys(I.carrot, 22), buys(B.pumpkin, 6), buys(B.melon, 4)],
    sells: [sells(1, I.bread, 6, 16), sells(1, I.apple, 4, 16), sells(1, I.baked_potato, 8), sells(1, I.melon_slice, 8), sells(1, B.hay_bale, 2)],
  },
  { // Librarian
    buys: [buys(I.paper, 24), buys(I.book, 4)],
    sells: [sells([6, 9], B.bookshelf, 1), sells(1, B.glass, 4, 16), sells(1, B.lantern, 1), sells(1, B.torch, 12, 16), { buy: [E, 3], buyB: [I.book, 1], sell: [B.bookshelf, 1], max: SELL }],
  },
  { // Armorer
    buys: [buys(I.coal, 15), buys(I.iron_ingot, 4)],
    sells: [sells(5, I.iron_helmet), sells(9, I.iron_chestplate), sells(7, I.iron_leggings), sells(4, I.iron_boots), sells([2, 3], I.leather_chestplate)],
    rare: [sells(13, I.diamond_helmet, 1, RARE), sells(21, I.diamond_chestplate, 1, RARE), sells(19, I.diamond_leggings, 1, RARE), sells(13, I.diamond_boots, 1, RARE)],
  },
  { // Toolsmith
    buys: [buys(I.coal, 15), buys(I.iron_ingot, 4), buys(I.flint, 24)],
    sells: [sells(1, I.stone_pickaxe), sells(1, I.stone_axe), sells(2, I.iron_shovel), sells(3, I.iron_axe), sells(4, I.iron_pickaxe), sells(2, I.shears)],
    rare: [{ buy: [E, 8], buyB: [I.diamond, 1], sell: [I.diamond_pickaxe, 1], max: RARE }, { buy: [E, 7], buyB: [I.diamond, 1], sell: [I.diamond_axe, 1], max: RARE }],
  },
  { // Cleric
    buys: [buys(I.rotten_flesh, 32), buys(I.gold_ingot, 3), buys(I.bone, 16)],
    sells: [sells(1, I.redstone, 2), sells(1, I.glowstone_dust, 3), sells(4, B.glowstone, 1), sells([8, 10], I.golden_apple, 1, 4), sells(1, I.bone_meal, 6, 16)],
  },
];
/** Share of armorers and toolsmiths that carry one diamond deal. */
const RARE_CHANCE = 0.4;

const resolve = ([item, n]: Pay, rng: Rng): Slot => ({ id: item, n: typeof n === 'number' ? n : rngInt(rng, n[0], n[1]) });
function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const cache = new Map<number, readonly Offer[]>();
/**
 * The 3–5 offers of a villager: one or two emerald-earning buys first, then sells, and (for some armorers and
 * toolsmiths) one rare diamond deal last. Pure and cached per (profession, seed).
 */
export function offersFor(profession: number, seed: number): readonly Offer[] {
  const key = seed * 8 + profession, known = cache.get(key);
  if (known) return known;
  const table = TABLES[profession] ?? TABLES[0]!, rng = createRng(seed), count = rngInt(rng, 3, 5);
  const rare = table.rare && rng() < RARE_CHANCE ? table.rare[Math.floor(rng() * table.rare.length)] : undefined;
  const deals = [...shuffled(table.buys, rng).slice(0, count === 5 ? 2 : 1), ...shuffled(table.sells, rng)].slice(0, count - (rare ? 1 : 0));
  const offers = [...deals, ...rare ? [rare] : []].map((deal): Offer => {
    const offer: Offer = { buy: resolve(deal.buy, rng), sell: resolve(deal.sell, rng), max: deal.max };
    if (deal.buyB) offer.buyB = resolve(deal.buyB, rng);
    return offer;
  });
  if (cache.size > 512) cache.clear();
  cache.set(key, offers);
  return offers;
}
