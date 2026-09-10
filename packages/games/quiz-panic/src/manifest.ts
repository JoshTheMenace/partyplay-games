import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'quiz-panic', title: 'Quiz Panic',
  description: 'A runaway quiz-show laboratory. Charge up, rescue your score, and race for the exit. Nobody sits out.',
  assetBase: '/games/quiz-panic/', modes: ['shared-display'], players: { min: 2, max: 10 },
  orientation: { controller: 'portrait', personalView: 'any' }, timing: 'turn-based', input: ['action'],
  privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
