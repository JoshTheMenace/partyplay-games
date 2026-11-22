/**
 * Vehicles on the server: the ones the seed parked near players, the traffic that flows on lane rails around them, and
 * the ones players ride. A ridden vehicle is its driver's body: the driver's screen simulates it and the server checks
 * each move against the vehicle's envelope (sim/players.ts), then copies the driver's pose onto the vehicle here.
 */
import { CITY, crossX, crossZ, GROUND, type Bay } from '../shared/city/plan';
import { isSolid } from '../shared/blocks';
import { RIDE, RIDES, rideHits } from '../shared/city/vehicles';
import { MISCHIEF, scrapValue } from '../shared/city/economy';
import { bodyCollides } from '../shared/physics';
import { NS, q2, RF, type PubRide } from '../shared/protocol';
import { teleport } from './players';
import { addFx, nextId, toast, type Player, type State } from './state';
import { anyPlayerNear, crowdNear, kindOf, news, rideOf, seatOf, vehicleOf, type CityState, type Rail, type Vehicle } from './city-state';
import { addExtra, earn, mischief } from './city-watch';

const N = CITY.n;
/** Unit steps and yaws of the four headings (N, E, S, W), and how far right of the road's middle a lane runs. */
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0], YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2], LANE = 1.5;
/** Where the lanes meet the intersection box, and where a car waits for it. */
const BOX_IN = CITY.pitch - 8, BOX_OUT = 8, WAIT_AT = BOX_IN - 3;
const PARK_RANGE = 96, CLEAR_RANGE = 128, TRAFFIC_RANGE = 112, TRAFFIC_NEAR = 68, ABANDONED = 150;
/** How fast an empty aircraft comes down (blocks a second). */
const SINK = 7;
/** Traffic kinds, weighted (hatchbacks, pickups, vans, cabs, the odd scooter and coupé). */
const TRAFFIC_KINDS = [1, 1, 1, 2, 3, 4, 4, 1, 0, 5, 6, 2];
const approach = (value: number, target: number, rate: number, dt: number) => value + Math.max(-rate * dt, Math.min(rate * dt, target - value));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function addVehicle(state: State, k: number, x: number, y: number, z: number, yaw: number, paint: number): Vehicle {
  const vehicle: Vehicle = { id: nextId(state), k, x, y, z, yaw, paint, v: 0, pt: 0, bay: -1, driver: -1, riders: [], owner: -1, rail: null, idleAt: state.clock, siren: false, sink: false };
  state.city!.vehicles.push(vehicle);
  return vehicle;
}
function removeVehicle(city: CityState, vehicle: Vehicle) {
  if (vehicle.bay >= 0) city.parked.delete(vehicle.bay);
  for (const [key, id] of city.boxes) if (id === vehicle.id) city.boxes.delete(key);
  city.vehicles.splice(city.vehicles.indexOf(vehicle), 1);
}
const bayFree = (city: CityState, bay: Bay) => !city.vehicles.some(v => Math.abs(v.x - bay.x) < 3.2 && Math.abs(v.z - bay.z) < 3.2);

/** Stand the seed's parked vehicles in the bays near players, and clear parked and abandoned ones nobody is near. */
function tickParking(state: State) {
  const city = state.city!;
  for (const player of state.players) {
    if (!player.connected || (state.ticks + player.seat * 3) % 20) continue;
    for (let cz = Math.floor(player.z - PARK_RANGE) >> 6; cz <= Math.floor(player.z + PARK_RANGE) >> 6; cz++) for (let cx = Math.floor(player.x - PARK_RANGE) >> 6; cx <= Math.floor(player.x + PARK_RANGE) >> 6; cx++) {
      for (const index of city.bayCells.get(cx + (cz << 12)) ?? []) {
        const bay = city.plan.bays[index]!;
        if (city.emptied.has(index) || city.parked.has(index) || (bay.x - player.x) ** 2 + (bay.z - player.z) ** 2 > PARK_RANGE ** 2 || !bayFree(city, bay)) continue;
        const vehicle = addVehicle(state, bay.kind, bay.x, GROUND, bay.z, bay.yaw, bay.paint);
        vehicle.bay = index;
        city.parked.set(index, vehicle.id);
      }
    }
  }
  if (state.ticks % 20 !== 7) return;
  // (A copy: clearing a vehicle away shortens the list.)
  for (const vehicle of city.vehicles.slice()) {
    if (vehicle.driver >= 0 || vehicle.riders.some(seat => seat >= 0)) continue;
    const parked = vehicle.bay >= 0, stale = state.clock - vehicle.idleAt > ABANDONED;
    // Bought vehicles wait where they were left until their owner is far away; they can always be called back.
    if (vehicle.rail ? !anyPlayerNear(state, vehicle.x, vehicle.z, CLEAR_RANGE) : (parked || stale) && !anyPlayerNear(state, vehicle.x, vehicle.z, parked ? CLEAR_RANGE : 90)) removeVehicle(city, vehicle);
  }
}

