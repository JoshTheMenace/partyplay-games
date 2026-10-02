# Split Decision

Hijinks minigame `split-decision`: dilemma splitting for 3–10 players. Everyone finishes their own dilemma ("You can fly,
but ____. Would you take the wings?") with the catch that should split the room exactly in half. Then the room votes yes
or no on each one. A perfect 50/50 split pays big. A catch so tempting (or so awful) that everyone agrees pays nothing.

**Art direction: the Dilemma Dimension.** A sci-fi portal machine in deep space:

- a nebula sky with two drifting star layers, a perspective "dimension floor" grid and a glowing white rift that splits
  the whole world down the middle (faint yellow on the left, faint purple on the right);
- a split logo plate, electric yellow **Split** and cosmic purple **Decision**, joined by a zigzag tear;
- the **portal**: a ring that is half yellow and half purple, with a lightning seam, spinning dash rings and a pulsing
  core. It counts the answers while writing and the votes while voting;
- a holographic "Incoming dilemma" transmission screen where the filled catch materialises out of a blur;
- the **split screen**: a striped electric-yellow YES half and a cosmic-purple NO half with a crackling white beam
  between them. Voters gather in the portal, then slide into their half;
- a split meter (yellow vs purple bar with a white 50 % notch) and verdict stamps.

The palette is `#ffe23a` electric yellow and `#9b4dff` purple on `#0c0322` void. The menu accent is the yellow.

**Theme music.** `music/tracks/split-decision.ts`, "Two Minds, One Rift": retro space-age synth-pop in D minor at 118 bpm
(A–B–A′, 24 bars, 48.8 s loop).

- The hook is an argument. A bright pulse lead on the left (the YES side) asks a two-bar question, and a theremin on the
  right (the NO side) answers.
- In the bridge they finally agree, singing in thirds over blooming strings.
- In A′ they trade bar by bar, then land in unison on an A7♭9 that falls back into bar 0.
- Underneath: a triangle arpeggiator ping-ponging left/right, an octave-pumping synth bass ducked under a
  four-on-the-floor kick, claps, sixteenth hats, bell sparkles and theremin "portal zips" into each section.

## Rules

1. **Round 1: Split the room (×1).** Every player gets their own dilemma template with one blank, and fills in the catch
   (60 characters max). Stuck players can tap *Let the machine fill it* (a house blank at half points). Every blank sits
   mid-sentence, so the server lowers the phone keyboard's automatic capital (on any would-you-rather option, and on
   common opening words like "You" or "Every" in a catch; names and ALL CAPS stay) and drops a repeated leading "but".
2. **Round 2: Would you rather? (×2).** Every player gets their own would-you-rather and writes **both** options. The two
   options must differ. The room picks A or B.
3. **The Big Split (×3).** One dilemma for everyone. Every player writes their own catch. Then each phone judges every
   other take yes or no in a quick carousel. The carousel starts after your own take, so phones spread out.

Each round 1–2 card plays as:

- **Show:** the template beams in and the catch (or option A, then B) materialises. The host reads the finished sentence
  aloud when read-aloud is on.
- **Vote (12 s):** everyone but the author votes. The author is hidden until the reveal. The TV shows only the vote
  count.
- **Result (7.6 s, +1.6 s for perfect/unanimous):** voters gather in the portal, slide into YES/NO (or A/B), the author
  drops out of the portal, then points and the verdict land.

A scoreboard follows rounds 1 and 2.

## Scoring

The author's points depend on how evenly the voters split:

- **Perfect split:** the evenest split possible pays **1000**. That is 4–4, or 5–4 with nine voters (odd rooms can't
  tie, so their best split counts as perfect).
- **Otherwise:** `1000 × (1 − (|yes − no| − odd) / (voters − odd))`, rounded to tens, with a floor of **100** when anyone
  dissented. For example, 3–1 pays 500, 6–3 pays 750, 7–2 pays 500 and 8–1 pays 250.
- **Unanimous, or nobody voted:** 0.
- **Multipliers:** ×2 in round 2 and ×3 in The Big Split.
- **House blanks:** a scenario with any machine-filled blank scores half.

Voters also score:

- **Bold bonus:** every voter on the strictly smaller side earns 50 × round (150 per take in The Big Split).
- **No bonus:** ties and unanimous rooms have no minority.

Winners and awards:

