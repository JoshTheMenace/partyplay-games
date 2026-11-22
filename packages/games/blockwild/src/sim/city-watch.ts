/**
 * Consequences: Heat, the Watch and the residents who get caught up in it. Mischief raises a player's heat only when
 * a resident or an officer sees it. Heat brings officers (walking over at first, then running, then cruisers); an
 * officer who keeps hold of a player for GRAB_SECONDS makes the arrest. Residents knocked off their script (bonked,
 * fleeing, stopping to talk) are simulated here as live bodies and walk back to their script afterwards.
 */
import { STEP_HEIGHT } from '../shared/constants';
import { ACT, residentAt, type Pose } from '../shared/city/people';
import { CITY, NODES, nodeAt } from '../shared/city/plan';
import { clinicBill, COOL_AFTER, COOLING, COOLING_HOME, fineFor, heatTier, HEAT_NAMES, MISCHIEF, WITNESS } from '../shared/city/economy';
import { I } from '../shared/items';
import { EXTRA_OFFICERS, NS, q2, type PubNpc } from '../shared/protocol';
import { impulse } from './combat';
import { spawnItem } from './entities';
import { lineOfSight } from './mobs';
import { moveBody } from './motion';
import { findPath } from './pathfind';
import { teleport } from './players';
import { addFx, PROTECT_SECONDS, toast, type Player, type State } from './state';
import { cruisersAfter, exitVehicle, sendCruiser } from './city-rides';
import { crowdNear, news, playersNear, rideOf, seatOf, whereIs, type CityPlayer, type Npc } from './city-state';

export const GRAB_SECONDS = 1.2;
const OFFICER_SIGHT = 34, GRAB_REACH = 2.2, RUN = [0, 2.1, 4.9, 5.3, 5.7], FLEE_SPEED = 4.6, HOME_SPEED = 2.2, LOOT: readonly number[] = [I.coin_purse, I.gold_watch, I.swag_bag];
const pose: Pose = { x: 0, z: 0, yaw: 0, act: 0, hidden: false, moving: false };
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Pay a player (gigs, loot, scrap): counts towards the ledger's earnings. */
export function earn(state: State, player: Player, coins: number) {
  const cp = seatOf(state, player);
  cp.coins += coins;
  cp.stats.earned += coins;
  addFx(state, 'coins', player.x, player.y + 1.2, player.z, Math.min(99, coins));
}

// Live residents -------------------------------------------------------------------------------------------------------
/** Knock resident `i` off their script into state `s` for `seconds`, standing where the script has them. */
export function goLive(state: State, i: number, s: number, seconds: number, target = -1): Npc | null {
  const city = state.city!, at = whereIs(state, i);
  if (!at) return null;
  let npc = city.npcs.get(i);
  if (!npc) {
    const officer = city.people.list[i]?.job === 'officer';
    city.npcs.set(i, npc = { i, x: at.x, y: 64, z: at.z, vx: 0, vy: 0, vz: 0, yaw: at.yaw, onGround: true, s, until: 0, officer, extra: false, target, path: null, pathIndex: 0, pathAt: 0, stuck: 0, angry: false });
  }
  Object.assign(npc, { s, until: state.clock + seconds, target });
  return npc;
}
/** An extra body with no script: a reinforcement officer, a driver turfed out of a car, a cab rider waiting at the kerb. */
export function addExtra(state: State, x: number, y: number, z: number, officer: boolean, target: number, s: number): Npc {
  // Extras count on from the roster; officers from EXTRA_OFFICERS further, so a screen knows which uniform to draw.
  const city = state.city!, i = city.people.list.length + (officer ? EXTRA_OFFICERS : 0) + city.extras++ % EXTRA_OFFICERS;
  const npc: Npc = { i, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: false, s, until: state.clock + (officer ? 1e9 : 12), officer, extra: true, target, path: null, pathIndex: 0, pathAt: 0, stuck: 0, angry: false };
  city.npcs.set(i, npc);
  return npc;
}

