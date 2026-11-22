/**
 * Caper City's vehicles: the table of kinds and `stepRide`, the arcade physics a driver's own screen runs (the server
 * only checks the result against the kind's envelope, as it does for walking). Ground vehicles are a bicycle model
 * swept through the voxel world as two square probes (nose and tail); the helicopter and the plane fly.
 */
import { isWater } from '../blocks';
import type { CellReader } from '../chunk';
import { moveBox, regionCollides } from '../physics';
import { CITY_BOUNDS } from './plan';

export type RideKind = {
  key: string; name: string;
  /** Width, length and height in blocks; seats (the first drives); wheels drawn (0 for aircraft skids are part of the body). */
  w: number; l: number; h: number; seats: number; wheels: 0 | 2 | 4;
  /** Top speed (m/s), acceleration and braking (m/s²), cornering grip (m/s² sideways) and the tightest turn (blocks). */
  top: number; accel: number; brake: number; grip: number; turn: number;
  air?: 'heli' | 'plane';
  /** Dealer price in coins (0: not for sale). */
  price: number;
};
/** Indexes are wire and save values: append only. */
export const RIDES: readonly RideKind[] = [
  { key: 'zipster', name: 'Zipster scooter', w: 0.7, l: 1.9, h: 1.2, seats: 1, wheels: 2, top: 14, accel: 9, brake: 16, grip: 13, turn: 3, price: 120 },
  { key: 'pebble', name: 'Pebble hatchback', w: 1.8, l: 3.6, h: 1.5, seats: 4, wheels: 4, top: 19, accel: 7, brake: 18, grip: 12, turn: 5, price: 300 },
  { key: 'mule', name: 'Mule pickup', w: 1.9, l: 4.4, h: 1.7, seats: 2, wheels: 4, top: 17, accel: 6, brake: 16, grip: 11, turn: 6, price: 420 },
  { key: 'breadbox', name: 'Breadbox van', w: 2.0, l: 4.6, h: 2.2, seats: 2, wheels: 4, top: 16, accel: 5.5, brake: 15, grip: 10, turn: 6.5, price: 480 },
  { key: 'hopper', name: 'Hopper cab', w: 1.8, l: 4.0, h: 1.6, seats: 4, wheels: 4, top: 20, accel: 7.5, brake: 18, grip: 12, turn: 5.5, price: 380 },
  { key: 'comet', name: 'Comet coupé', w: 1.8, l: 4.0, h: 1.3, seats: 2, wheels: 4, top: 27, accel: 11, brake: 22, grip: 16, turn: 6, price: 1400 },
  { key: 'hornet', name: 'Hornet motorbike', w: 0.7, l: 2.2, h: 1.2, seats: 2, wheels: 2, top: 25, accel: 12, brake: 20, grip: 15, turn: 4, price: 900 },
  { key: 'cruiser', name: 'Watch cruiser', w: 1.9, l: 4.2, h: 1.6, seats: 4, wheels: 4, top: 24, accel: 9, brake: 20, grip: 14, turn: 5.5, price: 0 },
  { key: 'dragonfly', name: 'Dragonfly helicopter', w: 2.2, l: 5.0, h: 2.4, seats: 4, wheels: 0, top: 17, accel: 8, brake: 8, grip: 0, turn: 0, air: 'heli', price: 3500 },
  { key: 'jumper', name: 'Puddle Jumper plane', w: 2.0, l: 5.2, h: 2.0, seats: 2, wheels: 0, top: 30, accel: 7, brake: 10, grip: 9, turn: 9, air: 'plane', price: 2800 },
];
export const RIDE = Object.fromEntries(RIDES.map((kind, index) => [kind.key, index])) as Record<string, number>;
/** Paint colours (a vehicle's `paint` indexes this); cabs and cruisers always wear their own. */
export const PAINTS = [0xd8403a, 0x3a7fd0, 0xf2c23e, 0x4f9d58, 0xf1ead6, 0x2b2f3a, 0xe98f4c, 0x8a5ad0] as const;
export const paintOf = (kind: number, paint: number) => kind === RIDE.hopper ? 0xf2c23e : kind === RIDE.cruiser ? 0x26386e : PAINTS[paint % PAINTS.length]!;

