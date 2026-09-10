# Quip Clash

An original comedy club game for 3–10 players, one shared display and portrait phone controllers. The watching host takes no player seat. The module uses GameRules v1.0 and the collection's room, reliable actions, reconnect, settings and results shell. No independent server, lobby, music or remote assets.

## How to play

1. Each player writes and locks two answers to everyday absurdity prompts. Save draft preserves unfinished text for reconnect; only Lock answer enters a joke into the show.
2. Answers face off anonymously. Everyone except the two authors can vote once. Votes remain hidden until the ballot closes, when authors, voter names and awarded points appear with the answers. A complete ballot closes after at least 3.5 seconds; otherwise it waits for the voting deadline.
3. Play two writing rounds, followed by the Double Encore finale. In the finale everyone receives the same prompt and writes two different punchlines, each facing a different opponent. Each entry appears once, so an earlier reveal cannot expose the author of a reused entry.
4. Final results include every participant. The shared host controls handle rematch and return to the picker.

Every round shuffles the roster into a cycle. Each edge is one matchup, giving every player exactly two writing slots and two appearances, including odd rosters. Match order and answer sides are also seeded and shuffled. Opponents can repeat across rounds. Regular rounds use a different prompt on each edge; the finale uses one common prompt. Each game draws 2N+1 distinct prompts from 72 original, family-friendly server-only prompts.

## Scoring and missing players

Each vote earns its answer 100 points. An outright matchup win adds 200 points. Multiply both by 1 in round 1, 2 in round 2 and 3 in the finale. For example, a 2–1 round-2 result pays 800 points to the winner and 200 to the other answer.

A tie pays only vote points, with no win bonus. A ballot with no votes pays zero. If either answer is missing, the matchup immediately skips voting and reveals for zero points on both sides. Missing text remains `null`; display copy saying “No answer submitted” is never a player entry. Drafts do not auto-submit. Disconnected participants keep their slots, locked answers, scores and saved drafts; deadlines move the game forward without them. Late submissions and votes at the exact deadline are rejected.

Votes and answers lock once even when a client sends a new transport action ID. The platform owns deduplication/retry of identical reliable envelopes; rules independently reject a second submission or vote. Scoring runs only through a guarded reveal transition. Equal final scores share competition ranks (1, 1, 3), and all top-scoring participants are winners, including an all-zero game.

## Settings and pace

| Setting | Default | Allowed |
| --- | --- | --- |
| Writing seconds | 100 | Integer 30–150 |
| Voting seconds | 0 (automatic) | 0 or integer 8–30 |
| Reveal seconds | 6 | Integer 4–12 |

Automatic voting is `clamp(round(80 / players), 8, 25)` seconds. At default deadlines, a fully populated game takes about 9.7–12 minutes across 3–10 players. Writing advances when everyone submits, and ballots close once everyone eligible votes after a 3.5-second minimum, so fast groups finish sooner. Missing matchups also shorten play. A delayed server tick starts the next phase with a fresh full deadline; it does not skip multiple phases. Custom timer choices can exceed the default target.

## Code walkthrough

- `src/manifest.ts`: serializable metadata, 3–10 seats, shared-display support and portrait controllers. No runtime server imports.
- `src/content.ts`: 72 original prompts, imported only by the server.
- `src/types.ts`: action and projected-view shapes shared with the client. Every action carries a phase-specific `turnId`; writing also carries its assigned `questionId`.
- `src/server.ts`: settings/action validation, seeded shuffle, cyclic pairing, deadlines, scoring and explicit public/private projections. State has no external resources. Public projections contain aggregate writing progress, then only the current matchup; private projections contain only the authenticated player's own prompts/drafts/answers and vote eligibility. Reveals copy authors/voters/points so callers cannot mutate authoritative state.
- `src/client.tsx`: shared-display cue cards, phone answer forms, voting, settings, instructions and results. Shared `ArcadeButton`, `Panel`, `Countdown`, `Eyebrow` and `StatusNotice` provide the common controls. Separate per-question state preserves typing between snapshots; pending sends disable repeat clicks and display accepted/rejected acknowledgements.
- `src/styles.css`: game-prefixed comedy-club/cue-card art using shared sun, ink, navy, cream, fonts and type helpers. Portrait forms scroll for the software keyboard, use visible labels/focus, reserve safe areas and keep controls at least 44px. There are no decorative animation loops; reduced motion disables inherited game-surface motion.
- `tests/rules.test.ts`: deterministic rules, legality, lifecycle, projection privacy, reconnect, scoring and content-boundary checks.

