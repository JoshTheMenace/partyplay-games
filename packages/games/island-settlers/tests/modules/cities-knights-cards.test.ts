/** Cities & Knights progress cards: deck composition and every card played through its command. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACKS, type ProgressKind } from '../../src/model';
import { DECKS, ck, sx } from '../../src/engine/modules/cities-knights/state';
import { placeUnit, setRobber } from '../../src/engine/pieces';
import { rates } from '../../src/engine/trade';
import type { State } from '../../src/engine/state';
import { act, answer, command, edit, game, inventory, rig, unchanged, view } from '../helpers';
import { blank, give, hand, ix, lay, settle, toMain, trail } from '../rules/helpers';

type Kind = ProgressKind;

function stage() {
  const s = blank(game(4, { citiesKnights: true }));
  edit(s, n => { ck(n).position = 0; });
  toMain(s);
  edit(s, n => { ck(n).position = 0; });
  const [a, b, c] = [s.turn.active!, ...s.order.filter(id => id !== s.turn.active)];
  return { s, a, b, c };
}

/** Put `kind` in the seat's hand; returns its play command id. */
function hold(s: State, seat: string, kind: Kind) {
  const track = TRACKS.find(t => DECKS[t].some(([k]) => k === kind))!, id = `card-${kind}-${s.serial}`;
  edit(s, n => { sx(n, seat).progress.push({ id, kind, track }); });
  return `ck:play:${id}`;
}

const play = (s: State, seat: string, kind: Kind, picks: Record<string, string> = {}) =>
  command(s, seat, hold(s, seat, kind), picks);

const vertexOn = (s: State, terrain: string) => s.board.vertices.find(v => v.tiles.length === 3
  && v.tiles.some(t => ix(s).tile.get(t)!.terrain === terrain))!.id;

const knight = (s: State, seat: string, at: string, level = 1, active = false, id = `k-${at}`) =>
  edit(s, n => placeUnit(n, { id, kind: 'knight', seat, at, level, active, cargo: [] }));

test('three decks of 18 with every progress kind', () => {
  const kinds = TRACKS.flatMap(t => DECKS[t].map(([k]) => k));
  assert.equal(new Set(kinds).size, 25);
  for (const t of TRACKS) assert.equal(DECKS[t].reduce((n, [, c]) => n + c, 0), 18);
  const s = game(4, { citiesKnights: true });
  assert.deepEqual(TRACKS.map(t => ck(s).decks[t].length), [18, 18, 18]);
  assert.equal(game(8, { citiesKnights: true }).ext['cities-knights'] && ck(game(8, { citiesKnights: true }))
    .decks.trade.length, 36, '7+ seats double the decks');
});

test('science: Alchemist sets the dice before rolling; played cards go under their deck', () => {
  const s = blank(game(4, { citiesKnights: true })), a = s.turn.active!;
  const id = hold(s, a, 'alchemist'), deck = ck(s).decks.science.length;
  command(s, a, id, { red: '2', yellow: '3' });
  assert.equal(ck(s).decks.science.length, deck + 1);
  act(s, a, { type: 'roll' });
  assert.deepEqual(s.lastRoll!.dice, [2, 3]);
  assert.equal(ck(s).alchemy, null);
  assert.equal(view(s, a).commands.some(c => c.id.startsWith('ck:play:') && c.label.includes('Alchemist')), false);
});

