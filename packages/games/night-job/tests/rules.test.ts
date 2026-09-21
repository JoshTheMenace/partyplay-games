import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import rules, { create, type State } from '../src/server';
import { getMap } from '../src/maps';
import { MISSIONS, ROLES, TOOLS, type Choice, type Input, type MissionId, type Point } from '../src/model';
const ctx = { nowMs: 1000, roomId: 'test', roundId: 'heist-1', seed: 42 };
function make(choices: Partial<Choice>[] = [{}], mission: MissionId = 'velvet') {
  return create({ ...ctx, players: choices.map((c, i) => ({ id: `p${i}`, name: 'SixteenCharacter', color: '#fff', lobbyChoice: c })) }, { mission, difficulty: 'normal' });
}
function arena(choices: Partial<Choice>[] = [{}]) {
  const s = make(choices); s.tiles = ['############', ...Array.from({ length: 8 }, () => '#..........#'), '############'];
  s.objects = []; s.loot = []; s.guards = []; s.totalLoot = 0;
  s.players.forEach((p, i) => Object.assign(p, { x: 2.5, y: 3.5 + i })); return s;
}
function tick(s: State, ms = 100, input: Input = { x: 0, y: 0, sneak: false }, player = 'p0') { rules.tick(s, new Map([[player, input]]), ms / 1000, s.wallAt + ms); }
function advance(s: State, ms: number, input: Input = { x: 0, y: 0, sneak: false }) { for (let t = 0; t < ms; t += 100) tick(s, 100, input); }
function guard(s: State, p: Point = { x: 6.5, y: 3.5 }) {
  const g = make().guards[0]; Object.assign(g, p, { facing: Math.PI, patrol: [p], waypoint: 0, nextPathAt: Infinity }); s.guards.push(g); return g;
}
const view = (s: State) => rules.publicView(s, { nowMs: s.wallAt, phase: 'playing' });
const use = (s: State, aim?: Point) => rules.applyAction(s, 'p0', { type: 'tool', heistId: s.heistId, ...(aim ? { aim } : {}) }, s.wallAt);

test('settings, roles, tools and finite bounded input have strict schemas', () => {
  assert.deepEqual(rules.validateSettings({}), { mission: 'velvet', difficulty: 'normal' });
  for (const raw of [null, [], { mission: 'other' }, { difficulty: true }, { extra: 1 }]) assert.throws(() => rules.validateSettings(raw));
  for (const role of Object.keys(ROLES)) for (const tool of Object.keys(TOOLS)) assert.deepEqual(rules.parseLobbyChoice!({ role, tool }, true), { role, tool });
  for (const raw of [{ role: '__proto__' }, { tool: 'constructor' }, { role: 1 }, { extra: true }]) assert.throws(() => rules.parseLobbyChoice!(raw, true));
  for (const x of [NaN, Infinity, 2]) assert.throws(() => rules.parseInput({ x, y: 0, sneak: false }));
  assert.equal(Math.hypot(...Object.values(rules.parseInput({ x: 1, y: 1, sneak: true })).slice(0, 2) as [number, number]), 1);
  assert.throws(() => rules.parseAction({ type: 'tool', heistId: 'a', aim: { x: NaN, y: 0 } }));
  assert.throws(() => rules.parseAction({ type: 'tool', heistId: 'a', aim: { x: 0, y: 0 } }));
});

test('every mission and 1/4 roster starts with serializable and isolated projections', () => {
  for (const mission of Object.keys(MISSIONS) as MissionId[]) for (const count of [1, 4]) {
    const s = make(Array.from({ length: count }, () => ({ role: 'scout' })), mission), v = view(s);
    assertSerializable(v); assertSerializable(rules.outcome(s)); assertSerializable(rules.playerView(s, 'p0', { nowMs: 1000, phase: 'playing' }));
    assert.ok(Buffer.byteLength(JSON.stringify(v)) < 16384);
    for (const g of v.guards) assert.deepEqual(Object.keys(g).sort(), ['alert', 'charmed', 'facing', 'id', 'suspicion', 'x', 'y']);
    assert.ok(!JSON.stringify(v).includes('patrol":[')); assert.ok(!('toolAt' in v.players[0]));
    v.players[0].health = 0; assert.equal(s.players[0].health, 100);
    assert.equal(s.totalLoot, getMap(mission).loot.length + getMap(mission).objects.filter(o => o.kind === 'safe').length * 10);
  }
});

