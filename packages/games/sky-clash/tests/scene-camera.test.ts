import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CameraDirector, EventClock, FLOOR_AT, FLOOR_MIN, MIN_WIDTH, TELEPORT, blendView, contain, damp, frameShot, mainFloor, predictStage, type Floor, type Shot, type Subject, type Zone } from '../src/scene/camera';
import { damageColor, edgeBubble } from '../src/scene/tags';
import { STAGES, STAGE_IDS, stageFrame, type StageId } from '../src/stages';
import type { FighterView, GameEvent, View } from '../src/model';

const ASPECTS = [16 / 9, 4 / 3, 21 / 9, 1];
const floorOf = (id: StageId) => { const blocks = stageFrame(id, 0, false).blocks, fixed = blocks.filter(b => !b.moving); return mainFloor(fixed.length ? fixed : blocks); };
const within = (zone: Zone, shot: Shot, aspect: number) => {
  const w = shot.halfH * aspect, e = 1e-6;
  return shot.x - w >= zone.left - e && shot.x + w <= zone.right + e && shot.y - shot.halfH >= zone.bottom - e && shot.y + shot.halfH <= zone.top + e;
};
const sees = (shot: Shot, aspect: number, x: number, y: number) => Math.abs(x - shot.x) <= shot.halfH * aspect + 1e-6 && Math.abs(y - shot.y) <= shot.halfH + 1e-6;
const at = (x: number, y: number, extra: Partial<Subject> = {}): Subject => ({ x, y, height: 1.8, ...extra });
const minWidth = (zone: Zone, aspect: number) => Math.min(MIN_WIDTH, zone.right - zone.left, (zone.top - zone.bottom) * aspect);

test('target shots stay inside the stage camera box and never get tighter than about 9 m', () => {
  for (const id of STAGE_IDS) for (const aspect of ASPECTS) {
    const { camera: zone, blast: b } = STAGES[id], floor = floorOf(id);
    for (const subjects of [[], [at(0, floor.top)], [at(-.5, floor.top), at(.5, floor.top)], [at(b.left, b.top), at(b.right, b.bottom)], [at(b.right - 1, 0)], [at(0, b.top - 1)], [at(0, b.bottom + 1)]]) {
      const shot = frameShot(zone, floor, subjects, aspect);
      assert.ok(within(zone, shot, aspect), `${id} ${aspect.toFixed(2)} ${JSON.stringify(subjects)}`);
      assert.ok(shot.halfH * aspect * 2 >= minWidth(zone, aspect) - 1e-6, `${id} too tight`);
    }
  }
});

test('at spawn every fighter is in frame, the floor sits in the lower third, and centered Battlefield-size floors are seen whole', () => {
  for (const id of STAGE_IDS) {
    const stage = STAGES[id], floor = floorOf(id), subjects = stage.spawns.map(([x, y]) => at(x, y)), shot = frameShot(stage.camera, floor, subjects, 16 / 9);
    for (const s of subjects) assert.ok(sees(shot, 16 / 9, s.x, s.y) && sees(shot, 16 / 9, s.x, s.y + s.height), `${id}: spawn ${s.x.toFixed(1)} out of frame`);
    const fromBottom = (floor.top - (shot.y - shot.halfH)) / (2 * shot.halfH);
    assert.ok(fromBottom > .05 && fromBottom <= FLOOR_AT + .06, `${id}: floor at ${fromBottom.toFixed(2)} of the height`);
    if (floor.right - floor.left < 11 && Math.abs(floor.left + floor.right) < 1) assert.ok(sees(shot, 16 / 9, floor.left, floor.top) && sees(shot, 16 / 9, floor.right, floor.top), `${id}: both ledges in view`);
  }
});

test('two fighters close together get a close shot, but never under the minimum width', () => {
  const zone = STAGES['final-destination'].camera, floor = floorOf('final-destination'), wide = frameShot(zone, floor, [at(-6, 0), at(6, 0)], 16 / 9);
  const close = frameShot(STAGES.temple.camera, floorOf('temple'), [at(-1, 0), at(1, 0)], 16 / 9);
  assert.ok(close.halfH * 32 / 9 >= MIN_WIDTH - 1e-6 && close.halfH * 32 / 9 < 22, `temple close-up ${close.halfH * 32 / 9}`);
  assert.ok(wide.halfH > frameShot(zone, floor, [at(-1, 0), at(1, 0)], 16 / 9).halfH - 1e-9);
});

