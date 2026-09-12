# Original-data foundation

This folder preserves the original-data foundation and isolated reference viewer. The playable Fox/Falco adaptation now consumes these helpers plus `attributes.ts` and `scripts.ts`; see [the game README](../README.md). Neither the viewer nor the game establishes frame-perfect parity.

## What is reusable now

- `fox-data.ts` preserves 47 common attributes mapped by binary offset against the pinned decompilation, 327 action scripts, 63 subroutines, script addresses, and animation-length metadata. Numeric values are preserved; unknown integer words in the old dump are interpreted according to the source type. Both source files are hash-checked before regeneration. The published dump's game revision is still unverified.
- `physics.ts` implements gravity, terminal fall speed, friction, and air-drift acceleration from `ftcommon.c`. It uses float32 rounding in game units per frame. The movement probe integrates prescribed initial velocities; it omits jump startup/state transitions, first-frame physics skipping, landing, collision and special moves. It must not be sold as a full-hop implementation.
- `commands.ts` decodes raw spawn-hitbox fields using `lb/types.h` and `ftAction_8007121C`. This corrects the spatial-scale discrepancy in the published decoded fields and preserves signed offsets and shield damage. Bone-space coordinates cannot be attached to the replacement model and treated as original collision geometry.
- `../assets/fox-replacement.glb` and `.blend` contain new Fox pilot geometry, a 20-bone skin, 7,732 triangles and 11 materials. The GLB is about 884 KiB. It uses meters, Y up and +Z forward, with feet at the origin. These visual units do not rescale game physics. The Blender source and exporter are in `../tools/build_fox.py`.
- Fable authors the separate viewer and presentation poses in `../lab/`. Those poses are newly authored, not recovered Melee animation samples.

## Validation and regeneration

Run from the PartyPlay consumer root:

```sh
node --import tsx --test packages/games/sky-clash/tests/fidelity*.test.ts
node node_modules/typescript/bin/tsc --project game-modules/packages/games/sky-clash/tsconfig.fidelity.json --noEmit
node packages/games/sky-clash/tools/build_lab.mjs melee-reference-unique-run
python3 -m http.server 4386 --bind 127.0.0.1 --directory output/builds/melee-reference-unique-run/client
```

The viewer builds into a new immutable output directory. It is absent from the normal catalog and room registries. Stop only your own server when finished; do not rebuild a live output directory.

The importer accepts the locally downloaded published dump and the pinned source header, without network access:

```sh
python3 packages/games/sky-clash/tools/import_fox.py output/melee-fidelity/Fox.json /private/tmp/partyplay-melee-reference/src/melee/ft/types.h
python3 packages/games/sky-clash/tools/reference_vectors.py /private/tmp/partyplay-melee-reference/src/melee/ft/ftcommon.c
/opt/homebrew/bin/blender --background --factory-startup --python-exit-code 1 --python packages/games/sky-clash/tools/build_fox.py
/opt/homebrew/bin/blender --background --factory-startup --python-exit-code 1 --python packages/games/sky-clash/tools/verify_fox.py
```

The 320 checked-in helper probes are generated from the unmodified named C functions with a small native harness and `-ffp-contract=off`. They exercise neutral input, reversal, overspeed and fall-speed clamps. Passing them establishes agreement with this native C compilation, not PowerPC floating-point or full-game equivalence. Blender reimport verifies dimensions, bone count and actual skin deformation. Browser QA is recorded in `../QA.md`.

## Required before a playable original-mechanics fighter

Recover and verify the character-specific special parameter bank, common `PlCo.dat` values, original bone hierarchy/transforms and animation samples, stage collision data, and a matching executable or equivalent trusted gameplay traces. Implement action callbacks, script execution, collision, damage/knockback, shields, grabs, recovery and frame-indexed input without falling back to the old custom coefficients. Compare against original behavior before expanding the roster.

The browser conversion and PartyPlay input/timing integration remain engineering work even after these data gaps are filled. The earlier Bolt/Atlas game is retained separately as an experiment and does not supply missing Melee behavior.

Source links and acceptance history: [REFERENCE.md](../REFERENCE.md).
