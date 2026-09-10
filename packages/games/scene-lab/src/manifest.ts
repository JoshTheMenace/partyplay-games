import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'scene-lab', title: '3D Scene Lab', description: 'Development arena: steer, boost, collect stars, and test the 3D platform.',
  assetBase: '/games/scene-lab/', modes: ['shared-display'], players: { min: 2, max: 10 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state'],
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 }, privatePlayerViews: false, supportsSolo: false,
} as const satisfies GameManifest;