/** A resident or officer near enough (and with a clear view) to have seen what a player just did. 2: an officer saw it. */
function witnessed(state: State, player: Player, victim = -1): 0 | 1 | 2 {
  const city = state.city!, eye = player.y + 1.5, sees = (x: number, z: number) => lineOfSight(state, x, 65.5, z, player.x, eye, player.z);
  let seen: 0 | 1 | 2 = 0, checks = 0;
  for (const npc of city.npcs.values()) if (npc.officer && npc.s !== NS.DIZZY && Math.hypot(npc.x - player.x, npc.z - player.z) < OFFICER_SIGHT && sees(npc.x, npc.z)) return 2;
  crowdNear(city, player.x, player.z, WITNESS * 2, (i, x, z) => {
    if (seen === 2 || i === victim || checks > 6 || city.npcs.get(i)?.s === NS.DIZZY) return;
    const resident = city.people.list[i]!, d = Math.hypot(x - player.x, z - player.z);
    if (d > (resident.snitch || resident.job === 'officer' ? WITNESS * 2 : WITNESS)) return;
    checks++;
    if (sees(x, z)) seen = resident.job === 'officer' ? 2 : 1;
  });
  // Another player's eyes do not count: only the city tells the Watch.
  return seen;
}
/** A player did something the Watch frowns on. `certain`: the victim themselves saw it (a driver pulled from their car). */
export function mischief(state: State, player: Player, amount: number, certain: boolean, victim = -1): boolean {
  const city = state.city!, cp = seatOf(state, player), seen = certain ? 1 : witnessed(state, player, victim);
  if (!seen) return false;
  const before = heatTier(cp.heat);
  cp.heat = Math.min(100, cp.heat + amount * (seen === 2 ? 1.5 : 1));
  cp.hotAt = state.clock;
  if (seen === 2) cp.seenAt = state.clock;
  cp.stats.peak = Math.max(cp.stats.peak, Math.round(cp.heat));
  const tier = heatTier(cp.heat);
  cp.spell = Math.max(cp.spell, tier);
  if (tier > before) {
    toast(player, `Heat: ${HEAT_NAMES[tier]}`);
    if (tier >= 2) news(state, `${player.name} is ${tier >= 4 ? 'on red alert' : tier === 3 ? 'running hot' : 'wanted by the Watch'}`);
    addFx(state, 'siren', player.x, player.y + 1, player.z, tier);
  }
  // Bystanders gasp and scatter.
  let fled = 0;
  crowdNear(city, player.x, player.z, 9, i => { if (i !== victim && fled < 4 && !city.npcs.has(i) && city.people.list[i]!.job !== 'officer' && state.rand() < 0.7) { fled++; goLive(state, i, NS.FLEE, 4 + state.rand() * 3, player.seat); } });
  if (fled) addFx(state, 'gasp', player.x, player.y + 2, player.z);
  return true;
}

