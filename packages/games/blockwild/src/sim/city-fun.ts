/**
 * Gadgets and stunts: what a player throws, drops, plays or floats under. Cream pies and disguise kits (the first
 * helping) live here with the water balloon, the banana peel, the smoke puff and the parasol; so does giving a friend coins.
 */
import { MISCHIEF } from '../shared/city/economy';
import { lookVector } from '../shared/coords';
import { countItem, takeOne } from '../shared/inventory';
import { I } from '../shared/items';
import { IF, NS, type Input } from '../shared/protocol';
import { stamp } from './city-career';
import { news, playersNear, seatOf, whereIs, type CityState, type Peel } from './city-state';
import { bonk, goLive, mischief, splatPlayer } from './city-watch';
import { impulse } from './combat';
import { spawnItem } from './entities';
import { addFx, toast, type Player, type State } from './state';

/** A peel lies this long; a puff of smoke hangs this long and hides this far; a balloon soaks this far round where it lands. */
export const PEEL_SECONDS = 120, SMOKE_SECONDS = 7, SMOKE_REACH = 4.5, SOAK_REACH = 2.6, MAX_PEELS = 32;
/** A canopy after bailing out is free for this long; a glide counts for the stamp from this many blocks of height. */
const BAIL_SECONDS = 40, GLIDE_STAMP = 8;

/** Whoever the player is looking at within `range`: a resident (index), a player (seat), or nothing; and how far. */
function aim(state: State, player: Player, range: number): { npc: number; seat: number; d: number } {
  const city = state.city!, [lx, , lz] = lookVector(player.yaw, 0), found = { npc: -1, seat: -1, d: range };
  const ahead = (x: number, z: number) => { const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz); return d > 0.6 && d < found.d && (dx * lx + dz * lz) / d > 0.93 ? d : -1; };
  for (const [i, npc] of city.npcs) { const d = ahead(npc.x, npc.z); if (d > 0) Object.assign(found, { npc: i, seat: -1, d }); }
  for (let cz = Math.floor(player.z - range) >> 4; cz <= Math.floor(player.z + range) >> 4; cz++) for (let cx = Math.floor(player.x - range) >> 4; cx <= Math.floor(player.x + range) >> 4; cx++) {
    for (const i of city.cells.get(cx + (cz << 12)) ?? []) { const at = whereIs(state, i), d = at ? ahead(at.x, at.z) : -1; if (d > 0) Object.assign(found, { npc: i, seat: -1, d }); }
  }
  if (state.settings.bonks) for (const other of state.players) {
    if (other === player || !other.connected || other.dead || city.players[other.seat]!.ride) continue;
    const d = ahead(other.x, other.z);
    if (d > 0) Object.assign(found, { npc: -1, seat: other.seat, d });
  }
  return found;
}

