# Tall Tales browser QA

2026-09-08. Authorized real Chromium QA through the Playwright CLI skill, named session `qa-tall-tales`, isolated built server on port 4322. One watching host and three independent browser contexts (Mira, Jonah, AlexandriaLong), so reconnect credentials never overlapped. No game state or server clock was injected. Inputs, votes, readiness and replay used visible UI controls. Standard real timers were retained.

## Completed gameplay

- Created room 4YYLJZ, selected Tall Tales, joined three players, readied all phones and started a full seven-question game.
- Entered `male` on the seahorse pregnancy question: the server rejected it privately as truth and allowed a replacement. All three submitted real false answers.
- Duplicate authors saw the same merged label disabled on both phones. On question two, both chose the truth and fooled the third player: each earned 800 (500 + 300). Reveals named both authors and the fooled voter.
- Completed the finale with both coauthors choosing the truth and the third choosing their shared lie. Each coauthor gained 1600. Results: Jonah 3600, Mira 3300, AlexandriaLong 600. All three appeared in results. The first question's vote window elapsed during investigation; later questions received real votes. This also exercised missed-vote progress.
- Used Play again, readied the same phones, and started a fresh round in the same room. All scores reset to zero and the previous draft was absent. No new joins or rescan were needed.
- After the harness recovery, ended a QA round through Room menu → End round → Confirm, then Back to picker → Confirm. Room 82TXFC retained all three named, connected seats; every phone showed waiting for the host’s next game. `returned-picker.png` records the result.
- An unsent `archival dust bunnies` draft survived reload after repair. The same text survived viewport changes. Filed lies and filed votes each survived separate real reloads and returned with their acknowledgement.

## Visual repairs

The initial shared header duplicated the game title and consumed roughly 270px before gameplay. This was reported to the platform owner, who compacted the shell. Game-owned fixes added a brighter original moth-under-glass specimen, clearer writing-card hierarchy, private draft persistence, tighter narrow-phone spacing, two-column short-landscape writing, and a compact shared-display reveal layout. Buttons/panels/fonts/tokens still come from the shared UI contract.

Screenshots live under `output/playwright/tall-tales/` and were opened and visually inspected. Final writing captures are `phone-320x568.png`, `phone-390x844.png`, `phone-844x390.png`, `phone-667x375.png`, `display-1280x720.png`, and `display-1920x1080.png`. `voting-320x568.png` and `voting-390x844.png` show a live finale ballot. `phone-keyboard-focus.png` shows keyboard focus. `results-1280x720.png` and `results-phone.png` show the completed game. `reveal-final-1280x720.png` shows the repaired six-option live reveal with all authors, voters, truth and scores visible; its content ended at y=621. `returned-picker.png` shows the retained roster after returning to the collection. `display-before-1280.png` and `phone-before-390.png` preserve the initial findings.

| Check | Observed result |
| --- | --- |
| 320×568, 390×844, 844×390, 667×375 | Document width equaled viewport width; no horizontal overflow. Final writing CTA visible at all four sizes. Short-landscape question and form sit side by side. |
| 1280×720, 1920×1080 | No horizontal overflow; complete writing content ended at y=664 and y=640 respectively. |
| Final six-option reveal, 1280×720 | No horizontal overflow; all six options, explanation/source, prompt and scores fit, with content bottom y=620.9. |
| Form targets | Input 53.6px high; submit 65px. |
| Ballot targets | 51.5px high, or 73px for the wrapped disabled own-lie option at 320px. |
| Accessible controls | Input has an associated visible label; buttons have visible text. Own lies are labelled and disabled. |
| Keyboard focus | Tab from input focused submit with a visible cream 3px outline. |
| Reduced motion | Emulated reduced motion; no active decorative animation names in the game subtree. |
| Phone scrolling | Vertical scrolling is intentional for long ballots/reveals and software-keyboard space; no forced landscape. |

## Commands and limits

```sh
PORT=4322 node dist/server.mjs
/Users/joshthemenace/.codex/skills/playwright/scripts/playwright_cli.sh --session qa-tall-tales open http://localhost:4322 --headed
/Users/joshthemenace/.codex/skills/playwright/scripts/playwright_cli.sh --session qa-tall-tales run-code --filename output/playwright/tall-tales/play-step.js
/Users/joshthemenace/.codex/skills/playwright/scripts/playwright_cli.sh --session qa-tall-tales run-code --filename output/playwright/tall-tales/viewport-check.js
node --import tsx --test packages/games/tall-tales/tests/*.test.ts
node_modules/.bin/tsc --noEmit -p packages/games/tall-tales/tsconfig.json
node_modules/.bin/oxlint packages/games/tall-tales
```

The two CLI helper functions operate on an already-created host plus three independent phone contexts; they are QA drivers, not application code. All 20 deterministic tests, focused typecheck and lint pass after repairs.

A shared Playwright daemon interruption closed this and other owners' browser contexts around 17:21. No close-all/kill-all/reset commands were issued by this task. Recovery restarted only this task's port4322 process because the temporary host context was lost. The coordinated Vite rebuild also invalidated an old dynamic chunk URL; a deliberate host reload recovered once the coherent build was ready. These are recorded harness/concurrent-build events, not attributed to game logic.

No physical phones, TV, native software keyboard, ten-browser-client load, screen reader or performance benchmark was tested. Maximum roster/rank/privacy behavior is covered by deterministic tests, not a ten-device browser claim. Human content difficulty and timing playtests remain pending. No music, git operations or publication occurred.

Cleanup: closed only the named `qa-tall-tales` browser session and stopped only its isolated port4322 server process. Other owners’ browsers and servers were not touched.
