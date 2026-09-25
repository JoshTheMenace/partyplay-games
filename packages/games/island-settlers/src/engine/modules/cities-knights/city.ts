/**
 * Cities: commodity production, the Aqueduct, improvements and metropolises, city walls, pillage,
 * and the level-3 Trading House rate. Improvements and walls are `city` commands.
 */
import { pips } from '../../../geometry';
import {
  COMMODITIES, RESOURCES, TRACKS, type Building, type Cards, type Command, type Good, type Resource, type SeatId,
  type Track, type VertexId, type Why,
} from '../../../model';
import { boardIndex } from '../../board/lookup';
import { toCards, transfer } from '../../cards';
import { choice, command, pickField, cardsField } from '../../commands';
import { emit } from '../../events';
import { face, piecesLeft, why } from '../../legal';
import { placeBuilding } from '../../pieces';
import { openPrompt } from '../../prompts';
import { gained } from '../../stats';
import { seatName, type OpenPrompt, type RollDraft, type State } from '../../state';
import { addCoins } from '../explorers/state';
import type { Answer, PromptSpec } from '../registry';
import {
  acting, cities, ck, level, MAX_WALLS, note, sx, TRACK_GOOD, TRACK_LABEL,
} from './state';

const SPLIT: Partial<Record<Resource, Good>> = { wood: 'paper', wool: 'cloth', ore: 'coin' };

/** Cities on forest, pasture and mountains take 1 resource + 1 commodity instead of 2 resources. */
export function produceCommodities(_s: State, roll: RollDraft) {
  roll.grants = roll.grants.flatMap(g => {
    const commodity = SPLIT[g.good as Resource];
    return commodity && g.amount >= 2
      ? [{ ...g, amount: g.amount - 1 }, { ...g, good: commodity, amount: 1 }] : [g];
  });
}

/**
 * Science 3 (Aqueduct): a seat that received nothing on a non-7 roll takes 1 resource of choice.
 * E&P + C&K: on a 7 (`roll` null) it also applies, with 1 gold.
 */
export function aqueduct(s: State, roll: RollDraft | null) {
  for (const id of s.order) {
    const paid = !!roll && (roll.grants.some(g => g.seat === id) || (roll.gold[id] ?? 0) > 0);
    if (!paid && level(s, id, 'science') >= 3 && RESOURCES.some(g => s.bank[g] > 0)) {
      const data = { count: 1, gold: !roll };
      openPrompt(s, { seat: id, kind: 'cities-knights/aqueduct', scope: 'table', data });
    }
  }
}

const withGold = (p: OpenPrompt) => !!(p.data as { gold?: boolean }).gold;

export const aqueductPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Takes what you hold fewest of', label: 'Aqueduct',
  command: (s, p) => command({
    id: p.id, module: 'cities-knights', group: 'city', label: 'Aqueduct: take 1 resource', hint: 1,
    detail: withGold(p) ? 'A 7: take 1 resource and 1 gold' : 'You received nothing this roll',
    fields: [cardsField('cards', 'Resource', 'bank', toCards(s.bank), 1, 1, RESOURCES)],
  }),
  apply(s, p, a) {
    transfer(s.bank, s.seats[p.seat].hand, a.cards.cards);
    gained(s, p.seat, a.cards.cards);
    if (withGold(p)) addCoins(s, p.seat, 1);
    emit(s, { kind: 'take', seat: p.seat, cards: a.cards.cards, text: `${seatName(s, p.seat)} used the Aqueduct` });
  },
  auto(s, p) {
    const hand = s.seats[p.seat].hand, open = RESOURCES.filter(g => s.bank[g] > 0);
    const g = open.reduce((a, b) => (hand[b] < hand[a] ? b : a), open[0]);
    return { picks: {}, cards: { cards: g ? { [g]: 1 } : {} } };
  },
};

// ---------------------------------------------------------------- metropolises and improvements

