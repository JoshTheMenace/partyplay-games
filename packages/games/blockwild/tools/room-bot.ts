/**
 * Hook for the platform's socket bots (scripts/qa/room-bots.ts) so they behave like Blockwild clients:
 *
 *   node --import tsx scripts/qa/room-bots.ts --port 4410 --code ABCDEF --players 31 --stats 5 --hook packages/games/blockwild/tools/room-bot.ts
 *
 * Each bot adopts the server's teleports, confirms the bag it was sent, shuffles about inside its own block (always a
 * legal move, whatever the terrain) and digs the ground beside it every few seconds, so a room of bots produces real
 * movement, edits and effects. In a creative world the bots instead rise and fly apart at full speed (BW_BOTS=stay
 * keeps them at the spawn), which is what loads chunk streaming and spreads the room out.
 * In Caper City (mode city) each bot walks the streets to an intersection of its own, spread over the whole city, and
 * then paces a block up and down there, so a room of bots loads every district at once (BW_BOTS=stay keeps them on the plaza).
 * Every other bot steps over to the first parked vehicle it comes near, gets in and drives its route instead (BW_BOTS=walk: nobody drives).
 * The bot's shape is declared here, as far as this hook uses it: the games repository cannot import the platform's types.
 */
type Private = { ack: number; tp: { n: number; x: number; y: number; z: number }; bag?: { rev: number }; mode: string; dead: boolean; near?: { v?: number[][] }; city?: { ride?: number[] } };
type Bot = { index: number; snapshot: { privateView: unknown } | null };
type Me = { tp: number; x: number; y: number; z: number; home: number[]; t: number; bag: number; dig: number; target: number[] | null; leg: number; tried: number; want: number[] | null; rode: boolean; dodge: number };
/** Top speeds of the city's vehicle kinds (shared/city/vehicles.ts), blocks a second. */
const TOPS = [14, 19, 17, 16, 20, 27, 25, 24, 17, 30];
/** The city's street grid (shared/city/plan.ts): road centres every 64 blocks from 1736. */
const ROAD = (k: number) => 1736 + k * 64, WALK = 5 / 20;
const towards = (from: number, to: number, step = WALK) => Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step;
const bots = new WeakMap<Bot, Me>();
const FLY = 10.9 / 20, stay = process.env.BW_BOTS === 'stay';

export default {
  input(bot: Bot) {
    const pv = bot.snapshot?.privateView as Private | null | undefined;
    if (!pv) return undefined;
    let me = bots.get(bot);
    if (!me) bots.set(bot, me = { tp: 0, x: 0, y: 0, z: 0, home: [0, 0, 0], t: 0, bag: 0, dig: 0, target: null, leg: 0, tried: 0, want: null, rode: false, dodge: 0 });
    // A teleport a few blocks away is a vehicle boarded or left, or a step the server refused (the route goes on); a far one is a new start.
    if (pv.tp.n !== me.tp) {
      const near = Math.hypot(pv.tp.x - me.x, pv.tp.z - me.z) < 12, rides = !!pv.city?.ride, city = pv.mode === 'city';
      // Refused on foot: something stands in the way (a lamp, a bin, a bench). Step aside for a second, then carry on.
      if (city && near && me.tp && !rides && !me.rode) me.dodge = 20;
      Object.assign(me, { tp: pv.tp.n, leg: near ? me.leg : 0, x: pv.tp.x, y: pv.tp.y, z: pv.tp.z, home: city && near ? me.home : [pv.tp.x, pv.tp.y, pv.tp.z], rode: rides });
    }
    me.rode = !!pv.city?.ride;
    if (pv.bag) me.bag = pv.bag.rev;
    me.t += 0.05;
    const creative = pv.mode === 'creative' && !stay, angle = bot.index * 2.399963;
    let flags = 1, mine: number[] | null = null, heading: number | null = null;
    const cmds: Record<string, unknown>[] = [], before = [me.x, me.z];
    if (pv.dead) cmds.push({ n: pv.ack + 1, t: 'respawn' });
    else if (pv.mode === 'city' && !stay) {
      // North off the plaza to the street, along it to this bot's avenue, down the avenue to its corner, then up and down a block
      // (a driver turns round every seven seconds, so it is moving most of the time).
      const street = ROAD(Math.round((me.home[2]! - 1736) / 64 - 0.5)), ax = ROAD(bot.index % 11), az = ROAD((bot.index * 3 + Math.floor(bot.index / 11) * 5) % 11), end = az + (Math.floor(me.t / (pv.city?.ride ? 7 : 26)) % 2 ? 40 : -40) * (az > 2300 ? -1 : 1) * (az < 1800 ? -1 : 1);
      const ride = pv.city?.ride, step = ride ? TOPS[ride[1]!]! * 0.6 / 20 : WALK, driver = bot.index % 2 === 0 && process.env.BW_BOTS !== 'walk';
      // Every other bot takes a parked, empty vehicle it comes near. Parked vehicles are listed once a second: the
      // nearest is remembered, the bot steps over to it (the server wants it within arm's reach) and gets in.
      if (ride || !driver || me.leg === 0) me.want = null;
      else if (pv.near?.v?.some(v => v[7]! & 1)) me.want = pv.near.v.filter(v => (v[7]! & 11) === 1 && Math.hypot(v[2]! - me.x, v[4]! - me.z) < 9).sort((a, b) => Math.hypot(a[2]! - me.x, a[4]! - me.z) - Math.hypot(b[2]! - me.x, b[4]! - me.z))[0] ?? null;
      if (me.dodge > 0) { me.dodge--; if (me.leg === 1) me.z += WALK * 0.7; else me.x += WALK * 0.7; }
      else if (me.want && me.t - me.tried > 6) {
        if (Math.hypot(me.want[2]! - me.x, me.want[4]! - me.z) > 2) { me.x = towards(me.x, me.want[2]!, WALK * 0.7); me.z = towards(me.z, me.want[4]!, WALK * 0.7); }
        else { me.tried = me.t; cmds.push({ n: pv.ack + 1, t: 'interact', id: me.want[0] }); }
      }
      else if (me.leg === 0) { me.z = towards(me.z, street, step); if (me.z === street) me.leg = 1; }
      // (A bot that stepped aside for a vehicle drifts back onto its line as it goes.)
      else if (me.leg === 1) { me.x = towards(me.x, ax, step); me.z = towards(me.z, street, step / 2); if (me.x === ax) me.leg = 2; }
      else if (me.leg === 2) { me.z = towards(me.z, az, step); me.x = towards(me.x, ax, step / 2); if (me.z === az) me.leg = 3; }
      else { me.z = towards(me.z, Math.max(ROAD(0), Math.min(ROAD(10), end)), step); me.x = towards(me.x, ax, step / 2); }
      if (me.x !== before[0] || me.z !== before[1]) heading = Math.atan2(before[0]! - me.x, before[1]! - me.z);
    } else if (creative) {
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
    const velocity = [round((me.x - before[0]!) * 20), 0, round((me.z - before[1]!) * 20)];
    return { p: [round(me.x), round(me.y), round(me.z)], v: heading === null ? [0, 0, 0] : velocity, yaw: round(heading ?? Math.sin(me.t * 0.7 + angle) * 3), pitch: heading === null ? round(Math.sin(me.t * 0.4) * 0.4) : 0, f: flags | (mine ? 32 : 0), slot: 0, mine, tpAck: me.tp, cmds, bag: me.bag };
  },
};