- Winners are everyone tied on the top score (none at 0).
- Awards go to a unique leader only:
  - **Master splitter:** most perfect splits.
  - **Won The Big Split:** the single best take.
  - **Proud contrarian:** most Bold votes, at least 2.
  - **United the room:** most unanimous dilemmas, at least 2.
- The podium headline counts the night's perfect splits.

## Pacing

Timers scale with the pack pace. Writing takes 60 s (80 s for would-you-rather). The Big Split carousel gets 10 s + 4 s
per take (50 s max). Card show beats are 3–7.5 s.

Writing ends 1.5 s after everyone connected is done. A vote ends 1.2 s after every connected voter is in.

Estimates at standard pace with human players:

| Players | Cards | Approximate length |
| --- | --- | --- |
| 3 | 6 + 3 takes | 6–7 min |
| 6 | 12 + 6 takes | 8–9 min |
| 10 | 20 + 10 takes | 11–12 min |

With the bot pauses in the harness, a whole game takes 2.5 / 4.2 / 6.4 simulated minutes at 3 / 6 / 10 players.

## Privacy

- Templates and catches live only in the writer's private view (`task`) until the card is shown.
- During show and vote, the public card has the text and a vote **count**, never the author or who voted. `done` stays
  empty during cards, because the one voter missing from the list would be the author.
