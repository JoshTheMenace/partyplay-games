# Odd One In

Hijinks minigame `odd-one-in`: find the faker, for 3–10 players. Everyone gets a secret task on their phone except one
faker, who only learns the category. Everyone answers, then acts it out for real on the TV's count of three. The room
argues, then accuses. Art direction: a retro spy-agency interrogation room. It has a noir teal wall striped by
venetian-blind light, a swinging enamel lamp with a hot bulb and a light cone, manila case files with paper clips and
typewritten copy, red and blue rubber stamps, fingerprints, and a police line-up with a height chart. The palette is
playful: teal, manila, lamp yellow and stamp red. Theme music: `music/tracks/odd-one-in.ts`, "Trench Coat Tiptoe". It is
spy-jazz in C minor: a sneaky upright ostinato, a baritone twang riff, a vibes line cliché, bongos and snaps, and a brass
minor-major stab.

## Rules

There are 3 cases (4 with 6 or more players). Each case has one category and a new secret faker. The faker is a connected
player who has faked the fewest times, and never the previous case's faker. Each case has up to 3 tasks with the same
faker, and ends when the faker is caught.

1. **Case card** (6.5 s, first task of a case only). The TV shows the category's file: name, public stem, how to answer,
   and "One of you is faking". Every phone shows the same case file.
2. **Task** (20 s). An innocent's phone shows the secret task in a manila "Top secret" dossier. The faker's phone shows
   *You're the faker! Blend in.* in the same dossier, with the same tab (category name), title, eyebrow, timer and picker.
   The dossier has a fixed minimum height, so both phones are the same layout and size. Everyone picks an answer and
   locks it in. The pick draft survives a reload, and a pick that is still unsent 0.9 s before the buzzer locks itself
   in, so a forgotten *Lock it in* never turns into a random answer.
   - **Hands Up**: *Raise your hand if you've ever…* Answer hand up or hand down.
   - **Number Crunch**: *How many…* or *From 0 to 10…* Answer with a 0–10 grid. For counts, 10 means ten or more.
   - **Point Blank**: *Point at the player most likely to…* Pick any player, yourself included.
   - **Face Value**: *Make the face you'd make if…* Pick one of eight illustrated faces: Gasp!, Smug, Yuck, Eek!, Joy,
     Huh?, Fuming or Swoon.

   The task ends early 1.5 s after every connected player has locked in. Missing answers become random picks, tagged
   "No answer: random" on the TV.
3. **Reveal** (8 s, server-timed). The TV shows "Do it for real on 3!" and counts 3-2-1 while every phone counts too.
   Then a camera flash, every card flips at once with avatars, and the act cue appears ("Hands up!", "Point!"…). At
   4.8 s "The real task was…" drops in.
4. **Discussion** (30 s). The evidence board stays up with a summary: hands up/down, average and range, or the most
   pointed-at or most-made face. A big *Who's faking?* timer runs. Phones show the real task, your answer and an
   *I'm ready to vote* button. Discussion ends early when every connected player is ready.
5. **Vote** (20 s). The TV shows "Point the finger!": a line-up of every player against a height chart, with what each
   player said. Phones list everyone but you, showing what each player said and whether they're cleared. You select a
   suspect, then tap *Accuse!* (an unsent choice locks itself in at the buzzer, like answers). The faker votes too, and
   nobody can accuse themselves.
