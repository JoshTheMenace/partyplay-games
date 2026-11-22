import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'ichi', title: 'Ichi', description: 'Match colors, hand out Gifts and shout Ichi! before anyone catches you on your last card. Big rooms split into tables.',
  assetBase: '/games/ichi/', modes: ['shared-display'], players: { min: 2, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'any', personalView: 'any' }, timing: 'turn-based', input: ['action'], privatePlayerViews: true, supportsSolo: false,
  // Only rev travels while nothing changes; see sync() in server.ts.
  snapshotCache: { revisionField: 'rev', fields: ['match', 'settings', 'roster', 'feature', 'floor'] },
} as const satisfies GameManifest;
