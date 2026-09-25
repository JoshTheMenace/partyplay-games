/** Nether portals (DESIGN.md): frames, lighting, the index, 8:1 links, arrival portals and travel. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, cellId, cellState, isFullCube, PORTAL_Z } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { inNether, NETHER } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { I } from '../src/shared/ids';
import { IF, validateSettings, type CmdBody, type Input, type Mode } from '../src/shared/protocol';
import { createState, saveSource, tickState } from '../src/sim/game';
import { findFrame, findPortal, portalTarget } from '../src/sim/portals';
import { exportSave, parseSave } from '../src/sim/save';
import type { Player, State } from '../src/sim/state';
import { playerView } from '../src/sim/views';
import { breakBlock, writeCell } from '../src/sim/world';

/** Bedrock at y 0, stone up to 62, grass at 63: players stand at y 64. */
const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048;
function game(mode: Mode = 'survival', source = flat, spawn: [number, number, number] = [X, 64, Z]): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11, mode, difficulty: 'peaceful' }), { source, spawn });
  state.players[0]!.protectedUntil = 0;
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const send = (state: State, cmds: CmdBody[]) => tickState(state, new Map([['p0', hold(state.players[0]!, cmds)]]), 0.05);
const run = (state: State, ticks: number) => { for (let i = 0; i < ticks; i++) tickState(state, new Map(), 0.05); };
const place = (state: State, x: number, y: number, z: number, player: Player) => Object.assign(player, { x, y, z, fallPeak: y, supportY: y });

/** An obsidian frame around an interior of w × h whose bottom-left interior cell is (x, y, z), in plane `axis`. */
function frame(set: (x: number, y: number, z: number, cell: number) => void, x: number, y: number, z: number, w: number, h: number, axis: 0 | 1, corners = true) {
  const [dx, dz] = axis ? [0, 1] : [1, 0];
  for (let i = -1; i <= w; i++) for (let j = -1; j <= h; j++) {
    const edge = i === -1 || i === w || j === -1 || j === h, corner = (i === -1 || i === w) && (j === -1 || j === h);
    if (edge && (corners || !corner)) set(x + dx * i, y + j, z + dz * i, B.obsidian);
  }
}
/** A plain cell reader over a map, air elsewhere. */
function reader() {
  const cells = new Map<string, number>();
  const set = (x: number, y: number, z: number, cell: number) => cells.set(`${x},${y},${z}`, cell);
  return { set, get: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? B.air };
}
const portalCells = (state: State) => [...state.world.edits.values()].filter(cell => cellId(cell) === B.nether_portal).length;

test('frames: 2×3 up to 21×21 in either plane, corners optional, from any interior cell', () => {
  for (const [w, h, axis] of [[2, 3, 0], [21, 21, 0], [4, 5, 1], [3, 21, 1]] as const) {
    const { set, get } = reader();
    frame(set, 10, 64, 20, w, h, axis, w !== 4);
    const expected = { x: 10, y: 64, z: 20, axis, w, h };
    assert.deepEqual(findFrame(get, 10, 64, 20, axis), expected, `${w}×${h}`);
    const [dx, dz] = axis ? [0, 1] : [1, 0];
    assert.deepEqual(findFrame(get, 10 + dx * (w - 1), 64 + h - 1, 20 + dz * (w - 1), axis), expected, 'from the far top corner');
    assert.equal(findFrame(get, 10, 64, 20, axis ? 0 : 1), null, 'not in the other plane');
  }
});

