/* Thieves: analog movement, push-to-work interactions, specialist passives and tools. */
import { RADIUS, SAFE_COINS, SIGHT, SNEAK_STICK, SPEED, TIMING, WORK, type MapObject, type Point } from '../model';
import { castRay, cellIndex, fits, lineOfSight, moveCircle } from '../geometry';
import { angleDiff, cellDist, credit, dist, doorAt, effect, glassBetween, grids, mapOf, revive, say, setDoor, shatter, unhide, vulnerable, type Crew, type State } from './state';
import { noise, perceive, stun, unaware } from './npc';

const DEADZONE = .12, COIN_REACH = .55, BIRD_REACH = 3.5, PUSH_COS = .6, CELL_REACH = .4, WIND = { after: 6000, giveUp: 20000, health: 30, near: 2.5 };
const sneaking = (p: Crew) => p.input.sneak || Math.hypot(p.input.x, p.input.y) < SNEAK_STICK;
export type Target = Point & { id: string; kind: 'door' | 'lock' | 'force' | 'window' | 'safe' | 'terminal' | 'objective' | 'pickup' | 'vent' | 'hide' | 'medkit' | 'revive' | 'dig'; label: string; hint: string; seconds: number; object?: MapObject; mate?: Crew; to?: Point };

/** Everything this thief could work on right now, before reach and push-direction checks. */
function candidates(s: State, p: Crew): Target[] {
  const map = mapOf(s), noun = map.objectiveKind, out: Target[] = [], fast = (role: Crew['role']) => p.role === role ? 3 : 1;
  for (const q of s.crew) if (q !== p && q.down && !q.suspended) out.push({ id: `revive-${q.id}`, kind: 'revive', x: q.x, y: q.y, mate: q, label: `Reviving ${q.name}`, hint: `Push into ${q.name} to revive them.`, seconds: p.role === 'face' ? 1 : WORK.revive });
  if (s.objective.taken && !s.objective.carrier) out.push({ id: 'objective', kind: 'pickup', x: s.objective.x, y: s.objective.y, label: `Grabbing the ${noun}`, hint: `Push into the ${noun} to pick it up.`, seconds: WORK.pickup });
  for (const o of map.objects) {
    const base = { id: o.id, x: o.x, y: o.y, object: o };
    if (o.kind === 'door' || o.kind === 'window') {
      const state = s.doors[doorAt(s, o.x, o.y)];
      if (o.kind === 'door' && state === 'c') out.push({ ...base, kind: 'door', label: 'Door', hint: '', seconds: 0 });
      else if (state === 'l') out.push(p.role === 'breacher'
        ? { ...base, kind: 'force', label: 'Forcing the door', hint: 'Push into the door to force it open. Loud!', seconds: WORK.force }
        : { ...base, kind: 'lock', label: 'Picking the lock', hint: p.role === 'cracker' ? 'Push into the lock to pick it. You are quick at this.' : 'Push into the lock to pick it.', seconds: WORK.lock / fast('cracker') });
      else if (o.kind === 'window' && state === 'c') {
        const across = o.horizontal ? { x: 0, y: Math.sign(o.y - p.y) || 1 } : { x: Math.sign(o.x - p.x) || 1, y: 0 }, to = { x: o.x + across.x * .85, y: o.y + across.y * .85 };
        if (fits(grids(s).grid, to.x, to.y)) out.push({ ...base, kind: 'window', to, label: 'Climbing through', hint: 'Push into the window to climb through.', seconds: WORK.window });
      }
    } else if (o.kind === 'safe' && !s.spent.includes(o.id)) out.push({ ...base, kind: 'safe', label: 'Cracking the safe', hint: `Push into the safe to crack it for ${SAFE_COINS} coins.`, seconds: WORK.safe / fast('cracker') });
    else if (o.kind === 'terminal' && !(s.circuits[o.circuit ?? ''] > s.now)) out.push({ ...base, kind: 'terminal', label: `Hacking ${o.label}`, hint: `Push into the terminal to shut down ${o.label.toLowerCase()}.`, seconds: WORK.terminal / fast('wire') });
    else if (o.kind === 'objective' && !s.objective.taken) out.push({ ...base, kind: 'objective', label: `Taking the ${noun}`, hint: `Push into the pedestal to take the ${noun}.`, seconds: WORK.objective / fast('cracker') });
    else if (o.kind === 'vent' && o.pair) out.push({ ...base, kind: 'vent', to: map.objects.find(v => v.id === o.pair), label: 'Crawling in', hint: 'Push into the vent to crawl through.', seconds: WORK.vent });
    else if (o.kind === 'hide' && p.hideSpot !== o.id && sneaking(p)) out.push({ ...base, kind: 'hide', label: 'Hiding', hint: 'Sneak into the hiding spot to hide.', seconds: WORK.hide });
    else if (o.kind === 'medkit' && !s.spent.includes(o.id) && p.health < 100) out.push({ ...base, kind: 'medkit', label: 'Patching up', hint: 'Push into the first aid kit to heal.', seconds: WORK.medkit });
  }
  if (p.role === 'breacher') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
    if (map.tiles[y]?.[x] === '%' && !s.broken.includes(y * map.width + x)) out.push({ id: `wall-${x}-${y}`, kind: 'dig', x: x + .5, y: y + .5, label: 'Digging through', hint: 'Push into the cracked wall to dig through. Loud!', seconds: WORK.dig });
  }
  return out;
}
const cellTarget = (t: Target) => !['revive', 'pickup', 'vent', 'hide', 'medkit'].includes(t.kind);
/** The target this thief is pushing into (dir set), or the nearest one in reach for phone hints (dir null). */
export function pickTarget(s: State, p: Crew, dir: Point | null): Target | null {
  let best: Target | null = null, score = -Infinity;
  for (const t of candidates(s, p)) {
    const d = dist(p, t), reach = cellTarget(t) ? cellDist(p, Math.floor(t.x), Math.floor(t.y)) <= CELL_REACH * (dir ? 1 : 2) : d <= RADIUS.interact * (dir ? 1 : 1.5) && (d > .25 || t.kind === 'pickup');
    if (!reach) continue;
    const facing = dir && !(t.kind === 'pickup' && d < .3) ? ((t.x - p.x) * dir.x + (t.y - p.y) * dir.y) / (d || 1) : 1;
    if (facing < PUSH_COS || (!dir && t.kind === 'door')) continue;
    const value = facing - d * .1 + (t.kind === 'revive' ? 2 : t.kind === 'pickup' || t.kind === 'objective' ? 1 : 0);
    if (value > score) { score = value; best = t; }
  }
  return best;
}

