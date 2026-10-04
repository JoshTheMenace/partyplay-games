import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as deck from '../src/deck.server';
import { FIGURES, TEXT_MAX, type Card, type CardKind } from '../src/types';

const banks: [CardKind, readonly Card[], number, number][] = [['innocent', deck.INNOCENT, 120, 90], ['guilty', deck.GUILTY, 90, 68], ['modifier', deck.MODIFIERS, 120, 90]];

test('deck exports only the three banks', () => assert.deepEqual(Object.keys(deck).sort(), ['GUILTY', 'INNOCENT', 'MODIFIERS']));

for (const [kind, bank, min, mild] of banks) test(`${kind} bank meets the card contract`, () => {
  assert.ok(bank.length >= min, `${kind}: ${bank.length} < ${min}`);
  assert.ok(bank.filter(c => !c.spicy).length >= mild, `${kind}: too few mild cards`);
  assert.equal(new Set(bank.map(c => c.id)).size, bank.length);
  assert.equal(new Set(bank.map(c => c.text.toLowerCase())).size, bank.length, `${kind}: duplicate text`);
  let last = 0;
  for (const c of bank) {
    const where = `${c.id} "${c.text}"`, n = Number(c.id.slice(1));
    assert.match(c.id, new RegExp(`^${kind[0]}\\d{3}$`), where); assert.ok(n > last, `${where}: ids must ascend`); last = n;
    assert.equal(c.kind, kind, where);
    assert.deepEqual(Object.keys(c).filter(k => !['id', 'kind', 'text', 'figure', 'spicy'].includes(k)), [], where);
    assert.ok(c.text.length > 0 && c.text === c.text.trim() && c.text.length <= TEXT_MAX[kind], where);
    assert.ok(!/[.]$/.test(c.text), `${where}: no final period`);
    assert.ok(c.spicy === undefined || c.spicy === true, where);
    if (kind === 'modifier') { assert.equal(c.figure, undefined, where); assert.match(c.text, /^[a-z]/, `${where}: twists begin in lowercase`); }
    else assert.ok(FIGURES.includes(c.figure!), `${where}: figure required`);
  }
});