test('frames: too small, too big, gaps, wrong material and blocked interiors are refused', () => {
  const cases: [string, (set: (x: number, y: number, z: number, cell: number) => void) => void][] = [
    ['1 wide', set => frame(set, 0, 64, 0, 1, 3, 0)],
    ['2 tall', set => frame(set, 0, 64, 0, 2, 2, 0)],
    ['22 wide', set => frame(set, 0, 64, 0, 22, 3, 0)],
    ['22 tall', set => frame(set, 0, 64, 0, 2, 22, 0)],
    ['missing side block', set => { frame(set, 0, 64, 0, 2, 3, 0); set(-1, 65, 0, B.air); }],
    ['missing top block', set => { frame(set, 0, 64, 0, 3, 3, 0); set(1, 67, 0, B.air); }],
    ['missing bottom block', set => { frame(set, 0, 64, 0, 2, 3, 0); set(1, 63, 0, B.air); }],
    ['stone in the frame', set => { frame(set, 0, 64, 0, 2, 3, 0); set(2, 66, 0, B.stone); }],
    ['a block inside', set => { frame(set, 0, 64, 0, 2, 3, 0); set(1, 66, 0, B.dirt); }],
    ['already lit', set => { frame(set, 0, 64, 0, 2, 3, 0); set(1, 66, 0, B.nether_portal); }],
  ];
  for (const [name, build] of cases) {
    const { set, get } = reader();
    build(set);
    assert.equal(findFrame(get, 0, 64, 0, 0), null, name);
  }
});

test('flint and steel lights a frame; fire inside one lights it too; breaking any frame block unlights all of it', () => {
  const state = game(), player = state.players[0]!, set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
  frame(set, X + 2, 64, Z, 2, 3, 0, false);
  player.inv[0] = { id: I.flint_and_steel, n: 1 };
  send(state, [{ t: 'use', x: X + 2, y: 63, z: Z, face: 3 }]);
  assert.equal(portalCells(state), 6);
  assert.equal(cellState(state.get(X + 3, 66, Z)) & PORTAL_Z, 0, 'the plane spans X');
  assert.equal(state.portals.cells.size, 6);
  assert.equal(player.inv[0]!.d, 1, 'the flint and steel wears');
  assert.ok(![...state.world.edits.values()].includes(B.fire), 'no fire is placed');

  breakBlock(state, X + 4, 65, Z);
  assert.equal(portalCells(state), 0, 'the whole portal goes');
  assert.equal(state.portals.cells.size, 0);

  // A fire block (from a fireball, say) lights the frame on the next tick.
  frame(set, X + 10, 64, Z, 3, 4, 1);
  writeCell(state, X + 10, 64, Z + 1, B.fire);
  run(state, 1);
  assert.equal(portalCells(state), 12);
  assert.equal(cellState(state.get(X + 10, 67, Z + 2)) & PORTAL_Z, PORTAL_Z, 'the plane spans Z');
  // Removing a portal cell itself (pistons, explosions) also clears the rest.
  writeCell(state, X + 10, 66, Z + 1, B.air);
  assert.equal(portalCells(state), 0);
});

test('the portal index rebuilds from saved edits', () => {
  const state = game(), set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
  frame(set, X + 2, 64, Z, 2, 3, 0);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) writeCell(state, X + 2 + i, 64 + j, Z, B.nether_portal);
  const saved = parseSave(JSON.parse(JSON.stringify(exportSave(saveSource(state)))));
  const loaded = createState({ roomId: 'room', roundId: 'r2', seed: 7, nowMs: 0, players: [] }, saved.settings, { source: flat, save: saved });
  assert.deepEqual([...loaded.portals.cells].sort(), [...state.portals.cells].sort());
  assert.deepEqual(findPortal(loaded, X, Z, 16), [X + 2, 64, Z]);
});

test('8:1 links: overworld to Nether and back, clamped inside each dimension and out of the Nether corner', () => {
  assert.deepEqual(portalTarget(1000.7, 2000.2), [NETHER.x0 + 125, 250]);
  assert.deepEqual(portalTarget(0, 0), [NETHER.x0 + 8, 8]);
  assert.deepEqual(portalTarget(4095, 4095), [NETHER.x0 + 503, 503]);
  assert.deepEqual(portalTarget(NETHER.x0 + 100.5, 200.9), [800, 1600]);
  assert.deepEqual(portalTarget(NETHER.x0 + 8, 8), [64, 64]);
  const [x, z] = portalTarget(NETHER.x0 + 506, 20);
  assert.ok(!inNether(x, z) && !inNether(x, z - 16), `${x},${z} leads out of the Nether's corner`);
});

