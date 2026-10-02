# Hijinks — design and build guide

Hijinks is one registered PartyPlay game (`id: hijinks`) that hosts a library of original party minigames inspired by the
mechanics of classic phone-controlled party packs. The TV (watching host display) is the stage; phones are portrait
controllers. Names, art, prompts, music and narration are original. Never use trademarked titles, characters or copied
prompt text from any commercial game.

## Night flow (pack phases)

`menu → intro → mini → podium → menu …` inside one platform round.

- **menu**: the TV shows the game wall (playable tiles; tiles outside the current roster size are dimmed with the reason).
  Every phone votes. The VIP (first connected player in roster order, crown badge) can tap *Lock it in* to start the
  leading pick (ties resolve with the seeded RNG). When every connected player has voted, a 4 s lock countdown starts
  automatically. The VIP can also choose *End the night*, which completes the platform round (results = night trophies).
  `settings.startWith` skips the first menu.
- **intro**: animated title card, narrator intro lines, three how-to steps. Length = narration + 2 s (min 9 s, 3 s when
  tutorials are off). Phones show *Skip intro*; it ends when the VIP or a majority skips.
- **mini**: the active minigame owns the screen. Its public view is `PackPublicView.mini`; private view `PackPrivateView.mini`.
- **podium**: animated final standings of that minigame, winner celebration, awards, trophy count; 12 s or VIP *Continue*.

New players cannot join mid-round (platform rule). The menu tells the room that newcomers join after *End the night* → *Play again*.

## Files

```
src/manifest.ts            pack manifest (players 2–10, portrait, turn-based, snapshotCache media)
src/server.ts              GameRules: pack phases, MiniApi, cue log, media store, outcome (exports rules/default)
src/client.tsx             GameClientModule (exports client/default): Display/Controller/Lobby/Settings/Instructions/Results/Audio
src/core/contract.ts       THE contract: types for minigames, views, actions, cues, bots (read this first)
src/core/narration.ts      shared narrator lines (ids `host.*`)
src/core/vo-manifest.ts    GENERATED: narrator line id → duration ms (only lines that have recordings)
src/core/server/*          pack server helpers (rng, validation, timers)
src/core/ui/*              shared TV + phone UI kit (Stage, Timer, Avatar, PlayerStrip, cards, vote reveal, scoreboard…)
src/core/audio/*           host-display mixer: music crossfade, SFX, narration queue with ducking, read-aloud
src/minis/catalog.ts       client-safe MiniInfo list (menu tiles, intro cards)
src/minis/registry.server.ts  id → MiniServer (server only)
src/minis/registry.client.ts  id → () => import('./<id>/client')  (lazy, per minigame chunk)
src/minis/<id>/server.ts   MiniServer implementation (server only)
src/minis/<id>/content.server.ts  prompt/answer banks (server only; never imported by client code)
src/minis/<id>/client.tsx  default export MiniClient {Display, Controller}
src/minis/<id>/styles.css  scoped under .hj-<id>
src/minis/<id>/narration.ts  narrator lines for this minigame (ids `<id>.*`), ≤ 250 characters total
src/minis/<id>/bot.ts      MiniBot policy (tests/QA only; never imported by client.tsx)
src/minis/<id>/types.ts    public/private view + action types shared by its server/client/bot
tests/<id>.test.ts         rules tests using tests/harness.ts
music/                     offline synth (copied from Night Job) + track compositions + export script
tools/                     narration generator (credit ledger), SFX generator, QA bot driver
public/games/hijinks/      music/*.mp3, sfx/*.mp3, vo/*.mp3, art
```

The Vite guard rejects `src/**/server.ts`, `src/**/*.server.ts` and `src/**/content*.ts` in browser chunks. Client code may
import `types.ts`, `catalog.ts`, `narration.ts` and `core/contract.ts`; never `server.ts`, `content.server.ts` or `bot.ts`.

## Minigame rules of thumb

