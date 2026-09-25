/** Combat: systems, weapons and projectiles, enemy AI and autopilot, hazards, boss phases, fleeing and the outcome. */
import { type Combat, type CombatEvent, type Projectile, type RoomState, type Ship, type SystemId, type WeaponDef, type WeaponKind, type WeaponState, overheat } from '../contracts';
import { neighbors } from '../defs/geometry';
import { type Ctx, alive, context, crewOn, crossed, derived, emit, has, helmCrew, hullOf, lv, manned, pick, rand, systemRoom, wdef, weaponStates } from './core';
import { damageSystem, departures, hurt, ignite, planCrew, rescue, tickCrew } from './crew';
import type { CombatWorld, StartOptions, World } from './index';

const INTRO_MS = 3000, STEP_MS = 100, PLAN_MS = 250, SHIELD_MS = 2000, ION_LOCK_MS = 4000, EVENT_MS = 4000, FLEE_MS = 15000, AEGIS_MS = 10000, HOLD_MS = 3000;
/** Flight ms by kind (+0–400 ms jitter except ion and beams): ion lands first to strip shields, then bolts, then missiles; beams sweep last, after their volley. */
const FLIGHT_MS: Record<WeaponKind, number> = { ion: 1000, laser: 1200, flak: 1200, support: 1200, missile: 1800, beam: 2000 };
const DEFENSE_MS = [6000, 4000, 3000], CLOAK_MS = [5000, 7000, 9000], CLOAK_COOLDOWN_MS = 25000, REPAIR_DRONE_MS = 20000;
const tier = (level: number) => Math.min(level, 3) - 1;
type Hit = Pick<CombatEvent, 'roomId' | 'fromShipId' | 'weaponId'>;

export function startCombat(world: World, o: StartOptions): Combat {
  for (const m of world.crew) delete m.beam;
  for (const s of world.ships) {
    for (const r of s.rooms) r.ionMs = 0;
    Object.assign(s, { shields: lv(s, 'shields'), shieldCharge: 0, tempShield: 0, tempShieldMs: 0, cloakMs: 0, cloakCooldownMs: 0, teleportCooldownMs: 0, defenseCooldownMs: 0, fleeAtMs: null, lastHitBy: null });
    s.weapons.forEach((w, i) => Object.assign(w, { charge: has(s, 'pre-igniter') ? 1 : 0, target: null, auto: true, powered: i < lv(s, 'weapons') }));
  }
  return { id: o.id, t: 0, paused: false, pausedBy: null, hazard: o.hazard, objective: o.objective, surviveUntilMs: o.objective === 'survive' ? INTRO_MS + (o.surviveMs ?? 90000) : null,
    ftl: 0, jumpVotes: [], projectiles: [], events: [], introUntilMs: INTRO_MS, enemyCharge: o.enemyCharge ?? 1, outcome: null, nextId: 0, rng: o.seed >>> 0 };
}

export function stepCombat(world: CombatWorld, dtMs: number) {
  const c = world.combat;
  for (let left = dtMs; left > 0 && !c.paused && !c.outcome; left -= STEP_MS) tick(world, Math.min(left, STEP_MS));
  if (c.events.length && c.events[0].atMs < c.t - EVENT_MS) c.events = c.events.filter(e => e.atMs >= c.t - EVENT_MS);
}

