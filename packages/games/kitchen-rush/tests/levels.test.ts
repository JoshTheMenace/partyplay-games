import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, SURFACES, WALKABLE, parseMap, type KitchenMap, type Level, type Tile } from '../src/model';
import { LEVELS, crewScale, kitchenMap, starThresholds } from '../src/levels';
import { rules } from '../src/server';
import { botInput } from './helpers/bot';
import { DT, setup } from './helpers/kitchen';

const SIZES = [{ size: 'small', maxCols: 15, maxRows: 10, spawns: 4, floor: 24 }, { size: 'large', maxCols: 22, maxRows: 13, spawns: 10, floor: 60 }] as const;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const neighbours = (map: KitchenMap, tile: Tile) => STEPS.map(([dc, dr]) => at(map, tile.col + dc, tile.row + dr)).filter(Boolean) as Tile[];
const at = (map: KitchenMap, col: number, row: number) => col < 0 || row < 0 || col >= map.cols || row >= map.rows ? undefined : map.tiles[row * map.cols + col];
const count = (rows: readonly string[], chars: string) => rows.join('').split('').filter(char => chars.includes(char)).length;

/** Flood fill over walkable tiles (portals jump to their pair); gates count only while open. */
function flood(map: KitchenMap, start: Tile, gatesOpen: boolean) {
  const walk = (tile: Tile) => WALKABLE.has(tile.kind) && (gatesOpen || tile.kind !== 'gate');
  const seen = new Set([start.index]), queue = [start];
  while (queue.length) {
    const tile = queue.shift()!, next = neighbours(map, tile);
    if (tile.pair !== undefined) next.push(map.tiles[tile.pair]);
    for (const other of next) if (walk(other) && !seen.has(other.index)) { seen.add(other.index); queue.push(other); }
  }
  return seen;
}
const spawnTile = (map: KitchenMap, spawn: { x: number; z: number }) => at(map, Math.floor(spawn.x + map.halfX), Math.floor(spawn.z + map.halfZ))!;
/** Follow a belt chain to the first non-belt tile; undefined when it leaves the map, hits a non-surface or loops. */
function beltEnd(map: KitchenMap, tile: Tile) {
  for (let steps = 0; tile?.kind === 'belt' && steps <= map.tiles.length; steps++) tile = at(map, tile.col + tile.dir!.x, tile.row + tile.dir!.z)!;
  return tile && tile.kind !== 'belt' && SURFACES.has(tile.kind) ? tile : undefined;
}

