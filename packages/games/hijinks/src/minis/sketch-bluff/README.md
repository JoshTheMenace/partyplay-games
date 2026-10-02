# Sketch Bluff

Drawing bluff for 3–10 players, set at a black-tie gallery gala: velvet damask walls, gilt frames under picture lights,
brass title plaques, velvet ropes and a monocle for the house. Everyone draws a secret, ridiculous prompt; then each
drawing is hung, the other players forge fake titles for it, and the room hunts for the real one.

## Flow

1. **Draw** (80 s): every player gets a different prompt (“a dignified walrus filing taxes”) and draws it with the shared
   `DrawingPad` (shared `parseDrawing` limits: 24 strokes, 480 points). The TV shows a studio wall of easels that get a
   velvet drape when an artist finishes. A started drawing is handed in automatically ~1.8 s before time runs out.
   Drawings are stored with `api.media.put` under opaque keys (`sb-<round>-<index>`) once the studio closes.
   Players who never drew skip their gallery turn; if nobody drew, the round goes straight to the exhibition.
2. **Title** (35 s, per piece): the drawing is unveiled framed on the TV with its artist on a brass plate. Everyone except
   the artist writes a fake title (1–40 characters, stored in the gallery's house style: lower case, curly apostrophes and
   no closing full stop, so typing habits never give a forgery away; the phone placeholder shows the title style). Titles that
   loosely match the real prompt (case, punctuation, articles and plural *s* ignored) are rejected with
   “Too close to the real title!”; a title another forger already filed is rejected too. *Title for me* offers three house
   titles (different for every forger) that file with one tap.
3. **Guess** (20 s): every forgery, the real title and house decoys (padding to at least four options) appear in shuffled
   order behind opaque ids. Forgers pick one (never their own); the artist does not guess. Everyone, the artist included,
   can give up to two likes (♥, toggleable) to titles that are not their own. The phase ends when every connected forger
   has guessed and 1.5 s have passed since the last guess (late likes), or on the deadline.
4. **Reveal** (server-timed beats, reload-safe): chosen forgeries and house decoys one by one, fewest fooled first —
   title, then who fell for it, then the FORGERY stamp with the author and points (or HOUSE FORGERY with the monocle);
   each verdict stays up at least 1.6 s even when nine forgeries are unmasked (3.2 s per beat, 3.6 s for five or fewer).
   The real title comes last with a GENUINE seal and who found it, then the artist's celebration (or “The artist weeps”),
   then a tally of what the piece earned (points and likes per player). Public views contain only beats that have started.
5. **Exhibition** (9 s, after each round): the round's drawings with their real titles beside the animated scoreboard.

Rounds: two rounds (round 2 doubles) for 3–5 players, one long gallery for 6–10 players.

## Scoring (× round multiplier, except likes)

| Event | Points |
|---|---|
| You find the real title | 1000 |
| Artist, per player who found the real title | 500 |
| Your forgery, per player it fooled | 500 |
| Each like on your forgery (likes on the real title go to the artist) | 50 |

House decoys fool people for nobody's benefit. Winners are the top scorers (ties share; nobody wins at zero).
Awards (single leader only): **Best Artist** (most correct guesses on your art), **Master Forger** (most players fooled),
**Crowd Pleaser** (most likes).

## Pacing

Worst case, with every timer running out and every guess on a different forgery: 5 players × 2 rounds ≈ 16.5 min;
10 players × 1 round ≈ 17.5 min. One idle phone (every timer runs out, about five forgeries chosen) is ≈ 15.5 min at 10
players. Real rooms finish titles and guesses early (all-in advances), so a typical 10-player game is ≈ 11–12 min. Bot games in the tests
(seeded) run in well under 15 minutes of game time for 3, 5, 7 and 10 players.

## Content

`content.server.ts` (server only): 276 family prompts, 32 adult prompts, 112 family house titles and 12 adult house titles,
all original, at most 40 characters, written in the same lower-case gallery-title voice so house titles blend with real
ones. Adult items are only dealt when `settings.family` is off. Tests check that every prompt and decoy is distinct even
under the loose title match. Prompts are marked with the pack's `api.used` as they are dealt, so a replay in the same
night draws fresh prompts until the bank runs out (house titles rotate freely).

## Audio

- Music: `sketch-bluff` (“Velvet Rope Waltz”, music/tracks/sketch-bluff.ts) in the studio, while titling and in the
  exhibition; shared `vote` while guessing and `reveal` under the unmasking.
- SFX: scribble on hand-in, camera + swoosh on each unveiling, submit, vote, pop for likes, swoosh / vote / stamp + laugh
  or ooh for each forgery, drumroll → correct + applause (or aww) → cheer + score-up for the truth, coin + score-up for the
  tally, gong and fanfare between rounds, tick-fast and timeup for deadlines.
- Narration (`narration.ts`, 219 characters): intro, first unveiling, “And the true title is…”, nobody found it; shared
  `host.*` lines for hurry, pencils down, everyone in, vote, reveal, final round and scores. Revealed titles are read
  aloud with the optional read-aloud voice.

## Files

