# Bracket Brawl

Hijinks minigame `bracket-brawl`: answer tournaments for 3–10 players. Everyone writes an answer to a prompt. The
answers (plus house answers) are seeded into a knockout bracket, everyone calls the champion, and then the room votes
every matchup head to head until one answer lifts the trophy. There are three brackets a game: **Standard**, **Blind**
and **Smackdown**.

**Art direction.** A neon sports-arena broadcast:

- a stadium with a lighting truss, sweeping coloured beams, a scrolling neon floor grid and a dark crowd with camera flashes;
- a broadcast bug (BRACKET BRAWL logo with a lightning bolt, a blinking LIVE light, the bracket chip) and a lower-third
  **Brawl Wire** news ticker with knockouts, standings and rules;
- the full bracket on every match screen: two wings flow inward to a central **jumbotron** with bolted corners and
  scanlines. Only the current round's answers are written out, large; every other round collapses into a column of seed
  chips, so the whole bracket still reads at a glance. Bracket lines light up lime when a winner advances, and the live
  slots pulse in their corner colour;
- each matchup is a fight card: **Blue corner** (cyan) vs **Red corner** (hot pink), seeds as numbered chips, a VS
  sticker, vote tally bars, ADVANCES! / K.O. stamps and a gold coin for tie-breaks;
- the champion gets a raised trophy, confetti and a "Called it!" row of the players who predicted it.

The palette is neon lime (`#c8ff2e`, the menu accent), cyan and hot pink on midnight blue, with gold for trophies.

**Theme music.** `music/tracks/bracket-brawl.ts`, "Main Event Neon": a stadium broadcast anthem in D minor at 138 bpm
(A–B–breakdown–A′, 32 bars, 55.7 s loop).

- An octave-pumping bass, arena rock drums with big claps, and off-beat saw stabs under a brass fanfare hook.
- B lifts to F major: a square lead over a neon sixteenth-note arpeggio, with brass answers at the end of each bar.
- The breakdown gallops on floor toms under crowd "hey!" brass stabs, then builds on four-on-the-floor kicks.
- A′ brings the fanfare back, doubled an octave up, and a riser and snare roll slam back into bar 0.

## Rules

Three brackets: **1 Standard**, **2 Blind**, **3 Smackdown**. Each one runs:

1. **Write** (60 s, scaled by the pace setting). With 3–4 players everyone writes **two** answers, so the bracket isn't
   mostly house answers; with 5–10 players, one. Answers are 1–50 characters, trimmed and cleaned; a player can't send
   the same answer twice. The phase ends 1.5 s after every connected player is done, or at the buzzer (a 10 s hurry-up
   fires on the way). Missing answers are **filled by the House**, credited to nobody.
   - **Standard**: a prompt ("The worst thing to hear from your pilot").
   - **Blind**: only a category hint ("Name a food"). The TV stamps the real prompt CLASSIFIED.
   - **Smackdown**: part one ("Name a household object"). Part two is a new judging question for every bracket round.
