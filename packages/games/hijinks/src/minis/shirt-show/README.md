# Shirt Show

T-shirt design battle for 3–10 players, staged as a wrestling ring that doubles as a fashion runway. The arena has ring
ropes and turnbuckles, neon tubes, floor smoke, a chrome-and-neon logo, mannequins on stands and a championship belt.
Everyone draws designs and writes slogans. Each player then stitches a shirt from other people's parts, and the shirts
fight king-of-the-hill bouts until one holds the belt. The two round champions meet in the main event.

## Flow

Two rounds, then the final.

1. **Draw** (75 s): draw as many designs as you like with the shared `DrawingPad`, up to 4. Each one goes to the rack
   separately.
   - *I'm done drawing* appears after the first design. The phase ends when every connected player is done (or has 4),
     or when time runs out.
   - A design needs at least 6 ink points, so a stray tap never reaches the runway.
   - A design that is started but not sent goes in automatically about 1.8 s before time is up.
   - Each phone gets 3 drawing ideas ("a skateboarding dinosaur").
   - The TV shows a clothing rail that fills with blank tees carrying "?" tags. It shows counts only, never the art.
2. **Slogans** (50 s): write up to 6 slogans of 1–40 characters each.
   - Each phone rotates its own helper prompts ("A slogan your dentist would wear") with a *New idea* button.
   - Duplicate slogans from the same player are rejected.
   - The TV cycles a few helper prompts on a press card.
3. **Sewing room** (60 s): each player gets a hand of 3 designs and 3 slogans.
   - Hands are dealt from other players' parts first, then house fillers. Your own parts come last, and the least-dealt
     parts go first so everyone's work gets used.
   - You get one reroll for designs and one for slogans.
   - Pick a design, a slogan, one of 6 shirt colours (Snow, Midnight, Ring red, Royal, Gold, Hot pink) and the slogan
     spot (top or bottom). The phone shows a live preview.
   - Each player makes 1 shirt, or 2 shirts with 4 or fewer players. The second shirt comes from a fresh hand, and parts
     you already used are not dealt again.
   - At time-up the house stitches any missing shirts at random from each hand. These are marked *Auto-stitched* on the
     TV.
4. **Bouts**: the shirts are shuffled. The first two meet; the winner stays on the left as champ, and the next shirt
   enters as the challenger.
   - Each bout: the shirts walk out (3–4.2 s, with the ring bell), then a 13 s vote that ends early once everyone has
     voted, then the reveal (6.4 s).
   - Everyone votes except the makers of the two shirts in the ring. Makers stay anonymous until the reveal.
   - A tie keeps the champ in the ring, but it doesn't count as a ring win (streaks, "bouts won" and the final's
     tiebreak count real wins only).
   - Reveal beats: voters fly in, then the credits (maker, art by, words by), then the winner gets the belt, the loser
     gets a KO stamp, and the points land.
   - The footer shows the knocked-out shirts and the challengers still waiting.
5. **Champion** (9 s): the last shirt standing gets the belt and +500. The scoreboard animates from the start of the
   round.
6. **Main event**: the two round champions face off.
   - A "Main event!" title card opens it, then a 20 s vote at double points.
   - Ties go to the shirt with more ring wins, then a coin flip.
   - The winner becomes *Shirt of the night* and its maker gets +1000.
   - If one player made both champions, the bout still runs; that player just sits out the vote.

## Scoring

| Event | Points |
|---|---|
| Your shirt, per vote in a bout | 100 |
| Your design or slogan on someone else's shirt, per vote | 50 each |
| Round champion (maker) | +500 |
| Main event, per vote: maker / borrowed part | 200 / 100 |
| Shirt of the night (maker) | +1000 |

Using your own design or slogan, or a house part, pays nothing extra. Winners are the top scorers; ties share the win,
and nobody wins at zero. Awards go to a single leader only:

- **Champion Tailor**: maker of the shirt of the night.
- **Best Designer**: your designs appeared on shirts that earned the most votes.
- **Wordsmith**: your slogans appeared on shirts that earned the most votes.

## Pacing

These are worst-case times at standard pace, with every timer running out:

- 10 players: about 13.8 min.
- 4 players (8 shirts): about 12.3 min.

