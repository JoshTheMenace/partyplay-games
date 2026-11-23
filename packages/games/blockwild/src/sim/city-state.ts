/**
 * Caper City on the server: the state it adds to a world (nothing here exists in survival or creative) and the small
 * helpers its modules share. The city and its residents come from the seed (shared/city); this holds only what play
 * changes: each seat's coins, heat, vehicle and gig, the vehicles that exist near players, and the residents that have
 * been knocked off their script.
 */
import { RIDES } from '../shared/city/vehicles';
import { cityPeople, residentAt, type People, type Pose } from '../shared/city/people';
import { CITY, cityPlan, lotWalk, type CityPlan } from '../shared/city/plan';
import { START_COINS } from '../shared/city/economy';
import type { Vec3 } from '../shared/coords';
import type { GigOffer } from '../shared/protocol';
import type { Race, Vault } from './city-play';
import type { Player, State } from './state';

/** Career totals for the ledger (saved). `peak`: highest heat reached; `drove`, `flew`: blocks covered. */
export type CityStats = { earned: number; gigs: number; bonks: number; busts: number; escapes: number; peak: number; drove: number; flew: number; kos: number;
  /** Second helping: fish landed, races won, the longest stunt jump (blocks), coins busked, fires and patients seen to, bounties collected, seconds with the gull. */
  fish: number; wins: number; jump: number; tips: number; helped: number; bounties: number; gull: number };