test('movement is continuous, bounded and stops on neutral; sneak moves slower', () => {
  const s = arena(); tick(s, 100, { x: 1, y: 0, sneak: false }); assert.ok(s.players[0].x > 2.5);
  const x = s.players[0].x; tick(s); assert.equal(s.players[0].x, x);
  tick(s, 100, { x: 1, y: 0, sneak: true }); assert.ok(s.players[0].x - x < .2);
  advance(s, 8000, { x: -1, y: 0, sneak: false }); assert.ok(s.players[0].x >= 1.28 - .001);
});

test('stale, repeated, disconnected and downed actions cannot spend charges or create effects', () => {
  const s = arena(); assert.throws(() => rules.applyAction(s, 'p0', { type: 'tool', heistId: 'old' }, s.wallAt));
  assert.equal(s.players[0].charges, 2); use(s); assert.equal(s.players[0].charges, 1); assert.equal(s.smoke.length, 1);
  assert.throws(() => use(s)); assert.equal(s.smoke.length, 1);
  advance(s, 900); s.players[0].down = true; assert.throws(() => use(s)); s.players[0].down = false;
  rules.onPresenceChange(s, 'p0', false, s.wallAt); assert.throws(() => use(s)); assert.equal(s.players[0].charges, 1);
});

test('same-tick loot is consumed once, companion credits its owner, ten coins recharge', () => {
  const s = arena([{ role: 'magpie' }, { role: 'magpie' }]); Object.assign(s.players[1], { x: 2.5, y: 3.5 });
  s.loot = Array.from({ length: 10 }, () => ({ x: 4.5, y: 3.5 })); s.totalLoot = 10; tick(s);
  assert.equal(s.collected, 10); assert.equal(s.players[0].coins, 10); assert.equal(s.players[0].charges, 3); assert.equal(s.players[1].coins, 0);
  tick(s); assert.equal(s.collected, 10);
});

test('locked doors need sustained pushing, Cracker is faster, wrench commits once', () => {
  for (const role of ['cracker', 'scout'] as const) {
    const s = arena([{ role, tool: 'wrench' }]); s.objects.push({ id: 'lock', kind: 'door', label: 'Lock', x: 3.5, y: 3.5, state: 'ready', until: 0 });
    advance(s, 1200, { x: 1, y: 0, sneak: false });
    assert.equal(s.objects[0].state, role === 'cracker' ? 'open' : 'ready');
    if (role === 'scout') { use(s); assert.equal(s.objects[0].state, 'open'); assert.equal(s.players[0].charges, 1); }
  }
});

test('loot/objective claims survive disconnects and safes cannot double-credit', () => {
  const s = arena([{ tool: 'wrench' }]); s.objects.push({ id: 'safe', kind: 'safe', label: 'Safe', x: 3.5, y: 3.5, state: 'ready', until: 0 }); s.totalLoot = 10;
  use(s); assert.equal(s.collected, 10); advance(s, 1000); assert.throws(() => use(s)); assert.equal(s.collected, 10);
  s.objects.push({ id: 'objective', kind: 'objective', label: 'Ledger', x: 3.5, y: 3.5, state: 'ready', until: 0 }); use(s); assert.equal(s.objectiveTaken, true);
  rules.onPresenceChange(s, 'p0', false, s.wallAt); advance(s, 16000); assert.equal(s.objectiveTaken, true); assert.equal(s.phase, 'escape');
});

