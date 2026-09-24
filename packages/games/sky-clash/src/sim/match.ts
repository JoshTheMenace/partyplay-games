/**
 * Match flow: create (seats, CPUs, random picks, stage vote, spawns), the 60 Hz tick (countdown → fight → time/sudden
 * death → complete), KOs through the blast zones, respawn halos, disconnect forfeits, the public view and the outcome.
 */
import type { Outcome, RoundContext } from '../../../../party-contract/src/index';
import { MAX_FIGHTERS, ROSTER, ROSTER_DATA, neutralInput, type CpuLevel, type FighterKind, type FighterView, type Input, type LobbyChoice, type Settings, type StageId, type View } from '../model';
import { STAGE_IDS, getStage, resolveStage, stageFrame } from '../stages';
import { P, alive, byId, clearMove, creditOf, dropHeld, isSpecial, scriptFrame, setState } from './common';
import { liveHits, orphanCheck, resolveCombat } from './combat';
import { cpuInput, partnerInput } from './cpu';
import { RESPAWN_WAIT, stepFighter } from './fighter';
import { stepHazard, stepProjectiles } from './projectiles';
import { chargeFraction, phaseOf } from './specials';
import { CHARGE_FRAMES } from './formulas';
import { PRESS_KEYS, type Fighter, type State } from './types';
import { emit, pruneEvents, random, readInput } from './util';
import { surfaces, unstick } from './world';

const COUNTDOWN_MS = 3000, GAME_MS = 2000, SUDDEN_MS = 60000, FORFEIT_MS = 20000, OUT_FRAMES = 90, CREDIT_FRAMES = 900;
const CPU_COLORS = ['#a7b0c0', '#b58aff', '#78d955', '#ffd24a'];
const REGULAR = ROSTER.filter(k => !ROSTER_DATA[k].bonus);
const zero = () => ({ attack: 0, special: 0, jump: 0, shield: 0, smash: 0, grab: 0 });

/** CPU fighters for this roster: capped at four fighters, and a lone human always gets one. */
export const cpuCount = (humans: number, settings: Settings) => { const n = Math.max(0, Math.min(settings.cpus, MAX_FIGHTERS - humans)); return humans === 1 && n === 0 ? 1 : n; };
function newFighter(id: string, name: string, color: string, kind: FighterKind, costume: number, seat: number, cpu: CpuLevel | null): Fighter {
  return {
    id, name, color, kind, costume, team: null, cpu, connected: true, seat, x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, facing: 1, grounded: true, ground: null,
    state: 'idle', stateFrame: 0, timer: 0, move: null, moveFrame: 0, phase: '', phaseFrame: 0, charge: 0, hitlag: 0, damage: 0, stocks: 0, kos: 0, falls: 0, dealt: 0, shield: 100,
    jumpsLeft: 0, launch: 0, combo: 0, hitstun: 0, tumble: false, invincible: 0, intangibleNow: false, armorNow: false,
    fastFall: false, helpless: false, helplessLag: 0, airdodged: false, shortHop: false, aerialQueued: false, used: [], hitIds: [], staled: false, stale: [],
    lastHitBy: null, lastHitFrame: -1e9, ledge: null, ledgeSide: 1, ledgeFresh: true, ledgeCooldown: 0, ledgeTarget: 0, grabbedBy: null, holding: null, grabTimer: 0,
    shieldFrame: 0, techPress: -1e9, techLock: 0, bounces: 0, pending: null, sdiDir: -9,
    seen: zero(), buf: { attack: -1e9, special: -1e9, jump: -1e9, shield: -1e9, smash: -1e9, grab: -1e9 },
    held: { attack: false, special: false, jump: false, shield: false, smash: false }, px: 0, py: 0, sx: 0, sy: 0, hist: [], aim: { x: 0, y: 0 },
    coyote: 0, dropThrough: 0, runFrames: 0, dashing: 0, special: {}, disconnectedAt: null, respawnTimer: 0, outTimer: 0, eliminated: 0, hazardHit: 0,
    cpuMemo: { presses: zero(), plan: '', until: 0, next: 0, x: 0, y: 0, hold: { attack: false, special: false, jump: false, shield: false, smash: false }, target: null, stuck: 0, lastX: 0, recover: -99, mash: 0 },
    leader: null, echo: [],
  };
}
/** Lenient read of a stored lobby choice (the room already validated it); anything missing becomes Random with no vote. */
export function readChoice(raw: unknown): LobbyChoice {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fighter = c.fighter === 'random' || (ROSTER as unknown[]).includes(c.fighter) ? c.fighter as LobbyChoice['fighter'] : null;
  const stage = c.stage === 'random' || (STAGE_IDS as readonly unknown[]).includes(c.stage) ? c.stage as LobbyChoice['stage'] : null;
  const costume = Number.isInteger(c.costume) && (c.costume as number) >= 0 && (c.costume as number) < 4 ? c.costume as number : 0;
  return { fighter, costume, stage };
}
/** Most-voted stage; ties (and a winning 'random') resolve from the seed. No votes → Battlefield. */
export function tallyStage(votes: readonly (StageId | 'random' | null)[], pick: () => number): StageId {
  const counts = new Map<StageId | 'random', number>();
  for (const v of votes) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (!counts.size) return 'battlefield';
  const max = Math.max(...counts.values()), leaders = [...counts].filter(([, n]) => n === max).map(([id]) => id).sort();
  const won = leaders[Math.floor(pick() * leaders.length)]!;
  return won === 'random' ? STAGE_IDS[Math.floor(pick() * STAGE_IDS.length)]! : won;
}