test('travel takes 4 s (1 s in creative), builds a safe arrival portal and never ping-pongs', () => {
  for (const mode of ['survival', 'creative'] as const) {
    const state = game(mode), player = state.players[0]!, set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
    frame(set, X, 64, Z, 2, 3, 0);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) writeCell(state, X + i, 64 + j, Z, B.nether_portal);
    place(state, X + 1, 64, Z + 0.5, player);
    const seconds = mode === 'creative' ? 1 : 4;
    run(state, seconds * 20 - 2);
    assert.ok(player.portal > 0.85 && player.portal < 1 && !inNether(player.x, player.z), `${mode}: still charging`);
    run(state, 3);
    assert.ok(inNether(player.x, player.z), `${mode}: arrived`);
    assert.equal(player.portal, 0);
    assert.equal(player.toast?.text, 'Entering the Nether…');
    assert.ok(state.fx.some(entry => entry.fx.k === 'travel'));
    // The arrival: a lit 4 × 5 obsidian portal around the player, room to step out on firm ground on both sides.
    const [tx, tz] = portalTarget(X + 1, Z);
    const here = findPortal(state, player.x, player.z, 2)!;
    assert.ok(Math.abs(here[0] - tx) <= 16 && Math.abs(here[2] - tz) <= 16);
    assert.equal(cellId(state.get(player.x, player.y, player.z)), B.nether_portal, 'standing inside the portal');
    assert.equal(cellId(state.get(player.x, player.y - 1, player.z)), B.obsidian);
    assert.equal(player.tp.x, player.x);
    // Standing still inside the arrival portal never sends the player back.
    run(state, 200);
    assert.ok(inNether(player.x, player.z) && player.portal === 0 && player.portalLock, `${mode}: no ping-pong`);
    // Step out, step back in: the trip home reuses the first portal.
    const inside = { x: player.x, y: player.y, z: player.z };
    place(state, inside.x, inside.y, inside.z + 2, player);
    run(state, 1);
    assert.equal(player.portalLock, false);
    place(state, inside.x, inside.y, inside.z, player);
    run(state, seconds * 20 + 2);
    assert.ok(!inNether(player.x, player.z), `${mode}: back home`);
    assert.deepEqual([Math.floor(player.x), player.y, Math.floor(player.z)], [X + 1, 64, Z]);
    assert.equal(portalCells(state), 12, 'two portals in all');
  }
});

test('arrivals reuse a portal within 16 blocks in the Nether and 128 in the overworld', () => {
  const state = game(), player = state.players[0]!, set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
  const light = (x: number, y: number, z: number) => {
    frame(set, x, y, z, 2, 3, 0);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) writeCell(state, x + i, y + j, z, B.nether_portal);
  };
  light(X, 64, Z);
  const [tx, tz] = portalTarget(X, Z);
  light(tx + 12, 64, tz - 5);
  place(state, X + 1, 64, Z + 0.5, player);
  run(state, 82);
  assert.deepEqual([Math.floor(player.x), Math.floor(player.z)], [tx + 13, tz - 5], 'lands in the existing Nether portal');
  assert.equal(portalCells(state), 12, 'no new portal');
  // Back to the overworld: a portal 100 blocks from the mapped point wins over building one.
  const [ox, oz] = portalTarget(player.x, player.z);
  light(ox + 100, 64, oz);
  assert.deepEqual(findPortal(state, ox, oz, 128), [ox + 100, 64, oz], 'the overworld search reaches 100 blocks');
  assert.equal(findPortal(state, ox, oz + 200, 128), null);
  assert.equal(findPortal(state, tx - 10, tz, 16), null, 'the Nether search stops at 16 blocks');
});