/** Bonk resident (or extra) `i`: stars, a few coins, and heat if anyone saw. */
export function bonk(state: State, player: Player, i: number, pie = false): boolean {
  const city = state.city!, cp = seatOf(state, player), at = whereIs(state, i), reach = pie ? 9 : 3.4;
  if (!at || Math.hypot(at.x - player.x, at.z - player.z) > reach || at.live?.s === NS.DIZZY) return false;
  const officer = at.live?.officer ?? city.people.list[i]?.job === 'officer', npc = goLive(state, i, NS.DIZZY, officer ? 3.2 : pie ? 2.6 : 4.2, player.seat) ?? at.live;
  if (!npc) return false;
  // They tumble away from the blow.
  const dx = npc.x - player.x, dz = npc.z - player.z, d = Math.hypot(dx, dz) || 1;
  Object.assign(npc, { vx: dx / d * 5, vz: dz / d * 5, vy: 5, onGround: false, angry: !officer && !npc.extra && city.people.list[i]!.brave, path: null });
  addFx(state, pie ? 'splat' : 'bonk', npc.x, npc.y + 1.5, npc.z);
  if (!pie) {
    cp.stats.bonks++;
    if (!officer && !npc.extra) {
      spawnItem(state, npc.x, npc.y + 1, npc.z, { id: I.coin, n: 2 + Math.floor(state.rand() * 7) }, { scatter: true });
      const roll = state.rand();
      if (roll < 0.1) spawnItem(state, npc.x, npc.y + 1, npc.z, { id: roll < 0.025 ? I.gold_watch : I.coin_purse, n: 1 }, { scatter: true });
    }
  }
  mischief(state, player, officer ? MISCHIEF.bonkOfficer : pie ? MISCHIEF.pie : MISCHIEF.bonk, officer, i);
  return true;
}
/** One player bonks another: stars, a tumble and a few of their coins on the ground. */
export function bonkPlayer(state: State, player: Player, other: Player): boolean {
  const cp = state.city!.players[other.seat]!;
  if (!state.settings.bonks || other === player || other.dead || !other.connected || state.clock < other.protectedUntil || state.clock - cp.bonkedAt < 3 || Math.hypot(other.x - player.x, other.z - player.z) > 3.4 || Math.abs(other.y - player.y) > 2.5) return false;
  cp.bonkedAt = state.clock;
  cp.dizzyUntil = state.clock + 1.6;
  const spill = Math.min(cp.coins, Math.max(3, Math.round(cp.coins * 0.05))), dx = other.x - player.x, dz = other.z - player.z, d = Math.hypot(dx, dz) || 1;
  cp.coins -= spill;
  if (spill) spawnItem(state, other.x, other.y + 1, other.z, { id: I.coin, n: Math.min(64, spill) }, { scatter: true, owner: other.id, delay: 1.5 });
  if (!cp.ride) impulse(state, other, dx / d * 6, 5, dz / d * 6);
  other.hurt++;
  seatOf(state, player).stats.bonks++;
  addFx(state, 'bonk', other.x, other.y + 1.7, other.z);
  mischief(state, player, MISCHIEF.bonkPlayer, false);
  return true;
}

/** The arrest: a fine, the loot gone, heat cleared and a walk home from the Watch House steps. */
export function bust(state: State, player: Player) {
  const city = state.city!, cp = seatOf(state, player), tier = Math.max(1, cp.spell), fine = fineFor(cp.coins, tier), [x, y, z] = city.plan.jail;
  if (cp.ride) exitVehicle(state, player);
  let loot = 0;
  player.inv.forEach((slot, k) => { if (slot && LOOT.includes(slot.id)) { loot += slot.n; player.inv[k] = null; } });
  Object.assign(cp, { coins: cp.coins - fine, heat: 0, spell: 0, grab: 0, gig: null, open: -1, offers: null });
  cp.stats.busts++;
  teleport(state, player, x + (player.seat % 5 - 2) * 0.9, y, z + (player.seat % 3 - 1) * 0.9);
  player.protectedUntil = state.clock + PROTECT_SECONDS;
  toast(player, `Nabbed! The Watch fined you ${fine} coins${loot ? ' and took the loot' : ''}.`);
  news(state, `${player.name} was nabbed by the Watch and fined ${fine} coins`);
  addFx(state, 'bust', x, y + 1, z);
  standDown(state, player.seat);
}
/** Officers after a seat give up: scripted ones walk back to their beat, extras leave. */
function standDown(state: State, seat: number) {
  for (const npc of state.city!.npcs.values()) if (npc.officer && npc.target === seat) Object.assign(npc, { target: -1, s: NS.WALK, until: state.clock + (npc.extra ? 3 : 12), path: null });
}
/** Knocked out: wake at the clinic, a little poorer. Called in place of the ordinary respawn. */
export function wakeAtClinic(state: State, player: Player) {
  const city = state.city!, cp = seatOf(state, player), bill = clinicBill(cp.coins), [x, y, z] = cp.flat >= 0 ? city.plan.clinic : city.plan.clinic;
  Object.assign(cp, { coins: cp.coins - bill, heat: 0, spell: 0, grab: 0, gig: null });
  cp.stats.kos++;
  standDown(state, player.seat);
  toast(player, `Patched up at the clinic for ${bill} coins.`);
  return [x + (player.seat % 5 - 2) * 0.9, y, z + (player.seat % 3 - 1) * 0.9] as const;
}

