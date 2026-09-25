/** Whole-table fixtures: 12 open offers, a Connect window, max pieces at 10 seats, the finale. */
import type { Cards, Offer, OfferResponse, PublicView, Results, SeatId, SeatStats } from '../../src/model';
import { FINALE_MS, RESOURCES } from '../../src/model';
import { board, hands, midGame } from './base';
import { T0, clock, finish, fixture, makeSeats, makeView, sid, upgrade } from './build';
import { Log } from './events';
import { me, victoryPart } from './private';

const STATES: OfferResponse[] = ['pending', 'accept', 'decline', 'counter', 'unable'];
const BIG: Cards = { wood: 3, brick: 3, wool: 3, grain: 3, ore: 3 };

/**
 * 10 seats in a Connect window with the 12-offer cap reached (VIEW_LIMITS.openOffers). Two seats hold
 * a second offer so the cap is reachable at 10 seats; every response state appears, counters included.
 */
export function offers12() {
  const now = T0 + 3_000_000, pub = midGame(10, { long: true, cpu: [6, 7, 8, 9], round: 5 });
  pub.settings.mode = 'connect';
  Object.assign(pub.turn, { stage: 'round', active: 'p4', next: 'p5' });
  pub.now = { seats: pub.seats.map(s => s.id), title: 'Round 5', detail: 'Everyone builds and trades' };
  const log = new Log(now - 40_000), h = hands(pub);
  h.p0 = { ...BIG };
  log.roll(pub, 'p4', [5, 3], 0);
  pub.offers = Array.from({ length: 12 }, (_, i): Offer => {
    const from = sid(i % 10), broadcast = i % 3 === 0;
    const to = broadcast ? [] : [sid((i + 1) % 10), sid((i + 3) % 10), sid((i + 5) % 10)].filter(x => x !== from);
    const who = broadcast ? pub.seats.map(s => s.id).filter(x => x !== from) : to;
    const responses = Object.fromEntries(who.map((x, k) => [x, STATES[(i + k) % STATES.length]]));
    const cpu = (x: string) => pub.seats.find(s => s.id === x)!.cpu;
    const reasons = Object.fromEntries(who.filter(x => responses[x] === 'decline' && cpu(x))
      .map(x => [x, 'I need my ore for a city']));
    const give = { [RESOURCES[i % 5]]: 1 + (i % 2) }, want = { [RESOURCES[(i + 2) % 5]]: 1 + (i % 3 === 1 ? 1 : 0) };
    return { id: `o${i}`, at: now - 30_000 + i * 2000, from, to, broadcast, give, want, counterTo: null, responses,
      reasons, expires: now + 15_000 + i * 2000 };
  });
  // The last two are counters, posted by the seat whose response on the parent reads 'counter'.
  for (const [i, parent] of [[10, pub.offers[0]], [11, pub.offers[3]]] as const) {
    const by = Object.keys(parent.responses).find(x => parent.responses[x] === 'counter')!;
    Object.assign(pub.offers[i], {
      from: by, to: [parent.from], broadcast: false, give: parent.want, want: parent.give, counterTo: parent.id,
      responses: { [parent.from]: 'pending' }, reasons: {},
    });
  }
  for (const offer of pub.offers) {
    log.add({ kind: 'offer', offer: offer.id, seat: offer.from, change: 'posted', text: 'New offer' }, 2000);
  }
  clock(pub, 'main', pub.seats.map(s => s.id), now - 45_000, 'acting');
  log.into(finish(pub, h));
  pub.seats[7].status = 'thinking';
  return fixture({
    name: 'offers-12', description: '10 seats, Connect round, 12 open offers with every response state', now,
    seat: 'p1', pub, views: [me(pub, 'p1', h.p1), me(pub, 'p0', h.p0), me(pub, 'p9', h.p9)],
  });
}

export function connect6() {
  const now = T0 + 3_500_000, pub = midGame(6, { cpu: [5], round: 4 });
  pub.settings.mode = 'connect';
  Object.assign(pub.turn, { stage: 'round', active: 'p3', next: 'p4' });
  pub.now = { seats: ['p0', 'p2', 'p3', 'p5'], title: 'Round 4', detail: 'Build and trade · 2 of 6 done' };
  const log = new Log(now - 25_000), h = hands(pub);
  log.add({ kind: 'turn', seat: 'p3', stage: 'round', round: 4, text: 'Round 4: Dee rolls' }, 0);
  log.roll(pub, 'p3', [2, 4], 1500);
  clock(pub, 'main', pub.seats.map(s => s.id), now - 20_000, 'acting');
  log.into(finish(pub, h));
  for (const i of [1, 4]) Object.assign(pub.seats[i], { ready: true, status: 'ready' });
  pub.seats[5].status = 'thinking';
  return fixture({
    name: 'connect-6', now, seat: 'p0', pub,
    description: 'Connect action window: 2 of 6 done, round timer running',
    views: [me(pub, 'p0', h.p0), me(pub, 'p1', h.p1)],
  });
}

