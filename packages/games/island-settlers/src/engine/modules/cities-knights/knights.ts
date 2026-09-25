/**
 * Knights (units of kind 'knight', level = strength 1-3): recruit, activate, promote, and the three
 * knight actions (move, displace, chase the robber or pirate). A knight activated this opportunity
 * cannot act until the next one; acting always deactivates it. Knights block opponents' routes.
 */
import { pips } from '../../../geometry';
import type { Command, EdgeId, PickField, SeatId, TileId, Unit, VertexId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { face, robberTiles, victims } from '../../legal';
import { placeUnit, removeUnit, setPirate, setRobber, updateUnit } from '../../pieces';
import { openPrompt, steal } from '../../prompts';
import { publicVp } from '../../stats';
import { nextId, seatName, type State } from '../../state';
import type { Answer, PromptSpec } from '../registry';
import {
  acting, cities, ck, empty, hasPrompt, knightAt, knightsOf, LENGTH, level, note, PER_LEVEL, shipTrack,
} from './state';

type Piece = 'robber' | 'pirate';

/** Knights never stand next to unexplored (fog) hexes (E&P + C&K). */
const clear = (s: State, v: VertexId) =>
  (boardIndex(s.board).vertex.get(v)?.tiles ?? []).every(t => face(s, t).terrain !== 'fog');

const touchesRoute = (s: State, seat: SeatId, v: VertexId) =>
  (boardIndex(s.board).vertex.get(v)?.edges ?? []).some(e => s.pieces.routes[e]?.seat === seat);

/** A building next door: no settlement can ever go here, so a knight costs no future build site. */
const crowded = (s: State, v: VertexId) =>
  (boardIndex(s.board).vertexNeighbors.get(v) ?? []).some(n => s.pieces.buildings[n]);

/** Empty intersections next to the seat's roads or ships (no distance rule), dead sites first. */
export const recruitSites = (s: State, seat: SeatId) => s.board.vertices.map(v => v.id)
  .filter(v => empty(s, v) && clear(s, v) && touchesRoute(s, seat, v))
  .sort((a, b) => Number(crowded(s, b)) - Number(crowded(s, a)));

/**
 * Walk the seat's continuous routes from `from`, passing its own pieces but never an opponent's:
 * `open` are empty corners to stop on, `foes` opponent knights met on the way.
 */
export function reach(s: State, seat: SeatId, from: VertexId): { open: VertexId[]; foes: VertexId[] } {
  const ix = boardIndex(s.board), seen = new Set([from]), queue = [from];
  const open: VertexId[] = [], foes: VertexId[] = [];
  while (queue.length) {
    const v = queue.shift()!;
    for (const e of ix.vertex.get(v)?.edges ?? []) {
      const edge = ix.edge.get(e)!, w = edge.a === v ? edge.b : edge.a;
      if (s.pieces.routes[e]?.seat !== seat || seen.has(w)) continue;
      seen.add(w);
      const b = s.pieces.buildings[w], k = knightAt(s, w);
      if (b && b.seat !== seat) continue;
      if (k && k.seat !== seat) { foes.push(w); continue; }
      if (empty(s, w) && clear(s, w)) open.push(w);
      queue.push(w);
    }
  }
  return { open, foes };
}

const meta = (s: State, id: string) => (ck(s).knights[id] ??= { activated: -1, promoted: -1 });
const opportunity = (s: State, seat: SeatId) => s.seats[seat].opportunity;

/** Active since before this opportunity: may take a knight action. */
export const ready = (s: State, k: Unit) => k.active && meta(s, k.id).activated !== opportunity(s, k.seat!);

export const onBoard = (s: State, seat: SeatId, lvl: number) => knightsOf(s, seat).filter(k => k.level === lvl).length;

/** Promotion: once per knight per opportunity, a free piece of the next level, Fortress for mighty. */
export function promotable(s: State, k: Unit) {
  const next = k.level + 1;
  return next <= 3 && (next < 3 || level(s, k.seat!, 'politics') >= 3) && onBoard(s, k.seat!, next) < PER_LEVEL
    && meta(s, k.id).promoted !== opportunity(s, k.seat!);
}

export function promote(s: State, k: Unit) {
  meta(s, k.id).promoted = opportunity(s, k.seat!);
  updateUnit(s, k.id, { level: k.level + 1 });
  note(s, 'promote', k.seat, k.at, `${seatName(s, k.seat)} promoted a knight to level ${k.level}`);
}

export function activate(s: State, k: Unit) {
  meta(s, k.id).activated = opportunity(s, k.seat!);
  updateUnit(s, k.id, { active: true });
  note(s, 'activate', k.seat, k.at, `${seatName(s, k.seat)} activated a knight`);
}

export function recruit(s: State, seat: SeatId, at: VertexId, lvl = 1, active = false) {
  const id = nextId(s, 'k');
  placeUnit(s, { id, kind: 'knight', seat, at, level: lvl, active, cargo: [] });
  if (active) meta(s, id).activated = opportunity(s, seat);
  const text = `${seatName(s, seat)} placed a knight`;
  emit(s, { kind: 'build', seat, piece: 'knight', spot: at, free: lvl > 1, text });
}

/** A knight that may be displaced now: its owner is not already retreating one (one prompt per kind). */
export const displaceable = (s: State, k: Unit) => !hasPrompt(s, k.seat!, 'retreat');

/** Take a knight off the board; its owner retreats it along their routes, or loses it if it cannot. */
export function displace(s: State, k: Unit) {
  removeUnit(s, k.id);
  if (!reach(s, k.seat!, k.at).open.length) return lose(s, k.id, k.seat!, k.at);
  const data = { id: k.id, from: k.at, level: k.level, active: k.active };
  openPrompt(s, { seat: k.seat!, kind: 'cities-knights/retreat', scope: 'self', data });
}

function lose(s: State, id: string, seat: SeatId, at: VertexId) {
  delete ck(s).knights[id];
  note(s, 'knight-lost', seat, at, `${seatName(s, seat)}'s knight had nowhere to retreat`);
}

type Retreat = { id: string; from: VertexId; level: number; active: boolean };

export const retreatPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Retreats to the first free corner', label: 'Retreating a knight',
  command(s, p) {
    const d = p.data as Retreat, spots = reach(s, p.seat, d.from).open;
    return command({
      id: p.id, module: 'cities-knights', group: 'knights', label: 'Retreat your knight', hint: 1,
      // Its corners can fill up while the prompt is open (Connect): an empty pick loses the knight.
      detail: spots.length ? 'It was displaced: move it along your routes' : 'Nowhere left to retreat',
      fields: spots.length ? [pickField('at', 'Retreat to', spots.map(v => choice(v, 'Free corner')), 'vertex')] : [],
    });
  },
  apply(s, p, a) {
    const d = p.data as Retreat;
    const { id, level: lvl, active } = d;
    if (!a.picks.at) return lose(s, id, p.seat, d.from);
    placeUnit(s, { id, kind: 'knight', seat: p.seat, at: a.picks.at, level: lvl, active, cargo: [] });
    emit(s, { kind: 'move', seat: p.seat, piece: 'knight', unit: d.id, from: d.from, to: a.picks.at,
      text: `${seatName(s, p.seat)}'s knight retreated` });
  },
  auto(s, p): Answer {
    const at = reach(s, p.seat, (p.data as Retreat).from).open[0];
    return { picks: at ? { at } : {}, cards: {} };
  },
};