test('occluded guards, their AI and effects never enter transport; Scout markers are explicit', () => {
  const s = arena(); s.tiles = s.tiles.map((r, y) => y > 0 && y < 9 ? r.slice(0, 5) + '#' + r.slice(6) : r);
  const g = guard(s); s.effects.push({ id: 1, kind: 'alarm', at: s.now, label: 'Guard', x: g.x, y: g.y });
  assert.equal(view(s).guards.length, 0); assert.equal(view(s).effects.length, 0); assert.equal(view(s).markers.length, 0);
  s.players[0].role = 'scout'; assert.deepEqual(view(s).markers, [{ x: g.x, y: g.y }]);
  tick(s, 100, { x: 0, y: 1, sneak: false }); assert.equal(view(s).markers.length, 0);
  tick(s, 100, { x: 0, y: 1, sneak: true }); assert.equal(view(s).markers.length, 1);
  rules.onPresenceChange(s, 'p0', false, s.wallAt); assert.deepEqual(view(s).visible, []); assert.deepEqual(view(s).markers, []);
});

test('smoke breaks sight and chase uses last-known location before returning to patrol', () => {
  const s = arena(), g = guard(s); advance(s, 1000); assert.equal(g.alert, 'chase');
  const remembered = { ...g.lastKnown }; use(s); s.players[0].y = 5.5; tick(s);
  assert.equal(g.alert, 'search'); assert.deepEqual(g.lastKnown, remembered);
  s.players[0].hidden = true; advance(s, 7000); assert.equal(g.alert, 'patrol'); assert.equal(g.lastKnown, null);
});

test('Ghost contact, Face charm and Impostor recharge each have passive effects', () => {
  const ghost = arena([{ role: 'ghost' }]), g = guard(ghost, { x: 3, y: 3.5 }); tick(ghost); assert.equal(g.alert, 'stunned');
  const face = arena([{ role: 'face' }]), a = guard(face, { x: 4, y: 3.5 }), b = guard(face, { x: 4, y: 4.5 }); tick(face);
  assert.equal([a, b].filter(g => g.charmed).length, 1); assert.equal(a.charmOwner, 'p0');
  const imp = arena([{ role: 'impostor' }]); imp.players[0].disguised = false; advance(imp, 5100); assert.equal(imp.players[0].disguised, true);
});

test('Breacher opens eligible walls and alerts nearby patrols', () => {
  const s = arena([{ role: 'breacher' }]); s.tiles[3] = '#..%.......#'; const g = guard(s, { x: 7.5, y: 5.5 });
  advance(s, 2700, { x: 1, y: 0, sneak: false }); assert.equal(s.tiles[3][3], '.'); assert.notEqual(g.alert, 'patrol'); assert.equal(s.alarm, true);
});

test('Wire hacks faster and longer; EMP disables every circuit', () => {
  for (const role of ['wire', 'scout'] as const) {
    const s = arena([{ role, tool: 'emp' }]); s.objects.push(...(['terminal', 'camera'] as const).map((kind, i) => ({ id: kind, kind, label: kind, x: 3.5 + i, y: 3.5, state: 'ready' as const, until: 0, circuit: 'a' })));
    advance(s, 1200, { x: 1, y: 0, sneak: false }); assert.equal(s.objects[0].state, role === 'wire' ? 'disabled' : 'ready');
    if (role === 'wire') assert.ok(s.objects[1].until - s.now > 29000);
    else { use(s); assert.ok(s.objects.every(o => o.state === 'disabled')); advance(s, 12100); assert.ok(s.objects.every(o => o.state === 'ready')); }
  }
});

test('aimed weapons respect walls and cone, hit intended guards and consume a charge', () => {
  for (const tool of ['tranq', 'shotgun'] as const) {
    const s = arena([{ tool }]), front = guard(s, { x: 4.5, y: 3.5 }), back = guard(s, { x: 1.5, y: 3.5 });
    use(s, { x: 1, y: 0 }); assert.equal(front.alert, 'stunned'); assert.equal(back.alert, tool === 'shotgun' ? 'search' : 'patrol'); assert.equal(s.players[0].charges, 1);
    const wall = arena([{ tool }]); wall.tiles[3] = '#..#.......#'; const hidden = guard(wall, { x: 4.5, y: 3.5 }); use(wall, { x: 1, y: 0 }); assert.equal(hidden.alert, tool === 'shotgun' ? 'search' : 'patrol');
  }
});

