# Melee fidelity requirements and reuse investigation

## Current scope

Sky Clash v2 (2026-09-24) rebuilds the game around the Melee content: all 33 fighter kinds, the 27 regular fighters' imported attributes and attack command streams, and 30 stages. The user asked to keep that content and rebuild everything else. The engine, CPUs, specials, Blender models, animation, effects, stage art and UI are new. Where Melee behaviour could not be recovered, the code reconstructs it and says so in a comment. Nothing here claims frame parity. [README.md](README.md) covers play and limits.

## Verified source boundary

Inspected [doldecomp/melee](https://github.com/doldecomp/melee) at commit `d504219dba4a5c5350aecd8e2f4969adeacb8b72` on 2026-09-12. The research checkout is `/private/tmp/partyplay-melee-reference`; no source or game assets have been vendored into PartyPlay.

- The [README](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/README.md) describes an unfinished, nonportable GameCube decompilation targeting US 1.02 (`GALE01`). Its expected `main.dol` SHA-1 is `08e0bf20134dfcb260699671004527b2d6bb1a45`. Building requires extracted original executable data.
- [Fox initialization](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/kinds/ftFox/ftfox.c) names `PlFx.dat` / `ftDataFox`, costume archive `PlFxNr.dat` with joint and material-animation symbols, and animation archive `PlFxAJ.dat`. The C source contains action callbacks, not the complete character asset package.
- [Fighter data loading](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/ftdata.c) loads these external archives. [Common fighter initialization](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/fighter.c) loads `PlCo.dat` / `ftLoadCommonData`.
- [Fighter types](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/types.h) define per-character movement, jump, gravity, weight, and shield attributes. These declarations do not supply the archive values. [Hit resolution](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/ftcoll.c) also depends on common data, collision state, and attack parameters.
- No character `.dat` archives or model/texture assets were found in the research checkout. A disc image or extracted game filesystem has been requested from the user; none has been supplied or inspected yet. Published extracted gameplay data is now available for investigation as described below.

## Architecture and fidelity boundary

PartyPlay owns rooms, seats, readiness, input transport and replay. `src/server.ts` and `src/sim/` run a 60 Hz fight on a 2D collision plane, and the display draws it with three.js. The original GameCube runtime is not included, and no original executable or animation evaluator was available to compare against.

Phones send held input at 20 Hz. Monotonic press counters keep short taps, but not their timing inside a frame, so the engine buffers every press for 8 frames. There is no rollback. Move windows run on the simulation frame timeline, and the animation reaches toward the published live hitboxes. Poses never decide collisions. Hitboxes on non-root bones use an authored anchor model (see `src/moveset.ts`), so reach can differ from Melee even though damage, angles, knockback and radii are the imported values.

## Blender fallback and published data audit

On 2026-09-12 the user authorized new models made in Blender if original models remain unavailable, while keeping the original stats and mechanics. All 33 fighters now come from the v2 Blender 5.2 pipeline in `tools/blender/` (see its README). `validate.py` checks each GLB against the rig contract in `src/model.ts`, and the models are new work, not extracted geometry.

The author of [meleeDat2Json](https://github.com/pfirsich/meleeDat2Json) publishes [character JSON dumps](https://melee.theshoemaker.de/?dir=dat-dumps). Downloaded and parsed [Fox.json](https://melee.theshoemaker.de/dat-dumps/Fox.json) into the consumer's ignored `output/melee-fidelity/Fox.json` for research. SHA-256: `4533034a5db1b2d7949763b196f5a9cb2361b567da8ba6f8ad7c5a898a55e98f`.

The file identifies `PlFx.dat` / `ftDataFox` and contains 97 attribute entries, 327 subactions, and subroutines. Values include weight 75, jump startup 3, and single-precision gravity approximately 0.23. Forty-five attribute names contain question marks. Some older descriptive names also differ from the current decompilation, so map by documented binary offset and semantics rather than by name alone. Preserve the original floating-point values; do not retune them to fit the old prototype.

This dump is useful evidence of accessible original tuning and attack scripts. It does not include a complete character-specific parameter bank, common `PlCo.dat` values, or the actual animation samples and skeleton needed to evaluate bone-attached collision. Its game revision has not been independently verified. The companion [frame-data extractor](https://github.com/pfirsich/meleeFrameDataExtractor) documents unhandled events and incomplete special-move naming, so its output is not sufficient to assert full gameplay parity. The pinned dump supplies both the preserved reference foundation and the playable rules. Falco is imported separately by the same documented offsets.


## Implemented foundation

The source-based helper layer is documented in [fidelity/README.md](fidelity/README.md). The importer preserves source command bytes, including 63 subroutines, and verifies the dump and decompilation header hashes. One concrete discrepancy was found: the published Fox jab radius is approximately 3.341176, while applying the decompiled `ftAction_8007121C` scale literal to its raw bytes gives approximately 3.327912. The implementation follows the pinned source calculation, not the published decoded float.

## Playable roster import

[Falco.json](https://melee.theshoemaker.de/dat-dumps/Falco.json) identifies `PlFc.dat` / `ftDataFalco`. SHA-256: `5db4392df8e9fe288bb31eaea1d8f2191df1d893b7812b9b50b171934ce43e79`. `tools/import_roster.py` rejects changed dump/header hashes before writing either output. It maps the 47-field common prefix plus six landing-lag values by the decompiled offsets, and retains the 331 selected raw normal-attack scripts and their reachable subroutines in `fidelity/scripts.ts`. No original model archives have been downloaded.

v2 extends the import to every combat subaction (`fidelity/actions.ts`, from `tools/import_moves.py`): specials and their air variants, dash attacks, grabs, pummels, throws, ledge and getup attacks, dodges and taunts. `src/moveset.ts` compiles them. It supports waits, loops, calls, gotos, hitbox edits, charge markers, IASA, autocancel, throw data and release, and it rejects unsupported gameplay opcodes instead of guessing. Presentation commands and per-bone invulnerability are not implemented. Special behaviour (projectiles, travel, reflectors and so on) is reconstructed as data in `src/specials/` on top of the real script windows.

The knockback expression follows the source's dependency structure. Common values (including 1.4, 18, .03 velocity conversion, .4 hitstun and .051 decay), hitlag, shield drain and damage, DI and charged-smash scaling are Melee's widely documented values. The pinned decompilation checkout was empty during the v2 rebuild, so they were not re-read from source, and none are verified against `PlCo.dat`. There is no original-executable regression oracle. The native-C vector tests verify only the ported scalar helpers.

## Full roster expansion (2026-09-12)

The pinned [FighterKind enum](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/forward.h#L92) enumerates 33 actual kinds, indices `0x00` through `0x20`. `0x21` is the None/Max sentinel and is excluded. This yields 27 regular forms (including Sheik, Zelda and separate Popo/Nana), plus Master Hand, Crazy Hand, male/female wireframes, Giga Bowser and Sandbag.

All 27 regular public JSON dumps were retrieved from the publisher’s index. Their exact SHA-256, archive and node names are pinned in `fidelity/roster.json`. The reproducible importer reads scalar values by offsets and retains float precision; none of these dump revisions has been independently verified. Nana’s own nameless action table is matched by index to Popo’s shared animation table. Aliases such as AttackS31/AttackS3 and AttackS4S/AttackS41 resolve different normal-animation naming conventions. Peach’s first non-damaging forward-smash selector is skipped in favor of the first damaging weapon variant.

The publisher labels opcode 5 as goto and 7 as subroutine. The pinned [lbcommand.c](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/lb/lbcommand.c) implements 5 as call/return and 7 as goto. The compiler follows the C implementation, with recursion/command budgets, and applies opcode 12/13 damage/radius edits without mutating earlier windows. Per-bone invulnerability remains unimplemented.

The six bonus profiles have no corresponding public parameter dumps in the inspected index. They borrow the regular profile named in roster.json and use authored special kits in `src/specials/bonus.ts`. They do not claim boss AI or original bonus-entity parity. Models, portraits and renders were made in Blender, not downloaded from the original game.

## Versus stage roster

[STAGES.md](STAGES.md) maps the 29 standard versus stages plus Cloudbreak, the original 30th. Original stage DAT archives and exact collision coordinates were not available. v2 rebuilt every layout in Melee units: the six tournament stages use community-documented widths, platform heights and blast zones, and the other 24 are Melee-scale estimates. Motion, hazard cycles and scenery are new work. One stage clock drives both the server collision and the three.js art, and the art kit builds floors and walls from the same blocks.
