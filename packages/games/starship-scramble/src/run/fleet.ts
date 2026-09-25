/** Loot, store and between-battle ship management. Every function throws a friendly Error before the caller commits. */
import type { Captain, Item, ItemKind, Offer, Ship, SystemId } from '../contracts';
import { AUGMENTS, ROLES, SPECIES, WEAPONS, augmentDef, speciesDef, systemDef, weaponDef } from '../defs/catalog';
import { hullDef } from '../defs/hulls';
import { deriveShip } from '../sim';
import { pick, random, weighted } from './rng';
import { LIMITS, crewName, earn, enter, living, recruit, say, sector, shipOf, uid, type State } from './state';

/** Weapon tier odds by sector tier. */
const TIER_ODDS = [[.75, .25, 0], [.35, .55, .1], [.1, .6, .3], [.1, .6, .3]];
const OPTIONAL: SystemId[] = ['teleporter', 'cloak', 'defense'];
const nameOf = (kind: Exclude<Offer['kind'], 'crew'>, defId: string) => (kind === 'weapon' ? weaponDef : kind === 'augment' ? augmentDef : systemDef)(defId).name;

const weaponTier = (s: State) => weighted(s, [1, 2, 3] as const, t => TIER_ODDS[sector(s).tier - 1][t - 1]);
export function item(s: State, kind: ItemKind, tier?: 1 | 2 | 3, id?: string): Item {
  const want = id || kind === 'augment' ? 0 : tier ?? weaponTier(s), defId = id ?? (kind === 'augment' ? pick(s, AUGMENTS).id : pick(s, WEAPONS.filter(w => w.tier === want)).id);
  return { id: uid(s, 'i'), kind, defId, ownerId: null };
}
/** Free crew slots aboard a ship (every faction counts). */
export const berths = (s: State, ship: Ship) => hullDef(ship.hullId).rooms.reduce((sum, r) => sum + r.w * r.h, 0) - s.crew.filter(k => k.shipId === ship.id && k.state !== 'dead').length;
export const prices = (s: State) => ({ repairPrice: sector(s).tier === 1 ? 2 : 3, ammoPrice: 10 });
function spend(c: Captain, price: number) { if (c.scrap < price) throw new Error(`Need ${price} scrap.`); c.scrap -= price; }

/** Sync weapon uids/power and shield layers after a refit, so the hangar and map show the real loadout. */
export function refit(s: State, ship: Ship) {
  const derived = deriveShip(ship, s);
  ship.weapons.forEach((w, i) => { w.uid = `${ship.id}-w${i}`; w.powered = i < (derived.levels.weapons ?? 0); });
  ship.shields = derived.maxShields;
}
/** A weapon mounts itself in a free slot, otherwise it waits in cargo. */
function stow(s: State, c: Captain, weapon: Item) {
  const ship = shipOf(s, c);
  if (ship.weapons.length < hullDef(ship.hullId).weaponSlots) { ship.weapons.push({ uid: '', defId: weapon.defId, charge: 0, target: null, auto: true, powered: false }); refit(s, ship); return; }
  if (c.cargo.length >= LIMITS.cargo) throw new Error('Your cargo hold is full. Sell or equip something first.');
  c.cargo.push({ ...weapon, ownerId: c.id });
}
function fit(s: State, ship: Ship, augment: string) {
  if (ship.augments.includes(augment)) throw new Error(`${ship.name} already has ${augmentDef(augment).name}.`);
  if (ship.augments.length >= LIMITS.augments) throw new Error('All augment bays are full. Sell one first.');
  ship.augments.push(augment);
  if (augment === 'reinforced-plating') { ship.maxHull += 6; ship.hull += 6; }
}

