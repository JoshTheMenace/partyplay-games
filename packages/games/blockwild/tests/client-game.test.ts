import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { Box3, PerspectiveCamera, Scene, Vector3 } from 'three';
import { B, BED_HEAD, DOOR_OPEN, DOOR_UPPER, makeCell } from '../src/shared/blocks';
import type { CellReader } from '../src/shared/chunk';
import { MAX_CMDS } from '../src/shared/constants';
import { cellIndex } from '../src/shared/coords';
import { I, ITEM_LIST } from '../src/shared/items';
import { newBody } from '../src/shared/physics';
import { IF, parseInput, type PrivateView } from '../src/shared/protocol';
import { acknowledge, enqueue, resetQueue, store, touch, type TouchState } from '../src/client/store';
import { SOUND_FILES, impactSound, mobVoice, stepSound } from '../src/client/audio/sounds';
import { shotPose, type Subject } from '../src/client/game/camera';
import { applyLook, DoubleTap, moveFromInput } from '../src/client/game/controls';
import { Interpolator, lerpAngle } from '../src/client/game/interp';
import { baseName, ModelLibrary, pivotAliases, RIG_KIND, type ModelKey } from '../src/client/game/models';
import { buildInput, NetSync, type InputSource } from '../src/client/game/net';
import { Hand, type HandPose } from '../src/client/game/hand';
import { EditOverlay } from '../src/client/game/overlay';
import { Particles } from '../src/client/game/particles';
import { LocalPlayer, STEP, wantsAutoJump } from '../src/client/game/player';
import { closeScreen, configurePrediction, replay, sendCommand, setServerView } from '../src/client/game/predict';
import { ItemModels, SpriteSheet } from '../src/client/game/sprites';
import { heldAsBlock, itemSprite, texturePixels } from '../src/client/art/atlas';
import { blockUse, doorToggle, holdUse, linkedCells, pickTarget, writesHitBodies } from '../src/client/game/targeting';

/** A world of stone below y = 64 and air above, plus sparse overrides. */
function flatWorld(overrides: Record<string, number> = {}): CellReader {
  return (x, y, z) => overrides[`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`] ?? (y < 64 ? B.stone : B.air);
}
const pv = (patch: Partial<PrivateView> = {}): PrivateView => ({
  ack: 0, tp: { n: 0, x: 0, y: 0, z: 0 }, imp: { n: 0, vx: 0, vy: 0, vz: 0 }, inv: Array(36).fill(null), cursor: null, grid: Array(4).fill(null), out: null,
  screen: null, health: 20, food: 20, saturation: 5, air: 300, dead: false, spawn: [0, 64, 0], mode: 'survival', keepInventory: true,
  armor: [null, null, null, null], armorPoints: 0, dimension: 'overworld', ...patch,
});
const source = (patch: Partial<InputSource> = {}): InputSource => ({
  body: { ...newBody(2048.5, 64, 2048.5), onGround: true }, yaw: 0.5, pitch: -0.25, sprint: false, using: false, swinging: false, dead: false,
  slot: 3, mine: null, tpAck: 0, queue: store.get().queue, ...patch,
});

test('command queue numbers, resends until acked, trims to the cap and restarts after a reconnect', () => {
  resetQueue(10);
  const first = enqueue({ t: 'break', x: 1, y: 2, z: 3 }), second = enqueue({ t: 'close' });
  assert.deepEqual([first, second], [11, 12]);
  // Every unacknowledged command rides along with each input until the server acks it.
  assert.deepEqual(buildInput(source()).cmds.map(c => c.n), [11, 12]);
  assert.deepEqual(buildInput(source()).cmds.map(c => c.n), [11, 12]);
  acknowledge(11);
  assert.deepEqual(store.get().queue.map(c => c.n), [12]);
  // A stale ack changes nothing; a newer server ack (another tab) moves numbering forward.
  acknowledge(5);
  assert.deepEqual(store.get().queue.map(c => c.n), [12]);
  acknowledge(40);
  assert.equal(store.get().queue.length, 0);
  assert.equal(enqueue({ t: 'respawn' }), 41);
  for (let i = 0; i < 50; i++) enqueue({ t: 'drop', slot: 0 });
  const input = buildInput(source());
  assert.equal(input.cmds.length, MAX_CMDS);
  assert.equal(input.cmds[0]!.n, 41, 'the oldest commands are sent first');
  // First private view of a fresh scene: numbering restarts after the server's ack, old commands are forgotten.
  const net = new NetSync();
  assert.deepEqual(net.receive(pv({ ack: 7, tp: { n: 3, x: 1, y: 70, z: 1 }, imp: { n: 2, vx: 5, vy: 5, vz: 5 } }), null), { first: true, teleport: false, impulse: false });
  assert.equal(store.get().queue.length, 0);
  assert.equal(store.get().lastN, 7);
  assert.equal(net.tpAck, 3, 'an existing teleport counts as applied');
});

