import test from 'node:test';
import assert from 'node:assert/strict';
import { readDraft, saveDraft } from '../src/draft';
function storage() { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } }; }
test('answer and vote drafts survive reload only for the same seat and phase', () => {
  const store = storage();
  saveDraft(store, 'seat-a', 'round:1:answer', { value: 'pancakes' });
  assert.deepEqual(readDraft(store, 'seat-a', 'round:1:answer'), { value: 'pancakes', target: undefined });
  assert.deepEqual(readDraft(store, 'seat-b', 'round:1:answer'), { value: '' });
  assert.deepEqual(readDraft(store, 'seat-a', 'round:2:answer'), { value: '' });
  assert.deepEqual(readDraft(store, 'seat-a', 'round:1:vote'), { value: '' });
  saveDraft(store, 'seat-a', 'round:1:vote', { value: '', target: null });
  assert.deepEqual(readDraft(store, 'seat-a', 'round:1:vote'), { value: '', target: null });
  saveDraft(store, 'seat-a', 'round:1:vote', { value: '', target: 'seat-b' });
  assert.equal(readDraft(store, 'seat-a', 'round:1:vote').target, 'seat-b');
  saveDraft(store, 'seat-a', 'round:1:answer', null);
  assert.equal(readDraft(store, 'seat-a', 'round:1:vote').target, 'seat-b', 'a delayed answer acknowledgement must not erase the newer vote draft');
  saveDraft(store, 'seat-a', 'round:1:vote', null);
  assert.deepEqual(readDraft(store, 'seat-a', 'round:1:vote'), { value: '' });
});
test('malformed or blocked draft storage never stops play', () => {
  const store = storage();
  for (const value of ['not json', 'null', '{}', JSON.stringify({ turnId: 't', value: 'x'.repeat(49) }), JSON.stringify({ turnId: 't', value: 'ok', target: 42 })]) {
    store.setItem('seat', value); assert.deepEqual(readDraft(store, 'seat', 't'), { value: '' });
  }
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); }, removeItem() { throw new Error('Blocked'); } };
  assert.deepEqual(readDraft(blocked, 'seat', 't'), { value: '' });
  assert.doesNotThrow(() => saveDraft(blocked, 'seat', 't', { value: 'hi' }));
  assert.doesNotThrow(() => saveDraft(blocked, 'seat', 't', null));
});
