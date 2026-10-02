# Ballpark

Hijinks minigame `ballpark`: honest room-polling percentage guessing for 3–10 players. Every question is answered by
the people on the sofa, so the true percentage is **this room's** answer. Everyone answers a yes/no question in secret.
One rotating agent dials in the percentage of the room that said yes. Everyone else bets on whether the truth is higher
or lower. A final round, **Most Wanted**, has everyone tick confessions and then guess the room's top three.

**Art direction.** A slick retro spy-agency data lab:

- graph-paper glass walls, CRT scanlines and a radar ghost sweeping in the corner;
- a brass-and-glass "Bureau of Educated Guesses" plaque;
- the **Ballpark Meter**, a big analogue semicircle gauge with an LED level band, betting zones, a live cream needle for
  the agent and an amber truth needle;
- green-bar teleprinter paper with sprocket holes for every question;
- red CLASSIFIED / ON THE RECORD / LOCKED stamps and aged "Most Wanted" posters.

The palette is teal phosphor (`#2de0c8`) and amber (`#ffb238`) on deep blue-green glass. The menu accent is amber, which
keeps it apart from Odd One In's teal interrogation room.

**Theme music.** `music/tracks/ballpark.ts`, "Dead Reckoning": a slinky 60s spy-lab lounge in E minor at 112 bpm (A–B–A′,
24 bars, 51.4 s loop).

- A combo organ comps a bossa groove under rim-click clave and shakers.
- A reverb-soaked baritone twang plays the hook.
- A quiet square-wave "computer" arpeggiates each chord like a data readout.
- In the bridge, a muted trumpet and vibes lift the tune through G major, with a B7♭9 brass stab.
- Brass doubles the returning hook, and a chromatic B7 pickup loops back to bar 0.

## Rules

There are **2 rounds of questions**, then **Most Wanted**.

- **Round 1:** every player is the agent once, in random order.
- **Round 2 ("Long shots"):** with 3–6 players everyone is the agent again (the first agent is never the previous
  one). With 7 or more players, round 2 has 3 questions, and the agents are the three lowest connected scorers (lowest
  first), as a comeback chance.

Each question:

1. **Survey** (6–12 s, scaled by question length, then the pace setting). The TV shows the question on teleprinter paper,
   a radar that blips once per answer (anonymous) and the agent on deck. Every phone, including the agent's, answers
   **Yes** or **No**. The phone says *Your answer is anonymous: the TV only ever shows the room's total*. For
   on-the-record questions it says instead that this harmless one shows who said what. The survey ends 1.5 s after
   every connected player has answered, or at the buzzer. The truth is the rounded percentage of answers that were yes.
   Players who didn't answer are not counted. With fewer than two answers the lab makes up a number (a lone answer
   would expose its author).
2. **Guess** (25 s). The agent's phone shows a huge readout, a 0–100 slider (step 1), and −5 / −1 / +1 / +5 nudges.
   On short portrait phones only the ±1 nudges show, beside the readout; in short landscape the Lock button sits
   beside the slider. It streams the position to the server at most 4 times a second (`AIM_MS` 250 ms trailing throttle; the server
   ignores faster updates rather than rejecting them). The TV needle and LED band follow live. **Lock in** stamps
   LOCKED for 1.4 s. A moved but unlocked dial locks itself 0.7 s before the buzzer. Other phones mirror the live
   estimate.
3. **Bet** (15 s). Everyone but the agent bets on the truth versus the guess: **Higher** or **Lower**. Round 2 adds
   **Much higher** / **Much lower** (more than 15 points away, double or nothing). The phone spells out each range
   ("58% or more"), and bets that can't win are disabled (no "lower" than 0 %). The meter shows the betting zones, with
   ×2 marks at ±15 in round 2. Bets stay hidden until the reveal.
4. **Reveal** (9.8 s, server-timed beats). At 0.3 s the bettors drop into their booths beside the meter (LOWER on the left,
   HIGHER on the right). At 1.6 s the amber truth needle springs from the guess to the truth, with a damped overshoot
   and a counting readout. At 4.4 s it lands, and the two crowds appear: anonymous trench-coat silhouettes, or real
   avatars on the record. At 5.9 s the points arrive: a tier stamp, winning zones and booths glow, "+500" chips, and a
   BULLSEYE callout with confetti.

After each round, a **Debrief** scoreboard shows for 7.5 s.

**Most Wanted** (final round). The TV shows 9 statements from a themed set as wanted posters ("Kitchen Crimes":
*Has eaten food off the floor*…).

1. **Tick** (40 s). Each phone ticks every statement that is true for them (zero is fine), anonymously.
2. **Pick** (30 s). Everyone picks the 3 statements they think the most people ticked.
3. **Reveal** (≈18 s). The posters reveal their tick counts from fewest to most: the bottom six quickly, the top three
   slowly. Each poster shows a meter ("4 of 9"), the pickers' avatars and a "#1 · +1000" stamp. Then every hunter's
   total drops in.

## Scoring

| Event | Points |
| --- | --- |
| Agent within 3 points of the truth (**Bullseye!**) | 1000 |
| Agent within 7 (**Red hot!**) | 750 |
| Agent within 12 (**In the ballpark**) | 500 |
| Agent within 20 (**Warm-ish**) | 250 |
| Correct Higher / Lower bet | 500 |
| Correct Much higher / Much lower bet (round 2; > 15 points away) | 1000 |
| Most Wanted pick on the room's #1 / #2 / #3 statement | 1000 / 700 / 500 each |

- A truth exactly on the guess loses every bet (the agent nailed it).
- A plain bet still wins on a huge miss.
- Ranks use competition ranking: two statements tied for most ticks both pay 1000, and the next pays 500. A statement
  nobody ticked never pays.
