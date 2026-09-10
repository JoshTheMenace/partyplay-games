import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'sketch-bluff', title: 'Sketch Bluff',
  description: 'Draw an absurd secret. Invent a convincing caption. Find the truth in a midnight gallery.',
  assetBase: '/games/sketch-bluff/', modes: ['shared-display'], players: { min: 3, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