test('built inputs survive parseInput unchanged; neutral inputs flag NO_POS but keep commands', () => {
  resetQueue(0);
  enqueue({ t: 'place', x: 2048, y: 63, z: 2049, face: 3, slot: 2, hy: 0.25 });
  enqueue({ t: 'click', w: 'inv', i: 9, b: 2 });
  const body = { ...newBody(2048.123456, 64.5, 2047.98765), vx: 1.23456, vy: -3.14159, onGround: true, sneaking: true };
  const input = buildInput(source({ body, yaw: 7, sprint: true, swinging: true, mine: [2048, 63, 2049], tpAck: 4 }));
  assert.deepEqual(parseInput(JSON.parse(JSON.stringify(input))), input);
  assert.equal(input.f, IF.ON_GROUND | IF.SNEAK | IF.SPRINT | IF.SWINGING);
  assert.ok(Math.abs(input.yaw) <= Math.PI, 'yaw is wrapped');
  assert.deepEqual(input.p, [2048.123, 64.5, 2047.988]);
  for (const dead of [true, false]) {
    const neutral = buildInput(source({ body: dead ? source().body : null, dead, slot: 5, tpAck: 2 }));
    assert.ok(neutral.f & IF.NO_POS);
    assert.equal(neutral.slot, 5);
    assert.equal(neutral.cmds.length, 2);
    assert.deepEqual(parseInput(JSON.parse(JSON.stringify(neutral))), neutral);
  }
});

test('teleports snap the body once; impulses add velocity once per sequence number', () => {
  const net = new NetSync(), body = { ...newBody(10, 70, 10), vx: 3, vy: -8, onGround: true };
  net.receive(pv(), body);
  assert.deepEqual(net.receive(pv({ tp: { n: 1, x: 2000.5, y: 80, z: 2001.5 } }), body), { first: false, teleport: true, impulse: false });
  assert.deepEqual([body.x, body.y, body.z, body.vx, body.vy, body.onGround], [2000.5, 80, 2001.5, 0, 0, false]);
  assert.equal(net.tpAck, 1);
  body.x = 2003;
  assert.equal(net.receive(pv({ tp: { n: 1, x: 2000.5, y: 80, z: 2001.5 } }), body).teleport, false, 'the same teleport is not reapplied');
  assert.equal(body.x, 2003);
  body.onGround = true;
  const kicked = pv({ tp: { n: 1, x: 0, y: 0, z: 0 }, imp: { n: 1, vx: 4, vy: 6, vz: -2 } });
  assert.equal(net.receive(kicked, body).impulse, true);
  net.receive(kicked, body);
  assert.deepEqual([body.vx, body.vy, body.vz, body.onGround], [4, 6, -2, false]);
});

test('the optimistic overlay holds predictions until acked, so rejected edits revert on their own', () => {
  const overlay = new EditOverlay();
  overlay.set([[5, 64, 5, B.stone], [5, 65, 5, B.air]], 3);
  overlay.set([[6, 64, 5, B.dirt]], 4);
  const version = overlay.version;
  assert.equal(overlay.values.get(cellIndex(5, 64, 5)), B.stone);
  assert.equal(overlay.prune(2), false);
  assert.equal(overlay.version, version, 'nothing acked yet: no engine update');
  assert.equal(overlay.prune(3), true);
  assert.deepEqual([...overlay.values], [[cellIndex(6, 64, 5), B.dirt]]);
  // A later command over the same cell owns it: acking the earlier one keeps the newer prediction.
  overlay.set([[6, 64, 5, B.air]], 6);
  assert.equal(overlay.prune(4), false);
  assert.equal(overlay.values.get(cellIndex(6, 64, 5)), B.air);
  overlay.prune(6);
  assert.equal(overlay.size, 0);
});

