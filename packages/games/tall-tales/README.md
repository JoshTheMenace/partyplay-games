# Tall Tales

A playable bluffing game for 3–10 players, a shared display, and portrait phone controllers. The watching host does not need a seat. Tall Tales uses an oddities archive with grape specimen labels and original local SVG art. Its format reference is [Fibbage](https://www.jackboxgames.com/games/fibbage); all question wording, identity, decoys, code, and art here are original.

## How to play

1. Read an unusual factual sentence with a blank. File a short, believable false answer on your phone.
2. Pick the true answer from anonymous labels containing the truth, player lies, and two archive decoys. Your own label is disabled.
3. See who fooled whom, the correct answer, an explanation, and a source link. Repeat for six normal questions and a double-value finale.

Each normal question awards 500 points for identifying the truth and 300 to each bluff author for each rival who picks their bluff. Both awards double in question seven. There are no penalties or speed bonuses. Equal scores share competition ranks (1, 1, 3), and all tied leaders win. Results include every participant, including disconnected players and nonvoters.

Matching lies merge after case, accents, punctuation, articles, spacing and basic number words are normalized. Every author of a merged label receives the full bluff award for each eligible rival fooled; nobody can vote for a label they coauthored. This avoids arrival-order ownership and fractional rounding. A player who enters a truth alias gets a private rejection and may try again until the writing deadline, without a bonus or a consumed submission. Once a false answer is accepted it is locked. The server rejects another submission even if a new transport action ID is used.

Two curated false archive decoys are added without duplicate labels. If a player wrote one of those decoys, that label retains player ownership. With no lies, three choices still exist. Missing a writing deadline does not prevent voting; a missed vote scores nothing. Disconnects preserve the seat, scores, filed answer and vote, and never extend a deadline.

## Timing and settings

`validateSettings({})` returns `{ pace: 'standard' }`. These are the only settings:

| Pace | Write | Vote | Reveal | Full game |
| --- | --- | --- | --- | --- |
| standard | 45 s | 25 s | 15 s | 9 min 55 s |
| relaxed | 50 s | 30 s | 18 s | 11 min 26 s |

All submissions wait for the fixed deadline. This gives everyone the same writing/voting window and keeps the target duration stable. A delayed server tick opens one complete new phase window rather than skipping unseen phases, so a suspended server can lengthen the game. Seven questions are selected without repeats, with no more than one question from each source page to avoid one answer teaching another.

## Files and decisions

- `src/manifest.ts` is standalone registration metadata. Named `manifest` advertises only the implemented shared-display mode.
- `src/types.ts` contains the public action/view types; it has no content imports.
- `src/content.server.ts` holds 36 source-verified facts, aliases, explanations, source URLs and invented false decoys. This file is server-only. [Source ledger](SOURCE-EVIDENCE.md) records the checked pages and sections.
- `src/server.ts` exports named/default `rules` against GameRules v1.0. Seeded shuffling, injected time, phase legality, membership checks, answer normalization, merged ownership, scoring and outcome ranking live here. `tick` owns transitions. Rules allocate no timers, sockets or external resources.
- `publicView` explicitly constructs its snapshot. Writing shows only the current prompt and aggregate submission counts. Voting shows anonymous `{id,text}` labels, including the unmarked truth. Authorship, answer identification, voters, explanation and source appear only at reveal. Future questions and aliases never appear. `playerView` returns only the authenticated participant's own filed text, vote and owned option IDs; spectators get `null`.
- `src/client.tsx` exports named/default `client`, uses shared ArcadeButton/Panel/TextInput/Countdown/ToggleRow primitives, and supplies display, controller, settings, instructions and results views. Phone controls provide labels, pending/error states, explicit acceptance, own-lie disabling, and keyboard space. Unsent drafts persist in per-player session storage with round/turn matching and clear after filing or leaving the writing phase; server projections restore accepted submissions. A controller remounts by round/turn/phase so stale local acknowledgements do not lock a later phase. The shell owns reliable action IDs, reconnection notices, readiness, navigation and rematch.
- `src/styles.css` scopes all selectors under `tall-tales`, uses shared kp tokens/fonts, and includes safe-area padding, 48px phone controls, focus treatment, scrollable content and reduced motion. The decorative specimen is an original, colorful moth under glass in inline SVG and requires no downloads. Short landscape writing layouts place the question beside the form; narrow portrait layouts use tighter typography and spacing.
- `tests/rules.test.ts` covers the game lifecycle and exceptional cases. `tests/client.test.ts` bundles the actual browser entry and checks its dependency graph and emitted JavaScript for server content.
- `tsconfig.json` extends the shared root config and limits focused checking to this module plus its imported dependencies.

Truth equivalence uses curated aliases and deterministic spelling normalization, not a language model or unrestricted semantic matching. New facts should add ordinary alternate phrasings and test them. Exotic paraphrases outside that alias set are a remaining content limitation.

## Validation recorded 2026-09-08

Run from the collection root:

```sh
node --import tsx --test packages/games/tall-tales/tests/*.test.ts
node_modules/.bin/tsc --noEmit -p packages/games/tall-tales/tsconfig.json
node_modules/.bin/oxlint packages/games/tall-tales
```

All 20 tests pass; focused TypeScript and lint pass. Tests exercise 3, 5 and 10 players, full seven-question games, defaults and malformed settings, text bounds including Unicode expansion, each truth alias, duplicate submissions, early/late/wrong-turn votes, no lies, merged authors, decoy collisions, double-value scoring, zero/all-correct ties, deterministic ranks, reconnect projections, fresh rematch state and private serialization. The browser bundle test passes with no server bank/rules in its dependency graph and no question/source bank text in emitted JavaScript.

The initial root-wide typecheck found unrelated errors in the shared room server and Quiz Panic; these were reported to the orchestrator. Focused Tall Tales checks are independently clean. The tsx CLI itself could not create its sandbox IPC pipe; `node --import tsx --test` runs the same TypeScript tests without that CLI listener. `git diff --check -- packages/games/tall-tales` reported no errors, but this directory is untracked, so that command is not a substantive whitespace check of its new files.

Authorized browser QA now covers a full live three-player game, results, replay, picker return with retained seats, real reload recovery, all six specified viewports, input/ballot target sizes, keyboard focus, reduced motion and screenshot inspection. See [browser QA evidence](BROWSER-QA.md) for exact observations, artifacts, repairs and harness interruptions. Remaining gates are physical phones/TV and software keyboards, ten simultaneous browser clients, screen readers, human content/timing playtests, load/performance measurements and broader network fault testing.

## Integration and later music

No unresolved shared API additions or dependencies are needed. Imports use the published `party-contract` and `party-ui` source paths. The platform owns registry wiring, dependencies, assetsReady after mount, transport action IDs/acks, connected-state notices, room lifecycle, and returning everyone to the picker. It should catch thrown rule errors and privately return their message. All game actions carry `turnId`; the shell separately carries `roundId` and reliable action IDs. The platform tick must continue even when every participant disconnects.

No music or audio files are created, fetched or played. Suggested later hooks: writing opens → quiet archive bed; accepted lie → paper-stamp cue; voting opens → more tense bed; reveal → truth stamp and score accents; round seven opens → finale motif; complete → results cue. Trigger each phase cue once using `(roundId,turnId,phase)` and suppress replay on reconnect. Shared audio unlock, mute and lifecycle cleanup belong to the platform.

All work stays inside `packages/games/tall-tales/`. No dependencies installed by this task, no shared files edited, no source checkout edits, no Prettier, and no git mutations or publishing. Browser QA used only the subsequently authorized isolated runtime and session.
