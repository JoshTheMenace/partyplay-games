import type { GameRules } from '../../../party-contract/src/index';
import { COIN_PENALTY, MISSIONS, RADIUS, TIMING, neutralInput, type Action, type Input, type Settings, type View } from './model';
import { create, dist, drop, effect, mapOf, parseChoice, playing, record, say, type State } from './sim/state';
import { tickCrew, useTool } from './sim/crew';
import { tickNpcs } from './sim/npc';
import { tickSecurity } from './sim/security';
import { project } from './sim/view';

export type { State } from './sim/state';
const adjusted = (s: State) => Math.round(s.elapsed + COIN_PENALTY * (s.totalLoot - s.collected));
/** Game time: wall time minus every stretch when the whole crew was away. */
function clock(s: State, wall: number) {
  s.wallAt = Math.max(s.wallAt, wall);
  s.now = (s.pauseAt ?? s.wallAt) - s.paused;
  if (playing(s)) s.elapsed = Math.max(0, (s.now - s.startedAt) / 1000);
}
/** The TV holds the getaway or the bust on screen this long before results. */
const OUTRO_MS = 2500;
function finishCheck(s: State) {
  const required = s.crew.filter(p => !p.suspended), exit = mapOf(s).objects.find(o => o.kind === 'exit')!;
  if (!required.length) return;
  // A lone thief with a second wind left is not finished yet (see crew.ts secondWind).
  if (required.every(p => p.down) && !(required.length === 1 && required[0].wind)) { s.phase = 'failed'; say(s, 'The whole crew is down. Job failed.'); }
  else if (s.objective.carrier && required.every(p => !p.down && dist(p, exit) <= RADIUS.exit)) { s.phase = 'clear'; say(s, 'Clean getaway! The whole crew made it out.'); effect(s, exit, 'escape', 'Getaway!'); }
  if (!playing(s)) s.endedAt = s.now;
}

export const rules: GameRules<State, Input, Action, Settings, View, null> = {
  validateSettings(raw) {
    const v = record(raw), mission = v.mission ?? 'velvet', difficulty = v.difficulty ?? 'normal';
    if (Object.keys(v).some(k => k !== 'mission' && k !== 'difficulty') || typeof mission !== 'string' || !Object.hasOwn(MISSIONS, mission) || (difficulty !== 'normal' && difficulty !== 'relaxed')) throw Error('Choose a mission and difficulty.');
    return { mission, difficulty } as Settings;
  },
  parseLobbyChoice: parseChoice, neutralInput,
  parseInput(raw) {
    const v = record(raw), { x, y } = v, sneak = v.sneak ?? false;
    if (Object.keys(v).some(k => !['x', 'y', 'sneak'].includes(k)) || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1 || typeof sneak !== 'boolean') throw Error('Invalid movement.');
    const length = Math.max(1, Math.hypot(x, y));
    return { x: x / length, y: y / length, sneak };
  },
  parseAction(raw) {
    const v = record(raw);
    if (Object.keys(v).some(k => k !== 'type' && k !== 'heistId') || v.type !== 'tool' || typeof v.heistId !== 'string' || !v.heistId || v.heistId.length > 128) throw Error('Invalid tool action.');
    return { type: 'tool', heistId: v.heistId };
  },
  create: (ctx, settings) => create(ctx, settings),
  applyAction(s, id, action, wall) {
    const p = s.crew.find(q => q.id === id);
    if (!p || !playing(s) || action.heistId !== s.heistId) throw Error('This heist is over.');
    clock(s, wall);
    useTool(s, p);
  },
  tick(s, inputs, dt, wall) {
    clock(s, wall);
    if (!playing(s)) return;
    for (const p of s.crew) if (!p.connected && p.absentAt !== null && s.now - p.absentAt >= TIMING.suspend && !p.suspended) {
      p.suspended = true; p.work = null;
      drop(s, p);
    }
    if (s.pauseAt !== null) return;
    dt = Math.max(0, Math.min(.1, dt));
    for (const p of s.crew) p.input = inputs.get(p.id) ?? neutralInput();
    tickCrew(s, dt);
    tickNpcs(s, dt);
    tickSecurity(s, dt);
    finishCheck(s);
  },
  onPresenceChange(s, id, connected, wall) {
    const p = s.crew.find(q => q.id === id);
    if (!p || p.connected === connected) return;
    if (playing(s)) clock(s, wall);
    p.connected = connected; p.work = null; p.input = neutralInput();
    if (connected) {
      p.absentAt = null; p.suspended = false;
      if (s.pauseAt !== null) { s.paused += Math.max(0, wall - s.pauseAt); s.pauseAt = null; if (playing(s)) clock(s, wall); }
    } else {
      p.absentAt = s.now;
      if (!s.crew.some(q => q.connected)) s.pauseAt = s.wallAt;
    }
  },
  publicView: s => project(s),
  playerView: () => null,
  outcome(s) {
    const score = adjusted(s), missed = s.totalLoot - s.collected, status = s.phase === 'clear' ? 'Escaped' : s.phase === 'failed' ? 'Caught' : 'On the job';
    return {
      complete: s.endedAt !== null && s.now - s.endedAt >= OUTRO_MS, winners: s.phase === 'clear' ? s.crew.map(p => p.id) : [],
      rows: s.crew.map(p => ({ playerId: p.id, rank: 1, score, label: `${status} · ${p.coins} coins · ${Math.round(s.elapsed)}s + ${missed * COIN_PENALTY}s missed loot` })),
    };
  },
  dispose() {},
};
export default rules;
