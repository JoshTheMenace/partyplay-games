/* Items: roulette, use, entities on the course and item boxes. See DESIGN.md §4.
 *
 * Entity field meanings (all numbers finite; `t` is always the age in seconds, `d`/`hint` the track position):
 *  - peel     resting on the ground (y = ground contact). Falls with gravity right after it is dropped.
 *  - bouncer  flies at constant speed along (vx, vz) hugging the ground; `bounces` = wall ricochets so far.
 *  - seeker   follows the course toward `target` (racer id, or null = anyone ahead), then homes in.
 *  - comet    streaks along the course above the road toward `target` (the current leader).
 *  - bomb     lobbed arc; `bounces` = 1 once landed; `fuse` = seconds left before it detonates (ticks after landing).
 *  - blast    explosion visual; `fuse` = seconds of life left, `bounces` = radius in metres (see blastRadius).
 * Event values: `item` → index into ITEM_IDS; `hit` → index into HIT_KINDS; `explode` → radius (m);
 * `pickup` → item-box index (x/z = box); `shield-pop` → 0 bubble absorbed it, 1 the trailed item absorbed it.
 * Loop-the-loops: shells that run into one ride round it and carry on from the exit; a loop's footprint has no road, so peels
 * and bombs never rest there; and nothing is put on the course from the loop (see handleItemInput). */
import { angleDelta, clamp, forwardX, forwardZ, headingOf, moveToward, TAU, wrap } from './math';
import { forwardDistance, loopPose, pointAt, queryTrack, roadHeight, sampleAt, type Track, type TrackQuery } from './track';
import { applyHit, loopLength, loopOver, startBoost } from './physics';
import { paramsFor, pushEvent, raceRandom } from './race';
import type { Entity, EntityKind, HitKind, Input, ItemId, ItemMode, Race, Racer } from './types';

