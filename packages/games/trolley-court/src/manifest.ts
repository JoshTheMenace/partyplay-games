import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'trolley-court', title: 'Trolley Court', description: 'Two teams stack the tracks with bystanders, culprits and twists, then plead with the Conductor. Someone pulls the lever. Fewest deaths wins.',
  assetBase: '/games/trolley-court/', modes: ['shared-display'], players: { min: 3, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based', input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
