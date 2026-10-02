# Quiz Panic

Spooky survival trivia for 2–10 players in the **Hotel Hijinks**, a cartoon haunted hotel run by Mr Grimsby, a skeletal
concierge. The art uses damask wallpaper, candle sconces, cobwebs, green ghost glow and a lumpy green ghoul. Every name,
question, category, character, SVG and line of narration is original.

## Rules

1. **Nine trivia questions.** Each has four options and a 15 s timer (scaled by the pace setting). Each question comes
   from a different category. You lock one answer; living players and ghosts both answer.
2. **Reveal.** The TV shows who picked what, then the right answer, then the cash, then the Panic Room call.
3. **Money.** A right answer pays **$1,000**. If you are the *only* player who got it right, it pays **$1,500**. Ghosts
   earn money too.
4. **Panic Room.** Living players who answered wrong, or didn't answer, are *doomed*. Offline players who never answered
   are skipped. All doomed players face one challenge at once, straight after the reveal. If everyone is wrong, everyone
   faces it. Challenges come from a shuffled bag, so all six turn up before any repeats:
   - **Poison Punch.** There are doomed + 1 cups. Each living survivor secretly poisons one cup. If nobody poisoned a
     cup, or nobody is safe, the ghoul poisons one cup at random. There is always at least one safe cup: if every cup was
     spiked, one is quietly made safe. Each doomed player then picks a cup (a missing pick gets a random cup). Drinking
     poison means death.
   - **Mad Math.** Three quick sums (+, −, ×) on a phone keypad in 20 s. Any wrong or missing answer is fatal.
   - **Memory Lane.** The TV flashes five labelled symbols for exactly 5 s, never the same symbol twice in a row. You
     tap them back in order in 15 s, and only an exact repeat survives.
   - **Hide & Shriek.** Pick one of six rooms in 12 s (a missing pick gets a random room). The ghoul searches 2–3 random
     rooms, and anyone found dies.
   - **Scramble.** Each doomed player gets a private spooky word as letter tiles. You have 20 s and three tries.
   - **Coin of Fate.** Call heads or tails for each flip (8 s per call; a missing call is made at random). Win two flips
     out of three to live; lose two and you die.
5. **Ghosts.** Dead players become ghosts: a mint, floating avatar that fades at the hem. Ghosts keep answering for cash
   but can never die again.
6. **Escape the Hotel (final).** The track runs from the Lobby (0) to the EXIT (10).
   - **Start.** Living players start on space 2, plus a money-rank bonus: richest +2, second +1. Ghosts start in the
     Lobby. If nobody is alive, the richest ghost(s) get a body back.
   - **Each turn.** The TV shows a category and three items, 1–3 of which fit. Every right pick moves you 1 space; a
     single wrong pick means you move 0 that turn. You have 15 s.
   - **Swaps.** After moving, any ghost now *past* the last-place living player swaps bodies with them: the ghost
     revives and that player becomes a ghost.
   - **Escape.** The first living player to reach the EXIT escapes and wins. Ties go to the most money, and a full tie
     shares the win.
   - **The ghoul.** It creeps forward one space per turn from turn 2. Living players on or behind its space become ghosts.
   - **Time limit.** After 8 turns, the furthest living player wins (ties by money). If nobody is left alive, the
     furthest player overall wins.
7. **Result.**
   - **Winners** are the escapees (or the furthest player, as above).
   - **Score** is money plus an escape bonus for the winners. The bonus is at least $5,000, topped up so the winner
     always heads the podium.
   - **Awards:** Survivor (the only player who never died), Big spender, Panic Room regular (most challenges survived,
     at least 2), Body snatcher, First to fall.

## Pacing

- **Question:** 15 s, ending early once everyone is in (after 1.5 s).
- **Answer reveal:** 6.9 s, or 8.6 s when someone is doomed.
- **Panic Room:** intro 7 s, then the challenge stages, then the reveal. The reveal takes about 1 s per cup or player,
  1.7 s per searched room, plus a 5 s verdict.
- **Final:** an 11 s intro, then turns of 15 s plus an 8.2 s reveal.

A bot game runs 3.3–5.3 min, because bots answer instantly. With human answer times, expect 8–12 minutes.

## Content (`content.server.ts`)

- **313 trivia questions** across 17 categories: 297 family and 16 adult (bar trivia, tagged and filtered when
  `settings.family`).
  - Each question has exactly one right answer and three plausible wrong ones. The server shuffles the options.
  - The longest question is 86 characters and the longest option 26. Tests cap them at 110 and 32.
- **77 final-round categories** (73 family, 4 adult) with 1,128 items in total, each category having at least 6 items
  that fit and 6 that don't.
- **28 scramble words.** They are 5–8 letters, chosen to avoid common anagrams.
- **Night memory:** questions, final categories and scramble words are marked with the pack's `api.used` as they are
  dealt, so a replay in the same night asks fresh ones until a bank runs out.
- **Narration** (`narration.ts`) uses 244 characters across four lines: intro, Panic Room, new ghost, and escape.
  Generic moments use the shared `host.*` lines.

## Files

