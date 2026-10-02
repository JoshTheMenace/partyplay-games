# Airlock

Hijinks minigame `airlock`: a hidden-traitor game for 4–10 players. One alien (two from 7 players) hides among the crew of
a starship heading for Earth. Every test, the crew answers a question on their phones, while the aliens get a slightly
different question, so their answers stand out a little. Anyone can push the giant red AIRLOCK button to space suspects,
but only a unanimous vote opens the doors. Art direction: a retro-futurist starship bridge. A riveted viewport onto
drifting parallax stars, blinking console lights, a round porthole where Earth grows closer every test, hazard stripes, a
giant red button, an airlock chamber whose doors slide open onto space, and red-alert beacons that sweep the room during a
vote. The palette is deep navy, alert red, hazard amber and alien green. Theme music: `music/tracks/airlock.ts`, "Red
Button Bossa": space-age lounge in D minor, with a gliding theremin tune over a bossa groove, a bouncing analog bass, a
pulse-synth console arpeggio, random computer bleeps, a vibes bridge in F, and a red-alert brass stab that loops to the top.

## Rules

Setup: aliens are chosen at random from the connected players (1 for 4–6 players, 2 for 7–10). Aliens know each other.
The game is at most 7 tests: every kind once (never opening on a drawing), then two more quick ones, never the same kind
twice in a row. The header's route counts down "Earth in N tests" while a ship slides toward Earth.

1. **Briefing** (10 s). The TV shows a crew manifest of ID cards with a green scan sweep, "An alien is aboard!" (or two)
   and the three rules. Every phone shows a secret ID card: **press and hold to peek**. Crew and alien cards look identical
   until held (same colours, tab, size and copy length), so a glance over a shoulder gives nothing away.
2. **Test** (pace-scaled: Word Scan 35 s, Gut Gauge 20 s, Crew Poll 20 s, Doodle Scan 20 s, Icon Test 15 s). The TV shows
   the test name, how to answer, the porthole and who has answered, never the question. Phones show "Your test":
   - **Word Scan**: a short text answer (1–40 characters). *Name a breakfast food* / aliens: *Name a dinner food*.
   - **Gut Gauge**: rate 1–10. *How much do you like rain?* / *…sunshine?*
   - **Crew Poll**: pick a player, yourself included. *Who is the best cook?* / *…worst cook?*
   - **Doodle Scan**: a 20-second drawing. *Draw a cat* / *Draw a dog*.
   - **Icon Test**: one of four pictures (everyone sees the same four). *Which makes the best pet?* / *…worst pet?*

   Picks are persisted drafts and lock themselves in 0.9 s before the buzzer; a started doodle sends itself 1.6 s before.
   Missing answers stay empty ("No answer" on the TV, which is itself a little suspicious).
   **Scan ship computer** (one per phone per game, same button on every phone): for an alien it is the team's single
   **hack**, revealing the crew's real question to every alien for this test. For a crewmate it just confirms "Scan clear:
   this is the real test." Scans are silent on the TV and invisible in the public view.
