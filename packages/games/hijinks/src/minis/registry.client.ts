import type { MiniClient } from '../core/contract';

/** Minigame id → lazy client chunk (minis/<id>/client.tsx default export). Only ids listed here are playable in the browser. */
export const MINI_CLIENTS: Record<string, () => Promise<{ default: MiniClient }>> = {
  'quip-clash': () => import('./quip-clash/client'),
  'tall-tales': () => import('./tall-tales/client'),
  'sketch-bluff': () => import('./sketch-bluff/client'),
  'shirt-show': () => import('./shirt-show/client'),
  'quiz-panic': () => import('./quiz-panic/client'),
  'odd-one-in': () => import('./odd-one-in/client'),
  ballpark: () => import('./ballpark/client'),
  'comment-section': () => import('./comment-section/client'),
  'bracket-brawl': () => import('./bracket-brawl/client'),
  airlock: () => import('./airlock/client'),
  'split-decision': () => import('./split-decision/client'),
};
