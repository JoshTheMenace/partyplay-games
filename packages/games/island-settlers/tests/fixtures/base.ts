/** Base-game turn fixtures: setup, roll, mid-game, the 7 (discards, then robber), paired turns. */
import type { Cards, PublicView } from '../../src/model';
import { baseCells, makeBoard, portGoods, sizeFor } from './board';
import { T0, build, clock, finish, fixture, lay, makeSeats, makeView, openSpots, settleAll, total, upgrade }
  from './build';
import { Log, gained } from './events';
import { me } from './private';
import { chip, discardPrompt, robberChoice, robberPrompt } from './prompts';

export const board = (seats: number) => makeBoard(baseCells(sizeFor(seats)), portGoods(sizeFor(seats)));

/** A mid-game table: two settlements and a road chain each, a city for some. */
export function midGame(n: number, o: { long?: boolean; cpu?: number[]; round?: number } = {}) {
  const pub = makeView(board(n), makeSeats(n, o), { stage: 'main', turn: { id: 40, round: o.round ?? 5 } });
  settleAll(pub, 2);
  pub.seats.forEach((s, i) => {
    const home = Object.values(pub.pieces.buildings).find(b => b.seat === s.id)!;
    lay(pub, s.id, home.vertex, 2 + (i % 3));
    if (i % 2 === 0) upgrade(pub, s.id, 1);
  });
  pub.mapRev = 30;
  return pub;
}

const HANDS: Cards[] = [
  { wood: 2, brick: 1, wool: 1, grain: 2, ore: 3 }, { wool: 3, grain: 1 }, { brick: 2, ore: 1 },
  { wood: 1, wool: 1, grain: 1 }, { ore: 2, grain: 2 }, { wood: 3 }, { brick: 1, wool: 2 },
  { grain: 3, ore: 1 }, { wood: 1, brick: 1 }, { wool: 1 },
];
export const hands = (pub: PublicView) => Object.fromEntries(pub.seats.map((s, i) => [s.id, HANDS[i]]));

export function setup4() {
  const now = T0 + 60_000, pub = makeView(board(4), makeSeats(4, { cpu: [2] }), {
    stage: 'setup', now: ['Dee places a settlement', 'Setup round 1 · placement 4 of 16'],
    turn: {
      id: 4, active: 'p3', next: 'p3',
      setup: { seat: 'p3', piece: 'settlement', round: 1, index: 3, total: 16 },
    },
  });
  const log = new Log(T0);
  for (const { id: seat, name } of pub.seats.slice(0, 3)) {
    const spot = openSpots(pub)[0];
    build(pub, seat, spot);
    const [edge] = lay(pub, seat, spot, 1);
    log.add({ kind: 'build', seat, piece: 'settlement', spot, free: true, text: `${name} settled` }, 4000);
    log.add({ kind: 'build', seat, piece: 'road', spot: edge, free: true, text: `${name} built a road` }, 2500);
  }
  pub.now.seats = ['p3'];
  clock(pub, 'setup', ['p3'], now - 5000, 'placing');
  pub.intent = { seat: 'p3', piece: 'settlement', targets: openSpots(pub) };
  log.into(finish(pub, {}));
  return fixture({
    name: 'setup-4', now, seat: 'p3', pub,
    description: 'Setup round 1, fourth placement, phone showing its intent',
    views: [me(pub, 'p3', {}, { free: { settlement: 1 } }), me(pub, 'p0', {})],
  });
}

export function roll3() {
  const now = T0 + 400_000, pub = midGame(3, { long: true, cpu: [1] });
  Object.assign(pub.turn, { stage: 'roll', active: 'p1', next: 'p2' });
  pub.now = { seats: ['p1'], title: 'Anastasia Rowley rolls', detail: 'Round 5' };
  const log = new Log(now - 20_000), h = hands(pub);
  log.add({ kind: 'turn', seat: 'p1', stage: 'roll', round: 5, text: 'Anastasia Rowley to roll' }, 0);
  clock(pub, 'roll', ['p1'], now - 3000, 'rolling');
  log.into(finish(pub, h));
  const knight = { id: 'd1', kind: 'knight' as const, playable: true, why: null };
  return fixture({
    name: 'roll-3', now, seat: 'p1', pub,
    description: '3 seats, long names, waiting on a roll (knight playable first)',
    views: [me(pub, 'p1', h.p1, { dev: [knight] }), me(pub, 'p0', h.p0)],
  });
}

