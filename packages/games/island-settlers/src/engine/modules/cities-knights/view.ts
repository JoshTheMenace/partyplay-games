/** Scoring, public/private projections, TV HUD items and seat badges, and the barbarian path decoration. */
import { distance } from '../../../geometry';
import {
  TRACKS, type Badge, type CitiesKnightsPublic, type HudItem, type ScorePart, type SeatId,
} from '../../../model';
import { isLand, type BoardDraft } from '../../board/index';
import type { State } from '../../state';
import { metropolisAt } from './city';
import { progressView } from './play';
import { cities, ck, knightsOf, LENGTH, shipTrack, strength, sx, TRACK_LABEL } from './state';

const part = (key: string, label: string, count: number, each: number): ScorePart =>
  ({ key, label, points: count * each, count });

export function score(s: State, seat: SeatId): ScorePart[] {
  const x = sx(s, seat), metros = TRACKS.filter(t => metropolisAt(s, t)?.seat === seat).length;
  const parts = [
    part('metropolis', 'Metropolises', metros, 2), part('defender', 'Defender of Catan', x.defender, 1),
    part('progress-vp', 'Printer / Constitution', x.points, 1),
    part('merchant', 'Merchant', s.pieces.merchant?.seat === seat ? 1 : 0, 1),
  ];
  return parts.filter(p => p.count > 0);
}

export function publicView(s: State): CitiesKnightsPublic {
  const x = ck(s), metropolises: CitiesKnightsPublic['metropolises'] = {};
  for (const t of TRACKS) { const b = metropolisAt(s, t); if (b) metropolises[t] = b.vertex; }
  return {
    barbarian: { position: x.position, length: LENGTH, attacks: x.attacks }, lastEvent: x.lastEvent, metropolises,
    seats: Object.fromEntries(s.order.map(id => [id, {
      improvements: { ...sx(s, id).improvements }, progress: sx(s, id).progress.length,
      defender: sx(s, id).defender, strength: strength(s, id),
    }])),
  };
}

export const privateView = (s: State, seat: SeatId) => ({ progress: progressView(s, seat) });

export function hud(s: State): HudItem[] {
  const x = ck(s), power = cities(s).length, defense = s.order.reduce((n, id) => n + strength(s, id), 0);
  const items: HudItem[] = [];
  if (shipTrack(s)) {
    items.push({ kind: 'track', key: 'barbarians', label: x.position >= LENGTH - 1 ? 'Attack on the next ship roll'
      : 'Barbarian ship', value: x.position, max: LENGTH, alert: x.position >= LENGTH - 1, icon: 'barbarian' });
    items.push({ kind: 'versus', key: 'defense', label: 'If they land now',
      left: { label: 'Cities', value: power }, right: { label: 'Knights', value: defense } });
  }
  for (const t of TRACKS) {
    items.push({ kind: 'holder', key: `metropolis-${t}`, label: `${TRACK_LABEL[t]} metropolis`,
      seat: metropolisAt(s, t)?.seat ?? null, icon: t });
  }
  return items;
}

export function badges(s: State, seat: SeatId): Badge[] {
  const x = sx(s, seat), out: Badge[] = TRACKS.filter(t => x.improvements[t] > 0).map(t =>
    ({ key: t, icon: t, value: x.improvements[t], label: `${TRACK_LABEL[t]} ${x.improvements[t]}` }));
  const n = x.progress.length, knights = knightsOf(s, seat).length;
  if (n) out.push({ key: 'progress', icon: 'cards', value: n, label: `${n} progress card${n > 1 ? 's' : ''}` });
  if (knights) {
    const str = strength(s, seat);
    out.push({ key: 'knights', icon: 'knight', value: str, label: `Knight strength ${str} (${knights} knights)` });
  }
  if (x.defender) out.push({ key: 'defender', icon: 'vp', value: x.defender, label: 'Defender of Catan' });
  return out;
}

/** 8 coastal sea hexes in angular order, starting south-west of the land (the ship's waypoints). */
export function barbarianPath(draft: BoardDraft) {
  const ix = draft.index, land = draft.tiles.filter(t => isLand(t.terrain));
  if (!land.length) return;
  const mean = (k: 'x' | 'y') => land.reduce((n, t) => n + t[k], 0) / land.length, mid = { x: mean('x'), y: mean('y') };
  const sea = draft.tiles.filter(t => t.terrain === 'sea');
  const coast = sea.filter(t => (ix.tileVertices.get(t.id) ?? [])
    .some(v => (ix.vertex.get(v)?.tiles ?? []).some(u => isLand(ix.tile.get(u)!.terrain))));
  const pool = coast.length >= 8 ? coast : [...sea].sort((a, b) => distance(a, mid) - distance(b, mid)).slice(0, 12);
  const angle = (t: { x: number; y: number }) => {
    const a = Math.atan2(t.y - mid.y, t.x - mid.x) - (3 * Math.PI) / 4;
    return (a + 4 * Math.PI) % (2 * Math.PI);
  };
  const tiles = [...pool].sort((a, b) => angle(a) - angle(b)).slice(0, 8).map(t => t.id);
  if (tiles.length) draft.features.push({ kind: 'barbarian-path', id: 'barbarian-path', tiles });
}
