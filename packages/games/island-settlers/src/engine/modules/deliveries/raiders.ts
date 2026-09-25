/**
 * Road barbarians (`raider` units on edges; 3 / 4 / 5 by table size). A 7 or a Knight moves one to an
 * edge without a barbarian and robs that edge's road owner; a successful drive-off moves it without
 * robbing. With Barbarian Attack the coastal invaders block wagon paths instead (ENGINE §14.4 rule 7),
 * so a drive-off sends one of them to another unconquered coastal hex.
 */
import type { EdgeId, SeatId, TileId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { total } from '../../cards';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { face } from '../../legal';
import { need } from '../../need';
import { placeUnit, updateUnit } from '../../pieces';
import { openPrompt, steal } from '../../prompts';
import { shuffle } from '../../rng';
import { publicVp } from '../../stats';
import { random, seatName, type State } from '../../state';
import { conquered, facts, invaders, setInvaders, stake } from '../barbarian-attack/coast';
import type { PromptSpec } from '../registry';
import { depots } from './depots';
import { firstAnswer } from './gold';
import { raiders } from './wagon';

const homeEdges = (s: State) => {
  const ix = boardIndex(s.board);
  return s.board.edges.filter(e => e.land && e.tiles.every(t => ix.tile.get(t)?.island === 0)).map(e => e.id);
};

/** Init: spread raiders on inner edges away from the depots, no two sharing a corner. */
export function placeRaiders(s: State) {
  const ix = boardIndex(s.board), used = new Set<string>(depots(s).keys()), n = s.order.length;
  let count = n <= 4 ? 3 : n <= 6 ? 4 : 5;
  for (const e of shuffle(homeEdges(s), random(s, 'cards'))) {
    const { a, b } = ix.edge.get(e)!;
    if (count <= 0 || used.has(a) || used.has(b)) continue;
    [a, b].forEach(v => used.add(v));
    const id = `raider-${count--}`;
    placeUnit(s, { id, kind: 'raider', seat: null, at: e, level: 0, active: true, cargo: [] });
  }
}

type RaiderData = { steal: boolean; only: string[] | null };

/** Destination edges, the ones hurting the leading opponents' roads first. */
function targets(s: State, seat: SeatId): EdgeId[] {
  const taken = raiders(s), value = (e: EdgeId) => {
    const owner = s.pieces.routes[e]?.seat;
    return owner && owner !== seat ? 1 + publicVp(s, owner) + (total(s.seats[owner].hand) ? 1 : 0) : 0;
  };
  return homeEdges(s).filter(e => !taken.has(e)).sort((a, b) => value(b) - value(a));
}

export const raiderPrompt: PromptSpec = {
  timer: 'robber', autoText: "Blocks the leader's road", label: 'Moving a road barbarian',
  command(s, p) {
    const d = p.data as RaiderData, all = [...raiders(s).values()];
    const pick = pickField('raider', 'Barbarian', (d.only ?? all).map(id => choice(id, 'Barbarian')), 'unit');
    const to = pickField('edge', 'New edge', targets(s, p.seat).map(e => choice(e, 'Edge')), 'edge');
    const detail = d.steal ? "Rob the owner of the road it lands on" : 'Move it off your path';
    const label = 'Move a road barbarian', fields = [pick, to];
    return command({ id: p.id, module: 'deliveries', group: 'deliveries', label, detail, fields, hint: 0.8 });
  },
  apply(s, p, a) {
    const unit = s.pieces.units[a.picks.raider], to = a.picks.edge, d = p.data as RaiderData;
    need(unit?.kind === 'raider', 'That barbarian moved.');
    const from = unit.at, owner = s.pieces.routes[to]?.seat;
    const text = `${seatName(s, p.seat)} moved a road barbarian`;
    updateUnit(s, unit.id, { at: to });
    emit(s, { kind: 'move', seat: p.seat, piece: 'raider', unit: unit.id, from, to, text });
    if (d.steal && owner && owner !== p.seat && total(s.seats[owner].hand)) steal(s, p.seat, owner);
  },
  auto: (s, p) => firstAnswer(raiderPrompt)(s, p),
};

export const openRaider = (s: State, seat: SeatId, scope: 'table' | 'self', data: RaiderData) => {
  if (!raiders(s).size || !targets(s, seat).length) return;
  openPrompt(s, { seat, kind: 'deliveries/raider', scope, data });
};

/** Barbarian Attack combination: a driven-off invader goes to another unconquered coastal hex. */
export const invaderPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Sends it toward the leader', label: 'Driving off a barbarian',
  command(s, p) {
    const from = String(p.data), others = (t: TileId) => s.order.filter(id => id !== p.seat)
      .reduce((n, id) => n + stake(s, id, t), 0) - 3 * stake(s, p.seat, t);
    const tiles = facts(s).coast.filter(t => t !== from && !conquered(s, t))
      .sort((a, b) => others(b) - others(a));
    return command({ id: p.id, module: 'deliveries', group: 'deliveries', label: 'Drive off the barbarian',
      detail: 'Send it to another coastal hex', hint: 0.8, fields: [pickField('tile', 'Hex',
        tiles.map(t => choice(t, `The ${face(s, t).number}`, `${invaders(s, t)} barbarians`)), 'tile')] });
  },
  apply(s, p, a) {
    const from = String(p.data);
    if (!invaders(s, from)) return; // another seat already took it (Connect)
    setInvaders(s, from, invaders(s, from) - 1);
    setInvaders(s, a.picks.tile, invaders(s, a.picks.tile) + 1);
  },
  auto: (s, p) => firstAnswer(invaderPrompt)(s, p),
};