/** Does any officer have eyes on this player right now? */
function officerSees(state: State, player: Player): boolean {
  const city = state.city!, eye = player.y + 1.5;
  for (const npc of city.npcs.values()) if (npc.officer && npc.s !== NS.DIZZY && Math.hypot(npc.x - player.x, npc.z - player.z) < OFFICER_SIGHT && lineOfSight(state, npc.x, npc.y + 1.6, npc.z, player.x, eye, player.z)) return true;
  for (const v of city.vehicles) if (v.siren && Math.hypot(v.x - player.x, v.z - player.z) < OFFICER_SIGHT && lineOfSight(state, v.x, v.y + 1.4, v.z, player.x, eye, player.z)) return true;
  let seen = false;
  crowdNear(city, player.x, player.z, OFFICER_SIGHT, (i, x, z) => { if (!seen && city.people.list[i]!.job === 'officer' && city.ract[i] === ACT.PATROL && !city.npcs.has(i)) seen = lineOfSight(state, x, 65.6, z, player.x, eye, player.z); });
  return seen;
}
/** Send one more officer after a seat: the nearest one on the beat, else a reinforcement from round a corner. */
function sendOfficer(state: State, player: Player): boolean {
  const city = state.city!;
  let best = -1, bestD = 70;
  crowdNear(city, player.x, player.z, 70, (i, x, z) => { const d = Math.hypot(x - player.x, z - player.z); if (d < bestD && city.people.list[i]!.job === 'officer' && city.ract[i] === ACT.PATROL && !city.npcs.has(i)) { best = i; bestD = d; } });
  if (best >= 0) return !!goLive(state, best, NS.CHASE, 1e9, player.seat);
  // A sidewalk corner 30–64 blocks off that nobody can see: start from a random node near the player and take the first that fits.
  const gx = Math.floor((player.x - CITY.x0) / CITY.pitch), gz = Math.floor((player.z - CITY.z0) / CITY.pitch);
  for (let attempt = 0; attempt < 10; attempt++) {
    const bx = gx + Math.floor(state.rand() * 3) - 1, bz = gz + Math.floor(state.rand() * 3) - 1;
    if (bx < 0 || bz < 0 || bx >= CITY.n || bz >= CITY.n) continue;
    const { x, z } = nodeAt(((bz * CITY.n + bx) * 4 + Math.floor(state.rand() * 4)) % NODES), d = Math.hypot(x - player.x, z - player.z);
    if (d < 30 || d > 64 || playersNear(state, x, z, 26).length || lineOfSight(state, x, 65.6, z, player.x, player.y + 1.5, player.z)) continue;
    addExtra(state, x, 64, z, true, player.seat, NS.CHASE);
    return true;
  }
  return false;
}