test('container prediction replays pending commands over the last private view', () => {
  const base = pv({ inv: [{ id: B.oak_log, n: 3 }, { id: I.stick, n: 5 }, ...Array(34).fill(null)] });
  const cmd = (n: number, body: object) => ({ n, ...body }) as Parameters<typeof replay>[1][number];
  // Pick up the logs, drop them into the 2×2 grid: the output previews planks at once.
  const clicked = replay(base, [cmd(1, { t: 'click', w: 'inv', i: 0, b: 0 }), cmd(2, { t: 'click', w: 'grid', i: 0, b: 1 })], false);
  assert.deepEqual(clicked.grid[0], { id: B.oak_log, n: 1 });
  assert.deepEqual(clicked.cursor, { id: B.oak_log, n: 2 });
  assert.deepEqual(clicked.out, { id: B.oak_planks, n: 4 });
  assert.equal(base.inv[0]!.n, 3, 'the private view is never mutated');
  const crafted = replay(base, [cmd(1, { t: 'craft', r: 'oak_planks', max: true })], false);
  assert.deepEqual(crafted.inv[0], null);
  assert.ok(crafted.inv.some(slot => slot?.id === B.oak_planks && slot.n === 12));
  const dropped = replay(base, [cmd(1, { t: 'drop', slot: 1 }), cmd(2, { t: 'place', x: 0, y: 0, z: 0, face: 3, slot: 0 })], false);
  assert.deepEqual([dropped.inv[1]!.n, dropped.inv[0]!.n], [4, 2]);
  assert.equal(replay({ ...base, mode: 'creative' }, [cmd(1, { t: 'place', x: 0, y: 0, z: 0, face: 3, slot: 0 })], false).inv[0]!.n, 3, 'creative placing is free');
  assert.deepEqual(replay(base, [], false).inv, base.inv);
});

test('closing a chest and reopening it before the server replies still shows the chest', () => {
  resetQueue(0);
  configurePrediction({ nearTable: () => false, wake: () => {} });
  const chest = { kind: 'chest', x: 5, y: 60, z: 5, slots: Array(27).fill(null) } as const, use = { t: 'use', x: 5, y: 60, z: 5, face: 3 } as const;
  const opened = sendCommand(use);
  acknowledge(opened);
  setServerView(pv({ ack: opened, screen: chest }));
  assert.equal(store.get().screen, 'chest');
  closeScreen();
  // The server runs the close and the second use in one tick: the same chest, open again.
  const again = sendCommand(use);
  acknowledge(again);
  setServerView(pv({ ack: again, screen: chest }));
  assert.equal(store.get().screen, 'chest');
  configurePrediction(null);
});

test('remote entity interpolation brackets snapshots and turns along the shortest arc', () => {
  assert.ok(Math.abs(lerpAngle(3.0, -3.0, 0.5) - (3.0 + (2 * Math.PI - 6) / 2)) < 1e-9);
  assert.equal(lerpAngle(0.2, 0.6, 0.5), 0.4);
  const interp = new Interpolator<{ x: number }>(100);
  assert.equal(interp.sample(0), false);
  interp.push(1000, { x: 0 }, 1000);
  interp.push(1050, { x: 10 }, 1050);
  assert.equal(interp.sample(1125), true);
  assert.deepEqual([interp.a!.x, interp.b!.x], [0, 10]);
  assert.ok(Math.abs(interp.alpha - 0.5) < 1e-9, `alpha ${interp.alpha}`);
  // Past the newest snapshot it holds the last state (no extrapolation).
  assert.equal(interp.sample(1400), true);
  assert.deepEqual([interp.a!.x, interp.b!.x, interp.alpha], [10, 10, 0]);
});

test('targeting picks the nearest of the block hit and mob boxes within reach', () => {
  const block = { x: 3, y: 64, z: 0, face: 0, cell: B.stone, point: [3, 64.5, 0.5] as [number, number, number], distance: 3 };
  const eye: [number, number, number] = [0, 64.5, 0.5], dir: [number, number, number] = [1, 0, 0];
  const near = { id: 7, box: [1.5, 64, 0.2, 2.1, 65.9, 0.8] as const }, behind = { id: 8, box: [3.5, 64, 0, 4, 66, 1] as const };
  assert.deepEqual(pickTarget(block, [behind, near], eye, dir, 4.5), { kind: 'mob', id: 7, distance: 1.5 });
  assert.equal(pickTarget(block, [behind], eye, dir, 4.5)?.kind, 'block');
  assert.equal(pickTarget(null, [{ id: 9, box: [5, 64, 0, 6, 66, 1] }], eye, dir, 4.5), null, 'mobs beyond reach are ignored');
});

