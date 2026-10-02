# Comment Section

Hijinks minigame `comment-section`: context-twisting internet comedy for 3–10 players. Everyone answers an innocent question
about themselves; a friend then gets that answer plus a fake app and writes the missing context that ruins it. The feed plays
every post, and the room votes for the most ruinous.

Art direction: **Scrollhole**, a light-mode parody social app. The TV is an app canvas (white cards, soft shadows, a
blue→violet→pink gradient wordmark, a notification bell whose badge climbs, a trending ticker). Every post renders as a mock
screen of an original fake brand: Shopaloo (product review), Pixstack (photo + caption), Daily Doomscroll (headline + top
comment), Askew Search (search history), Workwurld (job + application), Swoonr (dating profile), Threadbare (forum thread +
best answer), Crumbly (recipe + review), Clipclop (video + top comment), Yapper (group chat bubbles) and, in the Final Feed,
Scrollhole profile status updates. Personality: like counts that climb, a two-reply chain from relatives and institutions
under each post, floating emoji reactions, a mystery "context added by ?" badge, and a red REPORTED stamp on the winner.
Theme music: `music/tracks/comment-section.ts`, "Doomscroll" (bubbly city-pop with notification-bell hooks).

## Rules

Three rounds. Each round:

1. **Round card** (5.2 s): a notification drops in with the round and its multiplier; the app logos fan out.
2. **Answer** (45 s): every player gets a different innocent question on their phone and answers honestly (≤ 70 characters).
   Silent players get a house answer (vague on purpose; it earns no consolation points).
3. **Twist** (60 s): every player gets another player's answer (with the author named), a fake app and an instruction
   (“Name the product they gave five stars”, “Write what Mum just said in the family chat”…) and writes the context
   (≤ 50 characters). The phone shows a live preview of the finished post. *Stuck? Let the house write it* files a house twist
   at half points; anyone silent at time-up gets one too. Assignment is a derangement of the room (nobody twists their own
   answer, everyone twists exactly one) that avoids repeating a twister→author pair within the game; rounds 1–2 deal a different
   app to every post, preferring apps not seen yet.
4. **Feed** (server-timed): each post scrolls in on the TV, context first, then the answer drops in under the author's name,
   likes climb, the innocent question it answered pops up beside the author, and two replies appear; the read-aloud voice
   (if on) reads the label, the context and the answer.
5. **Vote** (25 s; 35 s in the final): all posts in a grid (letters A–J). One vote each, never your own twist. You may vote
   for the post made from your own answer.
6. **Verdicts**: posts revealed fewest votes first (twister unmasked, votes, points), then the top post(s) get REPORTED.
7. **Follower count** (scores) after rounds 1 and 2.

**The Final Feed** (round 3): every answer becomes a status update on its author's Scrollhole profile (“Checked in at…”,
“In a relationship with…”), triple points, and everyone may vote for one or two different posts.

## Scoring

| Event | Points |
| --- | --- |
| Each vote on the post you twisted | 100 × round (half for a house twist) |
| Each vote from *another* player on the post made from your answer (“you’ve been ruined”) | 50 × round (none for a house answer) |

Rounds are ×1, ×2, ×3. Ties: every top post is reported. Winners: everyone tied on the top score (none at 0). Awards:
**Most ruinous** (most votes as a twister), **Most ruined** (most consolation votes), **On autopilot** (2+ house twists),
each only for a single leader. Podium headline: “N posts reported. Zero apologies.”

## Pacing

Standard pace ≈ 9–13 minutes for 10 players (answer 45 s, twist 60 s, feed 5–9 s per post, vote 25/35 s, verdicts
≈ 10–17 s, scores 7.5 s); phases end early once everyone connected has submitted (after 1.5 s). Timers scale with the pack pace.
Every feed post carries its server start time (`beats`), and the feed's public view only contains posts that have started;
verdict beats are fixed offsets from the phase start (`revealBeats`), so a reloaded TV lands on the same moment.

## Content (`content.server.ts`, server only)

- 171 family questions + 15 adult questions.
- 102 format variants over 11 apps: 88 across the 10 feed apps (8–10 each) and 14 profile status variants (13 family, so a
  10-player Final Feed never repeats one); 6 are adult.
- 100 house twists (10 per feed app) + 10 adult, and 4 per status variant (56; status labels need different kinds of phrase,
  so each brings its own); 40 house answers; 40 replies for the reply chains.
- 31 adult-tagged items in all, filtered when `settings.family`.
- Night memory: each dealt question and format is marked with `api.used`, and replays prefer unused ones (`dealFresh`).

## Narration (`narration.ts`, 219 characters)

`comment-section.intro`, `.twist` (twist phase opens), `.reported` (a single winner is stamped), `.final` (Final Feed card).
Shared lines: final round, everyone-in, hurry, time-up, vote, tie, no votes, scores.

## Audio

Music: `comment-section` for round cards, answering, the feed and scores; `think-2` while twisting; `vote`; `reveal` under
verdicts. SFX: swoosh-in + ding (round), submit (answer), glitch (twist opens), pop/boing (twist/house twist), whoosh (feed),
swoosh-in + pop + laugh/ooh per post, ding + vote (voting), drumroll, score-up/pop per verdict, stamp + airhorn + cheer
(REPORTED) or aww (no votes), plus the shared tick-fast/timeup.

## Files

`types.ts` (views, actions, timing) · `server.ts` · `content.server.ts` · `client.tsx` · `styles.css` (`.hj-comment-section`,
`cs-*`) · `narration.ts` · `bot.ts` · `qa.ts` (driver UI hooks at human pace) · `tests/comment-section.test.ts` ·
`music/tracks/comment-section.ts` → `public/games/hijinks/music/comment-section.mp3`.

## QA evidence

Focused tests: `node --import tsx --test packages/games/hijinks/tests/comment-section.test.ts` (11 tests: full bot games at 3,
6 and 10 players, dealing, scoring and ties, the Final Feed, house defaults and pace, disconnects, validation, privacy, family
filter, night memory). Browser runs (`tools/qa-driver.ts --phone-viewports --tv-viewports --settled`) live in
`output/hijinks/comment-section/hj-b2-comment-section-<n>/p<players>/`; runs 4–8 finished complete nights (10 and 3 players)
with zero page errors, zero overflow findings and zero rejected actions. Best shots: the 10-post vote board
`hj-b2-comment-section-8/p10/035-mini-1-comment-section-vote-2-t12-tv.png`, the feed
`hj-b2-comment-section-6/p10/settled-032-mini-1-comment-section-feed-9-2-t11-tv.png`, Final Feed verdicts
`hj-b2-comment-section-4/p10/settled-052-mini-1-comment-section-results-3-t20-tv.png`, roomy verdicts with reply chains and the
REPORTED stamp `hj-b2-comment-section-7/p3/settled-011-mini-1-comment-section-results-1-t6-tv.png`.

## Known gaps

- Read-aloud is a single line per post; the TV voice cannot change accent per app.
- The REPORTED stamp marks the room's favourite; there is no extra bonus beyond the votes themselves.
- The brief says both "100 × votes × round" and "double points" for the Final Feed; the formula wins, so it pays ×3.
- With 10 players the feed's "Earlier" column shows the latest eight posts; older ones scroll off the top, like a real feed.
- No physical phones or real audio output were tested; QA bots answer from a small phrase list, so screenshots repeat phrases.
