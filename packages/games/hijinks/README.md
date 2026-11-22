# Hijinks

A whole party night in one registered game (`id: hijinks`, 2–64 players, watching TV + portrait phones). The TV shows a
game wall; phones vote, the VIP locks a pick, a minigame plays, the podium hands out a trophy, and the VIP ends the night
for a finale: the champion, the games played and the table. Design, file map and minigame rules: [DESIGN.md](DESIGN.md).
Contract: `src/core/contract.ts`. UI kit: `src/core/ui/README.md`. Music: `music/README.md`.

Seven of the eleven minigames play at any room size (Quiz Panic, Ballpark, Tall Tales, Split Decision, Quip Clash,
Bracket Brawl, Comment Section); four stay at ten players (Sketch Bluff, Shirt Show, Odd One In, Airlock). How each one
handles a big room, and why the four are kept, is in [DESIGN.md](DESIGN.md#big-rooms-1164-players).

## Platform integration

- Server registry: `apps/party-server/src/registry.ts` with `actionLimits: { perPlayer: 256, maxBytes: 32768, history: 'window' }`
  (a night can send far more than 256 actions; the window retires acknowledged ones, and the shared client session numbers
  actions for it automatically).
- Client registry: `apps/party-client/src/registry.ts`; launcher art and verb in `apps/party-client/src/art.tsx`; library
  metadata in `apps/party-client/src/catalog.ts` and `catalog/sources.json`.
- Minigames register only inside the pack: `src/minis/catalog.ts`, `registry.server.ts`, `registry.client.ts`.
- Night memory: `api.used` remembers each minigame's dealt content for the whole night. `src/core/server/deck.ts` wraps
  it: `freshDeck(api, items, key?)` orders a bank unused-first (each group shuffled; mark cards with `api.used.add` as you
  deal them) and `dealFresh(api, items, count, key?)` deals and marks in one step. All six shipped minigames use it.
- The Vite guard rejects any `server.ts(x)`, `*.server.ts(x)`, `content*.ts(x)` or `bot.ts` under `src/` from browser chunks.

## Tests

```sh
node --import tsx --test packages/games/hijinks/tests/*.test.ts   # pack + minigame rules (in-process harness)
node --import tsx --test tests/platform.test.ts                  # includes ten- and 32-player Hijinks nights over real sockets
```

## Live QA driver

`tools/qa-driver.ts` plays a night against a running server: a headless TV page (1920×1080) creates the room through the
library, one headless phone page (390×844) joins through the real form and is the VIP, and the other seats (up to 63) are
WebSocket bots with names up to sixteen characters. Bots play minigames with `src/minis/<id>/bot.ts`. The phone uses the same bot policy, injected into its own socket
(a generic action-to-UI mapping is not possible); a minigame can opt into real UI driving with `src/minis/<id>/qa.ts`
exporting `ui(page, action): Promise<boolean>`. All pack steps on the phone (vote, Lock it in, Skip intro, Continue,
End the night) use its real UI.

```sh
flock /tmp/hijinks-heavy.lock npm run build:isolated -- hijinks-run-1
npm run serve:isolated -- hijinks-run-1 4421 &                    # note the PID; stop it when done
flock /tmp/hijinks-heavy.lock node --import tsx packages/games/hijinks/tools/qa-driver.ts --port 4421 --players 4 \
  [--game quip-clash[,ballpark,…]] [--shots output/playwright/hijinks/run-1] [--phone-viewports] [--tv-viewports] [--settled] [--stress-podium] \
  [--audio output/hijinks/audio-check/runs/x/audio.wav] [--read-aloud] [--replay] [--keep-open] [--max-minutes 30]
```

Without `--game` it goes menu → End the night → results. With a comma-separated list it plays each game in turn in one
night; `log.json` `games` records how long each took and how many actions were accepted and rejected. `--replay` then
taps Play again, readies every seat and plays the first game once more in a fresh night.

Screenshots never queue. Each page has a camera that watches the snapshots its own socket delivered and shoots what that
page shows now: every phase key once it has been on screen 0.9 s, a viewport sweep (phone 320×568 + 667×375 with
`--phone-viewports`, TV 1280×720 with `--tv-viewports`) once per phase kind (a key without its session/round/turn), and
with `--settled` a TV shot once a key has been on screen 4.5 s. Files are `<nnn>-<phase key>[-settled|-ready|…]-<tv|phone>[-WxH].png`;
`nnn` numbers keys in order of first appearance, so the TV and phone files of one state share it. A capture whose page
moved on before it finished is deleted (`discarded`), so a file name is always the state on screen. Cameras learn how long
each kind lasts and only start a sweep or settled shot that should finish in time; kinds that never left room are listed in
`unswept` (fast bots end some 10-player phases in ~3 s, while a busy software-rendered TV capture takes ~1.5 s). Bots never
wait for cameras; phone taps never land mid-sweep. Resizes wait for layout to settle (two animation frames, and a TV stage
scaled to the viewport). Each phone shot also checks for sideways overflow and page zoom. `log.json` records the phase
timeline, every shot with `onScreenMs` (how long its state had been showing) and `captureMs`, `lag` (p50/p95/max per page),
`missed` keys (replaced before a shot), `discarded`, `unswept`, per-seat accepted/rejected actions, page errors and
`overflow` findings.

Bots restore the cached roster like the client does (`manifest.snapshotCache`). A bot whose socket the server drops (a
missed heartbeat when the QA machine stalls for ten seconds) rejoins with its token, as a phone does. `log.json` `health`
says who was slow: `pingMs` (server round trips on one bot's socket), `loopLagMaxMs` (this process's own timer lag) and
`drops` (every dropped socket). A run with drops is still a played night, but read its durations with that in mind.
`phoneMoves` counts the phone's minigame moves made by tapping (`ui`) and those that fell back to its socket; each
fallback is logged. A quarter of the Sketch Bluff bot's drawings are worst-case doodles of thousands of points: traced by
mouse on a busy machine they can outlast the draw timer, and the game then moves on by its timer as it would for a
slow player.

`--stress-podium` rewrites only the TV's podium snapshots to a worst case (16-character names, three-way ties, six long
awards, a long headline). `--read-aloud` turns on the TV's read-aloud setting before anyone joins.

