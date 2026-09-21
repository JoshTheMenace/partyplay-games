import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { DEFAULT_CHOICE, MISSIONS, ROLES, SIGHT, TOOLS, neutralInput, type Action, type Choice, type Effect, type GuardView, type Input, type ObjectView, type PlayerView, type Point, type Settings, type View } from './model';
import { getMap } from './maps';
import { getGuards } from './server-levels';
import { findPath, lineOfSight, move, visibleCells } from './geometry';

type Player = PlayerView & { absentAt: number | null; toolAt: number; hitAt: number; unseenAt: number; ventAt: number; workingAt: number; sneaking: boolean; moving: boolean };
type Guard = GuardView & { patrol: Point[]; waypoint: number; lastKnown: Point | null; lostAt: number; stunUntil: number; charmOwner: string | null; nextPathAt: number; path: Point[] };
export type State = Omit<View, 'players' | 'guards'> & { players: Player[]; guards: Guard[]; settings: Settings; seed: number; startedAt: number; wallAt: number; paused: number; pauseAt: number | null; nextEffect: number; knownEffects: number[]; alarmUntil: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const vulnerable = (p: Player) => !p.down && !p.suspended;
const live = (p: Player) => p.connected && vulnerable(p);
const playing = (s: State) => s.phase === 'infiltrate' || s.phase === 'escape';
const point = (p: Point): Point => ({ x: p.x, y: p.y });
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function choice(raw: unknown): Choice {
  if (raw == null) return { ...DEFAULT_CHOICE };
  const v = record(raw), role = v.role ?? DEFAULT_CHOICE.role, tool = v.tool ?? DEFAULT_CHOICE.tool;
  if (Object.keys(v).some(k => !['role', 'tool'].includes(k)) || typeof role !== 'string' || !Object.hasOwn(ROLES, role) || typeof tool !== 'string' || !Object.hasOwn(TOOLS, tool)) throw Error('Choose a specialist and tool.');
  return { role, tool } as Choice;
}
function effect(s: State, p: Point, kind: Effect['kind'], label: string) {
  // Every event originates at a crew action or a known object, never at an unseen guard.
  s.knownEffects.push(s.nextEffect); s.knownEffects = s.knownEffects.slice(-32);
  s.effects.push({ ...point(p), id: s.nextEffect++, kind, label, at: s.now });
  s.effects = s.effects.slice(-32);
}
function clock(s: State, wall: number) {
  s.wallAt = Math.max(s.wallAt, wall);
  s.now = (s.pauseAt ?? s.wallAt) - s.paused;
  s.elapsed = Math.max(0, (s.now - s.startedAt) / 1000);
  s.adjustedSeconds = Math.round(s.elapsed + 10 * (s.totalLoot - s.collected));
}
function clearSight(s: State, a: Point, b: Point) {
  return lineOfSight(s.tiles, s.objects, a, b) && smokeSight(s, a, b);
}
function smokeSight(s: State, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  return !s.smoke.some(c => {
    const t = length2 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / length2)) : 0;
    return c.until > s.now && Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y) < c.radius;
  });
}
function cone(s: State, from: Point, facing: number, to: Point, range: number, wide = .45) {
  const d = distance(from, to);
  return d < range && (d < SIGHT.near || (Math.cos(facing) * (to.x - from.x) + Math.sin(facing) * (to.y - from.y)) / d > wide) && clearSight(s, from, to);
}
function noise(s: State, source: Point, radius = 10) {
  s.alarmUntil = s.now + 7000;
  for (const g of s.guards) if (g.alert !== 'stunned' && g.alert !== 'chase' && !g.charmOwner && distance(g, source) < radius) {
    g.lastKnown = point(source); g.alert = 'search'; g.lostAt = s.now; g.suspicion = Math.max(.4, g.suspicion); g.nextPathAt = 0;
  }
}
function credit(s: State, p: Player, amount: number) {
  p.charges += Math.floor((p.coins + amount) / 10) - Math.floor(p.coins / 10);
  p.coins += amount; s.collected += amount;
}
function revive(s: State, p: Player) {
  p.down = false; p.health = Math.max(p.health, 65); p.hitAt = s.now + 1500; p.work = null;
  effect(s, p, 'rescue', 'Back on your feet');
}
function hurt(s: State, p: Player, amount: number) {
  if (!vulnerable(p) || s.now < p.hitAt) return;
  p.health = Math.max(0, p.health - amount * (s.settings.difficulty === 'relaxed' ? .55 : 1)); p.hitAt = s.now + 1100; p.disguised = false; p.unseenAt = s.now;
  if (!p.health) { p.down = true; p.hidden = false; p.work = null; s.message = 'Crew down. Push toward them to revive.'; }
}
function disable(s: State, circuit: string | undefined, duration: number) {
  for (const o of s.objects) if (['camera', 'laser', 'terminal'].includes(o.kind) && (!circuit || o.circuit === circuit)) { o.until = Math.max(o.state === 'disabled' ? o.until : 0, s.now + duration); o.state = 'disabled'; }
}
function interaction(s: State, p: Player): ObjectView | Player | Point | null {
  const front = (o: Point, closeReach = true) => {
    const d = distance(p, o), dx = o.x - p.x, dy = o.y - p.y;
    return d < 1.12 && ((closeReach && d < .25) || (dx * p.facingX + dy * p.facingY) / d > .55) && lineOfSight(s.tiles, s.objects, p, { x: o.x - dx / Math.max(d, .01) * Math.min(.56, d), y: o.y - dy / Math.max(d, .01) * Math.min(.56, d) });
  };
  const down = s.players.find(q => q.id !== p.id && q.down && !q.suspended && front(q));
  if (down) return down;
  const object = s.objects.filter(o => front(o, o.kind !== 'hide') && (o.kind !== 'medkit' || p.health < 100) && (o.kind === 'hide' || (o.kind === 'vent' && s.now >= p.ventAt) || (o.state === 'ready' && ['door', 'safe', 'terminal', 'objective', 'medkit'].includes(o.kind)))).sort((a, b) => distance(p, a) - distance(p, b))[0];
  if (object) return object;
  const x = Math.floor(p.x + p.facingX * .8), y = Math.floor(p.y + p.facingY * .8);
  return p.role === 'breacher' && s.tiles[y]?.[x] === '%' ? { x: x + .5, y: y + .5 } : null;
}
function workSpec(target: ObjectView | Player | Point, p: Player): { id: string; label: string; seconds: number } {
  if ('down' in target) return { id: target.id, label: 'Reviving', seconds: p.role === 'face' ? 1.5 : 4 };
  if (!('kind' in target)) return { id: `wall:${target.x}:${target.y}`, label: 'Breaking wall', seconds: 2.5 };
  const seconds = { door: 3, safe: 5, terminal: 3, objective: 1.5, medkit: 1, hide: .1, vent: .5, camera: 1, laser: 1, exit: 1 }[target.kind];
  const fast = (p.role === 'cracker' && ['door', 'safe'].includes(target.kind)) || (p.role === 'wire' && target.kind === 'terminal');
  return { id: target.id, label: target.kind === 'hide' ? 'Hiding' : target.kind === 'vent' ? 'Entering vent' : target.label, seconds: seconds / (fast ? 3 : 1) };
}
function completeWork(s: State, p: Player, target: ObjectView | Player | Point) {
  p.work = null;
  if ('down' in target) { revive(s, target); return; }
  if (!('kind' in target)) {
    const x = Math.floor(target.x), y = Math.floor(target.y);
    s.tiles[y] = s.tiles[y].slice(0, x) + '.' + s.tiles[y].slice(x + 1); noise(s, target); effect(s, target, 'break', 'Shortcut opened'); return;
  }
  if (target.kind === 'hide') { p.hidden = true; return; }
  if (target.kind === 'vent') { if (target.target) Object.assign(p, point(target.target)); p.ventAt = s.now + 1800; return; }
  if (target.state !== 'ready') return;
  if (target.kind === 'terminal') { disable(s, target.circuit, p.role === 'wire' ? 30000 : 14000); effect(s, target, 'hack', 'Circuit disabled'); }
  else if (target.kind === 'door') { target.state = 'open'; effect(s, target, 'unlock', 'Door unlocked'); }
  else {
    target.state = 'empty';
    if (target.kind === 'safe') { credit(s, p, 10); effect(s, target, 'coin', '+10'); }
    if (target.kind === 'medkit') { p.health = 100; effect(s, p, 'heal', 'Patched up'); }
    if (target.kind === 'objective') { s.objectiveTaken = true; s.phase = 'escape'; s.message = 'Goods secured. Get the whole crew to the getaway.'; effect(s, target, 'unlock', 'Objective secured'); }
  }
}
function work(s: State, p: Player, active: boolean) {
  const target = active ? interaction(s, p) : null;
  if (!target || ('kind' in target && target.kind === 'hide' && distance(p, target) > .3)) { p.work = null; p.workingAt = s.now; return; }
  const spec = workSpec(target, p);
  if (p.work?.target !== spec.id) { p.work = { target: spec.id, label: spec.label, progress: 0 }; p.workingAt = s.now; }
  else { p.work.progress = Math.min(1, p.work.progress + Math.max(0, s.now - p.workingAt) / (spec.seconds * 1000)); p.workingAt = s.now; }
  if (p.work.progress >= 1) completeWork(s, p, target);
}
function stun(s: State, g: Guard, duration: number) {
  g.alert = 'stunned'; g.stunUntil = s.now + duration; g.suspicion = 0; g.charmOwner = null; g.charmed = false; g.path = [];
}
function guardStep(s: State, g: Guard, dt: number) {
  if (g.alert === 'stunned') { if (s.now < g.stunUntil) return; g.alert = 'search'; g.lostAt = s.now; g.lastKnown = point(g); }
  const owner = s.players.find(p => p.id === g.charmOwner && live(p));
  if (g.charmOwner && !owner) { g.charmOwner = null; g.charmed = false; g.alert = 'patrol'; }
  if (owner) { if (distance(g, owner) > 1.4) navigate(s, g, owner, dt, 1.8); return; }
  const candidates = s.players.filter(p => vulnerable(p) && (!p.hidden || (g.lastKnown && distance(g.lastKnown, p) < 1.2 && s.now - g.lostAt < 6500)) && cone(s, g, g.facing, p, p.sneaking ? SIGHT.guard.sneak : SIGHT.guard.range, SIGHT.guard.wide));
  const seen = candidates.filter(p => !p.disguised).sort((a, b) => distance(g, a) - distance(g, b))[0];
  for (const p of candidates) { p.unseenAt = s.now; if (p.disguised && distance(g, p) < 1.1) p.disguised = false; }
  if (seen) {
    g.lastKnown = point(seen); g.lostAt = s.now; g.suspicion = Math.min(1, g.suspicion + dt * (seen.sneaking ? .7 : 1.35));
    if (g.suspicion >= 1 || distance(g, seen) < 1.15) { g.alert = 'chase'; g.suspicion = 1; s.alarmUntil = s.now + 1800; }
    else g.alert = 'suspicious';
    if (g.alert === 'chase' && distance(g, seen) < .8) hurt(s, seen, 28);
  } else {
    if (g.alert === 'chase') { g.alert = 'search'; g.nextPathAt = 0; }
    g.suspicion = Math.max(0, g.suspicion - dt * .14);
    if ((g.alert === 'search' || g.alert === 'suspicious') && s.now - g.lostAt > 6500) { g.alert = 'patrol'; g.lastKnown = null; g.suspicion = 0; g.nextPathAt = 0; }
  }
  let destination = g.lastKnown;
  if (g.alert === 'patrol') { destination = g.patrol[g.waypoint]; if (destination && distance(g, destination) < .25) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; g.waypoint = (g.waypoint + 1 + (g.patrol.length > 2 ? s.seed % (g.patrol.length - 1) : 0)) % g.patrol.length; destination = g.patrol[g.waypoint]; } }
  if (destination) navigate(s, g, destination, dt, (g.alert === 'chase' ? 2.45 : g.alert === 'patrol' ? 1.15 : 1.6) * (s.settings.difficulty === 'relaxed' ? .8 : 1));
  if (!seen && g.alert === 'search' && destination && distance(g, destination) < .4) g.facing += dt * 1.3;
}
function navigate(s: State, g: Guard, destination: Point, dt: number, speed: number) {
  if (s.now >= g.nextPathAt) { g.path = findPath(s.tiles, s.objects, g, destination); g.nextPathAt = s.now + 400; }
  while (g.path.length && distance(g, g.path[0]) < .15) g.path.shift();
  const next = g.path[0] ?? (lineOfSight(s.tiles, s.objects, g, destination) ? destination : null); if (!next) return;
  const d = distance(g, next); if (d < .02) return;
  const step = Math.min(d, speed * dt), dx = (next.x - g.x) / d, dy = (next.y - g.y) / d;
  g.facing = Math.atan2(dy, dx); Object.assign(g, move(s.tiles, s.objects, g, dx * step, dy * step, .25));
}
export function create(ctx: RoundContext, settings: Settings): State {
  const map = getMap(settings.mission);
  return {
    heistId: ctx.roundId, mission: settings.mission, phase: 'infiltrate', now: ctx.nowMs, elapsed: 0, settings: { ...settings }, seed: ctx.seed,
    startedAt: ctx.nowMs, wallAt: ctx.nowMs, paused: 0, pauseAt: null, nextEffect: 1, knownEffects: [], alarmUntil: 0,
    players: ctx.players.map((p, i) => ({ ...point(map.spawns[i % map.spawns.length]), id: p.id, name: p.name, color: p.color, ...choice(p.lobbyChoice), health: 100, coins: 0, charges: 2, facingX: 1, facingY: 0, down: false, connected: true, suspended: false, hidden: false, disguised: choice(p.lobbyChoice).role === 'impostor', work: null, absentAt: null, toolAt: 0, hitAt: 0, unseenAt: ctx.nowMs, ventAt: 0, workingAt: ctx.nowMs, sneaking: false, moving: false })),
    guards: getGuards(settings.mission).map((g, i) => ({ ...point(g), id: g.id, patrol: g.patrol.map(point), waypoint: (Math.abs(ctx.seed) + i) % g.patrol.length, facing: 0, alert: 'patrol', suspicion: 0, charmed: false, lastKnown: null, lostAt: 0, stunUntil: 0, charmOwner: null, nextPathAt: 0, path: [] })),
    markers: [], objects: map.objects.map(o => ({ ...structuredClone(o), state: 'ready', until: 0 })), loot: map.loot.map(point), tiles: [...map.tiles], visible: [], smoke: [], effects: [],
    collected: 0, totalLoot: map.loot.length + map.objects.filter(o => o.kind === 'safe').length * 10, objectiveTaken: false, alarm: false, message: map.briefing, adjustedSeconds: 0,
  };
}
export const rules: GameRules<State, Input, Action, Settings, View, null> = {
  validateSettings(raw) {
    const v = record(raw), mission = v.mission ?? 'velvet', difficulty = v.difficulty ?? 'normal';
    if (Object.keys(v).some(k => !['mission', 'difficulty'].includes(k)) || typeof mission !== 'string' || !Object.hasOwn(MISSIONS, mission) || !['normal', 'relaxed'].includes(difficulty as string)) throw Error('Choose a mission and difficulty.');
    return { mission, difficulty } as Settings;
  },
  parseLobbyChoice: choice, neutralInput,
  parseInput(raw) {
    const v = record(raw);
    if (Object.keys(v).some(k => !['x', 'y', 'sneak'].includes(k)) || typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || typeof v.sneak !== 'boolean') throw Error('Invalid movement.');
    const length = Math.max(1, Math.hypot(v.x, v.y)); return { x: v.x / length, y: v.y / length, sneak: v.sneak };
  },
  parseAction(raw) {
    const v = record(raw);
    if (Object.keys(v).some(k => !['type', 'heistId', 'aim'].includes(k)) || v.type !== 'tool' || typeof v.heistId !== 'string' || !v.heistId.length || v.heistId.length > 128) throw Error('Invalid tool action.');
    if (v.aim == null) return { type: 'tool', heistId: v.heistId };
    const a = record(v.aim);
    if (Object.keys(a).some(k => !['x', 'y'].includes(k)) || typeof a.x !== 'number' || typeof a.y !== 'number' || !Number.isFinite(a.x) || !Number.isFinite(a.y) || Math.hypot(a.x, a.y) < .01 || Math.hypot(a.x, a.y) > 1.5) throw Error('Invalid aim.');
    const length = Math.hypot(a.x, a.y); return { type: 'tool', heistId: v.heistId, aim: { x: a.x / length, y: a.y / length } };
  },
  create,
  applyAction(s, id, action, wall) {
    const p = s.players.find(q => q.id === id);
    if (!p || !playing(s) || action.heistId !== s.heistId || !live(p)) throw Error('This tool action is no longer available.');
    clock(s, wall);
    if (s.now < p.toolAt || p.charges < 1) throw Error('Tool recharging. Collect ten coins for another charge.');
    if (action.aim) { const aim = rules.parseAction(action).aim!; p.facingX = aim.x; p.facingY = aim.y; }
    const target = p.tool === 'wrench' ? interaction(s, p) : null;
    if (p.tool === 'wrench' && !target) throw Error('Face a lock, object, or teammate first.');
    if (p.tool === 'medkit' && !s.players.some(q => !q.suspended && distance(p, q) < 2.2 && q.health < 100 && lineOfSight(s.tiles, s.objects, p, q))) throw Error('No injured crew nearby.');
    p.charges--; p.toolAt = s.now + 850; p.hidden = false;
    if (p.tool === 'smoke') { s.smoke.push({ ...point(p), radius: 2.2, until: s.now + 6500 }); effect(s, p, 'smoke', 'Smoke screen'); }
    if (p.tool === 'medkit') for (const q of s.players) if (!q.suspended && distance(p, q) < 2.2 && lineOfSight(s.tiles, s.objects, p, q)) { if (q.down) revive(s, q); q.health = Math.min(100, q.health + 65); effect(s, q, 'heal', 'Patched up'); }
    if (p.tool === 'wrench' && target) completeWork(s, p, target);
    if (p.tool === 'emp') { disable(s, undefined, 12000); effect(s, p, 'hack', 'Security offline'); }
    if (p.tool === 'tranq' || p.tool === 'shotgun') {
      const guards = s.guards.filter(g => g.alert !== 'stunned' && cone(s, p, Math.atan2(p.facingY, p.facingX), g, p.tool === 'tranq' ? 7 : 4, p.tool === 'tranq' ? .94 : .65)).sort((a, b) => distance(p, a) - distance(p, b));
      for (const g of p.tool === 'tranq' ? guards.slice(0, 1) : guards) stun(s, g, p.tool === 'tranq' ? 16000 : 11000);
      if (p.tool === 'shotgun') {
        for (let y = 0; y < s.tiles.length; y++) for (let x = 0; x < s.tiles[y].length; x++) if (s.tiles[y][x] === '=' && cone(s, p, Math.atan2(p.facingY, p.facingX), { x: x + .5, y: y + .5 }, 4, .65)) { s.tiles[y] = s.tiles[y].slice(0, x) + '.' + s.tiles[y].slice(x + 1); effect(s, { x: x + .5, y: y + .5 }, 'break', 'Glass shattered'); }
        noise(s, p, 14);
      }
      effect(s, p, 'shot', p.tool === 'tranq' ? 'Quiet shot' : 'Bang!');
    }
  },
  tick(s, inputs, dt, wall) {
    if (!playing(s)) return;
    clock(s, wall);
    for (const p of s.players) if (!p.connected && p.absentAt !== null && wall - p.absentAt >= 15000) p.suspended = true;
    if (s.pauseAt !== null) return;
    const wasAlarm = s.alarm;
    dt = Math.max(0, Math.min(.1, dt));
    s.smoke = s.smoke.filter(c => c.until > s.now); s.effects = s.effects.filter(e => s.now - e.at < 1600);
    for (const o of s.objects) if (o.state === 'disabled' && s.now >= o.until) { o.state = 'ready'; o.until = 0; }
    for (const p of s.players) {
      if (!live(p)) { p.work = null; p.hidden = false; continue; }
      const input = inputs.get(p.id) ?? neutralInput(), length = Math.hypot(input.x, input.y);
      p.moving = length > .08; p.sneaking = input.sneak;
      if (p.moving) { p.facingX = input.x / length; p.facingY = input.y / length; }
      const target = p.moving ? interaction(s, p) : null, atHide = !!target && 'kind' in target && target.kind === 'hide' && distance(p, target) <= .3;
      if (p.moving && !atHide) p.hidden = false;
      if (p.moving && !atHide && (!target || ('kind' in target && target.kind === 'hide'))) {
        const stride = Math.min(dt * (input.sneak ? 1.55 : 3.1), target ? Math.max(0, distance(p, target) - .24) : Infinity);
        Object.assign(p, move(s.tiles, s.objects, p, input.x * stride, input.y * stride));
      }
      work(s, p, p.moving);
      for (let i = s.loot.length - 1; i >= 0; i--) if (distance(p, s.loot[i]) < (p.role === 'magpie' ? 2.35 : .58) && lineOfSight(s.tiles, s.objects, p, s.loot[i])) { const coin = s.loot.splice(i, 1)[0]; credit(s, p, 1); effect(s, coin, 'coin', '+1'); }
      if (p.role === 'ghost') for (const g of s.guards) if (distance(p, g) < .72 && g.alert === 'patrol' && !g.charmOwner && lineOfSight(s.tiles, s.objects, p, g)) stun(s, g, 14000);
      if (p.role === 'face' && !s.guards.some(g => g.charmOwner === p.id)) { const g = s.guards.find(g => distance(p, g) < 2.2 && g.alert === 'patrol' && !g.charmOwner && clearSight(s, p, g)); if (g) { g.charmOwner = p.id; g.charmed = true; g.suspicion = 0; } }
    }
    for (const g of s.guards) guardStep(s, g, dt);
    for (const o of s.objects) if (o.state === 'ready' && ['camera', 'laser'].includes(o.kind)) for (const p of s.players.filter(vulnerable)) {
      if (!p.hidden && cone(s, o, o.facing ?? 0, p, o.kind === 'laser' ? SIGHT.laser.range : SIGHT.camera.range, o.kind === 'laser' ? SIGHT.laser.wide : SIGHT.camera.wide)) { p.unseenAt = s.now; if (p.disguised) continue; noise(s, p, 9); if (o.kind === 'laser') hurt(s, p, 20); }
    }
    for (const p of s.players) if (live(p) && p.role === 'impostor' && s.now - p.unseenAt >= 5000) p.disguised = true;
    s.alarm = s.now < s.alarmUntil;
    if (s.alarm && !wasAlarm) { const witness = s.players.find(p => live(p) && !p.hidden); if (witness) effect(s, witness, 'alarm', 'Security alerted'); }
    const required = s.players.filter(p => !p.suspended), connected = required.filter(p => p.connected), exit = s.objects.find(o => o.kind === 'exit');
    if (required.length && required.every(p => p.down)) { s.phase = 'failed'; s.message = 'The crew was caught. Regroup and try another route.'; }
    else if (s.objectiveTaken && connected.length && required.every(p => p.connected && !p.down && !!exit && distance(p, exit) < 1.65)) { s.phase = 'clear'; s.message = 'Clean getaway. The whole crew made it out.'; }
    s.adjustedSeconds = Math.round(s.elapsed + 10 * (s.totalLoot - s.collected));
  },
  onPresenceChange(s, id, connected, wall) {
    const p = s.players.find(q => q.id === id); if (!p || p.connected === connected) return;
    if (playing(s)) clock(s, wall); p.connected = connected; p.work = null; p.hidden = false; p.moving = false;
    if (connected) { p.absentAt = null; p.suspended = false; if (s.pauseAt !== null) { s.paused += Math.max(0, wall - s.pauseAt); s.pauseAt = null; if (playing(s)) clock(s, wall); } }
    else { p.absentAt = wall; if (!s.players.some(q => q.connected)) s.pauseAt = wall; }
  },
  publicView(s) {
    const origins = s.players.filter(live), width = s.tiles[0].length;
    const visible = [...new Set(origins.flatMap(p => visibleCells(s.tiles, s.objects, [p], 8).filter(cell => smokeSight(s, p, { x: cell % width + .5, y: Math.floor(cell / width) + .5 }))))].sort((a, b) => a - b);
    const sight = new Set(visible), seen = (p: Point) => sight.has(Math.floor(p.y) * width + Math.floor(p.x)) && origins.some(q => clearSight(s, q, p));
    const guards = s.guards.filter(seen).map(g => ({ ...point(g), id: g.id, facing: g.facing, alert: g.alert, suspicion: g.suspicion, charmed: g.charmed }));
    const scouts = origins.filter(p => p.role === 'scout' && (!p.moving || p.sneaking));
    const markers = s.guards.filter(g => !seen(g) && scouts.some(p => distance(p, g) < 10)).map(point);
    const players = s.players.map(({ absentAt: _a, toolAt: _t, hitAt: _h, unseenAt: _u, ventAt: _v, workingAt: _w, sneaking: _s, moving: _m, ...p }) => p);
    return structuredClone({ heistId: s.heistId, mission: s.mission, phase: s.phase, now: s.now, elapsed: s.elapsed, players, guards, markers, objects: s.objects, loot: s.loot, tiles: s.tiles, visible, smoke: s.smoke, effects: s.effects.filter(e => s.knownEffects.includes(e.id) || seen(e)), collected: s.collected, totalLoot: s.totalLoot, objectiveTaken: s.objectiveTaken, alarm: s.alarm, message: s.message, adjustedSeconds: s.adjustedSeconds });
  },
  playerView: () => null,
  outcome(s) { const complete = !playing(s); return { complete, winners: s.phase === 'clear' ? s.players.map(p => p.id) : [], rows: s.players.map(p => ({ playerId: p.id, rank: 1, score: s.adjustedSeconds, label: `${s.phase === 'clear' ? 'Escaped' : s.phase === 'failed' ? 'Caught' : 'On the job'} · ${p.coins} loot · ${Math.round(s.elapsed)}s + ${(s.totalLoot - s.collected) * 10}s missed loot` })) }; },
  dispose() {},
};
export default rules;