test('fast launches pull the frame ahead of the fighter; slow drifts do not', () => {
  const zone = STAGES.battlefield.camera, floor = floorOf('battlefield'), base = [at(-2, 0), at(3, 2)];
  const still = frameShot(zone, floor, base, 16 / 9), launched = frameShot(zone, floor, [base[0], { ...base[1], vx: .3, vy: .2, launch: .36 }], 16 / 9);
  const drift = frameShot(zone, floor, [base[0], { ...base[1], vx: .3, vy: .2, launch: .05 }], 16 / 9);
  assert.ok(launched.x > still.x && launched.halfH > still.halfH);
  assert.deepEqual(drift, still);
});

test('contain keeps a shot inside a zone without growing it', () => {
  const zone: Zone = { left: -10, right: 10, bottom: -5, top: 8 }, shot = contain({ x: 30, y: 30, halfH: 3 }, zone, 16 / 9);
  assert.ok(within(zone, shot, 16 / 9) && shot.halfH === 3);
  assert.ok(contain({ x: 0, y: 0, halfH: 50 }, zone, 16 / 9).halfH <= 20 / 2 / (16 / 9) + 1e-9);
});

test('the director eases without overshoot, snaps on reset, and stays in bounds', () => {
  const stage = STAGES.cloudbreak, floor: Floor = floorOf('cloudbreak'), director = new CameraDirector(stage.camera, floor), near = [at(-.5, 0), at(.5, 0)], far = [at(-8.5, 4), at(8.5, -3)];
  director.reset(stage.camera, floor, 16 / 9, near);
  const goal = frameShot(stage.camera, floor, far, 16 / 9).halfH;
  let last = director.shot.halfH;
  for (let i = 0; i < 300; i++) {
    const shot = director.update(far, 16 / 9, 1 / 60);
    assert.ok(within(stage.camera, shot, 16 / 9));
    assert.ok(director.shot.halfH >= last - 1e-9 && director.shot.halfH <= goal + 1e-6, 'monotonic zoom-out');
    last = director.shot.halfH;
  }
  assert.ok(Math.abs(last - goal) < .01);
  for (const s of far) assert.ok(sees(director.shot, 16 / 9, s.x, s.y));
  const [x, v] = damp(0, 10, 0, 4, 1 / 60); assert.ok(x > 0 && x < 10 && v > 0);
  director.reset(stage.camera, floor, 16 / 9, near);
  assert.deepEqual(director.shot, frameShot(stage.camera, floor, near, 16 / 9));
});

test('a KO punch-in tightens briefly, recovers, and never breaks the minimum width; kicks shake the shot', () => {
  const stage = STAGES.battlefield, floor = floorOf('battlefield'), director = new CameraDirector(stage.camera, floor), group = [at(-5, 0), at(5, 0)];
  director.reset(stage.camera, floor, 16 / 9, group);
  const base = director.update(group, 16 / 9, 1 / 60);
  director.punch(12, 3, 1);
  let tightest = Infinity;
  for (let i = 0; i < 20; i++) { const s = director.update(group, 16 / 9, 1 / 60); tightest = Math.min(tightest, s.halfH); assert.ok(s.halfH * 32 / 9 >= MIN_WIDTH - 1e-6); }
  assert.ok(tightest < base.halfH * .95);
  for (let i = 0; i < 60; i++) director.update(group, 16 / 9, 1 / 60);
  const after = director.update(group, 16 / 9, 1 / 60);
  assert.ok(Math.abs(after.halfH - base.halfH) < .01);
  const kicked = director.update(group, 16 / 9, 1 / 60, { x: .3, y: -.2, zoom: 0 });
  assert.ok(Math.abs(kicked.x - after.x - .3) < .02 && Math.abs(kicked.y - after.y + .2) < .02);
});

test('offscreen bubbles sit on the screen edge toward the fighter and shrink with distance', () => {
  const right = edgeBubble(2000, 360, 1280, 720, 48), inset = 48 + 14;
  assert.equal(right.x, 1280 - inset); assert.equal(right.y, 360); assert.ok(Math.abs(right.angle) < 1e-9);
  const above = edgeBubble(640, -500, 1280, 720, 48);
  assert.equal(above.y, inset); assert.ok(Math.abs(above.angle + Math.PI / 2) < 1e-9);
  const corner = edgeBubble(-900, 1500, 1280, 720, 48);
  assert.ok(corner.x >= inset && corner.x <= 1280 - inset && corner.y >= inset && corner.y <= 720 - inset);
  assert.ok(edgeBubble(2000, 360, 1280, 720, 48).scale < edgeBubble(1400, 360, 1280, 720, 48).scale && edgeBubble(1300, 360, 1280, 720, 48).scale <= 1);
  assert.notEqual(damageColor(0), damageColor(120));
});