Real rooms finish creation phases and votes early, so a typical game takes about 9–11 min. Seeded bot games in the
tests finish well under 16 minutes of game time for 3, 4, 6 and 10 players.

## Content

`content.server.ts` is server only. All content is original:

- **Helper prompts:** 137 family and 20 adult.
- **House slogans:** 48 family and 10 adult, each 40 characters or fewer.
- **Drawing ideas:** 45.
- **House designs:** 17 line-art designs drawn in code in the shared drawing format: lightning bolt, heart, star,
  smiley, sun, flame, crown, pizza slice, cactus, rocket, ghost, cool cat, ringed planet, mountain sunrise, fish,
  mushroom and dumbbell.

Adult items are dealt only when `settings.family` is off. Helper prompts, drawing ideas and house slogans are marked with
the pack's `api.used` as they are dealt, so a replay in the same night deals fresh cards until a deck runs out (house
designs are a fixed set and reappear).

## Rendering

- **Media:** drawings travel compactly (`Packed`: ink index, width, then integer coordinates). They are put in
  `api.media` under opaque keys (`ss-<n>`) once, when the sewing room opens. The next round removes them, except the
  champion's art, which the final needs.
- **The shirt (`Tee`):** an SVG tee with folds and a collar, the design printed in the chest area, and the slogan set in
  Lilita.
  - The slogan auto-fits in container-query units by length, so the same component works for the 430 px TV runway, the
    phone preview and 62 px knock-out thumbnails.
  - Every stroke gets a contrasting edge (dark ink gets a cream edge, colours get an ink edge), so any design reads on
    any shirt colour.
  - Thin pens are thickened, because the pad draws at phone scale and the print is seen from the sofa.
  - The shared `DrawingRenderer` paints an opaque cream square, so the print uses its own SVG with the same data.
- **Shirt ids** are opaque (`sh<n>`). Public views never carry a maker before the bout's reveal.

## Audio

- **Music:** `think` while drawing, `think-2` while writing. The theme `shirt-show` ("Title Belt Strut",
  `music/tracks/shirt-show.ts`) plays through the sewing room, the bouts, the champion and the main event walk-out. The
  final uses `vote` for its vote and `reveal` for its reveal.
  - The theme is a 128 BPM E-minor ring-entrance anthem in four parts: a teased hook, the square-lead hook with brass
    answers, a brass "title belt" chorus, and a tom-and-clap breakdown with crowd stabs and a riser back into the top.
  - Bus levels: lead −19, brass −24, drums −16, bass −20 and guitar −24 dB; −16 LUFS.
- **SFX:**
  - Creation: scribble on each design, typewriter on each slogan, lock on *done*, whoosh on rerolls, stamp on each
    shirt.
  - Bouts: bell and swoosh at each start, whoosh as the challenger enters, ding when voting opens, vote on each vote.
  - Reveals: vote/pop as voters land and reveal on the credits; then the bell plus cheer (champ defends) or crash
    (challenger wins). A tie adds ooh, no votes adds aww, and a landslide adds an airhorn.
  - Champion: fanfare and applause. Main event: gong and airhorn to open; drumroll, then fanfare and applause.
  - Deadlines: tick-fast and timeup.
- **Narration:** `narration.ts`, 241 characters.
  - Minigame lines: intro, the first bout's bell, a 3+ win streak, and the main event.
  - Shared `host.*` lines: hurry, pencils down, time up, everyone in, vote, landslide, no votes, winner, close (final
    tiebreak) and final round.
  - Slogans are read aloud with the optional read-aloud voice as the shirts enter.

## Files

- `types.ts`: views, actions, scoring constants, compact drawing packing and reveal timing.
- `server.ts`: MiniServer.
- `content.server.ts`: the content banks above.
- `client.tsx`: TV `Display` and phone `Controller`, including `Tee`, `Print`, `Belt` and the arena.
- `styles.css`: scoped to `.hj-shirt-show`.
- `narration.ts`: narrator lines.
- `bot.ts`: draws 1–4 doodles per seat (20% at the full ink limit), writes 1–6 slogans (a quarter at 40 characters),
  sometimes rerolls, builds shirts and votes at random. It votes after a staggered 1.5–4.7 s look, so QA captures the
  live vote state.
- `qa.ts`: QA driver hook. It traces the bot's strokes on the real pad, types slogans, taps *done*, rerolls, taps the
  exact design, slogan, colour and spot, and votes.

