import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { DAMAGE, RADIUS, SPEED, cameraAngle, type NpcKind, type Role, type Tool } from '../src/model';
import { cellIndex } from '../src/geometry';
import { getMap } from '../src/maps';
import { rules } from '../src/server';
import type { NpcSpawn } from '../src/server-levels';
import { heist, STEP, type Heist } from '../src/sim/harness';
import { credit, doorAt, hurt, setDoor, type Crew } from '../src/sim/state';
import { perceive } from '../src/sim/npc';
import { beamEnd, raiseAlarm } from '../src/sim/security';
import { project } from '../src/sim/view';

const map = getMap('velvet'), obj = (id: string) => map.objects.find(o => o.id === id)!;
const E = 0, S = Math.PI / 2, W = Math.PI, N = -Math.PI / 2;
/** A stationary NPC at cell (x, y) looking `facing` (a very long pause at its only stop). */
const post = (x: number, y: number, facing: number, kind: NpcKind = 'guard'): NpcSpawn => ({ kind, route: [[x, y, 9999, facing]] });
const setup = (npcs: NpcSpawn[] = [], choices: { role?: Role; tool?: Tool }[] = [{}], o: Parameters<typeof heist>[1] = {}) => heist(choices.length, { level: { npcs, ...o.level }, choices, ...o });
const at = (p: Crew, x: number, y: number) => Object.assign(p, { x, y });
const view = (h: Heist) => rules.publicView(h.s, { nowMs: h.wall, phase: 'playing' });
const secs = (h: Heist, seconds: number, inputs: Parameters<Heist['step']>[0] = {}) => h.step(inputs, Math.round(seconds / STEP));
const doorState = (h: Heist, id: string) => h.s.doors[map.objects.filter(o => o.kind === 'door' || o.kind === 'window').findIndex(o => o.id === id)];

test('validates settings, inputs, actions and lobby choices', () => {
  assert.deepEqual(rules.validateSettings({}), { mission: 'velvet', difficulty: 'normal' });
  assert.deepEqual(rules.validateSettings({ mission: 'ferry', difficulty: 'relaxed' }), { mission: 'ferry', difficulty: 'relaxed' });
  for (const bad of [null, [], { mission: 'moon' }, { difficulty: 'hard' }, { extra: 1 }]) assert.throws(() => rules.validateSettings(bad));
  assert.ok(Math.abs(rules.parseInput({ x: 1, y: 1, sneak: false }).x - Math.SQRT1_2) < 1e-12, 'diagonals are normalised');
  assert.deepEqual(rules.parseInput({ x: .2, y: 0 }), { x: .2, y: 0, sneak: false });
  for (const bad of [{ x: 2, y: 0, sneak: false }, { x: NaN, y: 0, sneak: false }, { x: 0, y: 0, sneak: 'yes' }, { x: 0, y: 0, jump: true }, 'left']) assert.throws(() => rules.parseInput(bad));
  assert.deepEqual(rules.parseAction({ type: 'tool', heistId: 'h' }), { type: 'tool', heistId: 'h' });
  for (const bad of [{ type: 'tool' }, { type: 'jump', heistId: 'h' }, { type: 'tool', heistId: 'h', aim: {} }]) assert.throws(() => rules.parseAction(bad));
  assert.deepEqual(rules.parseLobbyChoice!(undefined, false), { role: 'cracker', tool: 'smoke' });
  assert.deepEqual(rules.parseLobbyChoice!({ role: 'wire' }, true), { role: 'wire', tool: 'smoke' });
  for (const bad of [{ role: 'wizard' }, { tool: 'laser' }, { role: 'wire', hat: 1 }]) assert.throws(() => rules.parseLobbyChoice!(bad, true));
  const h = setup();
  assert.throws(() => rules.applyAction(h.s, 'p0', { type: 'tool', heistId: 'stale' }, h.wall), /over/);
  assert.throws(() => rules.applyAction(h.s, 'ghost', { type: 'tool', heistId: h.s.heistId }, h.wall));
});

test('sneaking is slow and silent; running is fast and leaves noise rings every 0.4 s', () => {
  const h = setup(), p = h.s.crew[0];
  at(p, 12.5, 21.5); secs(h, 1, { p0: { x: 1, y: 0, sneak: false } });
  assert.ok(Math.abs(p.x - 12.5 - SPEED.run) < .15, `ran ${p.x - 12.5}`);
  assert.ok(p.running && h.s.noises.filter(n => n.kind === 'step').length >= 3);
  at(p, 12.5, 21.5); h.s.noises = []; secs(h, 1, { p0: { x: .4, y: 0, sneak: false } });
  assert.ok(Math.abs(p.x - 12.5 - SPEED.sneak) < .15 && !p.running && !h.s.noises.length, 'a light push sneaks silently');
  at(p, 12.5, 21.5); secs(h, 1, { p0: { x: 1, y: 0, sneak: true } });
  assert.ok(Math.abs(p.x - 12.5 - SPEED.sneak) < .15 && !h.s.noises.length, 'the Sneak button forces quiet movement');
});

