# Sky Clash

A playable PartyPlay platform fighter for **2–4 players**, with Fox and Falco, new Blender models, and Fable-authored UI and animations. It uses published character attributes and normal attack scripts from Melee research. Missing engine behavior is reconstructed. This is a two-character adaptation, not the complete Melee roster or a frame-identical port.

## Play

Open Sky Clash in PartyPlay, create a shared-display room, join with 2–4 phones, and ready up. Turn phones sideways for play. Choose Fox or Falco; unselected players retain their alternating default after 20 seconds. All selections advance after a three-second minimum, followed by a three-second countdown.

Matches support 60/120/180 seconds and 1/3/5 stocks. Last survivor wins. At time, remaining stocks rank first, then lower damage; eliminated players rank by KOs. Exact ties share the result. Replay starts a fresh match in the same room. Disconnects release input; reconnect within 15 seconds to keep the fighter, otherwise forfeit.

| Control | Behavior | Keyboard |
| --- | --- | --- |
| Move | Walk with a light stick; run at the edge. Down fast-falls or drops through upper platforms. | WASD / arrows |
| Jump | Tap for a short hop, hold for full height; press again to double-jump. | K / Space |
| Attack | Neutral jab, directional tilts; neutral, forward, back, up or down aerials. Hold to repeat. | J |
| Smash | Side/up/down smash on the ground. Hold to charge, release to strike. In air, directional aerial. | I |
| Special | Neutral laser; side illusion; up fire recovery aimed during windup; down reflector. Hold neutral for repeated lasers. | L |
| Shield | Ground guard; in air, directional dodge followed by freefall. Jump out of guard. | Shift |

Fox runs faster and fires non-flinching lasers. Falco jumps higher, weighs more, fires stunning lasers, and has different launch angles and damage on several attacks. Air recovery is limited until landing; getting hit restores the recovery opportunity. Shields drain and regenerate, break into stun, and absorb attacks. Blast zones remove stocks; respawn gives brief protection. Attacking cancels that protection.

## What is reused

`fidelity/attributes.ts` contains **53 scalar attributes per fighter**, mapped by offsets in the pinned decompilation header. Movement preserves per-character run/walk, jump startup, full/short/double-jump velocities, air drift, gravity, fast-fall, weight and landing-lag values. World units are converted with one scale (`UNIT = .08`), rather than replacing the character tuning.

`src/moves.ts` expands the preserved raw normal-attack commands into frame windows. It preserves hitbox damage, radii, launch angles, base/growth/fixed knockback, ground/air masks, early/late changes, interruptibility, autocancel windows and repeated-hit groups. Twelve normal attack families per fighter are accessible. Fox's seven drill hits and Falco's early/late down-air are different scripts.

`src/server.ts` runs the fight at 60 Hz. It uses the original scalar air helpers, sourced move windows, reconstructed 2D collision anchors and knockback/common constants. It owns hit resolution, stock loss, projectiles and results. All simultaneous contacts are captured before resolution so roster order does not prevent trades. The existing PartyPlay room handles joins, readiness, reconnect and replay.

`src/model.ts` defines the shared view and inputs. Press counters preserve taps through the platform's 20 Hz input coalescing; public snapshots are 30 Hz. This is server-authoritative networking without rollback. `src/client.tsx`, `scene.tsx`, `rig.ts` and `animation.ts` are Fable's UI/rendering/animation implementation. The phones do not construct a 3D world. Models load before the shared scene reports ready.

## Reconstruction limits

The public data's exact game revision is unverified. Original costume meshes, bone animation samples and common/special parameter banks were unavailable. Fox and Falco use newly authored replacement meshes. The stage, collision anchors/hurt capsules, visual attack poses, special travel/timing, laser behavior, shields, DI, hitlag/hitstun and common knockback constants include reconstruction. Sourced attack values do not make the resulting balance identical.

The current slice omits the remaining roster, grabs/throws, jab chains/rapid jab, dash attacks, ledge grabbing/options, techs, L-canceling, grounded rolls, stale-move queue, crouch canceling, hitbox clanks and full original collision-state flags. It includes stock/time play on one custom stage; no items, CPU opponents or single-player campaign. See [REFERENCE.md](REFERENCE.md) for provenance and [QA.md](QA.md) for actual checks and hardware limits.

## Build and test

From the PartyPlay root (never rebuild a directory serving a live session):

```sh
node --import tsx --test packages/games/sky-clash/tests/*.test.ts tests/registry-contract.test.ts tests/catalog.test.ts
npm run typecheck
# Optional game-only check (physical submodule path):
node_modules/.bin/tsc -p game-modules/packages/games/sky-clash/tsconfig.playable.json --noEmit
npm run build:isolated -- sky-clash-your-unique-run
npm run serve:isolated -- sky-clash-your-unique-run 4390
```

The isolated reference viewer under `lab/` remains available separately; it is not included as a development fixture in the normal game catalog. `tools/build_fox.py` generates Fox by default and Falco with `-- --falco`; `tools/verify_fox.py` reimports either export. Game source and assets belong to the `game-modules` repository. No staging, commits, pushes or publication are part of this change.