// Traffic -------------------------------------------------------------------------------------------------------------
/** Where a rail position is in the world: [x, z, yaw]. */
function railPose(rail: Rail): [number, number, number] {
  const t = rail.turn;
  if (t) {
    // A quadratic curve through the corner where the two lanes would meet.
    const u = Math.min(1, t.at / t.len), cx = DX[rail.dir] ? t.x1 : t.x0, cz = DX[rail.dir] ? t.z0 : t.z1, a = (1 - u) ** 2, b = 2 * u * (1 - u), c = u * u;
    return [a * t.x0 + b * cx + c * t.x1, a * t.z0 + b * cz + c * t.z1, t.yaw0 + wrap(t.yaw1 - t.yaw0) * u];
  }
  return lanePoint(rail.kx, rail.kz, rail.dir, rail.s);
}
function lanePoint(kx: number, kz: number, dir: number, s: number): [number, number, number] {
  const dx = DX[dir]!, dz = DZ[dir]!;
  return [crossX(kx) + dx * s - dz * LANE, crossZ(kz) + dz * s + dx * LANE, YAW[dir]!];
}
const inGrid = (k: number) => k >= 0 && k <= N;
/** The heading a car takes out of intersection (kx, kz) having arrived heading `dir`: a cruiser steers for its quarry. */
function nextDir(state: State, kx: number, kz: number, dir: number, quarry: Player | null): number {
  const options = [dir, dir + 1 & 3, dir + 3 & 3].filter(d => inGrid(kx + DX[d]!) && inGrid(kz + DZ[d]!));
  if (!options.length) return dir + 2 & 3;
  if (quarry) {
    const far = (d: number) => Math.abs(crossX(kx + DX[d]!) - quarry.x) + Math.abs(crossZ(kz + DZ[d]!) - quarry.z);
    return options.reduce((best, d) => far(d) < far(best) ? d : best);
  }
  const roll = state.rand();
  return options[roll < 0.55 ? 0 : Math.min(options.length - 1, 1 + Math.floor(state.rand() * (options.length - 1)))]!;
}

/** Something is in the way ahead of a vehicle within `reach`: another vehicle, a player on foot or a resident. */
function blockedAhead(state: State, vehicle: Vehicle, reach: number): Player | true | null {
  const city = state.city!, fx = -Math.sin(vehicle.yaw), fz = -Math.cos(vehicle.yaw), nose = kindOf(vehicle).l / 2;
  const ahead = (x: number, z: number, wide: number) => { const dx = x - vehicle.x, dz = z - vehicle.z, along = dx * fx + dz * fz - nose; return along > -0.5 && along < reach && Math.abs(dx * fz - dz * fx) < wide; };
  for (const other of city.vehicles) if (other !== vehicle && Math.abs(other.x - vehicle.x) < reach + 6 && Math.abs(other.z - vehicle.z) < reach + 6 && Math.abs(other.y - vehicle.y) < 3 && ahead(other.x, other.z, 1.5 + kindOf(other).w / 2)) return true;
  for (const player of state.players) if (player.connected && !player.dead && !city.players[player.seat]!.ride && Math.abs(player.y - vehicle.y) < 3 && ahead(player.x, player.z, 1.5)) return player;
  let found = false;
  crowdNear(city, vehicle.x + fx * (nose + reach / 2), vehicle.z + fz * (nose + reach / 2), reach / 2 + 2, (_i, x, z) => { found ||= ahead(x, z, 1.4); });
  for (const npc of city.npcs.values()) found ||= ahead(npc.x, npc.z, 1.4);
  return found || null;
}

