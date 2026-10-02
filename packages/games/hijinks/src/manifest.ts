import type { GameManifest } from '../../../party-contract/src/index';

export const manifest = {
  contractVersion: '1.0', id: 'hijinks', title: 'Hijinks',
  description: 'A whole night of party games in one box: write, draw, bluff and vote your way to the most trophies.',
  assetBase: '/games/hijinks/', modes: ['shared-display'], players: { min: 2, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
  snapshotCache: { revisionField: 'mediaRev', fields: ['media'] },
} as const satisfies GameManifest;
export default manifest;