// ---------------------------------------------------------------- robber / pirate

/** How much moving the robber to `tile` hurts others (leaders weigh more), never ourselves. */
export function hurt(s: State, seat: SeatId, tile: TileId) {
  const n = pips(face(s, tile).number);
  return (boardIndex(s.board).tileVertices.get(tile) ?? []).reduce((v, x) => {
    const b = s.pieces.buildings[x];
    if (!b) return v;
    return v + (b.seat === seat ? -100 : n * (b.kind === 'city' ? 2 : 1) * (1 + publicVp(s, b.seat) / 5));
  }, 0);
}

/** Hex field (best first) with a dependent victim pick where there is a choice. */
export function hexField(s: State, seat: SeatId, piece: Piece): PickField {
  const tiles = robberTiles(s, seat, piece).sort((a, b) => hurt(s, seat, b) - hurt(s, seat, a));
  return pickField('tile', 'Hex', tiles.map(t => {
    const who = victims(s, seat, t, piece);
    const pick = pickField('victim', 'Player to rob', who.map(v => choice(v, seatName(s, v))), 'seat');
    const detail = who.length ? `Rob ${who.map(v => seatName(s, v)).join(' or ')}` : 'Nobody to rob';
    return choice(t, `${face(s, t).terrain} ${face(s, t).number || ''}`.trim(), detail, who.length > 1 ? [pick] : []);
  }), 'tile');
}

export function moveThief(s: State, seat: SeatId, piece: Piece, tile: TileId, victim?: string) {
  const from = piece === 'robber' ? s.pieces.robber : s.pieces.pirate, who = victims(s, seat, tile, piece);
  (piece === 'robber' ? setRobber : setPirate)(s, tile);
  const robbed = victim ?? (who.length === 1 ? who[0] : null);
  const text = `${seatName(s, seat)} moved the ${piece}`;
  emit(s, { kind: 'robber', seat, piece, from, tile, victim: robbed, text });
  if (robbed) steal(s, seat, robbed);
}

/** Robber and/or pirate on a hex touching `v`. */
function thievesAt(s: State, v: VertexId): Piece[] {
  const tiles = boardIndex(s.board).vertex.get(v)?.tiles ?? [];
  const out: Piece[] = [];
  if (s.profile.robber && s.pieces.robber && tiles.includes(s.pieces.robber)) out.push('robber');
  if (s.profile.pirate && s.pieces.pirate && tiles.includes(s.pieces.pirate)) out.push('pirate');
  return out;
}

