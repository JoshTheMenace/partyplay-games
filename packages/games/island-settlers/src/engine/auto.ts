/**
 * Deterministic, always-legal auto-actions for every timed step and prompt (ENGINE §5), the
 * CPU error fallback, and the per-tick deadline sweep. Every auto logs one `auto` event.
 */
import { pips } from '../geometry';
import {
  CONNECT_MIN_OPEN_SECONDS, RESOURCES, type BuildPiece, type Resource, type SeatId, type TimedStep,
} from '../model';
import { boardIndex } from './board/lookup';
import { build } from './build';
import { validateAnswer } from './commands';
import { emit } from './events';
import { afterPlacement, allReady, end, role, roll, stepOf, windowClosable } from './flow';
import { targets } from './legal';
import type { Answer } from './modules/registry';
import { closePrompt, promptSpec, seatPrompts, tablePromptOpen } from './prompts';
import { bump } from './stats';
import { queueEffect, random, seatName, type OpenPrompt, type State } from './state';
import { closeOffers, expireOffers } from './trade';

type Reason = 'timeout' | 'disconnected' | 'error';

/** Setup value of a corner: pips + 2 per new resource type + port bonus. */
function spotValue(s: State, seat: SeatId, v: string) {
  const index = boardIndex(s.board), vertex = index.vertex.get(v);
  if (!vertex) return 0;
  const owned = new Set(Object.values(s.pieces.buildings).filter(b => b.seat === seat)
    .flatMap(b => index.vertex.get(b.vertex)?.tiles ?? []).map(t => index.tile.get(t)?.terrain));
  const tiles = vertex.tiles.map(t => index.tile.get(t)!).filter(t => t);
  const fresh = new Set(tiles.map(t => t.terrain).filter(t => RESOURCES.includes(t as Resource) && !owned.has(t)));
  const port = index.portAt.get(v);
  return tiles.reduce((n, t) => n + pips(t.number), 0) + 2 * fresh.size + (port ? port.ratio === 2 ? 2 : 1 : 0);
}

/** The legal edge pointing toward the best open corner two steps away. */
function routeValue(s: State, seat: SeatId, e: string) {
  const index = boardIndex(s.board), edge = index.edge.get(e);
  if (!edge) return 0;
  const near = [edge.a, edge.b].filter(v => !s.pieces.buildings[v]);
  const far = near.flatMap(v => index.vertexNeighbors.get(v) ?? []);
  const crowded = (v: string) => (index.vertexNeighbors.get(v) ?? []).some(n => s.pieces.buildings[n]);
  const open = far.filter(v => !s.pieces.buildings[v] && !crowded(v));
  return Math.max(0, ...open.map(v => spotValue(s, seat, v)));
}

const best = (list: string[], value: (id: string) => number) =>
  list.reduce<{ id: string | null; v: number }>((b, id) => {
    const v = value(id);
    return v > b.v ? { id, v } : b;
  }, { id: null, v: -Infinity }).id;

function autoSetup(s: State, seat: SeatId) {
  const piece = s.turn.setup!.piece;
  const route = piece === 'road' || piece === 'ship';
  const kinds: BuildPiece[] = route ? s.profile.routeKinds : [piece === 'city' ? 'city' : 'settlement'];
  for (const kind of kinds) {
    const at = best(targets(s, seat, kind), id => (route ? routeValue : spotValue)(s, seat, id));
    if (at) { build(s, seat, kind, at); return afterPlacement(s, seat, at); }
  }
  afterPlacement(s, seat, null);
}

/** Auto steps wait behind open prompts exactly as actions do; the due timer retries once they close. */
const waits = (s: State, seat: SeatId) => tablePromptOpen(s) || seatPrompts(s, seat).length > 0;

/** Place owed free routes (Road Building) toward the best open spot, while any spot is legal. */
function placeFreeRoutes(s: State, seat: SeatId) {
  while (s.seats[seat].freeRoutes > 0 && !waits(s, seat)) {
    const kind = s.profile.routeKinds.find(k => targets(s, seat, k).length);
    const at = kind && best(targets(s, seat, kind), id => routeValue(s, seat, id));
    if (!kind || !at) { s.seats[seat].freeRoutes = 0; return; }
    build(s, seat, kind, at);
  }
}

function log(s: State, seat: SeatId, step: TimedStep, reason: Reason | null) {
  const p = s.seats[seat];
  if (!reason) return;
  bump(s, seat, 'timeouts');
  if (p.autoTurn !== s.turn.id) { p.autoStreak++; p.autoTurn = s.turn.id; }
  if (!p.connected && p.autoStreak >= 2) p.away = true;
  emit(s, { kind: 'auto', seat, step, reason, text: `Auto-played ${seatName(s, seat)} (${step})` });
}

