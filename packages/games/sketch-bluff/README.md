# Sketch Bluff

A playable drawing-and-caption bluffing module for 3–10 players, with a shared display and portrait phone controllers. The watching host does not occupy a seat. The game uses original prompts and a night-gallery identity; the format reference is [Drawful 2](https://www.jackboxgames.com/games/drawful-2).

## How to play

1. Each phone receives a secret absurd prompt. Draw it without letters or numbers using the shared DrawingPad. Undo stroke, Clear and the ink palette are shared controls. Submit the drawing, or submit an empty canvas to skip it.
2. The gallery exhibits submitted drawings one at a time. Everyone except the artist writes a believable fake caption.
3. Everyone except the artist picks the real prompt from shuffled caption choices.
4. The reveal names the real caption, bluff authors, voters and points gained. The next exhibit starts automatically. After every gallery, the shared platform provides results, rematch and return-to-picker controls.

Drawings and captions persist through ordinary snapshot updates. Local session storage preserves an unfinished draft through reload on the same phone. **Save draft** also stores a private, bounded drawing on the server, allowing another authenticated device to resume it. Saved-only drawings are never exhibited: press **Submit drawing** to enter the gallery. Accepted submissions show acknowledgement and lock editing. Connection failures show a retry error; reconnect restores the server's accepted state. Save draft sends a complete drawing only when pressed; no drawing points are streamed.

## Scoring and duplicate captions

- Correct guess: **1,000** points to the voter.
- Convincing bluff: **500** points to each author for each *other* player who selects that bluff.
- Successful artist communication: **250** points to the artist per correct guess.
- No guess, skipped drawing or house decoy: no points. All phases use the same values.

Captions normalize Unicode compatibility characters, case and whitespace. Equivalent captions share one choice. Each coauthor receives the full bluff reward; the voter's own authorship is excluded. Self-voting is allowed but earns no bluff points from that vote. Keeping every choice available also avoids leaking which caption is correct through a special exclusion.

A submitted caption equivalent to the truth is accepted with the same acknowledgement as any other caption, then merged into the one true choice. It earns no bluff-author points. Its author may still vote, with ordinary correct-guess scoring. All labels are normalized and shuffled, and truth flags, authors and other players' votes remain server-only until reveal. House decoys fill the ballot to at least three unique choices when needed.

Results include every participant, including disconnected seats. Scores descend; equal scores share competition ranks (1, 1, 3). Roster order breaks presentation ties deterministically, and every tied leader is listed as a winner.

## Settings and progress

| Setting | Standard default | Short default | Accepted range |
| --- | --- | --- | --- |
| Galleries | 2 at 3–5 players; 1 at 6–10 | 1 | Determined by length and roster |
| Drawing time | 120 seconds | 60 seconds | 30–180, integer |
| Caption time per exhibit | 45 seconds | 25 seconds | 15–90, integer |
| Vote time per exhibit | 30 seconds | 20 seconds | 10–60, integer |
| Reveal time | 12 seconds | 8 seconds | Determined by length |

Standard targets about 10–15 minutes. Early submissions shorten phases; a full 10-exhibit game using every second can take 16.5 minutes. Short mode reduces galleries and timers. A shuffled server-only bank contains **60 original drawing prompts**, with no prompt repeated within a game.

Drawing/caption/vote phases finish early when all eligible seats submit. Disconnection never silently removes a seat or forfeits its private state. Each phase otherwise ends at its deadline; missing captions and votes abstain, while missing, saved-only or blank drawings skip. Even every player disconnecting leads to complete results. `tick` advances at most one phase per call, allowing the new phase its full duration after a delayed scheduler tick.

## Code walkthrough

- `src/manifest.ts`: standalone registration data, supported mode, orientation and player bounds.
- `src/types.ts`: only public/private projection and action types. No answer content.
- `src/content.ts`: original server-only prompts and fallback gallery decoys.
- `src/server.ts`: pure mutable rules with injected time and a seeded generator. Phase-specific turn IDs, parsing, seat/phase/deadline checks and one-submission guards prevent repeated effects. `buildChoices` merges equivalent labels before shuffling; `reveal` scores once; explicit projections prevent secret-state serialization. No sockets or browser globals.
- `src/client.tsx`: shared DrawingPad/DrawingRenderer, ArcadeButton, Panel, Countdown, TextInput and notices. A turn-keyed controller preserves drafts during snapshot updates while resetting controls for the next phase. Draft storage keys include game, round, seat and turn. Artist-colored frames and placards carry the artwork; display and phone ballot numbers match. Reveal chips name actual voters, personal results explain gains, and final standings use the platform's authoritative outcome, including every tied winner.
- `src/art.tsx`: the three original gallery illustrations and reusable player-color identity chips. Both opening and closing screens use the illustrations because the final public projection intentionally contains no drawing.
- `src/style.css`: game-prefixed gallery composition using the exact shared kp palette/font variables. Portrait forms scroll and reserve keyboard space. Buttons have a 44px floor, edge padding uses safe areas, and decorative transitions are disabled under reduced motion.
- `tests/rules.test.ts`: deterministic rules, scoring, secrecy and payload tests.

Client exports are named/default `client`; server exports are named/default `rules`; manifest is named `manifest`. Imports use the published party-contract and party-ui packages without a second protocol, lobby, drawing implementation or UI-kit copy. The platform owns reliable transport action IDs and retries. Rules additionally reject a second final drawing/caption/vote even if it arrives under a fresh transport ID; saved drafts remain editable before final submission.

## Validation

Run from the repository root:

```sh
node --import tsx --test packages/games/sketch-bluff/tests/*.test.ts
node_modules/.bin/oxlint packages/games/sketch-bluff
node_modules/.bin/tsc --noEmit --pretty false --strict --noUncheckedIndexedAccess --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --esModuleInterop packages/games/sketch-bluff/src/manifest.ts packages/games/sketch-bluff/src/server.ts packages/games/sketch-bluff/src/client.tsx packages/games/sketch-bluff/tests/rules.test.ts
node_modules/.bin/esbuild packages/games/sketch-bluff/src/client.tsx --bundle --platform=browser --format=esm --outfile=/tmp/sketch-bluff-client-check.js --metafile=/tmp/sketch-bluff-client-meta.json
```

Verified 2026-09-08:

- **19 tests passed**, including full standard games at 3/5/10, all-disconnected deadlines, duplicate/late/invalid actions, mixed scoring and ties, blank skips, payload limits and reconnect.
- Explicit JSON serialization tests exclude unrevealed prompts, caption authors, other players' captions/votes and another player's saved draft. Projection mutation cannot change authoritative drawing state.
- Maximum drawing payload fits the platform's 32 KiB envelope. Shared parsing enforces 24 strokes, 480 total points, six ink colors, finite coordinates and bounded widths.
- Focused TypeScript check (including `noUncheckedIndexedAccess`) and Oxlint pass.
- Browser-target bundle builds. Metafile inspection and a prompt sentinel confirm neither server.ts nor content.ts nor the prompt bank enters the client bundle.
- Root TypeScript and lint subsequently passed in the platform owner's coordinated refinement build; focused checks also pass for this module.
- `tsx --test` CLI initially failed to create its sandbox IPC socket; the equivalent `node --import tsx --test` command above passes without escalation.

No Prettier, git mutation, publication or music generation was performed. Browser QA was subsequently explicitly authorized and is recorded below. Because files are new/untracked, `git diff --check` does not provide a substantive new-file whitespace check.

## Integration and pending gates

No unresolved shared API dependencies. The platform owner confirmed the shared DrawingPad's 479-point/new-stroke boundary has been fixed centrally. The platform registry should load this directory's named/default exports; assets are local CSS and shared primitives, with no preparation fetches or persistent resources.

Browser-tested: watching host and three isolated player contexts joined through real UI; full three-exhibit game, rematch lobby and return to picker; drawing/caption draft reload; submitted drawing and vote reconnect; blank-caption gating and blank-drawing skip. Drawing/caption/vote views were inspected at 320×568/390×844/844×390/667×375, and gallery/voting at 1280×720/1920×1080. All measured phone views had no horizontal overflow and no button/input/select target below 44px. Caption keyboard focus had a 3px outline; reduced-motion emulation had zero active game animations.

Pending: physical phones/TV and software keyboards, touch rather than mouse emulation, ten-device load and performance, controlled transport loss/ack-retry tests, and switching to a different game then back. QR rendered and phone joining worked by URL; a physical QR camera scan was not tested. Drawing accessibility depends on the shared DrawingPad; no keyboard drawing alternative or accessibility certification is claimed.

## Music hooks for later

The module deliberately creates no sound. Suggested hooks are `publicView.phase` transitions: quiet gallery bed on drawing, a light cue when an exhibit enters caption, a short voting pulse, a reveal flourish, and a final-gallery close. `turnId` identifies each transition for cue deduplication; `reveal.gains` identifies scoring celebrations. Integrate through the platform's gesture unlock, mute and cleanup lifecycle, keeping speech and prompt reading unobstructed.


## Browser polish pass

Full evidence and inspected screenshots live in `output/playwright/sketch-bluff/qa-evidence.md`. The Playwright CLI used only the named `qa-sketch-bluff` browser, with an isolated built server on port 4321 and separate player BrowserContexts. The first real game finished with scores 3,000 / 2,250 / 1,500 after correctly rewarding guesses, bluffs and artists. A second real game verified explicit blank skips and accepted-vote reconnect.

The pass fixed a narrow-phone countdown wrap, replaced empty decorative frames with three original SVG gallery illustrations, strengthened ballot/reveal/standings hierarchy, tightened phone spacing, and moved the submitted count into the phase header to fit the 720p display. It also reproduced a 109.8px landscape pointer-to-ink offset in the shared DrawingPad and routed the measured issue to the platform owner for a square-surface fix. The shared header now leaves gameplay space available.

A shared browser-tool interruption closed all QA sessions mid-pass. Captured evidence was retained; this task reopened only its own named session and restarted only its own 4321 server to finish verification. This was tooling interruption, not a reproduced game failure.

Final rebuilt-client verification: landscape drawing surfaces are square at 253.5×253.5 (844×390 viewport) and 243.75×243.75 (667×375), with measured pointer-to-ink drift under 0.00001px. Final 1280×720 vote view has document size exactly 1280×720. Evidence: `output/playwright/sketch-bluff/verified-square-*.png` and `verified-vote-1280.png`; these were opened and inspected. The final rebuilt geometry-check round timed out its vote while screenshots were inspected, correctly completed with tied zero scores, then passed rematch and return-to-picker checks. Earlier two UI games verified scored voting and reveals.

## Claude visual refinement

Actual paired Claude review informed the implemented “Lit Wall” direction: player-colored gallery placards, matching numbered ballots, public-art thumbnails on phones, clearer reveal credits and gains, and outcome-aware winners/ties. The three original gallery illustrations moved into `art.tsx`; shared primitives and all rules remain unchanged. One-shot motion lasts at most 400ms and respects reduced motion without moving the drawing surface.

The final coordinated build (`index-CJtGJh45.js`, game `client-BFyvNKrU.js`) passed a real ten-seat game with nine 100-character bluffs, eight voters choosing one bluff, saved drawing/caption/vote reload, and same-seat replay. A separate all-skip round verified all ten tied winners and return to the picker. Dense voting/reveal devotes the display to artwork and full answers; standings return outside those phases. Both display viewports fit exactly, and all four phone sizes had no horizontal overflow or controls below 44px. Focus, reduced motion and zero pointer drift were verified. See `output/claude-refinement/sketch-bluff/qa-evidence.md` for screenshots, measurements, repair history and remaining physical-device limits.
