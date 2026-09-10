import type { GameManifest } from '../../../party-contract/src/index';
export const manifest: GameManifest = {
  contractVersion: '1.0', id: 'kart-party', title: 'Kart Party', description: 'Drift, grab an item, and race your friends or CPU rivals.', assetBase: '/games/kart-party/',
  modes: ['shared-display'], players: { min: 1, max: 10 }, orientation: { controller: 'landscape', personalView: 'landscape' },
  timing: 'realtime', input: ['state','action'], privatePlayerViews: false, supportsSolo: true,
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 },
};