6. **Verdict** (9.8 s, server-timed). Voter avatars drop in and pile up the height chart above each suspect, with the
   count on top; the accused is spotlit, then stamped.
   The accused is the one player with strictly the most votes: a plurality, not a majority of the room (at 10 players,
   3 votes can be enough). The TV and the phone vote screen both say so.
   - **Caught**: the accused is the faker. A FAKER! stamp, buzzer and confetti, and the case closes.
   - **Framed**: the accused is innocent. A sympathetic FRAMED! stamp, a sad avatar and an *aww*. That player is marked
     Cleared for the rest of the case (from the next task on, so the tag can't spoil the stamp). The faker stays secret and the next task starts.
   - **Hung jury**: a tie for most votes (even one that includes the faker), or no votes. The faker slips away.
7. **Case closed** (12 s). The mugshot file reveals the faker after a beat, with a placard and a CAUGHT or MASTER OF
   DISGUISE stamp. It also shows the faker's trail: each task and what they answered. The scoreboard then animates
   from the scores before the case. The faker's identity first appears here, or on the verdict screen when caught.

## Scoring

| Event | Points |
| --- | --- |
| An innocent's vote names the faker (any task of the case, caught or not) | +500 per vote |
| Faker caught: team bonus for every innocent | +100 |
| Faker survives a task (framed or hung jury) | +500 to the faker |
| Faker survives all 3 tasks: Master of Disguise | +1000 bonus (2500 total) |

Balance (batch 2): correct votes used to pay only on a catch (+500, everyone else +200). With plurality verdicts at 10
players the vote often splits, so the detectives who were right but outvoted got nothing, while only 4 of 10 players
ever get to fake. Every correct vote now pays, and the shared catch bonus is a smaller +100. In a 12-game harness
simulation at 10 players with moderately sharp detectives (30 % extra chance to name the faker) fakers took 42 % of
wins (4 of 10 seats fake, so 40 % is par) and the catch rate was 92 %.

Points are banked when the case closes. Scores never move mid-case, because a score change would expose the faker.
Winners are everyone tied on the top score (none if the top score is 0). Awards (unique leader only):

- **Best Detective**: most votes for the faker, across all tasks.
- **Smoothest Faker**: most tasks survived as the faker.
- **Usual Suspect**: most votes received while innocent (at least 2).

The podium headline counts the catches: "2 of 3 fakers caught", "Every faker was caught!" or "Not one faker was caught!".

## Pacing

With humans at standard pace, one task is about 75–85 s (task ≈ 15 s + reveal 8 s + discussion up to 30 s + vote ≈ 15 s
+ verdict 9.8 s). A case is 1–3 tasks plus the case card and the 12 s file. A night is therefore about 9–14 minutes. With
bots in the harness, a game takes 2.4–4.3 min with 3 players and 5–7 min with 6–10 players. Task, discussion and vote
timers scale with the pack pace; the beats are fixed. Every beat is derived from the phase start (`at`) through
`useTimeline`, so a reloaded TV or phone lands on the same moment.

## Privacy

- The public view never names the faker before a catch. Only these carry the faker:
  - `faker` on a caught verdict;
  - `closed` on the case file.
- The task text is public only from the reveal on.
- Private views carry only that player's own role, dossier (the task or `FAKER_BRIEF`), answer, readiness and vote. The
  faker's private view has exactly the same fields as an innocent's.
- SFX cues are the same for every player's submissions.
- On the verdict screen, the faker's phone shows the same text as everyone else's until the case closes.

The tests cover all of this.

## Content (`content.server.ts`, server only)

325 original tasks: **276 family + 49 adult** across the four categories.

| Category | Family | Adult |
| --- | --- | --- |
| Hands Up | 70 | 13 |
| Number Crunch | 70 | 12 |
| Point Blank | 68 | 12 |
| Face Value | 68 | 12 |

Adult items (dating, hangovers, exes, bars) are filtered when `settings.family` is on. Tasks never repeat within a game, and a replay in the same night
deals tasks not used tonight first (the pack's `api.used` night memory).
Each case uses a different category, picked at random.

## Narration (`narration.ts`, 231 characters)

- `odd-one-in.intro`
- `odd-one-in.caught`
- `odd-one-in.framed`
- `odd-one-in.escaped`

Shared lines: `host.final-round` (last case card), `host.tie` (hung jury with votes) and `host.no-votes`.

## Audio cues

- **Music:** `odd-one-in` for case cards, tasks, reveal, discussion and case files; `vote` for the line-up; `reveal` under
  verdicts.
- **SFX:**
  - case card: typewriter and stamp;
  - task: swoosh-in; each lock-in: submit; everyone in: lock; tick-fast at 5 s; timeup;
  - reveal: tick ×3, camera and reveal on the flip, pop and read-aloud of the real task;
  - discussion: sting; heartbeat at 8 s left; ready: tap;
  - vote: ding, then vote on each accusation;
  - verdict: drumroll; whoosh as votes fly in; gasp on the spotlight (heartbeat on a hung jury); buzzer and cheer on a
    catch; record-scratch and aww on a frame; ooh on a hung jury;
  - case file: stamp, plus fanfare when the faker escapes; score-up.

## Files

- `types.ts`: views, actions, categories, faces, beats.
- `server.ts`
- `content.server.ts`
- `client.tsx`
- `art.tsx`: lamp, fingerprint, hands, pointer, counter, eight faces.
- `styles.css`: `.hj-odd-one-in`, `ooi-*`.
- `narration.ts`
- `bot.ts`: answers after 2.5 s and talks for 6 s. Sleuthing bots accuse the oddest answer 60 % of the time; the faker
  bot accuses at random.
- `qa.ts`: real phone UI taps.
- `tests/odd-one-in.test.ts`
- `music/tracks/odd-one-in.ts` → `public/games/hijinks/music/odd-one-in.mp3`

## QA evidence

- **Focused tests:** 14/14 (`node --import tsx --test packages/games/hijinks/tests/odd-one-in.test.ts`). They cover:
  - bot games at 3, 6 and 10 players;
  - each scoring path: caught, framed, hung, escaped, and a tie that includes the faker;
  - a 10-player plurality catch (3 of 10 votes) and a 3–3 tie at the top;
  - night memory: a replay deals none of the first game's tasks;
  - missing-answer defaults, disconnects, validation, Point Blank self-picks;
  - privacy, the family filter, content counts and awards.
- **Static checks:** whole-project `tsc` and `oxlint` are clean.
- **Browser QA:** the builder's runs are in `output/hijinks/odd-one-in/hj-b1-odd-one-in-<n>/`; the independent review's are
  in `review-<n>/` (final build `hj-b1-odd-one-in-r5`).
  - `review-4/p10/` and `review-4/p3/` (r4) and `review-5/p3/` (r5, retest of the number picker): `tools/qa-driver.ts` full
    games with phone viewports, 0 rejected actions and 0 page errors.
  - `review-3/focus/`: `output/hijinks/odd-one-in/review-focus.mjs`, three real phones. It checks faker/task layout identity
    at three sizes, that an unsent answer and an unsent accusation lock themselves in at the buzzer, the vote tower and
    a framed then caught case.
  - `focus-script.mjs` (builder) also covers draft restore after reload and a TV reload mid-verdict.

## Known gaps

- **Draw Quick** (the optional 15 s doodle category) is not built. Four categories cover four cases.
- Acting it out happens in the room. The game can't see who raised a hand, so it trusts the phone answers.
- No narrator recordings yet: `api.say` returns 0, and beats use fixed timings.
