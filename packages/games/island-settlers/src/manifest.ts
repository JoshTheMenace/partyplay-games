import type { GameManifest } from '../../../party-contract/src/index';

export const manifest = {
  contractVersion: '1.0', id: 'island-settlers', title: 'Island Settlers',
  description:
    'Trade, build and sail a Catan-style island with private phone hands, plus Seafarers, Cities & Knights and more.',
  assetBase: '/games/island-settlers/', modes: ['shared-display'], players: { min: 1, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: true,
  snapshotCache: { revisionField: 'mapRev', fields: ['board', 'pieces', 'settings'] },
} as const satisfies GameManifest;

export default manifest;
