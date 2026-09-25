import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGrid, doorObjects, findPath, type Grid } from '../src/geometry';
import { getMap, LEVELS } from '../src/maps/index';
import type { HeistMap, MissionId, NpcKind, Point } from '../src/model';
import { getServerLevel } from '../src/server-levels/index';

const at = (x: number, y: number): Point => ({ x: x + .5, y: y + .5 });
const cell = (p: Point) => [Math.floor(p.x), Math.floor(p.y)] as const;
const free = (g: Grid, x: number, y: number) => x >= 0 && y >= 0 && x < g.width && y < g.height && !g.solid[y * g.width + x];
const SIDES = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** Grids for one security state: every door open or closed (locked doors optionally stay shut), windows and cracked walls optionally passable. */
function grid(map: HeistMap, { doors = 'o', locked = doors, windows = false, dig = false }: { doors?: string; locked?: string; windows?: boolean; dig?: boolean } = {}) {
  const state = doorObjects(map).map(o => o.kind === 'window' ? windows ? 'b' : 'c' : o.locked ? locked : doors).join('');
  const cracked = map.tiles.flatMap((row, y) => [...row].flatMap((c, x) => dig && c === '%' ? [y * map.width + x] : []));
  return buildGrid(map, state, cracked);
}
const reach = (g: Grid, a: Point, b: Point) => cell(a).join() === cell(b).join() || findPath(g, g.solid, a, b, 1e5).length > 0;
/** Solid targets (safes, terminals, the pedestal) are reached by standing on any open side. */
const reachTarget = (g: Grid, from: Point, o: Point) => { const [x, y] = cell(o); return free(g, x, y) ? reach(g, from, o) : SIDES.some(([dx, dy]) => free(g, x + dx, y + dy) && reach(g, from, at(x + dx, y + dy))); };
/** Flood fill that also rides paired vents. */
function flood(map: HeistMap, g: Grid, from: Point) {
  const seen = new Uint8Array(g.width * g.height), queue = [cell(from)], vents = map.objects.filter(o => o.kind === 'vent');
  seen[queue[0][1] * g.width + queue[0][0]] = 1;
  while (queue.length) {
    const [x, y] = queue.pop()!, vent = vents.find(v => cell(v).join() === `${x},${y}`), pair = vent && map.objects.find(o => o.id === vent.pair);
    for (const [nx, ny] of [...SIDES.map(([dx, dy]) => [x + dx, y + dy]), ...pair ? [cell(pair)] : []]) {
      if (!free(g, nx, ny) || seen[ny * g.width + nx]) continue;
      seen[ny * g.width + nx] = 1; queue.push([nx, ny]);
    }
  }
  return (p: Point) => { const [x, y] = cell(p); return !!seen[y * g.width + x] || SIDES.some(([dx, dy]) => free(g, x + dx, y + dy) && !!seen[(y + dy) * g.width + x + dx]); };
}

