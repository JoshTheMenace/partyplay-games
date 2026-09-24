import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'ichi', title: 'Ichi', description: 'Match colors, stack the penalties and shout Ichi! before anyone catches you on your last card.',
  assetBase: '/games/ichi/', modes: ['shared-display'], players: { min: 2, max: 10 },
  orientation: { controller: 'any', personalView: 'any' }, timing: 'turn-based', input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