test('medkit revives and heals; normal push rescue takes work; Face is faster', () => {
  const s = arena([{ tool: 'medkit' }, {}]); s.players[1].down = true; s.players[1].health = 0; use(s); assert.equal(s.players[1].down, false); assert.equal(s.players[1].health, 100);
  for (const role of ['face', 'scout'] as const) {
    const r = arena([{ role }, {}]); Object.assign(r.players[1], { x: 3.3, y: 3.5, health: 0, down: true });
    advance(r, 1700, { x: 1, y: 0, sneak: false }); assert.equal(r.players[1].down, role !== 'face');
    if (role === 'scout') { advance(r, 2600, { x: 1, y: 0, sneak: false }); assert.equal(r.players[1].down, false); }
  }
});

test('security needs sight and enabled circuit; relaxed damage is lower', () => {
  for (const difficulty of ['normal', 'relaxed'] as const) {
    const s = arena(); s.settings.difficulty = difficulty; s.objects.push({ id: 'laser', kind: 'laser', label: 'Beam', x: 1.5, y: 3.5, facing: 0, state: 'ready', until: 0 }); tick(s);
    assert.equal(s.players[0].health, difficulty === 'normal' ? 80 : 89);
    s.players[0].hitAt = 0; s.objects[0].state = 'disabled'; s.objects[0].until = s.now + 10000; tick(s); assert.equal(s.players[0].health, difficulty === 'normal' ? 80 : 89);
  }
});

test('whole crew extraction, downed teammates, failure, suspended disconnect and shared scores', () => {
  const s = arena([{}, {}]); s.objectiveTaken = true; s.phase = 'escape'; s.objects.push({ id: 'exit', kind: 'exit', label: 'Van', x: 2.5, y: 3.5, state: 'ready', until: 0 });
  s.players[1].y = 7; tick(s); assert.equal(s.phase, 'escape'); s.players[1].y = 4; s.players[1].down = true; tick(s); assert.equal(s.phase, 'escape');
  rules.onPresenceChange(s, 'p1', false, s.wallAt); advance(s, 14900); assert.equal(s.phase, 'escape'); advance(s, 200); assert.equal(s.phase, 'clear');
  assert.deepEqual(rules.outcome(s).winners, ['p0', 'p1']); assert.equal(rules.outcome(s).rows[0].score, rules.outcome(s).rows[1].score);
  const failed = arena(); failed.players[0].down = true; tick(failed); assert.equal(failed.phase, 'failed'); assert.deepEqual(rules.outcome(failed).winners, []);
});

test('all-absent time pauses timers and never restores health, tools, or vision', () => {
  const s = arena(); s.players[0].health = 40; use(s); tick(s); const now = s.now, until = s.smoke[0].until;
  rules.onPresenceChange(s, 'p0', false, s.wallAt); advance(s, 20000); assert.equal(s.now, now); assert.equal(s.phase, 'infiltrate'); assert.deepEqual(view(s).visible, []);
  rules.onPresenceChange(s, 'p0', true, s.wallAt); tick(s); assert.equal(s.players[0].health, 40); assert.equal(s.players[0].charges, 1); assert.equal(s.smoke[0].until, until); assert.equal(s.now, now + 100);
});


test('disconnected bodies remain vulnerable during the fifteen-second grace', () => {
  const s = arena([{}, {}]), g = guard(s, { x: 2.8, y: 3.5 }); g.alert = 'chase'; g.suspicion = 1;
  rules.onPresenceChange(s, 'p0', false, s.wallAt); tick(s); assert.ok(s.players[0].health < 100);
  s.players[1].hidden = true; advance(s, 15100); const health = s.players[0].health;
  advance(s, 2000); assert.equal(s.players[0].health, health);
});

test('a guard that saw entry into a hiding place keeps pursuing', () => {
  const s = arena(), g = guard(s, { x: 3, y: 3.5 }); g.alert = 'chase'; g.suspicion = 1; g.lastKnown = { x: 2.5, y: 3.5 }; g.lostAt = s.now;
  s.players[0].hidden = true; tick(s); assert.ok(s.players[0].health < 100); assert.equal(g.alert, 'chase');
});

