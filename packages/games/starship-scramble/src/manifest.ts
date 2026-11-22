import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'starship-scramble', title: 'Starship Scramble',
  description: 'Captain your own starship in a co-op fleet of up to 64. Outrun the Armada, fight side by side in wings, and topple its flagship.',
  assetBase: '/games/starship-scramble/', modes: ['shared-display'], players: { min: 1, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime',
  input: ['action'], privatePlayerViews: true, supportsSolo: true,
  sessionControls: ['save', 'finish'], simulation: { stepHz: 20, snapshotHz: 10, maxCatchUpSteps: 4 },
  // Who is aboard, the sector map, event and store cards and the fleet's ship list are sent once per change (src/wire.ts); a full room loads hull art on many phones at once.
  snapshotCache: { revisionField: 'rev', fields: ['who', 'map', 'scene', 'craft'] }, prepareTimeoutMs: 45000,
} as const satisfies GameManifest;