- Server-authoritative; every action carries the minigame's own `turn` id; reject stale/duplicate/out-of-phase actions
  with short player-facing messages. Validate all strings (trim, max length, non-empty) and numbers.
- Advance a phase when everyone connected has submitted (after a readable minimum ~1.5 s) or on the deadline. Missing
  players get sensible defaults (e.g. a house answer) so the game never stalls. Disconnected players are skipped.
- Use `api.seconds()` for every timer, `api.random/shuffle/pick` for randomness, `api.say()` for narration (respect the
  returned duration when timing reveals), `api.sfx()` on submissions/reveals/scores, `api.music()` per phase.
- Heavy payloads (drawings) go through `api.media.put`. Use the shared `parseDrawing` and `DrawingPad`.
- Public views never contain secrets (authors before reveal, the real answer before reveal, hidden roles). Private
  views contain only that player's data. Omit absent optional fields; never put `undefined` in views.
- Content: large, original, funny banks; tag adult items and filter them when `settings.family`. 3 rounds-ish, 8–15 min.
- TV is a fixed 1920×1080 stage scaled to fit (core/ui Stage). Design for 10 players and maximum-length text. Big type,
  bold motion, avatars everywhere, reveal choreography (anticipation → reveal → reaction → score).
- Phones: portrait, one obvious task per screen, ≥48 px targets, 16 px+ inputs, clear draft/submitted/locked/waiting/
  time-up states, drafts persisted in sessionStorage scoped by `sessionKey` + turn.
- A bot policy (`bot.ts`) must be able to finish the minigame for tests and QA.

## Audio budget

Narration: ElevenLabs `eleven_turbo_v2_5`, voice George (`JBFqnCBsd6RMkjVDRZzb`), generated only by `tools/narrate.ts`
with a credit ledger. Budget ~15k characters total: shared `host.*` ≤ 1,500 chars; each minigame ≤ 250 chars (an intro
plus 2–4 reusable callouts). Lines are static (no player names). Minigame agents write `narration.ts` but never call
ElevenLabs. SFX: one-time library via `tools/sfx.ts` (≤ 1,200 credits). Music: original loops rendered offline with
the code synth (`music/`), one menu theme, shared beds (think/vote/reveal/podium/finale) and one theme per minigame.

## Roster (inspiration → original title)