export const newStats = (): CityStats => ({ earned: 0, gigs: 0, bonks: 0, busts: 0, escapes: 0, peak: 0, drove: 0, flew: 0, kos: 0, fish: 0, wins: 0, jump: 0, tips: 0, helped: 0, bounties: 0, gull: 0 });
/** The first nine are what a version 12 save holds; a version 13 save adds the rest, each with the most it may be. */
export const STAT_KEYS = ['earned', 'gigs', 'bonks', 'busts', 'escapes', 'peak', 'drove', 'flew', 'kos'] as const;
export const STAT_KEYS_2 = [['fish', 9999], ['wins', 999], ['jump', 999], ['tips', 99999], ['helped', 999], ['bounties', 999], ['gull', 9999]] as const;
/** Reputation with the townsfolk, the Watch and the Magpies (0..100 each), and how it packs into one integer. */
export type Rep = [folk: number, watch: number, magpies: number];
export const REP = { FOLK: 0, WATCH: 1, MAGPIES: 2 } as const, REP_START: Rep = [20, 20, 0];
export const packRep = (rep: readonly number[]) => rep[0]! | rep[1]! << 7 | rep[2]! << 14;
export const unpackRep = (n: number): Rep => [Math.min(100, n & 127), Math.min(100, n >> 7 & 127), Math.min(100, n >> 14 & 127)];
/** A look: the hat worn (0 = the cap everyone starts in), the paint of owned vehicles and which owned kinds are tuned. */
export const packLook = (hat: number, paint: number, tuned: number) => hat | paint << 4 | tuned << 7;
/** Up to three businesses (place indices) in one integer. */
export const MAX_BIZ = 3;
export const packBiz = (biz: readonly number[]) => biz.reduce((n, place, k) => n | place + 1 << k * 7, 0);
export const unpackBiz = (n: number) => [n & 127, n >> 7 & 127, n >> 14 & 127].filter(Boolean).map(place => place - 1);
/** What a save keeps of a seat's city life. */
export type CityRecord = { coins: number; own: number; flat: number; plot: number; stats: CityStats; stamps: [number, number]; feathers: [number, number]; story: number; rep: number; look: number; biz: number };
/** A gig in progress: `stage` 0 = fetch the rider (cabs), 1 = deliver; `until` is the deadline (sim seconds). */
export type Gig = { k: number; stage: number; x: number; z: number; until: number; pay: number; drops: number; place: number; rider: number; from: [number, number] };
export type CityPlayer = {
  coins: number; heat: number;
  /** When an officer last had eyes on this player, when heat last rose, and the highest tier of the current spell. */
  seenAt: number; hotAt: number; spell: number;
  /** Seconds an officer has had hold of the player (an arrest completes at GRAB_SECONDS). */
  grab: number;
  /** The vehicle ridden (0 none) and the seat in it (0 drives). */
  ride: number; seat: number;
  gig: Gig | null;
  /** The place whose counter or board is open (−1 none) and the board's offers. */
  open: number; offers: GigOffer[] | null;
  own: number; flat: number; plot: number;
  dizzyUntil: number; bonkedAt: number;
  /** When the next officer may be sent after this player, and when a "that belongs to the city" toast was last shown. */
  sendAt: number; toldAt: number;
  /** Speed claimed by the client's last input (m/s), and the last position counted towards distance driven. */
  speed: number; rx: number; rz: number;
  stats: CityStats;
  /** Saved with the seat: passport stamps and golden feathers (bit halves), errand steps (3 bits a character), standing, look and businesses. */
  stamps: [number, number]; feathers: [number, number]; story: number; rep: Rep; hat: number; paint: number; tuned: number; biz: number[];
  /** Session only (sim/city-fun.ts and friends). `chuteUntil`: a free canopy after bailing out; `gliding`: under one now. */
  chuteUntil: number; gliding: boolean; glideFrom: number;
  /** Shopkeepers are wary of this seat until then (prices up). */
  waryUntil: number;
  /** Fishing: 0 nothing, 1 waiting, 2 a bite; when the bite comes or goes; where the float is, whether that is deep water and where the cast was made from. */
  fish: number; fishAt: number; fishX: number; fishZ: number; fishDeep: boolean; fishFrom: [number, number];
  /** Busking: when the last note was played, how warm the tune is (0..1, tips grow with it), notes played, and the pitch: where, and the coins it has given. */
  tootAt: number; tune: number; notes: number; pitch: number[];
  /** A hold-to-finish action: what, its key (a place, a fire) and seconds done. */
  hold: { what: string; key: number; done: number; at: number } | null;
  /** The number of the player's newest toast when this tick began: a passport stamp earned since joins that message instead of replacing it. */
  toastN: number;
  /** The character being talked to (−1 none) and the errand in hand: character, step, and the stat it counts from. */
  talk: number; errand: { who: number; step: number; base: number } | null;
  /** The lock-up: released at this time (0 = free); community service still owed (litter to sweep). */
  cellUntil: number; service: number; fine: number;
  /** Airtime of the vehicle driven: where it left the ground. */
  air: { x: number; z: number } | null;
  /** The race this seat is in (0 none) and its next checkpoint. */
  race: number; lap: number;
  /** Slipped on a peel at this time (so one peel does not fell the same player twice). */
  slipAt: number;
};
/** A traffic car's place on the lane rails (see rides.ts). */
export type Rail = {
  /** The intersection left behind (kx, kz), the heading (0..3 = N, E, S, W) and the distance from its centre. */
  kx: number; kz: number; dir: number; s: number;
  /** While crossing an intersection: the curve from one lane to the next and the progress along it. */
  turn: { x0: number; z0: number; x1: number; z1: number; yaw0: number; yaw1: number; len: number; at: number; next: number } | null;
  cruise: number; waited: number;
  /** A cruiser's quarry (seat), or −1 for ordinary traffic. */
  chase: number; crew: number;
};
export type Vehicle = {
  id: number; k: number; x: number; y: number; z: number; yaw: number; paint: number;
  /** Forward speed (m/s) and pitch, for the wire. */
  v: number; pt: number;
  /** The parking bay it came from (−1 none), who drives (seat, −1 nobody), passengers by seat − 1, and who owns it (seat, −1 nobody). */
  bay: number; driver: number; riders: number[]; owner: number;
  rail: Rail | null;
  /** When it was last touched (sim seconds): abandoned vehicles are cleared away. */
  idleAt: number; siren: boolean;
  /** An aircraft left in the air with nobody aboard: it comes down where it is. */
  sink: boolean;
};
/**
 * A live resident (or an extra: a reinforcement officer, an ejected driver, a cab rider). `i` is the resident index
 * (extras count on from the roster's length). `home`: where an extra leaves from, or null to walk back to the script.
 */
export type Npc = {
  i: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; onGround: boolean;
  s: number; until: number; officer: boolean; extra: boolean;
  /** The seat an officer is after or a resident is fleeing or facing (−1 none). */
  target: number;
  path: Vec3[] | null; pathIndex: number; pathAt: number; stuck: number; angry: boolean;
};
/**
 * Something going on in the city, as every screen is told once a second: kind (EV), where, until when, and two numbers
 * the kind gives meaning to (a fire's strength, a bounty's seat). `helpers`: what each seat has done towards it.
 */
