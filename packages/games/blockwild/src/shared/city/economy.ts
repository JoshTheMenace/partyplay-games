/** Caper City's numbers: what things cost, what gigs pay, how Heat rises and what being caught costs. Shared by the server and the shop screens. */
import { B, I } from '../ids';
import type { LedgerEntry } from '../protocol';
import type { PlaceKind } from './plan';
import { RIDE, RIDES } from './vehicles';

export const START_COINS = 40;
/** Heat tiers: thresholds of the 0..100 meter and their names (tier 0 is calm). */
export const HEAT_TIERS = [10, 35, 60, 85] as const, HEAT_NAMES = ['Simmering', 'Noticed', 'Wanted', 'Hot', 'Red alert'] as const;
export const heatTier = (heat: number) => HEAT_TIERS.reduce((tier, at) => tier + (heat >= at ? 1 : 0), 0);
/** Heat for each kind of mischief, when someone sees it. */
export const MISCHIEF = { bonk: 12, bonkOfficer: 30, bonkPlayer: 6, pie: 8, borrow: 8, jack: 22, cruiser: 28, runOver: 14, till: 36, flee: 4 } as const;
/** How far a witness sees (blocks; snitches see twice as far), seconds unseen before heat drains, and the drain per second (faster indoors at home). */
export const WITNESS = 18, COOL_AFTER = 8, COOLING = 3, COOLING_HOME = 12;
/** Caught: the fine is a share of the coins carried plus an amount per tier; knocked out: the clinic's bill. */
export const fineFor = (coins: number, tier: number) => Math.min(coins, Math.round(coins * 0.1) + 25 * Math.max(1, tier));
export const clinicBill = (coins: number) => Math.min(coins, 30 + Math.round(coins * 0.05));
/** Paying heat off at the Watch House, per point. */
export const HEAT_PRICE = 2;