- Winners are everyone tied on the top score (none if it is 0).
- Awards (unique leader only): **Human calculator** (most bullseyes), **Mind reader** (most bets won, at least 2),
  **Long-shot legend** (most "much" bets won) and **Most Wanted hunter** (best final round).
- The podium headline is the night's honest statistic: *This room said yes 58% of the time.*

## Pacing

With humans at standard pace, a question takes about 45 s: a survey of about 9 s, a guess of 10–25 s, bets of about
10 s and a 9.8 s reveal. Minigame length:

| Players | Questions | Approximate length |
| --- | --- | --- |
| 3 | 6 | 7 min |
| 6 | 12 | 11 min |
| 10 | 13 | 12 min |

Each count includes Most Wanted (about 1.5 min) and two debriefs. With instant bots in the harness, a game takes
4.7–5 simulated minutes. Timers scale with the pack pace; reveal beats are fixed and derived from the phase start, so a
reloaded TV or phone lands on the same beat.

## Privacy

- Survey answers live only in server state and in **your own** private view (`answer`).
- During the survey, the public view lists who has answered (`done`, in roster order), never what they answered. The
  SFX are identical for yes and no.
- The reveal publishes only the yes/no counts, and none at all when fewer than two people answered. For questions tagged on the record (`+` in the bank), it also publishes
  `yesIds`/`noIds`. The phone warns about this before you answer. Adult questions are never on the record.
- Most Wanted ticks never appear in any public view, only per-statement counts at the reveal. Picks are public at the
  reveal.
- Bets are hidden until the reveal (`done` only).

## Content (`content.server.ts`, server only)

| Bank | Count |
| --- | --- |
| Family yes/no questions | 228 (59 on the record) |
| Adult yes/no questions (dating, nights out, work drama) | 47 |
| Family Most Wanted sets (9 statements each) | 31 |
| Adult Most Wanted sets | 6 |

That is 275 questions and 37 × 9 = 333 statements, all original. Adult items are filtered when `settings.family` is on.

Every question and set has a stable id (a hash of its text). The game marks each dealt item with `api.used.add`, and
decks deal unused items first (shuffled), so a replay in the same night starts with fresh questions and a fresh set.

## Narration (`narration.ts`, 250 characters)

`ballpark.intro`, `ballpark.bullseye`, `ballpark.way-off` (misses of 35+ points) and `ballpark.wanted`. Shared lines:

- `host.reveal` (the first reveal of the game);
- `host.scores` (debriefs);
- `host.final-round` (Most Wanted);
- `host.everyone-in` / `host.timeup` (end of ticking);
- `host.winner` (Most Wanted totals).

## Audio cues

- **Music:**
  - `ballpark` for surveys, the dial, bets and debriefs;
  - `reveal` under every reveal;
  - `think-2` while ticking;
  - `vote` while picking.
- **SFX:**
  - survey: swoosh-in, then submit per answer; lock (or timeup), then glitch when the dial goes live;
  - dial: tick-fast at 5 s; lock and stamp on lock-in; ding when bets open;
  - bets: vote per bet;
  - reveal: whoosh (bets fly in), drumroll (sweep), reveal (landing), then the verdict:
    - bullseye: airhorn, cheer and narration;
    - red hot: ooh;
    - otherwise score-up, plus coin when bettors cash in;
    - big miss: record-scratch and narration, or aww;
  - round 2: gong;
  - Most Wanted: stamp; pop per poster and stamp for the top three; fanfare and applause on the totals.

## Files

- `types.ts`: views, actions, scoring tables, bet helpers, beats.
- `server.ts`
- `content.server.ts`
- `client.tsx`: TV `Display` and phone `Controller`.
- `styles.css`: `.hj-ballpark`, `bp-*`.
- `narration.ts`
- `bot.ts`: human-ish pauses so QA screenshots catch each phase: answers at 5 s; as agent, sweeps the dial from 1 s
  toward a per-question 12–88 hunch about three times a second, then locks at 10 s; bets at 5 s (30 % long shots in
  round 2), ticks about 45 % at 10 s and picks 3 at 8 s.
- `qa.ts`: real phone UI taps, including dragging the slider through React's input event.
- `tests/ballpark.test.ts`
- `music/tracks/ballpark.ts` → `public/games/hijinks/music/ballpark.mp3`

## QA evidence

- **Focused tests:** 13/13 (`node --import tsx --test packages/games/hijinks/tests/ballpark.test.ts`). They cover:
  - bot games at 3, 6 and 10 players, with agent rotation per round;
  - the round 2 lowest-scorer rule;
  - every scoring tier and boundary, bets, much bets, a dead-on guess, and Most Wanted ranks with ties;
  - shared wins;
  - missing input (house numbers, the default dial, a kept dial, no bets);
  - disconnects, validation and the dial throttle;
  - privacy (answers, ticks, on-the-record), the family filter, night memory (`api.used`) and content counts.
- **Static checks:** whole-project `tsc` and `oxlint` are clean.
- **Browser QA** (`tools/qa-driver.ts` with `--phone-viewports --tv-viewports --settled`; the phone plays through its real
  UI via `qa.ts`):
  - `output/hijinks/ballpark/hj-b2-ballpark-2/p10/`: 10 players, full night to results, 0 page errors, 0 rejected
    actions.
  - `output/hijinks/ballpark/hj-b2-ballpark-3/p3/`: 3 players on the final build, the same outcome.
  - Run 1 (`hj-b2-ballpark-1`) found the issues fixed in runs 2–3.

## Known gaps

- Ballpark has no player-written text, so the bot cannot exercise maximum-length player text. The worst-case question
  (85 characters) and statement (54 characters) are enforced by the content tests.
- With 3 players the truth can only be 0, 33, 67 or 100 %. That is honest, but easier to guess.
