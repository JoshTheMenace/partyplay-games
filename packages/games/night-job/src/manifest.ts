import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'night-job', title: 'Night Job', description: 'Case the joint. Grab the goods. Get your whole crew out. Three 3D heists for one to four thieves.',
  assetBase: '/games/night-job/', modes: ['shared-display'], players: { min: 1, max: 4 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  privatePlayerViews: false, supportsSolo: false, simulation: { stepHz: 30, snapshotHz: 20, maxCatchUpSteps: 4 },
} as const satisfies GameManifest;
