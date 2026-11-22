// Hook for scripts/qa/room-bots.ts: seats that pick a loadout, then run, aim, paint and fight like a rough player.
//   node --import tsx scripts/qa/room-bots.ts --port 4410 --code ABCDEF --players 31 --stats 5 --hook packages/games/inkwave/tools/room-bot.mjs
// Untyped on purpose: the games repository cannot import platform scripts.
const WEAPONS = ['shooter', 'twins', 'brolly', 'blaster', 'spinner', 'charger', 'bow', 'roller', 'brush', 'blade', 'mitts', 'bucket'];
const neutral = { moveX: 0, moveY: 0, hasAim: false, yaw: 0, pitch: 0, aimX: 0, aimY: 0, aimZ: 0, fire: false, squid: false, jump: false, sub: false, special: false, cheer: false };
/** The seat's own arena: its private view in a room of several arenas, otherwise the public one. */
function mine(bot) {
  const snapshot = bot.snapshot, view = snapshot?.publicView, own = snapshot?.privateView; if (!view?.roster) return null;
  const roster = view.roster[own ? own.arena : 0], me = roster.findIndex(player => player.id === bot.playerId);
  return me < 0 ? null : { feed: own ? own.feed : view.live, me, teams: roster.map(player => player.team) };
}
export default {
  lobbyChoice: bot => ({ weapon: WEAPONS[bot.index % WEAPONS.length], sub: null, special: null, style: { hair: bot.index % 8, skin: bot.index % 9, outfit: bot.index % 10, hat: bot.index % 4, eyes: bot.index % 8, brows: bot.index % 4 } }),
  input(bot) {
    const found = mine(bot); if (!found || found.feed.state !== 'playing') return neutral;
    const { feed, me, teams } = found, self = feed.actors[me]; if (!self || !(self[10] & 1)) return neutral;
    const t = Date.now() / 1000 + bot.index * 1.7, team = teams[me];
    let target = null, best = Infinity;
    feed.actors.forEach((actor, index) => { if (teams[index] === team || !(actor[10] & 1)) return; const d = Math.hypot(actor[1] - self[1], actor[3] - self[3]); if (d < best) { best = d; target = actor; } });
    // No foe in reach (or a one-squad boss fight): push up the stage, sweeping the aim to lay turf.
    const goal = target && best < 40 ? [target[1], target[2] + .8, target[3]] : feed.boss ? [feed.boss[1], 2, feed.boss[3]] : [Math.sin(t * .23) * 14, 0, team ? -30 : 30];
    const dx = goal[0] - self[1], dz = goal[2] - self[3], distance = Math.hypot(dx, dz) || 1, fight = !!target && best < 16;
    const yaw = Math.atan2(dx, dz) + (fight ? Math.sin(t * 3) * .06 : Math.sin(t * .9) * .7), pitch = fight ? Math.max(-.6, Math.min(.5, Math.atan2(goal[1] - self[2] - 1, distance))) : -.32 + Math.sin(t * 1.3) * .12;
    const strafe = Math.sin(t * .8), forward = fight && best < 6 ? -.4 : 1, ink = self[12], refill = ink < 12 || bot.refill > Date.now(); if (ink < 12) bot.refill = Date.now() + 1200;
    const mx = (dx / distance) * forward + (dz / distance) * strafe * .6, mz = (dz / distance) * forward - (dx / distance) * strafe * .6, length = Math.max(1, Math.hypot(mx, mz));
    return { moveX: mx / length, moveY: mz / length, hasAim: true, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch, aimX: goal[0], aimY: goal[1], aimZ: goal[2],
      fire: !refill, squid: refill, jump: Math.sin(t * 1.9) > .97, sub: Math.sin(t * .37) > .985, special: self[13] >= 100 || Math.sin(t * .21) > .99, cheer: false };
  },
};