function driveRail(state: State, vehicle: Vehicle, dt: number) {
  const city = state.city!, rail = vehicle.rail!, quarry = rail.chase >= 0 ? state.players[rail.chase] ?? null : null, chasing = !!quarry && city.players[rail.chase]!.heat > 0 && !quarry.dead;
  let target = rail.cruise;
  if (quarry && !chasing) { rail.chase = -1; rail.cruise = 8; vehicle.siren = false; }
  if (chasing) {
    // Close enough to a quarry on foot: stop and let the officers out. Close behind a quarry's vehicle: hold there.
    const d = Math.hypot(quarry!.x - vehicle.x, quarry!.z - vehicle.z);
    if (d < 16 && rail.crew > 0 && !city.players[rail.chase]!.ride) {
      for (; rail.crew > 0; rail.crew--) addExtra(state, vehicle.x + Math.cos(vehicle.yaw) * (rail.crew % 2 ? 1.6 : -1.6), vehicle.y, vehicle.z - Math.sin(vehicle.yaw) * (rail.crew % 2 ? 1.6 : -1.6), true, rail.chase, NS.CHASE);
    }
    target = d < 9 ? 0 : rail.crew ? 21 : 0;
  }
  const obstacle = target > 0 ? blockedAhead(state, vehicle, 2.5 + vehicle.v * 0.7) : null;
  if (obstacle) {
    target = 0;
    rail.waited += dt;
    // A player standing in the road gets the horn.
    if (obstacle !== true && rail.waited > 1.5) { rail.waited = -2.5; addFx(state, 'horn', vehicle.x, vehicle.y + 1, vehicle.z, vehicle.k); }
  } else rail.waited = Math.min(0, rail.waited + dt);
  if (!rail.turn && rail.s >= WAIT_AT - 6) {
    // The intersection is one car's at a time; a car that has waited too long for it takes it anyway.
    const key = rail.kx + DX[rail.dir]! + (rail.kz + DZ[rail.dir]! << 4), holder = city.boxes.get(key);
    if (holder === undefined || holder === vehicle.id || chasing || !vehicleOf(city, holder)) city.boxes.set(key, vehicle.id);
    else if (rail.s >= WAIT_AT) { target = 0; rail.waited += dt; if (rail.waited > 8) city.boxes.set(key, vehicle.id); }
  }
  vehicle.v = approach(vehicle.v, target, target < vehicle.v ? 16 : chasing ? 9 : 5, dt);
  const step = vehicle.v * dt;
  if (rail.turn) {
    rail.turn.at += step;
    if (rail.turn.at >= rail.turn.len) {
      rail.kx += DX[rail.dir]!;
      rail.kz += DZ[rail.dir]!;
      rail.dir = rail.turn.next;
      rail.s = BOX_OUT + rail.turn.at - rail.turn.len;
      rail.turn = null;
    }
  } else {
    rail.s += step;
    if (rail.s > BOX_OUT + 5) for (const [key, id] of city.boxes) if (id === vehicle.id && key !== rail.kx + DX[rail.dir]! + (rail.kz + DZ[rail.dir]! << 4)) city.boxes.delete(key);
    if (rail.s >= BOX_IN) {
      const bx = rail.kx + DX[rail.dir]!, bz = rail.kz + DZ[rail.dir]!, next = nextDir(state, bx, bz, rail.dir, chasing ? quarry : null);
      const [x0, z0, yaw0] = lanePoint(rail.kx, rail.kz, rail.dir, BOX_IN), [x1, z1, yaw1] = lanePoint(bx, bz, next, BOX_OUT);
      rail.turn = { x0, z0, x1, z1, yaw0, yaw1, len: Math.max(1, (Math.abs(x1 - x0) + Math.abs(z1 - z0)) * (next === rail.dir ? 1 : 0.82)), at: rail.s - BOX_IN, next };
    }
  }
  [vehicle.x, vehicle.z, vehicle.yaw] = railPose(rail);
  vehicle.idleAt = state.clock;
}

