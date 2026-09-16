import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'starship-scramble', title: 'Starship Scramble',
  description: 'Command your own ship. Explore, upgrade, and fight together as a fleet.',
  assetBase: '/games/starship-scramble/', modes: ['shared-display'], players: { min: 1, max: 4 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime',
  input: ['state', 'action'], privatePlayerViews: true, supportsSolo: true,
  sessionControls: ['save', 'finish'], simulation: { stepHz: 30, snapshotHz: 10, maxCatchUpSteps: 4 },
} as const satisfies GameManifest;