function complete(s: State, p: Crew, t: Target) {
  delete s.progress[t.id]; p.work = null;
  const map = mapOf(s), o = t.object;
  switch (t.kind) {
    case 'lock': setDoor(s, doorAt(s, t.x, t.y), 'o'); effect(s, t, 'unlock', 'Unlocked'); break;
    case 'force': setDoor(s, doorAt(s, t.x, t.y), 'b'); noise(s, t, RADIUS.decoyNoise, 'loud', true); effect(s, t, 'break', 'Forced open'); break;
    case 'dig': s.broken.push(cellIndex(map, t)); noise(s, t, RADIUS.decoyNoise, 'loud', true); effect(s, t, 'break', 'Broke through'); break;
    case 'window': case 'vent': Object.assign(p, { x: t.to!.x, y: t.to!.y }); break;
    case 'safe': s.spent.push(t.id); credit(s, p, SAFE_COINS); effect(s, t, 'safe', `+${SAFE_COINS}`); break;
    case 'medkit': s.spent.push(t.id); p.health = 100; effect(s, p, 'heal', 'Patched up'); break;
    case 'revive': revive(s, t.mate!, 50, p); break;
    case 'terminal':
      s.circuits[o!.circuit ?? ''] = s.now + TIMING.circuitOff * (p.role === 'wire' ? 2 : 1);
      effect(s, t, 'hack', `${o!.label} offline`); break;
    case 'hide':
      p.witnesses = s.npcs.filter(n => perceive(s, n, p) > 0 || n.target === p.id && lineOfSight(grids(s).grid, n, p, s.smoke, s.now)).map(n => n.id);
      Object.assign(p, { x: t.x, y: t.y, hidden: true, hideLatch: true, hideSpot: t.id }); break;
    case 'objective': case 'pickup':
      if (!s.objective.taken && s.squad.length) s.squadAt = s.now + s.squadDelay;
      s.objective = { x: p.x, y: p.y, carrier: p.id, taken: true }; s.phase = 'escape';
      say(s, `${p.name} has the ${map.objectiveKind}! Everyone to the getaway.`);
      effect(s, p, 'objective', `Got the ${map.objectiveKind}`); break;
  }
}

