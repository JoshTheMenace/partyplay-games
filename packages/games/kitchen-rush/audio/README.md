# Kitchen Foley

The shared display and solo host play these sounds. Phone controllers stay silent. The platform’s Sound on/off setting controls the mixer, music included.

`src/audio.ts` compares authoritative snapshots for delivery, ready, warning, burnt and fire transitions. Chopping alternates two recorded cuts every 310 ms while a board is working; wash splashes are spaced 650 ms apart. All active cookers share one simmer loop and all burning stations share one fire loop. At most eight voices overlap. Completed dishes use a bell; service opens with two bell strikes and closes with a gong. Plate handling and completed prep use a dish clink.

Mute, hidden pages, stale snapshots (1.5 seconds), disconnect/unmount and results stop cooking sounds. Snapshot baselines do not replay old deliveries or warnings. Results only play the closing cue after this browser displayed that service. Missing files/decode failures are silent and do not prevent play. Browser audio unlock is attempted on entry and retried on pointer/keyboard gestures.

## Source and rebuild

See `public/games/kitchen-rush/audio/CREDITS.md` for licenses, authors and modifications, and `manifest.json` for source hashes. Fetch these original files into a local cache (not the shipped public directory):

- https://opengameart.org/sites/default/files/fast_chops_on_cutting_board.wav as `chop.wav`
- https://opengameart.org/sites/default/files/water_boiling_in_pot.wav as `boil.wav`
- https://opengameart.org/sites/default/files/gas_burner_flicker_on_2.wav as `ignite.wav`
- https://opengameart.org/sites/default/files/fire-1.wav as `fire.wav`
- https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip; extract the named bell, gong, dish and splash recordings.

From the consumer repository root, run `python3 game-modules/packages/games/kitchen-rush/audio/build_sounds.py <cache-directory>`. Requires ffmpeg. The script exports eleven clips (632,144 bytes total). Review `/games/kitchen-rush/audio/index.html` on the running game server. That page previews source clips; the game applies the quieter levels in `SOUND_LEVELS` and a 0.65 master gain.

## Music

Original music, composed and synthesized in code by `audio/compose-music.mjs` (no samples or downloaded audio). The host plays a bossa nova in the lobby, a 32-bar swing theme during service (A sections build from brushes to ride cymbal, the bridge opens with stop-time hits), and a faster version a step higher for the last 30 seconds. The switch happens on the next bar line. Loading fades the lobby out; results play a short fanfare when stars were earned, or a comic trombone when none were, after the closing gong. Only a browser that heard the service live plays the sting. Muting, hiding the tab or disposal stops the music; it restarts from the top when sound returns.

Each loop file carries an extra second copied from its start and plays with `loopStart = 0.5 s`, so the decoder's MP3 padding never reaches the loop point. Rebuild from the platform root with `node game-modules/packages/games/kitchen-rush/audio/compose-music.mjs` (Node and ffmpeg). It writes the game MP3s to `public/games/kitchen-rush/music/` and preview WAV/MP3s to `output/kitchen-rush/music/`. Levels live in `MUSIC_LEVELS` in `src/audio.ts`.
