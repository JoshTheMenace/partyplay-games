import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'tall-tales', title: 'Tall Tales',
  description: 'Invent a believable lie. Find the strange truth in the oddities archive. Seven questions, one double-value finale. 8–12 minutes.',
  assetBase: '/games/tall-tales/', modes: ['shared-display'], players: { min: 3, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based', input: ['action'],
  privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
