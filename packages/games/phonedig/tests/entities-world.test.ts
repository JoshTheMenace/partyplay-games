import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as entities from '../src/entities';
import * as vfx from '../src/vfx';

test('the same world keeps live effects across rebuilt render states', () => {
  entities.reset();
  entities.syncWorld('9/1/null/2', 1);
  vfx.emit('pop', 4, 4);
  const live = vfx.count();
  assert.ok(live > 0);
  assert.equal(entities.syncWorld('9/1/null/2', 1), false);
  assert.equal(vfx.count(), live);
});

test('a new world clears old effects before its own events are emitted', () => {
  entities.reset();
  entities.syncWorld('9/1/null/2', 1);
  vfx.emit('pop', 4, 4);
  assert.equal(entities.syncWorld('10/1/null/2', 1), true);
  assert.equal(vfx.count(), 0);
  vfx.emit('pop', 4, 4);
  assert.ok(vfx.count() > 0);
  assert.equal(entities.syncWorld('10/1/null/2', 1), false);
  assert.ok(vfx.count() > 0, 'the new world keeps its first effects');
});

test('a new level serial clears effects', () => {
  entities.reset();
  entities.syncWorld('9/1/null/2', 1);
  vfx.emit('pop', 4, 4);
  assert.equal(entities.syncWorld('9/1/null/2', 2), true);
  assert.equal(vfx.count(), 0);
});
