import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'kitchen-rush', title: 'Kitchen Rush', description: 'Chop, cook, throw and serve together in hand-built 3D kitchens full of pots, pans, fires and conveyor chaos. Big crews split into rival kitchens of one restaurant.', assetBase: '/games/kitchen-rush/',
  // Up to ten chefs share a kitchen; a bigger crew cooks in parallel kitchens of five to eight (model.ts `lineSizes`), so the room's 64 seats are eight full kitchens.
  modes: ['shared-display'], players: { min: 1, max: MAX_ROOM_PLAYERS }, orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state'],
  // The public view is packed (wire.ts); what never changes rides once per socket. A seat privately gets only its command acknowledgement and note.
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 }, privatePlayerViews: true, supportsSolo: true, snapshotCache: { revisionField: 'rev', fields: ['base', 'final'] },
  // In a big service every phone builds its own kitchen view before the common start; a full room fetching models over one Wi-Fi needs more than the default 20 s.
  prepareTimeoutMs: 60_000,
} as const satisfies GameManifest;
