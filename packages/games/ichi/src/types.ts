export const colors = ['coral', 'sky', 'lime', 'sun'] as const;
export type Color = typeof colors[number];
export type Value = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
/** A physical card. The id survives every hand transfer. */
export type Card = { id: string; color: Color | 'wild'; value: Value };

export type Settings = { target: 0 | 200 | 500; handSize: 5 | 7 | 9; turnSeconds: 15 | 25 | 40; stacking: boolean; challenge: boolean; sevenZero: boolean; jumpIn: boolean; drawUntilPlayable: boolean };
export const defaults: Settings = { target: 200, handSize: 7, turnSeconds: 25, stacking: true, challenge: true, sevenZero: false, jumpIn: false, drawUntilPlayable: false };
export const options = { target: [0, 200, 500], handSize: [5, 7, 9], turnSeconds: [15, 25, 40] } as const;
export const houseRules = {
  stacking: ['Stacking', 'Answer a +2 with a +2, or anything with a +4. The last player who can’t stack draws the whole pile.'],
  challenge: ['+4 challenge', 'A +4 is a bluff if you still held the old color. Victims can challenge: bluffers draw the penalty; wrong guesses draw two extra.'],
  sevenZero: ['Seven-O', 'Play a 7 to swap hands with anyone. Play a 0 and every hand passes along the direction of play.'],
  jumpIn: ['Jump in', 'Hold the exact same card as the pile? Slam it down out of turn and play continues from you.'],
  drawUntilPlayable: ['Draw till you can', 'Drawing keeps going until you find a card you can play.'],
} as const;
export type HouseRule = keyof typeof houseRules;
export const points = (c: Pick<Card, 'value'>) => c.value === 'wild' || c.value === 'wild4' ? 50 : /^\d$/.test(c.value) ? Number(c.value) : 20;

/**
 * turnId is `${handId}:${revision}`. play/draw/keep/challenge use it.
 * An open ichiWindow has its own id; ichi (by the owner) and catch (by anyone else) use that id instead,
 * so ordinary turn progress never makes a catch stale. next uses handId during intermission.
 */
export type Action =
  | { kind: 'play'; turnId: string; cardId: string; color?: Color; target?: string }
  | { kind: 'draw' | 'keep' | 'challenge' | 'ichi' | 'catch' | 'next'; turnId: string };

export type GameEvent = {
  seq: number;
  kind: 'deal' | 'play' | 'jump' | 'draw' | 'penalty' | 'skip' | 'reverse' | 'color' | 'stack' | 'challenge' | 'swap' | 'rotate' | 'ichi' | 'catch' | 'timeout' | 'handEnd';
  text: string; playerId?: string; targetId?: string; card?: Card; count?: number; success?: boolean;
};
export type PublicPlayer = { id: string; name: string; color: string; connected: boolean; count: number; score: number; handsWon: number; safe: boolean };
export type HandResult = { winnerId: string | null; points: number; reason: string; hands: { playerId: string; cards: Card[]; points: number }[] };
export type PublicView = {
  phase: 'playing' | 'intermission' | 'complete';
  handId: string; hand: number; turnId: string; turn: number; deadline: number;
  current: string; direction: 1 | -1; color: Color; top: Card; drawCount: number; discardCount: number;
  /** before: the color a fresh +4 replaced (what a bluff would have held); null once stacked. */
  pending: { count: number; kind: 'draw2' | 'wild4'; from: string; before: Color | null; challengeable: boolean } | null;
  drawn: boolean;
  ichiWindow: { id: string; playerId: string; until: number } | null;
  events: GameEvent[];
  settings: Settings; players: PublicPlayer[];
  handResult: HandResult | null; nextHandAt: number | null; ready: string[];
  winners: string[]; finishReason: string;
};
export type HandCard = Card & { playable: boolean; jumpable: boolean };
export type PrivateView = { hand: HandCard[]; drawnId: string | null; canCall: boolean; canCatch: boolean; canChallenge: boolean };