- `outcome` (author, each side's voters, points) appears only in the result phase.
- In The Big Split, takes are anonymous (`e0`, `e1`…) until the reveal. Judgements live only in each judge's own
  `judged`. The reveal publishes per-take yes/no counts, authors and Bold totals.

## Content (`content.server.ts`, server only)

| Bank | Count |
| --- | --- |
| Round 1 dilemmas (family) | 154 |
| Round 1 dilemmas (adult: nights out, dating, work, money) | 26 |
| Would-you-rathers (family / adult) | 63 / 10 |
| The Big Split dilemmas (family / adult) | 32 / 6 |
| House blanks: clauses for dilemmas | 67 |
| House blanks: actions for would-you-rathers | 48 |

That is 291 templates and 115 house blanks, all original. Adult items are filtered when `settings.family` is on.

Templates are dealt with `dealFresh`, keyed by text. Every dealt template is marked with `api.used.add`, and unused ones
come first, so a replay in the same night starts fresh. House blanks rotate, so two in one game never repeat, and a
machine fill never repeats the scenario's other option.

## Narration (`narration.ts`, 236 characters)

Minigame lines:

- `split-decision.intro`
- `split-decision.rather` (round 2 start)
- `split-decision.perfect`
- `split-decision.unanimous`

Shared lines:

- `host.vote.2` (first vote);
- `host.everyone-in`, `host.timeup`, `host.hurry`;
- `host.no-votes`, `host.close` (sometimes on close splits);
- `host.scores`, `host.final-round`;
- `host.winner` / `host.tie` (The Big Split).

## Audio cues

- **Music:**
  - `split-decision` while writing rounds 1–2 and on scoreboards;
  - `vote` under cards and the carousel;
  - `reveal` under results;
  - `think` while writing The Big Split.
- **SFX:**
  - writing: submit per fill, glitch for a machine fill, tick-fast with 10 s left, timeup;
  - show: swoosh-in, then sparkle/pop as each fill materialises; ding when voting opens;
  - voting: vote per vote, tick-fast at 4 s;
  - result: whoosh + slide when the voters move, reveal on the author, then the verdict:
    - perfect: airhorn, cheer and narration;
    - unanimous: record-scratch, aww and narration;
    - close: ooh;
    - lopsided: boing;
    - plus score-up, and coin when someone earns a Bold bonus;
  - The Big Split: tap per verdict and vote when a judge finishes; drumroll, then pop/score-up/sparkle per take,
    fanfare + applause for the best, coin for the Bold bonuses;
  - round starts: gong.

## Files

- `types.ts`: views, actions, `splitPoints`/`verdictOf`/`minority`, the carousel order and the reveal beats.
- `server.ts`
- `content.server.ts`
- `client.tsx`: TV `Display` and phone `Controller`.
- `styles.css`: `.hj-split-decision`, `sd-*`.
- `narration.ts`
- `bot.ts`: fills at about 5 s (the second option 4 s later), a quarter of fills built to the 60-character limit, 10 %
  machine fills; votes at 3 s; judges one take every 1.1 s in carousel order.
- `qa.ts`: real phone UI for fills, machine fills, votes and verdicts.
- `tests/split-decision.test.ts`
- `music/tracks/split-decision.ts` → `public/games/hijinks/music/split-decision.mp3`

## QA evidence

All runs live under `output/hijinks/split-decision/`. Every run finished join → menu → intro → three rounds → podium → menu
→ results with 0 page errors, 0 phone overflow findings and 0 rejected actions.

- **Tests:** `tests/split-decision.test.ts` (16 tests: bot games at 3, 6 and 10 players, scoring table, ties and odd rooms,
  unanimous/silent/house cards, round 2 and The Big Split, Bold bonuses, defaults, disconnects, stale/duplicate/out-of-phase
  moves, fill cleaning and machine-fill duplicates, privacy, family filter, night memory, reveal beats). `render-smoke.test.tsx` renders every phase on the TV and two
  phones at 10 players (run with `--import ./output/hijinks/split-decision/css-hook.mjs`). Whole-project `tsc` and
  `oxlint packages/games/hijinks` are clean.
- **Driver:** `qa-sd.ts` is a copy of `tools/qa-driver.ts` that keeps screenshots near real time on this loaded machine
  (viewport sweeps only for the first shot of each phase kind, settled shots skipped when the queue lags, timed TV shots
  through The Big Split reveal, votes held 7 s so open ballots are captured). The stock driver's queue fell minutes behind
  and never captured the final round.
- **Runs:** `hj-b2-split-decision-5/p10` (10 players, all viewports, settled), `hj-b2-split-decision-6/p3` (3 players, all
  viewports, settled), `hj-b2-split-decision-7/p3` (phone ballots at 390×844, 320×568 and 667×375), `hj-b2-split-decision-7/p10`
  (all viewports) and `hj-b2-split-decision-8/p10` (final build, recheck of the voter layout).
- **Best shots:** writing `hj-b2-split-decision-5/p10/004-…-write-1-t1-tv.png`; split reveal
  `hj-b2-split-decision-8/p10/045-…-result-2-t42-tv.png`; would-you-rather ballot on the TV
  `hj-b2-split-decision-7/p3/settled-016-…-vote-2-t14-tv.png`; The Big Split board `hj-b2-split-decision-5/p10/069-…-final-vote-3-t66-tv.png`
  and reveal `hj-b2-split-decision-5/p10/big-split-5000-tv.png`; phone ballots `hj-b2-split-decision-7/p3/006-…`, `017-…` and
  `027-…-phone*.png`.

Fixes from QA: voter name pills overlapped (wider slots, smaller pills; five or more voters per side now use two rows so
they clear the author card); the rift ran through the writing copy (now on a glass panel); would-you-rather options were
small text in empty panels while voting (now large and centred until the voters land); the author's points sticker covered
the avatar and “wrote this” (now below the card); an empty side now says “Nobody!”; the phone said “No , all on your own”.

Independent review (2026-10-02), runs `review-1/p10`, `review-1/p3` (all viewports, settled), `review-2/p3`, `review-2/p10` and
`review-3/p10` on builds `hj-b2-split-decision-r1…r3`, all with 0 page errors, 0 overflow and 0 rejected actions. Fixes:

- Phone keyboards auto-capitalise, so real fills read "…but You sneeze…". The server now lowers that capital and drops a repeated "but".
- A machine fill could repeat the author's own other option when the case differed. It now always skips the card's other blanks.
- The TV hid the Bold tag on odd-room perfect splits (5–4), even though the minority was paid. The tag now shows and sits
  inside its panel, clear of the verdict stamp.
- Would-you-rather writing showed yes/no tips. It now has its own tips.
- Two voters gathering in the portal stacked on top of each other. They now sit side by side.
- The "Machine-filled · half points" chip wrapped with the dot at the start of a line. It now breaks after "Machine-filled".
- Content: family dilemmas 135 → 154 and would-you-rathers 56 → 63, so family mode alone meets the 150/60 spec. Five
  vague "Would you do it?" endings were made specific, and three house options that said "forever" were reworded because
  they clashed with time-limited templates.

## Known gaps

- Not tested on physical phones, real keyboards, real audio output or a real TV at couch distance.
- Bots write the same few catches, so screenshots repeat text; human games will be more varied.
- With ten players The Big Split take cards use about 30 px text in the reveal (readable, but the smallest type on the TV).
