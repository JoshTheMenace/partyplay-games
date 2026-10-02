# Hijinks music

Original loops composed in code and rendered offline. `synth.ts` is the shared offline synthesizer (copied from Night Job),
`kit.ts` adds the `Track` type, phrase helpers and extra instruments (piano, brass, clav, organ, strings, theremin, crash,
toms, timpani, risers, walking bass). Each `tracks/<id>.ts` default-exports one `Track`.

| id | Title | Use |
| --- | --- | --- |
| `menu` | Hijinks! | signature theme: lobby, game menu, intros |
| `think`, `think-2` | Scribble Time, Doodle Hop | quiet writing/drawing beds |
| `vote` | Ballot Bounce | voting |
| `reveal` | Envelope, Please | suspense under reveals |
| `podium` | Victory Lap | podium celebration |
| `finale` | Curtain Call | end of the night |
| `spooky` | Creepy Crawl | horror-trivia minigame |
| `quip-clash` | Open Mic Swing | Quip Clash theme |

A minigame selects a track with `api.music('<id>')` (or `null` for silence). The host display crossfades between loops.

## Adding a minigame theme

1. Copy a similar file to `tracks/<minigame-id>.ts`; set `id` to the minigame id, a new `title`, `mood`, `bpm`, `bars`
   (and `beats` if not 4/4). Keep the default `lufs` (-16) for themes; quiet beds use -19.
2. Compose: write chord symbols (`'Cm7 F7'` puts two chords in one bar), melodies as `seq()` strings (`'C5:.5 E5:1 -:.5'`
   = note:beats, `-` rests, `!` accents), place them with `phrase(clock, bar, bars, play, rng)`. Give it sections (A/B/A′),
   a hook, a real bass line and drums; keep the last bar leading back into bar 0 because the loop restarts there.
   `render()` must return `mix.finish(...)` of a `new Mix(bars * clock.bar)` so the length is exact.
3. Balance by ear and by numbers: `Mix.last` holds each bus's RMS (dB) after a render. Melody about -17 to -21 dB,
   drums -14 to -20, pads/accompaniment -22 to -26, all averaged over the loop.
4. Render only your track (no other agent's file changes):
   `flock /tmp/hijinks-heavy.lock node --import tsx packages/games/hijinks/music/export.ts <minigame-id>`
   It writes `public/games/hijinks/music/<id>.mp3` (128 kbps, loudness-normalised, one wrapped extra second) and
   regenerates `src/core/audio/tracks.ts` for every track that has an mp3, including a click-free `loopStart` per file.
   Never edit `tracks.ts` by hand.
5. Call `api.music('<minigame-id>')` from the minigame server, and use the shared beds (`think`, `vote`, `reveal`) for
   its other phases unless the theme needs a variant.

Renders take 5–35 s each and allocate a few hundred MB; always run them under the heavy-work lock.
