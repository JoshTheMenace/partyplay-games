// Crew bots for the platform's socket-bot harness: synthetic phones that really cook, so a big room can be watched and measured.
//   node --import tsx scripts/qa/room-bots.ts --port 4421 --code ABCDEF --players 31 --stats 5 --hook packages/games/kitchen-rush/tools/room-bot.ts
// Left untyped against the harness (the games repository cannot import platform scripts); `bot` is its Bot object.
import { kitchenMap } from '../src/levels';
import { CHARACTERS } from '../src/model';
import { decodeWire, kitchenOf } from '../src/wire';
import { botInput } from '../tests/helpers/bot';

export default {
  lobbyChoice: (bot: { index: number }) => ({ character: CHARACTERS[bot.index % CHARACTERS.length].id }),
  input(bot: { playerId: string; snapshot: { publicView: any; privateView: any } | null }) {
    const wire = bot.snapshot?.publicView;
    if (!wire?.base || wire.rev > 1) return undefined;
    const view = kitchenOf(decodeWire(wire), bot.playerId), me = view.players.find(chef => chef.id === bot.playerId);
    // The crew bot acknowledges commands through its chef's `seq`, which only this seat is told.
    if (me && bot.snapshot?.privateView) me.seq = bot.snapshot.privateView.seq;
    // Kitchens share a seed and bots are deterministic: a different pace per kitchen keeps the race from being a dead heat.
    return botInput(view, kitchenMap(view.settings.level, view.players.length), bot.playerId, { speed: 1 - view.line * .04, dash: view.line % 3 !== 2 });
  },
};
