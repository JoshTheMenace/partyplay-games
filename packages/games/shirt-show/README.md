# Shirt Show

A complete `shirt-show` game module for 3–10 players, a shared display and portrait phone controllers. The watching host uses no seat. The original pop-up print studio identity uses the shared coral accent, tokens, fonts, buttons, panels, DrawingPad and DrawingRenderer.

The format reference is [Jackbox's official Tee K.O. page](https://www.jackboxgames.com/games/tee-k-o): create art and words, shuffle them to other players, combine shirts and vote. This implementation has original content, identity, timing, bracket rules and scoring. It includes no Jackbox art, merchandise checkout, external upload, remote images or music.

## How to play

1. Each player draws two original doodles, one task at a time. Optional inspiration is private to that player's current task.
2. Each player writes two slogans, up to 72 characters each.
3. Everyone receives a private tray of two drawings and two slogans from other players. Select one of each and a cream, coral, sky or lime shirt.
4. All shirts reveal with three separate credits: designer, artist and slogan writer. Shirts enter the seeded tournament.
5. Vote for one of the two displayed shirts. Both competing designers sit out that vote. Artists and writers may vote. Eliminated designers continue judging every eligible matchup. Everyone can give one unscored cheer per matchup, including the competing designers.
6. The last shirt standing is champion. The final local gallery shows every shirt, all doodles and slogans including unused contributions, collaborator credits, scores and bracket history.

Submitted work locks; duplicate submissions are rejected even if a new transport action ID or draft revision is used. A Save draft button explicitly stores work on the server. Unsubmitted edits are also cached in this browser's session storage. If storage is unavailable, the controller and explicit server save still work.

## Settings and duration

`validateSettings({})` returns `{ pace: 'standard' }`. `quick` halves all timers. Invalid settings or extra keys are rejected.

| Task | Standard limit |
| --- | --- |
| Each doodle, twice | 120 seconds |
| Each slogan, twice | 60 seconds |
| Shirt assembly | 120 seconds |
| All-shirt reveal | 20 seconds |
| Each vote | `max(20, min(60, floor(180 / (players - 1))))` seconds |
| Each match result | 8 seconds |

At full deadlines, standard rounds take approximately 10.6–12.5 minutes across 3–10 players. Creation tasks and votes advance early when all required submissions arrive. Quick rounds take approximately 5.3–6.3 minutes at full deadlines. Reading, drawing and party pacing still need human playtesting.

## Ownership, fallback and scoring

- A seeded shuffle creates a ring of seats. Each seat receives slot-0 art from the next seat and slot-1 art from the second next seat; slogan routing reverses those offsets. Every contribution is assigned exactly once, both source seats differ from the designer, and each two-item category comes from two different seats, including at three players.
- The server assigns all owners from authenticated `playerId`; action ownership fields are rejected. Assembly must select one art ID and one slogan ID in the acting player's tray. Asset ownership grants attribution, not permission to build with an unassigned asset.
- At a deadline, saved nonempty drafts become contributions credited to their author. Missing or empty work becomes a local stock doodle or original stock slogan labeled **Studio stock**, with `owner: null`. No player is falsely credited for fallback material.
- A missing shirt submission uses the saved selection or the first item in each tray with a cream shirt. It remains in the bracket and is labeled auto-assembled. A disconnected player can recover their work through the authenticated private projection and continues to be included in results.
- A match win gives the **designer 100 points**. Winning the tournament gives the champion designer **300 additional points**. Artist and writer credit is separate and earns no points. Cheers do not affect votes, points or tie resolution.
- The first stage pares the field down to the next lower power of two. Its shuffled unpaired entrants receive byes. A bye grants advancement and **0 points**; later stages always pair an even field. There are exactly `players - 1` contested matches.
- Every shirt gets a unique, seeded tie-priority number shown at reveal. A tied vote, including 0–0 with no participating judges, advances the shirt with the lower number. Priority is fixed independently of votes and reused in later stages.
- Outcome contains every participant. Equal scores share competition rank (for example 1, 2, 2, 4), with original roster order for equally ranked rows. The champion is the only winner and has the highest score under this bracket.

## Privacy and bounds

`server.ts` holds the full state. `publicView` explicitly constructs the display/spectator projection; `playerView` builds only one authenticated seat's view. Both projections detach their arrays and objects before returning them.

Before reveal, public snapshots contain only phase/timing/progress and the roster, with no art, slogans, selections, starter bank, asset trays or ballots. During design, a phone receives just its two art and two slogan assignments. At reveal, chosen shirt content becomes public; unused contributions appear only in the final gallery. The tray mapping itself is never serialized publicly. Ballots are private during voting; results contain aggregate counts only. Host role does not grant extra private data.

The client imports public types only from `model.ts`; it never imports server rules or the server-only starter/fallback banks. A bundle test verifies representative secret bank strings and rule implementation symbols are absent.

Drawing validation and rendering use the shared schema: at most 24 strokes, 480 total points, finite normalized coordinates, supported bounded widths and six exact local ink colors. The server calls shared `parseDrawing`, including on saves. The final gallery contains at most 20 doodles, 20 slogans and 10 shirts; it renders bounded SVG strokes without remote assets. Each individual drawing action fits the shared 32 KiB inbound envelope. A full gallery snapshot is larger than one action; the current platform limits incoming messages and supports larger outgoing snapshots. Real-device bandwidth and rendering performance remain pending.

All game actions carry a game-owned `turnId`. Writes also carry a strictly increasing draft `revision`; duplicate/reordered saves, late actions, wrong phases, invalid seats, extra authority fields, invalid combinations and nonfinite input are rejected. Reliable transport action ID deduplication remains the platform's responsibility. Rules use injected clock/seed and no wall-clock or unseeded random calls. One expired stage advances per tick, preserving a readable reveal after a stalled clock rather than skipping the whole round.

## Code walkthrough

- `src/manifest.ts` declares the serializable `shirt-show` registration, honest player/mode limits and portrait orientation. It has no server imports.
- `src/model.ts` defines only public action/view and artwork types. Keeping this file separate lets the client typecheck without importing server content.
- `src/content.ts` is server-only: 24 original doodle starters, 20 original slogan starters and six missing-work slogans. Each creation task receives three optional suggestions.
- `src/server.ts` implements named/default `rules`. Parsing precedes every mutation. Creation phases collect work, the seeded ring builds private trays, and a queue plus advancing list implements a finite bracket. Projection functions specify exactly what each role sees.
- `src/client.tsx` implements named/default `client`: shared display, phone controller, settings, instructions and results. The controller remounts on game task/seat changes, displays acknowledgements/errors, and offers an explicit server draft save. The gallery reuses the same shirt component for champion, entries and previews.
- `src/draft.ts` bounds and validates session-storage recovery. Keys include room and seat; the saved envelope includes task and server revision. A newer server save outranks old local edits. Late acknowledgement cleanup only removes its own task's cache, preserving the next task's draft.
- `src/StudioArt.tsx` draws the original local SVG print shop and an outlined garment with collar, seams and hem. The display pairs studio art with the current task and submission progress.
- `src/styles.css` uses game-prefixed classes and shared tokens. Phone drawing actions stay in normal flow so they cannot cover the canvas; voting slogans sit outside small shirt thumbnails for readability. Short-display rules compact the workshop and place match credits beside shirts. Dense reveals use two rows for six to ten entries; ten-player scores use compact cards. Full slogans remain visible outside the decorative print, and the brief winner animation respects reduced motion. Controls meet a 44px CSS floor, labels and focus rings are explicit, safe-area padding is present, and decorative motion is disabled for reduced motion.
- `tests/rules.test.ts`, `tests/draft.test.ts` and `tests/client.test.ts` cover rules, recovery and static rendering/bundle privacy.

## Validation

From the repository root:

```sh
node --import tsx --test packages/games/shirt-show/tests/*.test.ts
node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --esModuleInterop --types node packages/games/shirt-show/src/client.tsx packages/games/shirt-show/src/server.ts packages/games/shirt-show/src/manifest.ts packages/games/shirt-show/tests/*.test.ts
node_modules/.bin/oxlint packages/games/shirt-show
```

2026-09-08: **27 tests passed**; focused strict TypeScript passed; focused Oxlint passed with no warnings. Coverage includes 90 seeded allocation cases at 3/5/10 players, 200 terminating brackets across every roster size, full submitted games, all-missing games, nonzero and zero-vote ties, every bye count, scoring/rank ties, deadlines, rejection without mutation, ownership, duplicate saves/submissions/votes, reconnect projections, local draft recovery and stale acknowledgements. Static React rendering covers all seven phases, the no-seat state, results, and a ten-player gallery with maximum-detail drawings. This is markup verification, not browser QA.

The direct `tsx --test` executable was blocked by a sandbox IPC `listen EPERM`. The equivalent `node --import tsx --test` command above passed without opening that IPC listener or requiring escalation. No Prettier, dependency installation, git mutation or publishing was performed by this game task.

## Integration, music and pending gates

No shared API changes are required. The platform owns registry imports, root configuration, readiness, one socket, LAN/QR, host controls, reliable action IDs, reconnect credentials, return-to-picker and rematch. Entries are `src/manifest.ts` (`manifest`), `src/server.ts` (`rules` and default), and `src/client.tsx` (`client` and default). Imports follow the actual shared contract and UI packages. No additional assets need preparing; `prepare`/`dispose` allocate no renderer or audio resources. Shared Countdown cleans up its own timer.

Suggested hooks for the user's later music: a quiet creation bed for `draw`/`slogan`, a print-press cue on `design → reveal`, an opening sting when `turnId` changes into `vote`, a short crowd cue for `match-result`, and a finale on `gallery`. Use the shared audio owner, gesture unlock, mute and disposal; deduplicate by task ID. No audio files or music were created or downloaded.

Authorized live Chromium QA used one watching host and three isolated phone contexts on port 4323. Three complete standard rounds used actual pointer drawings, typed slogans, shirt selection, eligible votes and cheers. Saved drawings, slogans and selections recovered after reload; submitted work stayed locked. Received projections preserved private trays. Rematch and return-to-picker retained all three seats. A subsequent quick round verified fresh state and correctly credited timeout slogans to Studio stock. See [QA evidence](../../../output/playwright/shirt-show/qa-evidence.md) for screenshots and repaired-layout verification.

All seven phases were captured at 320×568, 390×844, 844×390 and 667×375 phone sizes and 1280×720 and 1920×1080 display sizes. Measured phone controls met 44px, no horizontal overflow occurred, keyboard focus was visible and reduced-motion disabled decorative animation. Physical phones/TVs, touch-keyboard behavior, screen-reader use, ten-player live networking/performance and human gameplay pacing remain pending. Global build/test/registry validation belongs to the platform owner. The final gallery scrolls and lasts for the current in-memory round; there is no cross-session archive or server-restart persistence.

## Claude visual refinement

The user-approved default paired Opus review informed the current garment art, print typography, role-labelled credits, contest staging, compact phone choices and champion → scores → collection order. Advice was evaluated against the current shared components; no gameplay or draft-recovery logic changed. The platform owner separately clarified the shared drawing counter as “Ink detail”.

[Refinement advice and final browser evidence](../../../output/claude-refinement/shirt-show/advice-and-evidence.md) records the actual Claude response, accepted/rejected recommendations, screenshots and measurements. Live Chromium checks used three then ten isolated phone contexts, real pointer drawings, 72-character slogans, design choices, voting and cheering. At 720p the final ten-shirt reveal and all ten scores fit; both vote buttons fit all four required phone viewports with full slogans. Reload recovery, tied ranks, focus, reduced motion, replay and ten retained seats passed. The final gallery remains scrollable. Physical-device and measured performance limits remain as stated above. The isolated refinement browser and port-4334 server were closed after verification.
