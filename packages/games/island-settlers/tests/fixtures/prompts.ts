/** Core prompt builders (discard, robber, gold), their public chips and robber choices. */
import {
  RESOURCES,
  type Cards, type Choice, type Prompt, type PromptChip, type PublicView, type RobberChoice, type SeatId,
} from '../../src/model';

const name = (pub: PublicView, id: SeatId) => pub.seats.find(s => s.id === id)?.name ?? id;
const TERRAIN: Record<string, string> = {
  wood: 'Forest', brick: 'Hills', wool: 'Pasture', grain: 'Fields', ore: 'Mountains', gold: 'Gold field',
  desert: 'Desert',
};

/** Public chip for an open prompt, as the rail and banner show it. */
export const chip = (p: Prompt, seat: SeatId, label: string, count: number | null): PromptChip =>
  ({ id: p.id, seat, kind: p.kind, label, count, deadline: p.deadline });

export function discardPrompt(id: string, hand: Cards, count: number, deadline: number | null): Prompt {
  return {
    id, kind: 'discard', scope: 'table', deadline, auto: 'Discards from your biggest piles',
    command: {
      id: `prompt:${id}`, module: 'core', group: 'cards', label: `Discard ${count} cards`,
      detail: 'A 7 was rolled and you hold more than 7 cards.', cost: null, hint: 1,
      fields: [{
        kind: 'cards', key: 'cards', label: `Pick ${count} cards`, source: 'hand',
        allowed: [...RESOURCES], available: hand, min: count, max: count,
      }],
    },
  };
}

/** Legal hexes (every land hex but the robber's) with the seats that could be robbed there. */
export function robberChoice(pub: PublicView, seat: SeatId, piece: 'robber' | 'pirate' = 'robber'): RobberChoice {
  const tiles = pub.board.tiles
    .filter(t => (piece === 'pirate' ? t.terrain === 'sea' : t.terrain !== 'sea') && t.id !== pub.pieces[piece])
    .map(t => {
      const victims = new Set<SeatId>();
      for (const v of pub.board.vertices.filter(x => x.tiles.includes(t.id))) {
        const b = pub.pieces.buildings[v.id];
        if (b && b.seat !== seat && (pub.seats.find(s => s.id === b.seat)?.cards ?? 0) > 0) victims.add(b.seat);
      }
      return { tile: t.id, victims: [...victims].sort() };
    });
  return { seat, piece, tiles };
}

export function robberPrompt(pub: PublicView, id: string, choice: RobberChoice, deadline: number | null,
  scope: 'table' | 'self' = 'table'): Prompt {
  const tiles = new Map(pub.board.tiles.map(t => [t.id, t]));
  const options: Choice[] = choice.tiles.map(({ tile, victims }) => {
    const t = tiles.get(tile)!;
    const label = `${TERRAIN[t.terrain] ?? t.terrain}${t.number ? ` ${t.number}` : ''}`;
    const detail = victims.length ? `Rob ${victims.map(v => name(pub, v)).join(' or ')}` : 'Nobody to rob';
    return {
      value: tile, label, detail,
      // oxlint-disable-next-line unicorn/no-thenable -- Choice.then is the contract's dependent-field list.
      ...(victims.length > 1 && { then: [{
        kind: 'pick' as const, key: 'victim', label: 'Steal from', target: 'seat' as const,
        options: victims.map(v => ({ value: v, label: name(pub, v) })),
      }] }),
    };
  });
  return {
    id, kind: 'robber', scope, deadline, auto: 'Moves the robber onto the leader',
    command: {
      id: `prompt:${id}`, module: 'core', group: 'build', label: `Move the ${choice.piece}`,
      detail: 'Pick a hex, then a player to steal one card from.', cost: null, hint: 1,
      fields: [{ kind: 'pick', key: 'tile', label: 'Pick a hex', target: 'tile', options }],
    },
  };
}

export function goldPrompt(id: string, count: number, bank: Cards, deadline: number | null): Prompt {
  return {
    id, kind: 'gold', scope: 'table', deadline, auto: 'Takes the goods you hold fewest of',
    command: {
      id: `prompt:${id}`, module: 'core', group: 'cards', label: `Pick ${count} from the bank`,
      detail: 'Your gold field paid out.', cost: null, hint: 1,
      fields: [{
        kind: 'cards', key: 'cards', label: `Pick ${count}`, source: 'bank',
        allowed: [...RESOURCES], available: bank, min: count, max: count,
      }],
    },
  };
}
