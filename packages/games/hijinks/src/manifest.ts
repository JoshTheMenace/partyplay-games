import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';

export const manifest = {
  contractVersion: '1.0', id: 'hijinks', title: 'Hijinks',
  description: 'A whole night of party games in one box: write, draw, bluff and vote your way to the most trophies.',
  assetBase: '/games/hijinks/', modes: ['shared-display'], players: { min: 2, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
  // Sent only when they change (mediaRev): drawings, and the roster, which is most of a big room's snapshot.
  snapshotCache: { revisionField: 'mediaRev', fields: ['media', 'players'] },
} as const satisfies GameManifest;
export default manifest;
