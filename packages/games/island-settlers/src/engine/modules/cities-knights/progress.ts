/** Progress decks: drawing (event die gates, shared defense), the 4-card hand limit and discards. */
import { TRACKS, type SeatId, type Track } from '../../../model';
import { inbox } from '../../events';
import { openPrompt } from '../../prompts';
import { nextId, seatName, type State } from '../../state';
import { ck, HAND_LIMIT, hasPrompt, LABELS, level, note, sx, TRACK_LABEL, type Held } from './state';

/** Standard: the active seat may exceed the limit until its opportunity ends. Connect: never. */
const onTurn = (s: State, seat: SeatId) => s.settings.mode === 'standard' && s.turn.active === seat;

/** Opens the keep prompt when the seat is over the hand limit and must discard now. */
export function checkLimit(s: State, seat: SeatId, force = false) {
  const over = sx(s, seat).progress.length > HAND_LIMIT && (force || !onTurn(s, seat));
  if (over && !hasPrompt(s, seat, 'keep')) openPrompt(s, { seat, kind: 'cities-knights/keep', scope: 'self' });
}

/** Top card of `track` to `seat`; Printer and Constitution score at once (public), the rest go to hand. */
export function drawProgress(s: State, seat: SeatId, track: Track) {
  const kind = ck(s).decks[track].shift();
  if (!kind) return;
  if (kind === 'printer' || kind === 'constitution') {
    sx(s, seat).points++;
    return note(s, 'progress-point', seat, null, `${seatName(s, seat)} scored ${LABELS[kind]} (+1 point)`);
  }
  sx(s, seat).progress.push({ id: nextId(s, 'pc'), kind, track });
  inbox(s, seat, { text: `You drew ${LABELS[kind]}`, cards: {}, tone: 'gain', other: null });
  checkLimit(s, seat);
}

/** Gate face: every seat whose level covers the red die draws, in turn order from the roller. */
export function drawRound(s: State, track: Track, red: number) {
  const start = Math.max(0, s.order.indexOf(s.turn.active ?? '')), n = s.order.length;
  const drew: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = s.order[(start + i) % n], lvl = level(s, id, track);
    if (lvl <= 0 || red > lvl + 1 || !ck(s).decks[track].length) continue;
    drawProgress(s, id, track);
    drew.push(seatName(s, id));
  }
  const text = `${TRACK_LABEL[track]} event (red ${red})${drew.length ? `: ${drew.join(', ')} drew` : ''}`;
  note(s, 'event', null, track, text);
}

/** Take a card out of the hand and slide it under its deck. */
export function discardCard(s: State, seat: SeatId, id: string): Held {
  const x = sx(s, seat), card = x.progress.find(c => c.id === id);
  if (!card) throw new Error('That progress card is no longer in your hand.');
  x.progress = x.progress.filter(c => c !== card);
  ck(s).decks[card.track].push(card.kind);
  return card;
}

/** Decks a shared-defense winner may draw from, best first (highest own improvement). */
export const openDecks = (s: State, seat: SeatId) => TRACKS.filter(t => ck(s).decks[t].length)
  .sort((a, b) => level(s, seat, b) - level(s, seat, a));