function move(s: State, p: Crew, dt: number) {
  const { x, y } = p.input, mag = Math.min(1, Math.hypot(x, y)), dir = mag > DEADZONE ? { x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) } : null;
  const wasMoving = p.moving;
  p.moving = p.running = false;
  if (!dir) { p.work = null; p.hideLatch = false; return; }
  // The push that hid you keeps you hidden; let go or push hard to slip out.
  if (p.hideLatch && sneaking(p)) return;
  p.facing = Math.atan2(dir.y, dir.x);
  if (p.hidden) unhide(p);
  const t = pickTarget(s, p, dir);
  if (t?.kind === 'door') setDoor(s, doorAt(s, t.x, t.y), 'o');
  else if (t) {
    const progress = Math.min(1, (s.progress[t.id] ?? 0) + dt / t.seconds);
    s.progress[t.id] = progress; p.work = { target: t.id, label: t.label, progress };
    if (progress >= 1) complete(s, p, t);
    return;
  }
  p.work = null;
  const quiet = sneaking(p), speed = (quiet ? SPEED.sneak : SPEED.run) * (s.objective.carrier === p.id ? SPEED.carry : 1) * dt;
  const step = (a: number) => moveCircle(grids(s).grid, p, (dir.x * Math.cos(a) - dir.y * Math.sin(a)) * speed, (dir.x * Math.sin(a) + dir.y * Math.cos(a)) * speed);
  let to = step(0);
  // Corner assist: when a corner (not a flat wall) stops the push, slide around it the only way that moves.
  if (dist(to, p) < speed / 2) { const [l, r] = [step(.6), step(-.6)], ml = dist(l, p) >= speed / 2, mr = dist(r, p) >= speed / 2; if (ml !== mr) to = ml ? l : r; }
  p.moving = Math.abs(to.x - p.x) + Math.abs(to.y - p.y) > 1e-4; p.running = p.moving && !quiet; p.x = to.x; p.y = to.y;
  if (p.running && (s.now >= p.stepAt || !wasMoving)) { noise(s, p, RADIUS.stepNoise, 'step', true); p.stepAt = s.now + TIMING.stepEvery; }
}

function loot(s: State, p: Crew) {
  const map = mapOf(s), bird = p.role === 'magpie' && s.now >= p.birdAt;
  let coins = s.coins;
  for (let i = 0; i < map.coins.length; i++) {
    if (coins[i] !== '1') continue;
    const c = map.coins[i], d = dist(p, c);
    if (d > COIN_REACH && !(bird && d <= BIRD_REACH && lineOfSight(grids(s).grid, p, c))) continue;
    if (d > COIN_REACH) p.birdAt = s.now + 150;
    coins = coins.slice(0, i) + '0' + coins.slice(i + 1); credit(s, p, 1); effect(s, c, 'coin', '+1');
    if (d > COIN_REACH) break;
  }
  s.coins = coins;
}

function passives(s: State, p: Crew) {
  if (p.role === 'ghost') for (const n of s.npcs) if (n.kind !== 'dog' && (unaware(n) || n.state === 'charmed') && n.state !== 'stunned' && dist(p, n) < RADIUS.actor * 2 + .15) {
    stun(s, n, 25000); s.stats[p.id].takedowns++; effect(s, n, 'takedown', 'Lights out', false);
  }
  if (p.role === 'face' && s.now >= p.charmReady && !p.hidden && !s.npcs.some(n => n.charmedBy === p.id)) {
    const n = s.npcs.filter(n => n.kind === 'guard' && unaware(n) && dist(p, n) <= 2.5 && lineOfSight(grids(s).grid, p, n, s.smoke, s.now)).sort((a, b) => dist(p, a) - dist(p, b))[0];
    if (n) { Object.assign(n, { state: 'charmed', charmedBy: p.id, stateUntil: s.now + TIMING.charm, suspicion: 0, target: null, aimAt: 0, aim: null, goal: null, path: [] }); effect(s, n, 'charm', 'Charmed', true, p.id); }
  }
  if (p.role === 'impostor') {
    if (s.npcs.some(n => n.state === 'chase' && n.target === p.id)) { p.disguised = false; p.seenAt = s.now; }
    else if (!p.disguised && s.now - p.seenAt >= TIMING.disguise) { p.disguised = true; effect(s, p, 'disguise', 'Back in disguise'); }
  }
}
/** A lone thief gets back up once per heist, 6 s after going down, once no guard or dog is looking at them or close by. */
function secondWind(s: State, p: Crew) {
  if (!p.wind || s.crew.some(q => q !== p && !q.suspended) || s.now - p.downAt < WIND.after) return;
  const watched = s.npcs.some(n => n.kind !== 'civilian' && n.state !== 'stunned' && n.state !== 'charmed' && dist(n, p) <= SIGHT.guardRange
    && (dist(n, p) <= WIND.near || angleDiff(n.facing, Math.atan2(p.y - n.y, p.x - n.x)) <= SIGHT.guardHalfAngle) && lineOfSight(grids(s).grid, n, p, s.smoke, s.now));
  if (watched && s.now - p.downAt < WIND.giveUp) return;
  p.wind = false;
  if (!watched) { revive(s, p, WIND.health, p); say(s, `${p.name} caught a second wind. Get out of sight!`); }
}

