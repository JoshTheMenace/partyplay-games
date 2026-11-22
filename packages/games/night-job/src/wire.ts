/* What travels: a packed form of one crew's View, the room-wide board, and what never changes sent once.
 * Browser-safe. The server projects a full View (sim/view.ts) and packs it; every screen unpacks back to a View. */
import { SAFE_COINS, crewStarts, type CrewLine, type CrewStats, type Effect, type EffectKind, type Intel, type MissionId, type News, type Noise, type NpcKind, type NpcState, type ObjectState, type Phase, type Role, type Settings, type Shot, type Tool, type View } from './model';
import { getMap } from './maps';

const PHASES: readonly Phase[] = ['infiltrate', 'escape', 'clear', 'failed'], KINDS: readonly NpcKind[] = ['guard', 'dog', 'civilian'], INTEL: readonly Intel['kind'][] = ['guard', 'dog', 'civilian', 'camera', 'laser'];
const STATES: readonly NpcState[] = ['patrol', 'suspicious', 'investigate', 'chase', 'search', 'stunned', 'charmed', 'panic'], OBJECT: readonly ObjectState['state'][] = ['ready', 'open', 'empty', 'disabled', 'used'];
const NOISES: readonly Noise['kind'][] = ['step', 'loud', 'decoy', 'scream', 'alarm'], SHOTS: readonly Shot['kind'][] = ['guard', 'tranq', 'shotgun'];
const EFFECTS: readonly EffectKind[] = ['coin', 'safe', 'unlock', 'hack', 'rescue', 'heal', 'hurt', 'down', 'spotted', 'takedown', 'break', 'smoke', 'emp', 'decoy', 'objective', 'charge', 'alarm', 'escape', 'charm', 'disguise', 'bail'];
const FLAGS = ['moving', 'running', 'down', 'connected', 'suspended', 'hidden', 'disguised', 'carrying'] as const, STATS: readonly (keyof CrewStats)[] = ['coins', 'spotted', 'takedowns', 'revives', 'downs', 'tools'];

/** Sent once per socket (manifest snapshotCache): the job and the whole room in seat order. Crews follow from the roster's length. */
export type Base = { mission: MissionId; difficulty: Settings['difficulty']; roster: [id: string, name: string, color: string, role: Role, tool: Tool][] };
/** Attached once the night is over: per-seat stats and who left early. */
export type Final = { stats: number[][]; left: number[] };
/** One crew's packed View. Times are milliseconds relative to `h[2]` (the crew's clock). */
export type Live = {
  h: [heistId: string, phase: number, now: number, elapsed: number, message: string, crew: number, bails: number, collected: number];
  p: number[][]; w: [seat: number, target: string, label: string, progress: number][];
  n: (string | number)[][]; i: number[][]; d: string; b: number[]; c: string; o: number[][];
  j: [x: number, y: number, carrier: number, taken: number]; s: number[][]; z: number[][]; x: number[][]; f: (string | number)[][]; a: number[] | 0;
};
export type Wire = {
  rev: number; base: Base; final: Final | null;
  /** The night's clock, and when sunrise ends a crew night (0 on a single-crew job). */
  now: number; ends: number;
  board: number[][]; news: [at: number, crew: number, text: string][];
  /** The crew on the shared screen, and its View. */
  cast: number; live: Live;
};
/** A seat's private view: its own hint, and its own crew when the shared screen is showing another one. */
export type Own = { hint: string; live: Live | null };

const hex = (bits: string) => bits.replace(/.{1,4}/g, c => parseInt(c.padEnd(4, '0'), 2).toString(16));
const unhex = (h: string, n: number) => [...h].map(c => parseInt(c, 16).toString(2).padStart(4, '0')).join('').slice(0, n);
/** Objects whose state travels: everything but the exit, windows and unlocked doors (the same list sim/view.ts projects). */
const stateful = (mission: MissionId) => getMap(mission).objects.filter(o => !(o.kind === 'exit' || o.kind === 'window' || (o.kind === 'door' && !o.locked)));

