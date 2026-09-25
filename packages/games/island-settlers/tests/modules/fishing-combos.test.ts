/** Fishing with Cities & Knights, Explorers & Pirates and Barbarian Attack (official combination sheets). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardFeature, PickField } from '../../src/model';
import { isLandTile } from '../../src/engine/legal';
import { attack } from '../../src/engine/modules/cities-knights/barbarians';
import { facts, setInvaders } from '../../src/engine/modules/barbarian-attack/coast';
import { guards, placeGuard } from '../../src/engine/modules/barbarian-attack/guards';
import { ck, sx } from '../../src/engine/modules/cities-knights/state';
import { dl } from '../../src/engine/modules/deliveries/depots';
import { destinations, maxMoves, movesLeft } from '../../src/engine/modules/explorers/sea';
import { ext, ships, voyageFor } from '../../src/engine/modules/explorers/state';
import { fishTotal, fx } from '../../src/engine/modules/fishing';
import { catches } from '../../src/engine/modules/fishing/combos';
import { placeUnit, reveal, setPirate, setRobber } from '../../src/engine/pieces';
import { robberOptions } from '../../src/engine/prompts';
import type { State } from '../../src/engine/state';
import { act, answer, command, edit, game, pastSetup, rig, view } from '../helpers';
import { blank, clear, dice, ix, settle, toMain } from '../rules/helpers';

type Ground = Extract<BoardFeature, { kind: 'fishing-ground' }>;
const coastal = (s: State) =>
  s.board.features.filter((f): f is Ground => f.kind === 'fishing-ground' && f.id !== 'lake');
const has = (s: State, seat: string, id: string) => view(s, seat).commands.some(c => c.id === id);
const first = (s: State, seat: string, id: string) =>
  (view(s, seat).commands.find(c => c.id === id)!.fields[0] as PickField).options[0].value;

/** Every fish token back in the supply, then tokens of these values into `seat`'s hand. */
const fish = (s: State, seat: string, values: number[]) => edit(s, n => {
  const x = fx(n);
  for (const id of n.order) { x.deck.push(...x.hands[id].map(t => t.value)); x.hands[id] = []; }
  for (const v of values) {
    x.deck.splice(x.deck.indexOf(v), 1);
    x.hands[seat].push({ id: `t${n.serial++}`, value: v });
  }
});

test('with Cities & Knights: 7 fish take a progress card of your choice; fish alone trigger the Aqueduct', () => {
  const s = blank(game(4, { citiesKnights: true, scenarios: ['fishing'] })), a = s.turn.active!;
  const g = coastal(s)[0], n = g.numbers[0];
  const v = g.vertices.find(x => ix(s).vertex.get(x)!.tiles.every(t => ix(s).tile.get(t)!.number !== n))!;
  settle(s, a, v);
  edit(s, x => { sx(x, a).improvements.science = 3; ck(x).position = 0; });
  fish(s, a, []);
  rig(s, dice(n));
  act(s, a, { type: 'roll' });
  assert.ok(fishTotal(s, a) > 0, 'caught fish');
  assert.ok(view(s, a).prompts.some(p => p.kind === 'cities-knights/aqueduct'), 'fish are not production');
  answer(s, a, 'cities-knights/aqueduct', {}, { cards: { ore: 1 } });
  fish(s, a, [3, 3, 1]);
  assert.ok(!has(s, a, 'fishing-dev'), 'no development cards');
  const top = ck(s).decks.trade[0];
  command(s, a, 'fishing-progress', { track: 'trade' });
  assert.deepEqual([sx(s, a).progress.map(c => c.kind), fishTotal(s, a)], [[top], 0]);
});

test('with Cities & Knights: the off-board robber enters after the first attack; 2 fish then remove it', () => {
  for (const scenario of ['fishing', 'caravans'] as const) {
    const s = game(4, { citiesKnights: true, scenarios: [scenario] }), a = s.order[0];
    assert.equal(s.pieces.robber, null, `${scenario}: the lake or oasis replaces the desert`);
    assert.deepEqual(robberOptions(s, a), [], 'held until the first attack');
    edit(s, n => attack(n));
    assert.deepEqual(robberOptions(s, a).map(o => o.piece), ['robber'], `${scenario}: it may enter on a 7`);
  }
  const s = blank(game(4, { citiesKnights: true, scenarios: ['fishing'] })), a = s.turn.active!;
  edit(s, n => { attack(n); setRobber(n, n.board.tiles.find(t => isLandTile(n, t.id))!.id); });
  fish(s, a, [1, 1]);
  toMain(s, 3);
  assert.ok(has(s, a, 'fishing-robber'), '2 fish remove the robber once it is in play');
});

