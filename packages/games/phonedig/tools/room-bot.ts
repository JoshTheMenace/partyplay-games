// Digging bots for the platform's socket-bot harness: synthetic phones that really play, so a big room can be watched and measured.
//   node --import tsx scripts/qa/room-bots.ts --port 4410 --code ABCDEF --players 31 --stats 5 --hook packages/games/phonedig/tools/room-bot.ts
// Each one reads exactly what a phone is sent — its own crew's shaft, decoded, and the ground rebuilt from the seed — and
// answers with held input. Left untyped against the harness (the games repository cannot import platform scripts); `bot` is its Bot object.
import { SUITS } from '../src/suits';
import { createReader, rosterOf } from '../src/viewstate';
import type { Roster, ShaftView } from '../src/viewstate';
import { botInput, newMind } from '../tests/helpers/bot';
import type { BotMind } from '../tests/helpers/bot';

type Seat = { round: string; reader: ReturnType<typeof createReader>; roster: Roster; view: ShaftView | null; mind: BotMind | null; kitted: boolean; asked: number; digging: boolean };
const seats = new Map<number, Seat>();
// PD_BOT_SKILL=0.5 makes a room of beginners; unset, the room is a spread of abilities.
const skill = process.env.PD_BOT_SKILL === undefined ? null : Number(process.env.PD_BOT_SKILL);

export default {
  snapshot(bot: { index: number; playerId: string; act(payload: unknown): Promise<unknown> }, snapshot: { roundId: string; publicView: any; privateView: any }) {
    let seat = seats.get(bot.index);
    if (!seat || seat.round !== snapshot.roundId) seats.set(bot.index, seat = { round: snapshot.roundId, reader: createReader(), roster: rosterOf([]), view: null, mind: null, kitted: false, asked: 0, digging: false });
    const view = snapshot.publicView, mine = snapshot.privateView;
    if (!view || !mine?.playing) return;
    if (view.roster) seat.roster = rosterOf(view.roster);
    if (view.kitup && !seat.kitted) { seat.kitted = true; void bot.act({ type: 'kit', turnId: 1, suit: SUITS[(bot.index * 5) % SUITS.length].id }); }
    seat.view = seat.reader.read(view, mine, seat.roster);
    seat.digging = !view.kitup && !view.whistle;
    // The pump counter resumes from the server's acknowledgement, as a remounted controller's does.
    seat.mind ??= newMind(Math.max(0, mine.pumpSeq));
    // A hole in the ground journal: ask for the whole of it, once a second at most.
    if (seat.reader.ground()?.gap && Date.now() - seat.asked > 1000) { seat.asked = Date.now(); void bot.act({ type: 'sync', turnId: 1 }); }
  },
  input(bot: { index: number; playerId: string }) {
    const seat = seats.get(bot.index), ground = seat?.reader.ground();
    if (!seat?.view || !seat.mind || !ground || !seat.digging) return undefined;
    const crew = seat.view.players, slot = Math.max(0, crew.findIndex(q => q.id === bot.playerId));
    return botInput(seat.view, ground.dirt, bot.playerId, seat.mind, { skill: skill ?? 0.55 + (bot.index % 5) * 0.1, side: (slot + 0.5) / Math.max(1, crew.length) });
  },
};
