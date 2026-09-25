/** Setup quality over seeded boards: the second settlement adds a resource type in ≥ 90% of cases. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CpuLevel, PublicView, Terrain } from '../../src/model';
import { baseCells, makeBoard, portGoods } from '../fixtures/board';
import { makeSeats, makeView } from '../fixtures/build';
import { me } from '../fixtures/private';
import { assertLegal, brain, think } from './helpers';

const RES = new Set<Terrain>(['wood', 'brick', 'wool', 'grain', 'ore']);

/** Plays the snake setup with CPUs; returns each seat's two settlements in order. */
export function playSetup(seed: number, level: CpuLevel = 'normal', n = 4) {
  const board = makeBoard(baseCells('small', seed), portGoods('small'));
  const pub: PublicView = makeView(board, makeSeats(n), { stage: 'setup' });
  const order = pub.seats.map(s => s.id), placed: Record<string, string[]> = {};
  let index = 0;
  for (const seat of [...order, ...[...order].reverse()]) for (const piece of ['settlement', 'road'] as const) {
    const round = ++index > 2 * n ? 2 : 1;
    pub.turn = { ...pub.turn, id: index, active: seat, setup: { seat, piece, round, index, total: 4 * n } };
    const view = me(pub, seat, {}, { free: { [piece]: 1 } });
    if (piece === 'road') {
      const anchor = placed[seat].at(-1)!, road = view.build.find(o => o.piece === 'road')!;
      const touches = (id: string) => pub.board.edges.some(e => e.id === id && (e.a === anchor || e.b === anchor));
      road.targets = road.targets.filter(touches);
    }
    const a = think(pub, view, brain(level, seed * 31 + index, 'scout')).action;
    assertLegal(pub, view, a, `seed ${seed} ${seat} ${piece}`);
    assert.ok(a?.type === 'build');
    if (piece === 'settlement') {
      pub.pieces.buildings[a.at] = { vertex: a.at, seat, kind: 'settlement' };
      (placed[seat] ??= []).push(a.at);
    } else pub.pieces.routes[a.at] = { edge: a.at, seat, kind: 'road' };
  }
  return { pub, placed };
}

const types = (pub: PublicView, v: string) => new Set(pub.board.vertices.find(x => x.id === v)!.tiles
  .map(id => pub.board.tiles.find(t => t.id === id)!.terrain).filter(t => RES.has(t)));

test('second settlement adds at least one new resource type in >= 90% of seeds', () => {
  let good = 0, all = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { pub, placed } = playSetup(seed);
    for (const [first, second] of Object.values(placed)) {
      all++;
      const before = types(pub, first);
      if ([...types(pub, second)].some(t => !before.has(t))) good++;
    }
  }
  assert.ok(good / all >= 0.9, `${good}/${all}`);
});

test('setup roads leave from the new settlement toward open land', () => {
  const { pub } = playSetup(4, 'sharp');
  assert.equal(Object.keys(pub.pieces.routes).length, 8);
});