export const metropolisAt = (s: State, track: Track) =>
  Object.values(s.pieces.buildings).find(b => b.metropolis === track) ?? null;

/** Own cities without a metropolis (where a new metropolis may stand, and the only ones pillage can hit). */
export const plainCities = (s: State, seat: SeatId) => cities(s, seat).filter(b => !b.metropolis);

/** Reaching level 4 first, or 5 before the holder, takes the track's metropolis. */
function captures(s: State, seat: SeatId, track: Track, next: number) {
  const held = metropolisAt(s, track);
  return next >= 4 && held?.seat !== seat && (!held || level(s, held.seat, track) < next);
}

const without = ({ metropolis: _m, wall: _w, ...b }: Building, keep: 'wall' | 'metropolis'): Building =>
  keep === 'wall' && _w ? { ...b, wall: true } : keep === 'metropolis' && _m ? { ...b, metropolis: _m } : b;

/** Why the seat cannot climb `track` now (cost aside), else null. */
export function improveWhy(s: State, seat: SeatId, track: Track): Why | null {
  const next = level(s, seat, track) + 1;
  if (next > 5) return why('limit', 'Track complete');
  if (!cities(s, seat).length) return why('rule', 'Build a city first');
  const homeless = captures(s, seat, track, next) && !plainCities(s, seat).length;
  if (homeless) return why('no-spot', 'No city for the metropolis');
  return null;
}

/** Metropolis city field when this step captures and there is a real choice. */
export function metropolisFields(s: State, seat: SeatId, track: Track) {
  const spots = plainCities(s, seat).map(b => b.vertex), next = level(s, seat, track) + 1;
  if (!captures(s, seat, track, next) || spots.length < 2) return [];
  return [pickField('city', 'Metropolis city', spots.map(v => choice(v, cityLabel(s, v))), 'vertex')];
}

/** Climb one level (cost already paid); a capture moves the metropolis to `city`. */
export function improve(s: State, seat: SeatId, track: Track, city?: string) {
  const x = sx(s, seat), next = x.improvements[track] + 1;
  if (captures(s, seat, track, next)) {
    const held = metropolisAt(s, track), at = city ?? plainCities(s, seat)[0].vertex;
    if (held) placeBuilding(s, without(held, 'wall'));
    placeBuilding(s, { ...s.pieces.buildings[at], metropolis: track });
    const text = `${seatName(s, seat)} takes the ${TRACK_LABEL[track]} metropolis`;
    emit(s, { kind: 'build', seat, piece: 'metropolis', spot: at, free: false, text });
  }
  x.improvements[track] = next;
  note(s, 'improve', seat, track, `${seatName(s, seat)} improved ${TRACK_LABEL[track]} to ${next}`);
}

export const improveCost = (s: State, seat: SeatId, track: Track, discount = 0): Cards =>
  toCards({ [TRACK_GOOD[track]]: Math.max(0, level(s, seat, track) + 1 - discount) });

const ABILITY: Record<Track, string> = {
  science: 'Level 3: Aqueduct (1 resource when a roll pays you nothing).',
  trade: 'Level 3: Trading House (commodities trade 2:1).',
  politics: 'Level 3: Fortress (promote knights to mighty).',
};

/** "Hills 5 / Forest 8" */
export function cityLabel(s: State, v: VertexId) {
  const tiles = boardIndex(s.board).vertex.get(v)?.tiles ?? [];
  const faces = tiles.map(t => face(s, t)).filter(f => f.number);
  return faces.map(f => `${f.terrain} ${f.number}`).join(' / ') || 'City';
}

export const pipsAt = (s: State, v: VertexId) =>
  (boardIndex(s.board).vertex.get(v)?.tiles ?? []).reduce((n, t) => n + pips(face(s, t).number), 0);

