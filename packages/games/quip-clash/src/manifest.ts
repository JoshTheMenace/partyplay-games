import type { GameManifest } from '../../../party-contract/src/index';

export const manifest = {
  contractVersion: '1.0', id: 'quip-clash', title: 'Quip Clash',
  description: 'Turn everyday absurdity into comedy, then vote for the joke that lands.',
  assetBase: '/games/quip-clash/', modes: ['shared-display'], players: { min: 3, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
