/**
 * Fish spends and limits from the official combination sheets: Cities & Knights (7 fish: a progress
 * card of your choice), Explorers & Pirates (2: no pirate tribute this turn, 5: a free ship, 7: a
 * ship moves again), Barbarian Attack (conquered buildings catch nothing; its guard move prompt
 * takes 2 fish for a long move) and Traders & Barbarians (2 fish: +2 wagon MP, like 1 grain).
 */
import type { Field, SeatId, Track, VertexId } from '../../../model';
import { choice, pickField } from '../../commands';
import type { State } from '../../state';
import type { Answer } from '../registry';
import { conqueredAt } from '../barbarian-attack/coast';
import { drawProgress, openDecks } from '../cities-knights/progress';
import { dl } from '../deliveries/depots';
import { mayMove } from '../deliveries/gold';
import { wagon } from '../deliveries/wagon';
import { TRACK_LABEL } from '../cities-knights/state';
import { buildShip, shipSites } from '../explorers/build';
import { shipName } from '../explorers/course';
import { phase } from '../explorers/rules';
import { maxMoves, movesLeft } from '../explorers/sea';
import { ext, ships, voyage, voyageFor } from '../explorers/state';

export type ComboSpend = 'tribute' | 'ship' | 'progress' | 'voyage' | 'wagon';

/** The building on `v` catches fish (Barbarian Attack: not while conquered). */
export const catches = (s: State, v: VertexId) =>
  !s.modules.includes('barbarian-attack') || !conqueredAt(s, v);

export function comboSpends(s: State, seat: SeatId): [ComboSpend, number, Field[]][] {
  const out: [ComboSpend, number, Field[]][] = [];
  const decks = s.modules.includes('cities-knights') ? openDecks(s, seat) : [];
  const deck = pickField('track', 'Deck', decks.map(t => choice(t, TRACK_LABEL[t])), 'track');
  if (decks.length) out.push(['progress', 0.75, [deck]]);
  const boost = s.modules.includes('deliveries') && wagon(s, seat) && mayMove(s, seat);
  if (boost && !dl(s).boosted.includes(seat)) out.push(['wagon', 0.2, []]);
  if (!s.modules.includes('explorers')) return out;
  const v = voyage(s, seat), owner = ext(s).pirate;
  if (s.pieces.pirate && owner && owner !== seat && !v.calm) out.push(['tribute', 0.3, []]);
  const sites = phase(s, seat, 'build') ? shipSites(s, seat) : [];
  const edge = pickField('at', 'Sea edge', sites.map(e => choice(e, 'Sea edge')), 'edge');
  if (sites.length) out.push(['ship', 0.7, [edge]]);
  const moved = phase(s, seat, 'move') ? ships(s, seat).filter(u => !movesLeft(s, u)
    && (u.id in v.moves || v.done.includes(u.id))) : [];
  if (moved.length) {
    out.push(['voyage', 0.4, [pickField('ship', 'Ship', moved.map(u => choice(u.id, shipName(s, u))), 'unit')]]);
  }
  return out;
}

export function applyCombo(s: State, seat: SeatId, k: ComboSpend, a: Answer) {
  if (k === 'progress') return drawProgress(s, seat, a.picks.track as Track);
  if (k === 'ship') return buildShip(s, seat, a.picks.at, true);
  if (k === 'wagon') { dl(s).mp[seat] += 2; dl(s).boosted.push(seat); return; }
  const v = voyageFor(s, seat);
  if (k === 'tribute') { v.calm = true; return; }
  v.done = v.done.filter(id => id !== a.picks.ship);
  v.moves[a.picks.ship] = maxMoves(s, seat);
}
