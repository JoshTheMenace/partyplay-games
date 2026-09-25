import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'blockwild', title: 'Blockwild', description: 'Survive, mine, craft and build together in a boundless blocky world.',
  assetBase: '/games/blockwild/', modes: ['shared-display'], players: { min: 1, max: 10 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  sessionControls: ['save', 'finish'], snapshotCache: { revisionField: 'revision', fields: ['edits'], keyedPairsFields: ['edits'] },
  simulation: { stepHz: 20, snapshotHz: 20, maxCatchUpSteps: 4 }, privatePlayerViews: true, supportsSolo: true,
} as const satisfies GameManifest;
