export const colors = ['coral', 'sky', 'lime', 'sun'] as const;
export type Color = typeof colors[number];
export type Value = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'gift' | 'wild' | 'wild4';
/** A physical card. The id survives every hand transfer. */
export type Card = { id: string; color: Color | 'wild'; value: Value };

/** tableSize 0 is automatic: one table up to ten players, tables of four beyond that. */
export type Settings = { target: 0 | 200 | 500; handSize: 5 | 7 | 9; turnSeconds: 15 | 25 | 40; tableSize: 0 | 4 | 5 | 6; stacking: boolean; challenge: boolean; gifts: boolean; sevenZero: boolean; jumpIn: boolean; drawUntilPlayable: boolean };
export const defaults: Settings = { target: 200, handSize: 7, turnSeconds: 25, tableSize: 0, stacking: true, challenge: true, gifts: true, sevenZero: false, jumpIn: false, drawUntilPlayable: false };
export const options = { target: [0, 200, 500], handSize: [5, 7, 9], turnSeconds: [15, 25, 40], tableSize: [0, 4, 5, 6] } as const;
export const houseRules = {
  stacking: ['Stacking', 'Answer a +2 with a +2, or anything with a +4. The last player who can’t stack draws the whole pile.'],
  challenge: ['+4 challenge', 'A +4 is a bluff if you still held the old color. Victims can challenge: bluffers draw the penalty; wrong guesses draw two extra.'],
  gifts: ['Gift cards', 'Four Gifts join the deck. Play one, then hand any other card from your hand to the player of your choice.'],
  sevenZero: ['Seven-O', 'Play a 7 to swap hands with anyone. Play a 0 and every hand passes along the direction of play.'],
  jumpIn: ['Jump in', 'Hold the exact same card as the pile? Slam it down out of turn and play continues from you.'],
  drawUntilPlayable: ['Draw till you can', 'Drawing keeps going until you find a card you can play.'],
} as const;
export type HouseRule = keyof typeof houseRules;
export const points = (c: Pick<Card, 'value'>) => c.value === 'wild' || c.value === 'wild4' ? 50 : /^\d$/.test(c.value) ? Number(c.value) : 20;

/** The parlor: more players than one table holds play at several tables at once, in timed rounds. */
export const ONE_TABLE = 10, AUTO_SEATS = 4, ROUND_MS = 360000, LAP_SECONDS = 12;
/** How many tables n players need; 1 is the classic single-table match. */
export const tableCount = (n: number, size: Settings['tableSize']) => n <= (size || ONE_TABLE) ? 1 : Math.ceil(n / (size || AUTO_SEATS));
export const roundCount = (target: Settings['target']) => target === 0 ? 1 : target === 200 ? 3 : 5;

/**
 * turnId is `${handId}:${revision}`. play/draw/keep/challenge use it.
 * An open ichiWindow has its own id; ichi (by the owner) and catch (by anyone else at the table) use that id instead,
 * so ordinary turn progress never makes a catch stale. next uses the table's handId between hands, or `r${round}` while the parlor reseats.
 * A Gift names the card to hand over (give) and who gets it (target, a player id); a Seven-O 7 names its swap target the same way.
 */
export type Action =
  | { kind: 'play'; turnId: string; cardId: string; color?: Color; target?: string; give?: string }
  | { kind: 'draw' | 'keep' | 'challenge' | 'ichi' | 'catch' | 'next'; turnId: string };

/** by and to are roster indices. A gift event never names the card that changed hands. */
export type GameEvent = {
  seq: number;
  kind: 'deal' | 'play' | 'jump' | 'draw' | 'penalty' | 'skip' | 'reverse' | 'color' | 'stack' | 'challenge' | 'swap' | 'rotate' | 'gift' | 'ichi' | 'catch' | 'timeout' | 'bell' | 'handEnd';
  text: string; by?: number; to?: number; card?: Card; count?: number; success?: boolean;
};
/** Everyone in the match, in join order. Tables refer to players by their index here (p). was is the table they just left, -1 before any move. */
export type RosterEntry = { id: string; name: string; color: string; connected: boolean; score: number; handsWon: number; table: number; was: number };
export type Seat = { p: number; count: number; safe: boolean };
export type HandResult = { winner: number | null; points: number; reason: string; hands: { p: number; cards: Card[]; points: number }[] };
/** One table. idle: its round is over and it waits for the others. lap: how many players still have their last turn after the bell, null before it. */
export type TableView = {
  id: number; phase: 'playing' | 'intermission' | 'idle';
  handId: string; hand: number; turnId: string; turn: number; deadline: number; current: number; direction: 1 | -1;
  color: Color; top: Card; drawCount: number; discardCount: number;
  /** before: the color a fresh +4 replaced (what a bluff would have held); null once stacked. */
  pending: { count: number; kind: 'draw2' | 'wild4'; from: number; before: Color | null; challengeable: boolean } | null;
  drawn: boolean; ichiWindow: { id: string; p: number; until: number } | null; lap: number | null;
  events: GameEvent[]; seats: Seat[]; handResult: HandResult | null; nextHandAt: number | null; ready: number[];
};
/** A table at a glance for the TV's floor rail. */
export type FloorTile = { id: number; phase: TableView['phase']; hand: number; color: Color; top: Value; current: number; seats: number[]; counts: number[]; ichi: boolean; pending: number };
/**
 * phase: intermission is the single table between hands; seating is the parlor between rounds; complete holds the final table for a moment (until endsAt) before results.
 * featured is the table the TV shows, chosen by the server.
 */
export type Match = {
  phase: 'playing' | 'intermission' | 'seating' | 'complete'; parlor: boolean; round: number; rounds: number; bellAt: number | null; rung: boolean;
  nextAt: number | null; ready: number[]; featured: number; winners: number[]; finishReason: string;
};
/** Everything but rev rides in the snapshot cache: an idle table costs a phone almost nothing. */
export type PublicView = { rev: number; match: Match; settings: Settings; roster: RosterEntry[]; feature: TableView | null; floor: FloorTile[] };
export type HandCard = Card & { playable: boolean; jumpable: boolean };
/** table: the player's own table in the parlor (the public view only carries the featured one). */
export type PrivateView = { table?: TableView; hand: HandCard[]; drawnId: string | null; canCall: boolean; canCatch: boolean; canChallenge: boolean };