/** Improve (one command per open track) and City wall commands. */
export function cityCommands(s: State, seat: SeatId): Command[] {
  if (!acting(s, seat)) return [];
  const out: Command[] = [];
  for (const track of TRACKS) {
    if (improveWhy(s, seat, track)) continue;
    const next = level(s, seat, track) + 1, capture = captures(s, seat, track, next);
    const detail = capture ? 'Takes the metropolis (+2 points).' : next === 3 ? ABILITY[track]
      : `Draw ${TRACK_LABEL[track].toLowerCase()} cards on a red ${next + 1} or less.`;
    out.push(command({
      id: `ck:improve:${track}`, module: 'cities-knights', group: 'city', cost: improveCost(s, seat, track),
      label: `${TRACK_LABEL[track]} to ${next}`, detail, hint: capture ? 0.97 : 0.9 - next * 0.02,
      fields: metropolisFields(s, seat, track),
    }));
  }
  const bare = cities(s, seat).filter(b => !b.wall), walls = cities(s, seat).length - bare.length;
  if (bare.length && walls < MAX_WALLS) {
    const big = Object.values(s.seats[seat].hand).reduce((a, b) => a + b, 0) > 7;
    out.push(command({
      id: 'ck:wall', module: 'cities-knights', group: 'city', cost: { brick: 2 }, label: 'City wall',
      detail: 'Hold 2 more cards when a 7 is rolled (up to 3 walls).', hint: big ? 0.6 : 0.3,
      fields: [pickField('city', 'City', bare.map(b => choice(b.vertex, cityLabel(s, b.vertex))), 'vertex')],
    }));
  }
  return out;
}

export function buildWall(s: State, seat: SeatId, v: VertexId, free: boolean) {
  placeBuilding(s, { ...s.pieces.buildings[v], wall: true });
  emit(s, { kind: 'build', seat, piece: 'wall', spot: v, free, text: `${seatName(s, seat)} built a city wall` });
}

export function applyCity(s: State, seat: SeatId, id: string, a: Answer) {
  const [, what, track] = id.split(':');
  if (what === 'wall') return buildWall(s, seat, a.picks.city, false);
  improve(s, seat, track as Track, a.picks.city);
}

// ---------------------------------------------------------------- walls, pillage, rates

export const wallBonus = (s: State, seat: SeatId) => 2 * cities(s, seat).filter(b => b.wall).length;

/** The barbarians reduce a city to a settlement (its wall goes too). */
export function pillage(s: State, seat: SeatId, v: VertexId) {
  if (piecesLeft(s, seat, 'settlement') <= 0) ck(s).overflow.push(v);
  placeBuilding(s, { ...without(s.pieces.buildings[v], 'metropolis'), kind: 'settlement' });
  note(s, 'pillage', seat, v, `Barbarians pillaged ${seatName(s, seat)}'s city`);
}

/** A city pillaged with no settlement in supply must be rebuilt before any other upgrade. */
export function cityVeto(s: State, seat: SeatId, v: VertexId): Why | null {
  const owed = ck(s).overflow.filter(x => s.pieces.buildings[x]?.seat === seat
    && s.pieces.buildings[x].kind !== 'city');
  return owed.length && !owed.includes(v) ? why('rule', 'Rebuild your pillaged city first') : null;
}

export function afterCityBuilt(s: State, v: VertexId) {
  const x = ck(s);
  if (s.pieces.buildings[v]?.kind === 'city' && x.overflow.includes(v)) x.overflow = x.overflow.filter(o => o !== v);
}

/** Trading House (trade 3): commodities 2:1. Merchant: its hex's resource 2:1. Merchant Fleet: 2:1. */
export function cityRates(s: State, seat: SeatId, r: Record<Good, number>) {
  const two = (g: Good) => { r[g] = Math.min(r[g], 2); };
  if (level(s, seat, 'trade') >= 3) COMMODITIES.forEach(two);
  const m = s.pieces.merchant, good = m && (face(s, m.tile).terrain as Good);
  if (m?.seat === seat && good && RESOURCES.includes(good as Resource)) two(good);
  sx(s, seat).fleet.forEach(two);
}