/** Heat for every seat: who is seen, cooling, sending the Watch, and the gentle first tier (a ticket). */
export function tickHeat(state: State, dt: number) {
  const city = state.city!;
  for (const player of state.players) {
    const cp = city.players[player.seat]!;
    if (!player.connected || player.dead) { cp.grab = 0; continue; }
    if (cp.heat <= 0) { cp.grab = 0; continue; }
    if ((state.ticks + player.seat) % 5 === 0 && officerSees(state, player)) cp.seenAt = state.clock;
    const tier = heatTier(cp.heat), quiet = state.clock - Math.max(cp.seenAt, cp.hotAt);
    if (quiet > COOL_AFTER) {
      const lot = cp.flat >= 0 ? city.plan.lots[cp.flat]! : null, home = !!lot && player.x >= lot.x0 - 3 && player.x <= lot.x1 + 4 && player.z >= lot.z0 - 3 && player.z <= lot.z1 + 4;
      cp.heat = Math.max(0, cp.heat - (home ? COOLING_HOME : COOLING) * dt);
      if (cp.heat <= 0) {
        if (cp.spell >= 2) { cp.stats.escapes++; news(state, `${player.name} gave the Watch the slip`); toast(player, 'You lost them. Heat: Calm'); }
        cp.spell = 0;
        standDown(state, player.seat);
        continue;
      }
    }
    if (state.clock < cp.sendAt || tier < 1) continue;
    cp.sendAt = state.clock + 2.5;
    const officers = [...city.npcs.values()].filter(npc => npc.officer && npc.target === player.seat).length, wantCruisers = tier >= 4 ? 2 : tier === 3 ? 1 : 0;
    if (officers + cruisersAfter(city, player.seat) * 2 < tier + (tier > 2 ? 1 : 0)) sendOfficer(state, player);
    if (cruisersAfter(city, player.seat) < wantCruisers) sendCruiser(state, player.seat);
  }
}

// Bodies ---------------------------------------------------------------------------------------------------------------
function steer(state: State, npc: Npc, tx: number, tz: number, speed: number, dt: number) {
  const dx = tx - npc.x, dz = tz - npc.z, d = Math.hypot(dx, dz);
  const k = Math.min(1, 10 * dt), wx = d > 0.05 ? dx / d * speed : 0, wz = d > 0.05 ? dz / d * speed : 0;
  npc.vx += (wx - npc.vx) * k;
  npc.vz += (wz - npc.vz) * k;
  if (d > 0.2) npc.yaw = yawTo(dx, dz);
}
/** An officer after a player: straight at them when in view, else along a planned path, else to where they were. */
function pursue(state: State, npc: Npc, player: Player, cp: CityPlayer, dt: number) {
  const city = state.city!, tier = heatTier(cp.heat), dx = player.x - npc.x, dz = player.z - npc.z, d = Math.hypot(dx, dz), dy = player.y - npc.y;
  const sees = d < OFFICER_SIGHT && lineOfSight(state, npc.x, npc.y + 1.6, npc.z, player.x, player.y + 1.5, player.z);
  if (sees) cp.seenAt = state.clock;
  const ride = rideOf(state, player), slow = !ride || cp.speed < 3;
  if (d < GRAB_REACH + (ride ? 1.6 : 0) && Math.abs(dy) < 2.2 && slow && state.clock >= player.protectedUntil) {
    // Tier one is a telling-off: a small ticket on the spot. Higher tiers are an arrest.
    npc.s = NS.GRAB;
    npc.vx = npc.vz = 0;
    npc.yaw = yawTo(dx, dz);
    cp.grab += dt;
    if (cp.grab >= GRAB_SECONDS) {
      if (tier <= 1 && cp.spell <= 1) {
        const fine = Math.min(cp.coins, 15);
        Object.assign(cp, { coins: cp.coins - fine, heat: 0, spell: 0, grab: 0 });
        toast(player, `"Behave yourself." Ticketed ${fine} coins.`);
        addFx(state, 'bust', player.x, player.y + 1, player.z);
        standDown(state, player.seat);
      } else bust(state, player);
    }
    return;
  }
  npc.s = tier <= 1 ? NS.WALK : NS.CHASE;
  const speed = RUN[Math.max(1, tier)]!;
  if (sees && d < 12 && Math.abs(dy) < 1.5) { steer(state, npc, player.x, player.z, speed, dt); npc.path = null; return; }
  if (state.clock >= npc.pathAt && city.paths > 0) {
    // One short A* a second per officer, from a shared budget; out of range it heads for the nearest sidewalk corner on the way.
    npc.pathAt = state.clock + 0.8 + state.rand() * 0.4;
    city.paths--;
    const far = d > 22, gx = far ? npc.x + dx / d * 20 : player.x, gz = far ? npc.z + dz / d * 20 : player.z;
    const result = findPath(state.getLoaded, [Math.floor(npc.x), Math.floor(npc.y + 0.2), Math.floor(npc.z)], [Math.floor(gx), Math.floor(far ? npc.y : player.y + 0.2), Math.floor(gz)], { height: 2, maxNodes: 260, range: 24 });
    npc.path = result.path.length ? result.path : null;
    npc.pathIndex = 0;
  }
  const way = npc.path?.[npc.pathIndex];
  if (way) {
    if (Math.hypot(way[0] + 0.5 - npc.x, way[2] + 0.5 - npc.z) < 0.45) npc.pathIndex++;
    if (way[1] > npc.y + 0.3 && npc.onGround) npc.vy = 9.5;
    steer(state, npc, way[0] + 0.5, way[2] + 0.5, speed, dt);
  } else steer(state, npc, player.x, player.z, speed, dt);
}