/** A vehicle being driven: centre of the footprint at ground contact height, heading (the player's yaw convention), forward speed. */
export type Ride = { x: number; y: number; z: number; yaw: number; speed: number; vy: number; onGround: boolean; pitch: number; inWater: boolean;
  /** Forward speed lost to an impact in the last step (m/s): the client turns it into a crash. */
  crash: number };
export type RideInput = { throttle: number; steer: number; brake: boolean; up: boolean; down: boolean };
export const newRide = (x: number, y: number, z: number, yaw: number): Ride => ({ x, y, z, yaw, speed: 0, vy: 0, onGround: true, pitch: 0, inWater: false, crash: 0 });

const GRAVITY = 32, STEP = 1 / 60, CLIMB = 1.05, TAKEOFF = 13, STALL = 11;
const approach = (value: number, target: number, rate: number, dt: number) => value + Math.max(-rate * dt, Math.min(rate * dt, target - value));
const probe: number[] = [0, 0, 0, 0, 0, 0];
/** How far a square probe at (x, y, z) may move of (dx, dy, dz). */
function sweep(getCell: CellReader, x: number, y: number, z: number, half: number, height: number, dx: number, dy: number, dz: number) {
  probe[0] = x - half; probe[1] = y; probe[2] = z - half; probe[3] = x + half; probe[4] = y + height; probe[5] = z + half;
  return moveBox(getCell, probe, dx, dy, dz);
}
const least = (a: number, b: number) => Math.abs(a) < Math.abs(b) ? a : b;