export function mid4() {
  const now = T0 + 900_000, pub = midGame(4, { cpu: [2, 3], round: 6 });
  Object.assign(pub.turn, { active: 'p0', next: 'p1' });
  pub.now = { seats: ['p0'], title: 'Ana builds', detail: 'Rolled 8' };
  pub.awards = { 'longest-road': 'p2', 'largest-army': 'p1' };
  pub.seats[1].knights = 3;
  pub.seats[0].dev = 2;
  pub.devDeck = 17;
  const log = new Log(now - 12_000), h = hands(pub);
  log.add({ kind: 'turn', seat: 'p0', stage: 'roll', round: 6, text: 'Ana to roll' }, 0);
  const roll = log.roll(pub, 'p0', [3, 5], 1500);
  const [road] = lay(pub, 'p0', Object.values(pub.pieces.buildings).find(b => b.seat === 'p0')!.vertex, 1);
  log.add({ kind: 'build', seat: 'p0', piece: 'road', spot: road, free: false, text: 'Ana built a road' }, 3000);
  log.add({ kind: 'bank', seat: 'p0', give: { wool: 4 }, get: { ore: 1 }, text: 'Ana traded 4 wool for 1 ore' });
  log.add({ kind: 'dev-buy', seat: 'p0', text: 'Ana bought a development card' }, 1400);
  pub.offers = [{
    id: 'o1', at: now - 2000, from: 'p0', to: ['p1', 'p3'], broadcast: false, give: { ore: 1 }, want: { wool: 2 },
    counterTo: null, responses: { p1: 'pending', p3: 'accept' }, reasons: {}, expires: now + 43_000,
  }];
  log.add({ kind: 'offer', offer: 'o1', seat: 'p0', change: 'posted', text: 'Ana offers 1 ore for 2 wool' }, 1200);
  clock(pub, 'main', ['p0'], now - 10_000, 'acting');
  log.into(finish(pub, h));
  pub.seats[2].status = 'thinking';
  const dev = [
    { id: 'd2', kind: 'road-building' as const, playable: true, why: null },
    { id: 'd3', kind: 'victory' as const, playable: false, why: { code: 'rule' as const, text: 'Counts at the end' } },
  ];
  const inbox = [{
    id: 1, at: roll.at, text: 'You got 1 grain from the 8', cards: gained(roll, 'p0'), tone: 'gain' as const,
    other: null,
  }];
  return fixture({
    name: 'mid-4', now, seat: 'p0', pub,
    description: 'Base 4-seat mid-game: main turn, awards, one open offer',
    views: [
      me(pub, 'p0', h.p0, { dev, inbox }), me(pub, 'p1', h.p1), me(pub, 'p2', h.p2), me(pub, 'p3', h.p3),
    ],
  });
}

/** The same 4-seat table right after a 7: big hands for three seats. */
function sevenTable(now: number) {
  const pub = midGame(4, { round: 7 }), log = new Log(now - 6000);
  Object.assign(pub.turn, { stage: 'roll', active: 'p0', next: 'p1' });
  const h: Record<string, Cards> = {
    p0: { wood: 1, grain: 2 }, p1: { wood: 3, brick: 2, wool: 2, ore: 2 },
    p2: { brick: 3, wool: 3, grain: 2, ore: 2 }, p3: { wood: 2, wool: 2, grain: 2, ore: 2 },
  };
  log.add({ kind: 'turn', seat: 'p0', stage: 'roll', round: 7, text: 'Ana to roll' }, 0);
  log.roll(pub, 'p0', [4, 3], 1500);
  return { pub, log, h };
}

export function sevenDiscard4() {
  const now = T0 + 1_200_000, { pub, log, h } = sevenTable(now);
  pub.now = { seats: ['p1', 'p2', 'p3'], title: 'Rolled 7!', detail: 'Discarding: Bo (4), Cy (5), Dee (4)' };
  finish(pub, h);
  const deadline = clock(pub, 'discard', ['p1', 'p2', 'p3'], now - 4000, 'discarding');
  const prompts = (['p1', 'p2', 'p3'] as const).map((seat, i) => {
    const count = Math.floor(pub.seats[i + 1].cards / 2);
    return { seat, count, prompt: discardPrompt(`q${i + 1}`, h[seat], count, deadline) };
  });
  pub.prompts = prompts.map(p => chip(p.prompt, p.seat, 'Discarding', p.count));
  log.into(pub);
  return fixture({
    name: 'seven-discard-4', now, seat: 'p1', pub,
    description: 'A 7 with three simultaneous discard prompts',
    views: [
      ...prompts.map(p => me(pub, p.seat, h[p.seat], { prompts: [p.prompt] })),
      me(pub, 'p0', h.p0, { task: { kind: 'wait', title: 'Waiting for discards', text: 'Then you move the robber',
        prompt: null, deadline, auto: null } }),
    ],
  });
}