export type CityEvent = { id: number; k: number; x: number; z: number; until: number; a: number; b: number; helpers: Map<number, number>; quietAt: number };
/** A banana peel: the item entity screens draw, where it lies, until when, and who dropped it when. */
export type Peel = { item: number; x: number; z: number; until: number; by: number; at: number };
export type CityState = {
  plan: CityPlan; people: People;
  /** By seat (the index in State.players). */
  players: CityPlayer[];
  vehicles: Vehicle[];
  npcs: Map<number, Npc>;
  /** Residents by 16-block cell, refreshed a tenth of them a tick: positions of the scripted crowd for witnesses, traffic and collisions. */
  cells: Map<number, number[]>; rx: Float32Array; rz: Float32Array; rcell: Int32Array; ract: Uint8Array;
  /** Parking bays whose vehicle was taken (they stay empty for the session) and the vehicle standing in each bay. */
  emptied: Set<number>; parked: Map<number, number>;
  /** Bays by 64-block cell. */
  bayCells: Map<number, number[]>;
  /** Which traffic car holds each intersection (key kx + 16 * kz). */
  boxes: Map<number, number>;
  /** When each place's till fills again. */
  tills: Map<number, number>;
  /** What is going on in the city (fires, spills, the gull…): sim/city-events.ts owns the list. */
  events: CityEvent[]; eventId: number; nextEventAt: number; lastEvent: number;
  /** Who owns each business (place → seat), when each next pays out, and when emptied service bays may be restocked. */
  owners: Map<number, number>; payAt: number; emptiedAt: Map<number, number>; skipPay: Set<number>;
  /** Street races forming or running, and the bank's vault (sim/city-play.ts). */
  races: Race[]; vault: Vault;
  /** Banana peels lying about, smoke hanging in the air and the water balloons that burst this tick (sim/city-fun.ts). */
  peels: Peel[]; smokes: { x: number; z: number; until: number }[]; splashes: { x: number; z: number; by: number }[];
  news: [number, string] | null;
  /** When a timed round ends (sim seconds; 0 = free play). */
  endsAt: number;
  extras: number;
  /** Wire tuples of this tick: live residents, vehicles, and which vehicles are asleep. */
  frame: { tick: number; npcs: number[][]; rides: number[][]; asleep: boolean[] } | null;
  /** Remaining path searches this tick. */
  paths: number;
};

export const newCityPlayer = (record?: CityRecord): CityPlayer => ({
  coins: record?.coins ?? START_COINS, heat: 0, seenAt: -1e9, hotAt: -1e9, spell: 0, grab: 0, ride: 0, seat: 0, gig: null, open: -1, offers: null,
  own: record?.own ?? 0, flat: record?.flat ?? -1, plot: record?.plot ?? -1, dizzyUntil: 0, bonkedAt: -1e9, sendAt: 0, toldAt: -1e9, speed: 0, rx: 0, rz: 0, stats: record ? { ...newStats(), ...record.stats } : newStats(),
  stamps: record ? [...record.stamps] : [0, 0], feathers: record ? [...record.feathers] : [0, 0], story: record?.story ?? 0, rep: record ? unpackRep(record.rep) : [...REP_START],
  hat: (record?.look ?? 0) & 15, paint: (record?.look ?? 0) >> 4 & 7, tuned: (record?.look ?? 0) >> 7, biz: unpackBiz(record?.biz ?? 0),
  chuteUntil: 0, gliding: false, glideFrom: 0, waryUntil: 0, fish: 0, fishAt: 0, fishX: 0, fishZ: 0, fishDeep: false, fishFrom: [0, 0], tootAt: -1e9, tune: 0, notes: 0, pitch: [0, 0, 0], hold: null, talk: -1, errand: null, cellUntil: 0, service: 0, fine: 0, air: null, race: 0, lap: 0, slipAt: -1e9, toastN: 0,
});
/** A seat's saved record. */
export const recordOf = (cp: CityPlayer): CityRecord => ({ coins: cp.coins, own: cp.own, flat: cp.flat, plot: cp.plot, stats: { ...cp.stats }, stamps: [...cp.stamps], feathers: [...cp.feathers], story: cp.story, rep: packRep(cp.rep), look: packLook(cp.hat, cp.paint, cp.tuned), biz: packBiz(cp.biz) });

export function newCityState(seed: number, minutes: number): CityState {
  const plan = cityPlan(seed), people = cityPeople(seed), n = people.list.length, bayCells = new Map<number, number[]>();
  plan.bays.forEach((bay, index) => {
    if (bay.kind < 0) return;
    const key = cellKey(bay.x, bay.z, 6);
    bayCells.set(key, [...bayCells.get(key) ?? [], index]);
  });
  return {
    plan, people, players: [], vehicles: [], npcs: new Map(), cells: new Map(), rx: new Float32Array(n), rz: new Float32Array(n), rcell: new Int32Array(n).fill(-1), ract: new Uint8Array(n),
    emptied: new Set(), parked: new Map(), bayCells, boxes: new Map(), tills: new Map(), races: [], vault: { progress: 0, bellAt: 0, rung: false, shutUntil: 0, crew: new Set() }, peels: [], smokes: [], splashes: [], events: [], eventId: 0, nextEventAt: 75, lastEvent: -1, owners: new Map(), payAt: 60, emptiedAt: new Map(), skipPay: new Set(), news: null, endsAt: minutes * 60, extras: 0, frame: null, paths: 0,
  };
}

