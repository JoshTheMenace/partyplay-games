import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  act, answer, command, edit, fastForward, game, inventory, pastSetup, pub, rig, serializable, unchanged, view,
} from '../helpers';
import type { SeafarersScenario, Settings } from '../../src/model';
import { face } from '../../src/engine/legal';
import { setPirate, setRobber } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import type { SeafarersState } from '../../src/engine/modules/seafarers/index';
import { fogAt } from '../../src/engine/modules/seafarers/fog';
import { SAIL } from '../../src/engine/modules/seafarers/sail';
import { blank, dice, give, ix, last, lay, settle, toMain } from '../rules/helpers';
import { runMatch } from '../cpu/match';
import { moduleById } from '../../src/engine/modules/registry';

const sea = (scenario: SeafarersScenario, extra: Partial<Settings> = {}) =>
  ({ map: 'seafarers' as const, seafarers: scenario, ...extra });
const ext = (s: State) => s.ext.seafarers as SeafarersState;
const isSea = (s: State, e: string) => ix(s).edge.get(e)!.tiles.some(t => face(s, t).terrain === 'sea');
const islandOf = (s: State, v: string) => ix(s).vertex.get(v)!.tiles.map(t => ix(s).tile.get(t)!.island)
  .find(i => i >= 0) ?? -1;
/** A free corner (distance rule) on `island` with an empty sea edge, away from the pirate. */
function shore(s: State, island: number, skip: string[] = []) {
  const b = s.pieces.buildings, near = (v: string) => [v, ...ix(s).vertexNeighbors.get(v)!];
  for (const v of s.board.vertices) {
    if (islandOf(s, v.id) !== island || near(v.id).some(n => b[n] || skip.includes(n))) continue;
    const e = v.edges.find(x => isSea(s, x) && !s.pieces.routes[x]
      && !ix(s).edge.get(x)!.tiles.includes(s.pieces.pirate!));
    if (e) return { v: v.id, e };
  }
  throw new Error(`no shore on island ${island}`);
}

test('setup: New Shores and Fog Islands start on the home island; Four Islands anywhere', () => {
  for (const scenario of ['new-shores', 'fog-islands'] as const) {
    const s = game(4, sea(scenario)), spots = view(s, s.turn.active!).build.find(o => o.piece === 'settlement')!;
    assert.ok(spots.targets.length && spots.targets.every(v => islandOf(s, v) === 0), scenario);
  }
  const s = game(4, sea('four-islands')), spots = view(s, s.turn.active!).build.find(o => o.piece === 'settlement')!;
  assert.ok(new Set(spots.targets.map(v => islandOf(s, v))).size >= 3, 'several islands open');
  pastSetup(s);
  for (const id of s.order) {
    const mine = Object.values(s.pieces.buildings).filter(b => b.seat === id).map(b => islandOf(s, b.vertex));
    assert.deepEqual([...new Set(mine)].sort(), [...ext(s).home[id]].sort(), 'home islands recorded');
  }
});

test('island bonus: +2 VP for the first settlement on each new island, public claim, none at home', () => {
  const s = blank(game(4, sea('new-shores'))), a = s.turn.active!;
  const out = shore(s, 1), home = shore(s, 0);
  lay(s, a, [out.e, home.e], 'ship');
  toMain(s);
  give(s, a, { wood: 2, brick: 2, wool: 2, grain: 2 });
  act(s, a, { type: 'build', piece: 'settlement', at: home.v });
  assert.equal(view(s, a).parts.find(p => p.key === 'islands')!.points, 0, 'home island pays nothing');
  act(s, a, { type: 'build', piece: 'settlement', at: out.v });
  const part = pub(s).seats.find(x => x.id === a)!.parts.find(p => p.key === 'islands')!;
  assert.deepEqual([part.count, part.points], [1, 2]);
  assert.deepEqual(pub(s).ext.seafarers!.claimed[a], [1]);
  assert.deepEqual(pub(s).seats.find(x => x.id === a)!.badges.map(b => b.key), ['islands']);
  const again = shore(s, 1, [out.v]);
  lay(s, a, [again.e], 'ship');
  give(s, a, { wood: 1, brick: 1, wool: 1, grain: 1 });
  act(s, a, { type: 'build', piece: 'settlement', at: again.v });
  assert.equal(view(s, a).parts.find(p => p.key === 'islands')!.points, 2, 'once per island');
  const fog = game(4, sea('fog-islands'));
  assert.ok(!view(fog, fog.order[0]).parts.some(p => p.key === 'islands'), 'no bonus on Fog Islands');
});

