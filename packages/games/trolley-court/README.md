# Trolley Court

An original party card game about the trolley problem for 3–10 players, set in a courtroom at a railway junction. The TV shows the split track and the Clerk narrates; each phone holds its team's secret hand. The shared PartyPlay room owns joining, readiness, reconnects, results and replay. Rules and contracts live in [DESIGN.md](DESIGN.md).

## How to play

- **Roles.** Each round one player is the Conductor ("Your Honour"); the rest split into North and South, and each team owns one branch of the track. Teams reshuffle every round and everyone conducts equally (twice with 3–4 players, once with 5–10).
- **Default heading.** At the deal a coin flip picks the branch the trolley is heading for. Doing nothing sends it there; pulling the lever diverts it.
- **Stack the tracks.** Each track starts with a random Innocent. Teams then pick from their hands: an Innocent for their own track, a Guilty for the opponent's track, then Twists that attach to any card on either track. Teammates propose on their phones and the first lock is final. Write-in blanks let a team type its own card.
- **Plead.** Cards are revealed one at a time (and read aloud). The team in the trolley's path argues first, then the other team. The Conductor can lean the lever live and skip ahead after five seconds.
- **The lever.** The Conductor pulls or does nothing. Everyone on the struck team gains a death. After the last round, the fewest deaths wins; ties share the win.
- **Settings.** Laps, pick/twist/floor/lever timers, Accomplices (every teammate plays a twist), Underdog (extra twist for the most-killed), Write-ins, Milder deck and Read cards aloud.

## Code

- `src/types.ts`, `src/manifest.ts`: the client-safe contract, settings, seat/team helpers and timings.
- `src/server.ts`: seeded decks, phase machine, propose/lock/auto-pick, lever, scoring and private projections. `src/deck.server.ts` holds the original card text (server only). `src/bot.ts` is for tests and QA.
- `src/client.tsx` (settings, how-to, results, `prepare`), `src/display.tsx` (TV), `src/phone.tsx` (controller), `src/cards.tsx`, `src/styles.css`; art in `public/games/trolley-court/art/`.
- `src/audio.tsx`: TV-only cue playback and the Clerk's narration queue (`src/narration.ts`, generated `src/vo-manifest.ts`); phones only play quiet tap sounds.

## Audio tools

Both tools read the ElevenLabs key from `output/secrets/elevenlabs.key` (never printed) and record spend in `output/secrets/el-ledger.json`. Always dry-run first.

```sh
node --import tsx packages/games/trolley-court/tools/sfx.ts --dry-run          # public/games/trolley-court/sfx/<id>.mp3
node --import tsx packages/games/trolley-court/tools/narrate.ts --dry-run      # lines + card.<id> recordings in public/games/trolley-court/vo/
node --import tsx packages/games/trolley-court/tools/narrate.ts --cap 500 --no-cards
```

`narrate.ts` only regenerates ids whose text or voice settings changed and rewrites `src/vo-manifest.ts`.

## Validate from the platform root

```sh
node --import tsx --test packages/games/trolley-court/tests/*.test.ts tests/registry-contract.test.ts tests/catalog.test.ts
npm run typecheck
npm run lint
npm run build:isolated -- trolley-your-run
npm run serve:isolated -- trolley-your-run 4348
```

Browser QA: `node --import tsx packages/games/trolley-court/tools/qa-driver.ts --port <free port> --players 3 --replay` against an isolated server (options are documented at the top of the file). Current results are in [QA.md](QA.md).
