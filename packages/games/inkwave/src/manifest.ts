import { MAX_ROOM_PLAYERS, type GameManifest } from '../../../party-contract/src/index';
export const manifest: GameManifest = {
  contractVersion: '1.0', id: 'inkwave', title: 'INKWAVE',
  description: 'Paint the ground in Turf War, hold the zones, or squad up against HULLBREAKER in the original ink shooter. Big rooms split into 4v4 arenas that score for two room-wide teams.',
  // One arena seats eight (4v4, or one boss squad). A bigger room plays one arena per eight people at once (public/arenas.js),
  // so the room's 64 seats are eight arenas and a phone only ever draws and receives its own.
  assetBase: '/games/inkwave/', modes: ['shared-display'], players: { min: 1, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'landscape', personalView: 'landscape' }, timing: 'realtime', input: ['state', 'action'],
  // The TV's arena rides in the public view. In a room of several arenas each seat privately gets its own arena instead.
  // Every screen builds the original 3D stage and compiles its shaders before the common start; a slow phone in a big
  // room needs longer than a minute, and one timeout sends the whole room back to the lobby.
  privatePlayerViews: true, supportsSolo: true, prepareTimeoutMs: 120000,
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 },
  // What a screen needs once: the roster and the paint as it stands when it connects. The revision stays 0 through a
  // match, so the transport sends these with a socket's first snapshot only; later paint baselines ride in the view
  // itself (`fresh`). It becomes 1 with the result, which every socket then receives once, not twenty times a second.
  snapshotCache: { revisionField: 'revision', fields: ['ink', 'inkSequence', 'roster', 'settings', 'colors', 'teams', 'result'] },
};
