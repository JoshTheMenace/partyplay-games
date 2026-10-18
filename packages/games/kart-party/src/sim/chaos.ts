/* Chaos mode: every so often a surprise rule hits the whole race for a few seconds. Deterministic
 * (race.rng) and server-side; physics and client prediction read only `race.chaos.kind`. */
import { pointAt, sampleAt, type Track } from './track';
import { CHAOS_OWNER, dropPeel, startRoll, STAR_SECONDS } from './items';
import type { KartParams } from './physics';
import type { ChaosKind, ChaosMode, Race } from './types';

export const CHAOS: Record<ChaosKind, { name: string; blurb: string; color: string; seconds: number }> = {
  moon: { name: 'Moon Gravity', blurb: 'Everything floats!', color: '#8fd3ff', seconds: 9 },
  bananas: { name: 'Banana Storm', blurb: 'Peels are falling from the sky!', color: '#ffe14d', seconds: 8 },
  frenzy: { name: 'Item Frenzy', blurb: 'Items for everyone. Fire away!', color: '#ff5fd2', seconds: 5 },
  mega: { name: 'Mega Karts', blurb: 'Giant karts. Shove everybody!', color: '#ff8a3d', seconds: 9 },
  hyper: { name: 'Hyper Speed', blurb: 'Everyone goes way too fast!', color: '#4dffb8', seconds: 7 },
  underdog: { name: 'Underdog Stars', blurb: 'The back of the pack shines!', color: '#ffd24a', seconds: 6 },
};
export const CHAOS_KINDS = Object.keys(CHAOS) as ChaosKind[];
const PEEL_EVERY = .3;

export const createChaos = (mode: ChaosMode = 'off'): Race['chaos'] => ({ mode, kind: null, last: null, t: 0, next: mode === 'wild' ? 6 : 12 });
export const chaosGravity = (kind: ChaosKind | null) => kind === 'moon' ? .4 : 1;
export const chaosParams = (p: KartParams, kind: ChaosKind | null): KartParams => kind === 'hyper' ? { ...p, topSpeed: p.topSpeed * 1.3, accel: p.accel * 1.25 } : p;

export function stepChaos(race: Race, track: Track, dt: number, random: () => number) {
  const c = race.chaos;
  if (c.mode === 'off' || race.phase !== 'racing') return null;
  if (c.kind) {
    c.t -= dt;
    if (c.kind === 'bananas' && Math.floor(c.t / PEEL_EVERY) !== Math.floor((c.t + dt) / PEEL_EVERY)) rainPeel(race, track, random);
    if (c.t <= 0) {
      if (c.kind === 'bananas') race.entities = race.entities.filter(e => e.owner !== CHAOS_OWNER);
      c.kind = null; c.t = 0; c.next = race.time + (c.mode === 'wild' ? 8 + random() * 5 : 16 + random() * 8);
    }
    return null;
  }
  if (race.time < c.next || race.firstFinish !== null) return null;
  const pool = CHAOS_KINDS.filter(k => k !== c.last && !(k === 'frenzy' && race.items === 'off'));
  const kind = pool[Math.floor(random() * pool.length)];
  c.kind = c.last = kind; c.t = CHAOS[kind].seconds;
  const racing = race.racers.filter(r => r.finishTime === null && r.respawnT <= 0);
  if (kind === 'frenzy') { race.boxes.fill(0); for (const r of racing) if (r.rollT <= 0) startRoll(race, r); }
  if (kind === 'underdog') for (const r of racing) if (r.rank > Math.ceil(race.racers.length / 2)) r.starT = Math.max(r.starT, Math.min(STAR_SECONDS, c.t));
  return kind;
}

/** A peel tumbles out of the sky somewhere on the road 25–70 m ahead of a random racer. */
function rainPeel(race: Race, track: Track, random: () => number) {
  const racing = race.racers.filter(r => r.finishTime === null);
  const r = racing[Math.floor(random() * racing.length)]; if (!r) return;
  const d = ((r.d + 25 + random() * 45) % track.length + track.length) % track.length, half = sampleAt(track, d).halfWidth * .8;
  const p = pointAt(track, d, (random() * 2 - 1) * half);
  dropPeel(race, track, p.x, p.y + 14, p.z);
}