2. **Twist** (Blind only, 6.5 s). "You were answering: Name a food". At 1.8 s the real prompt slams in ("Something
   you'd yell at a seagull") and the field of answers appears under it.
3. **Predict** (20 s, paced; ends 1.5 s after every connected player has picked). The TV shows every seeded answer; each phone taps one to call the champion (optional, own
   answers allowed, one pick, no changes).
4. **Rounds.** Each bracket round opens with a 2.8 s banner (Round of 16 / Quarterfinals / Semifinals / Final). In
   Smackdown the banner shows that round's judging question for 4.6 s. Then each matchup in bracket order:
   - **Vote.** Side A lands at 0.5 s and side B after A is read aloud; votes count from the start. Votes last 8 s in
     early rounds and 10 s in the semifinals and final (paced), after the read-out. Everyone except the matchup's
     authors votes; the authors' phones say "You're in this one!". The vote closes early once every connected voter is in.
   - **Result** (3.9–5.0 s, +2.6 s for a coin flip). Tally bars at 0.3 s; the verdict at 1.5 s (ADVANCES! / K.O.,
     the loser's author unmasked or "House answer"); the winner's bracket line lights at +0.9 s, and only then does the winner appear in the next round's slot. **Majority wins. A tie
     (or a matchup nobody can vote on) is a coin flip**: a gold coin spins for 2.6 s and lands on the winner's face.
5. **Champion** (10.5 s). The trophy rises, the answer appears at 0.5 s, its author (or the House) at 2.0 s, the players
   who called it at 3.6 s, and every author in the bracket is unmasked at 4.8 s.
6. **Standings** (8 s) after brackets 1 and 2. The night's podium follows bracket 3.

**Seeding.** 8 slots when the room's answers fit, otherwise 16 (9–10 players). A player's two answers start in
opposite halves (they can only meet in the final), player answers face house answers before each other in round one,
and nobody ever faces themselves. House answers are written for each Standard prompt (two each) or come from the Blind/
Smackdown category pool, then a generic pool; they never copy a player's answer (ignoring case, punctuation and a leading
"a"/"an"/"the", so "sloth" blocks the house's "A sloth").

**Anonymity.** Answers stay anonymous while they are alive: an author is unmasked only when their answer is knocked
out, and everyone at the champion reveal. Scores won inside a bracket are kept off the TV until the champion is
crowned (each phone sees its own running total), so the scoreboard can't give authors away.

## Scoring

| Event | Points |
| --- | --- |
| Win a matchup | 100 (200 in Smackdown: "votes count double") |
| Your predicted champion wins a round | 100 per round it wins |
| Your answer is the bracket champion | 100 × bracket rounds (300 in an 8-slot bracket, 400 in a 16-slot one), every bracket |

House answers score nothing. Winners: top score (none if nobody scored). Awards: **Undefeated** (most bracket titles,
ties broken by matchup wins), **Oracle** (most correct champion calls), **Crowd favourite** (most votes received).
A podium headline mocks the room if the House wins a bracket.

**Balance (2026-10-02).** The old table (wins 100 × round, predictions 50, champion 500 × bracket number, Smackdown wins
and predictions ×2) made Smackdown worth more than brackets 1 and 2 together, so its champion won the night 95 % of the
time at 10 players. That's how a player with 50 points after two brackets won. The flat table above was chosen from a
seeded simulation: the real server plays 400 nights per room size, and every candidate table re-scores the same matches.
In the model, players have a writing skill, voters favour the better answer through a noisy logistic, and predictions
call the answer that looks best (`output/hijinks/gaps/games/brawl-sim.ts`, results in `brawl-balance.txt`):

| 10 players | Old | New |
| --- | --- | --- |
| Smackdown's share of all points | 50 % | 39 % |
| Smackdown champion wins the night | 95 % | 72 % |
| Bracket-1 champion wins the night | 27 % | 45 % |
| Leader after two brackets wins | 37 % | 53 % |
| Winner came from the bottom half after two brackets | 23 % | 12 % |

With 3 players (8-slot brackets, two answers each), Smackdown's share drops from 50 % to 42 % and the leader after two
brackets wins 72 % (was 58 %). The final stays the biggest prize: doubled votes, plus the 300–400 champion bonus that
rides on the last matchup. Keeping Smackdown at ×2 for match wins keeps the recorded "Votes count double!" line true.
`tests/bracket-brawl.test.ts` repeats a 150-night version at 3 and 10 players.

## Pacing

Bot games (instant typing) take about 4.8 min with 3 players and 7.9 min with 10 (16-slot brackets). With human
writing and voting times, expect roughly 8 min for small rooms and 12–13 min for 10 players.

## Content

All original. Counts are checked by `tests/bracket-brawl.test.ts`.

| Bank | Count | Adult-tagged |
| --- | --- | --- |
| Standard prompts, each with 2 bespoke house answers | 146 | 21 |
| Blind category/prompt pairs | 71 | 4 |
| Smackdown sets (part one + 4 judging questions) | 35 | 4 |
| Category house pools (food, animals, jobs, …; 13–14 each) | 20 | – |
| Generic house answers | 70 | – |

Adult items (29) are filtered out when the family setting is on. House-answer pools: 146 bespoke pairs + 20 category
pools + 1 generic pool. Night memory (`api.used`) marks every dealt prompt and house answer, so a replay in the same
night deals fresh ones first.

## Narration (250 characters)

`bracket-brawl.intro`, `.blind`, `.smackdown`, `.coin` (`narration.ts`). Shared `host.*` lines cover everyone-in,
time-up, hurry, vote, reveal, landslide, close, winner, final round and scores. The server reads prompts, every answer,
the twist and each judging question aloud when read-aloud is on.

## Files

`types.ts` (views, actions, scoring, beats), `server.ts`, `content.server.ts`, `client.tsx`, `styles.css`,
`narration.ts`, `bot.ts`, `qa.ts`, `music/tracks/bracket-brawl.ts`, `tests/bracket-brawl.test.ts`.

## QA evidence

Rules tests: `tests/bracket-brawl.test.ts` (11 tests). They cover full bot games at 3, 6 and 10 players, seeding,
scoring (wins, predictions, champion, Smackdown ×2, banked scores), coin-flip ties and no-voter flips, House fill-ins
and pace, disconnects, stale/duplicate/out-of-phase/invalid actions, privacy (answers, the Blind prompt, live authors),
the family filter, content counts and night memory. Whole-project `tsc` and `oxlint packages/games/hijinks` are clean.

Browser QA (isolated builds served on port 4474, `tools/qa-driver.ts`); evidence is in `output/hijinks/bracket-brawl/`:

| Run | Players | Flags | Result |
| --- | --- | --- | --- |
| `hj-b2-bracket-brawl-1/p10` | 10 (16-slot) | phone + TV viewports, settled | full game; 0 errors, 0 rejected, 0 overflow. The shot queue fell behind fast bots, so late shots are stale |
| `hj-b2-bracket-brawl-2/p10` | 10 | settled | full game to the podium (~10 min with staggered bots); 0 errors / rejects / overflow |
| `hj-b2-bracket-brawl-3/p3` | 3 (8-slot, 2 answers each) | phone + TV viewports, settled | full game; 0 errors / rejects / overflow |
| `hj-b2-bracket-brawl-4/p4` | 4 | settled | full game, retest of the final predict panel; 0 errors / rejects / overflow |

Best shots:

- **Write:** `hj-b2-bracket-brawl-2/p10/081-…-write-0-t78-tv.png` (Smackdown)
- **Predict:** `hj-b2-bracket-brawl-4/p4/005-…-predict-0-t2-tv.png`
- **Twist:** `hj-b2-bracket-brawl-2/p10/settled-042-…-twist-0-t40-tv.png`
- **16-slot matches:**
  - coin-flip final: `hj-b2-bracket-brawl-2/p10/settled-038-…-result-4-t36-tv.png`
  - Smackdown vote: `hj-b2-bracket-brawl-2/p10/settled-097-…-vote-1-t95-tv.png`
- **Champion:** `hj-b2-bracket-brawl-2/p10/settled-039-…-champ-4-t37-tv.png`
- **Standings:** `hj-b2-bracket-brawl-2/p10/settled-040-…-scores-4-t38-tv.png`
- **Podium (House headline, awards):** `hj-b2-bracket-brawl-2/p10/119-podium-settled-tv.png`
- **8-slot Smackdown final:** `hj-b2-bracket-brawl-3/p3/settled-046-…-write-0-t44-tv.png` (the file name lags; it shows the final)
- **Phones:** `hj-b2-bracket-brawl-3/p3/*-phone-320x568.png` and `*-phone-667x375.png`; `hj-b2-bracket-brawl-2/p10/0{05,07,09,10,40,41,43}-*-phone.png`

Fixes made from the screenshots:

- **Long answers:** they overflowed the jumbotron's fighter cards, so the type is smaller and the cards are padded.
- **No spoilers before the verdict:**
  - The bracket showed author avatars on the live slots; they now appear only on knocked-out slots, and on round-one slots at the crown.
  - The ticker showed knockouts and the "still standing" count early; it now waits for the verdict.
- **Coin flip:** the landed coin covered the text; a "Won the coin toss" chip replaces it.
- **Overlaps in the match:** the K.O. author chip and the VS sticker overlapped, so the chips moved to the card's left edge.
- **Bracket wings:** the inner 16-slot columns were widened and use limited hyphenation, so words no longer break mid-word.
- **Predict jumbotron:** a 16-entry list there overflowed and repeated the wings; a prediction panel (trophy, payout, picks-in) replaces it.
- **Phones:** result screens show a corner-by-corner recap. The champion screen names the winning answer. Your pick is listed by its text.
- **Header:** the chip reads "Bracket 1/3" and the bug shows how many answers are still standing.
- **Bots:** they now finish at staggered times per seat, so live QA catches mid-phase states.

Independent review (2026-10-02, build `hj-b2-bracket-brawl-r3`, port 4477; evidence in `output/hijinks/bracket-brawl/review-{1..4}/`):

- **Next-round spoiler:** a decided winner appeared in the next round's slot as soon as the result began, before the votes,
  the coin or the verdict. It now moves up when its bracket line lights (`review/spoiler-check.tsx` renders the beats).
- **House near-copies:** "sloth" no longer lets the House's "A sloth" in (comparison ignores a leading article).
- **Coin flip:** the coin's toss covered the blue corner's answer; it is smaller and stays in the gap between the cards.
- **Twist:** "Now reread the bracket" fits on one line (the old two-line hint misaligned its arrows).
- **Pacing:** predictions get 20 s (16 answers to read on a phone); they still end early once everyone has picked.
- **Content:** three weak Blind pairs (the real prompt read naturally with the category) were replaced.
- **QA bots:** answers are offset per seat, so ten bots no longer write the same 50-character line.

| Run | Players | Result |
| --- | --- | --- |
| `review-1/p10` | 10, phone + TV viewports, settled | full game (~9.8 min); 0 errors, 0 rejected, 0 overflow |
| `review-2/p3`, `review-3/p3` | 3, phone + TV viewports, settled | full games; 0 errors, 0 rejected, 0 overflow |
| `review-4/p3` | 3, TV + mid-result shots | coin-flip check; 0 errors, 0 rejected |

Known gaps:

- Not tested on physical phones or with real audio output.
- The theme music was balanced by bus levels (the lead around −20 dB, accompaniment around −26 dB averaged) and has not been listened to.
- At 10 players with all five viewports, the QA driver's screenshot queue lags the game, so file names can trail the state they show.
- Human pacing is estimated, not measured.

## Gap closing (2026-10-02): scoring balance and a couch-readable bracket

**Scoring.** See *Balance* under Scoring: a flat table (100 a win, Smackdown wins ×2, predictions 100 per round, champion
100 × rounds). The new copy reads "+100 every round it wins" on the predict panel and phone, "Your prediction paid
+400" and "+400" champion chips in 16-slot brackets. The phone's running total drops the old "(×2)".

**Bracket readability.** The old 16-slot wings packed four columns of text (15–18 stage px, about 10–12 px on a
1280×720 TV). Now each wing writes out only the focus round (the current round; round one during the twist, the
predictions and the champion reveal, so every author is unmasked under their answer). That column takes most of the
wing at 24 px (8 per wing), 30 px (4), 34 px (2) or 36 px (1), which is 16–24 px at 720p. Every other round is a
46 px seed chip: lime when it won, faded when it's out, gold for the champion. The bracket lines still join them, and
slots slide to their new size when the round changes. Text is never clamped. The jumbotron's fight cards drop to a
smaller size once the tally bars appear and centre with `safe`, so a three-line answer can't creep under the corner
label. Seed chips sit above the pulsing live slot.

**Evidence** (build `hj-gap-games-2`/`-1`, port 4485, driver copy `output/hijinks/gaps/games/qa-gap.ts` with `GAP_SWEEP`:
TV 1920×1080 + 1280×720 and phone 390×844 + 320×568 + 667×375 a set time into every twist, predict, vote, result,
champion and standings phase, once per bracket and round):

- `output/hijinks/gaps/games/bracket-layout.tsx` server-renders a seeded game in which every player writes a worst-case
  50-character answer, at every bracket stage of all three brackets, with the real CSS. In headless Chromium it fails if
  any answer leaves its slot or fight card, or renders under 16 px at 720p. It passes at 10, 6 and 3 players
  (`layout-p10/`, `layout-p6/`, `layout-p3/`); the first pass caught the Smackdown final's card clipping its first line.
- `hj-gap-games-1/bb-p10/`: a full 10-player night in the real browser with 33 sweeps (165 shots), 0 page errors, 0
  rejected actions and 0 phone overflow. Best shots: round of 16 `sweep-006-…-tv-1280x720.png`, semifinal
  `sweep-033-…`, final `sweep-038-…`, crown `sweep-039-…`, twist `sweep-042-…`, Smackdown `sweep-083-…-tv.png`,
  standings `sweep-079-…`. Phones: predict `sweep-004-…-phone-320x568.png`, vote `sweep-083-…-phone*.png`, called it
  `sweep-039-…-phone-667x375.png`.
- `hj-gap-games-2/bb-p3/`: the 3-player minimum (8-slot brackets) on the final build.

Driver note: the sweeps still trail fast phases by a few seconds at 10 players, so a frame may show the next beat of
the same match.

