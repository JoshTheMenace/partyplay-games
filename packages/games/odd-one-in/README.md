# Odd One In

A hidden-role house-party game for **4–10 players**, one shared display, and portrait phone controllers. The host can watch without taking a seat. No camera, microphone, physical gesture detection, remote assets, or music is required.

The format takes inspiration from [Jackbox’s official Fakin’ It description](https://www.jackboxgames.com/games/fakin-it). The identity, guest-badge artwork, questions, scoring, and phone answer flow here are original.

## How to play

1. Read your phone privately. Everyone receives the same question except the bluffer, who receives only a broad category and the same answer format.
2. Enter a whole number, tap a listed choice, or write up to 48 characters. Number controls also have increment/decrement buttons. Lock one answer; it cannot be changed.
3. All answers and the question appear together when everyone submits or the answer deadline expires. Explain your answer aloud.
4. Vote for another guest or explicitly abstain. Self-accusation is rejected. Each player can lock one vote per clue.
5. A strict majority of the **entire starting roster** must accuse the actual bluffer to catch them. Otherwise the same bluffer faces another question. After three unsuccessful ballots, the bluffer escapes.
6. The round result reveals the bluffer, point awards, and updated totals. A fresh role and questions follow automatically; final results include every participant. Rematch and return to the picker belong to the shared platform.

## Settings, timing, and scoring

`validateSettings({})` selects four rounds; the host can choose 3–6. The standard game targets 8–12 minutes, but early answers/catches can make it considerably shorter. Human pacing and balance have not been playtested.

Each clue allows 25 seconds to answer, 20 seconds to discuss, and 12 seconds to vote. Answer and vote phases end early if everyone submits. Discussion always gets its full timer. Round resolution lasts 10 seconds. Four completely unattended rounds finish within 12 minutes 4 seconds. No phase requires the host or a disconnected phone to advance it.

- Every correct accusation earns its voter 100 points, even when the group fails to reach consensus.
- The bluffer earns 100 points for each ballot survived, plus 200 for escaping all three clues. A complete escape earns 500.
- Points remain pending until round resolution so scores cannot identify a correct accusation during the round.
- Equal final scores share competition ranks: `1, 1, 3`. All tied leaders win; rows retain stable roster order.

Role assignment uses a seeded shuffled roster, then cycles through that order. Nobody receives the role twice before everyone has received it once; role counts differ by at most one. A four-round game with more than four players cannot give everyone a bluffer turn. The prompt deck is separately shuffled from the same deterministic stream and never repeats a question within a game. There are 54 server-only prompts: 18 number, 18 choice, and 18 short-answer questions.

## Missing players and ballot edge cases

An empty or whitespace-only submitted answer is rejected. If the deadline passes without an answer, the reveal shows “No answer.” Missing votes count as abstentions. Neither abstentions nor disconnections lower the majority threshold. Ties, a majority accusing an innocent player, and no-vote ballots each consume one of three attempts; they never restart a ballot.

Disconnection does not alter a role, reveal it, remove the seat, auto-forfeit, or skip the timer. A disconnected bluffer can still be accused, and can still earn survival points under the ordinary rules. Reconnecting restores only that authenticated player’s role, current question if eligible, locked answer, and locked vote. Transport authentication and reconnect credentials remain platform responsibilities.

## Code walkthrough and privacy

- `src/manifest.ts` is a standalone serializable `manifest`, with only shared-display mode and portrait controls declared.
- `src/types.ts` contains the public and private wire shapes and action types, with no prompt data.
- `src/content.ts` holds the 54 original questions. Only the server entry imports it.
- `src/server.ts` exports named/default `rules` implementing GameRules v1.0. It owns the seeded role/deck selection, phase deadlines, validation, score buffer, explicit projections, and deterministic outcomes. No sockets, timers, browser globals, or wall-clock randomness are allocated.
- `src/client.tsx` exports named/default `client`, using the actual shared ArcadeButton, Panel, Countdown, TextInput, Eyebrow, and StatusNotice components. The display shows simultaneous answer badges; phones show only their own secret and submission controls. Form state resets on each phase ID. Submission acknowledgements, pending states, rejected actions, and reconnect waiting are visible. Phone answers and vote selections persist in a scoped session draft until accepted.
- `src/art.tsx` contains the original illustrated living room, party guests, and badge avatars. Decorative characters do not represent hidden assignments; masked player avatars appear only at intentional resolution.
- `src/draft.ts` stores only the local player's own answer/vote draft, never a role or question. A phase ID prevents stale drafts carrying forward, and an old acknowledgement cannot clear a newer phase's draft. Blocked/full browser storage falls back to ordinary play.
- `src/styles.css` scopes every game class under `odd-one-in-`, preserves exact shared tokens/fonts, adds lime house and guest-badge artwork, and provides 44px minimum controls, focus rings, safe-area padding, scrolling space for keyboards, and reduced-motion rules.
- `tests/rules.test.ts` covers deterministic gameplay and serialization boundaries.

Actions carry a game-owned `turnId` containing the round, clue, and phase. The platform independently owns reliable transport `actionId` deduplication and round identity. Rules reparse every action and reject duplicate logical answers/votes even when resent with a fresh transport ID, obsolete clue IDs, illegal phases, unknown seats, invalid choices, out-of-range/nonfinite numbers, and actions at or after the deadline.

Public snapshots are explicitly constructed. Before the answer reveal they contain only the broad category, format, counts, and roster scores from finished rounds. They never contain the secret current question, answers, roles, pending score changes, role order, or future questions. Prior intentionally revealed clues are safe to review. At round resolution only the current bluffer identity and current point awards are intentionally revealed. Future roles and the deck never enter any projection. Unknown/spectator/watching-host player views return `null`.

## Validation (2026-09-08)

Run from the repository root:

```sh
node --import tsx --test packages/games/odd-one-in/tests/*.test.ts
node_modules/.bin/oxlint packages/games/odd-one-in
node_modules/.bin/tsc --noEmit
```

Results: **25/25 tests passed**, focused game lint passed with no warnings, focused strict TypeScript checks passed, and the final full workspace TypeScript check passed. The initial `tsx` CLI wrapper could not open its IPC pipe in the sandbox; using Node’s `--import tsx` loader ran the same tests successfully.

Coverage includes 4-, 5-, and 10-player normal games; six-round missing-input games; balanced roles; deterministic seeds; bounded catch-up; format validity; empty answers; duplicates; stale clues; exact deadlines; self-accusation; tied/wrong/no-vote consensus; scoring/ties; bluffer disconnect; own-private reconnect; pre-reveal packet privacy; intentional resolution reveal; and projection mutation isolation.

An actual browser-target esbuild bundle also compiled successfully. Its import metadata contained neither `server.ts` nor `content.ts`, and all 54 secret question strings were absent from the generated output. The bundle inspection is separate from the authorized browser evidence below.

## Platform integration and pending gates

No unresolved shared API or dependency needs were identified. The module uses `../../../party-contract/src/index` and `../../../party-ui/src/index`; it has no duplicate lobby, server, socket, UI kit, audio controller, or dependency installation. Platform registration, authenticated per-recipient projection delivery, action acknowledgements, the shared stylesheet/fonts, loading readiness, global results navigation, and game switching are owned by the platform task.

The current UI includes the completed Claude visual refinement: roster-aware full-answer cards, neutral private passes, compact short-phone controls, answer review during voting, distinct caught/escaped reveals, and complete shared-winner standings. Rules, scoring, deadlines and draft turn guards are unchanged.

Current evidence and exact build details: [visual refinement QA report](../../../output/claude-refinement/odd-one-in/qa-report.md). The real four-player game completed with 19 accepted answers, 20 accepted votes, a deliberate missing answer, two catches and one escape. The final build then passed a ten-player replay round with all ten answers/votes, retained original seats, reset scores, and a further accepted text answer at short portrait/landscape sizes. Earlier initial-build evidence remains in `output/playwright/odd-one-in/` as history.

Final layout checks cover all six required viewports, ten 16-character names and 48-character answers, very wide unbroken text, missing answers, caught/escaped outcomes, three-way and ten-way ties, and rank 10. Phone galleries may scroll; ballot selection and the lock action were verified together, including the final named choice and answer-review disclosure. Keyboard focus, reduced motion, same-turn drafts and accepted-state reloads passed. One Chromium browser with isolated contexts is not physical-phone, native-keyboard, Safari/Firefox, TV viewing-distance, screen-reader, sustained network-loss/load or human-balance evidence. Those checks remain pending. Music and git publication remain untouched.

## Later music integration

The game currently runs silently and allocates no audio resources. Suggested optional hooks, owned by the shared audio layer and deduplicated by `roundId + turnId`:

| Phase/event | Suggested cue |
| --- | --- |
| `answer` begins | Soft invitation rustle / quiet undercover-party loop |
| Own answer/vote accepted | Small badge stamp |
| `discuss` begins | Simultaneous card flip; music ducks under conversation |
| `vote` begins | Short suspicion cue |
| `resolution`, caught | Brief reveal sting |
| `resolution`, escaped | Playful getaway sting |
| `complete` | Short celebration |

Keep mute, user-gesture audio unlock, lifecycle cleanup, and game-switch teardown in the platform. No music was created or downloaded.