// ---------- loot ----------
export function openLoot(s: State, scrap: number, count: number) {
  const total = scrap + s.scrapCarry, each = Math.floor(total / s.captains.length);
  s.scrapCarry = total - each * s.captains.length;
  for (const c of s.captains) earn(s, c, each);
  const items = [...s.pending, ...Array.from({ length: count }, () => item(s, random(s) < .65 ? 'weapon' : 'augment'))];
  s.pending = []; s.loot = { scrapEach: each, items, claims: {} };
  enter(s, 'loot'); say(s, each ? `Salvage: ${each} scrap each` : 'Salvage time');
}
export function claim(s: State, c: Captain, itemId: string) {
  const loot = s.loot!, found = loot.items.find(i => i.id === itemId);
  if (!found) throw new Error('That item is gone.');
  if (loot.claims[itemId]) throw new Error('Someone already claimed that.');
  if (found.kind === 'weapon') stow(s, c, found); else fit(s, shipOf(s, c), found.defId);
  found.ownerId = c.id; loot.claims[itemId] = c.id;
  say(s, `${c.name} claimed ${nameOf(found.kind, found.defId)}`);
}

// ---------- store ----------
/** Stock grows with the fleet. Weapons the fleet already carries are less likely, the optional system is one some hull can still install, and only some posts have recruits. */
export function openStore(s: State) {
  const n = s.captains.length, tier = sector(s).tier, fleet = s.ships.filter(x => x.captainId && x.status === 'active');
  const owned = new Set([...fleet.flatMap(x => x.weapons.map(w => w.defId)), ...s.captains.flatMap(c => c.cargo.map(i => i.defId))]);
  const offer = (kind: Offer['kind'], defId: string, price: number, crew?: Offer['crew']): Offer => ({ id: uid(s, 'o'), kind, defId, price, soldTo: null, ...crew && { crew } });
  const weapons: string[] = [], augments: string[] = [];
  while (weapons.length < Math.min(6, 2 + n)) { const pool = WEAPONS.filter(w => w.tier === weaponTier(s) && !weapons.includes(w.id)); if (pool.length) weapons.push(weighted(s, pool, w => owned.has(w.id) ? .25 : 1).id); }
  while (augments.length < (n >= 3 ? 3 : 2)) augments.push(weighted(s, AUGMENTS.filter(a => !augments.includes(a.id)), a => fleet.every(x => x.augments.includes(a.id)) ? .1 : 1).id);
  const system = OPTIONAL.filter(id => fleet.some(x => x.rooms.some(r => r.system === id && !r.tier)));
  const recruits = random(s) < .6 ? Array.from({ length: n >= 3 ? 2 : 1 }, () => ({ species: pick(s, SPECIES).id, role: pick(s, ROLES).id })) : [];
  const names: string[] = []; recruits.forEach(() => names.push(crewName(s, names)));
  s.offers = [...weapons.map(id => offer('weapon', id, weaponDef(id).price)), ...augments.map(id => offer('augment', id, augmentDef(id).price)),
    ...system.length ? [pick(s, system)].map(id => offer('system', id, Math.round(systemDef(id).installPrice * .8 / 5) * 5)) : [],
    ...recruits.map((r, i) => offer('crew', r.role, 35 + 5 * tier + (r.species === 'bastion' ? 10 : 0), { name: names[i], ...r }))];
  enter(s, 'store'); say(s, 'A trading post opens its doors');
}
export function buy(s: State, c: Captain, offerId: string) {
  const offer = s.offers!.find(o => o.id === offerId);
  if (!offer) throw new Error('That offer is gone.');
  if (offer.soldTo) throw new Error('Someone already bought that.');
  if (offer.kind === 'crew') { const ship = shipOf(s, c); if (living(s, c.id).length >= LIMITS.crew || berths(s, ship) < 1) throw new Error('Your crew quarters are full.'); }
  spend(c, offer.price);
  if (offer.kind === 'weapon') stow(s, c, { id: uid(s, 'i'), kind: 'weapon', defId: offer.defId, ownerId: c.id });
  else if (offer.kind === 'augment') fit(s, shipOf(s, c), offer.defId);
  else if (offer.kind === 'crew') { const { name, species, role } = offer.crew!; recruit(s, c.id, shipOf(s, c), species, role, name); }
  else {
    const ship = shipOf(s, c), room = ship.rooms.find(r => r.system === offer.defId);
    if (!room) throw new Error(`The ${hullDef(ship.hullId).name} has no room for a ${nameOf('system', offer.defId)}.`);
    if (room.tier) throw new Error(`You already have a ${nameOf('system', offer.defId)}.`);
    room.tier = 1; refit(s, ship);
  }
  offer.soldTo = c.id; say(s, offer.kind === 'crew' ? `${offer.crew!.name} the ${speciesDef(offer.crew!.species).name} ${offer.crew!.role} joins ${c.name}` : `${c.name} bought ${nameOf(offer.kind, offer.defId)}`);
}
export function sell(s: State, c: Captain, itemId: string) {
  const ship = shipOf(s, c), cargo = c.cargo.find(i => i.id === itemId);
  if (cargo) { c.cargo = c.cargo.filter(i => i !== cargo); c.scrap += Math.floor(weaponDef(cargo.defId).price / 2); return; }
  if (!ship.augments.includes(itemId)) throw new Error('Only cargo weapons and augments can be sold.');
  ship.augments = ship.augments.filter(a => a !== itemId); c.scrap += Math.floor(augmentDef(itemId).price / 2);
  if (itemId === 'reinforced-plating') { ship.maxHull -= 6; ship.hull = Math.min(ship.hull, ship.maxHull); }
}
export function repair(s: State, c: Captain, amount: number) {
  const ship = shipOf(s, c), price = prices(s).repairPrice, points = Math.min(amount, ship.maxHull - ship.hull, Math.floor(c.scrap / price));
  if (ship.hull >= ship.maxHull) throw new Error('Your hull is already whole.');
  if (points < 1) throw new Error(`Need ${price} scrap per hull point.`);
  c.scrap -= points * price; ship.hull += points;
}
export function ammo(s: State, c: Captain) {
  const ship = shipOf(s, c);
  if (ship.ammo + 3 > LIMITS.ammo) throw new Error('Your missile racks are full.');
  spend(c, prices(s).ammoPrice); ship.ammo += 3;
}
// ---------- ship management ----------
export function upgrade(s: State, c: Captain, system: SystemId) {
  const ship = shipOf(s, c), def = systemDef(system), room = ship.rooms.find(r => r.system === system);
  if (!room) throw new Error(`The ${hullDef(ship.hullId).name} has no ${def.name} room.`);
  if (room.tier >= def.maxTier) throw new Error(`${def.name} is already at tier ${def.maxTier}.`);
  spend(c, room.tier ? def.upgradePrices[room.tier - 1] : def.installPrice);
  room.tier++; refit(s, ship);
}
export function equip(s: State, c: Captain, itemId: string, slot: number) {
  const ship = shipOf(s, c), found = c.cargo.find(i => i.id === itemId), slots = hullDef(ship.hullId).weaponSlots;
  if (!found) throw new Error('That weapon is not in your cargo.');
  if (slot >= slots) throw new Error(`Your ship has ${slots} weapon slot${slots === 1 ? '' : 's'}.`);
  c.cargo = c.cargo.filter(i => i !== found);
  const mounted = { uid: '', defId: found.defId, charge: 0, target: null, auto: true, powered: false }, old = ship.weapons[slot];
  if (old) { ship.weapons[slot] = mounted; c.cargo.push({ id: uid(s, 'i'), kind: 'weapon', defId: old.defId, ownerId: c.id }); } else ship.weapons.push(mounted);
  refit(s, ship);
}
export function unequip(s: State, c: Captain, slot: number) {
  const ship = shipOf(s, c), old = ship.weapons[slot];
  if (!old) throw new Error('That slot is empty.');
  if (c.cargo.length >= LIMITS.cargo) throw new Error('Your cargo hold is full.');
  ship.weapons.splice(slot, 1); c.cargo.push({ id: uid(s, 'i'), kind: 'weapon', defId: old.defId, ownerId: c.id });
  refit(s, ship);
}