export function createMatch(ctx: RoundContext, settings: Settings): State {
  const s: State = {
    turnId: ctx.roundId, phase: 'countdown', phaseEndsAt: ctx.nowMs + COUNTDOWN_MS, endsAt: settings.seconds ? ctx.nowMs + COUNTDOWN_MS + settings.seconds * 1000 : 0,
    frame: 0, stageId: 'battlefield', stageTick: 0, hazards: settings.hazards, teams: settings.teams, stocks: settings.stocks, settings: { ...settings },
    seed: ctx.seed >>> 0, rng: (ctx.seed >>> 0) ^ 0x9e3779b9, fighters: [], projectiles: [], events: [], eventId: 0, projectileId: 0,
    eliminations: 0, winners: [], hazardCycle: -1, lastNow: ctx.nowMs,
  };
  const pick = () => random(s), humans = ctx.players.slice(0, MAX_FIGHTERS), choices = humans.map(p => readChoice(p.lobbyChoice));
  const kinds = (c: LobbyChoice) => c.fighter && c.fighter !== 'random' ? c.fighter : REGULAR[Math.floor(pick() * REGULAR.length)]!;
  humans.forEach((p, i) => { const c = choices[i]!; s.fighters.push(newFighter(p.id, p.name, p.color, kinds(c), c.fighter === 'random' ? 0 : c.costume, i, null)); });
  for (let i = 0, n = cpuCount(humans.length, settings); i < n; i++) {
    const seat = s.fighters.length;
    s.fighters.push(newFighter(`cpu-${i + 1}`, `CPU ${i + 1}`, CPU_COLORS[seat % CPU_COLORS.length]!, REGULAR[Math.floor(pick() * REGULAR.length)]!, 0, seat, settings.cpuLevel));
  }
  // Same fighter twice: later seats take the next free costume.
  for (const f of s.fighters) { const used = s.fighters.filter(o => o !== f && o.seat < f.seat && o.kind === f.kind).map(o => o.costume); while (used.includes(f.costume)) f.costume = (f.costume + 1) % 4; }
  s.stageId = settings.stage === 'vote' ? tallyStage(choices.map(c => c.stage), pick) : settings.stage === 'random' ? resolveStage('random', Math.floor(pick() * 2 ** 31)) : settings.stage;
  const stage = getStage(s.stageId), mid = (stage.camera.left + stage.camera.right) / 2;
  s.fighters.forEach((f, i) => {
    if (settings.teams) f.team = (i % 2) as 0 | 1;
    const [x, y] = stage.spawns[i % stage.spawns.length]!;
    f.stocks = settings.stocks; f.x = f.px = x; f.y = f.py = y; f.facing = x > mid ? -1 : 1; f.jumpsLeft = P(f).jumps; f.cpuMemo.lastX = x;
  });
  // Ice Climbers: each Popo (or Nana) pick brings the other climber as a partner, spawned just inside and sharing the leader's stock.
  for (const f of s.fighters.filter(f => f.kind === 'popo' || f.kind === 'nana')) {
    const kind = f.kind === 'popo' ? 'nana' : 'popo', n = newFighter(`${f.id}+${kind}`, ROSTER_DATA[kind].name, f.color, kind, f.costume, f.seat, null), x = f.x + f.facing * .7;
    Object.assign(n, { leader: f.id, team: f.team, facing: f.facing, x, px: x, y: f.y, py: f.y, jumpsLeft: P(n).jumps, cpuMemo: { ...n.cpuMemo, lastX: x } });
    s.fighters.push(n);
  }
  const env = stageFrame(s.stageId, 0, s.hazards), list = surfaces(env);
  for (const f of s.fighters) { const q = list.find(o => Math.abs(o.y - f.y) < .05 && f.x >= o.left && f.x <= o.right); f.ground = q?.id ?? null; f.grounded = !!q; if (!q) setState(f, 'air'); }
  return s;
}

