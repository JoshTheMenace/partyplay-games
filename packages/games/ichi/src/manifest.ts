import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'ichi', title: 'Ichi', description: 'One card away. Match colors, plan your last move, and remix the rules with eight optional expansions.',
  assetBase: '/games/ichi/', modes: ['shared-display'], players: { min: 2, max: 10 },
  orientation: { controller: 'any', personalView: 'any' }, timing: 'turn-based', input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