/** Every live resident and extra, once a tick. */
export function tickNpcs(state: State, dt: number) {
  const city = state.city!, people = city.people;
  city.paths = 3;
  for (const [i, npc] of city.npcs) {
    const target = npc.target >= 0 ? state.players[npc.target] : undefined, cp = target ? city.players[target.seat]! : undefined, over = state.clock >= npc.until;
    if (npc.s === NS.DIZZY) {
      npc.vx *= 1 - Math.min(1, 6 * dt);
      npc.vz *= 1 - Math.min(1, 6 * dt);
      if (over) {
        // Up again: officers resume, the brave square up, the rest run for it.
        if (npc.officer) Object.assign(npc, { s: cp && cp.heat > 0 ? NS.CHASE : NS.WALK, until: cp && cp.heat > 0 ? 1e9 : state.clock + 8 });
        else Object.assign(npc, { s: npc.angry ? NS.ANGRY : NS.FLEE, until: state.clock + (npc.angry ? 6 : 5) });
      }
    } else if (npc.officer && target && cp && cp.heat > 0 && !target.dead && target.connected) pursue(state, npc, target, cp, dt);
    else if (npc.s === NS.FLEE && target && !over) {
      const dx = npc.x - target.x, dz = npc.z - target.z, d = Math.hypot(dx, dz) || 1;
      steer(state, npc, npc.x + dx / d * 6, npc.z + dz / d * 6, FLEE_SPEED, dt);
    } else if (npc.s === NS.ANGRY && target && !over) {
      const d = Math.hypot(target.x - npc.x, target.z - npc.z);
      steer(state, npc, target.x, target.z, 4.4, dt);
      if (d < 1.5 && Math.abs(target.y - npc.y) < 2 && cp && state.clock >= target.protectedUntil) {
        // A resident's revenge: one bonk back.
        cp.dizzyUntil = state.clock + 1.2;
        target.hurt++;
        target.health = Math.max(1, target.health - 2);
        impulse(state, target, (target.x - npc.x) / (d || 1) * 5, 4.5, (target.z - npc.z) / (d || 1) * 5);
        addFx(state, 'bonk', target.x, target.y + 1.7, target.z);
        toast(target, `${people.list[i]?.name ?? 'They'} bonked you back!`);
        Object.assign(npc, { s: NS.FLEE, until: state.clock + 3, angry: false });
      }
    } else if ((npc.s === NS.STAND || npc.s === NS.HAIL || npc.s === NS.DODGE) && !over) {
      npc.vx *= 1 - Math.min(1, 8 * dt);
      npc.vz *= 1 - Math.min(1, 8 * dt);
      if (target && npc.s !== NS.DODGE) npc.yaw = yawTo(target.x - npc.x, target.z - npc.z);
    } else if (npc.extra) {
      // Extras have nowhere to be: once done they slip away when nobody is near.
      npc.s = NS.WALK;
      steer(state, npc, npc.x, npc.z, 0, dt);
      if (state.clock >= npc.until && !playersNear(state, npc.x, npc.z, npc.officer ? 20 : 28).length || state.clock > npc.until + 25) { city.npcs.delete(i); continue; }
    } else {
      // Back to the script: walk to where it says they should be now, then fall in with it.
      residentAt(people, people.list[i]!, state.day, state.time, pose);
      const d = Math.hypot(pose.x - npc.x, pose.z - npc.z);
      npc.s = NS.WALK;
      npc.target = -1;
      if (pose.hidden || d < 1.3 || state.clock > npc.until + 14 || d > 60) { city.npcs.delete(i); continue; }
      steer(state, npc, pose.x, pose.z, npc.officer ? 2.4 : HOME_SPEED, dt);
    }
    npc.vy = Math.max(npc.vy - 32 * dt, -60);
    const before = npc.x + npc.z, hit = moveBody(state.getLoaded, npc, 0.6, 1.8, dt, STEP_HEIGHT);
    // Blocked by a kerbside bench or a hedge: hop it. Stuck for good: give up the path.
    if ((hit.hitX || hit.hitZ) && npc.onGround && npc.s !== NS.DIZZY) npc.vy = 9.5;
    npc.stuck = Math.abs(npc.x + npc.z - before) < 0.01 && npc.s !== NS.DIZZY && npc.s !== NS.GRAB && npc.s !== NS.STAND && npc.s !== NS.HAIL ? npc.stuck + dt : 0;
    if (npc.stuck > 1.5) { npc.path = null; npc.pathAt = 0; npc.stuck = 0; }
    if (npc.y < 40) city.npcs.delete(i);
  }
  // A player's grip loosens the moment no officer has hold.
  for (const player of state.players) {
    const cp = city.players[player.seat]!;
    if (cp.grab > 0 && ![...city.npcs.values()].some(npc => npc.s === NS.GRAB && npc.target === player.seat)) cp.grab = Math.max(0, cp.grab - dt * 2);
  }
}