test('keyboard and touch merge into one move intent; look clamps pitch', () => {
  const t: TouchState = { ...touch, move: [0.5, 0.25], jump: false, sneak: false, flyDown: true };
  const intent = moveFromInput(new Set(['KeyW', 'KeyA']), t, 1.25, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 });
  assert.deepEqual(intent, { forward: 1, strafe: -0.5, jump: false, sneak: false, sprint: false, flyDown: true, yaw: 1.25 });
  assert.equal(moveFromInput(new Set(['Space', 'ShiftLeft']), { ...t, move: [0, 0] }, 0, intent).jump, true);
  assert.equal(intent.sneak, true);
  const view = { yaw: 0, pitch: 0 };
  applyLook(view, 100, 10000, 0.01, false);
  assert.equal(view.yaw, -1, 'dragging right turns right (negative yaw)');
  assert.ok(view.pitch < -1.56 && view.pitch > -Math.PI / 2, 'pitch clamps just short of straight down');
  applyLook(view, 0, 100, 0.01, true);
  assert.ok(view.pitch > -1.56, 'inverted Y looks up when dragging down');
  const taps = new DoubleTap(300);
  assert.deepEqual([taps.tap(0), taps.tap(200), taps.tap(350), taps.tap(1000)], [false, true, false, false]);
});

test('block use rules: containers open unless sneaking with an item, hoes till, holds eat or draw', () => {
  assert.equal(blockUse(B.chest, B.air, I.stick, false), 'open');
  assert.equal(blockUse(B.chest, B.air, B.dirt, true), null, 'sneak-click places against a chest');
  assert.equal(blockUse(B.chest, B.air, 0, true), 'open');
  assert.equal(blockUse(B.oak_door, B.oak_door, B.dirt, false), 'door');
  assert.equal(blockUse(B.grass_block, B.air, I.wooden_hoe, false), 'till');
  assert.equal(blockUse(B.grass_block, B.stone, I.wooden_hoe, false), null, 'no tilling under a block');
  assert.equal(blockUse(B.wheat, B.air, I.bone_meal, false), 'bonemeal');
  assert.equal(blockUse(makeCell(B.wheat, 7), B.air, I.bone_meal, false), null, 'grown crops take no bone meal');
  assert.equal(blockUse(B.snowy_grass, B.air, I.wooden_hoe, false), 'till');
  assert.equal(blockUse(B.stone, B.air, I.bucket, false), 'bucket');
  assert.equal(blockUse(B.stone, B.air, B.dirt, false), null);
  assert.equal(holdUse(I.bread, 12, false, false), 'eat');
  assert.equal(holdUse(I.bread, 20, false, false), null, 'full players cannot eat');
  assert.equal(holdUse(I.golden_apple, 20, false, false), 'eat');
  assert.equal(holdUse(I.bow, 20, false, false), null, 'no arrows');
  assert.equal(holdUse(I.bow, 20, false, true), 'bow');
  assert.equal(holdUse(I.bow, 20, true, false), 'bow');
});

test('doors and beds break and toggle as pairs; placement never traps a body', () => {
  const lower = makeCell(B.oak_door, 1), upper = makeCell(B.oak_door, 1 | DOOR_UPPER);
  const world = flatWorld({ '5,64,5': lower, '5,65,5': upper, '8,64,8': makeCell(B.bed, 2), '8,64,9': makeCell(B.bed, 2 | BED_HEAD) });
  assert.deepEqual(linkedCells(world, 5, 64, 5, lower), [[5, 65, 5]]);
  assert.deepEqual(linkedCells(world, 5, 65, 5, upper), [[5, 64, 5]]);
  assert.deepEqual(linkedCells(world, 8, 64, 8, makeCell(B.bed, 2)), [[8, 64, 9]]);
  assert.deepEqual(linkedCells(world, 8, 64, 9, makeCell(B.bed, 2 | BED_HEAD)), [[8, 64, 8]]);
  assert.deepEqual(doorToggle(world, 5, 65, 5, upper), [[5, 65, 5, upper | makeCell(0, DOOR_OPEN)], [5, 64, 5, lower | makeCell(0, DOOR_OPEN)]]);
  const player = [4.7, 64, 4.7, 5.3, 65.8, 5.3];
  assert.equal(writesHitBodies([[5, 65, 5, B.stone]], [player]), true);
  assert.equal(writesHitBodies([[5, 66, 5, B.stone]], [player]), false);
  assert.equal(writesHitBodies([[5, 64, 5, B.torch]], [player]), false, 'non-solid blocks may overlap');
});

