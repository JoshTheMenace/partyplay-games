/** Event builders. Each fixture gets its own Log so ids climb from 1 and `at` stays near its `now`. */
import {
  RESOURCES, type Blocked, type Cards, type GameEvent, type Grant, type PublicView, type RollEvent, type SeatId,
} from '../../src/model';

/** An event without id and at (distributes over the union so each kind keeps its fields). */
type Body = GameEvent extends infer E ? (E extends unknown ? Omit<E, 'id' | 'at'> : never) : never;

export class Log {
  events: GameEvent[] = [];
  private id = 0;
  constructor(public at: number) {}

  /** Appends an event `gap` ms after the previous one. */
  add<E extends Body>(body: E, gap = 900): E & { id: number; at: number } {
    this.at += gap;
    const event = { ...body, id: ++this.id, at: this.at };
    this.events.push(event as GameEvent);
    return event;
  }

  /** A roll whose grants and blocked yields follow the real pieces, robber and numbers. */
  roll(pub: PublicView, seat: SeatId | null, dice: [number, number], gap = 900): RollEvent {
    const total = dice[0] + dice[1], grants: Grant[] = [], blocked: Blocked[] = [];
    for (const tile of pub.board.tiles.filter(t => t.number === total)) {
      const good = RESOURCES.find(r => r === tile.terrain);
      if (!good) continue;
      for (const v of pub.board.vertices.filter(x => x.tiles.includes(tile.id))) {
        const b = pub.pieces.buildings[v.id];
        if (!b) continue;
        const amount = b.kind === 'city' ? 2 : 1;
        if (pub.pieces.robber === tile.id) blocked.push({ seat: b.seat, tile: tile.id, good, amount, by: 'robber' });
        else grants.push({ seat: b.seat, tile: tile.id, good, amount });
      }
    }
    const name = (id: SeatId) => pub.seats.find(s => s.id === id)?.name ?? id;
    const text = grants.length
      ? `${total}: ${grants.map(g => `${name(g.seat)} +${g.amount} ${g.good}`).join(', ')}`
      : `${total}: no production`;
    const event = this.add({
      kind: 'roll', seat, dice, total, eventDie: null, grants, blocked, shortages: [], text,
    } satisfies Omit<RollEvent, 'id' | 'at'>, gap);
    pub.lastRoll = event;
    return event;
  }

  /** Writes the log into the view (last 40, as the projection does). */
  into(pub: PublicView) {
    pub.events = this.events.slice(-40);
    return pub;
  }
}

/** Sum of grants per seat, handy for private inbox toasts. */
export function gained(roll: RollEvent, seat: SeatId): Cards {
  const cards: Cards = {};
  for (const g of roll.grants.filter(x => x.seat === seat)) cards[g.good] = (cards[g.good] ?? 0) + g.amount;
  return cards;
}