/** Residents in the way of a fast vehicle jump clear or go flying. */
export function tickCollisions(state: State) {
  const city = state.city!;
  for (const player of state.players) {
    const cp = city.players[player.seat]!, vehicle = rideOf(state, player);
    if (!vehicle || cp.seat !== 0 || cp.speed < 6 || !player.onGround) continue;
    const fx = -Math.sin(vehicle.yaw), fz = -Math.cos(vehicle.yaw), reach = 2 + cp.speed * 0.45;
    crowdNear(city, vehicle.x + fx * reach / 2, vehicle.z + fz * reach / 2, reach / 2 + 2.5, i => {
      const at = whereIs(state, i);
      if (!at || at.live?.s === NS.DIZZY || at.live?.s === NS.DODGE) return;
      const dx = at.x - vehicle.x, dz = at.z - vehicle.z, along = dx * fx + dz * fz, across = dx * fz - dz * fx;
      if (along < 0 || along > reach || Math.abs(across) > 1.7) return;
      if (along < 2.6 && Math.abs(across) < 1.25) {
        // Hit: a tumble and stars, and heat if anyone saw.
        const npc = goLive(state, i, NS.DIZZY, 4, player.seat);
        if (!npc) return;
        Object.assign(npc, { vx: fx * cp.speed * 0.5 + fz * 3 * Math.sign(across || 1), vz: fz * cp.speed * 0.5 - fx * 3 * Math.sign(across || 1), vy: 6.5, onGround: false });
        addFx(state, 'bonk', npc.x, npc.y + 1.5, npc.z);
        mischief(state, player, MISCHIEF.runOver, false, i);
      } else if (!at.live && state.rand() < 0.5) {
        // A near miss: they leap out of the way.
        const npc = goLive(state, i, NS.DODGE, 1.2, player.seat);
        if (npc) Object.assign(npc, { vx: fz * 6 * Math.sign(across || 1), vz: -fx * 6 * Math.sign(across || 1), vy: 5, onGround: false });
      }
    });
  }
}

export const npcView = (npc: Npc): PubNpc => ({ i: npc.i, x: npc.x, y: npc.y, z: npc.z, yaw: q2(npc.yaw), s: npc.s });
