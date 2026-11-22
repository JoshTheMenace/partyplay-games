// Crew bots for the platform's socket-bot harness: synthetic phones that really sneak, dart guards, loot, take the goods and get away,
// each playing only from the snapshots its own socket receives.
//   node --import tsx scripts/qa/room-bots.ts --port 4423 --code ABCDEF --players 31 --stats 5 --hook packages/games/night-job/tools/room-bot.ts
// Left untyped against the harness (the games repository cannot import platform scripts); `bot` is its Bot object.
import { ownView, type Own, type Wire } from '../src/wire';
import { botChoice, crewBot } from './bot';

const brains = new Map<string, { heist: string; think: ReturnType<typeof crewBot> }>();
export default {
  // Seats are dealt into crews in order, so every full crew gets the whole dart pack.
  lobbyChoice: (bot: { playerId: string }, room: { players: { id: string }[] }) => botChoice(Math.max(0, room.players.findIndex(p => p.id === bot.playerId)) % 4),
  input(bot: { playerId: string; snapshot: { publicView: Wire; privateView: Own | null } | null; act(payload: unknown): Promise<unknown> }) {
    const wire = bot.snapshot?.publicView, view = wire?.base && ownView(wire, bot.snapshot!.privateView, bot.playerId);
    if (!view) return undefined;
    let brain = brains.get(bot.playerId);
    if (brain?.heist !== view.heistId) brains.set(bot.playerId, brain = { heist: view.heistId, think: crewBot(bot.playerId) });
    const move = brain.think(view);
    if (move.tool) void bot.act({ type: 'tool', heistId: view.heistId });
    return move.input;
  },
};
