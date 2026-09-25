/**
 * Module pieces as places (EXPERIENCE §1.5): units by kind, the merchant, and landmarks from board
 * features and module state. Everything is looked up by kind in the tables below, so a new unit or
 * feature of an existing kind needs no code. Pure plan-view math, shared with the coverage test.
 */
import { ROBBER_OFFSET, type Point } from '../../geometry';
import type { BoardFeature, CargoKind, PublicView, SeatId, Unit, UnitKind, VertexId } from '../../model';
import { boardIndex, edgeLine } from '../shared/board';
import { CREAM, INK } from './constants';
import {
  MERCHANT_DIR, edgePoint, facing, tilePoint, vertexPoint, type Motion, type Place, type Rider,
} from './places';

const ROAD_TOP = 0.1, ASIDE = 0.34, INVADER_RING = 0.45;
const LOOKS_ON_ROADS = new Set<UnitKind>(['camel', 'raider']);
/** Cargo models; goods without one ride as a tinted crate. */
const CARGO_NODE: Partial<Record<CargoKind, string>> = {
  settler: 'settler', crew: 'crew', fish: 'crate_fish', spice: 'sack_spice',
};
export const CARGO_TINT: Record<CargoKind, string> = {
  tools: '#8d93a6', sand: '#e3c98f', marble: '#f3f0ea', glass: '#b7d8e8', fish: '#3b8fc9', spice: '#c9694f',
  settler: CREAM, crew: INK,
};
/** Deck slots along the hull, outside the sail first. */
const SLOTS = [-0.17, 0.17, -0.07, 0.07];
/** Up to three invaders on the north arc of their hex (y-down angles 210°, 270°, 330°), clear of the token. */
const ARC = [270, 210, 330].map(d => (d * Math.PI) / 180);

type Look = {
  node: string; on: 'vertex' | 'edge' | 'tile'; motion: Motion;
  /** Figures face the camera; vehicles run along their edge. */
  figure?: boolean; hide?: string[]; dark?: boolean; tint?: string; riders?: Rider[];
};
const knight = (u: Unit, on: Look['on']): Look => {
  const node = `knight_${Math.min(3, Math.max(1, u.level))}`;
  return { node, on, motion: 'step', figure: true, hide: u.active ? [] : [`${node}_active`], dark: !u.active };
};
const LOOKS: Record<UnitKind, (u: Unit, seat: number) => Look> = {
  knight: u => knight(u, 'vertex'),
  guard: u => knight(u, 'edge'),
  wagon: u => ({
    node: 'wagon', on: 'vertex', motion: 'roll', figure: true, tint: u.cargo[0] && CARGO_TINT[u.cargo[0]],
    hide: [1, 2, 3].filter(k => k > u.level).map(k => `level_${k}`).concat(u.cargo.length ? [] : ['cargo']),
  }),
  expedition: (u, seat) => ({
    node: 'ship', on: 'edge', motion: 'sail',
    riders: u.cargo.slice(0, SLOTS.length).map((c, i) =>
      ({ node: CARGO_NODE[c] ?? 'crate', seat, dx: SLOTS[i], dy: 0.04, dh: 0.1, tint: CARGO_TINT[c] })),
  }),
  camel: () => ({ node: 'camel', on: 'edge', motion: 'step' }),
  raider: () => ({ node: 'invader', on: 'edge', motion: 'step', figure: true }),
  barbarian: u => ({
    node: '', on: 'tile', motion: 'fixed',
    riders: ARC.slice(0, Math.min(3, Math.max(1, u.level))).map(a => ({
      node: 'invader', seat: 0, dx: Math.cos(a) * INVADER_RING, dy: Math.sin(a) * INVADER_RING, dh: 0,
    })),
  }),
};

/** A vertex piece beside a building steps along the most sideways edge, so neither hides the other. */
function aside(view: PublicView, id: VertexId, p: Point & { h: number }) {
  if (!view.pieces.buildings[id]) return p;
  const index = boardIndex(view.board), v = index.vertices.get(id)!;
  const lines = v.edges.map(e => ({ e, line: edgeLine(view.board, e)! })).filter(l => l.line);
  const best = lines.sort((a, b) => Math.abs(Math.sin(a.line.angle)) - Math.abs(Math.sin(b.line.angle)))[0];
  if (!best) return p;
  const other = best.line.a.x === v.x && best.line.a.y === v.y ? best.line.b : best.line.a;
  const n = Math.hypot(other.x - v.x, other.y - v.y) || 1;
  const lift = view.pieces.routes[best.e] ? ROAD_TOP : 0;
  return { x: v.x + ((other.x - v.x) / n) * ASIDE, y: v.y + ((other.y - v.y) / n) * ASIDE, h: p.h + lift };
}

