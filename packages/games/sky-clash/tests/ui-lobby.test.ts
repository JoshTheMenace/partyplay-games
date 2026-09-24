import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, ROSTER, type FighterView } from '../src/model';
import { STAGE_IDS } from '../src/stages';
import { FIGHTER_ORDER, SERIES, damageColor, fallbackCostumes, fighterStats, filterFighters, formatClock } from '../src/ui/data';
import { EMPTY_CHOICE, cpuCount, firstStep, isComplete, leaders, pickCostume, pickFighter, pickStage, readChoice, readSettings, readyChoice, takenCostumes, voteCounts } from '../src/ui/lobby-choice';
import { finishWord, highlight, koItems, placements, seats } from '../src/ui/standings';
test('the select screen lists all 33 fighters exactly once, grouped by series', () => {
  assert.equal(FIGHTER_ORDER.length, 33); assert.deepEqual([...FIGHTER_ORDER].sort(), [...ROSTER].sort());
  assert.equal(SERIES.reduce((n, s) => n + s.fighters.length, 0), ROSTER.length);
  assert.deepEqual(filterFighters('', 'starfox'), ['fox', 'falco']);
  assert.deepEqual(filterFighters('falcon punch'), ['captain-falcon'], 'search matches special names');
  assert.ok(filterFighters('pok').includes('mewtwo'), 'search matches series'); assert.deepEqual(filterFighters('zzz'), []);
});
test('fighter stats come from Melee attributes on a 1–5 scale', () => {
  const bowser = fighterStats('bowser'), puff = fighterStats('jigglypuff'), fox = fighterStats('fox');
  assert.equal(bowser.weight, 117); assert.equal(bowser.bars.weight, 5); assert.equal(fighterStats('pichu').bars.weight, 1);
  assert.equal(puff.jumps, 6); assert.equal(fox.jumps, 2); assert.ok(fox.bars.fall > puff.bars.fall); assert.ok(fighterStats('captain-falcon').bars.speed >= 4);
  for (const kind of ROSTER) for (const v of Object.values(fighterStats(kind).bars)) assert.ok(v >= 1 && v <= 5, kind);
  assert.equal(fallbackCostumes('mario').length, 4);
});
test('readChoice sanitizes drafts from the public roster', () => {
  assert.deepEqual(readChoice(undefined), EMPTY_CHOICE);
  assert.deepEqual(readChoice({ fighter: 'marth', costume: 3, stage: 'battlefield' }), { fighter: 'marth', costume: 3, stage: 'battlefield' });
  assert.deepEqual(readChoice({ fighter: 'blaze', costume: 9, stage: 'nowhere' }), EMPTY_CHOICE);
  assert.deepEqual(readChoice({ fighter: 'random', costume: 2, stage: 'random' }), { fighter: 'random', costume: 0, stage: 'random' });
});
test('pick helpers keep drafts coherent and a reload resumes on the right step', () => {
  let c = pickFighter(EMPTY_CHOICE, 'sheik'); assert.equal(firstStep(c, true), 'stage'); assert.equal(firstStep(c, false), 'fighter'); assert.equal(isComplete(c), false);
  c = pickCostume(c, 2); assert.equal(c.costume, 2);
  assert.equal(pickFighter(c, 'sheik').costume, 2, 'same fighter keeps the costume'); assert.equal(pickFighter(c, 'pichu').costume, 0, 'a new fighter starts at default');
  assert.equal(pickCostume(pickFighter(c, 'random'), 3).costume, 0, 'Random has no costume');
  assert.deepEqual(readyChoice(c, false).stage, 'random', 'a fixed-stage lobby still sends a complete choice'); assert.equal(readyChoice(c, true), c);
  c = pickStage(c, 'final-destination'); assert.equal(isComplete(c), true); assert.equal(firstStep(EMPTY_CHOICE, true), 'fighter');
});
test('vote counts, leaders and taken costumes come from every seat', () => {
  const seats = [{ id: 'a', lobbyChoice: { fighter: 'fox', costume: 1, stage: 'battlefield' } }, { id: 'b', lobbyChoice: { fighter: 'fox', costume: 0, stage: 'battlefield' } }, { id: 'c', lobbyChoice: { fighter: null, costume: 0, stage: 'random' } }, { id: 'd' }];
  const v = voteCounts(seats);
  assert.equal(v.battlefield, 2); assert.equal(v.random, 1); assert.equal(v.cloudbreak, 0); assert.equal(Object.keys(v).length, STAGE_IDS.length + 1);
  assert.deepEqual(leaders(seats), ['battlefield']); assert.deepEqual(leaders([]), []);
  assert.deepEqual(leaders([{ id: 'x', lobbyChoice: { stage: 'onett' } }, { id: 'y', lobbyChoice: { stage: 'fourside' } }]).sort(), ['fourside', 'onett']);
  assert.deepEqual([...takenCostumes(seats, 'a', 'fox')], [0]); assert.equal(takenCostumes(seats, 'a', 'random').size, 0);
});
test('settings defaults and CPU counts match the design', () => {
  assert.deepEqual(readSettings({}), DEFAULT_SETTINGS); assert.equal(readSettings({ cpuLevel: 9 }).cpuLevel, 2);
  assert.equal(cpuCount(1, DEFAULT_SETTINGS), 1, 'a lone human gets a rival'); assert.equal(cpuCount(2, DEFAULT_SETTINGS), 0);
  assert.equal(cpuCount(3, { ...DEFAULT_SETTINGS, cpus: 3 }), 1, 'capped at four fighters'); assert.equal(cpuCount(4, { ...DEFAULT_SETTINGS, cpus: 3 }), 0);
});
const fv = (id: string, stocks: number, damage: number, extra: Partial<FighterView> = {}) => ({ id, name: id, stocks, damage, kos: 0, falls: 0, team: null, ...extra }) as FighterView;
test('placements rank survivors by stocks then damage, share ties and honor engine ranks', () => {
  const rows = placements({ fighters: [fv('a', 0, 50, { kos: 1 }), fv('b', 2, 80), fv('c', 2, 30), fv('d', 0, 10, { kos: 1 })] });
  assert.deepEqual(rows.map(r => [r.f.id, r.place]), [['c', 1], ['b', 2], ['a', 3], ['d', 3]]);
  assert.equal(placements({ fighters: [fv('a', 0, 0), fv('b', 1, 0)] }, new Map([['a', 1], ['b', 2]]))[0].f.id, 'a');
  assert.deepEqual(placements({ fighters: [fv('a', 1, 90), fv('b', 3, 0), fv('c', 2, 0)] }, new Map([['a', 1], ['b', 1], ['c', 3]])).map(r => r.place), [1, 1, 3], 'engine ranks decide alone: a team shares first');
  assert.deepEqual(placements(seats({ fighters: [fv('p0', 1, 20), fv('p0+nana', 1, 5, { partner: 'p0' }), fv('p1', 1, 10)] })).map(r => r.f.id), ['p1', 'p0'], 'Ice Climbers partners get no card or row');
});
test('finish banner, KO feed and highlight read the right story', () => {
  assert.equal(finishWord({ teams: false, fighters: [fv('a', 1, 0), fv('b', 0, 0)] }), 'GAME!');
  assert.equal(finishWord({ teams: false, fighters: [fv('a', 1, 0), fv('b', 2, 0)] }), 'TIME!');
  assert.equal(finishWord({ teams: true, fighters: [fv('a', 1, 0, { team: 0 }), fv('b', 2, 0, { team: 0 }), fv('c', 0, 0, { team: 1 })] }), 'GAME!');
  const fighters = [fv('a', 2, 40, { kos: 3 }), fv('b', 0, 0, { falls: 4 })], view = { fighters } as never;
  const feed = koItems(view, [{ id: 1, kind: 'ko', frame: 9, x: 0, y: 0, source: 'a', target: 'b' }, { id: 2, kind: 'hit', frame: 9, x: 0, y: 0, target: 'b' }, { id: 3, kind: 'star-ko', frame: 9, x: 0, y: 0, target: 'b', source: 'b' }]);
  assert.deepEqual(feed.map(f => [f.id, f.source?.id, f.star]), [[1, 'a', true]], 'a top KO (ko + star-ko on one frame) is one starred line');
  assert.equal(koItems(view, [{ id: 4, kind: 'ko', frame: 12, x: 0, y: 0, target: 'b' }])[0]!.star, false);
  assert.match(highlight(fighters, [fighters[0]]), /Flawless/); assert.match(highlight([fv('a', 1, 0, { falls: 1, kos: 3 }), fv('b', 0, 0, { kos: 1 })], []), /KO machine/);
});
test('damage color climbs white → yellow → red, and clocks format as m:ss', () => {
  assert.equal(damageColor(0), 'rgb(255 250 240)'); assert.equal(damageColor(999), damageColor(240));
  const g = (d: number) => Number(damageColor(d).split(' ')[1]); assert.ok(g(0) > g(60) && g(60) > g(120) && g(120) > g(200));
  assert.equal(formatClock(480_000), '8:00'); assert.equal(formatClock(59_001), '1:00'); assert.equal(formatClock(-5), '0:00');
});