export function pack(v: View): Live {
  const seat = (id: string | null | undefined) => v.players.find(p => p.id === id)?.seat ?? -1, t = (at: number) => Math.round(at - v.now), ids = stateful(v.mission).map(o => o.id);
  return {
    h: [v.heistId, PHASES.indexOf(v.phase), v.now, v.elapsed, v.message, v.crew, v.bails, v.collected],
    p: v.players.map(p => [p.seat, p.x, p.y, p.facing, p.health, p.coins, p.charges, FLAGS.reduce((bits, flag, i) => bits | (+p[flag] << i), 0)]),
    w: v.players.flatMap(p => p.work ? [[p.seat, p.work.target, p.work.label, p.work.progress] as Live['w'][number]] : []),
    n: v.npcs.map(n => [n.id, KINDS.indexOf(n.kind), n.x, n.y, n.facing, STATES.indexOf(n.state), n.suspicion, +n.moving, ...(n.aiming ? [n.aiming.x, n.aiming.y] : [])]),
    i: v.intel.map(i => [INTEL.indexOf(i.kind), i.x, i.y, i.facing]),
    d: v.doors, b: v.broken, c: hex(v.coins),
    o: v.objects.flatMap(o => o.state === 'ready' && !o.progress ? [] : [[ids.indexOf(o.id), OBJECT.indexOf(o.state), o.progress, o.until && t(o.until)]]),
    j: [v.objective.x, v.objective.y, seat(v.objective.carrier), +v.objective.taken],
    s: v.smoke.map(s => [s.x, s.y, s.radius, t(s.until), t(s.born)]),
    z: v.noises.map(n => [n.x, n.y, n.radius, t(n.at), NOISES.indexOf(n.kind)]),
    x: v.shots.map(s => [s.from.x, s.from.y, s.to.x, s.to.y, t(s.at), +s.hit, SHOTS.indexOf(s.kind)]),
    f: v.effects.map(e => [e.id, EFFECTS.indexOf(e.kind), e.x, e.y, t(e.at), e.label, seat(e.player)]),
    a: v.alarm ? [v.alarm.x, v.alarm.y, t(v.alarm.until)] : 0,
  };
}

export function unpack(l: Live, base: Base, final: Final | null = null): View {
  const [heistId, phase, now, elapsed, message, crew, bails, collected] = l.h, map = getMap(base.mission), objects = stateful(base.mission), id = (seat: number) => base.roster[seat]?.[0] ?? null;
  const states = new Map(l.o.map(o => [o[0], o])), zero = { coins: 0, spotted: 0, takedowns: 0, revives: 0, downs: 0, tools: 0 };
  const players: View['players'] = l.p.map(([seat, x, y, facing, health, coins, charges, bits]) => {
    const [pid, name, color, role, tool] = base.roster[seat], work = l.w.find(w => w[0] === seat);
    return { id: pid, name, color, seat, role, tool, x, y, facing, health, coins, charges, ...Object.fromEntries(FLAGS.map((flag, i) => [flag, !!(bits >> i & 1)])) as Pick<View['players'][number], typeof FLAGS[number]>, work: work ? { target: work[1], label: work[2], progress: work[3] } : null, hint: '' };
  });
  return {
    heistId, mission: base.mission, phase: PHASES[phase], now, elapsed, message, crew, bails, players,
    npcs: l.n.map(n => ({ id: n[0] as string, kind: KINDS[n[1] as number], x: n[2] as number, y: n[3] as number, facing: n[4] as number, state: STATES[n[5] as number], suspicion: n[6] as number, moving: !!n[7], aiming: n.length > 8 ? { x: n[8] as number, y: n[9] as number } : null })),
    intel: l.i.map(([kind, x, y, facing]) => ({ kind: INTEL[kind], x, y, facing })),
    doors: l.d, broken: l.b, coins: unhex(l.c, map.coins.length),
    objects: objects.map((o, i) => { const s = states.get(i); return { id: o.id, state: s ? OBJECT[s[1]] : 'ready', progress: s ? s[2] : 0, until: s?.[3] ? now + s[3] : 0 }; }),
    objective: { x: l.j[0], y: l.j[1], carrier: id(l.j[2]), taken: !!l.j[3] }, objectiveTaken: !!l.j[3],
    smoke: l.s.map(([x, y, radius, until, born]) => ({ x, y, radius, until: now + until, born: now + born })),
    noises: l.z.map(([x, y, radius, at, kind]) => ({ x, y, radius, at: now + at, kind: NOISES[kind] })),
    shots: l.x.map(([fx, fy, tx, ty, at, hit, kind]) => ({ from: { x: fx, y: fy }, to: { x: tx, y: ty }, at: now + at, hit: !!hit, kind: SHOTS[kind] })),
    effects: l.f.map(e => { const player = id(e[6] as number); return { id: e[0], kind: EFFECTS[e[1] as number], x: e[2], y: e[3], at: now + (e[4] as number), label: e[5], ...(player ? { player } : {}) } as Effect; }),
    alarm: l.a ? { x: l.a[0], y: l.a[1], until: now + l.a[2] } : null,
    collected, totalLoot: map.coins.length + map.objects.filter(o => o.kind === 'safe').length * SAFE_COINS,
    stats: Object.fromEntries(players.map(p => [p.id, final ? Object.fromEntries(STATS.map((key, i) => [key, final.stats[p.seat]?.[i] ?? 0])) as CrewStats : { ...zero }])),
  };
}

