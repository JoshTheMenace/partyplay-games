import { strict as assert } from 'node:assert';
import test from 'node:test';
import { blend, type DecodedView } from '../src/viewstate';

type Player = DecodedView['players'][number];
type Wheel = DecodedView['wheels'][number];

const view = (over: Partial<DecodedView>) => ({
  runSeed: 9, level: 3, entryLc: null, lanes: 2, revision: 10,
  players: [], monsters: [], rocks: [], wheels: [], ...over,
}) as unknown as DecodedView;
const player = (x: number, y: number) => ({ id: 'p1', x, y }) as Player;
const wheel = (x: number, travel: number) => ({ id: 1, x, y: 5, dir: 1, travel }) as Wheel;

test('digging between snapshots keeps players moving smoothly', () => {
  const a = view({ revision: 10, players: [player(4, 10)] });
  const b = view({ revision: 11, players: [player(5, 10)] });
  const shown = blend(a, b, 0.5);
  assert.equal(shown.players[0].x, 4.5);
  assert.equal(shown.revision, 11);
});

test('monsters and rocks keep interpolating while terrain changes', () => {
  const a = view({ revision: 1, monsters: [{ id: 2, x: 0, y: 0 }], rocks: [{ id: 3, x: 0, y: 4 }] } as Partial<DecodedView>);
  const b = view({ revision: 2, monsters: [{ id: 2, x: 2, y: 0 }], rocks: [{ id: 3, x: 0, y: 6 }] } as Partial<DecodedView>);
  const shown = blend(a, b, 0.25);
  assert.equal(shown.monsters[0].x, 0.5);
  assert.equal(shown.rocks[0].y, 4.5);
});

test('rolling wheels interpolate position and travel', () => {
  const shown = blend(view({ wheels: [wheel(2, 3)] }), view({ wheels: [wheel(4, 5)] }), 0.5);
  assert.equal(shown.wheels[0].x, 3);
  assert.equal(shown.wheels[0].travel, 4);
});

test('a new level or a new run snaps to the newer snapshot', () => {
  const a = view({ players: [player(4, 10)] });
  const nextLevel = view({ level: 4, players: [player(4, 90)] });
  const nextRun = view({ runSeed: 10, players: [player(4, 90)] });
  assert.equal(blend(a, nextLevel, 0.5), nextLevel);
  assert.equal(blend(a, nextRun, 0.5), nextRun);
});

test('an entity that jumps a long way snaps instead of sliding', () => {
  const shown = blend(view({ players: [player(4, 10)] }), view({ players: [player(30, 80)] }), 0.5);
  assert.equal(shown.players[0].x, 30);
  assert.equal(shown.players[0].y, 80);
});