function unitPlace(view: PublicView, u: Unit, seat: number): Place | null {
  const look = LOOKS[u.kind]?.(u, seat);
  if (!look) return null;
  const e = look.on === 'edge' ? boardIndex(view.board).edges.get(u.at) : undefined;
  const edge = e ? edgePoint(view, u.at, e.sea && !e.land) : null;
  const at = look.on === 'vertex' ? vertexPoint(view, u.at) : look.on === 'tile' ? tilePoint(view, u.at) : edge;
  if (!at) return null;
  // Vehicles run along their edge, except vertical edges, where they turn broadside to the camera.
  const p = look.on === 'vertex' ? aside(view, u.at, at) : at;
  const yaw = !look.figure && edge && Math.abs(edge.yaw) < 1 ? edge.yaw : 0;
  // Camels and raiders share a path with a road and stand on it; guards and ships never share one.
  const lift = look.on === 'edge' && LOOKS_ON_ROADS.has(u.kind) && view.pieces.routes[u.at] ? ROAD_TOP : 0;
  const { node, motion, hide, dark, tint, riders } = look;
  return {
    id: `unit:${u.id}`, node, seat, x: p.x, y: p.y, h: p.h + lift, yaw, scaled: u.seat !== null,
    spot: u.at, motion, hide, dark, tint, riders, tile: look.on === 'tile' ? u.at : undefined,
  };
}

/** Board features plus the ones fog reveals have uncovered. */
export const features = (view: Pick<PublicView, 'board' | 'pieces'>): BoardFeature[] => [
  ...view.board.features,
  ...Object.values(view.pieces.reveals).flatMap(r => (r.feature ? [r.feature] : [])),
];

function landmark(view: PublicView, id: string, node: string, tile: string, extra: Partial<Place> = {}) {
  const p = tilePoint(view, tile);
  const place: Place | null = p
    ? { id, node, seat: 0, ...p, yaw: 0, scaled: false, spot: tile, motion: 'fixed', tile, ...extra } : null;
  return place ? [place] : [];
}

function featurePlaces(view: PublicView, f: BoardFeature, seatOf: (id: SeatId) => number): Place[] {
  const castle = view.ext['barbarian-attack']?.castle;
  if (f.kind === 'depot' && !(f.depot === 'castle' && f.tile === castle)) {
    return landmark(view, f.id, `depot_${f.depot}`, f.tile);
  }
  if (f.kind === 'council') return landmark(view, f.id, 'council', f.tile);
  if (f.kind === 'spice') {
    const riders = [[-0.12, 0.03], [0.12, 0.04], [0, -0.08]].map(([dx, dy]) =>
      ({ node: 'sack_spice', seat: 0, dx, dy, dh: 0, size: 1.7 }));
    return landmark(view, f.id, '', f.tile, { riders });
  }
  if (f.kind === 'lair') {
    const state = view.ext.explorers?.lairs.find(l => l.tile === f.tile);
    const crews = Object.entries(state?.crews ?? {})
      .flatMap(([s, n]) => Array.from({ length: Math.min(n, 6) }, () => seatOf(s)));
    // Crews stand on the islet's near (south) rim, in front of the rock, at 1.4× so they read.
    const riders = crews.slice(0, 6).map((seat, i) => {
      const a = ((90 + (i - (Math.min(6, crews.length) - 1) / 2) * 34) * Math.PI) / 180;
      return { node: 'crew', seat, dx: Math.cos(a) * 0.3, dy: Math.sin(a) * 0.26, dh: 0.08, size: 1.4 };
    });
    const captor = state?.captured ? seatOf(state.captured) : null;
    return landmark(view, f.id, 'lair', f.tile,
      { riders, seat: captor ?? 0, hide: [captor === null ? 'claimed' : 'pirate'] });
  }
  if (f.kind === 'barbarian-path') {
    const track = view.ext['cities-knights']?.barbarian;
    const via = f.tiles.map(t => tilePoint(view, t)).filter(p => !!p);
    if (!track || !via.length) return [];
    const step = Math.min(via.length - 1, Math.max(0, Math.round((track.position * (via.length - 1)) /
      Math.max(1, track.length))));
    const next = via[Math.min(via.length - 1, step + 1)], prev = via[Math.max(0, step - 1)];
    // Heading along the track, kept within ±25° so the striped sail stays broadside to the camera.
    const yaw = Math.max(-0.44, Math.min(0.44, facing(-Math.atan2(next.y - prev.y, next.x - prev.x))));
    return landmark(view, 'barbarian-ship', 'barbarian_ship', f.tiles[step], { yaw, motion: 'sail', via, step });
  }
  return [];
}

/** Units, the merchant, landmarks and the barbarian ship. */
export function modulePlaces(view: PublicView): Place[] {
  const seats = new Map(view.seats.map(s => [s.id, s.seat])), seatOf = (id: SeatId) => seats.get(id) ?? 0;
  const out = Object.values(view.pieces.units)
    .flatMap(u => unitPlace(view, u, u.seat === null ? 0 : seatOf(u.seat)) ?? []);
  const merchant = view.pieces.merchant, m = merchant && tilePoint(view, merchant.tile);
  if (merchant && m) {
    out.push({
      id: 'merchant', node: 'merchant', seat: seatOf(merchant.seat), x: m.x + MERCHANT_DIR.x * ROBBER_OFFSET,
      y: m.y + MERCHANT_DIR.y * ROBBER_OFFSET, h: m.h, yaw: 0, scaled: false, spot: merchant.tile, motion: 'hop',
    });
  }
  const castle = view.ext['barbarian-attack']?.castle;
  if (castle) out.push(...landmark(view, 'castle', 'castle', castle));
  return [...out, ...features(view).flatMap(f => featurePlaces(view, f, seatOf))];
}