function checkMap(level: Level, rows: readonly string[], spec: typeof SIZES[number]) {
  const label = `${level.name} ${spec.size}`, map = parseMap(rows), tiles = map.tiles;
  assert.ok(map.cols <= spec.maxCols && map.rows <= spec.maxRows, `${label}: ${map.cols}x${map.rows} too big`);
  assert.ok(map.cols > map.rows, `${label}: should be landscape`);
  assert.ok(map.spawns.length >= spec.spawns, `${label}: ${map.spawns.length} spawns`);
  assert.ok(tiles.filter(tile => tile.kind === 'floor' || tile.kind === 'ice').length >= spec.floor, `${label}: too little floor`);
  for (const tile of tiles) {
    const edge = tile.col === 0 || tile.row === 0 || tile.col === map.cols - 1 || tile.row === map.rows - 1;
    if (edge) assert.ok(!WALKABLE.has(tile.kind), `${label}: walkable edge at ${tile.col},${tile.row}`);
  }
  for (const [col, row] of [[0, 0], [map.cols - 1, 0], [0, map.rows - 1], [map.cols - 1, map.rows - 1]]) assert.equal(rows[row][col], '#', `${label}: corner ${col},${row}`);

  // Connectivity: every walkable tile and every station can be reached from the first spawn with gates open.
  const reached = flood(map, spawnTile(map, map.spawns[0]), true);
  for (const tile of tiles) if (WALKABLE.has(tile.kind)) assert.ok(reached.has(tile.index), `${label}: unreachable ${tile.kind} at ${tile.col},${tile.row}`);
  const usable = (tile: Tile) => neighbours(map, tile).some(other => reached.has(other.index));
  rows.forEach((line, row) => [...line].forEach((char, col) => {
    const tile = at(map, col, row)!;
    // Belt tiles inside a wall are fine as long as something upstream can load them.
    const fed = tile.kind === 'belt' && tiles.some(other => other.kind === 'belt' && other.col + other.dir!.x === col && other.row + other.dir!.z === row);
    if (!WALKABLE.has(tile.kind) && tile.kind !== 'void' && char !== '#' && !fed) assert.ok(usable(tile), `${label}: ${char} at ${col},${row} has no floor beside it`);
  }));

  // Recipe stations.
  const needs = new Set<string>(['R', 'H', 'X']);
  for (const recipe of level.recipes) for (const part of RECIPES[recipe].parts) {
    needs.add('ltopbdc'['lettuce tomato onion patty bun dough cheese'.split(' ').indexOf(part.food)]);
    if (part.state === 'chopped' || (part.state === 'cooked' && part.food !== 'dough')) needs.add('C');
    if (part.state === 'cooked') needs.add(part.food === 'patty' ? 'F' : part.food === 'dough' ? 'V' : 'O');
  }
  for (const char of needs) assert.ok(count(rows, char), `${label}: needs ${char}`);
  const heat = count(rows, 'OFV');
  assert.equal(count(rows, 'E') > 0, heat > 0, `${label}: extinguisher iff stoves/ovens`);
  assert.equal(count(rows, 'W') > 0, count(rows, 'D') > 0, `${label}: sink iff dirty return`);
  for (const sink of tiles.filter(tile => tile.kind === 'sink')) {
    const near = tiles.filter(tile => tile.kind === 'rack').some(rack => Math.abs(rack.col - sink.col) + Math.abs(rack.row - sink.row) <= 4);
    assert.ok(near, `${label}: sink at ${sink.col},${sink.row} needs a rack within 4 tiles`);
  }
  assert.equal(count(rows, 'T') % 2, 0, `${label}: portals come in pairs`);
  for (const tile of tiles.filter(tile => tile.kind === 'portal')) assert.ok(neighbours(map, tile).some(other => WALKABLE.has(other.kind) && other.kind !== 'portal'), `${label}: portal exit`);
  for (const tile of tiles.filter(tile => tile.kind === 'belt')) {
    const end = beltEnd(map, tile);
    assert.ok(end && usable(end), `${label}: belt at ${tile.col},${tile.row} must end at a reachable surface`);
  }
  assert.equal(count(rows, 'g') > 0, Boolean(level.gates), `${label}: gates tiles iff gates config`);

  // Closed gates: every walkable pocket keeps a spawn and a way to pass food (shared counter or belt) to the others.
  if (level.gates) {
    const pockets: Set<number>[] = [];
    for (const tile of tiles) if (WALKABLE.has(tile.kind) && tile.kind !== 'gate' && !pockets.some(pocket => pocket.has(tile.index))) pockets.push(flood(map, tile, false));
    assert.ok(pockets.length >= 2, `${label}: closing gates should split the kitchen`);
    const pocketOf = (tile: Tile) => pockets.findIndex(pocket => neighbours(map, tile).some(other => pocket.has(other.index)));
    for (const pocket of pockets) assert.ok(map.spawns.some(spawn => pocket.has(spawnTile(map, spawn).index)), `${label}: a closed-gate pocket has no spawn`);
    const linked = new Set([0]);
    for (let changed = true; changed;) {
      changed = false;
      for (const tile of tiles.filter(tile => SURFACES.has(tile.kind))) {
        const sides = pockets.map((pocket, index) => neighbours(map, tile).some(other => pocket.has(other.index)) ? index : -1).filter(index => index >= 0);
        const end = tile.kind === 'belt' ? beltEnd(map, tile) : undefined;
        if (end) sides.push(pocketOf(end));
        if (sides.some(index => linked.has(index)) && sides.some(index => !linked.has(index))) { sides.forEach(index => linked.add(index)); changed = true; }
      }
    }
    assert.equal(linked.size, pockets.length, `${label}: closed-gate pockets must share counters or belts`);
    assert.ok(level.gates.open > level.gates.warn && level.gates.warn > 0 && level.gates.closed > 0, `${label}: gate timing`);
  }
  return map;
}

