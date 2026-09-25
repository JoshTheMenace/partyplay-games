/** Science progress cards (Printer scores on draw and never reaches a hand). */
import { pips } from '../../../geometry';
import { TRACKS, type Resource, type SeatId, type Terrain } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { transfer } from '../../cards';
import { choice, pickField } from '../../commands';
import { emit } from '../../events';
import { face, targets, why } from '../../legal';
import { placeBuilding } from '../../pieces';
import { gained } from '../../stats';
import { seatName, type State } from '../../state';
import { hooks } from '../registry';
import { buildWall, cityLabel, improve, improveCost, improveWhy, metropolisFields } from './city';
import { cities, ck, knightsOf, MAX_WALLS, note, TRACK_LABEL } from './state';
import { promotable, promote } from './knights';
import { buildHarbor, harborSites } from '../explorers/build';
import type { Play } from './play';

/** Explorers & Pirates maps: Medicine can also build a harbor settlement. */
const harbors = (s: State) => s.modules.includes('explorers');

/** Hexes of `terrain` touching at least one of the seat's buildings. */
function hexesNear(s: State, seat: SeatId, terrain: Terrain) {
  const ix = boardIndex(s.board);
  return s.board.tiles.filter(t => face(s, t.id).terrain === terrain
    && (ix.tileVertices.get(t.id) ?? []).some(v => s.pieces.buildings[v]?.seat === seat));
}

/** Irrigation / Mining: 2 of the resource per matching hex next to your buildings, bank permitting. */
const harvest = (good: Resource, terrain: Terrain): Omit<Play, 'kind'> => ({
  text: `Take 2 ${good} for each ${terrain === 'grain' ? 'field' : 'mountain'} next to your buildings.`,
  fields: () => [],
  hint(s, seat) { const n = hexesNear(s, seat, terrain).length; return n ? 0.55 + 0.1 * n : 0.05; },
  apply(s, seat) {
    const n = Math.min(2 * hexesNear(s, seat, terrain).length, s.bank[good]);
    if (!n) return;
    transfer(s.bank, s.seats[seat].hand, { [good]: n });
    gained(s, seat, { [good]: n });
    emit(s, { kind: 'take', seat, cards: { [good]: n }, text: `${seatName(s, seat)} took ${n} ${good}` });
  },
});

const dice = (key: string, label: string) =>
  pickField(key, label, [1, 2, 3, 4, 5, 6].map(n => choice(String(n), String(n))));

/** Number tokens that may be swapped (not 2, 6, 8 or 12). */
const swappable = (s: State) => s.board.tiles.map(t => t.id)
  .filter(t => ![0, 2, 6, 8, 12].includes(face(s, t).number));

const presence = (s: State, seat: SeatId, tile: string) =>
  (boardIndex(s.board).tileVertices.get(tile) ?? []).filter(v => s.pieces.buildings[v]?.seat === seat).length;

