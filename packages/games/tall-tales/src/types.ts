export type Settings = { pace: 'standard' | 'relaxed' };
export type Action = { type: 'lie'; turnId: string; text: string } | { type: 'vote'; turnId: string; optionId: string };
export type Phase = 'writing' | 'voting' | 'reveal' | 'complete';
export type PublicView = {
  phase: Phase; turnId: string; round: number; totalRounds: number; multiplier: number; deadline: number;
  prompt: string; category: string; submitted: number; voted: number;
  players: { id: string; name: string; color: string; score: number; gain: number; connected: boolean }[];
  options: { id: string; text: string }[];
  reveal: null | { answer: string; explanation: string; sourceUrl: string; options: { id: string; text: string; truth: boolean; authors: string[]; voters: string[] }[] };
};
export type PrivateView = { lie: string | null; votedOptionId: string | null; ownOptionIds: string[] } | null;