3. **Results** (server-timed, about 6–9 s). "The crew's real test" drops in, then each answer flips in roster order:
   answer cards, a 1–10 bar chart per player, picked crewmates, doodles, or avatars piling under the four icons. A summary
   line follows (matching answers, average/lowest/highest, most picked, and who didn't answer).
4. **Discussion** (25 s). The board stays up beside a pulsing big red button and the ready count. Phones show the push
   button (pushes left), your own test and *Ready for the next test*. Discussion ends early when every connected player is
   ready.
5. **The Button.** During a discussion any player with pushes left (2 per game) taps the button, picks exactly as many
   suspects as there are aliens (never themselves), and taps *Push it!*. Red alert: the TV shows the suspects in the
   airlock with what they answered, the pusher, and the voters. Everyone outside the airlock votes **AIRLOCK** or
   **ABORT** (10 s); the pusher's vote is AIRLOCK, suspects can't vote, and missing votes count as ABORT. Offline players
   are not waited for or counted.
6. **Verdict** (server-timed). Votes flip one by one. Any ABORT: an ABORTED stamp and the discussion resumes with the time
   it had left (at least 10 s). Unanimous AIRLOCK: the doors slide open, the suspects tumble into space, and each one is
   stamped **HUMAN!** or **ALIEN!** (antennae sprout, green glow).
   - All aliens spaced → the crew wins. Any human spaced → the aliens win immediately.
7. **Arrival.** If the 7th test's discussion ends with no ejection, the ship reaches Earth and the aliens win.
8. **Mission report** (server-timed, about 13–14 s). The aliens are unmasked one by one, the winners banner, then the
   animated scoreboard.

## Scoring

| Event | Points |
| --- | --- |
| Every member of the winning team | +1000 |
| Aliens win: per test survived (tests that reached their results) | +500 each alien |
| The pusher whose ejection won the game for their own team (crew spacing the aliens, or an alien framing a human) | +500 |

The losing team scores 0. `MiniResult.winners` is the whole winning team (even when the pusher has more points), and the
headline says how it ended: "The alien got spaced!" / "Both aliens got spaced!", "A human got spaced. Aliens win!" or
"The aliens reached Earth!". Awards: **Airlock Hero** (crew pusher who caught the aliens), **Master Framer** (alien pusher
who spaced a human), **Most Suspicious** (most times in the airlock, at least 2, unique), **Perfect Disguise** (the only
never-suspected alien on a winning alien team) and **Sneaky Hacker** (the alien who used the hack).

## Pacing

Tests 15–35 s, results 6–9 s, discussion 25 s (or until everyone is ready): about 55–75 s per test, so a full seven-test
trip runs 7–10 minutes, plus about 25 s for each button push. Timers follow the pack's pace setting.

## Privacy

- The public view never names an alien before the verdict of an ejection or the mission report. It holds only the alien
  count, the crew's prompt (after the answers are in) and per-player answers. A test checks the public view is
  byte-identical whoever the aliens are, through tests, results, discussions, a push and an abort.
- Private views: your role, your allies (aliens only), your version of the test, your scan result. Crew views never
  contain an alien id or the alien prompt; alien views never contain the crew prompt unless the hack was used.
- Phones look the same for both roles: the ID card is hold-to-peek, the scan button is on every phone, and the prompt card
  has the same layout.
- Drawings reach the media store only when the answers flip, under seat keys, and are removed at the next test.

## Content

`content.server.ts`: 180 original prompt pairs (crew prompt, alien near miss). 158 family, 22 adult-tagged (filtered when
`settings.family`):

| Kind | Family | Adult |
| --- | --- | --- |
| Word Scan | 40 | 6 |
| Gut Gauge | 32 | 5 |
| Crew Poll | 30 | 6 |
| Doodle Scan | 30 | 2 |
| Icon Test (32 original SVG icons in `art.tsx`) | 26 | 3 |

Each dealt pair is marked in `api.used` (`kind:crew prompt`), and decks deal unused pairs first, so replays in one night
don't repeat tests. Narration (`narration.ts`, 240 characters): intro, button pushed, alien spaced, human spaced, aliens
reach Earth. Generic moments use shared `host.*` lines (final round, everyone in, time's up, votes in, winner).

## Files

`types.ts` views/actions/beats · `server.ts` rules · `content.server.ts` bank · `client.tsx` TV + phone · `art.tsx`
icons, button, Earth, ship, antennae · `styles.css` · `narration.ts` · `bot.ts` · `qa.ts` · tests in
`tests/airlock.test.ts`.

## QA evidence

Static checks: `tests/airlock.test.ts` has 16 tests and all pass; with `tests/pack.test.ts` it is 33 of 33. They cover bot
games at 4/6/7/10 players with no rejections, setup, prompts, the privacy invariance check, hack and scan, every scoring
path, two-alien pushes, arrival, aborts and push limits, validation, missing answers and disconnects, drawings in media,
pace, the family filter, night memory and content counts. Under `flock`, whole-project `tsc --noEmit` exits 0 and
`npx oxlint packages/games/hijinks` exits 0.

Browser QA used isolated builds on port 4478 and `tools/qa-driver.ts` with `--phone-viewports --tv-viewports --settled`.
Shots are under `output/hijinks/airlock/<run>/p<players>/`.

| Run | Players | Flow | Result |
| --- | --- | --- | --- |
| hj-b2-airlock-1/p10 | 10 | 5 pushes in test 1 (bots re-rolled every resumed discussion), eject of two humans | 0 page errors, 0 overflow |
| hj-b2-airlock-1/p4 | 4 | 2 tests, then a human spaced | 0 errors |
| hj-b2-airlock-2/p10 | 10 | all 7 tests (every kind), 1 push aborted, arrival at Earth | 0 errors, 0 rejected actions |
| hj-b2-airlock-3/p4 | 4 | 7 tests, 2 pushes aborted, arrival | 0 errors, 0 rejected |
| hj-b2-airlock-3/p10 | 10 | 7 tests, 1 push aborted, arrival | 0 errors, 0 rejected |

Fixes made from the screenshots:

- **Route Earth.** It rendered at full width over the header, because `.al-earth` came later in the CSS than the route
  rule.
- **Vote list.** Voter names broke mid-word ("Wobbleto/n") once the wider AIRLOCK chips appeared. Chips now sit under the
  name.
- **Spaced suspects.** The role stamps covered their faces. Stamps now sit under the placard, and the tumble ends upright.
- **Unmasked aliens.** A hue-rotate filter turned them olive. They now get a green glow and antennae only.
- **Mission report scoreboard.** It collapsed to zero width inside `place-items: center`, because the rows are absolutely
  positioned.
- **Airlock doors.** They gained an "AIR | LOCK" stencil that splits as they open. The pressed big button joins the
  pusher panel, and the verdict phone shows the suspects.
- **Airlock labels.** These now read "picked themself", "rated it 7/10" and "said “toast”".
- **Phone ID tab.** It wrapped over the card at 320 px; it no longer wraps.
- **Doodle phone.** The ID card is compact (the same for both roles), the send button is sticky, the pad scrolls into view
  on short screens, and in landscape the pad sits beside its tools.
- **Bot pacing for QA.** Bots answer after 8 s and push only from test 4, about 4 % per bot per discussion.

Best screenshots:

- **Brief and tests:**
  - briefing: `hj-b2-airlock-1/p10/004-mini-1-airlock-brief-t1-tv.png`
  - test: `hj-b2-airlock-2/p10/settled-013-mini-1-airlock-test-t11-tv.png`
- **Boards:**
  - answers: `hj-b2-airlock-1/p10/settled-009-mini-1-airlock-discuss-t7-tv.png`
  - ratings: `hj-b2-airlock-2/p10/settled-006-mini-1-airlock-discuss-t4-tv.png`
  - icons: `hj-b2-airlock-2/p10/settled-010-mini-1-airlock-test-t8-tv.png`
  - doodles: `hj-b2-airlock-2/p10/settled-012-mini-1-airlock-discuss-t10-tv.png`
- **Red alert:**
  - vote: `hj-b2-airlock-2/p10/018-mini-1-airlock-results-t15-tv.png`
  - abort: `hj-b2-airlock-3/p10/settled-017-mini-1-airlock-results-t15-tv.png`
  - airlock open (before the stamp fix): `hj-b2-airlock-1/p10/settled-010-mini-1-airlock-vote-t8-tv.png`
- **Ending:**
  - aliens win: `hj-b2-airlock-1/p10/settled-011-mini-1-airlock-verdict-t9-tv.png`
  - podium: `hj-b2-airlock-2/p10/settled-019-mini-1-airlock-test-t17-tv.png`
- **Phones:**
  - discussion: `hj-b2-airlock-1/p10/008-mini-1-airlock-vote-t5-phone.png`
  - doodle at 320 and 667: `hj-b2-airlock-3/p4/008-mini-1-airlock-test-t5-phone-*.png`

The driver's shot queue lags the game by several seconds at 10 players with five viewports, so file labels often name an
earlier phase than the one shown. Titles that animate in can also appear missing in the first 1920 shot of a
backgrounded TV page (the 1280 re-shot shows them). Not seen in the final build: the stamp-under-placard eject reveal and
the mission report's scoreboard beat. Both are CSS fixes checked against the markup; no eject happened in run 3, and the
scoreboard beat (5.4 s) falls between the settled shot (4.5 s) and the podium.

Remaining limits:

- **Not tested:** physical phones, real audio playback and human typing or drawing speed.
- **Narration:** the `airlock.*` lines have no recordings, so `api.say` returns 0 for them and fixed beats carry the timing.
- **Bot answers** are word salad, not on-topic answers. Spotting the aliens in QA screenshots isn't meaningful.
