# Melee fidelity requirements and reuse investigation

## Current scope

The user's latest instruction authorizes building a playable game from the best accessible research and reconstructing missing behavior instead of blocking. Original character tuning remains the priority. The earlier requirement to stop until exact parity can be established is superseded. Sky Clash is now registered as an in-progress, playable 33-fighter adaptation. New Blender models are explicitly authorized; Fable implements frontend and presentation animations.

The implementation preserves available scalar tuning and normal attack scripts for all 27 regular fighter forms while documenting approximate collision, common constants and special behavior. It does not claim a complete game rewrite or original balance. [README.md](README.md) describes the implemented controls and omissions.

## Verified source boundary

Inspected [doldecomp/melee](https://github.com/doldecomp/melee) at commit `d504219dba4a5c5350aecd8e2f4969adeacb8b72` on 2026-09-12. The research checkout is `/private/tmp/partyplay-melee-reference`; no source or game assets have been vendored into PartyPlay.

- The [README](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/README.md) describes an unfinished, nonportable GameCube decompilation targeting US 1.02 (`GALE01`). Its expected `main.dol` SHA-1 is `08e0bf20134dfcb260699671004527b2d6bb1a45`. Building requires extracted original executable data.
- [Fox initialization](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/kinds/ftFox/ftfox.c) names `PlFx.dat` / `ftDataFox`, costume archive `PlFxNr.dat` with joint and material-animation symbols, and animation archive `PlFxAJ.dat`. The C source contains action callbacks, not the complete character asset package.
- [Fighter data loading](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/ftdata.c) loads these external archives. [Common fighter initialization](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/fighter.c) loads `PlCo.dat` / `ftLoadCommonData`.
- [Fighter types](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/types.h) define per-character movement, jump, gravity, weight, and shield attributes. These declarations do not supply the archive values. [Hit resolution](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/ftcoll.c) also depends on common data, collision state, and attack parameters.
- No character `.dat` archives or model/texture assets were found in the research checkout. A disc image or extracted game filesystem has been requested from the user; none has been supplied or inspected yet. Published extracted gameplay data is now available for investigation as described below.

## Architecture and fidelity boundary

PartyPlay owns rooms, seats, readiness, input transport and replay. The new TypeScript rules own a 60 Hz fight with a 2D collision plane and a Three.js display. The original GameCube runtime is not included. Running the original executable or a complete animation evaluator would still be necessary to establish frame parity; neither is available here.

The held-input channel sends at 20 Hz and the fixed-step scheduler may discard excess catch-up steps. Press counters preserve short taps, but do not preserve their original intra-frame timing. The build has no rollback. Published attack commands run on a fixed simulation-frame timeline; visual Fable poses do not decide collisions. Missing bone transforms use explicit move anchors, so matchups and reach can differ despite retained damage and radii.

The earlier Bolt/Atlas experiment was replaced. Its old QA is historical and cannot establish parity or acceptance of the new Fox/Falco implementation.

## Blender fallback and published data audit

On 2026-09-12 the user authorized new models made in Blender if original models remain unavailable, while retaining the original stats and mechanics. The local Blender CLI was verified as 5.2.1 LTS. A replacement Fox pilot is now authored, rigged, exported and reimport-checked. See [the foundation README](fidelity/README.md).

The author of [meleeDat2Json](https://github.com/pfirsich/meleeDat2Json) publishes [character JSON dumps](https://melee.theshoemaker.de/?dir=dat-dumps). Downloaded and parsed [Fox.json](https://melee.theshoemaker.de/dat-dumps/Fox.json) into the consumer's ignored `output/melee-fidelity/Fox.json` for research. SHA-256: `4533034a5db1b2d7949763b196f5a9cb2361b567da8ba6f8ad7c5a898a55e98f`.

The file identifies `PlFx.dat` / `ftDataFox` and contains 97 attribute entries, 327 subactions, and subroutines. Values include weight 75, jump startup 3, and single-precision gravity approximately 0.23. Forty-five attribute names contain question marks. Some older descriptive names also differ from the current decompilation, so map by documented binary offset and semantics rather than by name alone. Preserve the original floating-point values; do not retune them to fit the old prototype.

This dump is useful evidence of accessible original tuning and attack scripts. It does not include a complete character-specific parameter bank, common `PlCo.dat` values, or the actual animation samples and skeleton needed to evaluate bone-attached collision. Its game revision has not been independently verified. The companion [frame-data extractor](https://github.com/pfirsich/meleeFrameDataExtractor) documents unhandled events and incomplete special-move naming, so its output is not sufficient to assert full gameplay parity. The pinned dump supplies both the preserved reference foundation and the playable rules. Falco is imported separately by the same documented offsets.


## Implemented foundation

The replacement Fox model and source-based helper layer are documented in [fidelity/README.md](fidelity/README.md). The importer preserves source command bytes, including 63 subroutines, and verifies the dump and decompilation header hashes. One concrete discrepancy was found: the published Fox jab radius is approximately 3.341176, while applying the decompiled `ftAction_8007121C` scale literal to its raw bytes gives approximately 3.327912. The implementation follows the pinned source calculation, not the published decoded float. Original executable comparison remains required.

## Playable roster import

[Falco.json](https://melee.theshoemaker.de/dat-dumps/Falco.json) identifies `PlFc.dat` / `ftDataFalco`. SHA-256: `5db4392df8e9fe288bb31eaea1d8f2191df1d893b7812b9b50b171934ce43e79`. `tools/import_roster.py` rejects changed dump/header hashes before writing either output. It maps the 47-field common prefix plus six landing-lag values by the decompiled offsets, and retains the 331 selected raw normal-attack scripts and their reachable subroutines in `fidelity/scripts.ts`. No original model archives have been downloaded.

The move compiler supports the waits, loops, calls, clears, charge markers, interruptibility and autocancel commands used by the selected normal attacks. It rejects unsupported gameplay control opcodes rather than silently interpreting them. Presentation commands and per-bone invulnerability flags are not implemented. Specials are explicitly reconstructed separately; their approximate timing is based on available action metadata, with authored travel/collision behavior.

The knockback expression follows the source's dependency structure. Common values (including 1.4, 18, .03 velocity conversion, .4 hitstun and .051 decay), hitlag, shield drain/damage, DI and charged-smash scaling are reconstructed and not verified against `PlCo.dat`. There is no original-executable regression oracle. The native-C vector tests verify only the ported scalar helpers.

## Full roster expansion (2026-09-12)

The pinned [FighterKind enum](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/ft/forward.h#L92) enumerates 33 actual kinds, indices `0x00` through `0x20`. `0x21` is the None/Max sentinel and is excluded. This yields 27 regular forms (including Sheik, Zelda and separate Popo/Nana), plus Master Hand, Crazy Hand, male/female wireframes, Giga Bowser and Sandbag.

All 27 regular public JSON dumps were retrieved from the publisher’s index. Their exact SHA-256, archive and node names are pinned in `fidelity/roster.json`. The reproducible importer reads scalar values by offsets and retains float precision; none of these dump revisions has been independently verified. Nana’s own nameless action table is matched by index to Popo’s shared animation table. Aliases such as AttackS31/AttackS3 and AttackS4S/AttackS41 resolve different normal-animation naming conventions. Peach’s first non-damaging forward-smash selector is skipped in favor of the first damaging weapon variant.

The publisher labels opcode 5 as goto and 7 as subroutine. The pinned [lbcommand.c](https://github.com/doldecomp/melee/blob/d504219dba4a5c5350aecd8e2f4969adeacb8b72/src/melee/lb/lbcommand.c) implements 5 as call/return and 7 as goto. The compiler follows the C implementation, with recursion/command budgets, and applies opcode 12/13 damage/radius edits without mutating earlier windows. Per-bone invulnerability remains unimplemented.

The six bonus profiles have no corresponding public parameter dumps in the inspected index. They borrow the regular profile named in roster.json and use authored stock-match bodies/special kits; they do not claim boss-AI or original bonus-entity parity. Regular specials are likewise reconstructed in a separate file rather than presented as sourced normal data. Models and portraits were authored in Blender, not downloaded from the original game.

## Versus stage roster

[STAGES.md](STAGES.md) records all 29 standard versus GrKind entries and their 29 authored counterparts; Cloudbreak remains the 30th choice. Original stage DAT archives and exact collision coordinates were not available. All stage geometry, motion, hazard cycles and scenery are newly authored. The mapping excludes adventure routes, target tests, debug maps, unused kinds and enum sentinels. The shared stage clock drives server collision and Three.js presentation.
