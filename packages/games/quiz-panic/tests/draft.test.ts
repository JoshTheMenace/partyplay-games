import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDraft, readDraft, saveDraft, type DraftScope } from '../src/draft';
const scope: DraftScope = { roomId: 'room', roundId: 'round', playerId: 'p0', turnId: 'turn', family: 'memory' };
function memoryStorage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}
test('partial memory sequences and numeric estimates survive a fresh read after reload', () => {
  const storage = memoryStorage();
  saveDraft(storage, scope, { sequence: [2, 0], estimate: '' });
  assert.deepEqual(readDraft(storage, scope), { sequence: [2, 0], estimate: '' });
  const estimateScope = { ...scope, family: 'estimate' as const };
  saveDraft(storage, estimateScope, { sequence: [], estimate: '007' });
  assert.deepEqual(readDraft(storage, estimateScope), { sequence: [], estimate: '007' });
});
test('room, player, round, turn and family boundaries prevent cross-seat or stale draft restoration', () => {
  const storage = memoryStorage(); saveDraft(storage, scope, { sequence: [1], estimate: '' });
  for (const different of [{ roomId: 'other' }, { playerId: 'p1' }, { roundId: 'rematch' }, { turnId: 'later' }, { family: 'estimate' as const }]) assert.equal(readDraft(storage, { ...scope, ...different }), null);
  saveDraft(storage, { ...scope, playerId: 'p1' }, { sequence: [3], estimate: '' });
  assert.deepEqual(readDraft(storage, scope)?.sequence, [1]);
  assert.deepEqual(readDraft(storage, { ...scope, playerId: 'p1' })?.sequence, [3]);
});
test('acceptance clears the current draft but a delayed old acknowledgement cannot clear the next phase', () => {
  const storage = memoryStorage(); saveDraft(storage, scope, { sequence: [1, 2], estimate: '' });
  clearDraft(storage, scope); assert.equal(readDraft(storage, scope), null);
  const later = { ...scope, turnId: 'next' }; saveDraft(storage, later, { sequence: [0], estimate: '' });
  clearDraft(storage, scope); assert.deepEqual(readDraft(storage, later)?.sequence, [0]);
});
test('malformed cache, out-of-range symbols and oversized sequences cannot restore', () => {
  const storage = memoryStorage(); saveDraft(storage, scope, { sequence: [], estimate: '' });
  const key = [...storage.items.keys()][0];
  for (const raw of ['{', 'null', JSON.stringify({ ...scope, sequence: [4], estimate: '' }), JSON.stringify({ ...scope, sequence: [1.2], estimate: '' }), JSON.stringify({ ...scope, sequence: [0, 0, 0, 0, 0, 0], estimate: '' }), JSON.stringify({ ...scope, sequence: [], estimate: '1e2' }), JSON.stringify({ ...scope, sequence: [], estimate: '1000' }), ' '.repeat(1001)]) {
    storage.setItem(key, raw); assert.equal(readDraft(storage, scope), null);
  }
  saveDraft(storage, scope, { sequence: [0, 1, 2, 3, 0], estimate: '' });
  assert.equal(readDraft(storage, scope, 4), null); assert.equal(readDraft(storage, scope, 5)?.sequence.length, 5);
});
test('unavailable browser storage is optional and never interrupts editing', () => {
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); }, removeItem() { throw new Error('Denied'); } };
  assert.equal(readDraft(denied, scope), null);
  assert.doesNotThrow(() => saveDraft(denied, scope, { sequence: [1], estimate: '' }));
  assert.doesNotThrow(() => clearDraft(denied, scope));
});