/** A cream pie flies at whoever the thrower is looking at within nine blocks. */
function throwPie(state: State, player: Player, slot: number): boolean {
  const [lx, , lz] = lookVector(player.yaw, 0), hit = aim(state, player, 9);
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  player.swing++;
  if (hit.seat >= 0) splatPlayer(state, player, state.players[hit.seat]!);
  else if (hit.npc < 0 || !bonk(state, player, hit.npc, true)) addFx(state, 'splat', player.x + lx * 6, player.y + 0.4, player.z + lz * 6);
  return true;
}
/** A water balloon bursts where it lands (or on whoever it was thrown at): everyone near is soaked. Fires hate it (sim/city-events.ts). */
function throwBalloon(state: State, player: Player, slot: number): boolean {
  const city = state.city!, [lx, , lz] = lookVector(player.yaw, 0), hit = aim(state, player, 11), d = hit.d < 11 ? hit.d : 8, x = player.x + lx * d, z = player.z + lz * d;
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  player.swing++;
  addFx(state, 'water', x, player.y + 0.6, z);
  city.splashes.push({ x, z, by: player.seat });
  let soaked = 0;
  const wet = (i: number, nx: number, nz: number, officer: boolean) => {
    if (Math.hypot(nx - x, nz - z) > SOAK_REACH || soaked >= 6) return;
    // Officers splutter and stand there; everyone else runs for cover.
    if (goLive(state, i, officer ? NS.DIZZY : NS.FLEE, officer ? 2.4 : 4, player.seat)) soaked++;
  };
  for (const [i, npc] of city.npcs) wet(i, npc.x, npc.z, npc.officer);
  for (let cz = Math.floor(z - 4) >> 4; cz <= Math.floor(z + 4) >> 4; cz++) for (let cx = Math.floor(x - 4) >> 4; cx <= Math.floor(x + 4) >> 4; cx++) {
    for (const i of city.cells.get(cx + (cz << 12)) ?? []) if (!city.npcs.has(i)) wet(i, city.rx[i]!, city.rz[i]!, city.people.list[i]!.job === 'officer');
  }
  if (state.settings.bonks) for (const other of playersNear(state, x, z, SOAK_REACH)) {
    if (other === player || city.players[other.seat]!.ride || state.clock < other.protectedUntil) continue;
    const dx = other.x - x, dz = other.z - z, far = Math.hypot(dx, dz) || 1;
    impulse(state, other, dx / far * 4, 4, dz / far * 4);
    other.hurt++;
  }
  if (soaked) mischief(state, player, MISCHIEF.pie, false);
  return true;
}
/** A banana peel is left where the player stands. The next officer, resident on the run or player to tread on it goes flying. */
function dropPeel(state: State, player: Player, slot: number): boolean {
  const city = state.city!;
  if (seatOf(state, player).ride) return false;
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  // An item nobody can pick up: every screen already knows how to draw one lying on the ground.
  const item = spawnItem(state, player.x, player.y + 0.3, player.z, { id: I.banana_peel, n: 1 }, { delay: 1e9, vx: 0, vy: 0, vz: 0 });
  if (!item) return false;
  city.peels.push({ item: item.id, x: player.x, z: player.z, until: state.clock + PEEL_SECONDS, by: player.seat, at: state.clock });
  while (city.peels.length > MAX_PEELS) removePeel(state, city.peels[0]!);
  return true;
}
function removePeel(state: State, peel: Peel) {
  const city = state.city!, at = state.items.findIndex(item => item.id === peel.item);
  if (at >= 0) state.items.splice(at, 1);
  city.peels.splice(city.peels.indexOf(peel), 1);
}
/** A puff of smoke: the Watch cannot see into it or out of it, and officers on the player's heels lose the scent. */
function puff(state: State, player: Player, slot: number): boolean {
  const city = state.city!, cp = seatOf(state, player);
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  city.smokes.push({ x: player.x, z: player.z, until: state.clock + SMOKE_SECONDS });
  addFx(state, 'smoke', player.x, player.y + 1, player.z, SMOKE_SECONDS);
  cp.seenAt = Math.min(cp.seenAt, state.clock - 3);
  for (const npc of city.npcs.values()) if (npc.officer && npc.target === player.seat) Object.assign(npc, { path: null, pathAt: state.clock + 2.5, s: NS.STAND, vx: 0, vz: 0 });
  return true;
}
/** True when smoke hangs between the Watch and (x, z): either end of a line of sight in a cloud hides it. */
export const smoked = (city: CityState, x: number, z: number) => city.smokes.some(smoke => (smoke.x - x) ** 2 + (smoke.z - z) ** 2 < SMOKE_REACH ** 2);

function useDisguise(state: State, player: Player, slot: number): boolean {
  const cp = seatOf(state, player);
  if (cp.heat <= 0) { toast(player, 'Nobody is looking for you.'); return false; }
  if (state.clock - cp.seenAt < 3) { toast(player, 'Not while they are watching!'); return false; }
  player.inv[slot] = takeOne(player.inv[slot] ?? null);
  cp.heat = Math.max(0, cp.heat - 40);
  if (cp.heat <= 0) cp.spell = 0;
  toast(player, cp.heat > 0 ? 'A false nose and glasses: some of the heat is off.' : 'A false nose and glasses: nobody knows you.');
  addFx(state, 'levelup', player.x, player.y + 1, player.z);
  return true;
}

/** `useItem` on a gadget: true or false when it was one, null to let the ordinary rules run (food). */
export function useGadget(state: State, player: Player, slot: number): boolean | null {
  switch (player.inv[slot]?.id) {
    case I.cream_pie: return throwPie(state, player, slot);
    case I.water_balloon: return throwBalloon(state, player, slot);
    case I.banana_peel: return dropPeel(state, player, slot);
    case I.smoke_puff: return puff(state, player, slot);
    case I.disguise_kit: return useDisguise(state, player, slot);
    default: return null;
  }
}

