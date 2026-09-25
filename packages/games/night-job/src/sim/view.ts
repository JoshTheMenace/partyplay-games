/* Public projection: only what the crew could know. Hidden NPCs never leave the server. */
import { RADIUS, cameraAngle, type Intel, type NpcView, type ObjectState, type PlayerView, type Point, type View } from '../model';
import { lineOfSight } from '../geometry';
import { dist, doorAt, grids, mapOf, vulnerable, type Crew, type State } from './state';
import { pickTarget } from './crew';
import { deviceOn } from './security';

const INTEL_RANGE = 12;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (p: Point): Point => ({ x: r2(p.x), y: r2(p.y) });

function hint(s: State, p: Crew): string {
  const noun = mapOf(s).objectiveKind, exit = mapOf(s).objects.find(o => o.kind === 'exit')!, atExit = dist(p, exit) <= RADIUS.exit;
  if (s.phase === 'clear') return 'Clean getaway! Nice work.';
  if (s.phase === 'failed') return 'Busted. Regroup and try another route.';
  if (p.suspended) return 'Reconnect to rejoin the crew.';
  if (p.down) return p.wind && !s.crew.some(q => q !== p && !q.suspended) ? 'Downed. Once no guard is watching, you will get back up.' : 'Downed. A teammate can revive you.';
  if (p.work) return `${p.work.label}… keep pushing.`;
  if (s.npcs.some(n => n.aimAt && n.target === p.id)) return 'A guard is taking aim! Break line of sight.';
  if (p.hidden) return p.witnesses.length ? 'They saw you hide! Slip out and run.' : 'Hidden. Hold still until they pass; push to slip out.';
  if (s.npcs.some(n => n.state === 'chase' && n.target === p.id)) return 'Spotted! Lose them with doors, smoke or a hiding spot.';
  const fallen = s.crew.find(q => q !== p && q.down && !q.suspended);
  if (fallen) return `${fallen.name} is down. Push into them to revive.`;
  if (s.objective.carrier === p.id) return atExit ? 'Hold at the getaway until the whole crew is here.' : `You have the ${noun}! Get to the getaway.`;
  const near = pickTarget(s, p, null);
  if (near) return near.hint;
  if (s.objective.taken && !s.objective.carrier) return `The ${noun} was dropped. Pick it up!`;
  if (s.objective.taken) return atExit ? 'Wait here for the crew.' : 'Get to the getaway with the crew.';
  if (s.npcs.some(n => n.state === 'suspicious' && n.suspicion > .15 && n.lastKnown && dist(n.lastKnown, p) < .5)) return 'Someone is getting suspicious. Back off or hide.';
  if (s.alarm) return 'Alarm! Guards are converging. Lie low.';
  if (p.charges < 1) return `Out of charges. ${10 - p.coins % 10} more coins refills one.`;
  if (p.running) return 'Running is loud. A light push sneaks.';
  return p.role === 'scout' ? 'Stand still or sneak to sense guards through walls.' : `Find the ${noun}. A light push sneaks quietly.`;
}

export function project(s: State): View {
  const map = mapOf(s), { grid } = grids(s), eyes = s.crew.filter(p => !p.suspended);
  const visible = (q: Point) => eyes.some(p => dist(p, q) <= RADIUS.crewSight && lineOfSight(grid, p, q, s.smoke, s.now));
  const shown = new Set(s.npcs.filter(visible).map(n => n.id));
  const npcs: NpcView[] = s.npcs.filter(n => shown.has(n.id)).map(n => ({ id: n.id, kind: n.kind, ...pt(n), facing: r2(n.facing), state: n.state, suspicion: r2(n.suspicion), aiming: n.aim ? pt(n.aim) : null, moving: n.moving }));
  const intel: Intel[] = [];
  const scouts = s.crew.filter(p => p.role === 'scout' && vulnerable(p) && !p.running), wires = s.crew.filter(p => p.role === 'wire' && vulnerable(p));
  for (const n of s.npcs) if (!shown.has(n.id) && scouts.some(p => dist(p, n) <= INTEL_RANGE)) intel.push({ kind: n.kind, ...pt(n), facing: r2(n.facing) });
  for (const o of map.objects) if ((o.kind === 'camera' || o.kind === 'laser') && deviceOn(s, o) && wires.some(p => dist(p, o) <= INTEL_RANGE)) intel.push({ kind: o.kind as 'camera' | 'laser', ...pt(o), facing: r2(o.kind === 'camera' ? cameraAngle(o, s.now) : o.facing ?? 0) });
  const objects: ObjectState[] = [];
  for (const o of map.objects) {
    if (o.kind === 'exit' || o.kind === 'window' || (o.kind === 'door' && !o.locked)) continue;
    const off = o.kind === 'camera' || o.kind === 'laser' ? Math.max(s.circuits[o.circuit ?? ''] ?? 0, s.deviceOff[o.id] ?? 0) : o.kind === 'terminal' ? s.circuits[o.circuit ?? ''] ?? 0 : 0;
    const state: ObjectState['state'] = off > s.now ? (o.kind === 'terminal' ? 'used' : 'disabled') : s.spent.includes(o.id) ? 'empty' : o.kind === 'objective' && s.objective.taken ? 'empty' : o.kind === 'door' && s.doors[doorAt(s, o.x, o.y)] !== 'l' ? 'open' : 'ready';
    objects.push({ id: o.id, state, progress: r2(o.kind === 'camera' ? s.meters[o.id] ?? 0 : s.progress[o.id] ?? 0), until: off > s.now ? off : 0 });
  }
  const players: PlayerView[] = s.crew.map(p => ({
    id: p.id, name: p.name, color: p.color, seat: p.seat, role: p.role, tool: p.tool, ...pt(p),
    health: p.health, coins: p.coins, charges: p.charges, facing: r2(p.facing),
    moving: p.moving, running: p.running, down: p.down, connected: p.connected, suspended: p.suspended, hidden: p.hidden, disguised: p.disguised, carrying: s.objective.carrier === p.id,
    work: p.work && { target: p.work.target, label: p.work.label, progress: r2(p.work.progress) }, hint: hint(s, p),
  }));
  const seen = (e: Point & { crew: boolean }) => e.crew || visible(e);
  return {
    heistId: s.heistId, mission: s.mission, phase: s.phase, now: s.now, elapsed: r2(s.elapsed), message: s.message,
    players, npcs, intel, doors: s.seenDoors, broken: [...s.broken], coins: s.coins, objects,
    objective: { ...pt(s.objective), carrier: s.objective.carrier, taken: s.objective.taken }, objectiveTaken: s.objective.taken,
    smoke: s.smoke.map(c => ({ ...pt(c), radius: c.radius, until: c.until, born: c.born })),
    noises: s.noises.filter(seen).map(n => ({ ...pt(n), radius: n.radius, at: n.at, kind: n.kind })),
    shots: s.shots.filter(x => x.crew || visible(x.from) || visible(x.to)).map(x => ({ from: pt(x.from), to: pt(x.to), at: x.at, hit: x.hit, kind: x.kind })),
    effects: s.effects.filter(seen).map(e => ({ id: e.id, kind: e.kind, ...pt(e), at: e.at, label: e.label, ...(e.player ? { player: e.player } : {}) })),
    alarm: s.alarm && { ...pt(s.alarm), until: s.alarm.until },
    collected: s.collected, totalLoot: s.totalLoot, stats: structuredClone(s.stats),
  };
}
