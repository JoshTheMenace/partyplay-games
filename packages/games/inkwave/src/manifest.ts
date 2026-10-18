import type { GameManifest } from '../../../party-contract/src/index';
export const manifest: GameManifest = {
  contractVersion: '1.0', id: 'inkwave', title: 'INKWAVE',
  description: 'Paint the ground in Turf War, hold the zones, or squad up against HULLBREAKER in the original ink shooter.',
  assetBase: '/games/inkwave/', modes: ['shared-display'], players: { min: 1, max: 8 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  privatePlayerViews: false, supportsSolo: true, prepareTimeoutMs: 60000,
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 },
  snapshotCache: { revisionField: 'revision', fields: ['ink', 'inkSequence'] },
};
