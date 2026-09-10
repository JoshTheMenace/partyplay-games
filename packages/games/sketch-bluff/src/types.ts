import type { Drawing } from '../../../party-contract/src/index';
export type Settings = { length: 'standard' | 'short'; drawingSeconds: number; captionSeconds: number; voteSeconds: number };
export type Phase = 'drawing' | 'caption' | 'vote' | 'reveal' | 'results';
export type Action = { turnId: string } & (
  { type: 'save-draft'; drawing: Drawing } | { type: 'drawing'; drawing: Drawing } | { type: 'caption'; text: string } | { type: 'vote'; choiceId: string }
);
export type Choice = { id: string; text: string };
export type RevealChoice = Choice & { truth: boolean; authors: string[]; voters: string[] };
export type PublicView = {
  phase: Phase; turnId: string; deadline: number; gallery: number; galleries: number;
  exhibit: number; exhibitCount: number; artistId: string | null; drawing: Drawing | null;
  choices: Choice[]; reveal: { answer: string; choices: RevealChoice[]; gains: Record<string, number> } | null;
  players: { id: string; name: string; color: string; score: number; connected: boolean }[];
  submitted: number; expected: number; skipped: number;
};
export type PrivateView = { prompt: string | null; draft: Drawing | null; submitted: boolean; caption: string | null; vote: string | null; isArtist: boolean };
