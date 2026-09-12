# Kart Party

A Three.js kart racer for a family game night. Up to ten human racers share the track; CPUs fill smaller groups to eight karts. Four courses span 1.78–2.64 km, with selectable 50cc, 100cc, 150cc, and 200cc racing. Rainbow Road adds a banked space circuit and a 56-metre-high magnetic loop. This is an original game with its own characters and environments, not Nintendo's Mario Kart.

## Play on this laptop

For family game night, use the standalone `kart-party-family` download. It includes the built game, music, fonts and server, with zero npm dependencies. Install Node.js 22.13 or later, extract the folder, and run:

```sh
npm start
```

No `npm install` is needed in that download. The browser opens automatically and the terminal prints the current phone URL. A busy port automatically switches to a free one; `PORT=0` always chooses a free port. Set `OPEN_BROWSER=0` for a headless launch.

This repository is the separate source/developer checkout. Run `npm ci` to install its development dependencies, then `npm start` builds missing or changed source automatically. `npm run package:party` produces the standalone family folder in `.party-release/kart-party/`; distribute that folder instead of this developer toolchain. Existing Sites publishing remains available, and its previous hosted start command is now `npm run start:site`. See `docs/packaging.md` for details.

Use the URL printed by the launcher. Choose Solo race or Host a party. Click Play on your phone to show a QR code for solo play, or Host a party for the room-specific QR. The server discovers its current Wi-Fi/Ethernet address; open QR dialogs and host lobbies refresh every five seconds and on window focus. You do not need to type an IP or regenerate a QR after changing networks. The standalone /api/party/qr.svg endpoint also generates a fresh home QR on every request. Phones must be on a network that can reach the laptop; guest Wi-Fi client isolation may block them. All fonts, graphics, sounds, and scripts are served locally after installation and build. The game itself does not need internet in LAN mode.

For the TV, connect the laptop through HDMI. Wireless mirroring also works but may add display delay. PC hosting defaults to a shared display with no racer slot, leaving ten seats for phones. Turn on Play from this device before hosting to race with the keyboard and up to nine phones. A touch-device host defaults to playing with the phone controller layout.

## Speed and music

Choose 50cc for relaxed cornering, 100cc for the original balanced pace, 150cc for faster racing and longer jumps, or 200cc for expert pace with earlier braking. Speed class affects every racer and is separate from CPU difficulty. The host selects it for everyone; reconnects and rematches keep it.

Five generated recordings from Downloads provide the soundtrack. Slower classes favor the slower songs; Rainbow Road and the faster classes favor the fastest. Original recordings play at their natural speed, with modest volume balancing, and stream from the laptop. Phone controllers stay silent while the shared display plays the music. If a display opens directly from a link, click Enable sound once. Solo race music pauses and resumes with the game. See `docs/music.md` for song measurements and playlists.

## Controls

Auto acceleration is on by default. Arrows or WASD steer/brake; Shift or Space drifts; E fires an item; Escape pauses solo racing. Turn auto acceleration off to use W/up as the accelerator. A phone has a steering pad and large drift, brake, and item buttons; disabling Auto gas adds a gas pedal.

Hold drift through a corner, then release for a boost. Blue, orange, and purple charge tiers unlock after 0.6, 1.5, and 2.5 seconds. Coins increase top speed up to ten coins. Item boxes grant one of twelve items, including homing beetles, jelly slicks, snowballs, a coin magnet, invincibility, rockets, and decoy parcels. Stronger recovery items become more likely farther back in the field. Cyan road strips provide speed boosts. Ramps launch the kart into the air and give a short boost on landing. Dirt and boardwalk sectors change grip, slopes affect speed, and the reactor sector lowers gravity.

Ordered checkpoint gates prevent skipped laps. Leaving the course resets a kart to its last earned gate. Stale input hands a network kart to the CPU after 1.5 seconds. Reloading a controller in the same browser tab reconnects to its saved seat. The host can remove disconnected lobby seats; returning to the lobby removes disconnected guests. Network races do not pause.

## Courses

| Course | Length | Environment |
| --- | ---: | --- |
| Seabreeze Circuit | 1,785 m | Sunfish Harbor, Lighthouse Cliffs, Emerald Falls jungle, and Sunset Boardwalk with a Ferris wheel |
| Copper Canyon | 2,300 m | Red Mesa Climb, Copper Mine tunnel, Eagle Gorge bridge, and Lost Temple dirt roads |
| Starlight Speedway | 2,639 m | Neon Downtown, Cloudline Skyway, Moon Blossom Park, and the Low-G Reactor |
| Rainbow Road | 2,283 m | Prism Ascent, Saturn Slingshot, Aurora Cathedral, and Meteor Sprint; banked spectrum road, ringed planets, floating crystals, and three jumps |

Each course has four named sectors and three ramps. The roads climb and descend through their environments, with bridges, tunnels, changing surfaces, and sector-specific scenery.

## Checks and builds

```sh
npm test
npm run typecheck
npm run build:party
npm run build
```

`build:party` creates the standalone client in `.party-dist`; `party` serves it with the real-time Node server on the same origin. `build` preserves the Sites/Vinext Worker build for a future hosted frontend. The Worker build alone does not provide online multiplayer rooms. No online deployment has been made.

The tests also exercise all twelve item behaviors, screen-relative controls, scenery clearance, and normal/boosted takeoff and landing on all twelve ramps across all four speed classes. The tests cover complete AI laps on all courses, deterministic replay, ordered forward checkpoints, barrier-side credit, ranking, respawn, finished-kart item behavior, input bounds, real-socket rooms, host authority, readiness, reconnect, rematch, stale-seat removal, display-only joining, and quick item taps. Browser QA findings and remaining release gates are recorded in `docs/validation.md`.

See `docs/architecture.md` for the code walkthrough and design decisions.

Ten-player capacity, split-screen behavior, and validation are described in `docs/ten-player-parties.md`.

For new games and the future shared launcher, start with the [party-game agent handbook](docs/party-platform/README.md), including the UI and integration contracts.