/** Give another player coins (within a few steps): how friends bankroll each other. */
export function give(state: State, player: Player, seat: number, coins: number): boolean {
  const cp = seatOf(state, player), other = state.players[seat];
  if (!other || other === player || !other.connected || coins < 1 || coins > 5000 || Math.hypot(other.x - player.x, other.z - player.z) > 8) return false;
  if (cp.coins < coins) { toast(player, `You only have ${cp.coins} coins.`); return false; }
  cp.coins -= coins;
  state.city!.players[seat]!.coins += coins;
  toast(player, `You gave ${other.name} ${coins} coins.`);
  toast(other, `${player.name} gave you ${coins} coins.`);
  addFx(state, 'coins', other.x, other.y + 1.2, other.z, Math.min(99, coins));
  stamp(state, player, 'gift');
  if (coins >= 200) news(state, `${player.name} handed ${other.name} ${coins} coins`);
  return true;
}

/** Leaving an aircraft in mid-air comes with a canopy. */
export function bailOut(state: State, player: Player) { seatOf(state, player).chuteUntil = state.clock + BAIL_SECONDS; }
/** May this player open a canopy now? */
export const mayGlide = (state: State, player: Player) => state.clock < seatOf(state, player).chuteUntil || countItem(player.inv, I.parasol) > 0;
/**
 * A player's input says whether they are under a canopy (IF.CHUTE). While they may be, the fall they are in does not
 * count: the height fallen from follows them down, so landing is soft. Called before the move itself is checked.
 */
export function glide(state: State, player: Player, input: Input) {
  const cp = seatOf(state, player), was = cp.gliding;
  cp.gliding = (input.f & IF.CHUTE) !== 0 && !cp.ride && !player.dead && mayGlide(state, player);
  if (cp.gliding && !was) { cp.glideFrom = player.y; addFx(state, 'chute', player.x, player.y + 2, player.z); }
  if (cp.gliding) player.fallPeak = Math.min(player.fallPeak, input.p[1] + 2.5);
  else if (was) {
    cp.chuteUntil = Math.min(cp.chuteUntil, state.clock + 1.5);
    if (cp.glideFrom - player.y >= GLIDE_STAMP) stamp(state, player, 'chute');
  }
}

/** Peels and smoke, a few times a second. */
export function tickFun(state: State) {
  const city = state.city!;
  while (city.smokes.length && state.clock >= city.smokes[0]!.until) city.smokes.shift();
  city.splashes.length = 0;
  if (!city.peels.length) return;
  for (const peel of city.peels.slice()) {
    if (state.clock >= peel.until || !state.items.some(item => item.id === peel.item)) { removePeel(state, peel); continue; }
    let slipped = false;
    // Live residents (officers giving chase, anybody on the run) and players on foot; the scripted crowd steps round it.
    for (const [i, npc] of city.npcs) {
      if (npc.s === NS.DIZZY || npc.s === NS.STAND || npc.s === NS.HAIL || (npc.x - peel.x) ** 2 + (npc.z - peel.z) ** 2 > 0.9) continue;
      goLive(state, i, NS.DIZZY, npc.officer ? 3.4 : 3, npc.target);
      const speed = Math.hypot(npc.vx, npc.vz) || 1;
      Object.assign(npc, { vx: npc.vx / speed * 7, vz: npc.vz / speed * 7, vy: 6, onGround: false, path: null });
      addFx(state, 'slip', npc.x, npc.y + 0.4, npc.z);
      slipped = true;
      break;
    }
    if (!slipped) for (const player of state.players) {
      const cp = city.players[player.seat]!;
      if (!player.connected || player.dead || cp.ride || state.clock < player.protectedUntil || state.clock - cp.slipAt < 3 || (player.x - peel.x) ** 2 + (player.z - peel.z) ** 2 > 0.8) continue;
      // The one who dropped it gets two seconds to step clear.
      if (player.seat === peel.by && state.clock - peel.at < 2) continue;
      const [lx, , lz] = lookVector(player.yaw, 0);
      cp.slipAt = state.clock;
      cp.dizzyUntil = state.clock + 1.4;
      player.hurt++;
      impulse(state, player, lx * 7, 5, lz * 7);
      addFx(state, 'slip', player.x, player.y + 0.4, player.z);
      slipped = true;
      break;
    }
    if (slipped) removePeel(state, peel);
  }
}