- `types.ts`: views, actions and reveal beats (`ANSWER`, `panicBeats`, `FINAL`).
- `server.ts`: the rules.
- `content.server.ts`: the banks.
- `art.tsx`: original SVG art (concierge, ghoul, cups, doors, coin, memory symbols, candle, cobweb).
- `client.tsx`: TV and phone screens.
- `styles.css`: everything scoped under `.hj-quiz-panic`.
- `bot.ts`: a bot that "knows" the banks about 55–80% of the time, so games mix deaths, swaps and escapes.
- `qa.ts`: drives the phone UI for the QA driver.
- Music: `music/tracks/quiz-panic.ts` ("Checkout Waltz").
  - A D-minor 3/4 macabre waltz with a pizzicato oom-pah bass, organ stabs, a music-box tune and a harpsichord
    counterline.
  - In the B section a pipe organ takes the tune over strings, with timpani and risers at the section hinges.
  - It plays during questions and the final. Answers use `reveal`; the Panic Room uses `spooky`.

## Privacy

Before the reveal, the public view never contains:
- the answer key;
- poisoned cups or who poisoned them;
- rooms;
- scramble words;
- the memory sequence during recall;
- this flip's coin calls;
- the final-round answers.

Each phone's private view holds only its own pick, cup, room, sums, letters, calls and final picks.

## QA evidence

All runs used `tools/qa-driver.ts` against isolated builds on port 4456, with the phone driven through `qa.ts` UI taps. Shots are under
`output/hijinks/quiz-panic/<run>/`.

| Run | Players | Flags | Result |
|---|---|---|---|
| hj-b1-quiz-panic-1/p10 | 10 | phone + TV viewports, settled | Full game to the podium. 0 rejections and 0 page errors. The driver then failed to tap *End the night*: the pack menu list intercepted it. |
| hj-b1-quiz-panic-2/p2 | 2 | same | Full night to results. 0 rejections and 0 errors. |
| hj-b1-quiz-panic-3/p10 | 10 | same | Full night to results. 0 rejections and 0 errors. |
| hj-b1-quiz-panic-4/p3 | 3 | same | Full night. 0 rejections and 0 errors. |
| hj-b1-quiz-panic-5/p3 | 3 | settled | Recheck of the reveal rows. 0 rejections and 0 errors. |

Fixes after review:
- **Money spoiler.** Cash in the guest list and on phones updated before the answer beat. It now waits for the reveal.
- **Doom overlay.** The overlay was muddy: question text bled through it. It is now an opaque blood-red vignette.
- **Panic Room screens.** These were sparse. Mr Grimsby now presents every challenge stage with a speech bubble, and also appears on the intro.
- **Doors.** Doors swung outward over the neighbouring room labels. They now open inward, with hiders standing in front of the ghoul.
- **Coin.** The coin label was clipped by the rim.
- **Final round.** The tokens were small and the screen had an empty band. Tokens now scale up for small rosters, the item cards are larger, the exit arch glows, and the move marks are cleaner.
- **Checkout screen.** The winner was drawn inside the red EXIT sign box (a CSS selector bug).
- **Reveal anticipation.** The opening beat showed one lonely dim row. It now shows a "Checking…" line and pending dots, and small casts get larger rows.
- **Content.** One question's date span was corrected, and one category name that echoed a commercial title was renamed.

Independent review (port 4457, builds `hj-b1-quiz-panic-r1`…`r7`, shots under `output/hijinks/quiz-panic/review-<n>/`):
- **Rules.** Early advances now need someone online, so a room that drops entirely waits for deadlines instead of racing
  through questions and killing absent players in challenges (test added).
- **Spoilers.** The doomed phone's header turned into a ghost when the reveal started; it now waits for the verdict beat.
  During a coin flip the TV guest marks showed ✓/✗ and Safe/Out while the coin was still spinning; marks now follow the landed coin.
- **TV.** The poison reveal names the drinkers and shows who spiked each poisoned cup. Small casts get bigger reveal rows,
  coins and memory symbols. Cup numbers are stroked. The picker stacks are bigger and their `+N` is legible. Doors are bigger.
  The coin speech bubble announces the landed side. Small rosters (2–3) get bigger guest cards that fit the stage.
- **Phones.** Mad Math fits a 320×568 screen and short landscape without scrolling. Up to 11 cups fit above the fold.
  The room choices align, and *Room 13* never breaks. In landscape the final's three items sit side by side.
  The final shows the category as the title. The waiting screens show your avatar (mint when you are a ghost).
  The coin call explains best of three.
- **Content.** Duplicate subjects (Machu Picchu, Pluto, chess) were replaced with Pompeii, Sputnik 1 and the Olympic pool. The
  pumpkin question now has squash options only. The four-beat note question gives both US and UK note names.
- **QA lever.** `QP_QA_DOOMED=1` makes the driver's phone (the VIP seat) answer every question wrong and ace the skill
  challenges, so live runs reach the phone task screens. `qa.ts` waits 4 s before each tap, so all phone viewports are captured.

Remaining limits:
- **Hardware and audio.** No physical phones were tested, and audio was not listened to (the music's bus levels were checked numerically).
- **Phone task screens.** Bots finish phone tasks quickly, so the math keypad, memory pad, scramble tiles and coin call were exercised through `qa.ts` taps but were rarely captured mid-task.
- **Screenshot timing.** With `--phone-viewports` the driver resizes the phone and TV while it is shooting. Some `settled-*` and phone shots catch a stale layout (scaled-down TV, horizontally offset phone). This is driver timing, and a probe confirmed the page itself never overflowed in later runs.
