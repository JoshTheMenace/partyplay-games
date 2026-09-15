import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'kitchen-rush', title: 'Kitchen Rush', description: 'Chop, cook, toss and serve together in a ten-stage 3D kitchen campaign.', assetBase: '/games/kitchen-rush/',
  modes: ['shared-display'], players: { min: 1, max: 10 }, orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 }, privatePlayerViews: false, supportsSolo: true,
} as const satisfies GameManifest;