function substep(r: Ride, kind: RideKind, input: RideInput, dt: number, getCell: CellReader) {
  const half = kind.w / 2, reach = Math.max(0, kind.l / 2 - half), height = Math.min(kind.h, 1.5), flying = !!kind.air && !r.onGround;
  r.inWater = isWater(getCell(Math.floor(r.x), Math.floor(r.y + 0.4), Math.floor(r.z)));
  const top = r.inWater ? 2.5 : kind.top, throttle = Math.max(-1, Math.min(1, input.throttle)), steer = Math.max(-1, Math.min(1, input.steer));
  let yawRate = 0;
  if (kind.air === 'heli') {
    // Forward and back tilt, turning on the spot, up and down on the buttons; it settles when it touches down.
    r.speed = approach(r.speed, throttle * top * (throttle < 0 ? 0.5 : 1), kind.accel, dt);
    yawRate = steer * 1.7;
    r.vy = approach(r.vy, input.up ? 7 : input.down ? -7 : r.onGround ? -1 : 0, 14, dt);
    r.pitch = approach(r.pitch, -r.speed / top * 0.22, 1.2, dt);
    if (r.onGround && !input.up) r.speed = approach(r.speed, 0, 12, dt);
  } else if (kind.air === 'plane' && flying) {
    // In the air the throttle sets the cruise, up and down pitch the nose; below stalling speed it sinks.
    r.speed = approach(r.speed, top * (throttle > 0 ? 1 : throttle < 0 ? 0.5 : 0.72), kind.accel, dt);
    r.pitch = approach(r.pitch, input.up ? 0.38 : input.down ? -0.42 : 0, 0.9, dt);
    yawRate = steer * 0.95;
    r.vy = r.speed * r.pitch - Math.max(0, STALL - r.speed) * 1.6;
  } else {
    // On wheels: throttle, brakes and rolling drag; steering turns with speed, up to the grip the tyres have.
    const braking = input.brake || throttle * r.speed < -0.2;
    if (braking) r.speed = approach(r.speed, 0, kind.brake * (input.brake ? 1.2 : 1), dt);
    else if (throttle) r.speed = approach(r.speed, throttle > 0 ? top * throttle : top * 0.35 * throttle, kind.accel * (throttle < 0 ? 0.7 : 1), dt);
    else r.speed = approach(r.speed, 0, 2.2 + Math.abs(r.speed) * 0.25, dt);
    const pace = Math.abs(r.speed);
    yawRate = steer * Math.min(pace / kind.turn, kind.grip / Math.max(pace, 1)) * Math.sign(r.speed || 1);
    r.vy = Math.max(r.vy - GRAVITY * dt, -60);
    r.pitch = 0;
    if (kind.air === 'plane' && pace > TAKEOFF && input.up) { r.vy = 4; r.onGround = false; r.pitch = 0.2; }
  }
  // Turn only if the nose and tail stay clear at the new heading.
  const yaw = r.yaw - yawRate * dt, sin = Math.sin(yaw), cos = Math.cos(yaw);
  const blocked = (x: number, z: number) => regionCollides(getCell, x - half, r.y + 0.05, z - half, x + half, r.y + height, z + half, 0.02);
  const swung = reach > 0 && yawRate !== 0 && (blocked(r.x - sin * reach, r.z - cos * reach) || blocked(r.x + sin * reach, r.z + cos * reach)) && !(blocked(r.x - Math.sin(r.yaw) * reach, r.z - Math.cos(r.yaw) * reach) || blocked(r.x + Math.sin(r.yaw) * reach, r.z + Math.cos(r.yaw) * reach));
  if (!swung) r.yaw = yaw;
  const fx = -Math.sin(r.yaw), fz = -Math.cos(r.yaw), dx = fx * r.speed * dt, dz = fz * r.speed * dt, dy = r.vy * dt;
  const move = (lift: number): [number, number, number] => {
    const a = sweep(getCell, r.x + fx * reach, r.y + lift, r.z + fz * reach, half, height, dx, dy, dz), b = reach ? sweep(getCell, r.x - fx * reach, r.y + lift, r.z - fz * reach, half, height, dx, dy, dz) : a;
    return [least(a[0], b[0]), least(a[1], b[1]), least(a[2], b[2])];
  };
  let moved = move(0), lift = 0;
  const wanted = Math.hypot(dx, dz), went = () => Math.hypot(moved[0], moved[2]);
  // A kerb, a step in the sand: wheels climb one block.
  if (went() < wanted - 1e-6 && r.onGround && !kind.air) {
    const lifted = move(CLIMB);
    if (Math.hypot(lifted[0], lifted[2]) > went() + 1e-6) { moved = lifted; lift = CLIMB; }
  }
  r.x += moved[0];
  r.y += moved[1] + lift;
  r.z += moved[2];
  const landed = dy < 0 && moved[1] > dy + 1e-7;
  if (landed || (dy > 0 && moved[1] < dy - 1e-7)) r.vy = 0;
  r.onGround = landed && !lift || (kind.air === 'heli' ? landed : r.onGround && dy <= 0 && Math.abs(moved[1] - dy) > 1e-7);
  if (wanted > 1e-6 && went() < wanted * 0.6) {
    // Hit something: lose the speed that went into it and bounce off a little.
    const lost = Math.abs(r.speed) * (1 - went() / wanted);
    r.crash = Math.max(r.crash, lost);
    r.speed *= lost > 3 ? -0.18 : 0.3;
    if (flying) r.vy = Math.min(r.vy, -2);
  }
  r.x = Math.max(CITY_BOUNDS.x0, Math.min(CITY_BOUNDS.x1, r.x));
  r.z = Math.max(CITY_BOUNDS.z0, Math.min(CITY_BOUNDS.z1, r.z));
  if (r.y > CITY_BOUNDS.top) { r.y = CITY_BOUNDS.top; r.vy = Math.min(0, r.vy); }
}

/** Advance a driven vehicle by dt seconds in fixed sub-steps. `r.crash` holds the hardest impact of the call. */
export function stepRide(r: Ride, kind: RideKind, input: RideInput, dt: number, getCell: CellReader): void {
  const total = Math.min(Math.max(dt, 0), 0.25), steps = Math.max(1, Math.ceil(total / STEP - 1e-9));
  r.crash = 0;
  for (let i = 0; i < steps; i++) substep(r, kind, input, total / steps, getCell);
}
/** The four corners of a vehicle's footprint as [x, z] pairs (for drawing it on the map and for hit tests). */
export function rideHits(kind: RideKind, x: number, z: number, yaw: number, px: number, pz: number, margin = 0): boolean {
  const dx = px - x, dz = pz - z, fx = -Math.sin(yaw), fz = -Math.cos(yaw), along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  return Math.abs(along) <= kind.l / 2 + margin && Math.abs(across) <= kind.w / 2 + margin;
}
