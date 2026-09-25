/**
 * Prompts: `explorers/pirate` (E&P "Activate the pirate ship": after a 7's discards, or a won
 * chase, the seat puts its own pirate ship on an explored sea hex away from the starting island and
 * robs a seat with a ship on that hex, taking 1 gold from a seat with no cards) and
 * `explorers/launch` (setup: the starting ship with its settler, beside the new harbor settlement).
 */
import type { Answer, PromptSpec } from '../registry';
import type { SeatId, TileId, Unit } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { total } from '../../cards';
import { choice, command, pickField } from '../../commands';
import { emit, inbox } from '../../events';
import { openPrompt, steal } from '../../prompts';
import { placeUnit, setPirate } from '../../pieces';
import { publicVp } from '../../stats';
import { nextId, seatName, type OpenPrompt, type State } from '../../state';
import { navigable } from './sea';
import { addCoins, coins, ext, LIMITS, shipsOn, terrain } from './state';

/** Explored sea hexes of the discovery region (never beside the starting island or on the frame). */
export const pirateTiles = (s: State): TileId[] => Object.keys(s.hidden).filter(t => t !== s.pieces.pirate
  && s.pieces.reveals[t] && (terrain(s, t) === 'sea' || terrain(s, t) === 'shoal'));

/** Seats other than `seat` with a ship on one of the hex's edges and something to steal. */
function marks(s: State, seat: SeatId, tile: TileId): SeatId[] {
  const edges = boardIndex(s.board).tileEdges.get(tile) ?? [];
  const owners = Object.values(s.pieces.units).filter(u => u.kind === 'expedition' && edges.includes(u.at))
    .map(u => u.seat!);
  return [...new Set(owners)].filter(id => id !== seat && (total(s.seats[id].hand) > 0 || coins(s, id) > 0));
}

export function openPirate(s: State, seat: SeatId, scope: 'table' | 'self') {
  if (pirateTiles(s).length) openPrompt(s, { seat, kind: 'explorers/pirate', scope });
}

const pirate: PromptSpec = {
  timer: 'robber', autoText: "Sails at the leader's ships", label: 'Moving the pirate',
  command: (s, p) => command({
    id: p.id, module: 'explorers', group: 'ships', label: 'Place your pirate ship',
    detail: 'Pick an explored sea hex; rob a seat with a ship there',
    fields: [pickField('tile', 'Sea hex', pirateTiles(s).map(t => {
      const who = marks(s, p.seat, t);
      const pick = pickField('victim', 'Player to rob', who.map(v => choice(v, seatName(s, v))), 'seat');
      const detail = who.length ? `Rob ${who.map(v => seatName(s, v)).join(' or ')}` : 'Nobody to rob';
      return choice(t, 'Sea hex', detail, who.length > 1 ? [pick] : []);
    }), 'tile')],
  }),
  apply(s: State, p: OpenPrompt, a: Answer) {
    const tile = a.picks.tile, who = marks(s, p.seat, tile), x = ext(s), from = s.pieces.pirate;
    const victim = a.picks.victim ?? (who.length === 1 ? who[0] : null);
    setPirate(s, tile);
    x.pirate = p.seat;
    x.hauls = x.hauls.filter(t => t !== tile);
    emit(s, { kind: 'robber', seat: p.seat, piece: 'pirate', from, tile, victim,
      text: `${seatName(s, p.seat)} placed the pirate ship` });
    if (!victim) return;
    if (total(s.seats[victim].hand)) { steal(s, p.seat, victim); return; }
    addCoins(s, victim, -1);
    addCoins(s, p.seat, 1);
    const [by, whom] = [seatName(s, p.seat), seatName(s, victim)];
    inbox(s, victim, { text: `${by}'s pirates took 1 gold`, cards: {}, tone: 'loss', other: p.seat });
    inbox(s, p.seat, { text: `You took 1 gold from ${whom}`, cards: {}, tone: 'gain', other: victim });
  },
  auto(s, p) {
    const tiles = pirateTiles(s), rank = (id: SeatId) => publicVp(s, id) * 100 + total(s.seats[id].hand);
    const value = (t: TileId) => Math.max(-1, ...marks(s, p.seat, t).map(rank));
    const tile = tiles.reduce((a, b) => (value(b) > value(a) ? b : a), tiles[0]);
    const who = marks(s, p.seat, tile);
    const victim = who.reduce((a, b) => (rank(b) > rank(a) ? b : a), who[0]);
    const picks: Record<string, string> = who.length > 1 ? { tile, victim } : { tile };
    return { picks, cards: {} };
  },
};

/** Sea edges beside the new harbor settlement where the starting ship may go. */
const launchEdges = (s: State, p: OpenPrompt) => {
  const v = (p.data as { vertex: string }).vertex;
  return (boardIndex(s.board).vertex.get(v)?.edges ?? []).filter(e => navigable(s, e) && !shipsOn(s, e));
};

const launch: PromptSpec = {
  timer: 'prompt', autoText: 'Launches the ship for you', label: 'Launching a ship',
  command: (s, p) => command({
    id: p.id, module: 'explorers', group: 'ships', label: 'Launch your ship',
    detail: 'Your starting ship carries a settler',
    fields: [pickField('at', 'Sea edge', launchEdges(s, p).map(e => choice(e, 'Sea edge')), 'edge')],
  }),
  apply(s, p, a) {
    const unit: Unit = {
      id: nextId(s, 'x'), kind: 'expedition', seat: p.seat, at: a.picks.at, level: LIMITS.slots, active: true,
      cargo: ['settler'],
    };
    placeUnit(s, unit);
    emit(s, { kind: 'build', seat: p.seat, piece: 'expedition', spot: unit.at, free: true,
      text: `${seatName(s, p.seat)} launched a ship with a settler` });
  },
  auto: (s, p) => ({ picks: { at: launchEdges(s, p)[0] }, cards: {} }),
};

export const PROMPTS: Record<string, PromptSpec> = { pirate, launch };