test('science: Crane, Engineer, Medicine, Irrigation, Mining, Road Building', () => {
  const { s, a } = stage();
  const [v1, v2] = trail(s, 2).vertices.filter((_, i) => i % 2 === 0);
  settle(s, a, v1, 'city');
  edit(s, n => { sx(n, a).improvements.trade = 1; });
  give(s, a, { cloth: 1 });
  play(s, a, 'crane', { track: 'trade' });
  assert.deepEqual([sx(s, a).improvements.trade, hand(s, a).cloth], [2, undefined], 'level 2 for 1 cloth');
  play(s, a, 'engineer', { city: v1 });
  assert.equal(s.pieces.buildings[v1].wall, true);
  settle(s, a, v2);
  give(s, a, { grain: 1, ore: 2 });
  play(s, a, 'medicine', { at: v2 });
  assert.deepEqual([s.pieces.buildings[v2].kind, hand(s, a).ore], ['city', undefined]);
  const farm = vertexOn(s, 'grain');
  settle(s, a, farm);
  const fields = new Set(Object.values(s.pieces.buildings).filter(b => b.seat === a)
    .flatMap(b => ix(s).vertex.get(b.vertex)!.tiles).filter(t => ix(s).tile.get(t)!.terrain === 'grain'));
  const before = s.seats[a].hand.grain;
  play(s, a, 'irrigation');
  assert.equal(s.seats[a].hand.grain - before, 2 * fields.size);
  play(s, a, 'mining');
  play(s, a, 'road-building');
  assert.equal(s.seats[a].freeRoutes, 2);
});

test('science: Inventor swaps two legal tokens; Smith promotes two knights', () => {
  const { s, a } = stage();
  const tiles = s.board.tiles.filter(t => [3, 4, 5, 9, 10, 11].includes(t.number));
  const [p, q] = [tiles[0], tiles.find(t => t.number !== tiles[0].number)!];
  const id = hold(s, a, 'inventor');
  unchanged(s, () => command(s, a, id, { first: p.id, second: p.id }));
  command(s, a, id, { first: p.id, second: q.id });
  assert.deepEqual([s.pieces.reveals[p.id].number, s.pieces.reveals[q.id].number], [q.number, p.number]);
  const [k1, k2] = trail(s, 2).vertices;
  knight(s, a, k1, 1, false, 'ka');
  knight(s, a, k2, 1, true, 'kb');
  play(s, a, 'smith', { first: 'ka', second: 'kb' });
  assert.deepEqual([s.pieces.units.ka.level, s.pieces.units.kb.level, s.pieces.units.kb.active], [2, 2, true]);
});

test('trade: Commercial Harbor, Master Merchant, Merchant, Merchant Fleet, both Monopolies', () => {
  const { s, a, b, c } = stage();
  const stock = inventory(s);
  give(s, a, { wood: 2 });
  give(s, b, { cloth: 1, wool: 3 });
  give(s, c, { wool: 1, coin: 2 });
  play(s, a, 'commercial-harbor');
  command(s, a, `ck:harbor:${b}`, {}, { give: { wood: 1 } });
  answer(s, b, 'cities-knights/give', {}, { cards: { cloth: 1 } });
  assert.deepEqual([hand(s, a).cloth, hand(s, b).wood], [1, 1]);
  assert.equal(view(s, a).commands.some(x => x.id === `ck:harbor:${b}`), false, 'one offer per player');
  play(s, a, 'resource-monopoly', { good: 'wool' });
  assert.deepEqual([hand(s, a).wool, hand(s, b).wool, hand(s, c).wool], [3, 1, undefined]);
  play(s, a, 'trade-monopoly', { good: 'coin' });
  assert.deepEqual([hand(s, a).coin, hand(s, c).coin], [1, 1]);
  const [v1] = trail(s, 1).vertices;
  settle(s, b, v1, 'city');
  play(s, a, 'master-merchant', { seat: b });
  const take = view(s, a).prompts.find(p => p.kind === 'cities-knights/take')!;
  assert.ok(take.command.fields[0].kind === 'cards');
  answer(s, a, 'cities-knights/take', {}, { cards: { wool: 1, wood: 1 } });
  assert.deepEqual(hand(s, b), {});
  const home = vertexOn(s, 'ore');
  settle(s, a, home);
  const ore = ix(s).vertex.get(home)!.tiles.find(t => ix(s).tile.get(t)!.terrain === 'ore')!;
  const merchant = view(s, a).commands.find(x => x.label === 'Play Merchant');
  assert.equal(merchant, undefined);
  play(s, a, 'merchant', { tile: ore });
  assert.deepEqual([s.pieces.merchant, rates(s, a).ore], [{ tile: ore, seat: a }, 2]);
  assert.ok(view(s, a).parts.some(p => p.key === 'merchant'));
  play(s, a, 'merchant-fleet', { good: 'paper' });
  assert.equal(rates(s, a).paper, 2);
  act(s, a, { type: 'end' });
  assert.equal(rates(s, a).paper, 4, 'the fleet lasts one turn');
  assert.deepEqual(inventory(s), stock);
});

