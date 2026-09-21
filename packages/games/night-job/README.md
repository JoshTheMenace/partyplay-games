# Night Job

A cooperative overhead heist game for one to four players, inspired by the 2013 Monaco. Choose a specialist, steal the objective, collect optional loot, and get the whole crew to the exit. Detection leads to pursuit and recovery; an alarm does not end the job.

## Play

Select Night Job in the PartyPlay library or room picker. The host selects a mission and Normal or Relaxed difficulty in Settings. Players choose a specialist and a tool, then Ready. The host is a dedicated TV or laptop map display and never occupies a player seat. Each player joins on a phone, which shows controls and status, not a map. One phone is enough for a single-player heist; the shared screen is still required.

Watch the shared map and move with the phone's left pad. Push toward doors, safes, terminals, hiding places, objectives, and fallen teammates to work on them. Hold Sneak to move quietly. Tap Tool to use the selected equipment; drag and release the tranquilizer or shotgun button to aim. The pad also supports arrow keys for keyboard accessibility on a controller browser. Tools recharge once per ten personally collected coins. All players share the heist result.

Three original jobs:

- The Velvet Ledger: steal a casino's accounting ledger.
- Glasshouse Exchange: take a jewel from an auction conservatory.
- Last Ferry: lift the customs manifest and escape by boat.

Eight specialists provide faster locks, guard intelligence, companion collection, silent takedowns, wall breaching, disguise, circuit hacking, or distraction. Every mission retains ordinary routes for every role. Duplicate roles are allowed and seat numbers distinguish teammates.

## Implementation

`model.ts` is the browser-safe contract and role/tool metadata. `maps.ts` holds public architecture and original authored content; `server-levels.ts` keeps guard placement and patrols server-only. `geometry.ts` defines continuous collision, navigation, and sight independently: glass blocks movement while passing sight.

The server owns every gameplay result. Clients send held movement and acknowledged tool actions through the existing PartyPlay connection. Public snapshots contain shared team knowledge, visible guards, and deliberate Scout markers. Full hidden guard state never enters the browser renderer.

Canvas presentation uses the existing scene readiness lifecycle, with one full-floor map on the host. Phones use lightweight DOM controls, report ordinary readiness, and do not mount a canvas or game renderer. `audio.ts` synthesizes original effects on the host and respects the shared mute control. There is no bundled music. The host mixer uses bounded synthesized voices with stereo positioning, distinct tool sounds, loot streaks, injury and recharge cues; mute, hiding the tab, disconnect and disposal stop active sounds.

The renderer caches the schematic and lit floor paintings, then draws only the server-projected sight and actors. Wall plinths mark the full collision footprint beneath the thinner raised artwork. Outlined sprites, walk cycles, work rings, security cones and smoke communicate state; reduced motion removes decorative movement. Lobby and mission cards preview the authored architecture without exposing guard patrols.

## Development

Run commands from the parent PartyPlay repository, where dependencies and the room application live:

```sh
node --import tsx --test packages/games/night-job/tests/*.test.ts
npm run typecheck
npm run lint
npm run test:platform
npm run build:isolated -- night-job-your-unique-run
npm run serve:isolated -- night-job-your-unique-run 4377
```

Never run Prettier. Use a new isolated build name for each build; do not replace assets under an active browser session.

## Art and attribution

Maps, names, dialogue, Canvas artwork, launcher artwork, and synthesized effects are authored for this project. No Monaco art, fonts, soundtrack, level data, or source code is bundled. The shared platform supplies its existing licensed fonts and interface primitives. Source research and the implementation plan live in the parent repository under `docs/party-platform/MONACO-RESEARCH.md` and `docs/game-plans/night-job.md`.

## Verification

The game is implemented and integrated in the library. Automated and real-browser acceptance evidence is recorded separately from physical-device testing. The parent repository's `docs/verification/night-job.md` records the final build, actual automated/browser checks, and remaining device/playtest limits. Emulated touch is not physical-phone evidence.