test('ships built this turn cannot move; they can from the next opportunity', () => {
  const s = blank(game(4, sea('new-shores'))), a = s.turn.active!, { v, e } = shore(s, 0);
  settle(s, a, v);
  toMain(s);
  give(s, a, { wood: 2, wool: 2 });
  act(s, a, { type: 'build', piece: 'ship', at: e });
  const w = [ix(s).edge.get(e)!.a, ix(s).edge.get(e)!.b].find(x => x !== v)!;
  const next = view(s, a).build.find(o => o.piece === 'ship')!.targets
    .find(x => ix(s).vertex.get(w)!.edges.includes(x))!;
  act(s, a, { type: 'build', piece: 'ship', at: next });
  assert.deepEqual(view(s, a).shipMoves, [], 'fresh ships stay put');
  assert.deepEqual(ext(s).fresh[a]?.sort(), [e, next].sort());
  unchanged(s, () => act(s, a, { type: 'move-ship', from: next, to: e }), /cannot move/);
  act(s, a, { type: 'end' });
  assert.equal(ext(s).fresh[a], undefined, 'cleared at the end of the opportunity');
  fastForward(s, x => x.turn.active === a && x.turn.stage === 'roll');
  rig(s, dice(3));
  act(s, a, { type: 'roll' });
  assert.deepEqual(view(s, a).shipMoves.map(m => m.from), [next]);
});

test('gold fields: 1 pick per settlement, 2 per city, bank-limited, blocked by the robber', () => {
  const s = blank(game(4, sea('new-shores'))), [a, b, c, d] = s.order;
  const gold = s.board.tiles.find(t => t.terrain === 'gold')!, corners = ix(s).tileVertices.get(gold.id)!;
  settle(s, b, corners[0]);
  settle(s, c, corners[3], 'city');
  const stock = inventory(s);
  rig(s, dice(gold.number));
  act(s, a, { type: 'roll' });
  assert.deepEqual(pub(s).prompts.map(p => [p.seat, p.kind, p.count]).sort(), [[b, 'gold', 1], [c, 'gold', 2]]);
  unchanged(s, () => answer(s, b, 'gold', {}, { cards: { grain: 2 } }), /Choose 1/);
  unchanged(s, () => answer(s, c, 'gold', {}, { cards: { paper: 2 } }));
  answer(s, b, 'gold', {}, { cards: { ore: 1 } });
  answer(s, c, 'gold', {}, { cards: { wool: 1, grain: 1 } });
  assert.deepEqual([s.seats[b].hand.ore, s.seats[c].hand.wool, s.seats[c].hand.grain], [1, 1, 1]);
  assert.deepEqual(inventory(s), stock, 'conserved');
  const next = () => { act(s, s.turn.active!, { type: 'end' }); fastForward(s, x => x.turn.stage === 'roll'); };
  next();
  const robber = s.pieces.robber;
  edit(s, n => setRobber(n, gold.id));
  rig(s, dice(gold.number));
  act(s, s.turn.active!, { type: 'roll' });
  assert.deepEqual(pub(s).prompts, [], 'the robber blocks gold');
  next();
  edit(s, n => { setRobber(n, robber); for (const g of ['wood', 'brick', 'wool', 'grain', 'ore'] as const) {
    const keep = g === 'ore' ? 1 : 0;
    n.seats[d].hand[g] += n.bank[g] - keep; n.bank[g] = keep;
  } });
  rig(s, dice(gold.number));
  act(s, s.turn.active!, { type: 'roll' });
  assert.deepEqual(pub(s).prompts.map(p => p.count), [1, 1], 'the bank holds 1 resource');
  answer(s, b, 'gold', {}, { cards: { ore: 1 } });
  assert.equal(pub(s).prompts[0].count, 0);
  answer(s, c, 'gold');
  assert.deepEqual(inventory(s), stock, 'conserved');
});