`--audio <file.wav>` records the host display's audio. Chromium starts with `--autoplay-policy=no-user-gesture-required`
and the driver clicks the TV, so the mixer unlocks. An init script wraps `AudioContext` before the app loads: an
AudioWorklet records everything connected to the destination (`<file>.wav`, 32-bit float stereo) plus music/sfx/vo stems
(`<file>.stems.wav`, the deepest node carrying only that kind). Frames the recorder skipped are written as silence.
`<file>.cues.json` holds public-view cues, buffer starts and stops (URL, offset, length, peak), `speechSynthesis.speak`
calls (browser TTS cannot be captured) and phases, all on the recording's clock. With `--audio` the intro and the podium
play out instead of being skipped. `output/hijinks/audio-check/analyze.mjs <file.wav> [--json] [--mp3]` measures it with
ffmpeg (ebur128 loudness and true peak, astats, silencedetect), checks that every cue sounded, and measures ducking as the
gain applied to the music (stem ÷ track file at the same playhead).

It closes its browser and sockets on exit or Ctrl+C. Playwright (`playwright` or `playwright-core`) is loaded from
`$HIJINKS_PLAYWRIGHT` (a `node_modules` directory), by default `~/.local/opt/pw/node_modules`.

## Layout fixtures

A live game at 32 players takes six or seven minutes, and its densest moments last a second. `tools/qa-fixture.ts` plays
the rules in-process instead (the test harness, the minigame's bot, a fake clock), keeps the fullest snapshot of every
phase kind, and delivers each one to a real TV page and a real phone page in a real two-seat room, in place of the
server's snapshots:

```sh
node --import tsx packages/games/hijinks/tools/qa-fixture.ts --port 4431 --game tall-tales --players 64 \
  [--shots output/hijinks/fixtures/x] [--seat p1] [--all] [--only reveal,scores] [--tv-small] [--phone-small] \
  [--reduced-motion] [--long-night]
```

Every name is sixteen characters, timestamps are moved to the server's clock so reveals stand on their last beat, and the
last frame is the end-of-night results (`--long-night` makes it the densest one: seven games, seven champions). It proves
layout at a roster size, nothing else: joins, timing, votes and scoring are the driver's and the tests' job.

## Big-room evidence (2026-11-22)

Live nights with `tools/qa-driver.ts` on isolated builds: one TV page, one phone page, the rest socket bots, every game
from the menu to its podium, then End the night. Seconds per minigame, menu and intro excluded:

| Minigame | 10 players | 32 players | 64 players |
|---|---|---|---|
| Quiz Panic | 422 | 426–525 (three runs) | 417–426 (two runs) |
| Ballpark | 516 | 391 | 369 (374 on the replay) |
| Tall Tales | 375 | 435 | 425 |
| Split Decision | 406 | 235 | 254 |
| Quip Clash | 348 | 181 | 182 |
| Bracket Brawl | 607 | 637 | 663 |
| Comment Section | 352 | 325 | 320 |

- 32 players: seven games, results, Play again with the same 32 seats and an eighth game: 6390 actions accepted, 13
  refused (double sends: "already locked in", "too late"), no page errors, no sideways overflow, no dropped sockets.
- 64 players, two nights that cover all seven games, the second with Play again (64 seats again): 12677 accepted, 25
  refused, no page errors, no dropped sockets. The room server used a quarter to a third of one core.
- 4 players (Quip Clash 166–181 s, Tall Tales 281–292 s, Sketch Bluff, results, Play again) and the ten-player column
  above play the small-room rules, which this pass left alone.
- Bots answer within a second or two, so these are structural times: people use more of every timer, at any room size,
  and the timers do not grow with the roster. Quiz Panic varies most from run to run, with which Panic Rooms are dealt.
- Not covered: real phones on Wi-Fi, 64 browser pages at once (63 seats were sockets), and narration for the big-room
  phases (there is none; they are silent by design, with on-screen text).