function tick(world: CombatWorld, dtMs: number) {
  const c = world.combat, t0 = c.t;
  c.t += dtMs;
  if (c.t <= c.introUntilMs) return;
  const dt = c.t - Math.max(t0, c.introUntilMs), ctx = context(world, c), active = world.ships.filter(s => s.status === 'active');
  if (t0 <= c.introUntilMs || crossed(t0, c.t, PLAN_MS)) for (const s of active) if (s.faction === 'enemy' || s.autopilot) { aim(ctx, s, active); planCrew(ctx, s, true); autoCloak(ctx, s); }
  for (const s of active) systems(ctx, s, dt);
  for (const s of active) if (s.faction === 'enemy' || s.autopilot) volley(ctx, s); else s.weapons.forEach((w, i) => w.auto && fire(ctx, s, i));
  const due = c.projectiles.filter(p => p.arriveMs <= c.t);
  if (due.length) { c.projectiles = c.projectiles.filter(p => p.arriveMs > c.t); for (const p of due) land(ctx, p); }
  hazards(ctx, t0, active);
  for (const s of active) if (s.hull <= 0) wreck(ctx, s);
  for (const s of world.ships) if (s.status === 'active') tickCrew(ctx, s, dt);
  for (const s of active) if (s.status === 'active' && s.faction === 'ally') departures(ctx, s);
  for (const s of active) if (s.status === 'active') scuttle(ctx, s);
  flee(ctx, dt);
  const allies = world.ships.filter(s => s.faction === 'ally' && s.status === 'active'), foes = world.ships.some(s => s.faction === 'enemy' && s.status === 'active');
  if (c.objective !== 'boss' && allies.length) c.ftl = Math.min(1, c.ftl + dt * allies.reduce((n, s) => n + lv(s, 'engines'), 0) * (allies.some(s => has(s, 'ftl-booster')) ? 1.25 : 1) / (allies.length * 90000));
  const bossDown = c.objective === 'boss' && !world.ships.some(s => s.phases.length && s.status === 'active'); // escorts don't outlive the Flagship's final phase
  c.outcome = !allies.length ? 'defeat' : !foes || bossDown || c.surviveUntilMs !== null && c.t >= c.surviveUntilMs ? 'victory' : null;
}

/** Timers, shield recharge (ion lock is a negative shieldCharge; overheating capacitors slow it to a stop) and weapon charge. */
function systems(ctx: Ctx, s: Ship, dt: number) {
  const c = ctx.c!, d = derived(ctx, s);
  s.cloakMs = Math.max(0, s.cloakMs - dt); s.cloakCooldownMs = Math.max(0, s.cloakCooldownMs - dt);
  s.teleportCooldownMs = Math.max(0, s.teleportCooldownMs - dt); s.defenseCooldownMs = Math.max(0, s.defenseCooldownMs - dt);
  if (has(s, 'repair-drone') && s.hull < s.maxHull && Math.floor(c.t / REPAIR_DRONE_MS) > Math.floor((c.t - dt) / REPAIR_DRONE_MS)) { s.hull++; emit(c, 'heal', s.id, { amount: 1 }); }
  if (s.tempShield && (s.tempShieldMs -= dt) <= 0) s.tempShield = s.tempShieldMs = 0;
  for (const r of s.rooms) if (r.ionMs) r.ionMs = Math.max(0, r.ionMs - dt);
  s.shields = Math.min(s.shields, d.maxShields);
  if (s.shieldCharge < 0) s.shieldCharge = Math.min(0, s.shieldCharge + dt / SHIELD_MS);
  else if (s.shields >= d.maxShields) s.shieldCharge = 0;
  else if ((s.shieldCharge += dt * (1 - overheat(c)) / (SHIELD_MS * (manned(ctx, s, 'shields', 'engineer') ? .8 : 1) * (has(s, 'shield-capacitor') ? .7 : 1) * (c.hazard === 'ion-storm' ? 1.5 : 1))) >= 1) { s.shields++; s.shieldCharge = 0; }
  const rate = chargeRate(ctx, s), powered = d.levels.weapons ?? 0;
  // The 1e-9 absorbs float drift so a full charge is exactly 1 (fire() and the views agree on "charged").
  s.weapons.forEach((w, i) => { const ms = wdef(w.defId).chargeMs; w.powered = i < powered; w.charge = w.powered ? Math.min(1, w.charge + dt * rate / ms + 1e-9) : Math.max(0, w.charge - dt / ms); });
}
const chargeRate = (ctx: Ctx, s: Ship) => (manned(ctx, s, 'weapons', 'gunner') ? 1.1 : 1) * (has(s, 'auto-loader') ? 1.12 : 1) * (s.faction === 'enemy' ? ctx.c!.enemyCharge : 1);
/** Powered, aimed at an active ship, and has the ammo. */
export const armed = (ctx: Ctx, s: Ship, w: WeaponState) => { const to = w.target && ctx.ships.get(w.target.shipId); return w.powered && to?.status === 'active' && s.ammo >= wdef(w.defId).ammo; };

