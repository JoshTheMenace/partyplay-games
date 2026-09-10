import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'odd-one-in', title: 'Odd One In',
  description: 'One guest missed the question. Answer, compare stories, and catch the party bluffer.',
  assetBase: '/games/odd-one-in/', modes: ['shared-display'], players: { min: 4, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
