import type { GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'hotpot', title: 'Hotpot',
  description: 'Draw from the deck or steal a discard, then cook three complete sets before the table does. Bots fill empty seats.',
  assetBase: '/games/hotpot/', modes: ['shared-display'], players: { min: 1, max: 4 },
  orientation: { controller: 'portrait', personalView: 'any' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: true,
} as const satisfies GameManifest;
export default manifest;
