/** Seafarers (ships, gold, pirate, island bonus) and Explorers & Pirates (fog, expeditions, missions). */
import type { Cards, Command, PublicView, Terrain } from '../../src/model';
import { axialKey, ring } from '../../src/geometry';
import { baseCells, makeBoard, portGoods, type Cell } from './board';
import { T0, build, clock, finish, fixture, lay, makeSeats, makeView, openSpots, settleAll } from './build';
import { Log } from './events';
import { hands } from './base';
import { me } from './private';
import { chip, goldPrompt } from './prompts';

const cell = (q: number, r: number, terrain: Terrain, number: number, island: number): Cell =>
  ({ q, r, terrain, number, island });

const ISLANDS: Cell[] = [
  cell(4, -2, 'gold', 5, 1), cell(4, -1, 'ore', 9, 1), cell(5, -2, 'wool', 10, 1),
  cell(-4, 2, 'wood', 4, 2), cell(-4, 1, 'brick', 11, 2), cell(-5, 2, 'gold', 3, 2),
  cell(0, -4, 'grain', 8, 3), cell(1, -4, 'ore', 6, 3),
];

const spotOn = (pub: PublicView, tile: string) => openSpots(pub).find(v =>
  pub.board.vertices.find(x => x.id === v)!.tiles.includes(tile))!;

export function seafarers4() {
  const now = T0 + 8_000_000, board = makeBoard([...baseCells('small'), ...ISLANDS], portGoods('small'));
  const pub = makeView(board, makeSeats(4, { cpu: [3] }), {
    stage: 'main', settings: { map: 'seafarers', targetPoints: 14 },
    turn: { id: 52, round: 6, active: 'p0', next: 'p1' },
    now: ['Ana sails', 'Rolled 5 · Bo picks gold'],
  });
  pub.modules = ['seafarers'];
  settleAll(pub, 2);
  const home = Object.values(pub.pieces.buildings).find(b => b.seat === 'p0')!.vertex;
  const coastal = openSpots(pub).find(v => pub.board.vertices.find(x => x.id === v)!.coast) ?? home;
  build(pub, 'p0', coastal);
  const ships = lay(pub, 'p0', coastal, 3, 'ship');
  build(pub, 'p1', spotOn(pub, '4:-2'));
  pub.pieces.pirate = pub.board.tiles.find(t => t.terrain === 'sea' && t.q === -3)!.id;
  pub.mapRev = 44;
  const log = new Log(now - 7000), h: Record<string, Cards> = hands(pub);
  const text = 'Ana moved a ship';
  log.add({ kind: 'move', seat: 'p0', piece: 'ship', unit: null, from: ships[1], to: ships[2], text }, 0);
  log.roll(pub, 'p0', [2, 3], 2500);
  clock(pub, 'main', ['p0'], now - 5000, 'acting');
  log.into(finish(pub, h));
  pub.seats[1].vp += 2;
  pub.seats[1].parts.push({ key: 'islands', label: 'Island bonus', points: 2, count: 1 });
  pub.seats[1].badges = [{ key: 'islands', icon: 'ship', value: 1, label: '1 new island' }];
  pub.ext.seafarers = { claimed: { p1: [1] } };
  pub.hud = [{ kind: 'table', key: 'islands', label: 'New islands', rows: [
    { label: 'Settled', values: { p0: 0, p1: 1, p2: 0, p3: 0 }, max: null },
  ] }];
  const gold = goldPrompt('q9', 1, pub.bank, now + 35_000);
  pub.prompts = [chip(gold, 'p1', 'Picking gold', 1)];
  Object.assign(pub.seats[1], { status: 'choosing', deadline: gold.deadline });
  const free = pub.board.edges.filter(e => e.sea && !e.land && !pub.pieces.routes[e.id]).slice(0, 3).map(e => e.id);
  return fixture({
    name: 'seafarers-4', now, seat: 'p0', pub,
    description: 'Seafarers: ships, pirate, gold prompt, island bonus',
    views: [
      me(pub, 'p0', h.p0, { shipMoves: [{ from: ships[2], to: free }] }), me(pub, 'p1', h.p1, { prompts: [gold] }),
    ],
  });
}

/** Every other cell of ring 4: the council hex, then fog. The first three fog hexes are revealed. */
const OUTER = ring({ q: 0, r: 0 }, 4).filter((_, i) => i % 2 === 0)
  .map((c, i) => cell(c.q, c.r, i ? 'fog' : 'council', 0, 1 + (i % 4)));