test('pirate: a 7 may move it instead of the robber; it robs ship owners', () => {
  const s = blank(game(4, sea('new-shores'))), [a, b] = s.order, { v, e } = shore(s, 0);
  settle(s, b, v);
  lay(s, b, [e], 'ship');
  give(s, b, { ore: 2 });
  const tile = ix(s).edge.get(e)!.tiles.find(t => face(s, t).terrain === 'sea')!, stock = inventory(s);
  rig(s, [3, 4]);
  act(s, a, { type: 'roll' });
  const choices = pub(s).robberChoices.filter(x => x.seat === a);
  assert.deepEqual(choices.map(x => x.piece), ['robber', 'pirate']);
  assert.deepEqual(choices[1].tiles.find(t => t.tile === tile)!.victims, [b]);
  answer(s, a, 'robber', { piece: 'pirate', tile });
  assert.equal(s.pieces.pirate, tile);
  assert.deepEqual([s.seats[a].hand.ore, s.seats[b].hand.ore], [1, 1]);
  assert.deepEqual(inventory(s), stock);
  const e2 = last(s, 'robber');
  assert.ok(e2?.kind === 'robber' && e2.piece === 'pirate' && e2.victim === b);
});

test('fog: a route touching fog reveals it; land pays its resource, gold a pick, faces stay private', () => {
  const s = blank(game(4, sea('fog-islands'))), a = s.turn.active!, ixs = ix(s);
  const hiddenIds = Object.keys(s.hidden);
  const golden = (e: string) => fogAt(s, e).filter(t => s.hidden[t].terrain === 'gold').length;
  for (const t of hiddenIds) {
    const tile = pub(s).board.tiles.find(x => x.id === t)!;
    assert.deepEqual([tile.terrain, tile.number], ['fog', 0]);
  }
  // A sea edge u–w where w touches fog and u does not; a ship already sits on another edge at u.
  const pick = s.board.edges.flatMap(e => [[e.a, e.b], [e.b, e.a]].map(([u, w]) => ({ e, u, w })))
    .filter(({ e, u, w }) => isSea(s, e.id) && fogAt(s, e.id).length
      && !ixs.vertex.get(u)!.tiles.some(t => s.hidden[t]) && ixs.vertex.get(w)!.tiles.some(t => s.hidden[t])
      && ixs.vertex.get(u)!.edges.some(x => x !== e.id && isSea(s, x) && !fogAt(s, x).length))
    .sort((x, y) => golden(y.e.id) - golden(x.e.id))[0];
  const base = ixs.vertex.get(pick.u)!.edges.find(x => x !== pick.e.id && isSea(s, x) && !fogAt(s, x).length)!;
  lay(s, a, [base], 'ship');
  edit(s, n => setPirate(n, s.board.tiles.find(t => t.terrain === 'sea' && !ixs.tileEdges.get(t.id)!
    .some(x => x === base || x === pick.e.id))!.id));
  toMain(s);
  give(s, a, { wood: 1, wool: 1 });
  const found = fogAt(s, pick.e.id), before = { ...s.seats[a].hand }, stock = inventory(s);
  const mark = s.serial, prior = Object.keys(s.pieces.reveals).length;
  act(s, a, { type: 'build', piece: 'ship', at: pick.e.id });
  for (const t of found) assert.deepEqual(s.pieces.reveals[t], s.hidden[t]);
  assert.equal(s.events.filter(e => e.kind === 'reveal' && e.id > mark).length, found.length);
  const unseen = hiddenIds.filter(t => !s.pieces.reveals[t]);
  assert.ok(unseen.length && unseen.every(t => !(t in pub(s).pieces.reveals)), 'unrevealed faces stay private');
  const land = found.map(t => s.hidden[t].terrain).filter(g => g !== 'sea' && g !== 'gold');
  const gained = Object.values(s.seats[a].hand).reduce((n, x) => n + x, 0)
    - Object.values(before).reduce((n, x) => n + x, 0);
  assert.equal(gained, land.length - 2, 'ship paid, one card per land hex');
  const golds = found.filter(t => s.hidden[t].terrain === 'gold').length;
  assert.ok(golds > 0, 'this seed reaches a gold face');
  assert.deepEqual(view(s, a).prompts.map(p => [p.kind, p.scope]), [['gold', 'self']]);
  answer(s, a, 'gold', {}, { cards: { grain: golds } });
  assert.deepEqual(inventory(s), stock);
  const hud = pub(s).hud.find(h => h.key === 'fog');
  assert.ok(hud?.kind === 'track' && hud.value === prior + found.length && hud.max === hiddenIds.length);
  serializable(s);
});