export const packLine = (l: CrewLine) => [PHASES.indexOf(l.phase), l.collected, l.seconds, l.bails, +l.alarm | +l.chased << 1 | +l.taken << 2, l.down, l.place];
export const packStats = (stats: CrewStats) => STATS.map(key => stats[key]);

/** Everything a screen needs from one snapshot. `crews` lists each crew's seats.
 * `left`: seconds until sunrise (0 on a single-crew job). `lastCall`: a crew is away, so the clock is the short one. */
export type Night = { wire: Wire; rival: boolean; crews: number[][]; lines: CrewLine[]; news: News[]; cast: View; left: number; lastCall: boolean };
const nights = new WeakMap<Wire, Night>();
export function decode(wire: Wire): Night {
  let night = nights.get(wire);
  if (!night) {
    const starts = crewStarts(wire.base.roster.length), crews = starts.slice(0, -1).map((start, c) => Array.from({ length: starts[c + 1] - start }, (_, i) => start + i));
    const lines = wire.board.map(([phase, collected, seconds, bails, bits, down, place], crew) => ({ crew, size: crews[crew].length, phase: PHASES[phase], collected, seconds, bails, alarm: !!(bits & 1), chased: !!(bits & 2), taken: !!(bits & 4), down, place }));
    night = { wire, rival: crews.length > 1, crews, lines, news: wire.news.map(([at, crew, text]) => ({ at, crew, text })), cast: unpack(wire.live, wire.base, wire.final), left: wire.ends ? Math.max(0, Math.ceil((wire.ends - wire.now) / 1000)) : 0, lastCall: lines.some(line => line.phase === 'clear') };
    nights.set(wire, night);
  }
  return night;
}
export const crewOf = (night: Night, playerId: string | null) => { const seat = night.wire.base.roster.findIndex(p => p[0] === playerId); return seat < 0 ? -1 : night.crews.findIndex(seats => seats.includes(seat)); };
const mine = new WeakMap<Own, View>();
/** The View a seat plays from: its own crew, with its own hint. Null for someone who is not in this round. */
export function ownView(wire: Wire, own: Own | null, playerId: string | null): View | null {
  const night = decode(wire);
  if (crewOf(night, playerId) < 0 || !own) return null;
  let view = mine.get(own);
  if (!view) {
    const crew = own.live ? unpack(own.live, wire.base, wire.final) : night.cast;
    view = { ...crew, players: crew.players.map(p => p.id === playerId ? { ...p, hint: own.hint } : p) }; mine.set(own, view);
  }
  return view;
}
