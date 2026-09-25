import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'starship-scramble', title: 'Starship Scramble',
  description: 'Captain your own starship in a co-op fleet. Outrun the Armada, fight together, and topple its flagship.',
  assetBase: '/games/starship-scramble/', modes: ['shared-display'], players: { min: 1, max: 4 },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime',
  input: ['action'], privatePlayerViews: true, supportsSolo: true,
  sessionControls: ['save', 'finish'], simulation: { stepHz: 20, snapshotHz: 10, maxCatchUpSteps: 4 },
} as const satisfies GameManifest;
