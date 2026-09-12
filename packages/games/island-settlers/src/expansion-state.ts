import type { Phase, Tile } from './model';
import type { ExpansionCommand, ExpansionPublic, Improvements, Knight, Mission, ProgressKind, Track } from './expansion-model';

export type Progress = { id: string; kind: ProgressKind; track: Track };
export type ExpansionPlayer = {
  wagonJourneys: number; improvements: Improvements; progress: Progress[]; fish: { id: string; value: number }[]; coins: number; defenderPoints: number; progressPoints: number; prisoners: number;
  missions: Record<Mission, number>; fleet: string[]; harborUsed: string[]; goldTrades: number; built: boolean; movement: boolean; activeShip: string | null; finishedShips: string[];
  shipBoosts: string[]; pirateAttempts: string[]; piratePaid: string[]; fishRolled: boolean; fastGold: number; wagonBoost: boolean; wagonAttempts: string[];
};
export type Prompt = {
  id: string; playerId: string; kind: 'pillage' | 'draw' | 'progress-discard' | 'retreat' | 'wedding' | 'sabotage' | 'harbor' | 'guild' | 'spy' | 'treason' | 'replace-knight' | 'caravan-bid' | 'caravan-place' | 'caravan-vote' | 'gold-trade' | 'guard-card' | 'guard-treason' | 'guard-retreat' | 'rob' | 'barbarian-move' | 'event-give' | 'event-pick' | 'event-road';
  title: string; from?: string; knight?: Knight; count?: number; card?: string; target?: string; command?: ExpansionCommand;
};
export type ExpansionState = {
  barbarianPaths: Record<string, string[]>; attackDeck: string[]; attackDiscard: string[]; deliveredCargo: string[]; lairNumbers: Record<string, number>; resumeMovement: Phase | null; alchemy: [number, number] | null; freeRouteKind: Record<string, 'road' | 'ship'>; pillaged: string[]; public: ExpansionPublic; players: Record<string, ExpansionPlayer>; progressDecks: Record<Track, ProgressKind[]>;
  knightTurns: Record<string, { activated: number; promoted: number }>; prompts: Prompt[]; resumePhase: Phase; choiceStarted: number | null; continuation: 'production' | null;
  fishDeck: number[]; fishDiscard: number[]; fog: Record<string, Tile>;
  guardMoved: string[]; caravanPending: string[]; caravanBids: { playerId: string; count: number; target: string }[];
  cargoDecks: Record<string, ('tools' | 'sand' | 'marble' | 'glass')[]>;
};