test('the local player steps at fixed 1/60 s and renders between the last two steps', () => {
  const world = flatWorld(), player = new LocalPlayer(10.5, 64, 10.5);
  const intent = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 };
  for (let i = 0; i < 30; i++) player.update(1 / 60, intent, world, 'survival', true);
  assert.equal(player.body.onGround, true);
  assert.ok(player.body.z < 10.5 - 0.5, 'walks north (yaw 0 = -Z)');
  player.update(STEP * 0.5, intent, world, 'survival', true);
  assert.ok(player.render.z <= player.prev.z && player.render.z >= player.body.z, 'render is interpolated inside the last step');
  const z = player.body.z;
  assert.equal(player.update(1, intent, world, 'survival', false), false, 'physics pauses over unloaded ground');
  assert.equal(player.body.z, z);
  // A huge frame is capped rather than simulated as one long step.
  player.update(5, intent, world, 'survival', true);
  assert.ok(z - player.body.z < 10 * STEP * 6, 'at most ten steps per frame');
});

test('spectator shots pull in when blocks hide the subject', () => {
  const subject: Subject = { key: 'a', x: 10.5, y: 64, z: 10.5, yaw: 0 }, out: number[] = [];
  shotPose('shoulder', subject, 0, flatWorld(), out);
  assert.ok(out[2]! > 14, 'over the shoulder sits behind the player (south when facing north)');
  // A wall one block behind the player.
  const walls: Record<string, number> = {};
  for (let x = 5; x < 16; x++) for (let y = 64; y < 72; y++) walls[`${x},${y},12`] = B.stone;
  shotPose('shoulder', subject, 0, flatWorld(walls), out);
  assert.ok(out[2]! < 12, `camera stays in front of the wall (z ${out[2]})`);
});

test('sound mapping only names samples that exist on disk; model pivots accept old names', () => {
  const dir = new URL('../../../../public/games/blockwild/sounds/', import.meta.url);
  for (const name of SOUND_FILES) assert.ok(existsSync(new URL(`${name}.wav`, dir)), `${name}.wav`);
  for (const name of [stepSound('wool', 7), impactSound('metal', 2), mobVoice('zombie', 1)!, mobVoice('cow', 0)!]) assert.ok(SOUND_FILES.includes(name), name);
  assert.equal(mobVoice('creeper', 0), null);
  assert.equal(baseName('Leg_Left.003'), 'leg_left');
  assert.deepEqual(pivotAliases('arm_l', 'humanoid'), ['arm_l', 'arm_left']);
  assert.ok(pivotAliases('leg_l', 'chicken').includes('leg_0'));
  assert.ok(pivotAliases('leg_fr', 'quadruped').includes('leg_1'));
  assert.ok(pivotAliases('leg_5', 'spider').includes('leg_right_1'));
  assert.ok(pivotAliases('wool', 'quadruped').includes('coat'));
});

test('every entity has an animatable rig and every visible item a 3D model, without WebGL', () => {
  const library = new ModelLibrary(), wanted: Record<string, string[]> = {
    humanoid: ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'], creeper: ['head', 'leg_fl', 'leg_br'], quadruped: ['head', 'leg_fl', 'leg_br'],
    spider: ['head', 'leg_0', 'leg_7'], chicken: ['head', 'leg_l', 'arm_r'], ghast: ['head', 'leg_0', 'leg_8', 'face_idle', 'face_shoot'], block: ['body'],
  };
  for (const key of Object.keys(RIG_KIND) as ModelKey[]) {
    const rig = library.instance(key);
    for (const pivot of wanted[rig.kind]!) assert.ok(rig.pivots[pivot as keyof typeof rig.pivots], `${key} ${pivot}`);
    assert.ok(rig.materials.length > 0);
    library.release(rig);
  }
  assert.ok(library.instance('sheep').pivots.wool, 'sheep wool can be hidden when sheared');
  assert.ok(library.instance('player').materials.some(m => m.shirt), 'the player shirt takes the seat colour');
  const models = new ItemModels(new SpriteSheet({ tile: texturePixels, item: itemSprite, cube: heldAsBlock }));
  for (const item of ITEM_LIST) {
    if (item.hidden) continue;
    const model = models.model(item.id), position = model?.geometry.getAttribute('position');
    assert.ok(model && position && position.count > 0, item.key);
    assert.equal(model.cube, heldAsBlock(item.id), item.key);
    for (let i = 0; i < position.array.length; i++) assert.ok(Number.isFinite(position.array[i]!) && Math.abs(position.array[i]!) <= 0.51, item.key);
  }
  models.dispose();
});

