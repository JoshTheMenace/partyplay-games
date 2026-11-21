/**
 * Hook for the platform's socket bots (scripts/qa/room-bots.ts) so they behave like Blockwild clients:
 *
 *   node --import tsx scripts/qa/room-bots.ts --port 4410 --code ABCDEF --players 31 --stats 5 --hook packages/games/blockwild/tools/room-bot.ts
 *
 * Each bot adopts the server's teleports, confirms the bag it was sent, shuffles about inside its own block (always a
 * legal move, whatever the terrain) and digs the ground beside it every few seconds, so a room of bots produces real
 * movement, edits and effects. In a creative world the bots instead rise and fly apart at full speed (BW_BOTS=stay
 * keeps them at the spawn), which is what loads chunk streaming and spreads the room out.
 * The bot's shape is declared here, as far as this hook uses it: the games repository cannot import the platform's types.
 */
type Private = { ack: number; tp: { n: number; x: number; y: number; z: number }; bag?: { rev: number }; mode: string; dead: boolean };
type Bot = { index: number; snapshot: { privateView: unknown } | null };
type Me = { tp: number; x: number; y: number; z: number; home: number[]; t: number; bag: number; dig: number; target: number[] | null };
const bots = new WeakMap<Bot, Me>();
const FLY = 10.9 / 20, stay = process.env.BW_BOTS === 'stay';

export default {
  input(bot: Bot) {
    const pv = bot.snapshot?.privateView as Private | null | undefined;
    if (!pv) return undefined;
    let me = bots.get(bot);
    if (!me) bots.set(bot, me = { tp: 0, x: 0, y: 0, z: 0, home: [0, 0, 0], t: 0, bag: 0, dig: 0, target: null });
    if (pv.tp.n !== me.tp) Object.assign(me, { tp: pv.tp.n, x: pv.tp.x, y: pv.tp.y, z: pv.tp.z, home: [pv.tp.x, pv.tp.y, pv.tp.z] });
    if (pv.bag) me.bag = pv.bag.rev;
    me.t += 0.05;
    const creative = pv.mode === 'creative' && !stay, angle = bot.index * 2.399963;
    let flags = 1, mine: number[] | null = null;
    const cmds: Record<string, unknown>[] = [];
    if (pv.dead) cmds.push({ n: pv.ack + 1, t: 'respawn' });
    else if (creative) {
      // Up out of the trees, then outwards, each bot on its own bearing.
      flags = 8;
      if (me.y < 112) me.y = Math.min(112, me.y + 0.3);
      else { me.x = Math.min(4000, Math.max(96, me.x + Math.cos(angle) * FLY)); me.z = Math.min(4000, Math.max(96, me.z + Math.sin(angle) * FLY)); }
    } else {
      // A slow circle a quarter of a block wide round where the server put this bot.
      me.x = me.home[0]! + Math.cos(me.t * 1.5 + angle) * 0.22;
      me.z = me.home[2]! + Math.sin(me.t * 1.5 + angle) * 0.22;
      // Every four seconds: mine the ground block beside it for long enough, then break it.
      const phase = me.t % 4, dx = [1, 0, -1, 0][me.dig % 4]!, dz = [0, 1, 0, -1][me.dig % 4]!;
      me.target = [Math.floor(me.home[0]!) + dx, Math.floor(me.home[1]!) - 1 - Math.floor(me.dig / 4), Math.floor(me.home[2]!) + dz];
      if (phase > 1 && phase < 3.2) mine = me.target;
      if (phase >= 3 && phase < 3.2) cmds.push({ n: pv.ack + 1, t: 'break', x: me.target[0], y: me.target[1], z: me.target[2] });
      if (phase < 0.05) me.dig++;
    }
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return { p: [round(me.x), round(me.y), round(me.z)], v: [0, 0, 0], yaw: round(Math.sin(me.t * 0.7 + angle) * 3), pitch: round(Math.sin(me.t * 0.4) * 0.4), f: flags | (mine ? 32 : 0), slot: 0, mine, tpAck: me.tp, cmds, bag: me.bag };
  },
};
