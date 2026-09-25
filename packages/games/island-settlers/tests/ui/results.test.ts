import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadFixture, outcomeOf } from '../fixtures/index';
import { buildColumns, buildRows, diceBars, leaders, points, rankText } from '../../src/ui/results/data';
import { Hero } from '../../src/ui/results/Hero';
import { Awards } from '../../src/ui/results/SeatStats';
import { hasDevCards } from '../../src/ui/shared/labels';
import { Standings } from '../../src/ui/results/Standings';

const ended = () => {
  const pub = loadFixture('ended-6').pub;
  return { pub, outcome: outcomeOf(pub) };
};

test('each row: the score columns sum to its total, hidden VP included', () => {
  const { pub, outcome } = ended();
  const rows = buildRows(pub, outcome, 'p2'), columns = buildColumns(rows);
  assert.equal(rows.length, 6);
  assert.ok(columns.some(c => c.key === 'vp-cards'));
  for (const row of rows) assert.equal(columns.reduce((sum, c) => sum + points(row.parts!, c), 0), row.vp);
  assert.deepEqual(rows.map(r => r.rank), rows.map(r => r.rank).sort((a, b) => a - b));
  assert.ok(rows.find(r => r.seat === 'p2')?.winner && rows.find(r => r.seat === 'p2')?.you);
});

test('module parts get one column per key; unused core awards are dropped', () => {
  const { pub, outcome } = ended();
  const metro = (label: string) => ({ key: 'metropolis', label, points: 2, count: 1 });
  pub.results!.standings[0].parts.push(metro('Science metropolis'));
  pub.results!.standings[1].parts.push(metro('Trade metropolis'));
  const keys = buildColumns(buildRows(pub, outcome, null)).map(c => c.key);
  assert.ok(keys.includes('metropolis') && keys.includes('settlements') && keys.includes('cities'));
  const metropolis = buildColumns(buildRows(pub, outcome, null)).find(c => c.key === 'metropolis');
  assert.equal(metropolis?.label, 'Metropolis');
});

test('without results the Outcome alone drives a compact standings table', () => {
  const pub = loadFixture('max-10').pub, outcome = outcomeOf(pub);
  const rows = buildRows(pub, outcome, null);
  assert.equal(rows.length, 10);
  assert.ok(rows.every(r => r.parts === null && r.name !== 'Player'));
  const table = createElement(Standings, { rows, columns: buildColumns(rows), compact: false });
  const html = renderToStaticMarkup(table);
  assert.equal((html.match(/<tr/g) ?? []).length, 11);
  assert.ok(!html.includes('Settlements') && html.includes('#10'));
  assert.ok(renderToStaticMarkup(createElement(Hero, { pub, rows })).includes('Game over'));
});

test('ties share a rank marker and shared winners all appear in the hero', () => {
  const { pub, outcome } = ended();
  pub.results!.winners = ['p2', 'p4'];
  const rows = buildRows(pub, outcome, null).map(r => (r.seat === 'p4' ? { ...r, rank: 1 } : r));
  assert.equal(rankText(rows.find(r => r.seat === 'p4')!, rows), '=1');
  const hero = renderToStaticMarkup(createElement(Hero, { pub, rows }));
  assert.ok(hero.includes('Shared victory') && hero.includes('VP each'));
  assert.equal((hero.match(/<h1/g) ?? []).length, 2);
});

test('dice expectations and record leaders', () => {
  const bars = diceBars([0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
  assert.equal(bars.length, 11);
  assert.ok(Math.abs(bars.reduce((s, b) => s + b.expected, 0) - 36) < 1e-9);
  assert.equal(bars[5].expected, 6);
  const { pub, outcome } = ended(), rows = buildRows(pub, outcome, null);
  const top = leaders(pub.results!.stats, rows, s => s.knights);
  assert.equal(top.value, 4);
  assert.deepEqual(leaders(pub.results!.stats, rows, () => 0).rows, []);
});

test('modes without dev cards drop the dev-knight record', () => {
  const { pub, outcome } = ended(), rows = buildRows(pub, outcome, null), stats = pub.results!.stats;
  assert.deepEqual([hasDevCards(pub), hasDevCards(loadFixture('ck-4').pub)], [true, false]);
  const html = (dev: boolean) => renderToStaticMarkup(createElement(Awards, { rows, stats, dev }));
  assert.match(html(true), /Most knights played/);
  assert.doesNotMatch(html(false), /Most knights played/);
});