/** Hats (the index is worn on the wire and in a save: append only). 0 is the cap everyone arrives in. */
export const HATS = [
  { name: 'Seat-colour cap', price: 5 }, { name: 'Top hat', price: 60 }, { name: "Chef's toque", price: 30 }, { name: 'Party cone', price: 20 }, { name: 'Propeller beanie', price: 45 },
  { name: 'Wide brim', price: 40 }, { name: 'Hard hat', price: 30 }, { name: 'Bobble hat', price: 25 }, { name: 'Tricorn', price: 80 }, { name: 'Golden crown', price: 600 },
] as const;
/** What a counter sells. `item`: n of an item; `ride`: a vehicle kind; `flat` / `plot`: property; `heal`; `cool`: pay off heat. */
export type Offer = { t: 'item'; id: number; n: number; price: number } | { t: 'ride'; k: number; price: number } | { t: 'flat' | 'plot' | 'heal' | 'cool'; price: number } | { t: 'hat'; k: number; price: number };
const item = (id: number, n: number, price: number): Offer => ({ t: 'item', id, n, price });
const ride = (key: string): Offer => ({ t: 'ride', k: RIDE[key]!, price: RIDES[RIDE[key]!]!.price });
const PROPERTY: Offer[] = [{ t: 'flat', price: 600 }, { t: 'plot', price: 900 }];
export const CATALOG: Record<PlaceKind, readonly Offer[]> = {
  food: [item(I.burger, 1, 14), item(I.hot_dog, 1, 10), item(I.donut, 1, 7), item(I.ice_cream, 1, 6), item(I.fizz_pop, 1, 9)],
  gizmo: [item(I.cream_pie, 4, 24), item(I.water_balloon, 4, 16), item(I.banana_peel, 3, 12), item(I.smoke_puff, 1, 30), item(I.kazoo, 1, 35), item(I.parasol, 1, 80), item(I.disguise_kit, 1, 60), item(I.bopper, 1, 10)],
  hardware: [item(B.oak_planks, 16, 8), item(B.bricks, 16, 12), item(B.stucco, 16, 10), item(B.concrete, 16, 10), item(B.city_bricks, 16, 12), item(B.glass, 16, 12), item(B.window, 8, 10), item(B.roof_tiles, 16, 12),
    item(B.oak_slab, 16, 6), item(B.oak_stairs, 8, 8), item(I.oak_door, 1, 10), item(B.ladder, 8, 8), item(B.lantern, 4, 12), item(B.oak_fence, 8, 6), item(B.white_wool, 16, 8), item(B.awning, 8, 8)],
  pawn: [],
  realtor: PROPERTY, hall: PROPERTY,
  cabs: [],
  depot: [],
  dealer: ['zipster', 'pebble', 'mule', 'breadbox', 'hopper', 'hornet', 'comet'].map(ride),
  scrap: [],
  clinic: [{ t: 'heal', price: 15 }],
  watch: [{ t: 'cool', price: HEAT_PRICE }],
  bank: [],
  airfield: ['dragonfly', 'jumper'].map(ride),
  hats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((k): Offer => ({ t: 'hat', k, price: HATS[k]!.price })), fire: [], bus: [],
  bait: [item(I.fishing_rod, 1, 25), ride('dinghy'), ride('skipjack')],
};
/** What the pawn shop pays for loot, and the share of its list price the scrapyard pays for a vehicle. */
export const LOOT: Readonly<Record<number, number>> = { [I.coin_purse]: 15, [I.gold_watch]: 40, [I.swag_bag]: 130, [I.gold_bar]: 220, [I.old_boot]: 2, [I.plush_gull]: 30 };
/** The catch, commonest first: [item, what the bait hut pays, share of bites in the shallows (per 1000), share off deep water]. */
export const FISH: readonly (readonly [number, number, number, number])[] = [
  [I.tiddler, 6, 560, 330], [I.silver_dab, 14, 240, 300], [I.stripey_mullet, 26, 110, 200], [I.old_boot, 2, 50, 30], [I.moon_carp, 60, 34, 110], [I.golden_guppy, 250, 6, 30],
];
export const FISH_PRICE: Readonly<Record<number, number>> = Object.fromEntries(FISH.filter(([id]) => id !== I.old_boot).map(([id, price]) => [id, price]));
/** What each kind of counter buys: the pawn shop takes loot, the bait hut the catch at full price, diners fish at four fifths. */
export const buysAt = (kind: PlaceKind, id: number): number => kind === 'pawn' ? LOOT[id] ?? 0 : kind === 'bait' ? FISH_PRICE[id] ?? 0 : kind === 'food' ? Math.floor((FISH_PRICE[id] ?? 0) * 0.8) : 0;
/** What a counter pays for an item: the Magpies' friends (standing 0..100) get more for their loot at a pawn shop. */
export function sellPrice(magpies: number, kind: PlaceKind, id: number): number {
  const base = buysAt(kind, id);
  return kind === 'pawn' && base > 2 ? Math.round(base * (magpies >= 60 ? 1.25 : magpies >= 30 ? 1.1 : 1)) : base;
}
/** What the town's counters charge: less for a friend of the townsfolk (standing 0..100), more while shopkeepers are wary. */
export const shopPrice = (price: number, folk: number, wary: boolean) => Math.max(1, Math.round(price * (folk >= 70 ? 0.8 : folk >= 40 ? 0.9 : 1) * (wary ? 1.25 : 1)));
/** Seconds a fish stays on the hook, and how long a bite takes to come (least, and the spread on top). */
export const BITE = { window: 1.3, wait: 2.5, spread: 6.5 } as const;
/** Businesses: what each kind of shop costs to buy, the coins it pays its owner a minute, and the owner's cut of what other players spend there. */
export const BIZ: Partial<Record<PlaceKind, readonly [price: number, income: number]>> = { food: [450, 26], gizmo: [650, 36], hardware: [550, 30], pawn: [800, 44], cabs: [700, 38], hats: [500, 28], bait: [600, 34] };
export const BIZ_CUT = 0.3, BIZ_EVERY = 60;
/** The garage: a tune-up costs this share of a vehicle's price (least 40); a respray costs this and takes this much heat off an unseen driver. */
export const tunePrice = (kind: number) => Math.max(40, Math.round((RIDES[kind]?.price ?? 0) * 0.3));
export const SPRAY = { price: 30, cools: 35 } as const;
/** Stunt jumps: the least distance in the air that counts, coins a block, and the distance that earns the stamp. */
export const STUNT = { least: 6, per: 3, stamp: 10 } as const;
/** A golden feather is worth this on the spot. */
export const FEATHER_COINS = 15;
export const scrapValue = (kind: number) => Math.max(25, Math.round((RIDES[kind]?.price || 600) * 0.25));
/** Coins in a till, and seconds before it fills again. */
export const TILL = { min: 60, max: 140, bank: 320, refill: 240 } as const;

