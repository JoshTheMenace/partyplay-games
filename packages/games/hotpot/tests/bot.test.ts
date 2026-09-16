import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDraw, chooseDiscard, handValue } from '../src/bot';
test('bots take a public discard that completes their own hand', () => {
  const hand = [1,2,3,4,4,4,7,8]; assert.equal(chooseDraw(hand, [[12],[9],[],[18]]), 1);
  assert.equal(handValue([...hand,9]), 300);
});
test('bots preserve complete sets instead of throwing cards away at random', () => {
  for (const random of [0,.5,.999]) assert.equal(chooseDiscard([1,2,3,4,4,4,7,8,24], random), 24);
  assert.equal(chooseDraw([1,2,3,4,4,4,7,8], [[],[],[],[]]), 'deck');
});

test('bots do not recycle a discarded pair card, but still take a winning own discard', () => {
  const nine = [1,2,3,4,5,7,8,10,11], discarded = chooseDiscard(nine, 0);
  const hand = nine.filter(id => id !== discarded);
  assert.equal(chooseDraw(hand, [[discarded],[],[],[]], 0), 'deck');
  assert.equal(chooseDraw([1,2,3,4,5,6,7,8], [[9],[],[],[]], 0), 0);
});