test('arrival portals avoid lava: firm ground within 16 blocks, else an obsidian platform', () => {
  // The Nether below y 64 is lava, with a single netherrack island near the arrival point.
  const [tx, tz] = portalTarget(X + 1, Z), island = { x: tx + 9, z: tz - 3 };
  const source: ChunkSource = (cx, cz) => {
    const chunk = new Uint16Array(CHUNK_CELLS);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = cx * 16 + lx, z = cz * 16 + lz, nether = inNether(x, z);
      const ground = nether && Math.abs(x - island.x) <= 3 && Math.abs(z - island.z) <= 3;
      for (let y = 0; y <= 63; y++) chunk[localIndex(lx, y, lz)] = y === 0 ? B.bedrock : !nether ? B.stone : ground ? B.netherrack : B.lava;
    }
    return chunk;
  };
  for (const withIsland of [true, false]) {
    if (!withIsland) island.x = 0;
    const state = game('survival', source), player = state.players[0]!, set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
    frame(set, X, 64, Z, 2, 3, 0);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) writeCell(state, X + i, 64 + j, Z, B.nether_portal);
    place(state, X + 1, 64, Z + 0.5, player);
    run(state, 82);
    assert.ok(inNether(player.x, player.z));
    const x = Math.floor(player.x), y = Math.floor(player.y), z = Math.floor(player.z);
    if (withIsland) assert.ok(Math.abs(x - island.x) <= 3 && Math.abs(z - island.z) <= 3 && y === 64, `on the island: ${x},${y},${z}`);
    // Both sides of the portal have firm, dry standing room.
    const axis = cellState(state.get(x, y, z)) & PORTAL_Z, [nx, nz] = axis ? [1, 0] : [0, 1];
    for (const side of [1, -1]) {
      assert.ok(isFullCube(state.get(x + nx * side, y - 1, z + nz * side)), `floor on side ${side}`);
      assert.equal(cellId(state.get(x + nx * side, y, z + nz * side)), B.air);
      assert.equal(cellId(state.get(x + nx * side, y + 1, z + nz * side)), B.air);
    }
    if (!withIsland) assert.equal(cellId(state.get(x + nx, y - 1, z + nz)), B.obsidian, 'a platform over the lava');
  }
});

test('a new Nether portal opens onto tall room: a cavern near the mapped point beats a low tunnel', () => {
  // Netherrack floor to y 63 and a ceiling from y 68 (portals fit, but nobody would call it roomy), except a cavern.
  const [tx, tz] = portalTarget(X + 1, Z), cavern = { x: tx + 10, z: tz };
  const source: ChunkSource = (cx, cz) => {
    const chunk = new Uint16Array(CHUNK_CELLS);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = cx * 16 + lx, z = cz * 16 + lz, nether = inNether(x, z), open = Math.abs(x - cavern.x) <= 5 && Math.abs(z - cavern.z) <= 5;
      for (let y = 0; y < 128; y++) chunk[localIndex(lx, y, lz)] = y === 0 ? B.bedrock : !nether ? y <= 63 ? B.stone : B.air : y <= 63 || y >= (open ? 90 : 68) ? B.netherrack : B.air;
    }
    return chunk;
  };
  const state = game('creative', source), player = state.players[0]!, set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
  frame(set, X, 64, Z, 2, 3, 0);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) writeCell(state, X + i, 64 + j, Z, B.nether_portal);
  place(state, X + 1, 64, Z + 0.5, player);
  run(state, 22);
  assert.ok(inNether(player.x, player.z));
  // Facing out of the portal (tp.yaw), the next four steps have five blocks of headroom.
  const ahead = [-Math.sin(player.yaw), -Math.cos(player.yaw)];
  for (let step = 1; step <= 4; step++) for (let j = 0; j < 5; j++) {
    assert.equal(cellId(state.get(player.x + ahead[0]! * (step + 0.5), player.y + j, player.z + ahead[1]! * (step + 0.5))), B.air, `open ahead at ${step}, +${j}`);
  }
});

test('the charge shows in the private view and resets on stepping out', () => {
  const state = game(), player = state.players[0]!, set = (x: number, y: number, z: number, cell: number) => writeCell(state, x, y, z, cell);
  frame(set, X, 64, Z, 2, 3, 0);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) writeCell(state, X + i, 64 + j, Z, B.nether_portal);
  place(state, X + 1, 64, Z + 0.5, player);
  run(state, 40);
  assert.equal(playerView(state, 'p0').portal, 0.5);
  place(state, X + 1, 64, Z + 3, player);
  run(state, 1);
  assert.equal(playerView(state, 'p0').portal, undefined);
});
