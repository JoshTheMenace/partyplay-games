/**
 * The TV's director (server-only): which island the shared display shows. Chosen once a tick on the
 * server, so every display agrees and the shared view carries one board instead of sixteen.
 * Like a sports broadcast: stay with the action, never sit on one pitch for long, never cut mid-roll.
 */
import type { GameEvent } from '../model';
import { publicVp } from '../engine/stats';
import type { State } from '../engine/state';
import { rolling, type League } from './index';

export type Director = {
  island: number; since: number;
  /** Per island: how much is happening (decays), the last event id counted, when it was last on air. */
  heat: number[]; seen: number[]; aired: number[]; at: number;
};

/** A shot runs at least MIN_MS; another island must be this much hotter to take it; nothing holds it past MAX_MS. */
export const SHOT = { minMs: 7000, maxMs: 18_000, lead: 30, halfLifeMs: 9000 } as const;

const HEAT: Partial<Record<GameEvent['kind'], number>> = {
  robber: 28, steal: 10, trade: 22, award: 40, 'dev-play': 18, barbarians: 40, reveal: 12, discard: 6, bank: 5,
};
const heatOf = (e: GameEvent) => (e.kind === 'build'
  ? e.piece === 'city' || e.piece === 'metropolis' ? 45 : e.piece === 'road' || e.piece === 'ship' ? 8 : 34
  : HEAT[e.kind] ?? 0);

export const newDirector = (islands: number, now: number): Director => ({
  island: 0, since: now, heat: Array(islands).fill(0), seen: Array(islands).fill(0),
  aired: Array(islands).fill(now), at: now,
});

/** How close the island's best seat is to winning: the last two points pull the camera. */
const race = (s: State) =>
  (Math.max(...s.order.map(id => publicVp(s, id))) >= s.settings.targetPoints - 2 ? 25 : 0);

export function direct(l: League, now: number) {
  const d = l.director;
  if (!l.shared) return;
  const decay = 0.5 ** ((now - d.at) / SHOT.halfLifeMs);
  d.at = now;
  l.islands.forEach((s, i) => {
    d.heat[i] *= decay;
    for (const e of s.events) if (e.id > d.seen[i]) { d.heat[i] += heatOf(e); d.seen[i] = e.id; }
  });
  if (l.results) {
    // The finale stays with the champion.
    const home = l.home[l.results.winners[0]] ?? d.island;
    if (home !== d.island) Object.assign(d, { island: home, since: now });
    return;
  }
  const age = now - d.since;
  // Never cut while the dice are in the air or the cards are still flying.
  if (age < SHOT.minMs || (l.rollAt !== null && l.rollAt - now < 1500) || rolling(l)) return;
  const pull = l.islands.map(race);
  // An island whose round is already in has nothing to show while others are still playing.
  const quiet = (i: number) => (l.islands[i].turn.closed && l.islands.some(s => !s.turn.closed) ? 100 : 0);
  const score = (i: number) => d.heat[i] + pull[i] + Math.min(40, (now - d.aired[i]) / 1000) - quiet(i);
  let best = d.island;
  l.islands.forEach((_, i) => { if (i !== d.island && (best === d.island || score(i) > score(best))) best = i; });
  if (best === d.island) return;
  const here = d.heat[d.island] + pull[d.island] - quiet(d.island);
  if (age < SHOT.maxMs && score(best) < here + SHOT.lead) return;
  d.aired[d.island] = now;
  d.heat[best] *= 0.5;
  Object.assign(d, { island: best, since: now });
}