export function stepMatch(s: State, inputs: ReadonlyMap<string, Input>, now: number) {
  if (s.phase === 'complete') { s.lastNow = now; return; } // the world freezes under the GAME!/TIME! banner
  s.lastNow = now; s.frame++;
  if (s.phase === 'countdown') {
    // Input is ignored, but press counters are absorbed so nothing buffered fires at GO.
    for (const f of s.fighters) { const i = inputs.get(f.id); if (i) for (const k of PRESS_KEYS) f.seen[k] = Math.max(f.seen[k], i.presses[k]); }
    if (now >= s.phaseEndsAt) { s.phase = 'fight'; s.phaseEndsAt = s.endsAt; }
    return;
  }
  s.stageTick++;
  const env = stageFrame(s.stageId, s.stageTick, s.hazards), list = surfaces(env), idle = neutralInput(), fed = new Map<string, Input>();
  for (const f of s.fighters) {
    if (f.state === 'out') { if (f.stocks > 0 && --f.outTimer <= 0) respawn(s, f); continue; }
    const lead = byId(s, f.leader), input = lead ? partnerInput(s, f, lead, fed.get(lead.id) ?? idle, env, list) : f.cpu ? cpuInput(s, f, env, list) : f.connected ? inputs.get(f.id) ?? idle : idle;
    fed.set(f.id, input); readInput(s, f, input);
  }
  for (const f of s.fighters) stepFighter(s, f, env, list);
  for (const f of s.fighters) if (alive(f)) unstick(f, env);
  stepHazard(s, env);
  stepProjectiles(s, env, list);
  resolveCombat(s);
  orphanCheck(s);
  const blast = env.stage.blast;
  for (const f of s.fighters) if (alive(f) && f.state !== 'respawn' && (f.x < blast.left || f.x > blast.right || f.y < blast.bottom || f.y > blast.top)) ko(s, f, blast.top);
  for (const f of s.fighters) if (!f.cpu && !f.connected && f.stocks > 0 && f.disconnectedAt !== null && now - f.disconnectedAt >= FORFEIT_MS) eliminate(s, f);
  if (s.phase === 'fight' && s.endsAt && now >= s.endsAt) timeUp(s, now);
  else if (s.phase === 'sudden' && now >= s.phaseEndsAt) finish(s, s.fighters.filter(f => f.stocks > 0).map(f => f.id));
  if ((s.phase as State['phase']) !== 'complete') checkWinner(s);
  pruneEvents(s);
}
function ko(s: State, f: Fighter, top: number) {
  const up = f.y > top;
  if (up && f.state !== 'tumble' && f.state !== 'hitstun' && !f.launch) { f.y = top; f.vy = Math.min(0, f.vy); return; } // only launched fighters are KO'd off the top
  const angle = Math.round(Math.atan2(f.vy + f.ky, f.vx + f.kx) * 180 / Math.PI), killer = byId(s, f.lastHitBy);
  const credited = killer && killer !== f && (s.frame - f.lastHitFrame < CREDIT_FRAMES || f.state === 'tumble' || f.state === 'hitstun') ? killer : undefined;
  const scorer = credited && creditOf(s, credited);
  emit(s, 'ko', f.x, f.y, { target: f.id, source: scorer?.id, angle, power: 1 });
  if (up && random(s) < .35) emit(s, 'star-ko', f.x, top, { target: f.id, source: scorer?.id });
  if (f.leader) { retire(s, f); return; } // a lone partner costs no stock; she returns with her leader's next one
  if (scorer) scorer.kos++;
  f.falls++; f.stocks = s.phase === 'sudden' ? 0 : Math.max(0, f.stocks - 1);
  retire(s, f); f.outTimer = OUT_FRAMES;
  if (f.stocks <= 0) f.eliminated = ++s.eliminations;
}
function retire(s: State, f: Fighter) {
  dropHeld(s, f);
  const h = byId(s, f.grabbedBy); if (h?.holding === f.id) { h.holding = null; clearMove(h); setState(h, h.grounded ? 'idle' : 'air'); }
  clearMove(f); setState(f, 'out'); f.grabbedBy = null; f.ledge = null; f.pending = null; f.hitlag = 0; f.hitstun = 0; f.launch = 0; f.vx = f.vy = f.kx = f.ky = 0; f.special = {};
  for (const p of s.fighters) if (p.leader === f.id && alive(p)) retire(s, p); // the partner goes down with her leader's stock
}
function eliminate(s: State, f: Fighter) { f.stocks = 0; retire(s, f); f.eliminated = ++s.eliminations; }
function respawn(s: State, f: Fighter, point?: readonly [number, number]) {
  const stage = getStage(s.stageId), [x, y] = point ?? stage.respawns[f.seat % stage.respawns.length]!;
  f.x = f.px = x; f.y = f.py = y + 3; f.special = { haloY: y }; f.damage = s.phase === 'sudden' ? 300 : 0; f.shield = 100;
  f.grounded = false; f.ground = null; f.facing = x > (stage.camera.left + stage.camera.right) / 2 ? -1 : 1; f.jumpsLeft = P(f).jumps; f.used = [];
  f.fastFall = f.helpless = f.airdodged = false; f.respawnTimer = RESPAWN_WAIT; f.lastHitBy = null; f.combo = 0; f.tumble = false; f.invincible = 0;
  setState(f, 'respawn'); f.echo = [];
  emit(s, 'respawn', x, y, { source: f.id });
  for (const p of s.fighters) if (p.leader === f.id) respawn(s, p, [x + f.facing * .7, y]);
}
type Side = { ids: string[]; stocks: number; damage: number };
function sides(s: State): Side[] {
  const groups = new Map<string, Fighter[]>();
  for (const f of s.fighters) if (!f.leader) { const k = s.teams && f.team !== null ? `t${f.team}` : f.id; groups.set(k, [...groups.get(k) ?? [], f]); }
  return [...groups.values()].map(g => ({ ids: g.map(f => f.id), stocks: g.reduce((n, f) => n + f.stocks, 0), damage: g.filter(f => f.stocks > 0).reduce((n, f) => n + Math.floor(f.damage), 0) }));
}
/** Time up: most stocks, then lowest damage; anyone still tied goes to Sudden Death (300%, one stock, 60 s). */
function timeUp(s: State, now: number) {
  const standing = sides(s).filter(g => g.stocks > 0);
  const best = standing.reduce((a, g) => g.stocks > a.stocks || (g.stocks === a.stocks && g.damage < a.damage) ? g : a, standing[0]!);
  const tied = standing.filter(g => g.stocks === best.stocks && g.damage === best.damage);
  if (tied.length <= 1) { finish(s, best.ids); return; }
  const keep = new Set(tied.flatMap(g => g.ids)), stage = getStage(s.stageId);
  for (const f of [...s.fighters].filter(f => f.stocks > 0 && !keep.has(f.id)).sort((a, b) => a.stocks - b.stocks || b.damage - a.damage)) eliminate(s, f);
  s.phase = 'sudden'; s.phaseEndsAt = now + SUDDEN_MS; s.projectiles = [];
  let i = 0;
  for (const f of s.fighters) if (keep.has(f.id)) { f.stocks = 1; retire(s, f); respawn(s, f, stage.spawns[i++ % stage.spawns.length]); }
  emit(s, 'sudden-death', 0, 0, { power: 1 });
}
function checkWinner(s: State) {
  const standing = sides(s).filter(g => g.stocks > 0);
  if (standing.length > 1) return;
  if (standing.length === 1) { finish(s, standing[0]!.ids); return; }
  const last = Math.max(...s.fighters.map(f => f.eliminated)); // everyone fell on the same frame: the last ones out share it
  finish(s, s.fighters.filter(f => f.eliminated === last).map(f => f.id));
}
function finish(s: State, winners: string[]) { s.phase = 'complete'; s.winners = winners; s.phaseEndsAt = s.lastNow + GAME_MS; }

