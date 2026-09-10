export type Settings = { rounds: number };
export type Format = { kind: 'number'; min: number; max: number } | { kind: 'choice'; options: readonly string[] } | { kind: 'text'; maxLength: number };
export type Answer = string | number;
export type Action = { type: 'answer'; turnId: string; answer: Answer } | { type: 'vote'; turnId: string; target: string | null };
export type Phase = 'answer' | 'discuss' | 'vote' | 'resolution' | 'complete';
export type Guest = { id: string; name: string; color: string };
export type Clue = { number: number; question: string; answers: { playerId: string; answer: Answer | null }[] };
export type PublicView = {
  phase: Phase; turnId: string; round: number; rounds: number; clue: number; deadline: number;
  category: string; format: Format; players: (Guest & { score: number })[];
  submitted: number; voted: number; majority: number; reveals: Clue[];
  result: { caught: boolean; blufferId: string; awards: { playerId: string; points: number }[]; attempts: number; reason: 'caught' | 'escaped' } | null;
};
export type PrivateView = {
  turnId: string; role: 'guest' | 'bluffer'; question: string | null;
  answered: boolean; answer: Answer | null; voted: boolean; target: string | null;
} | null;
