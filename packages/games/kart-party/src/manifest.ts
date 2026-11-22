import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
export const manifest: GameManifest = {
  contractVersion: '1.0', id: 'kart-party', title: 'Kart Party', description: 'Drift, boost and bump through five toybox courses, finishing on Rainbow Road, against friends and CPU rivals.', assetBase: '/games/kart-party/',
  modes: ['shared-display'], players: { min: 1, max: MAX_ROOM_PLAYERS }, orientation: { controller: 'landscape', personalView: 'landscape' },
  // Each seat privately gets its own kart's prediction state; the roster, settings and final results are sent once per socket (net/wire.ts).
  timing: 'realtime', input: ['state', 'action'], privatePlayerViews: true, supportsSolo: true, snapshotCache: { revisionField: 'rev', fields: ['base', 'players', 'final'] },
  simulation: { stepHz: 60, snapshotHz: 30, maxCatchUpSteps: 6 },
  // Every racing phone builds the 3D course before the common start. A full room fetching models over one Wi-Fi needs more than the default 20 s.
  prepareTimeoutMs: 60_000,
};