test('politics: Bishop waits for the first attack, then robs everyone on the hex', () => {
  const { s, a, b, c } = stage();
  hold(s, a, 'bishop');
  const card = view(s, a).ext['cities-knights']!.progress[0];
  assert.deepEqual([card.playable, card.why?.text], [false, 'The robber enters after the first barbarian attack']);
  const land = (t: string) => ix(s).tile.get(t)!.terrain !== 'sea';
  const v = s.board.vertices.find(v => v.tiles.length === 3 && v.tiles.every(land))!;
  const [t1] = v.tiles, others = ix(s).tileVertices.get(t1)!.filter(x => x !== v.id);
  const far = others.find(x => !ix(s).vertexNeighbors.get(v.id)!.includes(x))!;
  settle(s, b, v.id);
  settle(s, c, far);
  give(s, b, { wood: 1 });
  give(s, c, { ore: 1 });
  edit(s, n => { ck(n).attacks = 1; setRobber(n, n.board.tiles.find(t => t.id !== t1 && t.terrain !== 'sea')!.id); });
  command(s, a, view(s, a).commands.find(x => x.label === 'Play Bishop')!.id, { tile: t1 });
  assert.deepEqual([s.pieces.robber, hand(s, a)], [t1, { wood: 1, ore: 1 }]);
});

test('politics: Diplomat, Intrigue, Deserter, Warlord', () => {
  const { s, a, b } = stage();
  const t = trail(s, 5), v = t.vertices, e = t.edges;
  settle(s, a, v[0]);
  lay(s, a, e.slice(0, 2));
  settle(s, b, v[5]);
  lay(s, b, e.slice(2));
  play(s, a, 'diplomat', { edge: e[2] });
  assert.equal(s.pieces.routes[e[2]], undefined, 'an open rival road');
  const again = hold(s, a, 'diplomat');
  unchanged(s, () => command(s, a, again, { edge: e[4] }), /again/);
  command(s, a, again, { edge: e[1] });
  assert.equal(s.seats[a].freeRoutes, 1, 'your own road comes back free');
  lay(s, a, [e[1]]);
  lay(s, b, [e[2]]);
  knight(s, b, v[3], 2, true, 'kb');
  knight(s, b, v[2], 1, false, 'kc');
  play(s, a, 'intrigue', { at: v[2] });
  answer(s, b, 'cities-knights/retreat', { at: v[4] });
  assert.equal(s.pieces.units.kc.at, v[4]);
  play(s, a, 'deserter', { seat: b });
  answer(s, b, 'cities-knights/deserter', { knight: 'kb' });
  assert.equal(s.pieces.units.kb, undefined);
  answer(s, a, 'cities-knights/deserter-place', { at: v[2] });
  const mine = Object.values(s.pieces.units).filter(u => u.seat === a);
  assert.deepEqual(mine.map(u => [u.at, u.level, u.active]), [[v[2], 2, true]], 'same strength and status');
  knight(s, a, v[1], 1, false, 'kd');
  play(s, a, 'warlord');
  assert.equal(s.pieces.units.kd.active, true);
});