export function onPresence(s: State, id: string, connected: boolean, now: number) {
  const f = s.fighters.find(o => o.id === id && !o.cpu); if (!f) return;
  f.connected = connected; f.disconnectedAt = connected ? null : now;
}

// ── Views ─────────────────────────────────────────────────────────────────
const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0; // never -0 (JSON would change it)
function fighterView(s: State, f: Fighter): FighterView {
  const v: FighterView = {
    id: f.id, name: f.name, color: f.color, fighter: f.kind, costume: f.costume, team: f.team, cpu: f.cpu, connected: f.connected,
    x: r3(f.x), y: r3(f.y), vx: r3(f.vx + f.kx), vy: r3(f.vy + f.ky), facing: f.facing, grounded: f.grounded,
    state: f.state, stateFrame: f.stateFrame, move: f.move, moveFrame: f.move ? scriptFrame(f) : 0,
    charge: r3(!f.move ? 0 : isSpecial(f.move) ? chargeFraction(f) : Math.min(1, f.charge / CHARGE_FRAMES)), hitlag: f.hitlag, damage: r3(f.damage), stocks: byId(s, f.leader)?.stocks ?? f.stocks, kos: f.kos, falls: f.falls,
    shield: r3(Math.max(0, f.shield)), jumpsLeft: f.jumpsLeft, intangible: f.intangibleNow || f.state === 'respawn', armored: f.armorNow,
    launch: f.state === 'tumble' || f.state === 'hitstun' ? r3(f.launch) : 0, combo: f.combo, presses: { ...f.seen }, dealt: r3(f.dealt),
  };
  const hits = s.phase === 'complete' ? [] : liveHits(f);
  if (hits.length) v.hits = hits.map(h => ({ x: r3(h.x), y: r3(h.y), r: r3(h.r), limb: h.limb }));
  if (f.leader) v.partner = f.leader;
  if (f.grabbedBy) v.grabbedBy = f.grabbedBy;
  if (f.holding) v.holding = f.holding;
  if (f.state === 'ledge' || f.state === 'ledgeclimb') v.ledgeSide = f.ledgeSide;
  if (f.special.asleep) v.asleep = true;
  const script = f.move?.includes('special') ? phaseOf(f)?.script ?? f.phase : ''; // the MOVESET phase key (kit phases may borrow another script)
  if (script && script !== '-') v.movePhase = script;
  return v;
}
export function viewOf(s: State): View {
  return {
    turnId: s.turnId, phase: s.phase, phaseEndsAt: s.phaseEndsAt, endsAt: s.endsAt, frame: s.frame, stageId: s.stageId, stageTick: s.stageTick,
    hazards: s.hazards, teams: s.teams, stocks: s.stocks, fighters: s.fighters.map(f => fighterView(s, f)),
    projectiles: s.projectiles.map(p => ({ id: p.id, owner: p.owner, kind: p.kind, x: r3(p.x), y: r3(p.y), vx: r3(p.vx), vy: r3(p.vy), r: r3(p.r), life: p.life, effect: p.effect })),
    events: s.events.filter(e => e.frame >= s.frame - 60).slice(-48).map(e => ({ ...e, x: r3(e.x), y: r3(e.y), ...(e.power === undefined ? {} : { power: r3(e.power) }), ...(e.angle === undefined ? {} : { angle: r3(e.angle) }) })),
  };
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Winners share rank 1; the rest rank by how long they lasted, then stocks and damage. Ties share a rank. */
export function outcomeOf(s: State): Outcome {
  const win = new Set(s.winners), key = (f: Fighter) => [win.has(f.id) ? 0 : 1, f.stocks > 0 ? -1e6 : -f.eliminated, -f.stocks, f.stocks > 0 ? Math.floor(f.damage) : 0];
  const order = s.fighters.filter(f => !f.leader).sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!; return a.seat - b.seat; });
  let rank = 0;
  const rows = order.map((f, i) => {
    if (!i || key(f).some((v, j) => v !== key(order[i - 1]!)[j])) rank = i + 1;
    return { playerId: f.id, rank, score: f.kos, label: `${plural(f.stocks, 'stock')} · ${Math.floor(f.damage)}% · ${plural(f.kos, 'KO')}` };
  });
  return { complete: s.phase === 'complete' && s.lastNow >= s.phaseEndsAt, winners: [...s.winners], rows };
}
