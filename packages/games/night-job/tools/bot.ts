/* A thief that plays from its crew's View alone (what its phone is sent): no server state. Used by the socket-bot
 * hook, the sandbox and the tests, so a room of bots really sneaks, loots, takes the goods and gets away.
 * The crew moves as a pack: it routes around beams, times cameras, sneaks near guards, darts the ones that turn up
 * (`botChoice` hands most seats the Tranq), revives its fallen, and breaks line of sight when it has no answer left. */
import { buildGrid, cellIndex, doorObjects, lineOfSight, type Grid } from '../src/geometry';
import { getMap } from '../src/maps';
import { RADIUS, SIGHT, cameraAngle, type Input, type MapObject, type Point, type Role, type Tool, type View } from '../src/model';

const SIDES = [[-1, 0], [0, 1], [1, 0], [0, -1]], dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const still = (sneak = true): Input => ({ x: 0, y: 0, sneak });
export type BotMove = { input: Input; tool: boolean };
/** A crew that suits this bot: two Magpies whose birds keep the darts coming, a quick reviver with the Medkit, a Ghost. */
export const botChoice = (place: number): { role: Role; tool: Tool } => ([{ role: 'magpie', tool: 'tranq' }, { role: 'face', tool: 'medkit' }, { role: 'magpie', tool: 'tranq' }, { role: 'ghost', tool: 'tranq' }] as const)[place % 4];

