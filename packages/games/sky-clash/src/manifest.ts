import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'sky-clash', title: 'Sky Clash', description: 'The Melee roster, rebuilt. Rack up damage and launch your friends off the stage.',
  assetBase: '/games/sky-clash/', modes: ['shared-display'], players: { min: 1, max: 4 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  simulation: { stepHz: 60, snapshotHz: 30, maxCatchUpSteps: 6 }, privatePlayerViews: false, supportsSolo: false,
} as const satisfies GameManifest;
