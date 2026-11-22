import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
import { CACHED } from './types';
export const manifest = {
  contractVersion: '1.0', id: 'trolley-court', title: 'Trolley Court', description: 'Two teams stack the tracks with bystanders, culprits and twists, then plead with the Conductor. Someone pulls the lever. Fewest deaths wins. Big rooms fill the Gallery: pick a track to stand on.',
  assetBase: '/games/trolley-court/', modes: ['shared-display'], players: { min: 3, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based', input: ['action'], privatePlayerViews: true, supportsSolo: false,
  snapshotCache: { revisionField: 'rev', fields: CACHED },
} as const satisfies GameManifest;