/** Put a vehicle on the rails somewhere `near`–`far` blocks from a player and out of everyone's sight. */
function spawnOnRail(state: State, player: Player, k: number, near: number, far: number, towards: boolean): Vehicle | null {
  const city = state.city!, r = state.rand, gx = Math.round((player.x - CITY.x0 - CITY.road / 2) / CITY.pitch), gz = Math.round((player.z - CITY.z0 - CITY.road / 2) / CITY.pitch);
  for (let attempt = 0; attempt < 10; attempt++) {
    const dir = Math.floor(r() * 4), kx = gx + Math.floor(r() * 5) - 2, kz = gz + Math.floor(r() * 5) - 2, s = BOX_OUT + 4 + r() * (BOX_IN - BOX_OUT - 8);
    if (!inGrid(kx) || !inGrid(kz) || !inGrid(kx + DX[dir]!) || !inGrid(kz + DZ[dir]!)) continue;
    const [x, z, yaw] = lanePoint(kx, kz, dir, s), d = Math.hypot(x - player.x, z - player.z);
    if (d < near || d > far || anyPlayerNear(state, x, z, near) || city.vehicles.some(v => Math.abs(v.x - x) < 9 && Math.abs(v.z - z) < 9)) continue;
    // A cruiser starts out heading towards its quarry.
    if (towards && (player.x - x) * DX[dir]! + (player.z - z) * DZ[dir]! < 0) continue;
    const vehicle = addVehicle(state, k, x, GROUND, z, yaw, Math.floor(r() * 8));
    vehicle.rail = { kx, kz, dir, s, turn: null, cruise: 7.5 + r() * 3, waited: 0, chase: -1, crew: 0 };
    vehicle.v = vehicle.rail.cruise;
    return vehicle;
  }
  return null;
}
/** A cruiser sent after a seat: it arrives by road, sirens on, with two officers aboard. */
export function sendCruiser(state: State, seat: number): boolean {
  const vehicle = spawnOnRail(state, state.players[seat]!, RIDE.cruiser!, 56, 100, true);
  if (!vehicle) return false;
  Object.assign(vehicle.rail!, { chase: seat, crew: 2, cruise: 21 });
  vehicle.siren = true;
  return true;
}
export const cruisersAfter = (city: CityState, seat: number) => city.vehicles.filter(v => v.rail?.chase === seat).length;

function tickTraffic(state: State, dt: number) {
  const city = state.city!, active = state.players.filter(p => p.connected);
  if (state.ticks % 20 === 11) {
    // A handful of cars round each player, fewer each as the room fills, never more than the room's cap.
    const cap = Math.min(140, 20 + active.length * 5), each = active.length > 24 ? 4 : 6;
    let total = city.vehicles.filter(v => v.rail).length;
    for (const player of active) {
      if (total >= cap) continue;
      const near = city.vehicles.filter(v => v.rail && Math.abs(v.x - player.x) < TRAFFIC_RANGE && Math.abs(v.z - player.z) < TRAFFIC_RANGE).length;
      if (near < each && spawnOnRail(state, player, TRAFFIC_KINDS[Math.floor(state.rand() * TRAFFIC_KINDS.length)]!, TRAFFIC_NEAR, TRAFFIC_RANGE, false)) total++;
    }
  }
  for (const vehicle of city.vehicles) if (vehicle.rail && vehicle.driver < 0) driveRail(state, vehicle, dt);
}