export function crewBot(id: string, pace = 1) {
  let field = new Float32Array(0), key = '', toolAt = 0, born = -1, grid: Grid | null = null, gridKey = '';
  return (view: View): BotMove => {
    const map = getMap(view.mission), W = map.width, me = view.players.find(p => p.id === id), now = view.now;
    if (born < 0) born = now;
    if (!me || me.down || me.suspended || view.phase === 'clear' || view.phase === 'failed') return { input: still(false), tool: false };
    if (gridKey !== view.doors + view.broken.length || !grid) { gridKey = view.doors + view.broken.length; grid = buildGrid(map, view.doors, view.broken); }
    const g = grid, doors = doorObjects(map), stateOf = (o: MapObject) => view.objects.find(s => s.id === o.id)?.state ?? 'ready';
    const live = map.objects.filter(o => (o.kind === 'camera' || o.kind === 'laser') && stateOf(o) === 'ready');
    const beam = (q: Point) => live.some(o => {
      if (o.kind !== 'laser') return false;
      const f = o.facing ?? 0, along = (q.x - o.x) * Math.cos(f) + (q.y - o.y) * Math.sin(f), off = Math.abs((q.x - o.x) * Math.sin(f) - (q.y - o.y) * Math.cos(f));
      return along > 0 && off < .9 && lineOfSight(g, o, { x: o.x + Math.cos(f) * along, y: o.y + Math.sin(f) * along });
    });
    /** Inside a camera's cone at `at` (cameras sweep on the shared clock, so a thief can time them). */
    const watched = (q: Point, at: number, margin = .2) => live.some(o => o.kind === 'camera' && dist(o, q) <= SIGHT.cameraRange + .6 && turn(cameraAngle(o, at), Math.atan2(q.y - o.y, q.x - o.x)) <= SIGHT.cameraHalfAngle + margin && lineOfSight(g, o, q));
    const swept = (q: Point) => live.some(o => o.kind === 'camera' && dist(o, q) <= SIGHT.cameraRange + .6 && turn(o.facing ?? 0, Math.atan2(q.y - o.y, q.x - o.x)) <= SIGHT.cameraSweep + SIGHT.cameraHalfAngle + .15 && lineOfSight(g, o, q));
    /** Travel cost to `goal` from every cell: doors, locks and windows are passable; beams, vents and hiding spots are dear, camera sweeps a little. */
    const flood = (goal: Point) => {
      const mask = g.solid.slice(), cost = new Float32Array(W * map.height).fill(1), f = new Float32Array(W * map.height).fill(1e9), open = [cellIndex(map, goal)];
      doors.forEach((d, i) => { const c = cellIndex(map, d), s = view.doors[i]; if (d.kind === 'door') { mask[c] = 0; cost[c] = s === 'l' ? 7 : 1.5; } else if (s !== 'b') { mask[c] = 0; cost[c] = 5; } });
      for (const o of map.objects) if ((o.kind === 'vent' || o.kind === 'hide') && cellIndex(map, o) !== open[0]) cost[cellIndex(map, o)] = 30;
      for (let i = 0; i < cost.length; i++) if (!mask[i]) { const q = { x: i % W + .5, y: Math.floor(i / W) + .5 }; cost[i] += (beam(q) ? 60 : swept(q) ? 4 : 0) + guards.reduce((sum, n) => sum + Math.max(0, 5 - dist(n, q)), 0); }
      f[open[0]] = 0;
      while (open.length) {
        let best = 0;
        for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[best]]) best = i;
        const cur = open.splice(best, 1)[0], x = cur % W, y = Math.floor(cur / W);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const n = (y + dy) * W + x + dx;
          if ((!dx && !dy) || mask[n] !== 0 || (dx && dy && (mask[y * W + x + dx] !== 0 || mask[(y + dy) * W + x] !== 0 || g.solid[n] || g.solid[cur]))) continue;
          const v = f[cur] + cost[n] * (dx && dy ? 1.414 : 1);
          if (v < f[n]) { if (f[n] === 1e9) open.push(n); f[n] = v; }
        }
      }
      return f;
    };
    const guards = view.npcs.filter(n => n.state !== 'stunned' && n.state !== 'charmed'), chaser = guards.filter(n => n.state === 'chase' && n.kind !== 'civilian').sort((a, b) => dist(a, me) - dist(b, me))[0];
    const risk = (q: Point) => guards.reduce((r, n) => {
      const d = dist(n, q); if (d > 9) return r;
      const inCone = turn(n.facing, Math.atan2(q.y - n.y, q.x - n.x)) < 1.15 || d < 1.8;
      return r + (inCone && lineOfSight(g, n, q, view.smoke, now) ? 15 - d : 0) + Math.max(0, 2.2 - d) * 3;
    }, watched(q, now + 350, 0) ? 6 : 0);
    const push = (at: Point, sneak: boolean): Input => { const d = dist(me, at) || 1; return { x: (at.x - me.x) / d, y: (at.y - me.y) / d, sneak }; };

    // The crew moves as a pack behind its first standing seat. Whoever is nearest a guard with a dart left puts it to sleep; a
    // thief with nothing to answer a chase with breaks line of sight instead. Then: revive, pick the goods back up, get out, or go in.
    const exit = map.objects.find(o => o.kind === 'exit')!, pedestal = map.objects.find(o => o.kind === 'objective')!, mates = view.players.filter(p => !p.suspended && p.id !== id), up = view.players.filter(p => !p.suspended && !p.down);
    const armed = (p: View['players'][number]) => p.tool === 'tranq' && p.charges > 0 && !p.down && !p.suspended, lead = up[0];
    const threat = guards.filter(n => n.kind !== 'civilian' && dist(n, me) < 8.6 && lineOfSight(g, me, n, view.smoke, now) && view.players.filter(armed).every(p => p.id === id || dist(p, n) > dist(me, n) || (dist(p, n) === dist(me, n) && p.seat > me.seat))).sort((a, b) => dist(a, me) - dist(b, me))[0];
    let tool = false;
    if (threat && armed(me)) {
      if (now < toolAt) return { input: still(), tool: false };
      if (turn(me.facing, Math.atan2(threat.y - me.y, threat.x - me.x)) > .3) { const d = dist(me, threat) || 1; return { input: { x: (threat.x - me.x) / d * .3, y: (threat.y - me.y) / d * .3, sneak: true }, tool: false }; }
      toolAt = now + 700; return { input: still(), tool: true };
    }
    const fallen = mates.filter(p => p.down).sort((a, b) => dist(a, me) - dist(b, me))[0], after = guards.filter(n => n.state === 'chase' && n.kind !== 'civilian' && dist(n, me) < 9 && lineOfSight(g, n, me, view.smoke, now));
    let goal: Point, target: Point | null = null, rest = 0;
    if (after.length && !me.carrying && !view.players.some(armed)) {
      // Nearest cell (by steps) that none of the chasers can see.
      const seen = new Uint8Array(W * map.height), queue = [cellIndex(map, me)]; let cover: Point | null = null; seen[queue[0]] = 1;
      for (let i = 0; i < queue.length && i < 260 && !cover; i++) {
        const c = queue[i], q = { x: c % W + .5, y: Math.floor(c / W) + .5 };
        if (i && !after.some(n => lineOfSight(g, n, q, view.smoke, now)) && after.every(n => dist(n, q) > 3)) cover = q;
        for (const [dx, dy] of SIDES) { const n = c + dx + dy * W; if (!seen[n] && !g.solid[n]) { seen[n] = 1; queue.push(n); } }
      }
      goal = cover ?? exit;
    } else if (fallen && mates.filter(p => !p.down).every(p => dist(p, fallen) > dist(me, fallen) || (dist(p, fallen) === dist(me, fallen) && p.seat > me.seat))) { goal = fallen; target = fallen; }
    else if (view.objective.taken && !view.objective.carrier) { goal = view.objective; target = view.objective; }
    else if (view.objective.taken) { goal = exit; rest = RADIUS.exit - .7; }
    else if (lead.id === id) { goal = SIDES.map(([dx, dy]) => ({ x: pedestal.x + dx, y: pedestal.y + dy })).filter(c => !g.solid[cellIndex(map, c)] && !beam(c)).sort((a, b) => +swept(a) - +swept(b))[0] ?? pedestal; target = pedestal; }
    else {
      // Loot within a few steps of the pack, otherwise stay on the leader's heels.
      const coin = map.coins.filter((c, i) => view.coins[i] === '1' && dist(c, me) < 4 && dist(c, lead) < 6 && !beam(c) && lineOfSight(g, me, c)).sort((a, b) => dist(a, me) - dist(b, me))[0];
      goal = coin ?? lead; rest = coin ? 0 : 1.6;
    }
    // Other tools: patch a friend, blind a camera in the way, smoke when cornered.
    if (me.charges > 0 && now >= toolAt) {
      if (me.tool === 'medkit') tool = me.health <= 45 || mates.some(p => (p.down || p.health <= 45) && dist(p, me) <= 2.2);
      else if (me.tool === 'emp') tool = live.some(o => dist(o, me) < 5 && lineOfSight(g, me, o)) && !view.alarm;
      else if (me.tool === 'smoke') tool = after.some(n => dist(n, me) < 6);
      else if (me.tool === 'shotgun') tool = guards.some(n => n.kind !== 'civilian' && dist(n, me) < 4 && turn(me.facing, Math.atan2(n.y - me.y, n.x - me.x)) < .45 && lineOfSight(g, me, n));
      else if (me.tool === 'decoy') tool = guards.some(n => n.state === 'suspicious' && dist(n, me) < 6);
      if (tool) toolAt = now + 5000;
    }
    if (dist(me, goal) <= rest) return { input: still(), tool };
    const k = `${Math.floor(goal.x)},${Math.floor(goal.y)},${Math.floor(now / 1000)},${view.doors},${live.length}`;
    if (k !== key) { field = flood(goal); key = k; }
    const cur = cellIndex(map, me), x = cur % W, y = Math.floor(cur / W);
    // Quiet near anyone who is not already after us; flat out when chased or when nobody is around.
    const near = guards.some(n => n.kind !== 'civilian' && dist(n, me) < 9), sneak = near && !chaser;
    if (cur === cellIndex(map, goal)) return { input: target ? push(target, false) : dist(me, goal) > .15 ? push(goal, true) : still(), tool };
    let next = cur;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = (y + dy) * W + x + dx; if (field[n] < field[next] && !(dx && dy && (field[y * W + x + dx] >= 1e9 || field[(y + dy) * W + x] >= 1e9))) next = n; }
    if (next === cur) return { input: still(), tool };
    const want = push({ x: next % W + .5, y: Math.floor(next / W) + .5 }, sneak);
    // A door, lock or window on the way is worked by pushing straight into it.
    if (g.solid[next] || (!guards.length && !swept(me))) return { input: { x: want.x * (sneak ? .5 : pace), y: want.y * (sneak ? .5 : pace), sneak }, tool };
    // Standing still is only an answer while nobody is looking this way.
    let best = -Infinity, input = still();
    for (let i = risk(me) < 3 ? -1 : 0; i < 16; i++) {
      const dir = i < 0 ? { x: 0, y: 0 } : { x: Math.cos(i * Math.PI / 8), y: Math.sin(i * Math.PI / 8) }, score = 2 * (dir.x * want.x + dir.y * want.y) - (chaser || view.players.some(armed) ? .25 : 1) * risk({ x: me.x + dir.x * .8, y: me.y + dir.y * .8 });
      if (score > best) { best = score; input = { x: dir.x * (sneak ? .5 : 1), y: dir.y * (sneak ? .5 : 1), sneak }; }
    }
    return { input, tool };
  };
}
