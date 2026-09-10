import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { questions, type Question } from './content.server';
import type { Action, ChallengeView, Family, Phase, PrivateView, PublicView, Settings } from './types';

type Player = { id: string; name: string; color: string; connected: boolean; charge: number; distance: number; needsRescue: boolean; boost: boolean; answer: number | number[] | null; gained: number };
type Challenge = ChallengeView & { solution: number | number[] };
export type State = {
  roundId: string; rng: number; phase: Phase; serial: number; started: number; deadline: number; lastNow: number;
  round: number; finaleStep: number; players: Player[]; deck: Question[]; challenge: Challenge | null;
  families: Family[]; reveal: PublicView['reveal'];
};
const durations: Record<Phase, number> = { instructions: 25000, quiz: 30000, 'quiz-reveal': 8000, 'rescue-preview': 6000, rescue: 20000, 'rescue-reveal': 7000, 'finale-intro': 15000, finale: 18000, 'finale-reveal': 7000, results: 0 };
function fail(message: string): never { throw new Error(message); }
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Expected an object.');
  return raw as Record<string, unknown>;
}
function integer(raw: unknown, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) return fail('Number is outside the allowed range.');
  return raw;
}
function random(s: { rng: number }, max: number): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return Math.floor(s.rng / 4294967296 * max);
}
function shuffle<T>(s: { rng: number }, values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = random(s, i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
const turnId = (s: State) => `${s.roundId}:${s.serial}`;
const currentQuestion = (s: State) => s.deck[s.phase.startsWith('finale') ? 8 + s.finaleStep - 1 : s.round - 1];
function enter(s: State, phase: Phase, now: number) {
  s.phase = phase; s.serial++; s.started = now; s.deadline = now + durations[phase];
  if (phase === 'quiz' || phase === 'rescue' || phase === 'finale') {
    for (const p of s.players) { p.answer = null; p.gained = 0; }
    s.reveal = null;
  }
  if (phase === 'quiz') for (const p of s.players) p.needsRescue = false;
  if (phase === 'finale') {
    const leader = Math.max(...s.players.map(p => p.distance));
    for (const p of s.players) p.boost = p.distance < leader;
  }
}
function makeChallenge(s: State): Challenge {
  const family = s.families[(s.round - 1) % 3];
  if (family === 'memory') {
    const sequence = Array.from({ length: 4 + Number(s.round > 4) }, () => random(s, 4));
    return { family, prompt: `Remember the ${sequence.length} symbols in order. They disappear before you answer.`, options: ['Sun', 'Drop', 'Bolt', 'Leaf'], sequence, solution: [...sequence] };
  }
  if (family === 'estimate') {
    const trays = 13 + random(s, 17), jars = 7 + random(s, 12), extra = 1 + random(s, 9);
    return { family, prompt: `${trays} trays each hold ${jars} bubble jars, plus ${extra} loose ${extra === 1 ? 'jar' : 'jars'}. Estimate the total. Closest submitted guess wins; equal distances share the win.`, options: [], sequence: null, solution: trays * jars + extra };
  }
  const base = 10 + random(s, 30), even = base + (base % 2);
  const options = shuffle(s, [even, even + 1, even + 6, even - 2]);
  return { family, prompt: `Open the valve labeled with an EVEN number, greater than ${even - 1} and less than ${even + 4}. All three conditions must hold.`, options: options.map(String), sequence: null, solution: options.indexOf(even) };
}
function checkTime(s: State, now: number) {
  if (!Number.isFinite(now) || now < s.lastNow) fail('Invalid or obsolete server time.');
}
function scoreQuestion(s: State) {
  const q = currentQuestion(s), finale = s.phase === 'finale';
  for (const p of s.players) {
    const correct = p.answer === q.correct;
    p.gained = correct ? (finale ? (p.boost ? 3 : 2) : 3) : 0;
    if (finale) p.distance += p.gained;
    else { p.charge += p.gained; p.needsRescue = !correct; }
  }
  s.reveal = { answer: q.options[q.correct], explanation: q.explanation, source: q.source };
}
function scoreRescue(s: State) {
  const c = s.challenge!;
  const distances = s.players.filter(p => typeof p.answer === 'number').map(p => Math.abs((p.answer as number) - (c.solution as number)));
  const closest = Math.min(...distances);
  for (const p of s.players) {
    const success = p.answer !== null && (c.family === 'estimate' ? Math.abs((p.answer as number) - (c.solution as number)) === closest : JSON.stringify(p.answer) === JSON.stringify(c.solution));
    p.gained = success ? (p.needsRescue ? 2 : 1) : 0;
    p.charge += p.gained;
  }
  const answer = c.family === 'memory' ? (c.solution as number[]).map(i => c.options[i]).join(' → ') : c.family === 'logic' ? c.options[c.solution as number] : String(c.solution);
  s.reveal = { answer, explanation: c.family === 'estimate' ? 'Multiply trays by jars, then add the loose jars. The closest submitted guesses share success.' : c.family === 'memory' ? 'That was the original sequence, from left to right.' : 'This valve satisfies all three conditions.', source: null };
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    const value = object(raw);
    if (Object.keys(value).some(key => key !== 'rounds') || (value.rounds !== undefined && value.rounds !== 8)) fail('Quiz Panic uses eight rounds.');
    return { rounds: 8 };
  },
  parseInput(raw) { if (raw !== null) fail('Quiz Panic uses discrete answers.'); return null; },
  neutralInput: () => null,
  parseAction(raw) {
    const a = object(raw);
    if (typeof a.turnId !== 'string' || !a.turnId.length || a.turnId.length > 200) fail('Missing turn identifier.');
    if (a.kind === 'answer' && Object.keys(a).every(k => ['turnId', 'kind', 'choice'].includes(k))) return { turnId: a.turnId as string, kind: 'answer', choice: integer(a.choice, 0, 3) };
    if (a.kind === 'rescue' && Object.keys(a).every(k => ['turnId', 'kind', 'value'].includes(k))) {
      if (Array.isArray(a.value) && (a.value.length < 4 || a.value.length > 5)) fail('Enter the whole sequence.');
      const value = Array.isArray(a.value) ? a.value.map(v => integer(v, 0, 3)) : integer(a.value, 0, 999);
      return { turnId: a.turnId as string, kind: 'rescue', value };
    }
    return fail('Unknown Quiz Panic action.');
  },
  create(ctx: RoundContext, settings) {
    rules.validateSettings(settings);
    if (ctx.players.length < 2 || ctx.players.length > 10 || new Set(ctx.players.map(p => p.id)).size !== ctx.players.length || ctx.players.some(p => !p.id)) fail('Quiz Panic needs 2–10 distinct players.');
    if (!Number.isFinite(ctx.nowMs) || !Number.isInteger(ctx.seed)) fail('Invalid initial time or seed.');
    const rng = { rng: ctx.seed >>> 0 };
    const deck = shuffle(rng, questions).slice(0, 14).map(q => {
      const order = shuffle(rng, [0, 1, 2, 3]);
      return { ...q, options: order.map(i => q.options[i]), correct: order.indexOf(q.correct) };
    });
    const families = shuffle<Family>(rng, ['memory', 'estimate', 'logic']);
    return { roundId: ctx.roundId, rng: rng.rng, phase: 'instructions', serial: 0, started: ctx.nowMs, deadline: ctx.nowMs + durations.instructions, lastNow: ctx.nowMs, round: 1, finaleStep: 0, deck, families, challenge: null, reveal: null,
      players: ctx.players.map(p => ({ ...p, connected: true, charge: 0, distance: 0, needsRescue: false, boost: false, answer: null, gained: 0 })) };
  },
  applyAction(s, id, raw, now) {
    const a = rules.parseAction(raw), p = s.players.find(p => p.id === id);
    checkTime(s, now);
    if (!p || !p.connected) fail('This seat is not connected.');
    if (a.turnId !== turnId(s) || now < s.started || now >= s.deadline) fail('This turn has closed.');
    if (p.answer !== null) fail('Your answer is already locked.');
    if ((s.phase === 'quiz' || s.phase === 'finale') && a.kind === 'answer') p.answer = a.choice;
    else if (s.phase === 'rescue' && a.kind === 'rescue') {
      const c = s.challenge!;
      if (c.family === 'memory') {
        if (!Array.isArray(a.value) || a.value.length !== (c.solution as number[]).length) fail('Enter the whole sequence.');
      } else if (typeof a.value !== 'number' || (c.family === 'logic' && a.value > 3)) fail('Invalid rescue answer.');
      p.answer = Array.isArray(a.value) ? [...a.value] : a.value;
    } else fail('That action is not available in this phase.');
    s.lastNow = now;
  },
  tick(s, _inputs, _dt, now) {
    checkTime(s, now); s.lastNow = now;
    const allAnswered = ['quiz', 'rescue', 'finale'].includes(s.phase) && s.players.every(p => p.answer !== null);
    if (s.phase === 'results' || (now < s.deadline && !(allAnswered && now >= s.started + 6000))) return;
    switch (s.phase) {
      case 'instructions': enter(s, 'quiz', now); break;
      case 'quiz': scoreQuestion(s); enter(s, 'quiz-reveal', now); break;
      case 'quiz-reveal': s.challenge = makeChallenge(s); s.reveal = null; enter(s, 'rescue-preview', now); break;
      case 'rescue-preview': enter(s, 'rescue', now); break;
      case 'rescue': scoreRescue(s); enter(s, 'rescue-reveal', now); break;
      case 'rescue-reveal':
        s.challenge = null; s.reveal = null;
        if (s.round < 8) { s.round++; enter(s, 'quiz', now); }
        else { for (const p of s.players) { p.distance = Math.min(4, Math.floor(p.charge / 6)); p.boost = false; } enter(s, 'finale-intro', now); }
        break;
      case 'finale-intro': s.finaleStep = 1; enter(s, 'finale', now); break;
      case 'finale': scoreQuestion(s); enter(s, 'finale-reveal', now); break;
      case 'finale-reveal':
        if (s.finaleStep < 6) { s.finaleStep++; enter(s, 'finale', now); }
        else enter(s, 'results', now);
        break;
    }
  },
  onPresenceChange(s, id, connected, now) {
    checkTime(s, now);
    const p = s.players.find(p => p.id === id);
    if (!p) fail('Unknown participant.');
    p.connected = connected; s.lastNow = now;
  },
  publicView(s, _ctx) {
    const showQuestion = ['quiz', 'quiz-reveal', 'finale', 'finale-reveal'].includes(s.phase);
    const q = showQuestion ? currentQuestion(s) : null;
    const c = s.phase.startsWith('rescue') ? s.challenge : null;
    return { phase: s.phase, turnId: turnId(s), deadline: s.deadline, round: s.round, rounds: 8, finaleStep: s.finaleStep,
      players: s.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, charge: p.charge, distance: p.distance, needsRescue: p.needsRescue, boost: p.boost, submitted: p.answer !== null, gained: p.gained })),
      question: q ? { category: q.category, prompt: q.prompt, options: [...q.options] } : null,
      challenge: c ? { family: c.family, prompt: c.family === 'memory' && s.phase === 'rescue' ? `Rebuild the ${(c.solution as number[]).length}-symbol sequence in order.` : c.prompt, options: [...c.options], sequence: s.phase === 'rescue-preview' && c.sequence ? [...c.sequence] : null } : null,
      reveal: s.reveal ? { ...s.reveal } : null };
  },
  playerView(s, id, _ctx) {
    const p = s.players.find(p => p.id === id);
    if (!p) fail('Unknown participant.');
    return { submitted: p.answer !== null, answer: Array.isArray(p.answer) ? [...p.answer] : p.answer, needsRescue: p.needsRescue, boost: p.boost };
  },
  outcome(s) {
    const complete = s.phase === 'results';
    const rows = s.players.map(p => ({ playerId: p.id, score: p.distance, rank: 1 + s.players.filter(other => other.distance > p.distance).length, label: `${p.distance} escape step${p.distance === 1 ? '' : 's'} · ${p.charge} charge` })).sort((a, b) => a.rank - b.rank || s.players.findIndex(p => p.id === a.playerId) - s.players.findIndex(p => p.id === b.playerId));
    return { complete, winners: complete ? rows.filter(p => p.rank === 1).map(p => p.playerId) : [], rows };
  },
  dispose() {},
};
export default rules;