Only explicitly saved drafts survive a full page reload/reconnect remount. Unsubmitted edits stay in local form state while the controller remains mounted. Saving a draft acknowledges it separately from locking an answer. Player-written text is rendered as React text, never HTML; original prompt content is family-friendly, but user-entered jokes are not automatically moderated.

## Validation

Run from the repository root (no Prettier):

```sh
node --import tsx --test packages/games/quip-clash/tests/*.test.ts
node_modules/.bin/oxlint packages/games/quip-clash
node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node packages/games/quip-clash/src/manifest.ts packages/games/quip-clash/src/server.ts packages/games/quip-clash/src/client.tsx packages/games/quip-clash/tests/rules.test.ts
```

The direct Node loader avoids the `tsx` CLI's sandbox-blocked IPC listener. Final local checks: 15 tests pass, focused strict TypeScript passes, Oxlint passes with no warnings. Tests cover complete normal games at 3/4/7/10, equal writing/appearance counts, separate finale entries, self-vote and duplicate rejection, wrong/late actions, settings bounds/NaN, tied and empty ballots, all-disconnected progression, missing/draft answers, reconnect privacy, staged serialized projections, detached view data, deterministic content and server-only import boundaries.

An in-memory esbuild browser bundle passed with no server/content import or prompt-bank sentinel. The platform owner completed collection-wide typecheck, lint and the coordinated Vite build. The visual refinement preserved the original hashes of server.ts, types.ts, content.ts and manifest.ts.

Browser verification covers writing, anonymous voting, named reveals and results at 1280×720 and 1920×1080, plus 320×568, 390×844, 844×390 and 667×375 controllers. Checked horizontal overflow, visible keyboard focus, minimum 44px controls, reduced motion, saved-draft recovery, full three-round progression and same-room rematch. The collection owner also verified Quip → Sketch → Quip with the existing seats. Detailed final build identifiers and evidence live in [the refinement report](../../../output/claude-refinement/quip-clash/advice-and-decisions.md).

Physical phones/software keyboards, television viewing distance, screen-reader navigation and ten-device performance remain unverified. No git staging, commits, pushes, PR changes or deployment were performed.

## Integration and later music

Registry entries are `manifest` from `src/manifest.ts`, named/default `rules` from `src/server.ts`, and named/default `client` from `src/client.tsx`. Imports use the actual `party-contract` and `party-ui` source paths. No unresolved game-specific shared dependency or contract change is needed. The platform must keep server imports out of its client registry and send public-only snapshots to host/spectators.

Suggested future sound hooks, owned by the user's later music work: writing start (gentle comedy-club bed), voting start (short cue-card flip), accepted lock (quiet confirmation), last five seconds (subtle clock), reveal winner/tie/missing (distinct brief cues), finale writing (encore sting), final results (closing applause). Key cues by `turnId` plus `phase`, respect the platform mute/audio-unlock controls, and stop on abort/switch. This module currently creates no audio, subscriptions, renderer resources or module timers; `prepare`/`dispose` are intentionally empty and the shared countdown cleans up its own interval.

## Claude visual refinement

The user-requested ask-claude review completed in the paired main Opus session. It informed a compact phase marquee, an original SVG comedy-club scene, segmented aggregate writing progress and cream answer cards. The shared palette, fonts, panels and controls remain the visual foundation.

In `client.tsx`, `AnswerCard` keeps both draft forms mounted and distinguishes empty, saved and locked states; empty submission now explains what to do. `RevealRecap` presents personal points on phones using existing projections. Results name every authoritative winner and preserve equal ranks. `DisplayView` selects denser spacing above six players so ten-player standings and named voters fit the TV layout.

In `styles.css`, short landscape phones place the prompt beside its input so the first answer controls remain visible. The TV stage height is capped at large viewports, long answer text stays readable, and large rosters use compact standings and voter grids. Safe areas, keyboard focus and reduced motion are retained. The [refinement report](../../../output/claude-refinement/quip-clash/advice-and-decisions.md) records accepted and declined Claude advice, inspected screenshots and validation limits.