test('corner assist: a push that only clips a door frame slides past it; a flat wall stays a wall', () => {
  const h = setup([], [{}], { settings: { mission: 'glasshouse' } }), p = h.s.crew[0];
  setDoor(h.s, doorAt(h.s, 37.5, 23.5), 'o'); at(p, 36.74, 23.17);
  secs(h, .6, { p0: { x: 0, y: -1, sneak: false } });
  assert.ok(p.y < 22.6, `snagged at ${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  at(p, 35.5, 20.5); secs(h, .6, { p0: { x: 0, y: -1, sneak: false } });
  assert.ok(p.x === 35.5 && p.y < 20.4, 'pushing straight into a flat wall does not drift sideways');
});

test('doors open when pushed and close 2.5 s after the doorway is clear; guards open them too', () => {
  const h = setup(), p = h.s.crew[0];
  at(p, 11.5, 20.5); secs(h, .2, { p0: { x: -1, y: 0, sneak: false } });
  assert.equal(doorState(h, 'door-10-20'), 'o');
  secs(h, .6, { p0: { x: -1, y: 0, sneak: false } });
  assert.ok(p.x < 10, 'walked through');
  at(p, 10.5, 20.5); secs(h, 3);
  assert.equal(doorState(h, 'door-10-20'), 'o', 'never closes on a body');
  at(p, 8.5, 20.5); secs(h, 2.3);
  assert.equal(doorState(h, 'door-10-20'), 'o');
  secs(h, .4);
  assert.equal(doorState(h, 'door-10-20'), 'c');
  const g = setup([{ kind: 'guard', route: [[12, 20], [7, 20, 9999]] }]);
  let opened = false;
  for (let i = 0; i < 300 && g.s.npcs[0].x > 8; i++) { g.step(); opened ||= doorState(g, 'door-10-20') === 'o'; }
  assert.ok(opened && g.s.npcs[0].x < 8, 'the guard opened the door and walked into the kitchen');
});

test('lock progress persists per target so a teammate can finish it; the Cracker is 3× faster', () => {
  const h = setup([], [{ role: 'scout' }, { role: 'magpie' }]), [a, b] = h.s.crew, right = { x: 1, y: 0, sneak: false };
  at(a, 31.6, 3.5); at(b, 30, 4.5);
  secs(h, 1.5, { p0: right });
  assert.equal(a.work?.label, 'Picking the lock');
  const half = h.s.progress['door-32-3'];
  assert.ok(half > .45 && half < .55 && doorState(h, 'door-32-3') === 'l');
  secs(h, 1);
  assert.equal(h.s.progress['door-32-3'], half, 'moving away pauses the work');
  at(a, 28, 4.5); at(b, 31.6, 3.5);
  secs(h, 1.4, { p1: right });
  assert.equal(doorState(h, 'door-32-3'), 'l');
  secs(h, .2, { p1: right });
  assert.equal(doorState(h, 'door-32-3'), 'o', 'the teammate finished the remaining half');
  const c = setup([], [{ role: 'cracker' }]);
  at(c.s.crew[0], 31.6, 3.5); secs(c, 1.05, { p0: right });
  assert.equal(doorState(c, 'door-32-3'), 'o');
});

test('safes pay out; every 10 personal coins refills a tool charge up to 9', () => {
  const h = setup([], [{ role: 'scout' }]), p = h.s.crew[0];
  at(p, 12.5, 2.4); secs(h, 4.9, { p0: { x: 0, y: -1, sneak: false } });
  assert.equal(p.coins, 0);
  secs(h, .2, { p0: { x: 0, y: -1, sneak: false } });
  assert.equal(p.coins, 8); assert.equal(h.s.collected, 8); assert.ok(h.s.spent.includes('safe-12-1'));
  assert.equal(view(h).objects.find(o => o.id === 'safe-12-1')!.state, 'empty');
  credit(h.s, p, 2); assert.equal(p.charges, 3);
  credit(h.s, p, 200); assert.equal(p.charges, 9);
  assert.equal(h.s.stats.p0.coins, 210);
});

test('cameras sweep with cameraAngle and alarm after 0.8 s; terminals and EMP switch circuits off', () => {
  const cam = obj('camera-21-6'), watch = (h: Heist, p: Crew) => { const a = cameraAngle(cam, h.s.now + 400); at(p, cam.x + Math.cos(a) * 3.5, cam.y + Math.sin(a) * 3.5); };
  const h = setup([], [{ role: 'scout' }]), p = h.s.crew[0];
  watch(h, p); secs(h, .5);
  assert.equal(h.s.alarm, null);
  secs(h, .5);
  assert.ok(h.s.alarm && view(h).alarm, 'seen for 0.8 s');
  assert.ok(view(h).effects.some(e => e.kind === 'alarm'));
  const behind = setup(), q = behind.s.crew[0];
  at(q, cam.x, cam.y - 2); secs(behind, 2);
  assert.equal(behind.s.alarm, null, 'nothing behind the lens');
  const hacked = setup([], [{ role: 'cracker' }]), r = hacked.s.crew[0];
  at(r, 8.6, 8.5); secs(hacked, 3.05, { p0: { x: 1, y: 0, sneak: false } });
  const state = view(hacked).objects.find(o => o.id === 'camera-21-6')!;
  assert.equal(state.state, 'disabled'); assert.ok(Math.abs(state.until - hacked.s.now - 20000) < 100);
  assert.equal(view(hacked).objects.find(o => o.id === 'terminal-9-8')!.state, 'used');
  watch(hacked, r); secs(hacked, 1.5);
  assert.equal(hacked.s.alarm, null, 'hacked cameras are blind');
  const emp = setup([], [{ tool: 'emp' }]), e = emp.s.crew[0];
  at(e, 21.5, 12.5); emp.tool('p0');
  assert.equal(view(emp).objects.find(o => o.id === 'camera-21-6')!.state, 'disabled');
  assert.equal(view(emp).objects.find(o => o.id === 'camera-43-5')!.state, 'ready', 'outside 10 tiles');
  watch(emp, e); secs(emp, 1.5);
  assert.equal(emp.s.alarm, null);
  secs(emp, 11);
  assert.equal(view(emp).objects.find(o => o.id === 'camera-21-6')!.state, 'ready', 'EMP wears off after 12 s');
});

test('lasers run from the emitter to the first wall and alarm when crossed unless their circuit is off', () => {
  const laser = obj('laser-38-0'), h = setup(), p = h.s.crew[0], end = beamEnd(h.s, laser);
  assert.ok(Math.abs(end.x - 38.5) < 1e-6 && Math.abs(end.y - 9) < 1e-6, `beam ends at the wall, got ${end.y}`);
  at(p, 37.5, 5.5); secs(h, .5);
  assert.equal(h.s.alarm, null);
  secs(h, 1, { p0: { x: 1, y: 0, sneak: true } });
  assert.ok(h.s.alarm, 'crossing the beam trips the alarm');
  const off = setup(); off.s.circuits.vault = off.s.now + 60000;
  at(off.s.crew[0], 38.5, 4.5); secs(off, 1);
  assert.equal(off.s.alarm, null);
});

test('guards notice slowly at range, faster up close and when running, and not at all from behind', () => {
  const h = setup([post(12, 21, E)]), g = h.s.npcs[0], p = h.s.crew[0];
  at(p, 18.5, 21.5); secs(h, 1.2);
  assert.equal(g.state, 'suspicious'); assert.ok(g.suspicion > 0 && g.suspicion < .6, `still unsure at 6 tiles: ${g.suspicion}`);
  const rate = (x: number, running: boolean, facing = E) => { g.facing = facing; at(p, x, 21.5); p.running = running; return perceive(h.s, g, p); };
  assert.ok(1 / rate(18.5, false) > 2, 'a still/sneaking thief at 6 tiles takes over 2 s');
  assert.ok(1 / rate(14.5, true) < .6, 'a runner at 2 tiles is spotted in half a second');
  assert.ok(rate(15.5, true) > rate(15.5, false) * 2.5);
  assert.equal(rate(10.8, false, W + Math.PI), 0, 'outside the cone and near sense');
  assert.equal(rate(14.5, false, W), 0, 'sneaking 2 tiles behind a guard is safe');
  assert.ok(rate(13.4, false, W) > 0 && rate(13.4, false, W) < 1, 'the near sense notices a thief brushing past, slowly');
  const relaxed = setup([post(12, 21, E)], [{}], { settings: { difficulty: 'relaxed' } });
  at(relaxed.s.crew[0], 16.5, 21.5); at(p, 16.5, 21.5); p.running = relaxed.s.crew[0].running = false; g.facing = E;
  assert.ok(Math.abs(perceive(relaxed.s, relaxed.s.npcs[0], relaxed.s.crew[0]) / perceive(h.s, g, p) - .7) < 1e-9);
  secs(h, 3.5); at(p, 16.5, 21.5); secs(h, 3);
  assert.equal(g.state, 'chase'); assert.equal(h.s.stats.p0.spotted, 1);
});

test('guard shots telegraph for 0.7 s and only land while line of sight holds', () => {
  const chased = () => { const h = setup([post(12, 21, E)]), g = h.s.npcs[0]; at(h.s.crew[0], 16.5, 21.5); g.suspicion = .999; h.step(); assert.equal(g.state, 'chase'); return h; };
  const h = chased(), g = h.s.npcs[0], p = h.s.crew[0];
  secs(h, .5);
  assert.ok(!g.aimAt, 'a beat to react after the "!"');
  secs(h, .2);
  assert.ok(g.aimAt && view(h).npcs[0].aiming, 'visible aim line');
  at(p, 9.2, 21.5); secs(h, .8);
  assert.equal(p.health, 100, 'ducking behind the wall dodged the shot');
  assert.equal(h.s.shots.length, 0);
  const hit = chased();
  secs(hit, 1.4);
  assert.equal(hit.s.crew[0].health, 100 - DAMAGE.shot);
  assert.equal(view(hit).shots[0]?.hit, true);
  const soft = setup([post(12, 21, E)], [{}], { settings: { difficulty: 'relaxed' } });
  at(soft.s.crew[0], 16.5, 21.5); soft.s.npcs[0].suspicion = .999; secs(soft, 1.4);
  assert.equal(soft.s.crew[0].health, 100 - DAMAGE.shot / 2, 'relaxed halves damage');
});

test('a guard who loses the target searches the last known spot for 8 s, then returns to patrol', () => {
  const h = setup([post(12, 21, E)]), g = h.s.npcs[0], p = h.s.crew[0];
  at(p, 16.5, 21.5); g.suspicion = .999; h.step();
  at(p, 3, 3); secs(h, 3);
  assert.equal(g.state, 'search');
  secs(h, 7);
  assert.equal(g.state, 'patrol');
});

test('hiding: unwitnessed hides are safe, witnessed ones get pulled out, dogs smell hidden thieves', () => {
  const hide = obj('hide-1-12'), left = { x: -1, y: 0, sneak: true };
  const safe = setup([post(6, 12, E)]), p = safe.s.crew[0], g = safe.s.npcs[0];
  at(p, 2.6, 12.5); secs(safe, .5, { p0: left });
  assert.ok(p.hidden && p.x === hide.x && !p.witnesses.length);
  secs(safe, 1, { p0: left });
  assert.ok(p.hidden, 'holding the push keeps you hidden');
  g.facing = W; secs(safe, 3);
  assert.equal(perceive(safe.s, g, p), 0); assert.equal(g.state, 'patrol');
  assert.equal(view(safe).players[0].hint, 'Hidden. Hold still until they pass; push to slip out.');
  secs(safe, .2, { p0: { x: 1, y: 0, sneak: true } });
  assert.ok(!p.hidden, 'a fresh push leaves the spot');
  at(p, 2.6, 12.5); secs(safe, .5, { p0: { x: -1, y: 0, sneak: false } });
  assert.ok(!p.hidden, 'running past a hiding spot never hides you');
  at(p, 2.6, 12.5); secs(safe, .5, { p0: left }); assert.ok(p.hidden);
  secs(safe, .1, { p0: { x: 1, y: 0, sneak: false } });
  assert.ok(!p.hidden && p.x > hide.x, 'a hard push slips out even while the hiding push is still held');
  const seen = setup([post(6, 12, W)]), q = seen.s.crew[0];
  at(q, 2.6, 12.5); secs(seen, .5, { p0: left });
  assert.ok(q.hidden && q.witnesses.includes('guard-0'));
  for (let i = 0; i < 300 && q.hidden; i++) seen.step();
  assert.ok(!q.hidden && seen.s.npcs[0].state === 'chase', 'the witness pulled them out');
  const dog = setup([post(2, 13, E, 'dog')]), d = dog.s.crew[0];
  at(d, 2.6, 12.5); secs(dog, .5, { p0: left }); secs(dog, 1.5);
  assert.equal(dog.s.npcs[0].state, 'chase');
});

test('civilians panic, scream and fetch the nearest guard, who investigates', () => {
  const h = setup([post(20, 10, E, 'civilian'), post(28, 12, S)]), [civ, guard] = h.s.npcs;
  at(h.s.crew[0], 23.5, 10.5); secs(h, 3);
  assert.equal(civ.state, 'panic');
  assert.ok(h.s.noises.some(n => n.kind === 'scream' && !n.crew));
  at(h.s.crew[0], 3, 3);
  for (let i = 0; i < 300 && guard.state === 'patrol'; i++) h.step();
  assert.equal(guard.state, 'investigate');
  assert.ok(Math.hypot(civ.x - guard.x, civ.y - guard.y) < 2, 'the civilian ran to the guard');
});

test('reinforcements sweep in after the objective is taken', () => {
  const h = setup([], [{ role: 'cracker' }], { level: { npcs: [], reinforcements: { delay: 2, npcs: [post(20, 22, N), post(21, 22, N)] } } }), p = h.s.crew[0];
  h.s.circuits.vault = h.s.now + 60000;
  at(p, 39.6, 2.5); secs(h, .6, { p0: { x: 1, y: 0, sneak: false } });
  assert.ok(h.s.objective.taken && h.s.objective.carrier === 'p0' && h.s.phase === 'escape');
  secs(h, 1.5); assert.equal(h.s.npcs.length, 0);
  secs(h, .6); assert.equal(h.s.npcs.length, 2);
  assert.match(h.s.message, /Reinforcements/);
});

test('downed thieves drop the objective and can be revived; everyone down fails the job', () => {
  const h = setup([], [{}, {}]), [a, b] = h.s.crew;
  at(a, 20.5, 20.5); at(b, 21.3, 20.5); h.s.objective = { x: a.x, y: a.y, carrier: 'p0', taken: true };
  hurt(h.s, a, 150);
  assert.ok(a.down && a.health === 0 && h.s.objective.carrier === null && h.s.stats.p0.downs === 1);
  assert.equal(view(h).players[0].hint, 'Downed. A teammate can revive you.');
  secs(h, 2.4, { p1: { x: -1, y: 0, sneak: false } });
  assert.ok(a.down);
  secs(h, .2, { p1: { x: -1, y: 0, sneak: false } });
  assert.ok(!a.down && h.s.stats.p1.revives === 1); assert.equal(a.health, 50);
  secs(h, .6, { p0: { x: 0, y: 1, sneak: true } });
  assert.equal(h.s.objective.carrier, 'p0', 'picked the dropped objective back up from under their feet');
  const face = setup([], [{}, { role: 'face' }]);
  at(face.s.crew[0], 20.5, 20.5); at(face.s.crew[1], 21.3, 20.5); hurt(face.s, face.s.crew[0], 150);
  secs(face, 1.05, { p1: { x: -1, y: 0, sneak: false } });
  assert.ok(!face.s.crew[0].down, 'Face revives in 1 s');
  hurt(h.s, a, 150); hurt(h.s, b, 150); h.step();
  assert.equal(h.s.phase, 'failed'); assert.equal(rules.outcome(h.s).complete, false);
  secs(h, 2.6); assert.equal(rules.outcome(h.s).complete, true); assert.deepEqual(rules.outcome(h.s).winners, []);
});

test('the carrier is slower and escape needs every non-suspended thief alive in the zone', () => {
  const exit = obj('exit'), h = setup([], [{}, {}]), [a, b] = h.s.crew;
  at(a, 12.5, 21.5); h.s.objective = { x: a.x, y: a.y, carrier: 'p0', taken: true }; h.s.phase = 'escape';
  secs(h, 1, { p0: { x: 1, y: 0, sneak: false } });
  assert.ok(Math.abs(a.x - 12.5 - SPEED.run * SPEED.carry) < .15);
  at(a, exit.x, exit.y); at(b, 12, 25.5); h.step();
  assert.equal(h.s.phase, 'escape');
  at(b, exit.x + 1, exit.y); h.step();
  assert.equal(h.s.phase, 'clear');
  const out = rules.outcome(h.s);
  assert.deepEqual(out.winners, ['p0', 'p1']); assert.equal(out.rows[0].score, Math.round(h.s.elapsed + 3 * (h.s.totalLoot - h.s.collected)));
  assert.equal(view(h).players[0].hint, 'Clean getaway! Nice work.');
});

test('disconnects suspend after 15 s (dropping the objective) and an empty room pauses the clock', () => {
  const exit = obj('exit'), h = setup([], [{}, {}]), [a, b] = h.s.crew;
  h.s.objective = { x: b.x, y: b.y, carrier: 'p1', taken: true }; h.s.phase = 'escape';
  rules.onPresenceChange(h.s, 'p1', false, h.wall); secs(h, 14);
  assert.ok(!b.suspended && h.s.objective.carrier === 'p1');
  secs(h, 1.2);
  assert.ok(b.suspended && h.s.objective.carrier === null);
  rules.onPresenceChange(h.s, 'p0', false, h.wall); h.s.objective = { x: a.x, y: a.y, carrier: 'p0', taken: true };
  const frozen = h.s.elapsed; secs(h, 40);
  assert.equal(h.s.elapsed, frozen, 'nobody connected: the clock stops');
  assert.ok(!a.suspended && h.s.objective.carrier === 'p0', 'a paused room suspends nobody');
  rules.onPresenceChange(h.s, 'p0', true, h.wall); secs(h, 1);
  assert.ok(Math.abs(h.s.elapsed - frozen - 1) < .1);
  at(a, exit.x, exit.y); h.s.objective = { x: a.x, y: a.y, carrier: 'p0', taken: true }; h.step();
  assert.equal(h.s.phase, 'clear', 'suspended thieves do not block the getaway');
});

test('Scout senses guards through walls within 12 tiles, only while still or sneaking', () => {
  const h = setup([post(20, 18, E)], [{ role: 'scout' }]), p = h.s.crew[0];
  at(p, 13.5, 11.5); h.step();
  assert.equal(view(h).npcs.length, 0);
  assert.deepEqual(view(h).intel.map(i => i.kind), ['guard']);
  h.step({ p0: { x: 1, y: 0, sneak: false } });
  assert.equal(view(h).intel.length, 0, 'running scrambles the sense');
  const other = setup([post(20, 18, E)], [{ role: 'cracker' }]);
  at(other.s.crew[0], 13.5, 11.5); other.step();
  assert.equal(view(other).intel.length, 0);
});

test('Magpie’s bird fetches coins within 3.5 tiles', () => {
  const h = setup([], [{ role: 'magpie' }, { role: 'cracker' }]), [m, c] = h.s.crew;
  at(m, 20.5, 19.3); at(c, 25.5, 25.5); secs(h, 2);
  assert.ok(m.coins >= 4, `bird fetched ${m.coins}`); assert.equal(c.coins, 0);
});

test('Ghost knocks out unaware guards and civilians on contact, not alert ones', () => {
  const h = setup([post(14, 21, W), post(14, 18, W, 'civilian')], [{ role: 'ghost' }]), p = h.s.crew[0];
  h.s.npcs[0].facing = E; at(p, 14.1, 21.5); h.step();
  assert.equal(h.s.npcs[0].state, 'stunned'); assert.equal(h.s.stats.p0.takedowns, 1);
  h.s.npcs[1].facing = E; at(p, 14.1, 18.5); h.step();
  assert.equal(h.s.npcs[1].state, 'stunned');
  const alert = setup([post(14, 21, W)], [{ role: 'ghost' }]);
  alert.s.npcs[0].state = 'chase'; alert.s.npcs[0].target = 'p0'; at(alert.s.crew[0], 14.1, 21.5); alert.step();
  assert.notEqual(alert.s.npcs[0].state, 'stunned');
});

test('Breacher digs cracked walls and forces locked doors, loudly', () => {
  const h = setup([], [{ role: 'breacher' }]), p = h.s.crew[0], up = { x: 0, y: -1, sneak: true };
  at(p, 9.5, 7.4); secs(h, 1.55, { p0: up });
  assert.ok(h.s.broken.includes(cellIndex(map, { x: 9.5, y: 6.5 })));
  assert.ok(h.s.noises.some(n => n.kind === 'loud' && n.crew));
  assert.ok(view(h).broken.includes(6 * map.width + 9));
  at(p, 15.5, 7.4); secs(h, 1.25, { p0: up });
  assert.equal(doorState(h, 'door-15-6'), 'b');
  secs(h, 5); assert.equal(doorState(h, 'door-15-6'), 'b', 'forced doors never close');
});

test('Impostor is barely noticed while disguised, loses it on tools or chases and regains it after 6 s unseen', () => {
  const h = setup([post(12, 21, E)], [{ role: 'impostor', tool: 'decoy' }]), p = h.s.crew[0], g = h.s.npcs[0];
  at(p, 16.5, 21.5);
  const disguised = perceive(h.s, g, p); p.disguised = false;
  assert.ok(Math.abs(disguised / perceive(h.s, g, p) - .15) < 1e-9);
  p.disguised = true; at(p, 13.5, 21.5); p.running = true;
  assert.ok(Math.abs(perceive(h.s, g, p) / disguised) > 5, 'running within 2 tiles blows the cover');
  at(p, 3, 3); p.running = false; h.tool('p0');
  assert.equal(p.disguised, false);
  secs(h, 5.9); assert.equal(p.disguised, false);
  secs(h, .3); assert.equal(p.disguised, true);
  assert.ok(view(h).effects.some(e => e.kind === 'disguise' && e.player === 'p0'));
});

test('Wire hacks terminals 3× faster, keeps circuits off twice as long and senses cameras through walls', () => {
  const h = setup([], [{ role: 'wire' }]), p = h.s.crew[0];
  at(p, 8.6, 8.5); secs(h, 1.05, { p0: { x: 1, y: 0, sneak: false } });
  assert.ok(Math.abs(h.s.circuits.floor - h.s.now - 40000) < 100);
  at(p, 25.5, 3.5); h.step();
  assert.ok(view(h).intel.some(i => i.kind === 'camera' && i.x === 22.5 && i.y === .5), 'the counting camera through the wall');
  at(p, 33.5, 3.5); h.step();
  assert.ok(view(h).intel.some(i => i.kind === 'laser' && i.x === 38.5), 'lasers report as lasers');
});

test('Face charms the nearest unaware guard, who follows for 20 s, then has a 10 s cooldown', () => {
  const h = setup([post(20, 21, W), post(25, 21, W)], [{ role: 'face' }]), p = h.s.crew[0], [g, far] = h.s.npcs;
  g.facing = far.facing = E; at(p, 18.5, 21.5); h.step();
  assert.equal(g.state, 'charmed'); assert.equal(far.state, 'patrol');
  assert.ok(view(h).effects.some(e => e.kind === 'charm' && e.player === 'p0' && Math.hypot(e.x - g.x, e.y - g.y) < .5));
  at(p, 18.5, 17.5); secs(h, 4);
  assert.ok(Math.hypot(g.x - p.x, g.y - p.y) < 2, 'the charmed guard follows');
  assert.equal(perceive(h.s, g, p), 0, 'and ignores the crew');
  secs(h, 16.5); assert.notEqual(g.state, 'charmed');
  assert.ok(p.charmReady > h.s.now + 9000);
});

test('smoke blocks every line of sight and a chasing guard loses the target', () => {
  const h = setup([post(12, 21, E)], [{ tool: 'smoke' }]), g = h.s.npcs[0], p = h.s.crew[0];
  at(p, 17.5, 21.5); g.suspicion = .999; h.step();
  h.tool('p0');
  assert.equal(view(h).smoke.length, 1); assert.equal(view(h).npcs.length, 0, 'smoke hides the guard from the crew too');
  secs(h, 3);
  assert.equal(p.health, 100); assert.equal(g.state, 'search');
  assert.equal(p.charges, 1); assert.equal(h.s.stats.p0.tools, 1);
  const dog = setup([post(20, 21, E, 'dog')], [{ tool: 'smoke' }]), q = dog.s.crew[0];
  at(q, 21.9, 21.5); dog.tool('p0'); secs(dog, 4);
  assert.equal(dog.s.stats.p0.spotted, 1, 'a dog smells through smoke and keeps the chase instead of re-spotting in a loop');
});

test('tranq soft-aims ±25° at the nearest visible NPC; the shotgun cone knocks out, shatters glass and is loud', () => {
  const h = setup([post(19, 23 - 2, W), post(26, 21, W)], [{ tool: 'tranq' }]), p = h.s.crew[0];
  at(p, 13.5, 20.5); p.facing = 0; h.tool('p0');
  assert.equal(h.s.npcs[0].state, 'stunned'); assert.equal(h.s.npcs[1].state, 'patrol');
  assert.equal(view(h).shots[0].kind, 'tranq'); assert.equal(view(h).shots[0].hit, true);
  secs(h, .6); p.facing = Math.PI; h.tool('p0');
  assert.equal(h.s.shots.at(-1)!.hit, false, 'nothing ahead: the dart misses');
  assert.equal(p.charges, 0);
  assert.throws(() => h.tool('p0'), /No charges/);
  const s = setup([post(34, 12, W), post(29, 12, W)], [{ tool: 'shotgun' }]), q = s.s.crew[0];
  at(q, 30.5, 12.5); q.facing = 0; s.tool('p0');
  assert.equal(s.s.npcs[0].state, 'stunned', 'in the cone, through the glass'); assert.notEqual(s.s.npcs[1].state, 'stunned', 'behind the shooter');
  assert.ok([12, 13].every(y => s.s.broken.includes(y * map.width + 32)), 'glass shattered');
  assert.ok(s.s.noises.some(n => n.kind === 'loud' && n.radius === RADIUS.loudNoise));
});

test('medkit heals and revives the crew nearby; decoys lure guards after 0.6 s', () => {
  const h = setup([], [{ tool: 'medkit' }, {}]), [a, b] = h.s.crew;
  at(a, 20.5, 20.5); at(b, 21.5, 20.5);
  assert.throws(() => h.tool('p0'), /Nobody/);
  a.health = 30; hurt(h.s, b, 200); h.tool('p0');
  assert.equal(a.health, 90); assert.ok(!b.down && b.health === 60);
  const d = setup([post(20, 16, S)], [{ tool: 'decoy' }]), p = d.s.crew[0], g = d.s.npcs[0];
  at(p, 13.5, 20.5); p.facing = 0; d.tool('p0');
  assert.ok(Math.abs(d.s.decoys[0].x - 18.5) < .01);
  secs(d, .5); assert.equal(g.state, 'patrol');
  secs(d, .2); assert.equal(g.state, 'investigate');
  assert.ok(view(d).noises.some(n => n.kind === 'decoy'));
});

test('the projection holds only crew knowledge and passes the live JSON contract', () => {
  const h = setup([post(20, 18, E), post(12, 21, E, 'civilian'), post(28, 12, S)], [{}, {}, {}, {}]), [a, b, c, d] = h.s.crew;
  for (const p of [a, b, c, d]) at(p, 6.5 + p.seat, 25.5);
  at(a, 26.5, 10.5); h.step();
  const v = view(h), json = JSON.stringify(v);
  assert.deepEqual(v.npcs.map(n => n.id), ['guard-2'], 'only the guard in sight');
  assert.ok(!json.includes('"x":20.5,"y":18.5') && !json.includes('"x":12.5,"y":21.5'), 'no hidden coordinates');
  assert.deepEqual(v.intel, []);
  h.s.noises.push({ x: 12.5, y: 21.5, radius: 6, at: h.s.now, kind: 'scream', crew: false });
  h.s.shots.push({ from: { x: 20.5, y: 18.5 }, to: { x: 12.5, y: 21.5 }, at: h.s.now, hit: false, kind: 'guard', crew: false });
  h.s.effects.push({ x: 20.5, y: 18.5, id: 999, kind: 'takedown', label: '', at: h.s.now, crew: false });
  const w = project(h.s);
  assert.equal(w.noises.length, 0); assert.equal(w.shots.length, 0); assert.ok(!w.effects.some(e => e.id === 999));
  assert.equal(w.objectiveTaken, false); assert.equal(w.objectiveTaken, w.objective.taken);
  assertSerializable(w); assertSerializable(rules.outcome(h.s));
  assert.equal(rules.playerView(h.s, 'p0', { nowMs: h.wall, phase: 'playing' }), null);
  assert.equal(v.doors.length, map.objects.filter(o => o.kind === 'door' || o.kind === 'window').length);
  assert.equal(v.coins.length, map.coins.length);
});

test('NPCs whose goal is unreachable give up: dogs behind windows search, then patrol', () => {
  const h = setup([{ kind: 'dog', route: [[2, 17, 9999, N], [3, 17, 9999, N]] }]), p = h.s.crew[0], d = h.s.npcs[0];
  at(p, 2.5, 12.5);
  for (let i = 0; i < 240 && d.state !== 'chase'; i++) h.step();
  assert.equal(d.state, 'chase', 'saw the thief through the kitchen window');
  at(p, 40.5, 25.5); secs(h, 5);
  assert.equal(d.state, 'search');
  secs(h, 15);
  assert.equal(d.state, 'patrol');
});

test('after an alarm, every NPC on every map returns to its route', () => {
  for (const mission of ['velvet', 'glasshouse', 'ferry'] as const) {
    const h = heist(1, { settings: { mission } }), o = getMap(mission).objects.find(o => o.kind === 'objective')!;
    at(h.s.crew[0], -50, -50); secs(h, 3);
    raiseAlarm(h.s, { x: o.x - 1, y: o.y }, 'Test');
    secs(h, 60);
    assert.deepEqual(h.s.npcs.filter(n => n.state !== 'patrol').map(n => `${n.id}:${n.state}@${n.x.toFixed(1)},${n.y.toFixed(1)}`), [], mission);
  }
});

test('glass stops a guard bullet and shatters; one gun at a time per thief', () => {
  const h = setup([post(40, 11, W)], [{}], { settings: { mission: 'glasshouse' } }), g = h.s.npcs[0], p = h.s.crew[0];
  at(p, 35.5, 11.5); g.suspicion = .999; h.step();
  assert.equal(g.state, 'chase'); g.aimAt = h.s.now; secs(h, .75);
  assert.equal(p.health, 100, 'the pane took the bullet');
  assert.ok(h.s.broken.includes(11 * getMap('glasshouse').width + 37) && h.s.shots[0].hit === false);
  secs(h, 2.3); assert.equal(p.health, 100 - DAMAGE.shot, 'nothing left in the way');
  const two = setup([post(12, 21, E), post(12, 22, E)]), q = two.s.crew[0];
  at(q, 16.5, 21.5); for (const n of two.s.npcs) n.suspicion = .999;
  secs(two, 4.2);
  assert.equal(q.health, 100 - 2 * DAMAGE.shot, 'two guards shoot no faster than one');
});

test('detection always leaves a readable "?" beat, even running at a guard during an alarm', () => {
  const h = setup([post(12, 21, E)]), g = h.s.npcs[0], p = h.s.crew[0];
  raiseAlarm(h.s, { x: 3, y: 3 }, 'Test'); g.state = 'patrol'; g.facing = E;
  at(p, 12.9, 21.5); p.running = true;
  assert.ok(1 / perceive(h.s, g, p) >= .55, `0 → ! in ${(1 / perceive(h.s, g, p)).toFixed(2)} s`);
});

test('the view only moves doors the crew can see; unseen guards never swing doors on the TV', () => {
  const h = setup([{ kind: 'guard', route: [[12, 20], [7, 20, 9999]] }]), p = h.s.crew[0], i = map.objects.filter(o => o.kind === 'door' || o.kind === 'window').findIndex(o => o.id === 'door-10-20');
  at(p, 1.5, 26.5);
  let opened = false, shown = false;
  for (let t = 0; t < 300; t++) { h.step(); opened ||= h.s.doors[i] === 'o'; shown ||= view(h).doors[i] === 'o'; }
  assert.ok(opened && !shown, 'the guard opened it out of sight');
  const near = setup([{ kind: 'guard', route: [[12, 20], [7, 20, 9999]] }], [{}, {}]);
  at(near.s.crew[0], 13.5, 22.5); hurt(near.s, near.s.crew[0], 200); // downed thieves still see, but guards ignore them
  let both = false;
  for (let t = 0; t < 300 && !both; t++) { near.step(); both = near.s.doors[i] === 'o' && view(near).doors[i] === 'o'; }
  assert.ok(both, 'in sight, the door is exact');
});

test('the TV banner clears itself; effects on a thief name that thief', () => {
  const h = setup([], [{}, {}]), [a] = h.s.crew;
  assert.equal(view(h).message, map.briefing);
  secs(h, 7.1); assert.equal(view(h).message, '');
  hurt(h.s, a, 10);
  assert.ok(view(h).effects.some(e => e.kind === 'hurt' && e.player === 'p0'));
  hurt(h.s, a, 200); assert.match(view(h).message, /down/);
  secs(h, 7.1); assert.equal(view(h).message, '');
});

test('a lone thief gets one second wind 6 s after going down, once nobody is watching', () => {
  const h = setup(), p = h.s.crew[0];
  hurt(h.s, p, 200); secs(h, 5.9);
  assert.ok(p.down && h.s.phase === 'infiltrate', 'not over yet');
  assert.equal(view(h).players[0].hint, 'Downed. Once no guard is watching, you will get back up.');
  secs(h, .2);
  assert.ok(!p.down && p.health === 30 && !p.wind);
  hurt(h.s, p, 200); h.step();
  assert.equal(h.s.phase, 'failed', 'only once per heist');
  const watched = setup([post(20, 21, W)]), q = watched.s.crew[0];
  at(q, 17.5, 21.5); hurt(watched.s, q, 200); secs(watched, 19.9);
  assert.ok(q.down && watched.s.phase === 'infiltrate');
  secs(watched, .2); assert.equal(watched.s.phase, 'failed', 'a guard stood over them for 20 s');
  const duo = setup([], [{}, {}]);
  hurt(duo.s, duo.s.crew[0], 200); secs(duo, 8);
  assert.ok(duo.s.crew[0].down, 'crews revive each other instead');
});