`types.ts` (views, actions, title matching, reveal timing), `server.ts` (MiniServer), `content.server.ts`, `client.tsx`
(TV Display + phone Controller), `styles.css` (scoped `.hj-sketch-bluff`), `narration.ts`, `bot.ts` (doodles, sometimes at
the full ink limit; forges titles, sometimes at 40 characters), `qa.ts` (QA driver hook: traces the bot's strokes on the
real pad with the mouse, types titles, taps guesses and likes). Tests: `tests/sketch-bluff.test.ts`.

## QA evidence (2026-10-01)

All under `output/hijinks/sketch-bluff/`. Builds `hj-b1-sketch-bluff-1…6` on port 4452; only `-6` is kept in
`output/builds`. Every driver run: 0 page errors, 0 rejected actions, night completed to results.

| Run | Roster | What |
|---|---|---|
| `hj-b1-sketch-bluff-2/p10`, `-3/p10`, `-5/p10`, `-6/p10` | 10 (1 UI phone + 9 socket bots) | full night, TV 1920 + 1280, phones 390×844 / 320×568 / 667×375, settled shots |
| `-2/p3`, `-3/p3`, `-4/p3`, `-5/p3` | 3 | full night (two rounds), same viewports |
| `-6/p10-reveals` | 10 | copy of the driver (`qa-sampler.ts`) that also shoots the TV 9, 14, 19 and 25 s into each reveal |
| `-3…-6/focus` (`focus-script.mjs`) | 3 real phones, all through the UI | draft survives a phone reload; a started drawing is handed in automatically at time-up; the real title is rejected as too close; Title for me; likes; reveal sampled every 1.5 s; TV reload mid-reveal returns in 0.8–1.3 s on the server's current beat |

The phone in the driver runs plays through `qa.ts` (it traces the bot's strokes on the real pad with the mouse, switching
ink colours, then taps Hang it; types titles; taps guesses and likes).

Best screenshots: studio `-6/p10/004-…-draw-1-t1-tv.png`; unveiling `-5/focus/012-title-tv.png`; ten-option guess
`-6/p10/006-…-guess-1-t3-tv.png`; forgery verdict `-6/p10-reveals/settled-006-…-14000-tv.png`; genuine + artist
`-6/p10-reveals/settled-006-…-19000-tv.png`; tally `-5/focus/039-reveal-tv-12.0s.png`; exhibition (10 pieces)
`-3/p10/settled-034-…-scores-1-t32-tv.png`, (3 pieces) `-3/p3/settled-013-…-scores-1-t11-tv.png`; podium
`-2/p10/037-podium-settled-tv.png`; phone pad `-5/focus/004-draw-phone-sketch.png`, short landscape
`-4/p3/004-…-draw-1-t1-phone-667x375.png`; phone ballot `-5/focus/024-guess-phone.png`; phone reveal
`-5/focus/034-reveal-phone-fooled.png`.

Fixed during QA: studio frames and the title-phase frame pushed name plates into the ropes; the header piece count used a
stroked numeral; the reveal panel was centred with dead space below, fooled players were bare avatars (now name badges)
and beat changes faded the whole panel to nothing; the exhibition overflowed with 10 pieces and wrapped 3 pieces onto two
rows; ten options plus the roster overflowed the guess screen (compact roster, tighter plaques); on 667×375 the pad was
not square (pointer and ink misaligned) and fell below the fold (now centred, and re-centred on rotation); swatches wrapped
on 320 px; the 40-character title was cut off in a one-line input (now multiline); on 320×568 the title box sat under the
sticky button (thumbnail hidden on short portrait phones); the phone reveal was an empty wait screen (now the piece, your
guess and your forgery, then outcome lines in sync with the TV).

Independent review (2026-10-01, builds `hj-b1-sketch-bluff-r1`/`-r2` on port 4453, only `-r2` kept): `review-1/p10`,
`review-2/p10` (10 players) and `review-2/p3` (3 players) full nights with every viewport and settled reveal shots, plus
`review-2/focus2` (`review-focus.mjs`: the focus checks with the tally captured inside the sampling loop). All runs: 0 page
errors, 0 rejected actions; 6/6 focus checks pass. Fixed: straight apostrophes and a closing full stop told forgeries from
real titles (now normalised); forgery verdicts were up for only 1.1 s with many forgeries (now ≥ 1.6 s, tested); the reveal
history, studio name plates and title-phase artist plate ran into the floor; "Fell for it" wrapped badges under its label;
guess plaques used mixed type sizes; the exhibition's 7–10 pieces were tiny; the phone reveal pushed your stakes below the
fold on 320×568; "Title for me" offers opened below the fold; near-duplicate prompts replaced. Best shots: studio
`review-2/p10/004-…-draw-1-t1-tv.png`, forgery `review-2/p10/settled-006-…-19000-tv.png`, exhibition
`review-2/p10/settled-034-…-scores-1-t32-4500-tv.png`, phone offers `review-2/focus/021-title-phone-offers.png`, phone tally
`review-2/focus2/040-tally-phone-0.png`.

Not verified: physical phones and keyboards, real audio output, human drawing/typing pace, real TV distance. No narrator
recordings exist yet, so `api.say` returns 0 and the fixed beats carry the timing.
