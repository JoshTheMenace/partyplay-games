/**
 * Socket-bot captains for big-room QA: each bot plays its seat with the scripted captain from tests/run-bot.ts, reading the same packed
 * snapshots a phone gets. From the platform checkout, with an isolated server running and a room created from a real host page:
 *
 *   node --import tsx scripts/qa/room-bots.ts --port 4431 --code ABCDEF --players 31 --stats 5 --hook packages/games/starship-scramble/tools/room-bot.ts
 *
 * Typed only as far as it uses the harness (the games repository cannot import platform scripts); `bot` is its Bot object. SS_BOT_IDLE=1 makes
 * the bots launch and vote but never give a battle order, to watch a fleet fly on its ships' computers.
 */
import { Run, type Move } from '../tests/run-bot';
import { decode, seat, type Own, type Wire } from '../src/wire';

type Bot = { playerId: string; act(payload: unknown): Promise<{ accepted: boolean; reason?: string }> };
const idle = process.env.SS_BOT_IDLE === '1', brains = new Map<Bot, any>();
/** A scripted captain without a rules state: it sees one seat's decoded snapshot and sends its moves over the bot's socket. */
function brain(bot: Bot) {
  const b: any = Object.assign(Object.create(Run.prototype), { paused: new Set(), beats: new Set(), volleys: new Map(), done: new Set(), rejected: [], hulls: ['wayfarer', 'lancer', 'bulwark', 'corsair', 'halcyon'], view: null, busy: 0, orders: 1 });
  b.sight = () => b.view; b.refresh = () => b.view;
  // One order at a time; an order whose answer never comes (a round change, a dropped socket) must not freeze the captain.
  b.act = (_playerId: string, move: Move) => { const sent = b.busy = Date.now(); void bot.act({ ...move, turn: b.view.turn }).then(ack => { if (b.busy === sent) b.busy = 0; if (!ack.accepted) b.rejected.push(ack.reason); }); };
  b.try = (playerId: string, move: Move) => { b.act(playerId, move); return true; };
  return b;
}
export default {
  snapshot(bot: Bot, snapshot: { type: string; publicView: Wire; privateView: Own | null }) {
    if (snapshot.type !== 'game.snapshot') return;
    const b = brains.get(bot) ?? brains.set(bot, brain(bot)).get(bot);
    if (b.busy && Date.now() - b.busy < 3000) return;
    const view = b.view = seat(decode(snapshot.publicView), snapshot.privateView), me = view.captains.find(c => c.playerId === bot.playerId);
    if (!me || view.phase === 'over' || idle && view.phase === 'combat') return;
    // Fire together once every held weapon in the wing is charged.
    const held = view.ships.filter(s => s.faction === 'ally' && s.wing === me.wing && s.status === 'active').flatMap(s => s.weapons.filter(w => !w.auto && w.powered && w.target));
    b.volleys.set(me.wing, held.length > 0 && held.every(w => w.charge >= .999));
    b.play(bot.playerId);
  },
};
