/** Build, upgrade and ship-move handlers (ENGINE §3.3, §3.6); setup placements and free routes. */
import {
  COSTS, RESOURCES, type BuildingKind, type BuildPiece, type EdgeId, type Grant, type Resource, type SeatId,
} from '../model';
import { boardIndex } from './board/lookup';
import { cardsText, transfer } from './cards';
import { emit } from './events';
import { face, purchaseWhy, shipMoves, targets } from './legal';
import { hooks, type PlacedPiece } from './modules/registry';
import { need } from './need';
import { moveRoute, placeBuilding, placeRoute } from './pieces';
import { gained } from './stats';
import { seat as seatOf, seatName, type State } from './state';

/**
 * Place or upgrade `piece` at `at`. Setup placements are free and use the step's building kind;
 * owed free routes are consumed before paying. WP-core advances the setup step afterwards.
 */
export function build(s: State, seat: SeatId, piece: BuildPiece, at: string) {
  const p = seatOf(s, seat), setup = s.turn.stage === 'setup';
  const blocked = purchaseWhy(s, seat, piece);
  need(!blocked, blocked?.text ?? '');
  need(targets(s, seat, piece).includes(at), 'That spot is not available.');
  const route = piece === 'road' || piece === 'ship', free = setup || (route && p.freeRoutes > 0);
  if (!setup && free) p.freeRoutes--;
  else if (!setup) transfer(p.hand, s.bank, COSTS[piece], 'You cannot afford that.');
  let placed: PlacedPiece;
  if (route) {
    placed = { kind: 'route', piece: { edge: at, seat, kind: piece } };
    placeRoute(s, placed.piece);
  } else {
    const kind: BuildingKind = setup ? (s.turn.setup!.piece as BuildingKind) : piece;
    placed = { kind: 'building', piece: { ...s.pieces.buildings[at], vertex: at, seat, kind } };
    placeBuilding(s, placed.piece);
  }
  const what = placed.piece.kind, text = `${seatName(s, seat)} built a ${what}`;
  emit(s, { kind: 'build', seat, piece: what, spot: at, free, text });
  if (setup && !route && s.turn.setup!.round === 2) payout(s, seat, at);
  for (const m of hooks(s, 'onBuild')) m.onBuild(s, seat, placed);
}

/** Setup round 2: one resource per adjacent producing hex (not gold or desert), bank permitting. */
function payout(s: State, seat: SeatId, v: string) {
  const grants: Grant[] = [];
  for (const tile of boardIndex(s.board).vertex.get(v)?.tiles ?? []) {
    const good = face(s, tile).terrain as Resource;
    if (!RESOURCES.includes(good) || s.bank[good] <= 0) continue;
    transfer(s.bank, s.seats[seat].hand, { [good]: 1 });
    grants.push({ seat, tile, good, amount: 1 });
  }
  if (!grants.length) return;
  const cards = Object.fromEntries(RESOURCES.map(g => [g, grants.filter(x => x.good === g).length]));
  gained(s, seat, cards);
  emit(s, { kind: 'payout', seat, grants, text: `${seatName(s, seat)} collected ${cardsText(cards)}` });
}

/** Move one of the seat's open ships (one move per opportunity); emits a `move` event. */
export function moveShip(s: State, seat: SeatId, from: EdgeId, to: EdgeId) {
  need(shipMoves(s, seat).some(m => m.from === from && m.to.includes(to)), 'That ship cannot move there.');
  moveRoute(s, from, to);
  seatOf(s, seat).moved = true;
  const text = `${seatName(s, seat)} moved a ship`;
  emit(s, { kind: 'move', seat, piece: 'ship', unit: null, from, to, text });
}