/** Fire weapon slot i if charged and armed. Each shot becomes a projectile; flak scatters over the target room and its neighbours. */
export function fire(ctx: Ctx, s: Ship, i: number) {
  const c = ctx.c!, w = s.weapons[i], def = wdef(w.defId);
  if (w.charge < 1 || !armed(ctx, s, w)) return false;
  const to = ctx.ships.get(w.target!.shipId)!, around = def.kind === 'flak' ? [w.target!.roomId, ...neighbors(hullOf(to), w.target!.roomId)] : [w.target!.roomId];
  if (def.ammo && !(has(s, 'missile-recycler') && rand(c) < .35)) s.ammo -= def.ammo;
  w.charge = 0;
  emit(c, 'launch', s.id, { weaponId: def.id });
  for (let k = def.kind === 'beam' ? 1 : def.shots; k > 0; k--) {
    const roomId = pick(c, around), flight = FLIGHT_MS[def.kind] + (def.kind === 'ion' || def.kind === 'beam' ? 0 : Math.round(rand(c) * 400));
    c.projectiles.push({ id: `${c.id}-${c.nextId++}`, kind: def.kind, weaponId: def.id, fromShipId: s.id, toShipId: to.id, roomId, mount: i, launchMs: c.t, arriveMs: c.t + flight });
  }
  return true;
}
/** AI volleys: hold charged weapons until the rest are ready, unless the slowest is more than HOLD_MS away. */
function volley(ctx: Ctx, s: Ship) {
  const ready = s.weapons.filter(w => armed(ctx, s, w));
  if (!ready.some(w => w.charge >= 1)) return;
  const rate = chargeRate(ctx, s), wait = Math.max(...ready.map(w => (1 - w.charge) * wdef(w.defId).chargeMs / rate));
  if (wait <= 0 || wait > HOLD_MS) s.weapons.forEach((_, i) => fire(ctx, s, i));
}

/** Resolve an arriving shot: point defense → evasion → shields → damage. Support shots always land. */
function land(ctx: Ctx, p: Projectile) {
  const c = ctx.c!, to = ctx.ships.get(p.toShipId), from = ctx.ships.get(p.fromShipId) ?? null, def = wdef(p.weaponId), room = to?.rooms.find(r => r.id === p.roomId);
  if (!to || to.status !== 'active' || !room) return;
  const at: Hit = { roomId: room.id, fromShipId: p.fromShipId, weaponId: def.id };
  if (def.support) return support(ctx, to, room, def, at);
  const d = derived(ctx, to), pd = d.levels.defense ?? 0;
  if ((p.kind === 'missile' || p.kind === 'flak') && pd && to.defenseCooldownMs <= 0) { to.defenseCooldownMs = DEFENSE_MS[tier(pd)]; return emit(c, 'intercept', to.id, at); }
  if (p.kind !== 'beam' && rand(c) * 100 < d.evasion - (from && has(from, 'precision-optics') ? 10 : 0)) return emit(c, 'miss', to.id, at);
  const layers = to.shields + to.tempShield, shielded = layers > def.pierce;
  if (shielded && p.kind !== 'beam') {
    const n = strip(to, p.kind === 'ion' ? def.ion : 1);
    if (p.kind === 'ion') to.shieldCharge = -ION_LOCK_MS * (has(to, 'ion-dampers') ? .5 : 1) / SHIELD_MS;
    return emit(c, 'shield', to.id, { ...at, amount: n });
  }
  if (p.kind === 'ion') { room.ionMs += 6000 * def.ion * (has(to, 'ion-dampers') ? .5 : 1); return emit(c, 'ion', to.id, at); }
  let dmg = def.damage - (shielded ? layers : 0);
  if (dmg > 0 && has(to, 'reactive-armor') && rand(c) < .2) dmg--;
  if (dmg <= 0) return emit(c, 'shield', to.id, at);
  for (const id of p.kind === 'beam' ? sweep(c, to, room.id, def.beamRooms ?? 1) : [room.id]) hit(ctx, to, to.rooms.find(r => r.id === id)!, dmg, def, from);
}
function strip(s: Ship, n: number) {
  const a = Math.min(s.tempShield, n), b = Math.min(s.shields, n - a);
  s.tempShield -= a; s.shields -= b; if (!s.tempShield) s.tempShieldMs = 0;
  return a + b;
}
/** Beam path: the target room, then random unvisited neighbours. */
function sweep(c: Combat, s: Ship, start: string, n: number) {
  const hull = hullOf(s), rooms = [start];
  for (let next: string[]; rooms.length < n && (next = neighbors(hull, rooms[rooms.length - 1]).filter(id => !rooms.includes(id))).length;) rooms.push(pick(c, next));
  return rooms;
}
function hit(ctx: Ctx, s: Ship, room: RoomState, dmg: number, def: WeaponDef | null, from: Ship | null) {
  const c = ctx.c!;
  s.hull = Math.max(0, s.hull - dmg);
  if (from) s.lastHitBy = from.id;
  emit(c, 'hit', s.id, { roomId: room.id, amount: dmg, ...from && { fromShipId: from.id }, ...def && { weaponId: def.id } });
  damageSystem(ctx, s, room, dmg);
  for (const m of crewOn(ctx, s)) if (m.roomId === room.id) hurt(ctx, m, (def?.crewDamage ?? 10) * dmg);
  if (def?.fireChance && rand(c) < def.fireChance) ignite(ctx, s, room);
  if (def?.breachChance && !room.breach && rand(c) < def.breachChance) { room.breach = true; emit(c, 'breach', s.id, { roomId: room.id }); }
}
function support(ctx: Ctx, to: Ship, room: RoomState, def: WeaponDef, at: Hit) {
  const c = ctx.c!;
  let amount = 1;
  if (def.support === 'repair') { amount = Math.min(def.damage, to.maxHull - to.hull); to.hull += amount; room.damage = Math.max(0, room.damage - 1); }
  else if (def.support === 'shield') { to.tempShield = 1; to.tempShieldMs = AEGIS_MS; }
  else amount = crewOn(ctx, to).reduce((sum, m) => { if (!alive(m) || m.roomId !== room.id || m.faction !== to.faction) return sum; const h = Math.min(def.damage, m.maxHp - m.hp); m.hp += h; return sum + h; }, 0);
  emit(c, 'heal', to.id, { ...at, amount: Math.round(amount) });
}