export type ItemInfo = { name: string; blurb: string; holdable: boolean; uses: number };
/** Browser-safe metadata for HUD, controller and instructions. */
export const ITEMS: Record<ItemId, ItemInfo> = {
  nitro: { name: 'Nitro', blurb: 'A burst of speed.', holdable: false, uses: 1 },
  'triple-nitro': { name: 'Triple Nitro', blurb: 'Three bursts of speed.', holdable: false, uses: 3 },
  peel: { name: 'Peel', blurb: 'Drop behind you. Hold to drag it as a shield.', holdable: true, uses: 1 },
  bouncer: { name: 'Bouncer', blurb: 'Fires straight and ricochets off walls.', holdable: true, uses: 1 },
  seeker: { name: 'Seeker', blurb: 'Homes in on the racer ahead.', holdable: true, uses: 1 },
  shield: { name: 'Bubble', blurb: 'Blocks the next hit.', holdable: false, uses: 1 },
  super: { name: 'Super Star', blurb: 'Invincible, faster and dirt-proof for a while.', holdable: false, uses: 1 },
  thunder: { name: 'Thunder', blurb: 'Zaps everyone ahead of you.', holdable: false, uses: 1 },
  comet: { name: 'Comet', blurb: 'Streaks down the track to blast the leader.', holdable: false, uses: 1 },
  ink: { name: 'Ink', blurb: 'Splats the screens of everyone ahead.', holdable: false, uses: 1 },
  bomb: { name: 'Boom Bomb', blurb: 'Lob it ahead; it blows up anyone nearby.', holdable: false, uses: 1 },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const HIT_KINDS: readonly HitKind[] = ['spin', 'tumble', 'shock', 'ink'];
/** Seconds the roulette spins before the item can be used. */
export const ROULETTE_SECONDS = 1.4;
export const BOX_RESPAWN = 2.5, BOX_RADIUS = 2, MAX_PEELS = 12;
export const THUNDER_COOLDOWN = 20, COMET_COOLDOWN = 25, SHIELD_SECONDS = 12, STAR_SECONDS = 7.5;
export const blastRadius = (e: Entity) => e.bounces;

const G = 28, KART_R = 1.25, BLAST_LIFE = .6, TRAIL_BACK = 2.4;
const RADIUS: Record<EntityKind, number> = { peel: .7, bouncer: .7, seeker: .7, bomb: .8, comet: 1, blast: 0 };
const LIFE: Record<EntityKind, number> = { peel: Infinity, bouncer: 8, seeker: 12, bomb: 5, comet: 30, blast: BLAST_LIFE };

/* ---------------- Roulette ---------------- */
/** Weight columns at rank fraction 0 (leader), .2, .4, .6, .8, 1 (last); interpolated in between. */
const TABLE: Record<ItemId, readonly number[]> = {
  peel: [34, 18, 8, 3, 0, 0],
  bouncer: [26, 22, 16, 9, 4, 2],
  shield: [22, 16, 10, 5, 2, 0],
  bomb: [6, 12, 13, 10, 6, 3],
  nitro: [0, 12, 18, 16, 12, 8],
  seeker: [0, 12, 17, 16, 11, 7],
  ink: [0, 4, 8, 9, 7, 4],
  'triple-nitro': [0, 0, 5, 12, 16, 14],
  super: [0, 0, 2, 8, 14, 18],
  thunder: [0, 0, 0, 0, 5, 12],
  comet: [0, 0, 0, 0, 6, 10],
};
export type RollBlocks = { thunder?: boolean; comet?: boolean; ink?: boolean };
/** Item weights for a rank fraction in [0, 1] (0 = leader). Frantic shifts everyone toward the back-of-pack table. */
export function itemWeights(fraction: number, mode: ItemMode, blocks: RollBlocks = {}): Record<ItemId, number> {
  const f = clamp(mode === 'frantic' ? .5 + fraction * .5 : fraction, 0, 1) * 5, i = Math.min(4, Math.floor(f)), t = f - i;
  const out = {} as Record<ItemId, number>;
  for (const id of ITEM_IDS) out[id] = blocks[id as keyof RollBlocks] ? 0 : TABLE[id][i] + (TABLE[id][i + 1] - TABLE[id][i]) * t;
  return out;
}
/** The weights a racer would roll with right now (global cooldowns and one-at-a-time rules applied). */
export function rollWeights(race: Race, racer: Racer) {
  const n = race.racers.length, holds = (id: ItemId) => race.racers.some(r => r.item === id);
  return itemWeights(n > 1 ? (racer.rank - 1) / (n - 1) : 0, race.items, {
    thunder: race.cooldowns.thunder > 0 || holds('thunder'),
    comet: n < 4 || race.cooldowns.comet > 0 || holds('comet') || race.entities.some(e => e.kind === 'comet'),
    ink: holds('ink') || race.racers.some(r => r.inkT > 0),
  });
}
export function rollItem(race: Race, racer: Racer): ItemId {
  const w = rollWeights(race, racer), total = ITEM_IDS.reduce((s, id) => s + w[id], 0);
  let pick = raceRandom(race) * total;
  for (const id of ITEM_IDS) if ((pick -= w[id]) < 0) return id;
  return 'bouncer';
}

/* ---------------- Boxes ---------------- */
/** Item-box pickups and respawn timers. */
export function collectBoxes(race: Race, track: Track, dt: number): void {
  if (race.items === 'off') return;
  race.boxes.forEach((left, i) => { if (left > 0) race.boxes[i] = Math.max(0, left - dt); });
  track.boxes.forEach((box, i) => {
    if (race.boxes[i] > 0) return;
    for (const r of race.racers) {
      if (r.respawnT > 0 || r.finishTime !== null || (r.x - box.x) ** 2 + (r.z - box.z) ** 2 > BOX_RADIUS ** 2 || Math.abs(r.y + .6 - box.y) > 2.2) continue;
      race.boxes[i] = BOX_RESPAWN;
      pushEvent(race, { type: 'pickup', racer: r.id, value: i, x: box.x, z: box.z });
      if (r.item === null && r.rollT <= 0) { r.item = rollItem(race, r); r.itemCount = ITEMS[r.item].uses; r.rollT = ROULETTE_SECONDS; r.trailing = false; }
      break;
    }
  });
}

/* ---------------- Using items ---------------- */
/** Handle this tick's item input edges for one racer (press counter / held flag). */
export function handleItemInput(race: Race, racer: Racer, input: Input, track: Track): void {
  const press = input.fire !== racer.prevFire, held = input.item;
  racer.prevFire = input.fire; racer.prevItem = held;
  if (racer.item === null || racer.rollT > 0) { racer.trailing = false; return; }
  if (racer.respawnT > 0 || racer.spinT > 0 || racer.tumbleT > 0) return;
  // On a loop (or just out of it) items that go on the course wait: a holdable trails until the kart is back on the road, then
  // deploys if the button is up (a shell is released at the exit, a peel never lands on the footprint); a bomb stays in the slot.
  const onLoop = racer.loop > 0 || !!loopOver(track, racer.d, 4);
  if (racer.trailing) { if (!held && !onLoop) useItem(race, racer, track); return; }
  if (!press) return;
  if (ITEMS[racer.item].holdable && (held || onLoop)) racer.trailing = true;
  else if (!onLoop || racer.item !== 'bomb') useItem(race, racer, track);
}

function consume(racer: Racer) {
  racer.itemCount = Math.max(0, racer.itemCount - 1);
  if (racer.itemCount === 0) racer.item = null;
  racer.trailing = false;
}

function useItem(race: Race, r: Racer, track: Track) {
  const item = r.item!, fx = forwardX(r.heading), fz = forwardZ(r.heading), wasTrailing = r.trailing;
  r.stats.itemsUsed++;
  pushEvent(race, { type: 'item', racer: r.id, value: ITEM_IDS.indexOf(item), x: r.x, z: r.z });
  consume(r);
  const top = paramsFor(race, r).topSpeed;
  switch (item) {
    case 'nitro': case 'triple-nitro': startBoost(r, 1.4, .4); break;
    case 'shield': r.shieldT = SHIELD_SECONDS; break;
    case 'super': r.starT = STAR_SECONDS; break;
    case 'peel': {
      const back = wasTrailing ? TRAIL_BACK : 3;
      spawn(race, track, 'peel', r.id, r.x - fx * back, r.y + .5, r.z - fz * back, 0, 1.5, 0);
      const peels = race.entities.filter(e => e.kind === 'peel');
      if (peels.length > MAX_PEELS) { const drop = new Set(peels.slice(0, peels.length - MAX_PEELS)); race.entities = race.entities.filter(e => !drop.has(e)); }
      break;
    }
    case 'bouncer': { const v = Math.max(45, top * 1.9); spawn(race, track, 'bouncer', r.id, r.x + fx * 2.4, r.y, r.z + fz * 2.4, fx * v, 0, fz * v); break; }
    case 'seeker': {
      const v = Math.max(42, top * 1.7), target = racerAhead(race, r);
      spawn(race, track, 'seeker', r.id, r.x + fx * 2.4, r.y, r.z + fz * 2.4, fx * v, 0, fz * v, target?.id ?? null);
      break;
    }
    case 'bomb': {
      const ahead = Math.max(0, r.vx * fx + r.vz * fz) + 13;
      spawn(race, track, 'bomb', r.id, r.x + fx * 1.6, r.y + 1.2, r.z + fz * 1.6, fx * ahead, 9, fz * ahead, null, 1.2);
      break;
    }
    case 'comet': {
      const target = leaderFor(race, r.id), from = r.loop > 0 ? pointAt(track, r.d, r.lateral) : r;   // from a loop: launched off the road below
      spawn(race, track, 'comet', r.id, from.x, from.y + 2, from.z, r.vx, 6, r.vz, target?.id ?? null);
      race.cooldowns.comet = COMET_COOLDOWN;
      pushEvent(race, { type: 'comet', racer: r.id, ...(target ? { other: target.id } : {}) });
      break;
    }
    case 'thunder': case 'ink': {
      if (item === 'thunder') { race.cooldowns.thunder = THUNDER_COOLDOWN; pushEvent(race, { type: 'thunder', racer: r.id }); }
      const dealt = r.stats.hitsDealt;   // one zap of the whole field counts as one hit landed
      for (const v of race.racers) if (v !== r && v.rank < r.rank && v.finishTime === null) strike(race, v, item === 'thunder' ? 'shock' : 'ink', r.id);
      r.stats.hitsDealt = Math.min(r.stats.hitsDealt, dealt + 1);
      break;
    }
  }
}

/** Nearest unfinished racer ranked ahead of `r` (the seeker's quarry). */
function racerAhead(race: Race, r: Racer): Racer | null {
  let best: Racer | null = null;
  for (const o of race.racers) if (o !== r && o.finishTime === null && o.rank < r.rank && (!best || o.rank > best.rank)) best = o;
  return best;
}
/** Leading unfinished racer other than the comet's owner. */
function leaderFor(race: Race, owner: string): Racer | null {
  let best: Racer | null = null;
  for (const o of race.racers) if (o.id !== owner && o.finishTime === null && (!best || o.rank < best.rank)) best = o;
  return best;
}

function spawn(race: Race, track: Track, kind: EntityKind, owner: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, target: string | null = null, fuse = 0): Entity {
  const q = queryTrack(track, x, z, -1, y);
  const e: Entity = { id: ++race.serial, kind, owner, x, y, z, vx, vy, vz, t: 0, hint: q.index, d: q.d, target, bounces: 0, fuse };
  race.entities.push(e);
  return e;
}

/* ---------------- Hits ---------------- */
/** Resolve one hit on a racer; returns 'hit', 'blocked' (star/shield/invulnerable) or 'immune' (respawning or finished: passes through). */
export function strike(race: Race, victim: Racer, kind: HitKind, attacker: string): 'hit' | 'blocked' | 'immune' {
  if (victim.respawnT > 0 || victim.finishTime !== null) return 'immune';
  const hadShield = victim.shieldT > 0 && kind !== 'ink';
  if (applyHit(victim, kind)) {
    const dealer = race.racers.find(o => o.id === attacker);
    if (kind !== 'ink') { victim.stats.hitsTaken++; if (dealer && dealer !== victim) dealer.stats.hitsDealt++; }
    if (victim.trailing) consume(victim);
    pushEvent(race, { type: 'hit', racer: victim.id, other: attacker, value: HIT_KINDS.indexOf(kind), x: victim.x, z: victim.z });
    return 'hit';
  }
  if (hadShield && victim.shieldT <= 0) pushEvent(race, { type: 'shield-pop', racer: victim.id, other: attacker, value: 0, x: victim.x, z: victim.z });
  return 'blocked';
}

function explode(race: Race, track: Track, owner: string, x: number, y: number, z: number, radius: number, removed: Set<Entity>) {
  spawn(race, track, 'blast', owner, x, y, z, 0, 0, 0, null, BLAST_LIFE).bounces = radius;
  pushEvent(race, { type: 'explode', racer: owner, value: radius, x, z });
  for (const r of race.racers) if ((r.x - x) ** 2 + (r.z - z) ** 2 <= radius * radius && Math.abs(r.y - y) < 4) strike(race, r, 'tumble', owner);
  for (const e of race.entities) {
    if (removed.has(e) || e.kind === 'blast' || e.kind === 'comet' || (e.x - x) ** 2 + (e.z - z) ** 2 > radius * radius) continue;
    if (e.kind === 'bomb') { e.fuse = Math.min(e.fuse, .08); e.bounces = 1; }   // chain reaction next tick
    else removed.add(e);
  }
}

/* ---------------- Entities ---------------- */
/** Push an entity back inside a wall edge and reflect its velocity. Returns 'wall' on a bounce, 'drop' past a drop edge. */
function contain(e: Entity, q: TrackQuery, restitution: number): 'ok' | 'wall' | 'drop' {
  if (!q.beyond) return 'ok';
  if (q.edge === 'drop') return 'drop';
  const s = Math.sign(q.lateral), nx = -q.rx * s, nz = -q.rz * s, over = Math.abs(q.lateral) - Math.abs(q.edgeLateral) + .05;
  e.x += nx * over; e.z += nz * over;
  const vn = e.vx * nx + e.vz * nz;
  if (vn >= 0) return 'ok';
  e.vx -= (1 + restitution) * vn * nx; e.vz -= (1 + restitution) * vn * nz;
  return 'wall';
}
/** Ground following with gravity. `hug` snaps down small drops (shells glue to the road). */
function settle(e: Entity, q: TrackQuery, dt: number, hug: number, track: Track): 'ground' | 'air' | 'gone' {
  const ground = (q.beyond && q.edge === 'drop') || (track.loops.length && loopOver(track, q.d)) ? null : q.ground;
  if (ground !== null && e.y <= ground + hug && e.vy <= 0) { e.y = ground; e.vy = 0; return 'ground'; }
  e.vy -= G * dt; e.y += e.vy * dt;
  if (ground !== null && e.y <= ground) { e.y = ground; e.vy = 0; return 'ground'; }
  return ground !== null || e.y > q.centerY - 12 ? 'air' : 'gone';
}
/** Bounce off track obstacles (circles). Returns true on contact. */
function obstacleBounce(e: Entity, track: Track, restitution: number) {
  for (const o of track.obstacles) {
    const dx = e.x - o.x, dz = e.z - o.z, rr = o.radius + RADIUS[e.kind], dd = dx * dx + dz * dz;
    if (dd >= rr * rr || Math.abs(e.y - o.y) > 3) continue;
    const dist = Math.sqrt(dd) || 1, nx = dx / dist, nz = dz / dist, vn = e.vx * nx + e.vz * nz;
    e.x = o.x + nx * rr; e.z = o.z + nz * rr;
    if (vn < 0) { e.vx -= (1 + restitution) * vn * nx; e.vz -= (1 + restitution) * vn * nz; }
    return true;
  }
  return false;
}
const locate = (e: Entity, track: Track) => { const q = queryTrack(track, e.x, e.z, e.hint, e.y); e.hint = q.index; e.d = q.d; return q; };

/** Advance entities (shells, peels, bombs, comet, blasts), resolve their hits, and tick item timers. */
export function stepItems(race: Race, track: Track, dt: number): void {
  race.cooldowns.thunder = Math.max(0, race.cooldowns.thunder - dt);
  race.cooldowns.comet = Math.max(0, race.cooldowns.comet - dt);
  for (const r of race.racers) {
    r.rollT = Math.max(0, r.rollT - dt);
    if (r.trailing && (r.item === null || !ITEMS[r.item].holdable)) r.trailing = false;
    if (r.trailing && r.respawnT > 0) consume(r);      // fell off: the dragged item is lost
  }
  const removed = new Set<Entity>(), byId = new Map(race.racers.map(r => [r.id, r]));
  for (const e of race.entities.slice()) {
    if (removed.has(e)) continue;
    e.t += dt;
    if (e.t > LIFE[e.kind]) { removed.add(e); if (e.kind === 'bomb') explode(race, track, e.owner, e.x, e.y, e.z, 7, removed); continue; }
    if (e.kind === 'blast') { e.fuse = Math.max(0, e.fuse - dt); continue; }
    if (e.kind === 'comet') { stepComet(race, track, e, byId, dt, removed); continue; }
    const steps = e.kind === 'peel' ? 1 : 2, h = dt / steps;
    for (let s = 0; s < steps && !removed.has(e); s++) {
      if ((e.kind === 'bouncer' || e.kind === 'seeker') && track.loops.length && rideLoop(track, e, h)) { touchKarts(race, track, e, removed); continue; }
      if (e.kind === 'seeker') steerSeeker(race, track, e, byId, h);
      e.x += e.vx * h; e.z += e.vz * h;
      const q = locate(e, track);
      if (e.kind === 'bouncer') {
        if (contain(e, q, 1) === 'wall' || obstacleBounce(e, track, 1)) e.bounces++;
        if (e.bounces > 6) { removed.add(e); pushEvent(race, { type: 'explode', racer: e.owner, value: 1.5, x: e.x, z: e.z }); }
      } else if (e.kind === 'seeker') {
        const speed = Math.hypot(e.vx, e.vz);
        contain(e, q, 0);
        const k = speed / (Math.hypot(e.vx, e.vz) || 1); e.vx *= k; e.vz *= k;
        if (obstacleBounce(e, track, 0)) { removed.add(e); pushEvent(race, { type: 'explode', racer: e.owner, value: 1.5, x: e.x, z: e.z }); }
      } else if (e.kind === 'bomb') {
        contain(e, q, .35); obstacleBounce(e, track, .35);
      }
      const state = settle(e, q, h, e.kind === 'bouncer' || e.kind === 'seeker' ? .7 : .02, track);
      if (state === 'gone') removed.add(e);
      if (e.kind === 'bomb' && state === 'ground') { e.bounces = 1; const keep = Math.exp(-7 * h); e.vx *= keep; e.vz *= keep; }
      if (!removed.has(e)) touchKarts(race, track, e, removed);
    }
    if (e.kind === 'bomb' && e.bounces === 1 && !removed.has(e) && (e.fuse -= dt) <= 0) { removed.add(e); explode(race, track, e.owner, e.x, e.y, e.z, 7, removed); }
    if (e.kind === 'bouncer' || e.kind === 'seeker') collideEntities(race, e, removed);
  }
  if (removed.size) race.entities = race.entities.filter(e => !removed.has(e));
}

function touchKarts(race: Race, track: Track, e: Entity, removed: Set<Entity>) {
  const reach = KART_R + RADIUS[e.kind];
  for (const r of race.racers) {
    if ((r.x - e.x) ** 2 + (r.z - e.z) ** 2 > reach * reach || Math.abs(r.y - e.y) > 1.6) continue;
    if (r.id === e.owner && e.t < (e.kind === 'seeker' ? .8 : .5)) continue;
    if (r.respawnT > 0 || r.finishTime !== null) continue;
    if (e.kind === 'bomb') { removed.add(e); explode(race, track, e.owner, e.x, e.y, e.z, 7, removed); return; }
    // A dragged item soaks up one projectile arriving from behind.
    const behind = (e.x - r.x) * forwardX(r.heading) + (e.z - r.z) * forwardZ(r.heading) < -.2;
    removed.add(e);
    if (r.trailing && behind && e.kind !== 'peel') {
      consume(r);
      pushEvent(race, { type: 'shield-pop', racer: r.id, other: e.owner, value: 1, x: e.x, z: e.z });
      return;
    }
    strike(race, r, e.kind === 'seeker' ? 'tumble' : 'spin', e.owner);
    return;
  }
}

/** A shell whose d is on a loop's footprint rides the ribbon (θ from d, like a kart) at its own speed, keeping its lateral, and
 * leaves at the exit heading down the track. False when it is not on a loop. */
function rideLoop(track: Track, e: Entity, dt: number) {
  const loop = loopOver(track, e.d);
  if (!loop) return false;
  const len = loopLength(track, loop), theta = TAU * forwardDistance(track, loop.d0, e.d) / len, at = loopPose(loop, theta, 0);
  const speed = Math.hypot(e.vx, e.vy, e.vz), lat = (e.x - at.x) * loop.rx + (e.z - at.z) * loop.rz, next = theta + speed * dt / at.dsdTheta;
  if (next >= TAU) {
    const d = wrap(loop.d1 + (next - TAU) * at.dsdTheta, track.length), p = pointAt(track, d, lat);
    Object.assign(e, { x: p.x, y: p.y, z: p.z, vx: forwardX(p.heading) * speed, vy: 0, vz: forwardZ(p.heading) * speed, d });
  } else {
    const p = loopPose(loop, next, lat);
    Object.assign(e, { x: p.x, y: p.y, z: p.z, vx: p.tx * speed, vy: p.ty * speed, vz: p.tz * speed, d: wrap(loop.d0 + len * next / TAU, track.length) });
  }
  e.hint = Math.round(e.d / track.spacing) % track.samples.length;
  return true;
}

/** Shells destroy each other, peels and (by detonating) bombs. */
function collideEntities(race: Race, e: Entity, removed: Set<Entity>) {
  if (removed.has(e)) return;
  for (const o of race.entities) {
    if (o === e || removed.has(o) || o.kind === 'blast' || o.kind === 'comet') continue;
    const rr = RADIUS[e.kind] + RADIUS[o.kind] + .3;
    if ((o.x - e.x) ** 2 + (o.z - e.z) ** 2 > rr * rr || Math.abs(o.y - e.y) > 1.5) continue;
    removed.add(e);
    if (o.kind === 'bomb') { o.fuse = 0; o.bounces = 1; } else removed.add(o);
    pushEvent(race, { type: 'explode', racer: e.owner, value: 1.5, x: e.x, z: e.z });
    return;
  }
}

/** Seeker guidance: run down the course toward the quarry, then home in within 30 m. */
function steerSeeker(race: Race, track: Track, e: Entity, byId: Map<string, Racer>, dt: number) {
  let target = e.target ? byId.get(e.target) ?? null : null;
  if (target?.finishTime !== null) target = null;
  if (!target) {  // no quarry: lock onto the nearest racer a little way ahead
    let best = 30;
    for (const r of race.racers) {
      if (r.id === e.owner || r.finishTime !== null || r.respawnT > 0) continue;
      const f = forwardDistance(track, e.d, r.d);
      if (f < best) { best = f; target = r; }
    }
  }
  const speed = Math.hypot(e.vx, e.vz) || 42, heading = speed > 1 ? headingOf(e.vx, e.vz) : sampleAt(track, e.d).heading;
  let aimX: number, aimZ: number, rate = 4.5;
  const dist = target ? Math.hypot(target.x - e.x, target.z - e.z) : Infinity;
  if (target && dist < 30) {
    const lead = dist / Math.max(1, speed) * .6;
    aimX = target.x + target.vx * lead; aimZ = target.z + target.vz * lead; rate = 7;
  } else {
    const ahead = e.d + 12, s = sampleAt(track, ahead), here = sampleAt(track, e.d);
    const lateral = (e.x - here.x) * here.rx + (e.z - here.z) * here.rz;
    const near = target && forwardDistance(track, e.d, target.d) < 90;
    const lat = clamp(near ? target!.lateral : lateral + (s.line - lateral) * .5, -s.halfWidth + 1, s.halfWidth - 1);
    const p = pointAt(track, ahead, lat); aimX = p.x; aimZ = p.z;
  }
  const next = heading + clamp(angleDelta(heading, headingOf(aimX - e.x, aimZ - e.z)), -rate * dt, rate * dt);
  e.vx = forwardX(next) * speed; e.vz = forwardZ(next) * speed;
}

/** Comet: flies along the course centre-line coordinates toward the leader, dives in and explodes (radius 8). */
function stepComet(race: Race, track: Track, e: Entity, byId: Map<string, Racer>, dt: number, removed: Set<Entity>) {
  let target = e.target ? byId.get(e.target) ?? null : null;
  const leader = leaderFor(race, e.owner);
  if (leader && (!target || target.finishTime !== null || leader.rank < target.rank)) { target = leader; e.target = leader.id; }
  const owner = byId.get(e.owner), speed = owner ? paramsFor(race, owner).topSpeed * 2.2 : 64;
  const here = sampleAt(track, e.d), lateral = (e.x - here.x) * here.rx + (e.z - here.z) * here.rz;
  const gap = target ? forwardDistance(track, e.d, target.d) : Infinity;
  if (target && (gap < 2.5 || gap > track.length - 3 || Math.hypot(target.x - e.x, target.z - e.z) < 3)) {
    removed.add(e); explode(race, track, e.owner, target.x, target.y, target.z, 8, removed); return;
  }
  e.d = (e.d + Math.min(speed * dt, Math.max(0, gap - 1))) % track.length;
  const s = sampleAt(track, e.d), want = target && gap < 60 ? target.lateral : s.line;
  const lat = clamp(moveToward(lateral, want, (gap < 60 ? 24 : 8) * dt), -s.halfWidth, s.halfWidth);
  const altitude = e.t < .5 ? 2 + e.t * 10 : gap < 40 ? 1.2 + 5.8 * gap / 40 : 7;
  const p = pointAt(track, e.d, lat), y = roadHeight(track, e.d, lat, s) + altitude;
  e.vx = (p.x - e.x) / dt; e.vy = (y - e.y) / dt; e.vz = (p.z - e.z) / dt;
  e.x = p.x; e.y = y; e.z = p.z;
  e.hint = Math.round(e.d / track.spacing) % track.samples.length;
}