export function sevenRobber4() {
  const now = T0 + 1_240_000, { pub, log, h } = sevenTable(now);
  const after: Record<string, Cards> = {
    p1: { wood: 2, ore: 2 }, p2: { brick: 2, wool: 1, ore: 2 }, p3: { wool: 2, ore: 2 },
  };
  for (const s of pub.seats.slice(1)) {
    const count = total(h[s.id]) - total(after[s.id]);
    log.add({ kind: 'discard', seat: s.id, count, text: `${s.name} discarded ${count}` }, 1800);
    h[s.id] = after[s.id];
  }
  pub.now = { seats: ['p0'], title: 'Ana moves the robber', detail: 'Pick a hex to block' };
  finish(pub, h);
  const deadline = clock(pub, 'robber', ['p0'], now - 2000, 'robbing');
  const choice = robberChoice(pub, 'p0'), prompt = robberPrompt(pub, 'q4', choice, deadline);
  pub.robberChoices = [choice];
  pub.prompts = [chip(prompt, 'p0', 'Moving the robber', null)];
  log.into(pub);
  return fixture({
    name: 'seven-robber-4', now, seat: 'p0', pub,
    description: 'After the discards: the roller picks a robber hex and victim',
    views: [me(pub, 'p0', h.p0, { prompts: [prompt] }), me(pub, 'p1', h.p1)],
  });
}

export function paired6() {
  const now = T0 + 2_000_000, pub = midGame(6, { long: true, cpu: [4, 5], round: 8 });
  Object.assign(pub.turn, { stage: 'paired', active: 'p0', partner: 'p3', next: 'p1' });
  pub.now = { seats: ['p3'], title: 'Evangeline Moore builds', detail: 'Paired build turn · bank trades only' };
  const log = new Log(now - 30_000), h = hands(pub);
  log.add({ kind: 'turn', seat: 'p0', stage: 'roll', round: 8, text: 'Maximilian Ortiz to roll' }, 0);
  log.roll(pub, 'p0', [6, 4], 1500);
  log.add({ kind: 'turn', seat: 'p3', stage: 'paired', round: 8, text: 'Evangeline Moore builds' }, 20_000);
  clock(pub, 'paired', ['p3'], now - 8000, 'paired');
  log.into(finish(pub, h));
  return fixture({
    name: 'paired-6', now, seat: 'p3', pub,
    description: '6 seats, long names: Player 2 paired build turn (no player trades)',
    views: [me(pub, 'p3', h.p3), me(pub, 'p0', h.p0), me(pub, 'p1', h.p1)],
  });
}

export function concurrent8() {
  const now = T0 + 2_400_000, pub = midGame(8, { cpu: [5, 6, 7], round: 6 });
  Object.assign(pub.turn, { stage: 'main', active: 'p2', partner: 'p6', next: 'p3' });
  pub.now = { seats: ['p2', 'p6'], title: 'Cy plays · Gus builds', detail: 'Paired build turn at the same time' };
  const log = new Log(now - 15_000), h = hands(pub);
  log.add({ kind: 'turn', seat: 'p2', stage: 'roll', round: 6, text: 'Cy to roll' }, 0);
  log.roll(pub, 'p2', [5, 4], 1500);
  clock(pub, 'main', ['p2'], now - 12_000, 'acting');
  log.into(finish(pub, h));
  Object.assign(pub.seats[6], { status: 'paired', deadline: now + 33_000 });
  return fixture({
    name: 'concurrent-8', now, seat: 'p2', pub,
    description: '8 seats: Player 1 main turn with a concurrent paired partner',
    views: [me(pub, 'p2', h.p2), me(pub, 'p6', h.p6), me(pub, 'p0', h.p0)],
  });
}