// Riding --------------------------------------------------------------------------------------------------------------
/** Sit a player in a vehicle (seat 0 drives). The teleport tells the driver's screen where its new body is. */
function seat(state: State, player: Player, vehicle: Vehicle, place: number) {
  const cp = seatOf(state, player), kind = kindOf(vehicle), city = state.city!;
  cp.ride = vehicle.id;
  cp.seat = place;
  cp.open = -1;
  cp.offers = null;
  player.pace = kind.top;
  player.aloft = !!kind.air;
  vehicle.sink = false;
  if (place === 0) vehicle.driver = player.seat;
  else vehicle.riders[place - 1] = player.seat;
  if (vehicle.bay >= 0) { city.emptied.add(vehicle.bay); city.parked.delete(vehicle.bay); vehicle.bay = -1; }
  if (vehicle.rail) { for (const [key, id] of city.boxes) if (id === vehicle.id) city.boxes.delete(key); vehicle.rail = null; vehicle.siren = false; }
  cp.rx = vehicle.x;
  cp.rz = vehicle.z;
  teleport(state, player, vehicle.x, vehicle.y, vehicle.z, vehicle.yaw);
}
/** `interact` on a vehicle: take the wheel if it is free, else a passenger seat. */
export function enterVehicle(state: State, player: Player, id: number): boolean {
  const city = state.city!, cp = seatOf(state, player), vehicle = vehicleOf(city, id);
  if (!vehicle || cp.ride || state.clock < cp.dizzyUntil || !rideHits(kindOf(vehicle), vehicle.x, vehicle.z, vehicle.yaw, player.x, player.z, 3) || Math.abs(player.y - vehicle.y) > 3) return false;
  const kind = kindOf(vehicle);
  if (vehicle.driver >= 0) {
    const free = Array.from({ length: kind.seats - 1 }, (_, k) => k).find(k => (vehicle.riders[k] ?? -1) < 0);
    if (free === undefined) { toast(player, 'No seat free in that one.'); return false; }
    seat(state, player, vehicle, free + 1);
    return true;
  }
  if (vehicle.rail) {
    // Somebody is driving it: they are turfed out (and saw exactly who did it).
    if (vehicle.v > 5) { toast(player, 'It is going too fast to hop in.'); return false; }
    addExtra(state, vehicle.x + Math.cos(vehicle.yaw) * -1.8, vehicle.y, vehicle.z + Math.sin(vehicle.yaw) * 1.8, false, player.seat, NS.FLEE);
    mischief(state, player, vehicle.k === RIDE.cruiser ? MISCHIEF.cruiser : MISCHIEF.jack, true);
  } else if (vehicle.owner !== player.seat) mischief(state, player, vehicle.k === RIDE.cruiser ? MISCHIEF.cruiser : MISCHIEF.borrow, false);
  seat(state, player, vehicle, 0);
  addFx(state, 'door', vehicle.x, vehicle.y + 1, vehicle.z, 4);
  return true;
}
/** Get out: beside the vehicle where there is room (wherever it is, if it is in the air). */
export function exitVehicle(state: State, player: Player): boolean {
  const cp = seatOf(state, player), vehicle = rideOf(state, player);
  cp.ride = 0;
  player.pace = 0;
  player.aloft = false;
  if (!vehicle) return false;
  if (cp.seat === 0) vehicle.driver = -1;
  else vehicle.riders[cp.seat - 1] = -1;
  vehicle.v = 0;
  vehicle.idleAt = state.clock;
  const kind = kindOf(vehicle), sin = Math.sin(vehicle.yaw), cos = Math.cos(vehicle.yaw), side = kind.w / 2 + 0.75, end = kind.l / 2 + 0.75;
  // Left of the driver's seat first, then the right, behind and in front.
  const spots = [[-cos * side, sin * side], [cos * side, -sin * side], [sin * end, cos * end], [-sin * end, -cos * end]] as const;
  const spot = spots.find(([dx, dz]) => !bodyCollides(state.get, { x: vehicle.x + dx, y: vehicle.y + 0.01, z: vehicle.z + dz, sneaking: false })) ?? spots[0];
  teleport(state, player, vehicle.x + spot[0], vehicle.y + 0.01, vehicle.z + spot[1]);
  player.fallPeak = player.y;
  vehicle.sink = !!kind.air && vehicle.driver < 0 && !vehicle.riders.some(rider => rider >= 0);
  addFx(state, 'door', vehicle.x, vehicle.y + 1, vehicle.z, 0);
  return true;
}

/** Copy drivers' accepted poses onto their vehicles, carry passengers along, and count the distance. */
function tickRiders(state: State) {
  const city = state.city!;
  for (const player of state.players) {
    const cp = city.players[player.seat]!, vehicle = vehicleOf(city, cp.ride);
    if (!cp.ride) continue;
    if (!vehicle || player.dead || !player.connected) { exitVehicle(state, player); continue; }
    if (cp.seat === 0) {
      const moved = Math.hypot(player.x - cp.rx, player.z - cp.rz), kind = kindOf(vehicle);
      Object.assign(vehicle, { x: player.x, y: player.y, z: player.z, yaw: player.yaw, v: cp.speed, pt: kind.air ? player.pitch : 0, idleAt: state.clock });
      if (moved < 40) cp.stats[kind.air && !player.onGround ? 'flew' : 'drove'] += moved;
      cp.rx = player.x;
      cp.rz = player.z;
    } else {
      // A passenger's body is the vehicle's; a driver who got out leaves them sitting in a parked car.
      Object.assign(player, { x: vehicle.x, y: vehicle.y, z: vehicle.z, movedAt: state.clock, fallPeak: vehicle.y, supportY: vehicle.y });
    }
  }
}