export const SCIENCE: Play[] = [
  { kind: 'alchemist', preRoll: true, text: 'Before rolling: choose both production dice.', hint: () => 0.2,
    fields: s => (ck(s).alchemy ? why('one-per-turn', 'The dice are already set') : [dice('red', 'Red die'),
      dice('yellow', 'Yellow die')]),
    apply(s, seat, a) {
      ck(s).alchemy = [Number(a.picks.red), Number(a.picks.yellow)];
      note(s, 'alchemist', seat, null, `${seatName(s, seat)} set the dice to ${a.picks.red} and ${a.picks.yellow}`);
    } },
  { kind: 'crane', text: 'One improvement costs 1 commodity less.', hint: () => 0.92,
    fields(s, seat) {
      const hand = s.seats[seat].hand;
      const open = TRACKS.filter(t => !improveWhy(s, seat, t) && Object.entries(improveCost(s, seat, t, 1))
        .every(([g, n]) => hand[g as Resource] >= (n ?? 0)));
      if (!open.length) return why('cost', 'No improvement you can afford');
      return [pickField('track', 'Track', open.map(t => choice(t, TRACK_LABEL[t], '', metropolisFields(s, seat, t))),
        'track')];
    },
    apply(s, seat, a) {
      const track = a.picks.track as (typeof TRACKS)[number];
      transfer(s.seats[seat].hand, s.bank, improveCost(s, seat, track, 1), 'You cannot afford that.');
      improve(s, seat, track, a.picks.city);
    } },
  { kind: 'engineer', text: 'Build a city wall for free.', hint: () => 0.6,
    fields(s, seat) {
      const all = cities(s, seat), bare = all.filter(b => !b.wall);
      if (!bare.length || all.length - bare.length >= MAX_WALLS) return why('no-spot', 'No city without a wall');
      return [pickField('city', 'City', bare.map(b => choice(b.vertex, cityLabel(s, b.vertex))), 'vertex')];
    },
    apply: (s, seat, a) => buildWall(s, seat, a.picks.city, true) },
  { kind: 'inventor', text: 'Swap two number tokens (not 2, 6, 8 or 12).', hint: () => 0.5,
    fields(s, seat) {
      const tiles = swappable(s), n = (t: string) => pips(face(s, t).number);
      if (tiles.length < 2) return why('no-spot', 'No tokens to swap');
      const mineWeak = [...tiles].sort((a, b) => presence(s, seat, b) - presence(s, seat, a) || n(a) - n(b));
      const theirStrong = [...tiles].sort((a, b) => presence(s, seat, a) - presence(s, seat, b) || n(b) - n(a));
      const opts = (list: string[]) => list.map(t => choice(t, `${face(s, t).terrain} ${face(s, t).number}`));
      return [pickField('first', 'First token', opts(mineWeak)),
        pickField('second', 'Second token', opts(theirStrong))];
    },
    apply(s, seat, a) {
      const { first, second } = a.picks;
      if (first === second) throw new Error('Choose two different tokens.');
      const [x, y] = [face(s, first), face(s, second)];
      s.pieces.reveals[first] = { ...s.pieces.reveals[first], terrain: x.terrain, number: y.number };
      s.pieces.reveals[second] = { ...s.pieces.reveals[second], terrain: y.terrain, number: x.number };
      s.mapDirty = true;
      note(s, 'inventor', seat, first, `${seatName(s, seat)} swapped a ${x.number} and a ${y.number}`);
    } },
  { kind: 'irrigation', ...harvest('grain', 'grain') },
  { kind: 'mining', ...harvest('ore', 'ore') },
  // E&P + C&K: or a harbor settlement for 1 grain and 1 ore (the city's second ore is paid on apply).
  { kind: 'medicine', text: 'Upgrade a settlement to a city for 1 grain and 2 ore.', hint: () => 0.95,
    cost: s => ({ grain: 1, ore: harbors(s) ? 1 : 2 }),
    fields(s, seat) {
      const city = !harbors(s) || s.seats[seat].hand.ore >= 2 ? targets(s, seat, 'city') : [];
      const dock = harbors(s) ? harborSites(s, seat) : [], spots = [...new Set([...city, ...dock])];
      if (!spots.length) return why('no-spot', 'No settlement to upgrade');
      const to = (v: string) => (harbors(s) ? [pickField('to', 'Upgrade to', [
        ...(city.includes(v) ? [choice('city', 'City', '+1 ore')] : []),
        ...(dock.includes(v) ? [choice('harbor', 'Harbor settlement')] : [])])] : []);
      return [pickField('at', 'Settlement', spots.map(v => choice(v, cityLabel(s, v), '', to(v))), 'vertex')];
    },
    apply(s, seat, a) {
      if (a.picks.to === 'harbor') return buildHarbor(s, seat, a.picks.at);
      if (a.picks.to) transfer(s.seats[seat].hand, s.bank, { ore: 1 }, 'You cannot afford that.');
      const piece = { ...s.pieces.buildings[a.picks.at], kind: 'city' as const };
      placeBuilding(s, piece);
      const text = `${seatName(s, seat)} built a city`;
      emit(s, { kind: 'build', seat, piece: 'city', spot: a.picks.at, free: false, text });
      for (const m of hooks(s, 'onBuild')) m.onBuild(s, seat, { kind: 'building', piece });
    } },
  { kind: 'road-building', text: 'Build 2 roads for free.',
    hint: (s, seat) => (s.profile.routeKinds.some(k => targets(s, seat, k).length) ? 0.6 : 0.05),
    fields: () => [], apply(s, seat) { s.seats[seat].freeRoutes += 2; } },
  { kind: 'smith', text: 'Promote up to 2 knights for free.', hint: () => 0.7,
    fields(s, seat) {
      const list = knightsOf(s, seat).filter(k => promotable(s, k)).sort((a, b) => b.level - a.level);
      if (!list.length) return why('rule', 'No knight can be promoted');
      const opts = list.map(k => choice(k.id, `Level ${k.level} knight`));
      return [pickField('first', 'Knight', opts, 'unit'),
        ...(list.length > 1 ? [pickField('second', 'Second knight', [...opts].reverse(), 'unit', true)] : [])];
    },
    apply(s, _seat, a) {
      for (const id of new Set([a.picks.first, a.picks.second].filter(Boolean))) {
        const k = s.pieces.units[id];
        if (k && promotable(s, k)) promote(s, k);
      }
    } },
];
