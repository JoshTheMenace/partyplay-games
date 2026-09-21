export const colors = ['coral', 'sky', 'lime', 'sun'] as const;
export type Color = typeof colors[number];
export type Face = { color: Color | 'wild'; value: string };
export type Card = { id: string; faces: [Face, Face]; revealed: boolean; decoy: Face | null; progress: Color[] | null };
export const packs = {
  missions: ['Secret missions', 'A locked wild in each hand. Play three different colors to unlock it. Progress travels with the card.'],
  reveal: ['Open secrets', 'Eye cards expose one random card from a rival you choose. It stays visible until played.'],
  trade: ['Trade winds', 'Trade cards pass every hand one seat in the direction of play.'],
  flip: ['Flip side', 'Flip cards turn every card over. Preview the other side of your hand before committing.'],
  decoy: ['Decoys', 'Mask cards give the next player a disguised number card and skip them. Inspect it privately to learn its real face.'],
  jump: ['Jump in', 'Out of turn, slap an identical colored number card. First accepted play takes the turn.'],
  drift: ['Color drift', 'Every two completed turns, all number cards in hands shift to the next color: coral → sky → lime → sun.'],
  mutation: ['Wild mutation', 'At the start of your turn, one random number card in your hand changes color and number.'],
} as const;
export type Pack = keyof typeof packs;
export type Settings = Record<Pack, boolean> & { handSize: number; turnSeconds: number; maxTurns: number };
export const defaults: Settings = { handSize: 7, turnSeconds: 30, maxTurns: 160, missions: true, reveal: true, trade: false, flip: false, decoy: false, jump: false, drift: false, mutation: false };
export type CardView = Face & { id: string; back: Face; revealed: boolean; disguised: boolean; progress: Color[] | null; playable: boolean; jumpable: boolean };
export type Action = { turnId: string } & ({ kind: 'draw' } | { kind: 'pass' } | { kind: 'inspect'; cardId: string } | { kind: 'play'; cardId: string; color?: Color; target?: string });
export type PublicView = {
  turnId: string; turn: number; deadline: number; current: string; direction: number; side: number; color: Color;
  top: Face; topId: string; transfers: number; settings: Settings; drawn: boolean; complete: boolean; finishReason: string; log: string[];
  players: { id: string; name: string; connected: boolean; count: number; revealed: Face[] }[];
};
export type PrivateView = { hand: CardView[]; drawnId: string | null; mutatedId: string | null };
