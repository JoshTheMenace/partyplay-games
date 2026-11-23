import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';

export const manifest = {
  contractVersion: '1.0', id: 'island-settlers', title: 'Island Settlers',
  description:
    'Trade, build and sail a Catan-style island with private phone hands, plus Seafarers, Cities & Knights and more. Big rooms split into islands of four.',
  assetBase: '/games/island-settlers/', modes: ['shared-display'], players: { min: 1, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: true,
  // Everything shared is one cached field, so a quiet snapshot is only its revision (wire.ts).
  snapshotCache: { revisionField: 'rev', fields: ['league'] },
} as const satisfies GameManifest;

export default manifest;