Tests: `tests/shirt-show.test.ts`.

## QA evidence

Screenshots are under `output/hijinks/shirt-show/<run>/`. Every run used my own server on port 4454.

| Run | Roster | What | Result |
|---|---|---|---|
| `hj-b1-shirt-show-1/p10` | 10 (1 phone through the UI, 9 socket bots) | full night, all viewports, settled shots | 346 accepted, 0 rejected, 0 page errors |
| `hj-b1-shirt-show-2/p3` | 3 | full night, all viewports, settled shots | 74 accepted, 0 rejected, 0 errors |
| `hj-b1-shirt-show-2/p10-settled` | 10 | full night, settled TV shots (champion and final) | 346 accepted, 0 rejected, 0 errors |
| `hj-b1-shirt-show-4/focus` | 3 real phones, all through the UI | round 1, round 2, main event (`focus-script.mjs`) | 7/7 checks pass |
| `hj-b1-shirt-show-4/p10` | 10 | full night, all viewports, settled shots | 349 accepted, 0 rejected, 0 errors |
| `hj-b1-shirt-show-5/p3` | 3 | final build, full night, all viewports, settled shots | 77 accepted, 0 rejected, 0 errors |

Focused checks (`hj-b1-shirt-show-4/focus/focus.json`):

- The drawing draft survives a phone reload.
- The pad clears for the next design.
- A design reroll deals three new designs, and the button is then spent.
- A missing player's shirts are auto-stitched at time-up.
- A TV reloaded mid-reveal is back in 1.4 s on the same beat.
- No page or console errors.

Representative screenshots:

- **Studio:**
  - draw: `hj-b1-shirt-show-1/p10/settled-003-…-draw-1-t1-tv.png`
  - slogans: `hj-b1-shirt-show-1/p10/005-…-write-1-t2-tv.png`
  - sewing room: `hj-b1-shirt-show-4/focus/018-make-tv.png`
- **Bout, voting:** `hj-b1-shirt-show-4/p10/011-…-vote-1-t8-tv.png`, and with real drawings
  `hj-b1-shirt-show-4/focus/028-vote-tv.png`.
- **Bout, reveal:** `hj-b1-shirt-show-4/p10/settled-011-…-result-1-t9-tv.png`, and
  `hj-b1-shirt-show-4/focus/038-result-1-tv-3300ms.png`.
- **Champion:** `hj-b1-shirt-show-4/p10/settled-033-…-champ-1-t31-tv.png` (10 players) and
  `hj-b1-shirt-show-4/focus/045-champ-tv.png`.
- **Main event:**
  - title card: `hj-b1-shirt-show-4/focus/050-final-show-tv-title.png`
  - vote: `hj-b1-shirt-show-4/p10/settled-066-…-final-vote-2-t64-tv.png`
  - crowned: `hj-b1-shirt-show-4/focus/059-final-result-tv-5700ms.png`
- **Phones:**
  - draw (with 320/667 variants): `hj-b1-shirt-show-4/focus/004-draw-phone-sketch*.png`
  - 40-character slogan: `015-write-phone-40-320x568.png`
  - builder: `022-make-phone-built.png`
  - vote: `030-vote-phone-0*.png`
  - maker: `034-vote-phone-1-maker.png`
  - result: `039-041-result-phone-*.png`
  - final: `061-final-result-phone-0.png`

Fixes made from the screenshots:

- **Bout card:** the points sticker covered "Made by". It now sits inline after the maker.
- **Ring bell:** it read as an eyeball. It is now a brass bell with a hammer.
- **Slogans:** short slogans touched the shirt's edges. The text box is narrower and the sizes were retuned.
- **KO stamp:** it hid the whole losing shirt. It is now smaller and lower.
- **Studio:** the ring ropes crossed the copy, so they are fainter there.
- **Champion screen:** the title overlapped the scoreboard. It now sits above the shirt.
- **Main event:**
  - The crowned "Shirt of the night" plate was hidden by the belt; a gold sash under the winner replaces it.
  - The pre-vote cards showed both "Who made it?" and the known maker. They now show the maker only.
- **Phone draw:** the idea line is a compact single row, and the swatches fit on one line at 320 px. In short
  landscape, the pad scrolls into view.