// ── Presentation ──
const fighter = (o: Partial<FighterView> = {}): FighterView => ({ id: 'a', name: 'A', color: '#f00', fighter: 'fox', costume: 0, team: null, cpu: null, connected: true, x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: true,
  state: 'idle', stateFrame: 0, move: null, moveFrame: 0, charge: 0, hitlag: 0, damage: 0, stocks: 4, kos: 0, falls: 0, shield: 100, jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0, ...o });
const view = (o: Partial<View> = {}): View => ({ turnId: 't', phase: 'fight', phaseEndsAt: 0, endsAt: 0, frame: 0, stageId: 'battlefield', stageTick: 0, hazards: true, teams: false, stocks: 4, fighters: [], projectiles: [], events: [], ...o });

test('snapshots blend positions and the stage clock, but never slide across a teleport', () => {
  const a = view({ frame: 10, stageTick: 10, fighters: [fighter({ x: 0, y: 1 }), fighter({ id: 'b', x: 5 })], projectiles: [{ id: 1, owner: 'a', kind: 'laser', x: 0, y: 1, vx: 1, vy: 0, r: .1, life: 9, effect: 'electric' }] });
  const b = view({ frame: 12, stageTick: 12, fighters: [fighter({ x: 1, y: 2, state: 'walk' }), fighter({ id: 'b', x: 5 + TELEPORT + 1 })], projectiles: [{ id: 1, owner: 'a', kind: 'laser', x: 2, y: 1, vx: 1, vy: 0, r: .1, life: 7, effect: 'electric' }] });
  const mid = blendView(a, b, .5);
  assert.equal(mid.frame, 11); assert.equal(mid.stageTick, 11);
  assert.deepEqual([mid.fighters[0].x, mid.fighters[0].y, mid.fighters[0].state], [.5, 1.5, 'walk']);
  assert.equal(mid.fighters[1].x, b.fighters[1].x, 'teleports snap');
  assert.equal(mid.projectiles[0].x, 1);
  const respawn = blendView(view({ fighters: [fighter({ x: 0 })] }), view({ fighters: [fighter({ x: 1, state: 'respawn' })] }), .5);
  assert.equal(respawn.fighters[0].x, 1);
  const ko = blendView(view({ fighters: [fighter({ x: 0 })] }), view({ fighters: [fighter({ x: .5, stocks: 3 })] }), .5);
  assert.equal(ko.fighters[0].x, .5);
  assert.equal(blendView(a, view({ ...b, stageId: 'temple' }), .5).stageId, 'temple');
});

test('the prepared stage is the host pick, else the leading vote, else Battlefield', () => {
  const votes = (...stages: unknown[]) => stages.map(stage => ({ lobbyChoice: { fighter: 'fox', costume: 0, stage } }));
  assert.equal(predictStage({ stage: 'temple' }, votes('onett')), 'temple');
  assert.equal(predictStage({ stage: 'random' }, votes('onett')), 'battlefield');
  assert.equal(predictStage({ stage: 'vote' }, votes('onett', 'fourside', 'fourside', 'random', 'bogus')), 'fourside');
  assert.equal(predictStage({ stage: 'vote' }, votes('onett', 'fourside')), 'onett');
  assert.equal(predictStage({ stage: 'vote' }, [{}, { lobbyChoice: null }]), 'battlefield');
  assert.equal(predictStage(null, []), 'battlefield');
});

test('events fire once, when presentation reaches their frame, and stale ones drop', () => {
  const clock = new EventClock(), e = (id: number, frame: number): GameEvent => ({ id, kind: 'hit', frame, x: 0, y: 0 });
  clock.add([e(1, 10), e(2, 14)]); clock.add([e(1, 10), e(2, 14), e(3, 20)]);
  assert.deepEqual(clock.due(12).map(x => x.id), [1]);
  assert.deepEqual(clock.due(12), []);
  assert.deepEqual(clock.due(20).map(x => x.id), [2, 3]);
  clock.add([e(4, 21)]);
  assert.deepEqual(clock.due(200), [], 'too old to show');
});
test('a fighter flying high never pushes the main floor under the HUD while someone fights on it', () => {
  for (const id of ['battlefield', 'final-destination', 'yoshi-story'] as const) {
    const floor = floorOf(id), shot = frameShot(STAGES[id].camera, floor, [at(0, floor.top), at(2, floor.top + 11)], 1280 / 620);
    assert.ok((floor.top - (shot.y - shot.halfH)) / (2 * shot.halfH) >= FLOOR_MIN - 1e-9, id);
  }
});
