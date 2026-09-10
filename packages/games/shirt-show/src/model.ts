import type { Drawing } from '../../../party-contract/src/index';

export type Settings = { pace: 'standard' | 'quick' };
export type Phase = 'draw' | 'slogan' | 'design' | 'reveal' | 'vote' | 'match-result' | 'gallery';
export type ShirtColor = 'cream' | 'coral' | 'sky' | 'lime';
export type Art = { id: string; owner: string | null; drawing: Drawing; fallback: boolean };
export type Slogan = { id: string; owner: string | null; text: string; fallback: boolean };
export type Selection = { artId: string; sloganId: string; color: ShirtColor };
export type Design = Selection & { id: string; designer: string; automatic: boolean; priority: number };
export type Shirt = Design & { art: Art; slogan: Slogan };
export type MatchResult = { id: string; stage: number; entries: string[]; votes: number[]; winner: string; policy: 'majority' | 'tie-priority' | 'bye'; cheers: number };
export type PublicView = {
  phase: Phase; turnId: string; deadline: number; slot: number; pace: Settings['pace'];
  players: { id: string; name: string; connected: boolean; score: number }[];
  submitted: number; total: number; shirts: Shirt[];
  match: { id: string; stage: number; entries: string[]; tiePriority: string; voted: number; eligible: number; cheers: number } | null;
  history: MatchResult[]; champion: string | null;
  gallery: { art: Art[]; slogans: Slogan[] } | null;
};
export type PrivateView = {
  submitted: boolean; revision: number; drawing: Drawing; slogan: string; selection: Selection | null;
  art: Art[]; slogans: Slogan[]; starters: string[]; canVote: boolean; voted: boolean; cheered: boolean;
};
export type Action =
  | { type: 'drawing'; turnId: string; revision: number; commit: boolean; drawing: Drawing }
  | { type: 'slogan'; turnId: string; revision: number; commit: boolean; text: string }
  | { type: 'design'; turnId: string; revision: number; commit: boolean; selection: Selection }
  | { type: 'vote'; turnId: string; designId: string }
  | { type: 'cheer'; turnId: string };