/** Gigs: parcel rounds, hot food and cab fares. `per`: coins per block; `speed`: the pace (m/s) the timer assumes. */
export const GIGS = [
  { key: 'parcel', name: 'Parcel round', base: 16, per: 0.2, speed: 3.4, drops: 2 },
  { key: 'food', name: 'Hot food run', base: 12, per: 0.3, speed: 4.2, drops: 1 },
  { key: 'cab', name: 'Cab fare', base: 18, per: 0.34, speed: 7, drops: 1 },
  // Second helping: each of these is worked from its own vehicle (sim/city-rides.ts `DUTY`), parked by the board.
  { key: 'bus', name: 'Bus route', base: 24, per: 0.2, speed: 4.5, drops: 4 },
  { key: 'medic', name: 'Ambulance run', base: 30, per: 0.42, speed: 9, drops: 1 },
  { key: 'fire', name: 'Fire call', base: 45, per: 0.3, speed: 8, drops: 1 },
] as const;
/** The gig kind a place's job board offers. */
export const gigOf = (kind: PlaceKind) => kind === 'cabs' ? 2 : kind === 'food' ? 1 : kind === 'bus' ? 3 : kind === 'clinic' ? 4 : kind === 'fire' ? 5 : 0;
/** What a player owns is worth this much in the ledger. */
export const FLAT_VALUE = 600, PLOT_VALUE = 900;
export const ownedValue = (own: number, flat: number, plot: number, businesses = 0) => RIDES.reduce((sum, kind, k) => sum + (own >> k & 1 ? kind.price : 0), 0) + (flat >= 0 ? FLAT_VALUE : 0) + (plot >= 0 ? PLOT_VALUE : 0) + businesses;

/** Ledger awards: [stat, the least that earns it, title]. Each goes to whoever leads that stat (ties share it). Nobody is a Tycoon on the coins everyone starts with. */
const AWARDS: readonly (readonly [keyof Omit<LedgerEntry, 'id'>, number, string])[] = [
  ['worth', START_COINS + 1, 'Tycoon'], ['peak', 35, 'Most Wanted'], ['escapes', 1, 'Slippery'], ['drove', 300, 'Road Hog'], ['bonks', 3, 'Bonk Champion'], ['busts', 1, 'Jailbird'], ['flew', 100, 'Sky High'],
  ['fish', 3, 'Master Angler'], ['wins', 1, 'Speed Demon'], ['jump', 10, 'Daredevil'], ['tips', 20, 'Maestro'], ['helped', 1, 'Good Egg'], ['bounties', 1, 'Bounty Hunter'], ['stamps', 6, 'Globetrotter'],
  ['feathers', 3, 'Magpie'], ['gull', 20, 'Gull Whisperer'],
];
export type CityAward = { key: string; title: string; ids: string[] };
/** The awards a round's ledger hands out, plus Model Citizen for whoever did the most gigs without a bonk or an arrest. */
export function cityAwards(ledger: readonly LedgerEntry[]): CityAward[] {
  const out: CityAward[] = [];
  for (const [key, least, title] of AWARDS) {
    const best = Math.max(0, ...ledger.map(entry => entry[key]));
    if (best >= least) out.push({ key, title, ids: ledger.filter(entry => entry[key] === best).map(entry => entry.id) });
  }
  const clean = ledger.filter(entry => !entry.bonks && !entry.busts && entry.gigs > 0), most = Math.max(0, ...clean.map(entry => entry.gigs));
  if (most > 0) out.push({ key: 'citizen', title: 'Model Citizen', ids: clean.filter(entry => entry.gigs === most).map(entry => entry.id) });
  return out;
}