test('Sail toward new land: offered with no spot at home; builds a ship that gets closer', () => {
  const s = blank(game(4, sea('new-shores'))), a = s.turn.active!, { v } = shore(s, 0);
  settle(s, a, v);
  toMain(s);
  assert.equal(view(s, a).commands.find(c => c.id === SAIL), undefined, 'needs the ship cost');
  give(s, a, { wood: 1, wool: 1 });
  const c = view(s, a).commands.find(x => x.id === SAIL)!;
  assert.ok(c.hint >= 0.45 && c.group === 'ships' && c.fields[0].kind === 'pick');
  const at = c.fields[0].kind === 'pick' ? c.fields[0].options[0].value : '';
  command(s, a, SAIL, { at });
  assert.deepEqual([s.pieces.routes[at]?.kind, s.seats[a].hand.wood, s.seats[a].hand.wool], ['ship', 0, 0]);
});

test('with Cities & Knights the pirate waits off the board until the first barbarian attack', () => {
  const s = blank(game(4, sea('new-shores', { citiesKnights: true }))), held = ext(s).pirate;
  assert.ok(held && s.pieces.pirate === null);
  const ck = moduleById('cities-knights')!, original = ck.publicView;
  try {
    ck.publicView = () => ({ barbarian: { position: 0, length: 7, attacks: 1 } }) as never;
    rig(s, dice(3));
    act(s, s.turn.active!, { type: 'roll' });
    assert.deepEqual([s.pieces.pirate, ext(s).pirate], [held, null]);
  } finally {
    ck.publicView = original;
  }
});

const MATCHES: [SeafarersScenario, 'standard' | 'connect', number, number][] = [
  ['new-shores', 'standard', 4, 1], ['new-shores', 'standard', 10, 1], ['new-shores', 'connect', 4, 2],
  ['new-shores', 'connect', 10, 3], ['four-islands', 'standard', 4, 1], ['four-islands', 'standard', 10, 1],
  ['four-islands', 'connect', 4, 1], ['four-islands', 'connect', 10, 1], ['fog-islands', 'standard', 4, 1],
  ['fog-islands', 'standard', 10, 1], ['fog-islands', 'connect', 4, 1], ['fog-islands', 'connect', 10, 1],
];

test('CPU matches finish by target at 4 and 10 seats, Standard and Connect, every scenario', () => {
  for (const [scenario, mode, seats, seed] of MATCHES) {
    const r = runMatch({ seats, seed, settings: sea(scenario, { mode }) }), label = `${scenario} ${mode} ${seats}`;
    assert.deepEqual(r.rejected.slice(0, 2), [], label);
    assert.equal(r.reason, 'target', `${label}: ${r.reason} after ${r.rounds} rounds`);
    // Connect: CPUs cannot see who is able to pay, so broadcasts wait for every decline (~10% slower).
    assert.ok(r.rounds <= (mode === 'standard' ? 30 : 110), `${label}: ${r.rounds} rounds`);
    assert.deepEqual(inventory(r.s), inventory(game(seats, sea(scenario, { mode }), seed)), `${label}: conserved`);
    serializable(r.s);
  }
});