- **Phone slogan:** the helper prompt is now the entry label, with an *Another idea* button.
- **Phone builder:** the preview is smaller.
- **Phone vote:**
  - Cards are stacked, with the slogan in readable text.
  - Landscape uses two columns without mid-word breaks.
  - The pending result shows both shirts.
- **Design rules:** a single stray dot became the round 2 champion design.
  - Designs now need 6 ink points.
  - Thin pens are thickened in prints.
- **Copy:**
  - "1 win in a row" now reads "holds the ring!".
  - A player whose art *and* words scored is told so.
- **QA tooling:** bot voters now take 1.5–4.7 s before voting, so the live vote state (timer, "N votes in") appears in
  screenshots.

Known limits:

- **Not tested on hardware:** physical phones and native keyboards; audio output (cues were verified only as requests).
- **No narrator recordings exist yet.** Narration lines return 0, and the fixed beats carry the timing.
- **Screenshot lag:** the QA driver's screenshot queue lags short phases at full viewport sets. The champion and
  crowned final were therefore verified with settled shots and the focused script.

## Independent review (2026-10-01)

A second agent reviewed the rules, content and screens and played builds `hj-b1-shirt-show-r1` to `-r3` on port 4455.
Evidence is in `output/hijinks/shirt-show/review-*/`. The focused UI script is `output/hijinks/shirt-show/review-focus.mjs`.
It is the builder's script plus reloads at 320×568 and 667×375, so mount-time layout runs as it would on a phone held
that way.

Fixed:

- **Shirt slogans on phones and TV thumbnails:** screen-level `p` rules (`.hj-done p`, `.ss-phone-result p` and
  `.ss-foot p`) overrode the print's font size. This affected:
  - the sewing-room "Stitched!" shirts and the champion phone ("UNDISPUTE / D CHAMPION", clipped);
  - the TV's knocked-out thumbnails, which showed ink blobs.

  The slogan rule is now `.ss-tee .ss-slogan`.
- **Ties:** a tie counted as a ring win for the holder. With an idle voter, a holder could rack up a "5-win streak" on
  no-vote ties, and those ties also fed the final's tiebreak. Ties no longer count, and the streak banner skips ties.
  Tested.
- **Phone tie copy:** a tie told the challenger's maker "Knocked out!". It now reads "Tied! The champ stays on", "Tied!
  You keep the ring" or "A dead heat!".
- **Phone result:** the screen was only an avatar and a rank. It now shows both shirts with their vote counts, and the
  loser greys out.
  - A maker whose shirt lost but whose art or words scored on the rival's shirt is now told so.
- **Final vote music:** this README promised the `vote` bed, but the music stayed on the theme. The bed now plays.
  Tested.
- **Phone layouts:**
  - Drawing in short landscape: the pad now fills the height on the left, with inks, tools and buttons on the right.
    It was a 187 px pad below the fold.
  - Drawing on short portrait screens: the pad and its buttons scroll into view.
  - Sewing room in short landscape: the preview is pinned on the left and the picks scroll on the right.
  - Sewing room on short portrait screens: the preview is smaller.
- **Copy:**
  - "Your shirts fight anonymously" now uses the plural for two shirts.
  - The phone's first-bout label reads "In the ring", matching the TV, instead of "Champ".
  - The sewing room TV says the parts come from other players; it used to say "from the pile".
- **Content:** three unclear helper prompts were reworded. "Replies 'k'" moved to the family bank (it isn't adult) and
  was replaced by an adult prompt.
- **Test robustness:** the scoring test's preferred parts were only in a player's hand by luck of the seed. The helper
  now deals them into the hand deterministically.

- **TV lineup:** the vertical "Knocked out" label made its box taller than the "Waiting" box, so it now reads "Out".

Review runs (all 0 page errors, 0 rejected actions):

| Run | Build | Roster | Result |
|---|---|---|---|
| `review-1/p10` | r1 | 10, all phone + TV viewports, settled shots | 346 accepted |
| `review-2/focus`, `review-3/focus` | r2, r3 | 3 real phones through the UI (`review-focus.mjs`) | 7/7 checks pass |
| `review-3/p3` | r3 | 3, all phone + TV viewports, settled shots | 76 accepted |
| `review-4/p10-settled` | r4 (final) | 10, settled TV shots | 350 accepted |
