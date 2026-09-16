import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'island-settlers', title: 'Island Settlers',
  description: 'Trade, build, and sail. A Catan-inspired board game with Standard and Connect-style play.',
  assetBase: '/games/island-settlers/', modes: ['shared-display'], players: { min: 3, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
  snapshotCache: { revisionField: 'revision', fields: ['board', 'routes', 'buildings'] },
} as const satisfies GameManifest;
