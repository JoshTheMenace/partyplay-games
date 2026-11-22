import { MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import type { GameManifest } from '../../../party-contract/src/index';

/* Phonedig runs its own fixed-step simulation, so stepHz is not a preference:
 * DT = 1/60 is load-bearing in the engine. Rock falls and harpoon reach are
 * integrated per step, and a variable dt makes both depend on frame rate — the
 * reason the original has its own accumulator rather than using rAF's delta.
 * FixedStepClock hands the game exactly 1/stepHz, which is what we need.
 *
 * Landscape controls keep movement left and pumping right.
 *
 * players.max is the whole room, and that is a statement about CREWS rather
 * than about one shaft. A shaft is tuned for one to four diggers — it widens
 * with its crew, and so does everything in it — and nothing here stretches it
 * further. A bigger room is several crews, each in a shaft of its own on the
 * same seed, racing a shift clock; see crews.ts and DESIGN.md.
 *
 * That is also what makes sixty-four affordable. A phone is sent its own
 * crew's shaft and the one the television is showing, so its traffic is the
 * same in a room of eight and a room of sixty-four (about 62 KiB/s, measured in
 * tests/crews.test.ts), and the server steps sixteen small simulations rather
 * than one enormous one: about 1.5 ms a tick with every seat digging. */
export const manifest = {
  contractVersion: '1.0',
  id: 'phonedig',
  title: 'Phonedig',
  description: 'Dig for your pay, not your kills. Clear a level to bank the haul before the roof comes in. Up to four share a shaft; a bigger room splits into rival crews.',
  assetBase: '/games/phonedig/',
  modes: ['shared-display'],
  players: { min: 1, max: MAX_ROOM_PLAYERS },
  orientation: { controller: 'landscape', personalView: 'landscape' },
  timing: 'realtime',
  input: ['state', 'action'],
  privatePlayerViews: true,
  supportsSolo: true,
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 },
  /* The scene is ready the moment its canvas exists, so what this waits on is
   * one 200 KB sprite sheet — on every phone in the room. Sixty-four phones on
   * party Wi-Fi get longer than the default twenty seconds to fetch it before
   * one slow one sends everybody back to the lobby. */
  prepareTimeoutMs: 45_000,
  /* Terrain is a pure function of (level, seed, entryLc), so clients rebuild it
   * and only changed cells cross the wire. See buildEdits in server.ts. */
  snapshotCache: {
    revisionField: 'revision',
    fields: ['edits'],
    keyedPairsFields: ['edits'],
  },
} as const satisfies GameManifest;

export default manifest;