function hazards(ctx: Ctx, t0: number, active: Ship[]) {
  const c = ctx.c!;
  if (c.hazard === 'asteroids' && crossed(t0, c.t, 6000)) {
    const s = pick(c, active), room = pick(c, s.rooms);
    emit(c, 'hazard', s.id, { roomId: room.id });
    if (s.shields + s.tempShield) emit(c, 'shield', s.id, { roomId: room.id, amount: strip(s, 1) }); else hit(ctx, s, room, 1, null, null);
  }
  if (c.hazard === 'solar' && crossed(t0, c.t, 20000)) {
    const s = pick(c, active);
    emit(c, 'hazard', s.id);
    for (let k = 0; k < 2; k++) ignite(ctx, s, pick(c, s.rooms));
  }
}

/** Hull at 0: a boss moves to its next phase, anything else explodes with everyone aboard. */
function wreck(ctx: Ctx, s: Ship) {
  const c = ctx.c!;
  if (s.phase + 1 < s.phases.length) {
    const ph = s.phases[++s.phase];
    s.maxHull = s.hull = ph.maxHull;
    for (const r of s.rooms) Object.assign(r, { tier: r.system ? ph.systems[r.system] ?? r.tier : 0, damage: 0, ionMs: 0, fire: 0, breach: false, repair: 0 });
    s.weapons = weaponStates(`${s.id}-p${s.phase}`, ph.weapons, lv(s, 'weapons'));
    Object.assign(s, { shields: lv(s, 'shields'), shieldCharge: 0, fleeAtMs: null });
    return emit(c, 'phase', s.id, { amount: s.phase });
  }
  s.status = 'destroyed';
  for (const m of ctx.world.crew) if (m.shipId === s.id && alive(m)) Object.assign(m, { hp: 0, state: 'dead', path: [] });
  gone(ctx, s);
  emit(c, 'explode', s.id, s.lastHitBy ? { fromShipId: s.lastHitBy } : {});
}
/** A crewed enemy (not the boss) whose last crew member aboard has died is scuttled: allied boarders beam home and take the kill, then it explodes. */
function scuttle(ctx: Ctx, s: Ship) {
  const own = ctx.world.crew.filter(m => m.shipId === s.id && m.faction === s.faction);
  if (s.faction !== 'enemy' || s.phases.length || hullOf(s).automated || !own.length || own.some(alive)) return;
  const boarders = crewOn(ctx, s).filter(m => alive(m) && m.faction !== s.faction);
  if (boarders.length) s.lastHitBy = ctx.world.ships.find(o => o.captainId === boarders[0].ownerId)?.id ?? s.lastHitBy;
  for (const m of boarders) rescue(ctx, m);
  wreck(ctx, s);
}
/** Forget a ship that left the fight: drop shots at it and clear every target on it. */
function gone(ctx: Ctx, s: Ship) {
  ctx.c!.projectiles = ctx.c!.projectiles.filter(p => p.toShipId !== s.id);
  for (const o of ctx.world.ships) for (const w of o.weapons) if (w.target?.shipId === s.id) w.target = null;
}
/** Enemies below fleeBelow start a countdown; it pauses while their engines are down or the helm is empty. */
function flee(ctx: Ctx, dt: number) {
  const c = ctx.c!;
  for (const s of ctx.world.ships) {
    if (s.status !== 'active' || s.faction !== 'enemy') continue;
    if (s.fleeAtMs === null && s.fleeBelow > 0 && s.hull / s.maxHull < s.fleeBelow) s.fleeAtMs = c.t + FLEE_MS;
    if (s.fleeAtMs === null) continue;
    if (!lv(s, 'engines') || !lv(s, 'helm') || !hullOf(s).automated && !helmCrew(s, crewOn(ctx, s)).length) s.fleeAtMs += dt;
    else if (c.t >= s.fleeAtMs) {
      s.status = 'fled';
      gone(ctx, s);
      for (const m of crewOn(ctx, s).slice()) if (alive(m) && m.faction !== s.faction) rescue(ctx, m);
      emit(c, 'flee', s.id);
    }
  }
}