// ---------------------------------------------------------------- commands

const threat = (s: State) => (shipTrack(s) ? ck(s).position / LENGTH : 0.4);

export function knightCommands(s: State, seat: SeatId): Command[] {
  if (!shipTrack(s) || !acting(s, seat)) return [];
  const mine = knightsOf(s, seat), out: Command[] = [];
  const potential = mine.reduce((n, k) => n + k.level, 0), short = cities(s, seat).length + 1 - potential;
  const k = (c: Omit<Parameters<typeof command>[0], 'module' | 'group'>) =>
    out.push(command({ module: 'cities-knights', group: 'knights', ...c }));
  const sites = recruitSites(s, seat);
  if (onBoard(s, seat, 1) < PER_LEVEL && sites.length) {
    k({ id: 'ck:recruit', label: 'Recruit a knight', detail: 'A basic knight next to your road (starts inactive)',
      cost: { wool: 1, ore: 1 }, hint: short > 0 ? 0.8 : 0.35,
      fields: [pickField('at', 'Corner', sites.map(v => choice(v, 'Free corner')), 'vertex')] });
  }
  for (const u of mine) {
    const name = `level ${u.level} knight`;
    if (!u.active) {
      k({ id: `ck:activate:${u.id}`, label: `Activate ${name}`, detail: 'Defends now; acts from your next turn',
        cost: { grain: 1 }, hint: threat(s) >= 0.4 ? 0.88 : 0.55, fields: [] });
    }
    if (promotable(s, u)) {
      k({ id: `ck:promote:${u.id}`, label: `Promote ${name}`, detail: `Strength ${u.level + 1}; keeps its status`,
        cost: { wool: 1, ore: 1 }, hint: short > 0 ? 0.7 : 0.4, fields: [] });
    }
    if (!ready(s, u)) continue;
    const { open, foes } = reach(s, seat, u.at);
    const weaker = foes.filter(v => knightAt(s, v)!.level < u.level && displaceable(s, knightAt(s, v)!));
    if (open.length || weaker.length) {
      const spots = [...weaker.map(v => choice(v, `Displace ${seatName(s, knightAt(s, v)!.seat)}'s knight`)),
        ...open.map(v => choice(v, 'Free corner'))];
      k({ id: `ck:move:${u.id}`, label: `Move ${name}`, detail: 'Along your routes; displaces a weaker knight',
        cost: null, hint: weaker.length && threat(s) < 0.5 ? 0.55 : 0.1,
        fields: [pickField('at', 'Destination', spots, 'vertex')] });
    }
    const pieces = thievesAt(s, u.at).filter(p => robberTiles(s, seat, p).length);
    if (!pieces.length) continue;
    const mineHit = pieces.some(p => hurt(s, seat, (p === 'robber' ? s.pieces.robber : s.pieces.pirate)!) < 0);
    const fields = pieces.length === 1 ? [hexField(s, seat, pieces[0])]
      : [pickField('piece', 'Piece', pieces.map(p => choice(p, p, '', [hexField(s, seat, p)])))];
    k({ id: `ck:chase:${u.id}`, label: `Chase the ${pieces.join(' or ')}`, detail: 'Move it and steal 1 card',
      cost: null, hint: mineHit ? 0.8 : 0.25, fields });
  }
  return out;
}

export function applyKnight(s: State, seat: SeatId, id: string, a: Answer) {
  const [, what, unit] = id.split(':'), u = s.pieces.units[unit];
  if (what === 'recruit') return recruit(s, seat, a.picks.at);
  if (what === 'activate') return activate(s, u);
  if (what === 'promote') return promote(s, u);
  updateUnit(s, u.id, { active: false });
  if (what === 'chase') {
    const piece = (a.picks.piece ?? thievesAt(s, u.at).find(p => robberTiles(s, seat, p).length)) as Piece;
    return moveThief(s, seat, piece, a.picks.tile, a.picks.victim);
  }
  const foe = knightAt(s, a.picks.at), from = u.at;
  if (foe) displace(s, foe);
  updateUnit(s, u.id, { at: a.picks.at });
  emit(s, { kind: 'move', seat, piece: 'knight', unit: u.id, from, to: a.picks.at,
    text: `${seatName(s, seat)} ${foe ? 'displaced a knight' : 'moved a knight'}` });
}

/** Seafarers + C&K: a ship may not sail away from under a knight it connects. */
export function shipVeto(s: State, seat: SeatId, from: EdgeId) {
  const edge = boardIndex(s.board).edge.get(from)!;
  return [edge.a, edge.b].some(v => knightAt(s, v)?.seat === seat && !s.pieces.buildings[v]
    && !(boardIndex(s.board).vertex.get(v)?.edges ?? []).some(e => e !== from && s.pieces.routes[e]?.seat === seat));
}
