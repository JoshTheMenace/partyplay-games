export type Settings = { writingSeconds: number; votingSeconds: number; revealSeconds: number };
export type Action = { type: 'draft' | 'answer'; turnId: string; questionId: string; text: string } | { type: 'vote'; turnId: string; choice: 0 | 1 };
export type Phase = 'writing' | 'voting' | 'reveal' | 'results';
export type Reveal = { authors: [string, string]; votes: [string[], string[]]; points: [number, number]; result: 'winner' | 'tie' | 'no-votes' | 'missing'; winner: 0 | 1 | null };
export type PublicView = {
  phase: Phase; round: number; turnId: string; deadline: number; multiplier: number;
  players: { id: string; name: string; color: string; score: number; connected: boolean }[];
  submitted: number; expected: number; matchNumber: number; matchCount: number;
  matchup: null | { prompt: string; answers: [string | null, string | null]; reveal: Reveal | null };
};
export type PrivateView = {
  questions: { id: string; prompt: string; draft: string; answer: string | null }[];
  canVote: boolean; voted: 0 | 1 | null; isAuthor: boolean;
};