const DOORS = new WeakMap<CityPlan, [number, number][]>();
/** Every door something can be sent to: the walk point of each lot with a building in the street grid. */
export function doorsOf(plan: CityPlan): [number, number][] {
  let doors = DOORS.get(plan);
  if (!doors) DOORS.set(plan, doors = plan.lots.filter(lot => lot.bx < CITY.n && lot.kind !== 'park' && lot.kind !== 'plot').map(lotWalk));
  return doors;
}
export const cellKey = (x: number, z: number, shift = 4) => (Math.floor(x) >> shift) + ((Math.floor(z) >> shift) << 12);
export const cityOf = (state: State) => state.city!;
export const seatOf = (state: State, player: Player) => state.city!.players[player.seat]!;
export const vehicleOf = (city: CityState, id: number) => id ? city.vehicles.find(v => v.id === id) : undefined;
/** The vehicle a player rides, if any. */
export const rideOf = (state: State, player: Player) => vehicleOf(state.city!, state.city!.players[player.seat]?.ride ?? 0);
export const kindOf = (vehicle: Vehicle) => RIDES[vehicle.k]!;
export function news(state: State, text: string) { const city = state.city!; city.news = [(city.news?.[0] ?? 0) + 1, text]; }

const pose: Pose = { x: 0, z: 0, yaw: 0, act: 0, hidden: false, moving: false };
/** Where resident `i` is right now: live if knocked off their script, else by the script. Null when out of sight indoors. */
export function whereIs(state: State, i: number): { x: number; z: number; yaw: number; act: number; live: Npc | null } | null {
  const city = state.city!, live = city.npcs.get(i);
  if (live) return { x: live.x, z: live.z, yaw: live.yaw, act: 0, live };
  const resident = city.people.list[i];
  if (!resident) return null;
  residentAt(city.people, resident, state.day, state.time, pose);
  return pose.hidden ? null : { x: pose.x, z: pose.z, yaw: pose.yaw, act: pose.act, live: null };
}
/** Refresh a tenth of the scripted crowd's positions (so every resident is at most half a second stale). */
export function refreshCrowd(state: State) {
  const city = state.city!, { people, cells, rx, rz, rcell, ract } = city, list = people.list;
  for (let i = state.ticks % 10; i < list.length; i += 10) {
    residentAt(people, list[i]!, state.day, state.time, pose);
    const live = city.npcs.get(i), x = live?.x ?? pose.x, z = live?.z ?? pose.z, key = pose.hidden && !live ? -1 : cellKey(x, z), old = rcell[i]!;
    rx[i] = x;
    rz[i] = z;
    ract[i] = pose.act;
    if (key === old) continue;
    if (old >= 0) { const bucket = cells.get(old)!, at = bucket.indexOf(i); if (at >= 0) bucket.splice(at, 1); }
    if (key >= 0) { const bucket = cells.get(key); if (bucket) bucket.push(i); else cells.set(key, [i]); }
    rcell[i] = key;
  }
}
/** Residents out of doors within `range` blocks of (x, z), nearest positions as last refreshed. */
export function crowdNear(city: CityState, x: number, z: number, range: number, each: (i: number, rx: number, rz: number) => void) {
  for (let cz = Math.floor(z - range) >> 4; cz <= Math.floor(z + range) >> 4; cz++) for (let cx = Math.floor(x - range) >> 4; cx <= Math.floor(x + range) >> 4; cx++) {
    const bucket = city.cells.get(cx + (cz << 12));
    if (bucket) for (const i of bucket) { const dx = city.rx[i]! - x, dz = city.rz[i]! - z; if (dx * dx + dz * dz <= range * range) each(i, city.rx[i]!, city.rz[i]!); }
  }
}
/** Connected, conscious players within `range` of a point. */
export const playersNear = (state: State, x: number, z: number, range: number) => state.players.filter(p => p.connected && !p.dead && (p.x - x) ** 2 + (p.z - z) ** 2 <= range * range);
export const anyPlayerNear = (state: State, x: number, z: number, range: number) => state.players.some(p => p.connected && (p.x - x) ** 2 + (p.z - z) ** 2 <= range * range);
