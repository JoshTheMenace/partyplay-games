import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGraphicsQuality } from '../src/preferences';
test('graphics preferences tolerate missing, corrupt and blocked storage without stopping scene startup', () => { assert.equal(readGraphicsQuality({ getItem: () => 'low' }), 'low'); assert.equal(readGraphicsQuality({ getItem: () => 'unknown' }), 'balanced'); assert.equal(readGraphicsQuality({ getItem: () => null }), 'balanced'); assert.equal(readGraphicsQuality({ getItem() { throw new Error('Storage blocked'); } }), 'balanced'); });
