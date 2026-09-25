import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Settings, Unit } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { placeUnit, reveal, setPirate } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { ext, ships } from '../../src/engine/modules/explorers/state';
import { destinations, maxMoves, navigable } from '../../src/engine/modules/explorers/sea';
import { cornerWhy, edgeWhy } from '../../src/engine/modules/explorers/rules';
import { act, answer, command, edit, game, pastSetup, view } from '../helpers';
import { toMain } from '../rules/helpers';

/** Past setup (starting ships launched) and in the first main step. */
function started(seats = 4, extra: Partial<Settings> = {}) {
  const s = game(seats, { map: 'explorers', ...extra });
  pastSetup(s);
  toMain(s);
  return s;
}
const launch = (s: State, seat: string, at: string, cargo: Unit['cargo'] = []) => {
  edit(s, n => placeUnit(n, { id: `t${at}`, kind: 'expedition', seat, at, level: 2, active: true, cargo }));
  return `t${at}`;
};
/** A hidden hex and its hidden neighbours revealed as open sea (the band only touches sea rings). */
function openSea(s: State) {
  const ix = boardIndex(s.board), tile = Object.keys(s.hidden).sort()[0];
  edit(s, n => {
    for (const t of [tile, ...ix.tileNeighbors.get(tile)!.map(x => x.id)]) {
      if (n.hidden[t] && !n.pieces.reveals[t]) reveal(n, t, { terrain: 'sea', number: 0 });
    }
  });
  return { tile, edges: ix.tileEdges.get(tile)! };
}

test('tribute: sailing past an opponent pirate costs 1 gold once per ship; without gold those edges close', () => {
  const s = started(), a = s.turn.active!, b = s.order.find(id => id !== a)!, { tile, edges } = openSea(s);
  edit(s, n => { setPirate(n, tile); ext(n).pirate = b; });
  const id = launch(s, a, edges[0]), u = s.pieces.units[id];
  assert.ok([...destinations(s, u).values()].every(l => l.tribute), 'every move leaves the pirate hex');
  edit(s, n => { ext(n).coins[a] = 0; });
  assert.equal(destinations(s, s.pieces.units[id]).size, 0, 'no gold, no passage');
  edit(s, n => { ext(n).coins[a] = 3; });
  const to = [...destinations(s, s.pieces.units[id]).keys()][0];
  command(s, a, `explorers/sail:${id}`, { heading: 'any', to });
  assert.equal(ext(s).coins[a], 2);
  assert.ok(![...destinations(s, s.pieces.units[id]).values()].some(l => l.tribute), 'paid for this turn');
  edit(s, n => { ext(n).pirate = a; });
  assert.ok(![...destinations(s, s.pieces.units[id]).values()].some(l => l.tribute), 'your own pirate is free');
});

test('moves: two ships per edge at most; moving a second ship finishes the first; Swift Voyage adds a move', () => {
  const s = started(), a = s.turn.active!, b = s.order.find(id => id !== a)!, { edges } = openSea(s);
  const one = launch(s, a, edges[0]), two = launch(s, a, edges[3]);
  launch(s, b, edges[2]);
  edit(s, n => placeUnit(n, { id: 'extra', kind: 'expedition', seat: b, at: edges[2], level: 2, active: true, cargo: [] }));
  assert.ok(!destinations(s, s.pieces.units[one]).has(edges[2]), 'a full edge is passed, never entered');
  const first = [...destinations(s, s.pieces.units[one])].find(([, l]) => l.path.length === 1)![0];
  command(s, a, `explorers/sail:${one}`, { heading: 'any', to: first });
  assert.equal(view(s, a).ext.explorers!.movesLeft[one], 3);
  const other = [...destinations(s, s.pieces.units[two]).keys()][0];
  command(s, a, `explorers/sail:${two}`, { heading: 'any', to: other });
  assert.equal(view(s, a).ext.explorers!.movesLeft[one], 0, 'the first ship is done');
  assert.equal(maxMoves(s, a), 4);
  const farm = Object.keys(s.hidden).find(t => !s.pieces.reveals[t])!;
  edit(s, n => {
    reveal(n, farm, { terrain: 'spice', number: 0, feature: { kind: 'spice', id: 'sp', tile: farm, benefit: 'speed' } });
    ext(n).spiceVisits[a] = [farm];
  });
  assert.equal(maxMoves(s, a), 5);
});

test('building rules: nothing on fog, uncaptured lairs block roads and settlements; the paired turn never sails', () => {
  const s = started(), a = s.turn.active!, ix = boardIndex(s.board);
  const spots = view(s, a).build.find(o => o.piece === 'settlement')!.targets;
  assert.ok(spots.every(v => ix.vertex.get(v)!.tiles.every(t => !s.hidden[t] || s.pieces.reveals[t])));
  const [gold] = Object.entries(s.hidden).find(([, f]) => f.terrain === 'gold')!, e = ix.tileEdges.get(gold)![0];
  edit(s, n => { reveal(n, gold, { terrain: 'gold', number: 0 }); ext(n).lairs.push({ tile: gold, crews: {}, captured: null, at: 0 }); });
  assert.equal(edgeWhy(s, a, e)?.text, 'Capture the lair first');
  assert.equal(cornerWhy(s, a, ix.tileVertices.get(gold)![0])?.text, 'Capture the lair first');
  edit(s, n => { ext(n).lairs[0].captured = a; });
  assert.notEqual(edgeWhy(s, a, e)?.text, 'Capture the lair first');
  const five = game(5, { map: 'explorers' });
  pastSetup(five);
  for (const p of Object.values(five.prompts)) {
    const f = view(five, p.seat).prompts[0].command.fields[0];
    answer(five, p.seat, p.kind, { at: f.kind === 'pick' ? f.options[0].value : '' });
  }
  toMain(five);
  act(five, five.turn.active!, { type: 'end' });
  const partner = five.turn.partner!;
  assert.equal(five.turn.stage, 'paired');
  assert.ok(!view(five, partner).commands.some(c => /sail|fish|settle/.test(c.id)), 'build turn only');
});

test('fish roll: once per movement phase; a haul lands on the explored shoal with the rolled number', () => {
  const s = started(), a = s.turn.active!;
  edit(s, n => { for (const [t, f] of Object.entries(n.hidden)) if (f.terrain === 'shoal') reveal(n, t, f); });
  command(s, a, 'explorers/fish');
  const roll = Number(/rolled (\d)/.exec(s.events.at(-1)!.text)![1]);
  const hit = Object.entries(s.hidden).filter(([, f]) => f.terrain === 'shoal' && f.number === roll).map(([t]) => t);
  assert.deepEqual(ext(s).hauls, hit);
  assert.ok(!view(s, a).commands.some(c => c.id === 'explorers/fish'), 'once per turn');
  assert.ok(!view(s, a).commands.some(c => c.id === 'explorers/buy'), 'the roll starts the movement phase');
});

test('connect: every seat builds and sails in the window; the starting ships explore', () => {
  const s = started(4, { mode: 'connect' });
  for (const id of s.order) {
    const u = ships(s, id)[0], sail = view(s, id).commands.find(c => c.id === `explorers/sail:${u.id}`);
    assert.ok(sail && navigable(s, u.at), id);
  }
  const [a, b] = s.order;
  const go = (id: string) => {
    const u = ships(s, id)[0], to = [...destinations(s, u).keys()][0];
    command(s, id, `explorers/sail:${u.id}`, { heading: 'any', to });
    return u.id;
  };
  go(a);
  go(b);
  assert.ok(s.seats[a].moved && s.seats[b].moved);
});
