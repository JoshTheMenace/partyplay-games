/* Hook for the platform's socket bots (scripts/qa/room-bots.ts --hook packages/games/kart-party/tools/room-bot.ts): each
 * bot picks a racer and a kart, then drives like a phone would, from the snapshots it receives. It chases the racing line in
 * its own lane, drifts through real corners, fires items a moment after the roulette stops and honks now and then, so a room
 * of bots produces the input traffic, items and events of a real crowd. The games repository cannot import the platform's
 * bot types, so the two shapes it uses are copied here (see the handbook). */
import { decodeRaceView, type OwnView, type RaceWire } from '../src/net/wire';
import { angleDelta, clamp, headingOf } from '../src/sim/math';
import { pointAt, sampleAt } from '../src/sim/track';
import { getTrack } from '../src/tracks/index';

type Bot = { index: number; playerId: string; snapshot: { publicView: unknown; privateView: unknown } | null; act(payload: unknown): Promise<unknown> };
type Memory = { seq: number; hop: number; fire: number; drift: number; armed: number; wait?: number };
const KARTS = ['zoomer', 'bolt', 'tank', 'roadster'];
const memory = new Map<Bot, Memory>();
export default {
  lobbyChoice: (bot: Bot) => ({ character: bot.index % 8, kart: KARTS[(bot.index >> 3) % 4] }),
  input(bot: Bot) {
    const snap = bot.snapshot; if (!snap?.publicView) return undefined;
    const race = decodeRaceView(snap.publicView as RaceWire, snap.privateView as OwnView | null), me = race.racers.find(r => r.id === bot.playerId); if (!me) return undefined;
    const m: Memory = memory.get(bot) ?? { seq: 0, hop: me.prevHop, fire: me.prevFire, drift: 0, armed: 0 }; memory.set(bot, m);
    const track = getTrack(race.track), v = Math.hypot(me.vx, me.vz), look = 8 + v * .5, lane = ((bot.index * 7) % 9 - 4) * .7;
    const s = sampleAt(track, me.d + look), p = pointAt(track, me.d + look, clamp(s.line + lane, -s.halfWidth + 2, s.halfWidth - 2));
    const alpha = angleDelta(me.heading, headingOf(p.x - me.x, p.z - me.z)), turn = angleDelta(sampleAt(track, me.d).heading, sampleAt(track, me.d + 12 + v * 1.2).heading);
    // Hop into a drift when a real corner starts, hold it through, let go as the road straightens (or after a hit).
    if (m.drift && (Math.abs(turn) < .15 || me.spinT > 0 || me.tumbleT > 0 || v < 8)) m.drift = 0;
    else if (!m.drift && race.phase === 'racing' && me.grounded && v > 14 && Math.abs(turn) > .7 && bot.index % 3) { m.drift = 1; m.hop = (m.hop + 1) & 255; }
    // Rocket start for some, items a second after the roulette stops.
    if (race.phase === 'countdown' && race.time > -.3 + (bot.index % 5) * .05 && !m.armed && bot.index % 2) { m.armed = 1; m.hop = (m.hop + 1) & 255; }
    if (me.item && me.rollT <= 0) { if ((m.wait = (m.wait ?? 20 + bot.index % 30) - 1) <= 0) { m.fire = (m.fire + 1) & 255; m.wait = undefined; } } else m.wait = undefined;
    if (race.phase === 'racing' && (Math.floor(race.time * 20) + bot.index * 37) % 900 === 0) void bot.act({ type: 'honk' });
    return { steer: clamp(-alpha * 2.4, -1, 1), drift: !!m.drift, brake: false, item: false, hop: m.hop, fire: m.fire, seq: ++m.seq };
  },
};