export function tickCrew(s: State, dt: number) {
  for (const p of s.crew) {
    if (!vulnerable(p)) { p.work = null; p.moving = p.running = false; if (p.down) secondWind(s, p); continue; }
    move(s, p, dt);
    loot(s, p);
    passives(s, p);
    if (s.objective.carrier === p.id) { s.objective.x = p.x; s.objective.y = p.y; }
  }
}

/** Fires this thief's tool. Throws a friendly reason when it cannot be used. */
export function useTool(s: State, p: Crew) {
  if (!vulnerable(p) || !p.connected) throw Error('You cannot use tools right now.');
  if (p.charges < 1) throw Error('No charges left. Every 10 coins refills one.');
  if (s.now < p.toolAt) throw Error('Tool is still recovering.');
  const { grid } = grids(s), f = p.facing, dir = { x: Math.cos(f), y: Math.sin(f) }, ahead = (d: number) => ({ x: p.x + dir.x * d, y: p.y + dir.y * d });
  const sees = (q: Point, range: number, smoke = true) => dist(p, q) <= range && lineOfSight(grid, p, q, smoke ? s.smoke : [], s.now);
  switch (p.tool) {
    case 'smoke':
      s.smoke.push({ x: p.x, y: p.y, radius: 2.5, until: s.now + TIMING.smoke, born: s.now }); effect(s, p, 'smoke', 'Smoke'); break;
    case 'tranq': {
      const n = s.npcs.filter(n => n.state !== 'stunned' && angleDiff(f, Math.atan2(n.y - p.y, n.x - p.x)) <= 25 * Math.PI / 180 && sees(n, 9)).sort((a, b) => dist(p, a) - dist(p, b))[0];
      const hit = !!n && !glassBetween(s, p, n);
      if (hit) { stun(s, n, 20000); s.stats[p.id].takedowns++; effect(s, n, 'takedown', 'Tranquilised', false); }
      s.shots.push({ from: { x: p.x, y: p.y }, to: n ? { x: n.x, y: n.y } : ahead(castRay(grid, p.x, p.y, dir.x, dir.y, 9)), at: s.now, hit, kind: 'tranq', crew: true }); break;
    }
    case 'shotgun': {
      const inCone = (q: Point) => angleDiff(f, Math.atan2(q.y - p.y, q.x - p.x)) <= Math.PI / 6 && sees(q, 4.5, false);
      const hits = s.npcs.filter(n => n.state !== 'stunned' && inCone(n));
      for (const n of hits) { stun(s, n, 12000); s.stats[p.id].takedowns++; effect(s, n, 'takedown', 'Knocked down', false); }
      for (let y = Math.floor(p.y - 5); y <= p.y + 5; y++) for (let x = Math.floor(p.x - 5); x <= p.x + 5; x++) if (inCone({ x: x + .5, y: y + .5 })) shatter(s, x, y);
      s.shots.push({ from: { x: p.x, y: p.y }, to: ahead(castRay(grid, p.x, p.y, dir.x, dir.y, 4.5)), at: s.now, hit: hits.length > 0, kind: 'shotgun', crew: true });
      noise(s, p, RADIUS.loudNoise, 'loud', true); break;
    }
    case 'emp':
      for (const o of mapOf(s).objects) if ((o.kind === 'camera' || o.kind === 'laser') && dist(p, o) <= 10) s.deviceOff[o.id] = s.now + TIMING.emp;
      s.silence.push({ x: p.x, y: p.y, until: s.now + TIMING.emp }); effect(s, p, 'emp', 'EMP'); break;
    case 'medkit': {
      const mates = s.crew.filter(q => !q.suspended && (q.down || q.health < 100) && sees(q, 2.5, false));
      if (!mates.length) throw Error('Nobody nearby needs patching up.');
      for (const q of mates) { if (q.down) revive(s, q, 60, p); else q.health = Math.min(100, q.health + 60); effect(s, q, 'heal', 'Patched up'); }
      break;
    }
    case 'decoy': {
      const d = Math.max(.3, Math.min(5, castRay(grid, p.x, p.y, dir.x, dir.y, 5.4, grid.solid) - .4));
      s.decoys.push({ ...ahead(d), at: s.now + 600 }); effect(s, ahead(d), 'decoy', 'Decoy'); break;
    }
  }
  p.charges--; p.toolAt = s.now + 500; p.disguised = false; p.seenAt = s.now; unhide(p); s.stats[p.id].tools++;
}
