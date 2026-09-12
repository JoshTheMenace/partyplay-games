# Blockwild sound

Each controller scene owns one Web Audio mix. The watching display never creates an effects mix; a host playing a seat hears that seat's effects. The shared Sound button controls the local device. A tap or keypress unlocks audio where the browser requires a gesture. The effects bank is accompanied by the four user-supplied background tracks described below.

`server.ts`, `survival.ts` and `mobs.ts` emit short, bounded events only after successful actions. The public snapshot repeats up to 64 recent events for 0.75 seconds. `SoundCursor` consumes each ID once and discards initial, stale and reconnect history. Sounds are not saved. Player death includes the owner ID so that player hears it after respawning while others hear it at the original position.

`soundscape.ts` turns the snapshot and terrain into nearby sounds. Footsteps follow actual distance and the block underfoot; flying, standing still and teleporting do not produce walking sounds. Sneaking lowers footstep volume. It also tracks landing, water entry/exit, mining taps, occasional mob voices, active creeper fuses, campfires, furnace fuel and underwater ambience.

`audio.ts` renders the cues with distance attenuation and stereo panning using the player's current look direction. The mix has a compressor, 24-voice limit, five-loop limit and underwater low-pass filter. It stops sources on mute, missing connection/snapshots, backgrounding and disposal. Loading/decoding failures stay silent and do not block graphics readiness. Audio resumes after a permitted gesture; missed sounds are not queued.

Fable added sparse menu, selection and chest hooks in `client.tsx` and `workbench.tsx` through `ui-sound.ts`. Holding an action button does not play a success sound until the server confirms it.

## Assets

57 mono PCM WAV clips, 24 kHz, about 1.7 MB total. WAV keeps decoding portable across mobile browsers. Material footsteps and impacts have three variants with small playback-rate variation. The sound bank consists of original effects and these CC0 recordings:

- [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds): `step-*` and `impact-*` clips. Grass/leaves, dirt/sand/snow, wool, timber, stone, glass and metal choose different Foley families.
- [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio): menu selection (`metalClick`), menus (`bookOpen/Close`), chests (`doorOpen_1/doorClose_1`), crafting (`chop`), inventory pickup (`handleSmallLeather`), resting (`cloth1`) and jump movement (`knifeSlice`).
- Original synthesis: zombie growls, skeleton rattles, spider chitter, cow/sheep/pig/chicken calls, fuse hiss, fire, water, splash, bow and explosion. No Minecraft recordings are included.

Original Kenney license files ship beside the assets. `art/build_sounds.py` documents the exact source mappings and builds the bank from the two downloaded ZIPs using Python and ffmpeg. It also generates the original effects deterministically.

Reference: [Bedrock sound events and categories](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontosound?view=minecraft-bedrock-stable), [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [browser autoplay policies](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

## Background music

Horizon Dawn, Pastoral Horizons, Pastoral Quiet and Silent Exploration play in that order, then repeat. `music.ts` owns one streaming media element, advances when a track ends, and routes music through an 18% Web Audio gain into the host output. This avoids preloading four complete tracks and keeps phone volume control in the same audio graph as effects.

`host-music.ts` owns the playlist independently of `audio.ts`, which continues to own per-player effects. The shared scene props identify the host even when it is also a player. Music starts after the host's Start gesture where autoplay policy allows, otherwise after another host interaction. Only the host's Sound button pauses/resumes music; phone Sound buttons control their own effects. Hidden pages, a lost connection, suspended audio and disposed scenes pause or release the host playlist. Missing tracks are skipped; a completely missing playlist stops after four failed files.

The MP3s are unchanged user-supplied files in `public/games/blockwild/music/`. Their provenance and order are recorded beside them.

The farming update adds four original animal calls via `art/build_animal_sounds.py`, for 61 effect WAVs in total. Animal voices share the existing distance/pan filtering and staggered ambient timers. New short grass and wild crops use grass Foley.

Farm toolkit actions reuse local spatial effects: splash for successful bucket transfers, harvest for shearing, plant for fertilizer and eat for grazing. Failed actions emit no world sound. Host music routing is unchanged.