/** Stress board: every land vertex holds a building and every land edge a road, 10 seats cycling. */
export function max10() {
  const now = T0 + 5_000_000, pub = makeView(board(10), makeSeats(10, { long: true, cpu: [5, 6, 7, 8, 9] }), {
    stage: 'main', settings: { targetPoints: 20 },
    turn: { id: 180, round: 14, active: 'p4', partner: 'p9', next: 'p5' },
    now: ['Christopher Diaz plays', 'Penelope Vasquez builds at the same time'],
  });
  const land = new Set(pub.board.tiles.filter(t => t.terrain !== 'sea').map(t => t.id));
  pub.board.vertices.filter(v => v.tiles.some(t => land.has(t))).forEach((v, i) => {
    pub.pieces.buildings[v.id] = { vertex: v.id, seat: sid(i % 10), kind: i % 3 ? 'settlement' : 'city' };
  });
  pub.board.edges.filter(e => e.land).forEach((e, i) => {
    pub.pieces.routes[e.id] = { edge: e.id, seat: sid((i + 3) % 10), kind: 'road' };
  });
  pub.mapRev = 400;
  pub.awards = { 'longest-road': 'p3', 'largest-army': 'p7' };
  const log = new Log(now - 8000), h = hands(pub);
  log.add({ kind: 'turn', seat: 'p4', stage: 'roll', round: 14, text: 'Christopher Diaz to roll' }, 0);
  log.roll(pub, 'p4', [6, 2], 1500);
  clock(pub, 'main', ['p4'], now - 5000, 'acting');
  log.into(finish(pub, h));
  Object.assign(pub.seats[9], { status: 'paired', deadline: now + 40_000 });
  return fixture({
    name: 'max-10', now, seat: 'p4', pub,
    description: '10 seats, late game, every vertex and edge occupied (max pieces)',
    views: [me(pub, 'p4', h.p4), me(pub, 'p9', h.p9)],
  });
}

function stats(pub: PublicView, rounds: number): Results['stats'] {
  const seat = (i: number): SeatStats => ({
    gained: { wood: 8 + i, brick: 6, wool: 9 - i, grain: 7, ore: 5 + (i % 3) }, produced: 35 - i * 2, blocked: i % 4,
    robbed: i % 3, stole: (i + 1) % 3, discarded: i % 2 ? 4 : 0, trades: 3 + i, bankTrades: 2, devBought: i % 4,
    knights: i === 1 ? 4 : i % 2, longestRoute: 4 + i, largestHand: 8 + (i % 5), timeouts: i === 5 ? 2 : 0,
    opportunities: rounds * 2,
  });
  const dice = [0, 0, 3, 5, 8, 11, 14, 17, 13, 10, 8, 5, 2];
  const vp = (final: number) =>
    Array.from({ length: rounds }, (_, r) => Math.round(2 + (final - 2) * (r / (rounds - 1))));
  return {
    dice,
    seats: Object.fromEntries(pub.seats.map((s, i) => [s.id, seat(i)])),
    vpByRound: Object.fromEntries(pub.seats.map(s => [s.id, vp(s.vp)])),
  };
}

function finaleTable(now: number, stage: 'finale' | 'ended') {
  const pub = midGame(6, { cpu: [4, 5], round: 12 });
  upgrade(pub, 'p2', 2);
  pub.awards = { 'longest-road': 'p2', 'largest-army': 'p2' };
  Object.assign(pub.turn, { stage, active: 'p2', next: null });
  pub.now = { seats: ['p2'], title: 'Cy wins!', detail: '10 points with 2 hidden victory cards' };
  const log = new Log(now - 6000), h = hands(pub);
  const finaleAt = stage === 'finale' ? now - 2000 : now - FINALE_MS - 500;
  finish(pub, h);
  log.add({ kind: 'win', seats: ['p2'], reason: 'target', text: 'Cy wins with 10 points' }, 4000);
  const hidden: Record<SeatId, number> = { p2: 2, p4: 1 };
  const standings = pub.seats.map(s => ({
    seat: s.id, vp: s.vp + (hidden[s.id] ?? 0),
    parts: hidden[s.id] ? [...s.parts, victoryPart(hidden[s.id])] : s.parts,
  }));
  pub.results = {
    winners: ['p2'], finaleAt, completeAt: finaleAt + FINALE_MS, reason: 'target', rounds: 12, opportunities: 144,
    durationMs: 41 * 60_000,
    standings: standings.map(s => ({ ...s, rank: 1 + standings.filter(x => x.vp > s.vp).length }))
      .sort((a, b) => a.rank - b.rank),
    stats: stats(pub, 12),
  };
  log.into(pub);
  const dev = ['d8', 'd9'].map(id => ({ id, kind: 'victory' as const, playable: false, why: null }));
  return fixture({
    name: `${stage}-6`, description: stage === 'finale' ? 'Finale hold: results public, hidden VP reveal plays'
      : 'Ended: results shown after the finale', now, seat: 'p2', pub,
    views: [me(pub, 'p2', h.p2, { dev }), me(pub, 'p0', h.p0)],
  });
}

export const finale6 = () => finaleTable(T0 + 6_000_000, 'finale');
export const ended6 = () => finaleTable(T0 + 6_100_000, 'ended');
