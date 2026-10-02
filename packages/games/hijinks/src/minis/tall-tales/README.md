# Tall Tales

Hijinks minigame `tall-tales`: bluffing trivia for 3–10 players. Art direction: a retro tabloid newsroom ("The Tall Tales
Tribune"): newsprint with halftone dots, ink rules, taped cuttings, an EXTRA! starburst, red rubber stamps (FIB!, TRUTH,
PICKED!) and an original typewriter illustration. Theme music: `music/tracks/tall-tales.ts`, "Hot Off the Press" (newsreel
ragtime with a typewriter breakdown).

## Rules

Seven true-but-weird stories: Round 1 (3 stories, ×1), Round 2 (3 stories, ×2), the Final Tall Tale (1 story, ×3).

1. **Pick** (10 s): the editor (rotating through connected players; the rotation resumes after whoever covered for an offline
   player) picks one of four teasers on their phone. Time-out or an offline editor → a random pick. The TV stamps PICKED! for 1.8 s.
2. **Write** (45 s): the story appears with one blank. Everyone files a believable lie (≤ 45 characters). A lie matching the
   answer or an accepted variant (case, accents, punctuation, a/an/the, plurals, spacing, number words) is refused with
   “That’s the truth! Write a lie instead.” **Lie for me** offers two house lies; picking one files it at 75 % fooling points.
   Connected players who never file get a house lie at time-up (their first offer if they asked; also 75 %); offline players
   sit the story out.
3. **Choose** (20 s): phones list every distinct lie plus the truth (identical lies merge and credit every author; house
   decoys top the list up to at least four, preferring lies nobody was offered). You can’t pick your own lie. You may ♥ up to
   two answers that aren’t yours (toggle). The phase ends at the deadline or 2.5 s after the last pick once everyone picked.
4. **Reveal** (server-timed): “Hold the front page!”, then each lie somebody fell for, fewest suckers first (fooled players
   fly in → FIB! stamp + author → points), house decoys that fooled someone (HOUSE FIB!, nobody scores), the truth last (TRUTH
   stamp, the blank fills in on the headline, finders + points), then Readers’ favourites if anyone liked a lie (top three on the TV plus a count of the rest; every like pays, and phones
   list each player's own).
5. Standings after rounds 1 and 2; Final edition (winner front page + board) after the finale; then the pack podium.

## Scoring

| Event | Points |
| --- | --- |
| Found the truth | 1000 × round |
| Each player fooled by your lie | 500 × round (375 × round for a house-assisted lie) |
| Each like on your lie | 50 (flat) |

Winners: everyone tied on the top score (none if the top is 0). Awards: **Master Liar** (most players fooled), **Truth
Seeker** (most truths found), **Most Liked** (most likes). A tie of two shares an award; three or more tied get none.
Podium headline: “Extra! Extra! N readers swallowed lies whole.”

## Pacing

Standard pace ≈ 13–15 min with humans (Pick 10 s + Write 45 s + Choose 20 s + Reveal 8–45 s per story, round cards 4.6 s,
standings 8 s, final 11 s). Timers scale with the pack pace. Reveal beats: lead 1.8 s, lie/decoy 4.4 s (3.6 s when more than
five), truth 5.6 s, likes 4.6 s. Every beat carries its server start time (`beats[].at`), and the public view only contains
beats that have started, so a reloaded TV lands on the same beat and nothing is revealed early.

## Content (`content.server.ts`, server only)

248 original, verifiable stories: **222 family** + **26 adult/edgy** (rude, gross or grim; filtered when `settings.family`).
Each has a teaser, the story with one `___`, the answer plus accepted variants, and three house lies (744 total). Tests check
structure, uniqueness, lengths, that no house lie matches its truth and that no teaser gives its answer away. Stories never repeat within a game; replays in the
same night prefer untold stories (the pack's `api.used` night memory marks each told story).

## Narration (`narration.ts`, 214 characters)

`tall-tales.intro`, `tall-tales.fooled` (a lie fools 3+), `tall-tales.nobody` (truth unfound), `tall-tales.final`. Shared
`host.*` lines cover the final round, reveal lead-in, everyone-in, hurry, time-up, scores and the winner.

## Audio cues

Music: `tall-tales` for round cards, picking and writing; `vote` for choosing; `reveal` under reveals; `finale` for the final
edition. SFX: typewriter/gong (round), swoosh-in (pick, beats), stamp (pick, FIB!), submit/pop/boing (lies, help, house),
vote/pop (picks, likes), drumroll (reveal, truth), laugh/gasp, boo (house fib), reveal + correct/aww/applause (truth),
sparkle + score-up (likes), fanfare + applause (final).

## Files

`types.ts` (views, actions, matching, timing) · `server.ts` · `content.server.ts` · `client.tsx` · `styles.css` (`.hj-tall-tales`,
`tt-*`) · `narration.ts` · `bot.ts` · `qa.ts` (driver UI hooks; acts at human pace so mid-phase TV shots exist) ·
`tests/tall-tales.test.ts` · `music/tracks/tall-tales.ts` → `public/games/hijinks/music/tall-tales.mp3`.

## QA evidence

Focused tests: 14/14 (`node --import tsx --test packages/games/hijinks/tests/tall-tales.test.ts`). Browser QA runs and
screenshots live in `output/hijinks/tall-tales/hj-b1-tall-tales-<n>/` (see the agent report for the run table).

## Known gaps

- Truth matching is curated variants + normalisation, not semantic: an unlisted paraphrase of the truth is accepted as a lie.
- No narrator recordings yet (`api.say` returns 0); beats use fixed timings.