test('full-health medkits stay available; occluding walls remain in the sight mask', () => {
  const s = arena([{ tool: 'wrench' }]); s.objects.push({ id: 'med', kind: 'medkit', label: 'First aid', x: 3.5, y: 3.5, state: 'ready', until: 0 });
  advance(s, 1500, { x: 1, y: 0, sneak: false }); assert.equal(s.objects[0].state, 'ready');
  s.players[0].x = 2.5; s.tiles[3] = '#...#......#'; assert.ok(view(s).visible.includes(3 * 12 + 4)); assert.ok(!view(s).visible.includes(3 * 12 + 5));
});

test('same-cell pursuit reaches its target and alarm starts with one bounded effect', () => {
  const s = arena(); s.players[0].x = 2.85; s.players[0].y = 3.85;
  const g = guard(s, { x: 2.15, y: 3.15 }); g.alert = 'chase'; g.suspicion = 1; g.nextPathAt = 0; g.facing = Math.PI / 4;
  const before = Math.hypot(g.x - s.players[0].x, g.y - s.players[0].y); tick(s);
  assert.ok(Math.hypot(g.x - s.players[0].x, g.y - s.players[0].y) < before);
  assert.equal(s.effects.filter(e => e.kind === 'alarm').length, 1); tick(s); assert.equal(s.effects.filter(e => e.kind === 'alarm').length, 1);
});

test('shotgun breaks glass in the aiming cone but not glass behind a wall', () => {
  const s = arena([{ tool: 'shotgun' }]); s.tiles[3] = '#..=.#=....#'; use(s);
  assert.equal(s.tiles[3][3], '.'); assert.equal(s.tiles[3][6], '='); assert.ok(s.effects.some(e => e.kind === 'break'));
});

test('tool economy stays under the platform action cap at authored maximum loot', () => {
  for (const mission of Object.keys(MISSIONS) as MissionId[]) {
    const s = make([{}], mission); assert.ok(2 + Math.floor(s.totalLoot / 10) < 256);
  }
});


test('own smoke feedback survives smoke occlusion', () => {
  const s = arena(); use(s); assert.equal(view(s).effects.filter(e => e.kind === 'smoke').length, 1);
});

test('sub-deadzone inputs cannot move a hidden player', () => {
  const s = arena(); s.players[0].hidden = true; const x = s.players[0].x;
  advance(s, 10000, { x: .05, y: 0, sneak: false }); assert.equal(s.players[0].x, x); assert.equal(s.players[0].hidden, true);
});

test('final elapsed and score survive results presence changes', () => {
  const s = arena(); s.players[0].down = true; tick(s); const elapsed = s.elapsed, score = s.adjustedSeconds;
  rules.onPresenceChange(s, 'p0', false, s.wallAt + 10000); rules.onPresenceChange(s, 'p0', true, s.wallAt + 20000);
  assert.equal(s.elapsed, elapsed); assert.equal(s.adjustedSeconds, score);
});


test('shared visibility cannot combine one player’s geometry ray with another’s smoke ray', () => {
  const s = arena([{}, {}]); s.tiles = ['##########', ...Array.from({ length: 5 }, () => '#....#...#'), '##########'];
  Object.assign(s.players[0], { x: 2.5, y: 3.5 }); Object.assign(s.players[1], { x: 7.5, y: 1.5 });
  s.smoke.push({ x: 3.5, y: 3.5, radius: .4, until: s.now + 1000 }); assert.ok(!view(s).visible.includes(34));
});


test('EMP extends security shutdowns without shortening an existing Wire hack', () => {
  const s = arena([{ role: 'wire', tool: 'emp' }]);
  s.objects.push({ id: 'terminal', kind: 'terminal', label: 'Circuit', x: 3.5, y: 3.5, circuit: 'a', state: 'ready', until: 0 });
  advance(s, 1200, { x: 1, y: 0, sneak: false }); const until = s.objects[0].until;
  use(s); assert.equal(s.objects[0].until, until);
  advance(s, 23000); use(s); assert.ok(s.objects[0].until > until);
});