test('eight levels with unique ids, a menu, patience and rising star targets', () => {
  assert.equal(LEVELS.length, 8);
  assert.equal(new Set(LEVELS.map(level => level.id)).size, LEVELS.length);
  for (const level of LEVELS) {
    assert.ok(level.recipes.length >= 2 && level.patience > 0 && level.blurb.length > 20, level.name);
    assert.ok(level.stars[0] > 0 && level.stars[0] < level.stars[1] && level.stars[1] < level.stars[2], `${level.name} stars`);
  }
});

test('every kitchen map is valid, reachable and stocked for its menu', () => {
  for (const level of LEVELS) {
    const small = checkMap(level, level.small, SIZES[0]), large = checkMap(level, level.large, SIZES[1]);
    // Large kitchens scale stations with the crew rather than just adding floor.
    for (const chars of ['C', 'OF', 'V', 'W', 'lptobdc', 'R']) assert.ok(count(level.large, chars) >= count(level.small, chars), `${level.name}: large has fewer ${chars}`);
    assert.ok(count(level.large, 'COFVW') > count(level.small, 'COFVW'), `${level.name}: large needs more stations`);
    assert.ok(large.cols * large.rows > small.cols * small.rows, `${level.name}: large is bigger`);
  }
});

test('kitchenMap picks the small map up to four chefs and caches it', () => {
  LEVELS.forEach((level, index) => {
    assert.equal(kitchenMap(index, 1).cols, level.small[0].length);
    assert.equal(kitchenMap(index, 4), kitchenMap(index, 1));
    assert.equal(kitchenMap(index, 5).cols, level.large[0].length);
    assert.equal(kitchenMap(index, 10), kitchenMap(index, 5));
  });
});

test('star thresholds are positive, ordered and grow with crew size and service length', () => {
  LEVELS.forEach((_, index) => {
    for (const seconds of [150, 180, 240]) {
      let previous = [0, 0, 0];
      for (let players = 1; players <= 10; players++) {
        const stars = starThresholds(index, players, seconds);
        assert.ok(stars[0] > 0 && stars[0] < stars[1] && stars[1] < stars[2], `${index} ${players} ${seconds}`);
        assert.ok(stars.every((score, star) => score >= previous[star]), `${index}: stars drop at ${players} chefs`);
        previous = stars;
      }
    }
    assert.ok(starThresholds(index, 2, 240)[2] > starThresholds(index, 2, 150)[2]);
    assert.deepEqual(starThresholds(index, 2, 180), LEVELS[index].stars);
  });
  for (let players = 2; players <= 10; players++) assert.ok(crewScale(players) > crewScale(players - 1));
});

test('every kitchen is playable end to end: bot crews earn a star on both maps of every level', () => {
  for (let level = 0; level < LEVELS.length; level++) for (const players of [2, 6]) {
    const s = setup(null, { players, seed: 3 + level, settings: { level } });
    while (!s.complete) { const v = rules.publicView(s, { nowMs: s.now, phase: 'playing' }); rules.tick(s, new Map(s.players.map(c => [c.id, botInput(v, s.map, c.id)])), DT, s.now + DT * 1000); }
    assert.ok(s.stars >= 1, `${LEVELS[level].name} with ${players} bots: ${s.served} served, ${s.failed} failed, score ${s.score} of ${s.thresholds}`);
  }
});
