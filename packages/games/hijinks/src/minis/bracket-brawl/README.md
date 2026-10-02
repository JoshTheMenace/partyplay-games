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
  scanlines. Bracket lines light up lime when a winner advances, and the live slots pulse in their corner colour;
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
3. **Predict** (15 s, paced). The TV shows every seeded answer; each phone taps one to call the champion (optional, own
   answers allowed, one pick, no changes).
4. **Rounds.** Each bracket round opens with a 2.8 s banner (Round of 16 / Quarterfinals / Semifinals / Final). In
   Smackdown the banner shows that round's judging question for 4.6 s. Then each matchup in bracket order:
   - **Vote.** Side A lands at 0.5 s and side B after A is read aloud; votes count from the start. Votes last 8 s in
     early rounds and 10 s in the semifinals and final (paced), after the read-out. Everyone except the matchup's
     authors votes; the authors' phones say "You're in this one!". The vote closes early once every connected voter is in.
   - **Result** (3.9–5.0 s, +2.6 s for a coin flip). Tally bars at 0.3 s; the verdict at 1.5 s (ADVANCES! / K.O.,
     the loser's author unmasked or "House answer"); the winner's bracket line lights at +0.9 s. **Majority wins. A tie
     (or a matchup nobody can vote on) is a coin flip**: a gold coin spins for 2.6 s and lands on the winner's face.
5. **Champion** (10.5 s). The trophy rises, the answer appears at 0.5 s, its author (or the House) at 2.0 s, the players
   who called it at 3.6 s, and every author in the bracket is unmasked at 4.8 s.
6. **Standings** (8 s) after brackets 1 and 2. The night's podium follows bracket 3.

**Seeding.** 8 slots when the room's answers fit, otherwise 16 (9–10 players). A player's two answers start in
opposite halves (they can only meet in the final), player answers face house answers before each other in round one,
and nobody ever faces themselves. House answers are written for each Standard prompt (two each) or come from the Blind/
Smackdown category pool, then a generic pool; they never copy a player's answer.

**Anonymity.** Answers stay anonymous while they are alive: an author is unmasked only when their answer is knocked
out, and everyone at the champion reveal. Scores won inside a bracket are kept off the TV until the champion is
crowned (each phone sees its own running total), so the scoreboard can't give authors away.

## Scoring

| Event | Points |
| --- | --- |
| Win a matchup in bracket round *r* (1 = first round) | 100 × *r* |
| Your predicted champion wins a round | 50 per round it wins |
| Your answer is the bracket champion | 500 × bracket number (500, 1000, 1500) |
| Smackdown | matchup wins and predictions ×2 ("votes count double") |

House answers score nothing. Winners: top score (none if nobody scored). Awards: **Undefeated** (most bracket titles,
ties broken by matchup wins), **Oracle** (most correct champion calls), **Crowd favourite** (most votes received).
A podium headline mocks the room if the House wins a bracket.

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

Known gaps:

- Not tested on physical phones or with real audio output.
- The theme music was balanced by bus levels (the lead around −20 dB, accompaniment around −26 dB averaged) and has not been listened to.
- At 10 players with all five viewports, the QA driver's screenshot queue lags the game, so file names can trail the state they show.
- Human pacing is estimated, not measured.