test('politics: Saboteur, Wedding and Spy; players choose what they give', () => {
  const { s, a, b, c } = stage();
  const [v1, v2] = trail(s, 2).vertices.filter((_, i) => i % 2 === 0);
  settle(s, b, v1, 'city');
  settle(s, c, v2);
  give(s, b, { wood: 3, brick: 3 });
  give(s, c, { wool: 1 });
  play(s, a, 'wedding');
  answer(s, b, 'cities-knights/give', {}, { cards: { wood: 2 } });
  answer(s, c, 'cities-knights/give', {}, { cards: { wool: 1 } });
  assert.deepEqual(hand(s, a), { wood: 2, wool: 1 });
  play(s, a, 'saboteur');
  const sab = view(s, b).prompts.find(p => p.kind === 'cities-knights/give')!;
  assert.ok(sab.command.fields[0].kind === 'cards' && sab.command.fields[0].min === 2);
  answer(s, b, 'cities-knights/give', {}, { cards: { brick: 2 } });
  assert.deepEqual(hand(s, b), { wood: 1, brick: 1 });
  edit(s, n => { sx(n, c).progress.push({ id: 'cm', kind: 'merchant', track: 'trade' }); });
  play(s, a, 'spy', { seat: c });
  answer(s, a, 'cities-knights/spy', { card: 'cm' });
  assert.deepEqual([sx(s, a).progress.map(x => x.id), sx(s, c).progress.length], [['cm'], 0]);
});

test('cards are hidden until played; one command per held kind; unplayable cards say why', () => {
  const { s, a, b } = stage();
  hold(s, a, 'merchant-fleet');
  hold(s, a, 'merchant-fleet');
  assert.equal(view(s, a).commands.filter(x => x.label === 'Play Merchant Fleet').length, 1);
  assert.equal(JSON.stringify(view(s, b)).includes('merchant-fleet'), false);
  const alch = view(s, a).ext['cities-knights']!.progress.length;
  hold(s, a, 'alchemist');
  const p = view(s, a).ext['cities-knights']!.progress[alch];
  assert.deepEqual([p.playable, p.why?.code], [false, 'stage']);
  rig(s, [1, 2]);
});

test('open prompts never hang: an emptied Spy target, a blocked retreat; a retreating owner is not a target', () => {
  const { s, a, b, c } = stage();
  edit(s, n => { sx(n, c).progress.push({ id: 'cm', kind: 'merchant', track: 'trade' }); });
  play(s, a, 'spy', { seat: c });
  edit(s, n => { sx(n, c).progress = []; }); // Connect: c played it while the Spy looked
  assert.deepEqual(view(s, a).prompts.find(p => p.kind === 'cities-knights/spy')!.command.fields, []);
  answer(s, a, 'cities-knights/spy');
  assert.deepEqual([Object.keys(s.prompts), sx(s, a).progress], [[], []]);
  const t = trail(s, 6), v = t.vertices;
  settle(s, a, v[0]);
  lay(s, a, t.edges.slice(0, 4));
  settle(s, b, v[6]);
  lay(s, b, t.edges.slice(4));
  knight(s, a, v[1], 2, true, 'ka');
  knight(s, b, v[2], 1, false, 'kb');
  knight(s, b, v[4], 1, false, 'kc');
  const targets = () => {
    const f = view(s, a).commands.find(x => x.id === 'ck:move:ka')?.fields[0];
    return f?.kind === 'pick' ? f.options.map(o => o.value) : [];
  };
  assert.deepEqual(targets(), [v[2]]);
  play(s, a, 'intrigue', { at: v[4] });
  assert.ok(view(s, b).prompts.some(p => p.kind === 'cities-knights/retreat'));
  assert.deepEqual(targets(), [], 'b is already retreating a knight');
  const intrigue = hold(s, a, 'intrigue');
  assert.ok(!view(s, a).commands.some(x => x.id === intrigue));
  settle(s, c, v[5]); // its only retreat corner fills up (Connect)
  assert.deepEqual(view(s, b).prompts.find(p => p.kind === 'cities-knights/retreat')!.command.fields, []);
  answer(s, b, 'cities-knights/retreat');
  assert.equal('kc' in s.pieces.units, false, 'nowhere to go: the knight is lost');
  assert.deepEqual(targets(), [v[2]]);
});