const [council, ore, spice, lair] = OUTER.map(axialKey);

const move: Command = {
  id: 'explorers/move', module: 'explorers', group: 'ships', label: 'Sail an expedition', cost: null, hint: 0.8,
  detail: 'Move a ship up to its moves left; it stops on discovering fog.', fields: [
    {
      kind: 'pick', key: 'unit', label: 'Ship', target: 'unit',
      options: [{ value: 'x1', label: 'Ship with settler, crew' }],
    },
  ],
};

export function explorers4() {
  const now = T0 + 9_000_000;
  const board = makeBoard([...baseCells('small'), ...OUTER], [], [{ kind: 'council', id: 'council', tile: council }]);
  const pub = makeView(board, makeSeats(4, { cpu: [2, 3] }), {
    stage: 'main', settings: { map: 'explorers', targetPoints: 17 },
    turn: { id: 61, round: 7, active: 'p0', next: 'p1' },
    now: ['Ana explores', 'Discovered a spice island'],
  });
  pub.modules = ['explorers'];
  settleAll(pub, 1);
  const harbor = Object.values(pub.pieces.buildings).find(b => b.seat === 'p0')!;
  harbor.kind = 'harbor';
  const sea = (i: number) => pub.board.edges.filter(e => e.sea && !e.land)[i].id;
  pub.pieces.units = {
    x1: { id: 'x1', kind: 'expedition', seat: 'p0', at: sea(4), level: 2, active: true, cargo: ['settler', 'crew'] },
    x2: { id: 'x2', kind: 'expedition', seat: 'p1', at: sea(20), level: 2, active: true, cargo: ['fish'] },
    x3: { id: 'x3', kind: 'expedition', seat: 'p2', at: sea(33), level: 3, active: true, cargo: ['crew', 'spice'] },
  };
  pub.pieces.reveals = {
    [ore]: { terrain: 'ore', number: 8 },
    [spice]: { terrain: 'spice', number: 0, feature: { kind: 'spice', id: 'sp1', tile: spice, benefit: 'speed' } },
    [lair]: { terrain: 'sea', number: 0, feature: { kind: 'lair', id: 'lair1', tile: lair } },
  };
  pub.pieces.pirate = pub.board.tiles.find(t => t.terrain === 'sea')!.id;
  pub.mapRev = 70;
  const log = new Log(now - 6000), h = hands(pub);
  log.add({ kind: 'move', seat: 'p0', piece: 'expedition', unit: 'x1', from: sea(3), to: sea(4), text: 'Ana sails' });
  log.add({ kind: 'reveal', seat: 'p0', tile: spice, terrain: 'spice', text: 'Ana discovered a spice island' }, 1200);
  clock(pub, 'main', ['p0'], now - 4000, 'moving');
  log.into(finish(pub, h));
  pub.seats[0].vp += 1;
  pub.seats[0].parts.push({ key: 'spices', label: 'Spice mission', points: 1, count: 1 });
  const coins = { p0: 3, p1: 1, p2: 0, p3: 2 };
  pub.ext.explorers = {
    coins, missions: { p0: { spices: 1 }, p1: { fish: 1 }, p2: { lairs: 0 }, p3: {} },
    lairs: [{ tile: lair, crews: { p1: 1, p2: 2 }, captured: null }], spiceVisits: { p0: [spice] },
  };
  pub.hud = [{ kind: 'table', key: 'missions', label: 'Missions', rows: [
    { label: 'Pirate lairs', values: { p0: 0, p1: 0, p2: 0, p3: 0 }, max: 3 },
    { label: 'Fish for the council', values: { p0: 0, p1: 1, p2: 0, p3: 0 }, max: 3 },
    { label: 'Spices', values: { p0: 1, p1: 0, p2: 0, p3: 0 }, max: 3 },
  ] }];
  for (const s of pub.seats) {
    s.badges = [{ key: 'coins', icon: 'coin', value: coins[s.id as keyof typeof coins], label: 'Gold coins' }];
  }
  const rates = { wood: 3, brick: 3, wool: 3, grain: 3, ore: 3 };
  return fixture({
    name: 'explorers-4', now,
    description: 'Explorers & Pirates: fog, reveals, expeditions with cargo, lairs, missions',
    seat: 'p0', pub,
    views: [
      me(pub, 'p0', h.p0, { rates, commands: [move], ext: { explorers: { movesLeft: { x1: 3 } } } }),
      me(pub, 'p1', h.p1, { rates }),
    ],
  });
}