| # | Batch | id | Title | Inspired by | Core |
|---|---|---|---|---|---|
| 1 | 0 | quip-clash | Quip Clash | head-to-head prompt comedy | write 2 answers, matchups voted, final all-play round |
| 2 | 1 | tall-tales | Tall Tales | trivia bluffing | write a lie for a weird fact, find the truth, likes |
| 3 | 1 | sketch-bluff | Sketch Bluff | drawing bluff | draw a secret prompt, others write fake titles, guess real |
| 4 | 1 | shirt-show | Shirt Show | shirt battle | draw designs + write slogans, mix into shirts, bracket |
| 5 | 1 | quiz-panic | Quiz Panic | spooky trivia party | trivia; wrong = deadly minigames; ghosts; final escape |
| 6 | 1 | odd-one-in | Odd One In | hidden faker | secret tasks (hands, numbers, point) one faker votes |
| 7 | 2 | ballpark | Ballpark | percentage guessing | guess % of people who…; others bet higher/lower |
| 8 | 2 | comment-section | Comment Section | context-twisting | answer personal Q, others repurpose it as a post |
| 9 | 2 | bracket-brawl | Bracket Brawl | answer brackets | write answers, bracket voting with predictions |
| 10 | 2 | split-decision | Split Decision | dilemma splitting | complete a scenario to split the room 50/50 |
| 11 | 2 | airlock | Airlock | hidden-traitor sci-fi | crew tests, hidden aliens with alt prompts, push button |
| 12 | 3 | wordsmithery | Wordsmithery | fake dictionary | define, synonym, sentence chain voting |
| 13 | 3 | punchline-cruise | Punchline Cruise | joke writing | write catchphrases, build setups, perform punchlines |
| 14 | 3 | vague-talk | Vague Talk | limited-vocabulary description | describe a secret thing with templated sentences |
| 15 | 3 | mascot-melee | Mascot Melee | champion drawing | draw a champion, rivals, vote |
| 16 | 3 | monster-mingle | Monster Mingle | monster dating | chat messages, hidden powers, dates |
| 17 | 4 | mural-mayhem | Mural Mayhem | collaborative doodle | add to a shared doodle, vote best additions |
| 18 | 4 | typecast | Typecast | assign friends to roles | sort players into categories, compare |
| 19 | 4 | hellish-housework | Hellish Housework | chaotic co-op chores | co-op task chaos with secret selfish goals |
| 20 | 4 | slide-show | Slide Show | improv presentation | presenter improvises over picked slides, audience rates |
| 21 | 4 | hire-wire | Hire Wire | interview word bank | answer with words cut from others' answers |
| 22 | 5 | survey-cave | Survey Cave | team poll guessing | rank poll answers, torches/lives |
| 23 | 5 | sketchy-murders | Sketchy Murders | drawn murder mystery | draw murders with hidden names, find killers |
| 24 | 5 | wheel-of-whimsy | Wheel of Whimsy | trivia + wheel | trivia earns slices, spin the giant wheel |
| 25 | 5 | flipbook-fib | Flipbook Fib | animated drawing bluff | two-frame animation, fake titles |
| 26 | 5 | junk-tales | Junk Tales | junk stories | name items, write backstories, vote |
| 27 | 6 | scale-of-nonsense | Scale of Nonsense | rating guesses | draw/write to land on a secret scale value |
| 28 | 6 | sort-it-out | Sort It Out | team sorting | sort falling items into line, team race |
| 29 | 6 | reality-check | Reality Check | reality TV show | eliminations, confessionals |
| 30 | 6 | about-you | About You | personal bluffing | lies about players' real answers |
| 31 | 6 | group-text | Group Text | collaborative text | write letters together word by word |
| 32 | 7 | time-warp | Time Warp | trivia timeline | guess years, place events |
| 33 | 7 | hypno-party | Hypno Party | identity deduction | secret identities, hypnotised behaviour |
| 34 | 7 | birdsong-band | Birdsong Band | rhythm game | tap rhythm lanes together |
| 35 | 7 | art-auction | Art Auction | draw & bid | draw art to spec, bid on what is valuable |
| 36 | 7 | ear-candy | Ear Candy | sound-effect comedy | answer prompts with sound-effect pairs |
| 37 | 8 | hot-spud | Hot Spud | word chain | add words to a chain, room judges |
| 38 | 8 | fact-swatter | Fact Swatter | true/false speed | swat true or false fast |
| 39 | 8 | fuse-box | Fuse Box | co-op bomb defusal | split manuals, solve modules |
| 40 | 8 | know-it-all | Know-It-All Show | quiz show | trivia with screws and a word-matching finale |
| 41 | 8 | rhyme-bots | Rhyme Bots | robot rap battle | fill rhyming lines, robots perform |
| 42 | 9 | sling-arena | Sling Arena | slingshot physics | realtime slingshot collection |
| 43 | 9 | patent-pending | Patent Pending | invention pitch | draw inventions, pitch, invest |
| 44 | 9 | crowd-says | Crowd Says | survey board | guess top survey answers |
| 45 | 9 | suspicious-minds | Suspicious Minds | social deduction mystery | clues, interrogations |
| 46 | 9 | cookie-cutters | Cookie Cutters | cookie decorating | decorate cookies to orders |
| 47 | 10 | doom-speech | Doom Speech | villain monologues | write monologues, vote |
| 48 | 10 | trivia-quest | Trivia Quest | co-op trivia adventure | team trivia dungeon |
| 49 | 10 | sound-off | Sound Off | voice/sound bluff | pick sounds for prompts |
| 50 | 10 | word-wager | Word Wager | wordplay betting | bets on word puzzles |

Batch order is a plan, not a commitment; each batch is designed and verified before the next starts.