for (const id of Object.keys(LEVELS) as MissionId[]) test(`${id}: layout is legal, finishable by any role and every route is walkable`, () => {
  const map = getMap(id), server = getServerLevel(id), spawn = map.spawns[0], errors: string[] = [];
  const ok = (pass: unknown, problem: string) => pass || errors.push(problem);
  // Things standing on outdoor ground keep it (no indoor-floor squares on the street).
  map.tiles.forEach((row, y) => [...row].forEach((c, x) => ok(c !== '.' || ![map.tiles[y - 1]?.[x], map.tiles[y + 1]?.[x], row[x - 1], row[x + 1]].includes(',') || LEVELS[id].grid[y][x] === '.', `indoor floor under (${x},${y}) outside`)));
  ok(map.width >= 40 && map.width <= 48 && map.height >= 26 && map.height <= 32, `${map.width}x${map.height}`);
  ok(map.tiles.every(row => row.length === map.width), 'ragged rows');
  for (let x = 0; x < map.width; x++) for (const y of [0, map.height - 1]) ok('#~ '.includes(map.tiles[y][x]), `border (${x},${y})`);
  for (let y = 0; y < map.height; y++) for (const x of [0, map.width - 1]) ok('#~ '.includes(map.tiles[y][x]), `border (${x},${y})`);
  ok(new Set(map.objects.map(o => o.id)).size === map.objects.length, 'duplicate object ids');
  for (const r of map.rooms) ok(r.x > 0 && r.y > 0 && r.x + r.w < map.width && r.y + r.h < map.height, `room ${r.name}`);
  for (const p of map.props) ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= map.width && p.y + p.h <= map.height, `prop ${p.kind}`);

  // Every role can finish: doors open, but no vents, windows or digging.
  const plain = grid(map), ofKind = (k: string) => map.objects.filter(o => o.kind === k);
  ok(free(plain, cell(spawn)[0] + 1, cell(spawn)[1]), 'first spawn needs a free cell to its right');
  for (const s of map.spawns) ok(reach(plain, spawn, s), `spawn ${s.x},${s.y}`);
  const objective = ofKind('objective')[0], exit = ofKind('exit')[0];
  ok(reachTarget(plain, spawn, objective), 'objective unreachable');
  ok(reach(plain, spawn, exit), 'exit unreachable');
  const [ex, ey] = cell(exit); let zone = 0;
  for (let y = ey - 2; y <= ey + 2; y++) for (let x = ex - 2; x <= ex + 2; x++) if (Math.hypot(x + .5 - exit.x, y + .5 - exit.y) <= 1.8 && free(plain, x, y)) zone++;
  ok(zone >= 6, `exit zone has ${zone} free cells`);

  // Loot and every interactable are reachable with specialist routes too.
  const open = flood(map, grid(map, { windows: true, dig: true }), spawn);
  map.coins.forEach(c => ok(open(c), `coin ${c.x},${c.y}`));
  for (const o of map.objects) if (!['camera', 'laser', 'door', 'window'].includes(o.kind)) ok(open(o), `${o.kind} ${o.id}`);
  // A thief standing on a floor object (vent, hide, medkit, exit) can step off it: vents alone would otherwise mask a boxed-in cell.
  const walkable = grid(map, { windows: true, dig: true });
  for (const o of map.objects) if (['vent', 'hide', 'medkit', 'exit'].includes(o.kind)) ok(SIDES.some(([dx, dy]) => free(walkable, cell(o)[0] + dx, cell(o)[1] + dy)), `${o.id} is boxed in`);
  ok(map.coins.length >= 110 && map.coins.length <= 160, `${map.coins.length} coins`);
  ok(ofKind('safe').length >= 3 && ofKind('safe').length <= 5, 'three to five safes');

  // Doors and windows sit in a straight wall and keep both approach cells clear.
  const wall = (x: number, y: number) => '#%=~ '.includes(map.tiles[y]?.[x] ?? ' ');
  for (const o of doorObjects(map)) {
    const [x, y] = cell(o), vertical = o.horizontal ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    ok(o.horizontal ? wall(x - 1, y) && wall(x + 1, y) : wall(x, y - 1) && wall(x, y + 1), `${o.id} is not set in a straight wall`);
    for (const [dx, dy] of vertical) ok(free(plain, x + dx, y + dy), `${o.id} blocked at (${x + dx},${y + dy})`);
  }
  // Security devices face open space (props never block sight) and pair with a terminal.
  for (const o of [...ofKind('camera'), ...ofKind('laser')]) {
    const x = cell(o)[0] + Math.round(Math.cos(o.facing!)), y = cell(o)[1] + Math.round(Math.sin(o.facing!));
    ok(x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1 && !plain.opaque[y * map.width + x], `${o.id} faces a wall`);
    ok(ofKind('terminal').some(t => t.circuit === o.circuit), `${o.id} has no terminal`);
  }
  for (const t of ofKind('terminal')) ok([...ofKind('camera'), ...ofKind('laser')].some(o => o.circuit === t.circuit), `${t.id} controls nothing`);
  // Beams end on a plain wall, so doors, glass and digging never change their length.
  for (const o of ofKind('laser')) {
    const dx = Math.round(Math.cos(o.facing!)), dy = Math.round(Math.sin(o.facing!));
    let [x, y] = cell(o), n = 0;
    do { x += dx; y += dy; n++; } while (',.'.includes(map.tiles[y]?.[x] ?? '#'));
    ok(map.tiles[y]?.[x] === '#' && n > 2, `${o.id} beam ends on "${map.tiles[y]?.[x]}" after ${n - 1} cells`);
  }
  for (const v of ofKind('vent')) ok(map.objects.find(o => o.id === v.pair)?.pair === v.id, `${v.id} pair`);

  // NPC routes: guards open unlocked doors; dogs and civilians never cross a door.
  const walk: Record<NpcKind, Grid> = { guard: grid(map, { locked: 'l' }), dog: grid(map, { doors: 'c' }), civilian: grid(map, { doors: 'c' }) };
  const all = [...server.npcs, ...server.reinforcements?.npcs ?? []], count = (k: NpcKind) => server.npcs.filter(n => n.kind === k).length;
  ok(count('guard') >= 5 && count('guard') <= 8 && count('dog') >= 1 && count('dog') <= 2, 'guard and dog counts');
  ok(server.reinforcements?.npcs.length, 'reinforcements');
  for (const npc of all) npc.route.forEach(([x, y], i) => {
    const g = walk[npc.kind], [nx, ny] = npc.route[(i + 1) % npc.route.length];
    ok(free(g, x, y), `${npc.kind} stop (${x},${y}) is solid`);
    ok(reach(g, at(x, y), at(nx, ny)), `${npc.kind} cannot walk (${x},${y}) -> (${nx},${ny})`);
  });
  for (const npc of server.npcs) ok(Math.hypot(npc.route[0][0] + .5 - spawn.x, npc.route[0][1] + .5 - spawn.y) >= 8, `${npc.kind} starts on the spawn`);
  assert.deepEqual(errors, []);
});

test('getMap has no silent fallback and server levels are copies', () => {
  assert.throws(() => getMap('nowhere' as MissionId));
  const a = getServerLevel('velvet'); a.npcs[0].route[0][0] = -99;
  assert.notEqual(getServerLevel('velvet').npcs[0].route[0][0], -99);
});
