import type { GameManifest } from '../../../party-contract/src/index';

export const manifest = {
  contractVersion: '1.0', id: 'shirt-show', title: 'Shirt Show',
  description: 'Draw, remix and vote at a pop-up print studio. Every shirt has three creative credits.',
  assetBase: '/games/shirt-show/', modes: ['shared-display'], players: { min: 3, max: 10 },
  orientation: { controller: 'portrait', personalView: 'portrait' }, timing: 'turn-based',
  input: ['action'], privatePlayerViews: true, supportsSolo: false,
} as const satisfies GameManifest;
