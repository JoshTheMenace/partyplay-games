import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearDraft, readDraft, saveDraft } from '../src/draft';
import type { Draft } from '../src/draft';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const draft: Draft = { drawing: { strokes: [{ color: '#05071a', width: 0.012, points: [{ x: 0.2, y: 0.3 }] }] }, slogan: 'A draft worth saving', selection: { artId: 'art-0-1', sloganId: 'slogan-1-2', color: 'coral' } };
test('browser draft survives reload for the same task and cannot spill into another round or seat', () => {
  const store = storage(); saveDraft(store, 'shirt-show:draft:room:p0', 'round:task', draft);
  assert.deepEqual(readDraft(store, 'shirt-show:draft:room:p0', 'round:task'), draft);
  assert.equal(readDraft(store, 'shirt-show:draft:room:p0', 'next-round:task'), null);
  assert.equal(readDraft(store, 'shirt-show:draft:room:p1', 'round:task'), null);
});
test('corrupted, oversized or remote-image browser drafts are discarded', () => {
  const store = storage();
  for (const raw of ['{', 'x'.repeat(32769), JSON.stringify({ turnId: 'turn', revision: 0, value: { ...draft, drawing: { src: 'https://image' } } }), JSON.stringify({ turnId: 'turn', revision: 0, value: { ...draft, slogan: 'x'.repeat(73) } }), JSON.stringify({ turnId: 'turn', revision: 0, value: { ...draft, selection: { ...draft.selection, color: 'url(https://remote)' } } })]) {
    store.setItem('key', raw); assert.equal(readDraft(store, 'key', 'turn'), null);
  }
});
test('newer server drafts outrank stale local edits and late acknowledgements preserve the next task', () => {
  const store = storage(); saveDraft(store, 'key', 'turn', draft, 2);
  assert.deepEqual(readDraft(store, 'key', 'turn', 2), draft);
  assert.equal(readDraft(store, 'key', 'turn', 3), null);
  saveDraft(store, 'key', 'next-turn', draft);
  clearDraft(store, 'key', 'turn'); assert.deepEqual(readDraft(store, 'key', 'next-turn'), draft);
  clearDraft(store, 'key', 'next-turn'); assert.equal(readDraft(store, 'key', 'next-turn'), null);
});
test('storage denial is recoverable and does not break the controller', () => {
  const store = { getItem(): never { throw Error('denied'); }, setItem(): never { throw Error('denied'); }, removeItem() {} };
  assert.equal(readDraft(store, 'key', 'turn'), null);
  assert.doesNotThrow(() => saveDraft(store, 'key', 'turn', draft));
});