test('pushing into cover approaches its center, hides, holds, and releases; leaving exposes the player', () => {
  const s = arena(); s.objects.push({ id: 'bush', kind: 'hide', label: 'Bush', x: 4.5, y: 3.5, state: 'ready', until: 0 });
  advance(s, 1500, { x: 1, y: 0, sneak: false });
  assert.ok(Math.hypot(s.players[0].x - 4.5, s.players[0].y - 3.5) <= .3); assert.equal(s.players[0].hidden, true);
  const x = s.players[0].x; advance(s, 3000, { x: 1, y: 0, sneak: false });
  assert.equal(s.players[0].x, x); assert.equal(s.players[0].hidden, true);
  advance(s, 1000); assert.equal(s.players[0].x, x); assert.equal(s.players[0].hidden, true);
  tick(s, 100, { x: -1, y: 0, sneak: false }); assert.ok(s.players[0].x < x); assert.equal(s.players[0].hidden, false);
});

test('camera alerts do not reset a pursuing guard to search or overwrite its target', () => {
  const s = arena([{}, {}]), g = guard(s, { x: 5.5, y: 3.5 }); g.alert = 'chase'; g.suspicion = 1;
  Object.assign(s.players[1], { x: 2.5, y: 6.5 });
  s.objects.push({ id: 'camera', kind: 'camera', label: 'Camera', x: 1.5, y: 6.5, facing: 0, state: 'ready', until: 0 });
  advance(s, 500); assert.equal(g.alert, 'chase'); assert.deepEqual(g.lastKnown, { x: 2.5, y: 3.5 });
});


test('security sight passes through glass but stops at closed doors', () => {
  for (const kind of ['camera', 'laser'] as const) {
    const s = arena(); Object.assign(s.players[0], { x: 4.5, y: 3.5 }); s.tiles[3] = '#..=.......#';
    s.objects.push({ id: 'security', kind, label: 'Security', x: 1.5, y: 3.5, facing: 0, state: 'ready', until: 0 });
    tick(s); assert.equal(s.alarm, true);
    const blocked = arena(); Object.assign(blocked.players[0], { x: 4.5, y: 3.5 });
    blocked.objects.push({ id: 'security', kind, label: 'Security', x: 1.5, y: 3.5, facing: 0, state: 'ready', until: 0 }, { id: 'door', kind: 'door', label: 'Door', x: 3.5, y: 3.5, state: 'ready', until: 0 });
    tick(blocked); assert.equal(blocked.alarm, false); assert.equal(blocked.players[0].health, 100);
  }
});


test('cover at minimum stand-off allows outward and tangent exit across approach offsets', () => {
  for (const offset of [.31, .52, .86, 1.17]) for (const leave of [{ x: -1, y: 0 }, { x: 0, y: 1 }, { x: .000001, y: -1 }]) {
    const s = arena(); s.players[0].x = 4.5 - offset;
    s.objects.push({ id: 'bush', kind: 'hide', label: 'Bush', x: 4.5, y: 3.5, state: 'ready', until: 0 });
    advance(s, 1000, { x: 1, y: 0, sneak: false });
    assert.equal(s.players[0].hidden, true); assert.ok(Math.abs(s.players[0].x - 4.26) < .000001);
    const before = { x: s.players[0].x, y: s.players[0].y }; advance(s, 1000, { x: 1, y: 0, sneak: false });
    assert.equal(s.players[0].x, before.x); assert.equal(s.players[0].hidden, true);
    tick(s, 100, { ...leave, sneak: false });
    assert.ok(Math.hypot(s.players[0].x - before.x, s.players[0].y - before.y) > .3); assert.equal(s.players[0].hidden, false);
  }
});

test('movement from the exact center of cover always leaves it', () => {
  for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    const s = arena(); Object.assign(s.players[0], { x: 4.5, y: 3.5, hidden: true });
    s.objects.push({ id: 'bush', kind: 'hide', label: 'Bush', x: 4.5, y: 3.5, state: 'ready', until: 0 });
    tick(s, 100, { ...direction, sneak: false });
    assert.ok(Math.hypot(s.players[0].x - 4.5, s.players[0].y - 3.5) > .3); assert.equal(s.players[0].hidden, false);
  }
});