/** Enemy AI and autopilot targeting: keep valid targets, otherwise focus one foe (autopilot: nearest, hunter: weakest, else random). */
function aim(ctx: Ctx, s: Ship, active: Ship[]) {
  const c = ctx.c!, foes = active.filter(o => o.faction !== s.faction), friends = active.filter(o => o.faction === s.faction);
  const valid = (w: WeaponState) => ctx.ships.get(w.target?.shipId ?? '')?.status === 'active';
  let focus = s.weapons.filter(w => valid(w) && !wdef(w.defId).support).map(w => ctx.ships.get(w.target!.shipId)!)[0];
  for (const w of s.weapons) {
    const def = wdef(w.defId);
    if (valid(w) || !(def.support ? friends : foes).length) continue;
    if (def.support) { const ally = weakest(friends); w.target = { shipId: ally.id, roomId: supportRoom(ctx, ally, def) }; continue; }
    focus ??= s.autopilot ? foes.reduce((a, b) => Math.abs(b.slot - s.slot) < Math.abs(a.slot - s.slot) ? b : a) : s.ai === 'hunter' ? weakest(foes) : pick(c, foes);
    w.target = { shipId: focus.id, roomId: targetRoom(c, s, focus, def) };
  }
}
const weakest = (ships: Ship[]) => ships.reduce((a, b) => b.hull / b.maxHull < a.hull / a.maxHull ? b : a);
function targetRoom(c: Combat, s: Ship, to: Ship, def: WeaponDef) {
  const prefer: SystemId[] = s.autopilot ? ['shields', 'weapons'] : s.ai === 'weapons' ? ['weapons'] : s.ai === 'shields' || def.kind === 'laser' || def.kind === 'ion' || def.kind === 'flak' ? ['shields'] : [];
  const systems = to.rooms.filter(r => r.tier > 0);
  return (prefer.map(id => systemRoom(to, id)).find(Boolean) ?? (systems.length ? pick(c, systems) : pick(c, to.rooms))).id;
}
function supportRoom(ctx: Ctx, to: Ship, def: WeaponDef) {
  const hurtCrew = crewOn(ctx, to).filter(m => alive(m) && m.faction === to.faction && m.hp < m.maxHp);
  if (def.support === 'heal' && hurtCrew.length) return hurtCrew.reduce((a, b) => b.hp / b.maxHp < a.hp / a.maxHp ? b : a).roomId;
  const damaged = to.rooms.filter(r => r.damage > 0);
  return (def.support === 'repair' && damaged.length ? damaged.reduce((a, b) => b.damage > a.damage ? b : a) : systemRoom(to, 'shields') ?? to.rooms[0]).id;
}
function autoCloak(ctx: Ctx, s: Ship) {
  if (lv(s, 'cloak') && !s.cloakMs && !s.cloakCooldownMs && ctx.c!.projectiles.filter(p => p.toShipId === s.id && p.kind !== 'support').length >= 2) cloak(ctx, s);
}
export function cloak(ctx: Ctx, s: Ship) {
  s.cloakMs = CLOAK_MS[tier(lv(s, 'cloak'))];
  s.cloakCooldownMs = s.cloakMs + CLOAK_COOLDOWN_MS;
  emit(ctx.c!, 'cloak', s.id);
}