test('with Explorers & Pirates: 5 fish a free ship, 2 fish skip pirate tribute, 7 fish a ship moves again', () => {
  const s = game(4, { map: 'explorers', scenarios: ['fishing'] });
  pastSetup(s);
  toMain(s);
  const a = s.turn.active!, b = s.order.find(id => id !== a)!, hand = { ...s.seats[a].hand };
  const built = ships(s, a).length;
  fish(s, a, [3, 2]);
  command(s, a, 'fishing-ship', { at: first(s, a, 'fishing-ship') });
  assert.deepEqual([ships(s, a).length, s.seats[a].hand, fishTotal(s, a)], [built + 1, hand, 0]);
  // An opponent's pirate on an explored sea hex, one of our ships on its side.
  const tile = Object.keys(s.hidden).sort()[0], edges = ix(s).tileEdges.get(tile)!;
  edit(s, n => {
    for (const t of [tile, ...ix(n).tileNeighbors.get(tile)!.map(x => x.id)]) {
      if (n.hidden[t] && !n.pieces.reveals[t]) reveal(n, t, { terrain: 'sea', number: 0 });
    }
    setPirate(n, tile);
    ext(n).pirate = b;
    placeUnit(n, { id: 'tx', kind: 'expedition', seat: a, at: edges[0], level: 2, active: true, cargo: [] });
  });
  assert.ok([...destinations(s, s.pieces.units.tx).values()].every(l => l.tribute));
  fish(s, a, [2]);
  command(s, a, 'fishing-tribute');
  assert.ok(![...destinations(s, s.pieces.units.tx).values()].some(l => l.tribute), 'the pirate is ignored');
  assert.ok(!has(s, a, 'fishing-tribute'), 'once is enough for the turn');
  edit(s, n => { voyageFor(n, a).done.push('tx'); n.seats[a].moved = true; });
  assert.equal(movesLeft(s, s.pieces.units.tx), 0);
  fish(s, a, [3, 2, 2]);
  command(s, a, 'fishing-voyage', { ship: 'tx' });
  assert.equal(movesLeft(s, s.pieces.units.tx), maxMoves(s, a));
});

test('with Barbarian Attack: 2 fish pay for a long guard move; conquered buildings catch no fish', () => {
  const s = blank(game(4, { scenarios: ['barbarian-attack', 'fishing'] }, 7)), me = s.turn.active!;
  const coast = new Set(facts(s).coast);
  const land = (v: string) => ix(s).vertex.get(v)!.tiles.filter(t => isLandTile(s, t));
  const g = coastal(s).find(x => x.vertices.some(v => land(v).every(t => coast.has(t))))!;
  const v = g.vertices.find(x => land(x).every(t => coast.has(t)))!;
  settle(s, me, v);
  assert.equal(catches(s, v), true);
  edit(s, n => { for (const t of land(v)) setInvaders(n, t, 3); });
  assert.equal(catches(s, v), false);
  fish(s, me, []);
  rig(s, dice(g.numbers[0]));
  act(s, me, { type: 'roll' });
  assert.equal(fishTotal(s, me), 0, 'conquered: no fish');
  edit(s, n => placeGuard(n, me, facts(n).castleEdges[0], true));
  clear(s, me);
  fish(s, me, [2]);
  command(s, me, 'ba-move', { guard: guards(s, me)[0].id });
  const field = view(s, me).prompts[0].command.fields[0] as PickField;
  const far = field.options.find(o => o.label === 'Edge (2 fish)');
  assert.ok(far, 'no grain, but fish pay for 5 edges');
  answer(s, me, 'barbarian-attack/move', { edge: far.value });
  assert.deepEqual([guards(s, me)[0].at, fishTotal(s, me)], [far.value, 0]);
});

test('with Traders & Barbarians: 2 fish add 2 wagon MP, once per turn like the grain boost', () => {
  const s = blank(game(4, { scenarios: ['deliveries', 'fishing'] })), me = s.turn.active!;
  toMain(s, 8);
  const mp = dl(s).mp[me];
  fish(s, me, [1, 1, 2]);
  command(s, me, 'fishing-wagon');
  assert.equal(dl(s).mp[me], mp + 2);
  assert.ok(!has(s, me, 'fishing-wagon') && !has(s, me, 'dl-boost'), 'one boost per turn');
});