/** The auto-action for the seat's current step; false when it owes no step. reason null: silent (CPU). */
export function autoStep(s: State, seat: SeatId, reason: Reason | null): boolean {
  const r = role(s, seat);
  if (!r) { delete s.timers[seat]; return false; }
  log(s, seat, stepOf(r), reason);
  if (r === 'setup') return autoSetup(s, seat), true;
  placeFreeRoutes(s, seat);
  if (waits(s, seat)) return true;
  if (r === 'roll') return roll(s, seat), true;
  closeOffers(s, seat, 'withdrawn');
  end(s, seat);
  return true;
}

/** Answer a prompt with its spec's auto; a broken auto closes the prompt so the table never stalls. */
export function autoPrompt(s: State, p: OpenPrompt, reason: Reason | null) {
  const spec = promptSpec(s, p.kind);
  log(s, p.seat, spec.timer, reason);
  const auto = spec.auto(s, p);
  let answer: Answer | null = null;
  try { answer = validateAnswer(spec.command(s, p), auto.picks, auto.cards); } catch { /* closed below */ }
  closePrompt(s, p);
  if (answer) spec.apply(s, p, answer);
}

/** CPU fallback: the prompt's auto answer, else the step's auto-action (reason null: silent). */
export function fallback(s: State, seat: SeatId, reason: Reason | null = 'error'): boolean {
  const p = seatPrompts(s, seat)[0];
  if (p) return autoPrompt(s, p, reason), true;
  return !tablePromptOpen(s) && autoStep(s, seat, reason);
}

export type Pace = 'think' | 'forced' | 'respond';

/** What a CPU should wake up for now, keyed so a new duty gets a fresh think delay. */
export function cpuDuty(s: State, id: SeatId): { key: string; pace: Pace } | null {
  const prompts = seatPrompts(s, id), offers = Object.values(s.offers);
  if (prompts.length) {
    const forced = prompts.every(p => p.kind === 'discard' || p.kind === 'gold');
    return { key: `p:${prompts.map(p => p.id)}`, pace: forced ? 'forced' : 'think' };
  }
  if (tablePromptOpen(s) || s.queue.length) return null;
  const r = role(s, id);
  if (r) return { key: `r:${s.turn.id}:${r}`, pace: 'think' };
  const asked = offers.filter(o => o.responses[id] === 'pending' || o.from === id);
  return asked.length ? { key: `o:${asked.map(o => o.id)}`, pace: 'respond' } : null;
}

const PACE_MS: Record<Pace, [number, number]> = { think: [600, 1200], forced: [400, 800], respond: [800, 1600] };

/** Think delay from rng.cpu; Easy adds 0.3 s. */
export function cpuDelay(s: State, level: string, pace: Pace, next = random(s, 'cpu')) {
  const [lo, hi] = PACE_MS[pace];
  return lo + Math.floor(next() * (hi - lo)) + (level === 'easy' ? 300 : 0);
}

/** After every commit: a CPU with a new duty waits a think delay before acting. */
export function wakeCpus(s: State) {
  for (const id of s.order) {
    const cpu = s.seats[id].cpu, duty = cpu && cpuDuty(s, id);
    if (!cpu || (duty?.key ?? '') === cpu.duty) continue;
    cpu.duty = duty?.key ?? '';
    if (duty) cpu.nextAt = s.now + cpuDelay(s, cpu.level, duty.pace);
  }
}

const reasonFor = (s: State, seat: SeatId): Reason => (s.seats[seat].connected ? 'timeout' : 'disconnected');

/** The earliest moment anything expires, so quiet ticks can skip committing. */
export function dueAt(s: State): number {
  const t = s.turn;
  if (t.stage === 'ended') return Infinity;
  if (t.stage === 'finale') return s.results?.completeAt ?? s.now;
  // A step waits behind open prompts (expireDue skips it), so only the prompt deadline counts.
  const steps = Object.entries(s.timers).filter(([id]) => !waits(s, id));
  const times = [
    ...steps.map(([, x]) => x.deadline), ...Object.values(s.prompts).map(p => p.deadline),
    ...Object.values(s.offers).map(o => o.expires),
  ].filter((x): x is number => x !== null);
  if (allReady(s)) times.push(t.openedAt + CONNECT_MIN_OPEN_SECONDS * 1000);
  return times.length ? Math.min(...times) : Infinity;
}

/** Run everything due at `s.now` (inside a commit). */
export function expireDue(s: State) {
  if (s.turn.stage === 'finale') {
    if (s.now >= (s.results?.completeAt ?? 0)) s.turn.stage = 'ended';
    return;
  }
  const due = (d: number | null) => d !== null && d <= s.now;
  for (const p of Object.values(s.prompts).filter(p => due(p.deadline))) {
    if (s.prompts[p.id]) autoPrompt(s, p, reasonFor(s, p.seat));
  }
  for (const [seat, timer] of Object.entries(s.timers)) {
    const owes = due(timer.deadline) && s.timers[seat] === timer && !waits(s, seat);
    if (owes) autoStep(s, seat, reasonFor(s, seat));
  }
  expireOffers(s);
  if (windowClosable(s, CONNECT_MIN_OPEN_SECONDS * 1000)) queueEffect(s, { type: 'end-round' });
}
