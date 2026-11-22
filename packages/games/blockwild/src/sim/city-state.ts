/**
 * Caper City on the server: the state it adds to a world (nothing here exists in survival or creative) and the small
 * helpers its modules share. The city and its residents come from the seed (shared/city); this holds only what play
 * changes: each seat's coins, heat, vehicle and gig, the vehicles that exist near players, and the residents that have
 * been knocked off their script.
 */
import { RIDES } from '../shared/city/vehicles';
import { cityPeople, residentAt, type People, type Pose } from '../shared/city/people';
import { cityPlan, type CityPlan } from '../shared/city/plan';
import { START_COINS } from '../shared/city/economy';
import type { Vec3 } from '../shared/coords';
import type { GigOffer } from '../shared/protocol';
import type { Player, State } from './state';

/** Career totals for the ledger (saved). `peak`: highest heat reached; `drove`, `flew`: blocks covered. */
export type CityStats = { earned: number; gigs: number; bonks: number; busts: number; escapes: number; peak: number; drove: number; flew: number; kos: number };
export const newStats = (): CityStats => ({ earned: 0, gigs: 0, bonks: 0, busts: 0, escapes: 0, peak: 0, drove: 0, flew: 0, kos: 0 });
export const STAT_KEYS = ['earned', 'gigs', 'bonks', 'busts', 'escapes', 'peak', 'drove', 'flew', 'kos'] as const;
/** What a save keeps of a seat's city life. */
export type CityRecord = { coins: number; own: number; flat: number; plot: number; stats: CityStats };
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
  own: record?.own ?? 0, flat: record?.flat ?? -1, plot: record?.plot ?? -1, dizzyUntil: 0, bonkedAt: -1e9, sendAt: 0, toldAt: -1e9, speed: 0, rx: 0, rz: 0, stats: record ? { ...record.stats } : newStats(),
});

export function newCityState(seed: number, minutes: number): CityState {
  const plan = cityPlan(seed), people = cityPeople(seed), n = people.list.length, bayCells = new Map<number, number[]>();
  plan.bays.forEach((bay, index) => {
    if (bay.kind < 0) return;
    const key = cellKey(bay.x, bay.z, 6);
    bayCells.set(key, [...bayCells.get(key) ?? [], index]);
  });
  return {
    plan, people, players: [], vehicles: [], npcs: new Map(), cells: new Map(), rx: new Float32Array(n), rz: new Float32Array(n), rcell: new Int32Array(n).fill(-1), ract: new Uint8Array(n),
    emptied: new Set(), parked: new Map(), bayCells, boxes: new Map(), tills: new Map(), news: null, endsAt: minutes * 60, extras: 0, frame: null, paths: 0,
  };
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