test('the first-person arm rests in the lower right, swings towards the crosshair and never reaches the near plane', () => {
  const world = new Scene(), camera = new PerspectiveCamera(75, 16 / 9, 0.05, 100);
  camera.aspect = 16 / 9;
  const models = new ItemModels(new SpriteSheet({ tile: texturePixels, item: itemSprite, cube: heldAsBlock }));
  const hand = new Hand(world, camera, models, '#3060ff');
  let drawn: [Scene, PerspectiveCamera] | null = null;
  const renderer = { autoClear: true, info: { autoReset: true }, clearDepth() {}, render(scene: Scene, cam: PerspectiveCamera) { drawn = [scene, cam]; } };
  const pose: HandPose = { mining: false, eating: -1, drawing: -1, bobPhase: 0, bobAmount: 0, yawSpeed: 0, pitchSpeed: 0, light: [1, 1, 1], visible: true };
  const fist = () => {
    world.onAfterRender(renderer as never, world, camera, null as never, null as never, null as never);
    const [scene, cam] = drawn!, arm = scene.getObjectByProperty('type', 'Mesh')!;
    scene.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const box = new Box3().setFromObject(arm), tip = new Vector3(-1 / 16, 10 / 16, 0).applyMatrix4(arm.matrixWorld);
    return { tip: tip.clone().project(cam), near: -box.max.z };
  };
  hand.update(0.016, pose);
  const rest = fist();
  assert.ok(rest.tip.x > 0.3 && rest.tip.y < -0.3, 'resting fist in the lower right');
  hand.swing();
  let reach = 1;
  for (let t = 0; t < 0.3; t += 0.02) {
    hand.update(0.02, pose);
    const { tip, near } = fist();
    reach = Math.min(reach, tip.x);
    assert.ok(near > 0.3, 'the arm stays well past the near plane');
    assert.ok(tip.y < 0.2, 'the swing stays below the crosshair');
  }
  assert.ok(reach < 0.2, 'the punch reaches in towards the crosshair');
  hand.dispose();
  models.dispose();
});

test('torch smoke is a tiny soft puff that drifts up and fades quickly', () => {
  const sheet = new SpriteSheet({ tile: texturePixels, item: itemSprite }), particles = new Particles(sheet.texture, sheet.white, () => {});
  particles.smoke(10, 70, 10, 1);
  particles.update(0.1, () => 0);
  const pos = particles.mesh.geometry.getAttribute('aPos');
  assert.ok(pos.getW(0) < 0 && Math.abs(pos.getW(0)) <= 0.13, 'a soft puff about a tenth of a block wide');
  assert.ok(pos.getY(0) > 70, 'rising');
  for (let t = 0; t < 1.2; t += 0.1) particles.update(0.1, () => 0);
  assert.equal(particles.count, 0, 'gone within about a second');
  particles.dispose();
});

test('auto jump climbs one-block ledges only when enabled, never walls or slabs', () => {
  const ledge = (height: number): CellReader => (x, y, z) => y < 64 || y < 64 + height && z < 2045 ? (y === 64 && height === 0.5 ? makeCell(B.oak_slab, 0) : B.stone) : B.air;
  const walk = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 };
  const at = () => Object.assign(newBody(2048.5, 64, 2045.8), { onGround: true });
  assert.equal(wantsAutoJump(at(), walk, ledge(1)), true, 'a one-block ledge');
  assert.equal(wantsAutoJump(at(), walk, ledge(2)), false, 'a two-block wall');
  assert.equal(wantsAutoJump(at(), walk, ledge(0.5)), false, 'a slab is a step-up, not a jump');
  assert.equal(wantsAutoJump(at(), { ...walk, forward: 0 }, ledge(1)), false, 'standing still');
  const climb = (auto: boolean) => {
    const player = new LocalPlayer(2048.5, 64, 2045.8), getCell = ledge(1);
    Object.assign(player.body, { onGround: true });
    for (let i = 0; i < 90; i++) player.update(STEP, walk, getCell, 'survival', true, auto);
    return player.body.y;
  };
  assert.ok(climb(true) >= 65, 'enabled: the player ends up on the ledge');
  assert.ok(climb(false) < 64.1, 'disabled: the player stays below');
});