/** Fetch a vehicle the player owns to the nearest free bay (or sell the one being driven for scrap). */
export function callVehicle(state: State, player: Player, k: number): boolean {
  const city = state.city!, cp = seatOf(state, player);
  if (!(cp.own >> k & 1) || cp.ride) return false;
  if (cp.heat >= 10) { toast(player, 'Not while the Watch is after you.'); return false; }
  const bays = city.plan.bays.filter(bay => Math.abs(bay.x - player.x) < 70 && Math.abs(bay.z - player.z) < 70 && (RIDES[k]!.air ? bay.kind >= 8 : bay.kind < 8) && bayFree(city, bay));
  const bay = bays.sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
  if (!bay) { toast(player, RIDES[k]!.air ? 'Aircraft are delivered to Gullwing Field.' : 'No free parking bay near here.'); return false; }
  for (const old of city.vehicles.filter(v => v.owner === player.seat && v.k === k && v.driver < 0)) removeVehicle(city, old);
  const vehicle = addVehicle(state, k, bay.x, GROUND, bay.z, bay.yaw, player.seat % 8);
  vehicle.owner = player.seat;
  toast(player, `Your ${RIDES[k]!.name} is parked ${Math.round(Math.hypot(bay.x - player.x, bay.z - player.z))} blocks away.`);
  return true;
}
export function scrapVehicle(state: State, player: Player): boolean {
  const city = state.city!, cp = seatOf(state, player), vehicle = rideOf(state, player), yard = city.plan.byKind('scrap')[0];
  if (!vehicle || cp.seat !== 0 || !yard) return false;
  const lot = city.plan.lots[yard.lot]!;
  if (player.x < lot.x0 - 6 || player.x > lot.x1 + 7 || player.z < lot.z0 - 6 || player.z > lot.z1 + 7) { toast(player, 'Drive it into the Scrap & Swap yard first.'); return false; }
  if (vehicle.k === RIDE.cruiser) { toast(player, 'Too hot to handle: nobody scraps a Watch cruiser.'); return false; }
  const value = scrapValue(vehicle.k);
  if (vehicle.owner === player.seat) cp.own &= ~(1 << vehicle.k);
  for (const rider of state.players) if (city.players[rider.seat]!.ride === vehicle.id) exitVehicle(state, rider);
  removeVehicle(city, vehicle);
  earn(state, player, value);
  addFx(state, 'crash', player.x, player.y + 1, player.z);
  news(state, `${player.name} scrapped a ${RIDES[vehicle.k]!.name} for ${value} coins`);
  return true;
}

/** An aircraft nobody is flying has no lift: it settles onto whatever is under it (and is sent as moving until it has). */
function tickSinking(state: State) {
  for (const vehicle of state.city!.vehicles) if (vehicle.sink) {
    const y = vehicle.y - SINK / 20, under = Math.floor(y);
    if (under < 1 || isSolid(state.get(Math.floor(vehicle.x), under, Math.floor(vehicle.z)))) Object.assign(vehicle, { y: under + 1, sink: false, idleAt: state.clock });
    else vehicle.y = y;
  }
}

export function tickRides(state: State, dt: number) {
  tickRiders(state);
  tickSinking(state);
  tickParking(state);
  tickTraffic(state, dt);
}

/** A vehicle as the wire sees it. */
export function rideView(vehicle: Vehicle): PubRide {
  const moving = vehicle.driver >= 0 || !!vehicle.rail || vehicle.sink, view: PubRide = {
    id: vehicle.id, k: vehicle.k, x: vehicle.x, y: vehicle.y, z: vehicle.z, yaw: q2(wrap(vehicle.yaw)), paint: vehicle.paint,
    f: (moving ? 0 : RF.ASLEEP) | (vehicle.driver >= 0 ? RF.DRIVEN : 0) | (vehicle.siren ? RF.SIREN : 0) | (vehicle.rail ? RF.TRAFFIC : 0) | (vehicle.owner >= 0 ? RF.OWNED : 0), v: vehicle.v,
  };
  if (vehicle.pt) view.pt = vehicle.pt;
  return view;
}
