import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
export const manifest = {
  contractVersion: '1.0', id: 'night-job', title: 'Night Job', description: 'Case the joint. Grab the goods. Get your whole crew out. Three 3D heists for one crew of four, or a whole room of rival crews racing for the fastest clean getaway.',
  // A building is balanced for four thieves; a bigger room becomes a crew night of rival crews, each in its own copy of the job
  // (model.ts `crewSizes`), so the room's 64 seats are sixteen crews.
  assetBase: '/games/night-job/', modes: ['shared-display'], players: { min: 1, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  // Snapshots are packed (wire.ts). The roster and the final stats ride once per socket; a seat privately gets its hint and, on a
  // crew night, its own crew's view.
  privatePlayerViews: true, supportsSolo: false, simulation: { stepHz: 30, snapshotHz: 20, maxCatchUpSteps: 4 }, snapshotCache: { revisionField: 'rev', fields: ['base', 'final'] },
  // The TV loads the model kit and compiles its shaders before the common start; a slow display needs more than the default 20 s.
  prepareTimeoutMs: 45_000,
} as const satisfies GameManifest;
