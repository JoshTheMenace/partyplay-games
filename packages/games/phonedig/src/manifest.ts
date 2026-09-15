import type { GameManifest } from '../../../party-contract/src/index';

/* Phonedig runs its own fixed-step simulation, so stepHz is not a preference:
 * DT = 1/60 is load-bearing in the engine. Rock falls and harpoon reach are
 * integrated per step, and a variable dt makes both depend on frame rate — the
 * reason the original has its own accumulator rather than using rAF's delta.
 * FixedStepClock hands the game exactly 1/stepHz, which is what we need.
 *
 * Portrait, deliberately. The shell's rotate gate keys off this field alone, and
 * the shaft is 20 cells wide against 160 deep: a landscape phone would show a
 * third of the tunnel ahead.
 *
 * The shaft widens with the crew — ten lanes for one digger, seventy-three for
 * ten, on the same curve the monster count uses — and players.max is 4 by
 * CHOICE, not by any remaining limit.
 *
 * Nothing technical stops ten. Measured after twenty seconds of digging on
 * level 20, with entities packed and the cut ground run-length encoded:
 * 4 diggers 9.4 KiB, 8 diggers 16.8 KiB, 10 diggers 20.9 KiB against a 32 KiB
 * envelope. The generator places 2.2 monsters per lane across 73 lanes without
 * ever coming up short, and ten diggers with fifty monsters tick in 0.14 ms
 * against a 16.7 ms budget.
 *
 * Four is where it stays until four have actually been played properly. The
 * numbers say the room would hold ten; nothing yet says ten would be any good,
 * and a roster is a promise about the experience rather than about the wire. */
export const manifest = {
  contractVersion: '1.0',
  id: 'phonedig',
  title: 'Phonedig',
  description: 'Dig for your pay, not your kills. Cut a shaft, clear the ground and bank the haul before the roof comes in.',
  assetBase: '/games/phonedig/',
  modes: ['shared-display'],
  players: { min: 1, max: 4 },
  orientation: { controller: 'portrait', personalView: 'portrait' },
  timing: 'realtime',
  input: ['state', 'action'],
  privatePlayerViews: true,
  supportsSolo: true,
  simulation: { stepHz: 60, snapshotHz: 20, maxCatchUpSteps: 6 },
  /* Terrain is a pure function of (level, seed, entryLc), so clients rebuild it
   * and only changed cells cross the wire. See buildEdits in server.ts. */
  snapshotCache: {
    revisionField: 'revision',
    fields: ['edits'],
    keyedPairsFields: ['edits'],
  },
} as const satisfies GameManifest;

export default manifest;
